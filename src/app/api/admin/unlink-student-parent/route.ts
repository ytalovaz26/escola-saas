import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { SCHOOL_MANAGEMENT_ROLES } from "@/lib/auth/schoolRoles";

export const runtime = "nodejs";

// Desvincular responsável de aluno (soft delete em student_parents).
// Autorização no servidor: vínculo ATIVO de gestão (diretor, coordenação, secretaria) em
// school_users (requireStaff). A escola é sempre a do vínculo de quem pede; o schoolId do
// corpo só é aceito se for igual a ela. Não usa o token do usuário contra o banco (RLS).
export async function POST(req: Request) {
  try {
    const guard = await requireStaff(req, [...SCHOOL_MANAGEMENT_ROLES]);
    if (!guard.ok) return guard.res;

    const body = await req.json().catch(() => null);

    const schoolId = body?.schoolId as string | undefined;
    const linkId = body?.linkId as string | undefined; // opcional (preferível)
    const parentId = body?.parentId as string | undefined; // opcional
    const studentId = body?.studentId as string | undefined; // opcional

    if (!schoolId) {
      return NextResponse.json({ ok: false, error: "schoolId é obrigatório" }, { status: 400 });
    }

    if (schoolId !== guard.schoolId) {
      return NextResponse.json({ ok: false, error: "Sem permissão para desvincular" }, { status: 403 });
    }

    // Precisamos de UM identificador do vínculo:
    // - linkId OU (parentId + studentId)
    if (!linkId && !(parentId && studentId)) {
      return NextResponse.json(
        { ok: false, error: "Informe linkId ou (parentId e studentId)" },
        { status: 400 }
      );
    }

    // desativa vínculo (soft delete), sempre restrito à escola de quem pede
    let q = supabaseAdmin.from("student_parents").update({ is_active: false });

    if (linkId) {
      q = q.eq("id", linkId);
    } else {
      q = q.eq("parent_id", parentId!).eq("student_id", studentId!);
    }

    q = q.eq("school_id", guard.schoolId).eq("is_active", true);

    const { error: updErr } = await q;
    if (updErr) {
      return NextResponse.json({ ok: false, error: "Não foi possível desvincular." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno" }, { status: 500 });
  }
}
