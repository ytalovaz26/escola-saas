-- =============================================================================
-- MINHA ESCOLA — Matrícula digital: documentos de matrícula
-- PREPARADA, NÃO APLICADA. Aplicar primeiro na HOMOLOGAÇÃO; produção só com aprovação.
--
-- - Cria public.enrollment_documents e o bucket PRIVADO "enrollment-documents".
-- - NÃO altera tabelas existentes (students, parents, schools...) nem seus dados.
-- - Acesso exclusivo do servidor (service_role): RLS ligada, sem políticas; anon e
--   authenticated sem privilégios. Downloads só por URL assinada gerada no servidor.
-- - Histórico preservado: DELETE e TRUNCATE bloqueados; reenvio marca a versão
--   anterior como "superseded".
-- - Integridade: documento, aluno e responsável sempre da MESMA escola (gatilho).
-- Execução: SQL Editor (papel postgres), arquivo inteiro. Rollback: scripts/rollback_enrollment_documents.sql.
-- =============================================================================

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.enrollment_documents') is not null then
    raise exception 'enrollment_documents já existe. Nada foi alterado.';
  end if;
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'students' and column_name = 'id') is distinct from 'uuid'
     or (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'students' and column_name = 'school_id') is distinct from 'uuid'
     or (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'parents' and column_name = 'id') is distinct from 'uuid'
     or (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'parents' and column_name = 'school_id') is distinct from 'uuid'
     or (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'schools' and column_name = 'id') is distinct from 'uuid' then
    raise exception 'Estrutura de schools/students/parents diferente da esperada (ids uuid). Nada foi alterado.';
  end if;
  if exists (select 1 from storage.buckets where id = 'enrollment-documents' and public) then
    raise exception 'O bucket enrollment-documents já existe e é PÚBLICO. Corrija antes de aplicar. Nada foi alterado.';
  end if;
end $$;

