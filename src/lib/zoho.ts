const clientId = process.env.ZOHO_CLIENT_ID;
const clientSecret = process.env.ZOHO_CLIENT_SECRET;
const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
const zohoBase = process.env.ZOHO_BASE_URL || "https://www.zohoapis.com/crm/v3";

let cachedAccess: { token: string; exp: number } | null = null;

function assertZohoEnv() {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Faltan ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN en .env.local");
  }
}

async function getAccessToken(): Promise<string> {
  assertZohoEnv();
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.exp - now > 300) return cachedAccess.token;

  const params = new URLSearchParams();
  params.append("refresh_token", refreshToken!);
  params.append("client_id", clientId!);
  params.append("client_secret", clientSecret!);
  params.append("grant_type", "refresh_token");

  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`No se pudo obtener access token de Zoho: ${text}`);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error(`No se pudo obtener access token de Zoho (sin access_token en respuesta): ${text}`);
  }
  const exp = Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600);
  cachedAccess = { token: json.access_token, exp };
  return json.access_token;
}

async function zohoFetch(path: string, query: Record<string, string> = {}) {
  const token = await getAccessToken();
  const url = new URL(`${zohoBase}${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoho error ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

type ZohoRow = Record<string, unknown>;

async function fetchModule(module: string, fields: string[]): Promise<ZohoRow[]> {
  let page = 1;
  const perPage = 200;
  const rows: ZohoRow[] = [];
  while (true) {
    const data = await zohoFetch(`/${module}`, {
      fields: fields.join(","),
      page: String(page),
      per_page: String(perPage),
    });
    const items = (data?.data as ZohoRow[]) || [];
    rows.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }
  return rows;
}

export type ZohoCompany = { id: string; name: string };
export type ZohoDevice = {
  id: string;
  name?: string;
  imei?: string;
  simLookupId?: string;
  companyId?: string;
};
export type ZohoSim = {
  id: string;
  name?: string;
  iccid?: string;
  type?: string;
};
export type ZohoContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  mobile?: string;
  phone?: string;
  companyId?: string;
};

export type ZohoData = {
  companies: ZohoCompany[];
  devices: ZohoDevice[];
  sims: ZohoSim[];
  contacts: ZohoContact[];
};

export async function fetchZohoData(): Promise<ZohoData> {
  const companiesRaw = await fetchModule("Accounts", ["Account_Name"]);
  const simsRaw = await fetchModule("ControlSIM", ["Name", "Inventario_SIM", "Tipo_de_SIM"]);
  // ControlGPS en tu cuenta es el módulo API_name \"GPS\"
  const devicesRaw = await fetchModule("GPS", ["Name", "IMEI_del_dispositivo", "Inventario_SIM", "Cliente"]);
  const contactsRaw = await fetchModule("Contacts", ["First_Name", "Last_Name", "Mobile", "Phone", "Account_Name"]);

  const companies: ZohoCompany[] = companiesRaw.map((c: ZohoRow) => ({
    id: c.id as string,
    name: c.Account_Name as string,
  }));

  const sims: ZohoSim[] = simsRaw.map((s: ZohoRow) => ({
    id: s.id as string,
    name: s.Name as string | undefined,
    iccid: s.Inventario_SIM as string | undefined,
    type: s.Tipo_de_SIM as string | undefined,
  }));

  const devices: ZohoDevice[] = devicesRaw.map((d: ZohoRow) => ({
    id: d.id as string,
    name: d.Name as string | undefined,
    imei:
      (d.IMEI_del_dispositivo as string | undefined)?.trim() ||
      (d.Name as string | undefined)?.trim(),
    simLookupId: (d.Inventario_SIM as ZohoRow | undefined)?.id as string | undefined,
    companyId: (d.Cliente as ZohoRow | undefined)?.id as string | undefined,
  }));

  const contacts: ZohoContact[] = contactsRaw.map((c: ZohoRow) => ({
    id: c.id as string,
    firstName: c.First_Name as string | undefined,
    lastName: c.Last_Name as string | undefined,
    mobile: c.Mobile as string | undefined,
    phone: c.Phone as string | undefined,
    companyId: (c.Account_Name as ZohoRow | undefined)?.id as string | undefined,
  }));

  return { companies, devices, sims, contacts };
}
