import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type SchoolBrand = {
  logo_url: string | null;
  primary_color: string | null;
  name?: string | null;
};

// função interna (NÃO exportar)
async function getSchoolBrandInternal(schoolId: string): Promise<SchoolBrand | null> {
  if (!schoolId) return null;

  const tryWithName = await supabaseAdmin
    .from("schools")
    .select("logo_url,primary_color,name")
    .eq("id", schoolId)
    .maybeSingle();

  if (!tryWithName.error) return (tryWithName.data as any) ?? null;

  const fallback = await supabaseAdmin
    .from("schools")
    .select("logo_url,primary_color")
    .eq("id", schoolId)
    .maybeSingle();

  if (fallback.error) return null;
  return (fallback.data as any) ?? null;
}

// ✅ ROTA VÁLIDA DO NEXT
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const schoolId = searchParams.get("schoolId");

    if (!schoolId) {
      return new Response(JSON.stringify({ error: "schoolId is required" }), {
        status: 400,
      });
    }

    const data = await getSchoolBrandInternal(schoolId);

    return new Response(JSON.stringify(data), {
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
    });
  }
}