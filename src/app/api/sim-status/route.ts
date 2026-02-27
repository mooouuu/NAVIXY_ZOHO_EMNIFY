import { NextResponse } from "next/server";
import { fetchSimStatuses } from "@/lib/emnify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { imeis?: string[] };
    const imeis = body?.imeis || [];
    if (!Array.isArray(imeis) || imeis.length === 0) {
      return NextResponse.json({ statuses: {} });
    }
    const statuses = await fetchSimStatuses(imeis);
    return NextResponse.json({ statuses });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "No se pudo obtener estado de SIM";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
