// iPaymu API v2 (https://docs.ipaymu.com/en/docs/signature): every request carries
// va, timestamp and signature = HMAC-SHA256("POST:" + va + ":" + sha256(body) + ":" + apiKey, apiKey).
// IPAYMU_ENV picks sandbox or production; both secrets come from the iPaymu dashboard.

export type IpaymuConfig = { base: string; va: string; apiKey: string };

const IPAYMU_API_BASE: Record<string, string> = {
  sandbox: "https://sandbox.ipaymu.com",
  production: "https://my.ipaymu.com",
};

export const ipaymuConfig = (): IpaymuConfig | null => {
  const base = IPAYMU_API_BASE[(Deno.env.get("IPAYMU_ENV") ?? "").trim().toLowerCase()];
  const va = Deno.env.get("IPAYMU_VA")?.trim();
  const apiKey = Deno.env.get("IPAYMU_API_KEY")?.trim();
  if (!base || !va || !apiKey) return null;
  return { base, va, apiKey };
};

// Names only, never values: tells the function logs which secret is missing or invalid.
export const ipaymuConfigProblems = () => [
  IPAYMU_API_BASE[(Deno.env.get("IPAYMU_ENV") ?? "").trim().toLowerCase()] ? null : "IPAYMU_ENV (sandbox/production)",
  Deno.env.get("IPAYMU_VA")?.trim() ? null : "IPAYMU_VA",
  Deno.env.get("IPAYMU_API_KEY")?.trim() ? null : "IPAYMU_API_KEY",
].filter(Boolean);

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

const jakartaTimestamp = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((all, part) => {
    if (part.type !== "literal") all[part.type] = part.value;
    return all;
  }, {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
};

export const ipaymuRequest = async (config: IpaymuConfig, path: string, payload: Record<string, unknown>) => {
  const body = JSON.stringify(payload);
  const bodyHash = toHex(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(config.apiKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = toHex(await crypto.subtle.sign(
    "HMAC", key, encoder.encode(`POST:${config.va}:${bodyHash}:${config.apiKey}`),
  ));
  const response = await fetch(`${config.base}${path}`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "va": config.va,
      "signature": signature,
      "timestamp": jakartaTimestamp(),
    },
    body,
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const data = json?.Data && typeof json.Data === "object" ? json.Data as Record<string, unknown> : null;
  const ok = response.ok && Number(json?.Status) === 200 && data !== null;
  return { response, json, data, ok };
};

// Callbacks are not trusted as such: the webhook and payment recovery re-read the
// transaction from iPaymu with the merchant's own signed request.
export type IpaymuTransaction = {
  transactionId: string;
  referenceId: string;
  amount: number;
  state: "paid" | "pending" | "expired" | "cancelled" | "unknown";
};

export const checkIpaymuTransaction = async (
  config: IpaymuConfig, transactionId: string,
): Promise<IpaymuTransaction | null> => {
  const result = await ipaymuRequest(config, "/api/v2/transaction", { transactionId: Number(transactionId) })
    .catch(() => null);
  if (!result?.ok || !result.data) return null;
  const data = result.data;
  const status = Number(data.Status);
  const description = String(data.StatusDesc ?? "");
  const state: IpaymuTransaction["state"] = status === 1 || status === 6 || /berhasil|success/i.test(description)
    ? "paid"
    : status === 0 || /pending/i.test(description) ? "pending"
    : status === -2 || /expired|kedaluwarsa/i.test(description) ? "expired"
    : status === 2 || /batal|cancel/i.test(description) ? "cancelled"
    : "unknown";
  const amount = Number(data.Amount ?? data.SubTotal ?? data.Total);
  return {
    transactionId: String(data.TransactionId ?? transactionId),
    referenceId: String(data.ReferenceId ?? ""),
    amount: Number.isFinite(amount) ? amount : 0,
    state,
  };
};
