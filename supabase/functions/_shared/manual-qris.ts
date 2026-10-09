// Manual QRIS (PAYMENT_PROVIDER=manual): the owner's static GoPay Merchant QRIS
// ("Kita Bahagia Indonesia", NMID ID1026502348109), decoded from the printed sticker.
// QRIS_STATIC_PAYLOAD may override it if the owner prints a new QRIS.
const DEFAULT_STATIC_QRIS =
  "00020101021126610014COM.GO-JEK.WWW01189360091436468736230210G6468736230303UMI51440014ID.CO.QRIS.WWW0215ID10265023481090303UMI5204581253033605802ID5922Kita Bahagia Indonesia6005DEPOK61051641762070703A016304EE55";

// CRC-16/CCITT-FALSE over the payload up to and including "6304" (EMVCo, tag 63).
const crc16 = (value: string) => {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};

type Tag = { id: string; value: string };
const parseTags = (payload: string): Tag[] | null => {
  const tags: Tag[] = [];
  let index = 0;
  while (index < payload.length) {
    const id = payload.slice(index, index + 2);
    const length = Number(payload.slice(index + 2, index + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(length)) return null;
    const value = payload.slice(index + 4, index + 4 + length);
    if (value.length !== length) return null;
    tags.push({ id, value });
    index += 4 + length;
  }
  return tags;
};
const encode = (tags: Tag[]) => tags.map(({ id, value }) => `${id}${String(value.length).padStart(2, "0")}${value}`).join("");

export const staticQrisPayload = () => {
  const payload = (Deno.env.get("QRIS_STATIC_PAYLOAD") ?? DEFAULT_STATIC_QRIS).trim();
  return payload.startsWith("000201") && crc16(payload.slice(0, -4)) === payload.slice(-4) ? payload : null;
};

// Turns the static QRIS into a single-use-style one with the amount filled in (tag 54,
// point of initiation 12), so the payer's app shows the exact unique amount.
export const qrisWithAmount = (staticPayload: string, amount: number) => {
  const tags = parseTags(staticPayload);
  if (!tags || !Number.isInteger(amount) || amount <= 0) return null;
  const kept = tags.filter((tag) => !["54", "63"].includes(tag.id))
    .map((tag) => (tag.id === "01" ? { id: "01", value: "12" } : tag));
  const at = kept.findIndex((tag) => Number(tag.id) > 54);
  kept.splice(at === -1 ? kept.length : at, 0, { id: "54", value: String(amount) });
  const body = `${encode(kept)}6304`;
  return `${body}${crc16(body)}`;
};
