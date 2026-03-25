import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";

export const runtime = "nodejs";

export async function PUT(req: Request) {

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

  const body = await req.json();

  const { entryId, content_taught, methodology, activities, notes, homework } = body;

  if (!entryId) {
    return NextResponse.json({ ok:false, error:"entryId obrigatório" },{status:400});
  }

  const { error } = await supabaseAdmin
    .from("class_diary_entries")
    .update({
      content_taught,
      methodology,
      activities,
      notes,
      homework,
      updated_at: new Date()
    })
    .eq("id", entryId)
    .eq("school_id", schoolId)
    .eq("teacher_user_id", teacherUserId);

  if (error) {
    return NextResponse.json({
      ok:false,
      error:"Erro ao atualizar diário",
      details:error.message
    },{status:500});
  }

  return NextResponse.json({
    ok:true,
    message:"Diário atualizado com sucesso"
  });

}