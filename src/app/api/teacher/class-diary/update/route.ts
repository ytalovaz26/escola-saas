import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  try {
    const guard = await requireStaff(req, [
      "professor", "teacher", "coordenador", "coordinator",
      "diretor", "director", "admin",
    ]);
    if (!guard.ok) return guard.res;

    const schoolId = (guard as any).schoolId;
    const teacherUserId =
      (guard as any).userId || (guard as any).user?.id || (guard as any).authUserId;

    if (!schoolId || !teacherUserId) {
      return NextResponse.json(
        { ok: false, error: "Usuário ou escola não identificado." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const {
      entryId, classId, subjectName, termLabel,
      content_taught, methodology, activities, notes, homework,
    } = body;

    if (!entryId) {
      return NextResponse.json(
        { ok: false, error: "entryId obrigatório." },
        { status: 400 }
      );
    }

    const { data: entry, error: entryError } = await supabaseAdmin
      .from("class_diary_entries")
      .select("id, diary_id")
      .eq("id", entryId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (entryError) {
      return NextResponse.json(
        { ok: false, error: "Erro ao localizar lançamento.", details: entryError.message },
        { status: 500 }
      );
    }
    if (!entry) {
      return NextResponse.json(
        { ok: false, error: "Lançamento não encontrado nesta escola." },
        { status: 404 }
      );
    }

    const { data: diary, error: diaryError } = await supabaseAdmin
      .from("class_diaries")
      .select("id, class_id, subject_name, term_label")
      .eq("id", entry.diary_id)
      .eq("school_id", schoolId)
      .eq("teacher_user_id", teacherUserId)
      .maybeSingle();

    if (diaryError) {
      return NextResponse.json(
        { ok: false, error: "Erro ao validar vínculo com o diário.", details: diaryError.message },
        { status: 500 }
      );
    }
    if (!diary || (classId && diary.class_id !== classId)) {
      return NextResponse.json(
        { ok: false, error: "Diário não encontrado para alteração." },
        { status: 404 }
      );
    }

    const newSubject = typeof subjectName === "string" ? subjectName.trim() : diary.subject_name;
    const newTerm = typeof termLabel === "string" ? termLabel.trim() : diary.term_label;
    if (!newSubject) {
      return NextResponse.json(
        { ok: false, error: "A disciplina não pode ficar vazia." },
        { status: 400 }
      );
    }

    // Atualiza o lançamento e confirma que o banco retornou o registro alterado.
    const { data: updatedEntry, error: updateError } = await supabaseAdmin
      .from("class_diary_entries")
      .update({
        content_taught, methodology, activities, notes, homework,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.id)
      .eq("school_id", schoolId)
      .eq("diary_id", diary.id)
      .select("id")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: "Erro ao atualizar lançamento.", details: updateError.message },
        { status: 500 }
      );
    }
    if (!updatedEntry) {
      return NextResponse.json(
        { ok: false, error: "Nenhum lançamento foi atualizado." },
        { status: 404 }
      );
    }

    // Disciplina e período pertencem ao cabeçalho (class_diaries), não ao lançamento.
    // Só atualiza o cabeçalho quando o usuário realmente alterou esses campos.
    if (newSubject !== diary.subject_name || newTerm !== diary.term_label) {
      const { data: updatedDiary, error: headerError } = await supabaseAdmin
        .from("class_diaries")
        .update({ subject_name: newSubject, term_label: newTerm })
        .eq("id", diary.id)
        .eq("school_id", schoolId)
        .eq("teacher_user_id", teacherUserId)
        .select("id, subject_name, term_label")
        .maybeSingle();

      if (headerError || !updatedDiary) {
        return NextResponse.json(
          {
            ok: false,
            error: "O lançamento foi atualizado, mas não foi possível salvar a disciplina/período. Verifique antes de tentar novamente.",
            details: headerError?.message,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Diário atualizado com sucesso.",
      diaryId: diary.id,
      subjectName: newSubject,
      termLabel: newTerm,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: "Erro interno ao atualizar diário.", details: error?.message || "Erro desconhecido." },
      { status: 500 }
    );
  }
}
