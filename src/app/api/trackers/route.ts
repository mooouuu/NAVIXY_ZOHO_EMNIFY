import { NextResponse } from "next/server";
import {
  assertNavixyEnv,
  listTrackers,
  navixyMeta,
  normalizeTracker,
} from "@/lib/navixy-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    assertNavixyEnv();
    const rawList = await listTrackers();
    const trackers = rawList.map((item) => normalizeTracker(item));

    return NextResponse.json({
      trackers,
      meta: { ...navixyMeta(), count: trackers.length },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo contactar con la API de Navixy";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