create table public.enrollment_documents (
  id                uuid        primary key default gen_random_uuid(),
  school_id         uuid        not null references public.schools (id) on delete restrict,
  student_id        uuid        not null references public.students (id) on delete restrict,
  parent_id         uuid        null references public.parents (id) on delete restrict,
  doc_type          text        not null,
  storage_path      text        not null,
  original_filename text        not null,
  mime_type         text        not null,
  size_bytes        integer     not null,
  sha256            text        not null,
  status            text        not null default 'pending',
  rejection_reason  text        null,
  uploaded_by       uuid        not null,
  uploaded_at       timestamptz not null default now(),
  reviewed_by       uuid        null,
  reviewed_at       timestamptz null,
  replaces_id       uuid        null references public.enrollment_documents (id) on delete restrict,

  constraint enrollment_documents_doc_type_check
    check (doc_type in ('birth_certificate', 'guardian_id', 'proof_of_address', 'school_transcript')),
  constraint enrollment_documents_status_check
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  constraint enrollment_documents_mime_check
    check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  constraint enrollment_documents_size_check
    check (size_bytes between 1 and 10485760),
  constraint enrollment_documents_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint enrollment_documents_filename_check
    check (char_length(original_filename) between 1 and 200),
  constraint enrollment_documents_path_check
    check (storage_path = school_id::text || '/' || student_id::text || '/' || doc_type || '/' || id::text || '.' ||
           case mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' else 'png' end),
  -- Rejeitado exige motivo; o motivo continua no histórico quando a versão é substituída.
  constraint enrollment_documents_rejection_check
    check ((status <> 'rejected' or rejection_reason is not null)
           and (rejection_reason is null or status in ('rejected', 'superseded'))
           and (rejection_reason is null or char_length(btrim(rejection_reason)) between 5 and 1000)),
  constraint enrollment_documents_review_check
    check ((status in ('approved', 'rejected')) <= (reviewed_by is not null and reviewed_at is not null))
);

create unique index enrollment_documents_storage_path_key on public.enrollment_documents (storage_path);
-- No máximo um documento ATIVO (pendente ou aprovado) por aluno e tipo.
create unique index enrollment_documents_one_active
  on public.enrollment_documents (student_id, doc_type)
  where status in ('pending', 'approved');
create index enrollment_documents_school_status_idx on public.enrollment_documents (school_id, status, uploaded_at desc);
create index enrollment_documents_student_idx on public.enrollment_documents (student_id);

-- Aluno (e responsável, quando informado) da MESMA escola do documento; campos de
-- identidade do documento imutáveis após o envio.
create function public.enrollment_documents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.school_id is distinct from old.school_id or new.student_id is distinct from old.student_id
     or new.parent_id is distinct from old.parent_id then
    if not exists (select 1 from public.students s where s.id = new.student_id and s.school_id = new.school_id) then
      raise exception 'Aluno não pertence à escola do documento.' using errcode = '23514';
    end if;
    if new.parent_id is not null
       and not exists (select 1 from public.parents p where p.id = new.parent_id and p.school_id = new.school_id) then
      raise exception 'Responsável não pertence à escola do documento.' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.school_id is distinct from old.school_id or new.student_id is distinct from old.student_id
       or new.doc_type is distinct from old.doc_type or new.storage_path is distinct from old.storage_path
       or new.sha256 is distinct from old.sha256 or new.size_bytes is distinct from old.size_bytes
       or new.uploaded_by is distinct from old.uploaded_by or new.uploaded_at is distinct from old.uploaded_at then
      raise exception 'Dados do arquivo enviado são imutáveis.' using errcode = '23514';
    end if;
    if old.status = 'superseded' then
      raise exception 'Documento substituído não pode ser alterado.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create function public.enrollment_documents_block_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Documentos de matrícula não podem ser excluídos (histórico preservado).' using errcode = '42501';
end;
$$;

create trigger enrollment_documents_guard
  before insert or update on public.enrollment_documents
  for each row execute function public.enrollment_documents_guard();
create trigger enrollment_documents_no_delete
  before delete on public.enrollment_documents
  for each row execute function public.enrollment_documents_block_delete();
create trigger enrollment_documents_no_truncate
  before truncate on public.enrollment_documents
  for each statement execute function public.enrollment_documents_block_delete();

-- Envio/reenvio atômico: trava as versões do mesmo aluno e tipo, recusa se já houver
-- aprovado, marca pendente/rejeitado anteriores como "superseded" e insere a nova versão.
-- Tudo na mesma transação (falha = nada muda). Só o servidor (service_role) executa.
create function public.enrollment_document_submit(
  p_id uuid, p_school_id uuid, p_student_id uuid, p_parent_id uuid, p_doc_type text,
  p_storage_path text, p_original_filename text, p_mime_type text, p_size_bytes integer,
  p_sha256 text, p_uploaded_by uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_replaced uuid;
begin
  perform 1 from public.enrollment_documents d
   where d.student_id = p_student_id and d.doc_type = p_doc_type and d.status <> 'superseded'
   for update;

  if exists (select 1 from public.enrollment_documents d
              where d.student_id = p_student_id and d.doc_type = p_doc_type and d.status = 'approved') then
    raise exception 'Documento já aprovado; reenvio somente pela secretaria.' using errcode = '23514';
  end if;

  select d.id into v_replaced from public.enrollment_documents d
   where d.student_id = p_student_id and d.doc_type = p_doc_type and d.status in ('pending', 'rejected')
   order by d.uploaded_at desc limit 1;

  update public.enrollment_documents d set status = 'superseded'
   where d.student_id = p_student_id and d.doc_type = p_doc_type and d.status in ('pending', 'rejected');

  insert into public.enrollment_documents (
    id, school_id, student_id, parent_id, doc_type, storage_path, original_filename,
    mime_type, size_bytes, sha256, status, uploaded_by, replaces_id)
  values (
    p_id, p_school_id, p_student_id, p_parent_id, p_doc_type, p_storage_path, p_original_filename,
    p_mime_type, p_size_bytes, p_sha256, 'pending', p_uploaded_by, v_replaced);

  return p_id;
end;
$$;

revoke all on function public.enrollment_document_submit(uuid, uuid, uuid, uuid, text, text, text, text, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.enrollment_document_submit(uuid, uuid, uuid, uuid, text, text, text, text, integer, text, uuid)
  to service_role;

alter table public.enrollment_documents enable row level security;
revoke all on table public.enrollment_documents from public, anon, authenticated, service_role;
grant select, insert, update on table public.enrollment_documents to service_role;
revoke all on function public.enrollment_documents_guard() from public, anon, authenticated;
revoke all on function public.enrollment_documents_block_delete() from public, anon, authenticated;

-- Bucket PRIVADO (sem políticas para anon/authenticated: só o servidor acessa).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('enrollment-documents', 'enrollment-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'enrollment-documents' and public is false) then
    raise exception 'Bucket enrollment-documents não ficou privado. Tudo foi desfeito.';
  end if;
  if exists (select 1 from pg_catalog.pg_policies
             where schemaname = 'storage' and tablename = 'objects' and policyname = 'enrollment_documents_somente_servidor') then
    raise exception 'A política enrollment_documents_somente_servidor já existe. Nada foi alterado.';
  end if;
end $$;

-- Em bucket privado, o acesso pela API do Storage é decidido pelas políticas de
-- storage.objects, que valem para TODOS os buckets. Políticas amplas já existentes
-- (ex.: "authenticated pode tudo") liberariam estes documentos a qualquer usuário logado.
-- Esta política RESTRICTIVE vale SOMENTE para o bucket enrollment-documents e nega tudo
-- a anon e authenticated (AND com qualquer permissiva). O servidor (service_role) ignora
-- RLS e continua sendo o único caminho. Os demais buckets não são afetados.
create policy enrollment_documents_somente_servidor
  on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id <> 'enrollment-documents')
  with check (bucket_id <> 'enrollment-documents');

commit;
