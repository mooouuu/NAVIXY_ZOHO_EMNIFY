import { NextResponse } from "next/server";

import { listSms, sendSms } from "@/lib/emnify";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const endpointId = Number(searchParams.get("endpointId"));
    const limit = Number(searchParams.get("limit") || "5");
    if (!endpointId) {
      return NextResponse.json({ error: "endpointId requerido" }, { status: 400 });
    }
    const messages = await listSms(endpointId, limit);
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("sim-sms GET error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { endpointId, message, sourceAddress } = (await req.json()) as {
      endpointId?: number;
      message?: string;
      sourceAddress?: string;
    };
    if (!endpointId || !message) {
      return NextResponse.json(
        { error: "endpointId y message son requeridos" },
        { status: 400 }
      );
    }
    await sendSms(endpointId, message, sourceAddress);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("sim-sms POST error", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
