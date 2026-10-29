-- =============================================================================
-- MINHA ESCOLA — ROLLBACK da migração 20261029120000_enrollment_documents
-- Só remove a estrutura se NÃO houver nenhum documento registrado nem arquivo no
-- bucket. Com documentos enviados, aborta: reverter exigiria decisão explícita.
-- Não altera alunos, responsáveis, escolas nem outros buckets.
-- =============================================================================

begin;
set local lock_timeout = '3s';

do $$
begin
  if to_regclass('public.enrollment_documents') is not null
     and exists (select 1 from public.enrollment_documents) then
    raise exception 'Existem documentos de matrícula registrados. Rollback bloqueado; nada foi alterado.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'enrollment-documents') then
    raise exception 'Existem arquivos no bucket enrollment-documents. Rollback bloqueado; nada foi alterado.';
  end if;
end $$;

drop policy if exists enrollment_documents_somente_servidor on storage.objects;
drop function if exists public.enrollment_document_submit(uuid, uuid, uuid, uuid, text, text, text, text, integer, text, uuid);
drop table if exists public.enrollment_documents;
drop function if exists public.enrollment_documents_guard();
drop function if exists public.enrollment_documents_block_delete();
delete from storage.buckets where id = 'enrollment-documents'
  and not exists (select 1 from storage.objects where bucket_id = 'enrollment-documents');

commit;
