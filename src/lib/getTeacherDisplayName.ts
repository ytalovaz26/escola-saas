import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getTeacherDisplayName(params: {
  teacherUserId?: string | null;
  schoolId?: string | null;
}): Promise<string> {
  const teacherUserId = String(params.teacherUserId || "").trim();
  const schoolId = String(params.schoolId || "").trim();

  if (!teacherUserId) return "—";

  // 1) profiles.full_name
  try {
    const p1 = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", teacherUserId)
      .maybeSingle();

    if (!p1.error) {
      const fullName = String((p1.data as any)?.full_name || "").trim();
      if (fullName) return fullName;
    }
  } catch {}

  // 2) profiles.name
  try {
    const p2 = await supabaseAdmin
      .from("profiles")
      .select("name")
      .eq("id", teacherUserId)
      .maybeSingle();

    if (!p2.error) {
      const name = String((p2.data as any)?.name || "").trim();
      if (name) return name;
    }
  } catch {}

  // 3) school_users.full_name
  if (schoolId) {
    try {
      const su1 = await supabaseAdmin
        .from("school_users")
        .select("full_name")
        .eq("user_id", teacherUserId)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (!su1.error) {
        const fullName = String((su1.data as any)?.full_name || "").trim();
        if (fullName) return fullName;
      }
    } catch {}
  }

  // 4) school_users.name
  if (schoolId) {
    try {
      const su2 = await supabaseAdmin
        .from("school_users")
        .select("name")
        .eq("user_id", teacherUserId)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (!su2.error) {
        const name = String((su2.data as any)?.name || "").trim();
        if (name) return name;
      }
    } catch {}
  }

  // 5) teachers.name
  if (schoolId) {
    try {
      const t1 = await supabaseAdmin
        .from("teachers")
        .select("name")
        .eq("user_id", teacherUserId)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (!t1.error) {
        const name = String((t1.data as any)?.name || "").trim();
        if (name) return name;
      }
    } catch {}
  }

  // 6) auth.users metadata / email
  try {
    const authUser = await supabaseAdmin.auth.admin.getUserById(teacherUserId);
    const user = authUser.data?.user;

    const metaName =
      String(
        (user?.user_metadata as any)?.full_name ||
          (user?.user_metadata as any)?.name ||
          ""
      ).trim();

    if (metaName) return metaName;

    const email = String(user?.email || "").trim();
    if (email) return email;
  } catch {}

  return "—";
}