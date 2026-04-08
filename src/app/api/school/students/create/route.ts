// src/app/api/school/students/create/route.ts

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError, readJsonBody } from "@/lib/http";

export async function POST(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    const { json } = await readJsonBody(req);

    const full_name = String(json?.full_name || "").trim();
    const birth_date = json?.birth_date || null;
    const registration_number = json?.registration_number || null;
    const class_id = json?.class_id;

    if (!full_name) {
      return jsonFail(422, "Nome do aluno é obrigatório");
    }

    if (!class_id) {
      return jsonFail(422, "Turma é obrigatória");
    }

    // 1️⃣ cria aluno
    const { data: student, error: insertError } = await supabaseAdmin
      .from("students")
      .insert({
        school_id: guard.schoolId,
        full_name,
        birth_date,
        registration_number,
      })
      .select("id")
      .single();

    if (insertError) {
      return jsonFail(500, insertError.message);
    }

    // 2️⃣ vincula turma (RPC que você já usa)
    const { error: rpcError } = await supabaseAdmin.rpc("set_active_class", {
      p_student_id: student.id,
      p_class_id: class_id,
    });

    if (rpcError) {
      return jsonFail(500, rpcError.message);
    }

    return jsonOk({ student });
  } catch (err) {
    logRouteError("POST /api/school/students/create", err, {
      schoolId: guard.schoolId,
    });

    return jsonFail(500, "Erro interno ao criar aluno");
  }
}