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

// ---------- Forgot password: a one-time reset link (30 minutes) emailed to the owner only ----------
const RESET_KEY = "settings/password-reset";
async function savePassword(next, store) {
  const salt = hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  await store.setJSON(PW_KEY, { salt, hash: await pbkdf2(next, salt), envHash: await sha(process.env.ADMIN_PASSWORD || ""), at: new Date().toISOString() });
}
export async function requestPasswordReset(store = crmStore()) {
  const { OWNER, sendMail, layout } = await import("./core.mjs");
  const last = await store.get(RESET_KEY, { type: "json" });
  if (last && Date.now() - (last.sentAt || 0) < 2 * 60000) return { ok: true }; // at most one email every 2 minutes
  const token = hex(globalThis.crypto.getRandomValues(new Uint8Array(24)));
  await store.setJSON(RESET_KEY, { hash: await sha(token), exp: Date.now() + 30 * 60000, sentAt: Date.now() });
  const link = `${OWNER.site()}/admin.html#reset=${token}`;
  if (process.env.MAIL_TEST === "1") console.log("RESET LINK", link);
  await sendMail({ to: OWNER.email(), subject: "🔑 Reset your CRM password",
    html: layout("Reset your password", `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">Someone (hopefully you) asked to reset the password for your private CRM. Tap the button to choose a new one. The link works once and expires in 30 minutes.</p><a href="${link}" style="display:inline-block;background:#7A4E3A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px;font-size:14px">Choose a new password</a><p style="margin:16px 0 0;font-size:13px;color:#6E625A">Didn't ask for this? Ignore this email. Your password stays the same.</p>`) });
  return { ok: true };
}
export async function resetPasswordWithToken(token, next, store = crmStore()) {
  const r = await store.get(RESET_KEY, { type: "json" });
  if (!r || !r.hash || Date.now() > r.exp || !same(await sha(String(token || "")), r.hash)) return { status: 400, error: "This reset link has expired or was already used. Tap \"Forgot password?\" again." };
  next = String(next || "");
  if (next.length < 8) return { status: 400, error: "Use at least 8 characters." };
  if (next.length > 200) return { status: 400, error: "That password is too long." };
  await savePassword(next, store);
  await store.setJSON(RESET_KEY, { used: true, sentAt: r.sentAt });
  return { ok: true };
}
