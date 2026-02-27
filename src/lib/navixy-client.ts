export type NormalizedTracker = {
  id: string;
  name: string;
  status?: string;
  updatedAt?: string;
  lat?: number;
  lon?: number;
  speedKph?: number;
  ignition?: boolean;
  address?: string;
  battery?: number;
  raw?: Record<string, unknown>;
};

const navixyHash = process.env.NAVIXY_HASH;
const navixyDomain = process.env.NAVIXY_DOMAIN || "saas.navixy.com";
const baseUrl = `https://${navixyDomain}/api-v2`;

export function assertNavixyEnv() {
  if (!navixyHash) {
    throw new Error(
      "NAVIXY_HASH is missing. Add it to .env.local before calling Navixy."
    );
  }
}

async function navixyRequest<T>(path: string, payload: Record<string, unknown> = {}) {
  assertNavixyEnv();
  const res = await fetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hash: navixyHash, ...payload }),
  });
  const data = (await res.json()) as { success?: boolean; error?: string } & T;
  if (!res.ok || data.success === false) {
    throw new Error(data?.error || `Navixy error on ${path}`);
  }
  return data;
}

async function getTrackerState(trackerId: string | number) {
  return navixyRequest<Record<string, unknown>>("tracker/get_state", {
    tracker_id: trackerId,
  });
}

export async function listTrackers(): Promise<Record<string, unknown>[]> {
  const response = await navixyRequest<{ list?: Record<string, unknown>[] }>(
    "tracker/list",
    {
      include: ["last_position", "last_update", "status", "connected", "last_activity"],
    }
  );

  const list = response.list || [];

  // Complement with per-tracker state for position/status when missing
  const states = await Promise.all(
    list.map(async (item) => {
      const id = (item as Record<string, unknown>).id;
      if (id === undefined) return null;
      try {
        return await getTrackerState(id as string | number);
      } catch {
        return null;
      }
    })
  );

  return list.map((item, idx) => {
    const state = states[idx];
    if (!state) return item;
    return { ...item, state } as Record<string, unknown>;
  });
}

export type AlertEntry = {
  id: number;
  tracker_id: number;
  message: string;
  time: string;
  event?: string;
  address?: string;
  emergency?: boolean;
  location?: { lat?: number; lng?: number };
};

export async function listRecentAlerts(minutesBack = 15): Promise<AlertEntry[]> {
  const to = new Date();
  const from = new Date(to.getTime() - minutesBack * 60 * 1000);
  const payload = {
    from: from.toISOString().slice(0, 19).replace("T", " "),
    to: to.toISOString().slice(0, 19).replace("T", " "),
    only_emergency: true,
    limit: 200,
  };
  const response = await navixyRequest<{ list?: AlertEntry[] }>(
    "history/user/list",
    payload
  );
  return response.list || [];
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
}

export function normalizeTracker(raw: Record<string, unknown>): NormalizedTracker {
  const wrappedState = (raw as Record<string, unknown>).state as
    | Record<string, unknown>
    | undefined;
  const navState =
    (wrappedState?.state as Record<string, unknown> | undefined) ?? wrappedState;

  const gps = navState?.gps as Record<string, unknown> | undefined;
  const location = gps?.location as Record<string, unknown> | undefined;

  const position =
    (raw?.last_position as Record<string, unknown> | undefined) ||
    (raw?.position as Record<string, unknown> | undefined) ||
    (raw?.location as Record<string, unknown> | undefined) ||
    (raw?.last_location as Record<string, unknown> | undefined) ||
    (navState?.position as Record<string, unknown> | undefined) ||
    (location as Record<string, unknown> | undefined);

  const speedKph =
    coerceNumber(gps?.speed) ||
    coerceNumber(gps?.speed_kph) ||
    coerceNumber(position?.speed) ||
    coerceNumber(position?.speed_kph);

  const ignition =
    (navState?.engine_on as boolean | undefined) ??
    (navState?.ignition as boolean | undefined);

  const battery =
    coerceNumber(navState?.battery_level) || coerceNumber(navState?.battery);

  const address =
    (navState?.address as string | undefined) ||
    (position?.address as string | undefined);

  return {
    id:
      String(
        raw?.id ?? raw?.tracker_id ?? raw?.device_id ?? raw?.unique_id ?? "unknown"
      ),
    name:
      (raw?.label as string | undefined) ||
      (raw?.name as string | undefined) ||
      (raw?.unique_id as string | undefined) ||
      "Sin nombre",
    status:
      (navState?.connection_status as string | undefined) ||
      (navState?.movement_status as string | undefined) ||
      (navState?.status as string | undefined) ||
      (raw?.status as string | undefined) ||
      ((raw?.connected as boolean | undefined) ? "online" : undefined),
    updatedAt:
      (gps?.updated as string | undefined) ||
      (navState?.last_update as string | undefined) ||
      (position?.gps_date as string | undefined) ||
      (position?.server_date as string | undefined) ||
      (raw?.last_update as string | undefined) ||
      (raw?.updated_at as string | undefined) ||
      (raw?.last_activity as string | undefined),
    lat:
      coerceNumber(location?.lat) ||
      coerceNumber(position?.lat) ||
      coerceNumber(position?.latitude) ||
      coerceNumber(position?.lat_deg) ||
      coerceNumber(position?.y),
    lon:
      coerceNumber(location?.lng) ||
      coerceNumber(location?.lon) ||
      coerceNumber(position?.lon) ||
      coerceNumber(position?.longitude) ||
      coerceNumber(position?.lng) ||
      coerceNumber(position?.x),
    speedKph,
    ignition,
    battery,
    address,
    raw,
  };
}

export function navixyMeta() {
  return {
    domain: navixyDomain,
    hasHash: Boolean(navixyHash),
  };
}
