import { getSchoolBranding } from "@/lib/branding";

export async function GET(req: Request) {
  const guard = await requireStaff(req, ["admin","diretor","director","coordenador","coordinator","professor","teacher"]);
  if (!guard.ok) return guard.res;

  const { schoolId } = guard as any;
  const b = await getSchoolBranding(schoolId);

  if (!b.ok) return jsonError("Falha ao carregar branding.", 500, { details: b.error, hint: b.hint });

  return NextResponse.json(
    { ok: true, schoolId, name: b.name, logoUrl: b.logoUrl, primaryColor: b.primaryColor },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
