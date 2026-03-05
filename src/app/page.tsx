"use client";

import { useState } from "react";
import useSWR from "swr";

import type { NormalizedTracker } from "@/lib/navixy-client";
import type { ZohoData } from "@/lib/zoho";
import type { SmsMessage } from "@/lib/emnify";

type ApiResponse = {
  trackers: NormalizedTracker[];
  meta?: { domain?: string; count?: number; hasHash?: boolean };
  error?: string;
};

type SimStatus = {
  imei: string;
  endpointId?: number;
  sim?: { iccid?: string; status?: string; imsi?: string; msisdn?: string };
  connectivity?: {
    status?: string;
    rat?: string;
    operator?: string;
    country?: string;
    lastUpdated?: string;
  };
} | null;

type SimResponse = {
  statuses: Record<string, SimStatus>;
  error?: string;
};

const jsonFetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "No se pudo cargar información");
  return data as T;
};

type AlertsResponse = {
  alerts: {
    id: number;
    tracker_id: number;
    message: string;
    time: string;
    event?: string;
    address?: string;
  }[];
  error?: string;
};

const fetcher = async (url: string): Promise<ApiResponse> => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "No se pudo cargar la información");
  }
  return data;
};

function formatDate(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function TrackerCard({ tracker, sim, company }: { tracker: NormalizedTracker; sim?: SimStatus; company?: string }) {
  const statusText = tracker.status?.toLowerCase() || "desconocido";
  const statusColor = statusText.includes("on") || statusText.includes("activ")
    ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/40"
    : "bg-amber-500/10 text-amber-100 border border-amber-500/30";

  const simStatus = sim?.connectivity?.status || sim?.sim?.status;
  const simRat = sim?.connectivity?.rat;
  const simOperator = sim?.connectivity?.operator;
  const simNumber = sim?.sim?.iccid || sim?.sim?.msisdn;
  const endpointId = sim?.endpointId;
  const hasCoords =
    tracker.lat !== undefined &&
    tracker.lon !== undefined &&
    tracker.lat !== null &&
    tracker.lon !== null;
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps?q=${tracker.lat},${tracker.lon}`
    : undefined;

  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [smsList, setSmsList] = useState<SmsMessage[] | null>(null);
  const [smsLoading, setSmsLoading] = useState(false);

  const handleReset = async () => {
    if (!endpointId) return;
    setResetMsg(null);
    setResetting(true);
    try {
      const res = await fetch("/api/sim-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo resetear la línea");
      setResetMsg("Reset enviado");
    } catch (err) {
      setResetMsg(err instanceof Error ? err.message : "Error al resetear");
    } finally {
      setResetting(false);
    }
  };

  const handleSendSms = async () => {
    if (!endpointId || !smsBody.trim()) return;
    setSmsMsg(null);
    setSmsSending(true);
    try {
      const res = await fetch("/api/sim-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointId, message: smsBody }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo enviar SMS");
      setSmsMsg("SMS enviado");
      setSmsBody("");
    } catch (err) {
      setSmsMsg(err instanceof Error ? err.message : "Error al enviar SMS");
    } finally {
      setSmsSending(false);
    }
  };

  const handleLoadSms = async () => {
    if (!endpointId) return;
    setSmsLoading(true);
    setSmsMsg(null);
    try {
      const res = await fetch(`/api/sim-sms?endpointId=${endpointId}&limit=5`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo cargar SMS");
      setSmsList(json.messages || []);
    } catch (err) {
      setSmsMsg(err instanceof Error ? err.message : "Error al cargar SMS");
    } finally {
      setSmsLoading(false);
    }
  };

  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/60">
            Tracker
          </p>
          <h3 className="text-lg font-semibold text-white">{tracker.name}</h3>
          <p className="text-sm text-white/60">ID: {tracker.id}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor}`}>
          {tracker.status || "Sin estado"}
        </span>
      </div>
      {/* Navixy */}
      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">Navixy</span>
          <span className="text-white/40">Telemetría</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm text-white/70 sm:grid-cols-4">
          <div>
            <p className="text-white/50">Última señal</p>
            <p className="font-medium text-white">{formatDate(tracker.updatedAt)}</p>
          </div>
          <div>
            <p className="text-white/50">Latitud</p>
            <p className="font-mono text-white">{tracker.lat ?? "—"}</p>
          </div>
          <div>
            <p className="text-white/50">Longitud</p>
            <p className="font-mono text-white">{tracker.lon ?? "—"}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-white/50">Ubicación</p>
            {hasCoords ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-white/80">{tracker.lat}, {tracker.lon}</span>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-50 shadow-sm shadow-emerald-900/30 transition hover:brightness-110"
                >
                  Abrir en Google Maps
                </a>
              </div>
            ) : (
              <p className="font-mono text-white">—</p>
            )}
          </div>
          <div>
            <p className="text-white/50">Velocidad</p>
            <p className="font-mono text-white">{tracker.speedKph ?? "—"} km/h</p>
          </div>
          <div>
            <p className="text-white/50">Motor</p>
            <p className="font-mono text-white">{tracker.ignition === undefined ? "—" : tracker.ignition ? "Encendido" : "Apagado"}</p>
          </div>
          <div>
            <p className="text-white/50">Batería</p>
            <p className="font-mono text-white">{tracker.battery ?? "—"}%</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-white/50">Dirección</p>
            <p className="font-medium text-white/90 line-clamp-2">
              {tracker.address || "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Emnify */}
      <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-50">Emnify</span>
          <span className="text-emerald-100/70">SIM y conectividad</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm text-white/80 sm:grid-cols-3">
          <div>
            <p className="text-white/50">Estado SIM</p>
            <p className="font-mono text-white">
              {simStatus || "—"} {simOperator ? `· ${simOperator}` : ""} {simRat ? `· ${simRat}` : ""}
            </p>
          </div>
          <div>
            <p className="text-white/50">RAT</p>
            <p className="font-mono text-white">{simRat || "—"}</p>
          </div>
          <div>
            <p className="text-white/50">Operador</p>
            <p className="font-mono text-white">{simOperator || "—"}</p>
          </div>
          <div className="sm:col-span-3">
            <p className="text-white/50">SIM (ICCID/MSISDN)</p>
            <p className="font-mono text-white break-all">{simNumber || "—"}</p>
          </div>
          <div>
            <p className="text-white/50">Reset de conexión</p>
            <div className="flex flex-col gap-1">
              <button
                disabled={!endpointId || resetting}
                onClick={handleReset}
                className="w-full rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-3 py-1 text-sm font-semibold text-emerald-50 transition hover:brightness-110 disabled:opacity-50"
              >
                {resetting ? "Enviando..." : "Resetear línea"}
              </button>
              {resetMsg && (
                <span className="text-xs text-white/70">{resetMsg}</span>
              )}
              {!endpointId && (
                <span className="text-xs text-white/50">Sin endpoint Emnify</span>
              )}
            </div>
          </div>
          <div className="sm:col-span-2">
            <p className="text-white/50">SMS (Emnify)</p>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  disabled={!endpointId || smsSending}
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  placeholder="Mensaje a enviar"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-emerald-400 focus:outline-none"
                />
                <button
                  disabled={!endpointId || smsSending || !smsBody.trim()}
                  onClick={handleSendSms}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
                >
                  {smsSending ? "Enviando…" : "Enviar SMS"}
                </button>
                <button
                  disabled={!endpointId || smsLoading}
                  onClick={handleLoadSms}
                  className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  {smsLoading ? "Cargando…" : "Ver últimos SMS"}
                </button>
              </div>
              {smsMsg && <span className="text-xs text-white/70">{smsMsg}</span>}
              {!endpointId && <span className="text-xs text-white/50">Sin endpoint Emnify</span>}
              {smsList && smsList.length > 0 && (
                <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-white/80">
                  {smsList.map((m) => (
                    <div key={m.id} className="border-b border-white/5 py-1 last:border-0">
                      <div className="flex justify-between">
                        <span className="font-semibold">
                          {m.direction === "mt" ? "➜" : "⬅"} {m.direction?.toUpperCase() || "?"}
                        </span>
                        <span className="text-white/60">{formatDate(m.timestamp)}</span>
                      </div>
                      <div className="text-white/70 break-words">{m.payload || "(sin texto)"}</div>
                      <div className="text-white/50">
                        {m.source_address || ""} → {m.dest_address || ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Zoho */}
      <div className="mt-4 rounded-xl border border-indigo-400/30 bg-indigo-500/5 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] text-indigo-50">Zoho</span>
          <span className="text-indigo-100/70">Cliente</span>
        </div>
        <p className="font-mono text-white">{company || "—"}</p>
      </div>

      <details className="mt-3 rounded-xl bg-black/30 px-4 py-3 text-white/70">
        <summary className="cursor-pointer text-sm font-semibold text-white">
          Ver datos completos
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto text-xs text-white/70">
          {JSON.stringify(tracker.raw, null, 2)}
        </pre>
      </details>
    </article>
  );
}

export default function Home() {
  const { data, error, isValidating, mutate } = useSWR<ApiResponse>(
    "/api/trackers",
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
    }
  );

  const { data: alertsData } = useSWR<AlertsResponse>(
    "/api/alerts",
    async (url: string) => {
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo cargar alertas");
      return json;
    },
    { refreshInterval: 10_000, revalidateOnFocus: false }
  );

  const trackers = data?.trackers ?? [];
  const onlineCount = trackers.filter((t) =>
    (t.status || "").toLowerCase().includes("on")
  ).length;
  const panicCount = alertsData?.alerts?.length ?? 0;

  const { data: zohoResp } = useSWR<{ data: ZohoData }>("/api/zoho/sync", jsonFetcher, {
    refreshInterval: 5 * 60_000,
    revalidateOnFocus: false,
  });

  const zohoData = zohoResp?.data;

  const companyByImei: Record<string, string | undefined> = {};
  if (zohoData?.companies && zohoData.devices) {
    const companyMap: Record<string, string | undefined> = {};
    (zohoData.companies || []).forEach((c) => {
      companyMap[c.id] = c.name;
    });
    (zohoData.devices || []).forEach((d) => {
      if (d.imei) {
        companyByImei[d.imei] = d.companyId ? companyMap[d.companyId] : undefined;
      }
    });
  }

  const imeis = trackers.map(
    (t) =>
      ((t.raw as Record<string, unknown> | undefined)?.source as
        | Record<string, unknown>
        | undefined)?.device_id?.toString() ||
      (t.raw as Record<string, unknown> | undefined)?.device_id?.toString() ||
      t.id
  );

  const { data: simData } = useSWR<SimResponse>(
    () => (imeis.length ? ["sim-status", ...imeis] : null),
    async () => {
      const res = await fetch("/api/sim-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imeis }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se pudo cargar SIM status");
      return json as SimResponse;
    },
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#020617] via-[#0b122d] to-[#0f172a] text-white">
      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12 sm:px-10 lg:px-16">
        <header className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/40">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-white/60">
                Navixy · Dashboard rápido
              </p>
              <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
                Datos en vivo desde tu cuenta Navixy
              </h1>
              <p className="mt-2 text-white/70">
                Ajusta el hash en <code>.env.local</code> y pulsa “Actualizar” para
                traer el inventario de trackers.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => mutate()}
                disabled={isValidating}
                className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
              >
                {isValidating ? "Actualizando…" : "Actualizar"}
              </button>
              <div className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/80">
                Dominio: {data?.meta?.domain || "configura NAVIXY_DOMAIN"}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                Trackers
              </p>
              <p className="text-3xl font-semibold">{data?.meta?.count ?? "—"}</p>
              <p className="text-sm text-white/60">Total recibidos</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                Online
              </p>
              <p className="text-3xl font-semibold">{onlineCount}</p>
              <p className="text-sm text-white/60">Basado en estado</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                Última actualización
              </p>
              <p className="text-3xl font-semibold">
                {isValidating ? "…" : "Listo"}
              </p>
              <p className="text-sm text-white/60">Auto cada 60s</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                Alertas SOS (15 min)
              </p>
              <p className="text-3xl font-semibold">{panicCount}</p>
              <p className="text-sm text-white/60">Botón de pánico / emergencias</p>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              ⚠️ {error.message}
              <div className="text-red-200/80">
                Asegúrate de definir NAVIXY_HASH y NAVIXY_DOMAIN en .env.local y
                reiniciar el servidor.
              </div>
            </div>
          )}
        </header>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Trackers</h2>
            <span className="text-sm text-white/60">
              Se refresca cada minuto desde el servidor (sin exponer tu hash)
            </span>
          </div>

          {trackers.length === 0 && !error ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-white/70">
              No se recibieron trackers aún. Revisa las variables de entorno o
              espera unos segundos y pulsa “Actualizar”.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {trackers.map((tracker, idx) => {
                const imei = imeis[idx];
                const sim = simData?.statuses?.[imei];
                const company = imei ? companyByImei[imei] : undefined;
                return <TrackerCard key={tracker.id} tracker={tracker} sim={sim} company={company} />;
              })}
            </div>
          )}
        </section>

        {panicCount > 0 && alertsData?.alerts && (
          <section className="rounded-3xl border border-red-500/40 bg-red-500/10 p-4 shadow-lg shadow-red-900/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-red-200/80">
                  Alertas SOS recientes
                </p>
                <p className="text-lg font-semibold text-red-50">
                  {panicCount} evento(s) de pánico en los últimos 15 minutos
                </p>
              </div>
              <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white">
                Acción requerida
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {alertsData.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-2xl border border-red-500/40 bg-black/30 p-3 text-sm text-white/80"
                >
                  <p className="text-white font-semibold">
                    Tracker #{alert.tracker_id}
                  </p>
                  <p className="text-white/70">{alert.message || "Botón de pánico"}</p>
                  <p className="text-white/60">
                    {formatDate(alert.time)} {alert.address ? `· ${alert.address}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
