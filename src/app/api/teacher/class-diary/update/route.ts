import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  try {
    const guard = await requireStaff(req, [
      "professor",
      "teacher",
      "coordenador",
      "coordinator",
      "diretor",
      "director",
      "admin",
    ]);

    if (!guard.ok) return guard.res;

    const schoolId = (guard as any).schoolId;
    const teacherUserId =
      (guard as any).userId ||
      (guard as any).user?.id ||
      (guard as any).authUserId;

    if (!schoolId || !teacherUserId) {
      return NextResponse.json(
        { ok: false, error: "Usuário ou escola não identificado." },
        { status: 401 }
      );
    }

    const body = await req.json();

    const {
      entryId,
      content_taught,
      methodology,
      activities,
      notes,
      homework,
    } = body;

    if (!entryId) {
      return NextResponse.json(
        { ok: false, error: "entryId obrigatório." },
        { status: 400 }
      );
    }

    // Localiza o lançamento exclusivamente dentro da escola autenticada.
    const { data: entry, error: entryError } = await supabaseAdmin
      .from("class_diary_entries")
      .select("id, diary_id")
      .eq("id", entryId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (entryError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Erro ao localizar lançamento.",
          details: entryError.message,
        },
        { status: 500 }
      );
    }

    if (!entry) {
      return NextResponse.json(
        {
          ok: false,
          error: "Lançamento não encontrado nesta escola.",
        },
        { status: 404 }
      );
    }

    // Confirma que o diário pertence à escola e ao professor autenticado.
    const { data: diary, error: diaryError } = await supabaseAdmin
      .from("class_diaries")
      .select("id")
      .eq("id", entry.diary_id)
      .eq("school_id", schoolId)
      .eq("teacher_user_id", teacherUserId)
      .maybeSingle();

    if (diaryError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Erro ao validar vínculo com o diário.",
          details: diaryError.message,
        },
        { status: 500 }
      );
    }

    if (!diary) {
      return NextResponse.json(
        {
          ok: false,
          error: "Diário não encontrado para alteração.",
        },
        { status: 404 }
      );
    }

    // Atualiza apenas o lançamento validado.
    const { data: updatedEntry, error: updateError } = await supabaseAdmin
      .from("class_diary_entries")
      .update({
        content_taught,
        methodology,
        activities,
        notes,
        homework,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.id)
      .eq("school_id", schoolId)
      .select("id")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Erro ao atualizar diário.",
          details: updateError.message,
        },
        { status: 500 }
      );
    }

    if (!updatedEntry) {
      return NextResponse.json(
        {
          ok: false,
          error: "Nenhum lançamento foi atualizado.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Diário atualizado com sucesso.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Erro interno ao atualizar diário.",
        details: error?.message || "Erro desconhecido.",
      },
      { status: 500 }
    );
  }
}