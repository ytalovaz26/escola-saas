import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type MeResponse = {
  ok: true;
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  school?: { schoolId: string; role: string };
  parent?: { parentId: string; schoolId: string | null };
  branding?: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandIconUrl: string | null;
  };
  redirectTo: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normRole(role: unknown) {
  return String(role || "").trim().toLowerCase();
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return jsonError("Missing Authorization Bearer token.", 401);

    // 1) Validar token e descobrir user
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonError("Invalid token/session.", 401);
    }

    const userId = String(userData.user.id);
    const email = userData.user.email ?? null;

    // 2) Checar se é platform admin
    const { data: pa, error: paErr } = await supabaseAdmin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (paErr) {
      return jsonError("platform_admins check failed: " + paErr.message, 500);
    }

    const isPlatformAdmin = !!pa?.user_id;

    // 3) Buscar vínculo em school_users
    let school: MeResponse["school"] = undefined;

    if (!isPlatformAdmin) {
      const { data: link, error: linkErr } = await supabaseAdmin
        .from("school_users")
        .select("school_id, role, is_active, created_at")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (linkErr) {
        return jsonError("school_users lookup failed: " + linkErr.message, 500);
      }

      if (link?.school_id) {
        school = {
          schoolId: String(link.school_id),
          role: String(link.role || ""),
        };
      }
    }

    // 4) Parent
    let parent: MeResponse["parent"] = undefined;

    if (!isPlatformAdmin && !school?.schoolId) {
      const { data: p, error: pErr } = await supabaseAdmin
        .from("parents")
        .select("id, school_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (pErr) {
        return jsonError("parents lookup failed: " + pErr.message, 500);
      }

      if (p?.id) {
        parent = {
          parentId: String(p.id),
          schoolId: p.school_id ? String(p.school_id) : null,
        };
      }
    }

    // 5) redirect
    let redirectTo = "/login";

    if (isPlatformAdmin) {
      redirectTo = "/admin-master";
    } else if (school?.role) {
      const r = normRole(school.role);

      if (
        r === "diretor" ||
        r === "director" ||
        r === "coordenador" ||
        r === "coordinator"
      ) {
        redirectTo = "/school";
      } else if (r === "professor" || r === "teacher") {
        redirectTo = "/teacher";
      } else {
        redirectTo = "/";
      }
    } else if (parent?.parentId) {
      redirectTo = "/parent";
    }

    // 6) Branding
    let schoolIdForBranding: string | null = school?.schoolId ?? null;

    if (!schoolIdForBranding && parent?.parentId) {
      const { data: sp, error: spErr } = await supabaseAdmin
        .from("student_parents")
        .select("student_id")
        .eq("parent_id", parent.parentId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (spErr) {
        return jsonError("student_parents lookup failed: " + spErr.message, 500);
      }

      if (sp?.student_id) {
        const { data: st, error: stErr } = await supabaseAdmin
          .from("students")
          .select("school_id")
          .eq("id", sp.student_id)
          .maybeSingle();

        if (stErr) {
          return jsonError("students school lookup failed: " + stErr.message, 500);
        }

        schoolIdForBranding = st?.school_id ? String(st.school_id) : null;
      }
    }

    let branding: MeResponse["branding"] = undefined;

    if (schoolIdForBranding) {
      const { data: sch, error: schErr } = await supabaseAdmin
        .from("schools")
        .select("brand_name, brand_logo_url, brand_icon_url, name")
        .eq("id", schoolIdForBranding)
        .maybeSingle();

      if (schErr) {
        return jsonError("schools branding lookup failed: " + schErr.message, 500);
      }

      branding = {
        brandName: (sch?.brand_name ?? sch?.name ?? null) as string | null,
        brandLogoUrl: (sch?.brand_logo_url ?? null) as string | null,
        brandIconUrl: (sch?.brand_icon_url ?? null) as string | null,
      };
    }

    const payload: MeResponse = {
      ok: true,
      user: { id: userId, email },
      isPlatformAdmin,
      school,
      parent,
      branding,
      redirectTo,
    };

    return NextResponse.json(payload);
  } catch (e: any) {
    return jsonError(e?.message || "Internal error in /api/me", 500);
  }
}