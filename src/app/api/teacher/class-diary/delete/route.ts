import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

export async function DELETE(req: Request) {

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
  const teacherUserId = (guard as any).userId;

  const url = new URL(req.url);

  const entryId = url.searchParams.get("entryId");

  if (!entryId) {
    return NextResponse.json({ ok:false, error:"entryId obrigatório" },{status:400});
  }

  const { error } = await supabaseAdmin
    .from("class_diary_entries")
    .delete()
    .eq("id", entryId)
    .eq("school_id", schoolId)
    .eq("teacher_user_id", teacherUserId);

  if (error) {
    return NextResponse.json({
      ok:false,
      error:"Erro ao excluir diário",
      details:error.message
    },{status:500});
  }

  return NextResponse.json({
    ok:true,
    message:"Registro do diário excluído"
  });

}