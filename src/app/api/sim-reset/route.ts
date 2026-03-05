import { NextResponse } from "next/server";

import { resetConnectivity } from "@/lib/emnify";

export async function POST(req: Request) {
  try {
    const { endpointId } = (await req.json()) as { endpointId?: number };
    if (!endpointId) {
      return NextResponse.json({ error: "endpointId requerido" }, { status: 400 });
    }
    await resetConnectivity(endpointId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("sim-reset error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
