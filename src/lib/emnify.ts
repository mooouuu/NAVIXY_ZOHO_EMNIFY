import { jwtDecode } from "jwt-decode";

const appToken = process.env.EMNIFY_APP_TOKEN;
const baseUrl = process.env.EMNIFY_BASE_URL || "https://cdn.emnify.net/api/v1";

let cachedAuth: { token: string; exp: number } | null = null;

function isAuthValid() {
  if (!cachedAuth) return false;
  const now = Math.floor(Date.now() / 1000);
  return cachedAuth.exp - now > 300; // 5 min buffer
}

async function authenticate(): Promise<string> {
  if (!appToken) throw new Error("Falta EMNIFY_APP_TOKEN en .env.local");
  if (isAuthValid()) return cachedAuth!.token;
  const res = await fetch(`${baseUrl}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ application_token: appToken }),
  });
  const data = (await res.json()) as { auth_token?: string };
  if (!res.ok || !data.auth_token) {
    throw new Error("No se pudo autenticar en Emnify");
  }
  const decoded = jwtDecode<{ exp: number }>(data.auth_token);
  cachedAuth = { token: data.auth_token, exp: decoded.exp };
  return data.auth_token;
}

async function authedFetch(path: string) {
  const token = await authenticate();
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Emnify error ${res.status}: ${text}`);
  }
  return res.json();
}

export type SimStatus = {
  imei: string;
  endpointId?: number;
  sim?: {
    iccid?: string;
    status?: string;
    imsi?: string;
    msisdn?: string;
  };
  connectivity?: {
    status?: string;
    rat?: string;
    operator?: string;
    country?: string;
    lastUpdated?: string;
  };
};

async function findEndpoint(imei: string) {
  const queries = [
    `/endpoint?q=name:${imei}`,
    `/endpoint?q=imei:${imei}`,
    `/endpoint?q=${imei}`,
  ];
  for (const q of queries) {
    const endpointList = (await authedFetch(q)) as Array<Record<string, unknown>>;
    const endpoint = endpointList?.[0];
    if (endpoint) return endpoint;
  }
  return null;
}

export async function fetchSimStatusByImei(imei: string): Promise<SimStatus | null> {
  try {
    const endpoint = (await findEndpoint(imei)) as Record<string, unknown> | null;
    if (!endpoint) return null;
    const endpointId = endpoint.id as number;
    const sim = endpoint.sim as Record<string, unknown> | undefined;

    const connectivity = (await authedFetch(
      `/endpoint/${endpointId}/connectivity`
    )) as Record<string, unknown>;
    const loc = connectivity?.location;
    const rat = connectivity?.pdp_context?.rat_type?.description;
    const status = connectivity?.status?.description;
    return {
      imei,
      endpointId,
      sim: {
        iccid: sim?.iccid,
        status: sim?.status?.description,
        imsi: sim?.imsi,
        msisdn: sim?.msisdn,
      },
      connectivity: {
        status,
        rat,
        operator: loc?.operator?.name,
        country: loc?.country?.name,
        lastUpdated: loc?.last_updated,
      },
    };
  } catch {
    return null;
  }
}

export async function fetchSimStatuses(imeis: string[]): Promise<Record<string, SimStatus | null>> {
  const unique = Array.from(new Set(imeis.filter(Boolean)));
  const entries = await Promise.all(unique.map(async (imei) => [imei, await fetchSimStatusByImei(imei)] as const));
  return Object.fromEntries(entries);
}

export async function resetConnectivity(endpointId: number) {
  if (!endpointId) throw new Error("endpointId requerido");
  const token = await authenticate();
  const res = await fetch(`${baseUrl}/endpoint/${endpointId}/connectivity`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ location: null, pdp_context: null }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Emnify reset error ${res.status}: ${text}`);
  }
  return true;
}

export async function sendSms(endpointId: number, payload: string, sourceAddress?: string) {
  if (!endpointId) throw new Error("endpointId requerido");
  if (!payload) throw new Error("payload requerido");
  const token = await authenticate();
  const res = await fetch(`${baseUrl}/endpoint/${endpointId}/sms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload,
      ...(sourceAddress ? { source_address: sourceAddress } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Emnify SMS error ${res.status}: ${text}`);
  }
  return true;
}

export type SmsMessage = {
  id: number;
  payload?: string;
  timestamp?: string;
  direction?: string;
  source_address?: string | number;
  dest_address?: string | number;
};

export async function listSms(endpointId: number, limit = 5): Promise<SmsMessage[]> {
  if (!endpointId) throw new Error("endpointId requerido");
  const token = await authenticate();
  const res = await fetch(`${baseUrl}/endpoint/${endpointId}/sms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Emnify SMS list error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as SmsMessage[];
  return (data || []).slice(-limit).reverse();
}
