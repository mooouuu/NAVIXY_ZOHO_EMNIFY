import { NextResponse } from "next/server";
import { fetchZohoData } from "@/lib/zoho";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await fetchZohoData();
    return NextResponse.json({ data });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "No se pudo sincronizar con Zoho";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
