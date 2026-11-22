// Admin password check + "Change password" for the CRM.
// The owner can set her own password in admin.html. It's stored scrambled (PBKDF2) in the CRM store.
// Backup: changing ADMIN_PASSWORD in the hosting settings takes over again (emergency reset).
import { crmStore } from "./core.mjs";

const PW_KEY = "settings/admin-password";
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (t) => hex(await subtle().digest("SHA-256", enc.encode(String(t))));
async function pbkdf2(pw, saltHex) {
  const key = await subtle().importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function checkAdminKey(given, store = crmStore()) {
  const env = process.env.ADMIN_PASSWORD || "";
  if (!given || !env) return false;
  const saved = await store.get(PW_KEY, { type: "json" });
  if (saved && saved.envHash === (await sha(env))) return same(await pbkdf2(given, saved.salt), saved.hash);
  return same(await sha(given), await sha(env));
}
export const isAdminReq = (req) => checkAdminKey(req.headers.get("x-admin-key") || "");

export async function changeAdminPassword(current, next, store = crmStore()) {
  if (!(await checkAdminKey(String(current || ""), store))) return { status: 401, error: "Your current password is not correct." };
  next = String(next || "");
  if (next.length < 8) return { status: 400, error: "Use at least 8 characters." };
  if (next.length > 200) return { status: 400, error: "That password is too long." };
  const salt = hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  await store.setJSON(PW_KEY, { salt, hash: await pbkdf2(next, salt), envHash: await sha(process.env.ADMIN_PASSWORD || ""), at: new Date().toISOString() });
  return { ok: true };
}
