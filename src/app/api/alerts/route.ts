import { NextResponse } from "next/server";
import { assertNavixyEnv, listRecentAlerts, navixyMeta } from "@/lib/navixy-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    assertNavixyEnv();
    const alerts = await listRecentAlerts(15);
    return NextResponse.json({ alerts, meta: navixyMeta() });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo obtener alertas de Navixy";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
