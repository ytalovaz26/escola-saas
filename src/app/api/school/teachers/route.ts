// src/app/api/school/teachers/route.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/requireStaff";
import { jsonFail, jsonOk, logRouteError } from "@/lib/http";

function normRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

export async function GET(req: Request) {
  const guard = await requireStaff(req, ["director", "coordinator", "diretor", "coordenador"]);
  if (!guard.ok) return guard.res;

  try {
    // Professores = school_users.role == 'teacher' (aceita variações)
    const { data: su, error: suErr } = await supabaseAdmin
      .from("school_users")
      .select("user_id, role, is_active")
      .eq("school_id", guard.schoolId)
      .eq("is_active", true);

    if (suErr) return jsonFail(500, suErr.message);

    const teacherIds = (su || [])
      .filter((x) => {
        const r = normRole(x.role);
        return r === "teacher" || r === "professor";
      })
      .map((x) => x.user_id);

    if (teacherIds.length === 0) return jsonOk({ teachers: [] });

    // Junta com profiles (assumindo profiles.id = user_id do auth)
    const { data: profs, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", teacherIds);

    if (pErr) return jsonFail(500, pErr.message);

    // Normaliza resposta
    const teachers = (profs || []).map((p) => ({
      id: p.id as string,
      full_name: (p as any).full_name ?? null,
      email: (p as any).email ?? null,
    }));

    // ordena: nome depois email
    teachers.sort((a, b) => {
      const an = (a.full_name || a.email || a.id).toLowerCase();
      const bn = (b.full_name || b.email || b.id).toLowerCase();
      return an.localeCompare(bn);
    });

    return jsonOk({ teachers });
  } catch (err) {
    logRouteError("GET /api/school/teachers", err, { schoolId: guard.schoolId });
    return jsonFail(500, "Internal error");
  }
}