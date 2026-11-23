// Phone/computer notifications for Jeselle (Web Push). Keys are created once and kept in the private "crm" store.
import webpush from "web-push";
import { crmStore, OWNER } from "./core.mjs";

const VAPID = "settings/vapid";
const SUBS = "settings/push-subs";

export async function vapidKeys(store = crmStore()) {
  let k = await store.get(VAPID, { type: "json" });
  if (!k?.publicKey) { k = await webpush.generateVAPIDKeys(); await store.setJSON(VAPID, k); }
  return k;
}
export async function listSubs(store = crmStore()) { return (await store.get(SUBS, { type: "json" })) || []; }
export async function addSub(sub, label, store = crmStore(), who = "owner") {
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Bad subscription");
  const subs = (await listSubs(store)).filter((s) => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, label: String(label || "").slice(0, 80), who: String(who || "owner").slice(0, 20), at: new Date().toISOString() });
  await store.setJSON(SUBS, subs.slice(-30));
  return subs.length;
}
export async function removeSub(endpoint, store = crmStore()) {
  const subs = (await listSubs(store)).filter((s) => s.endpoint !== endpoint);
  await store.setJSON(SUBS, subs);
  return subs.length;
}
// payload: { title, body, url, tag, perm }. perm = what a team member needs to get this alert
// ("bookings", "payments" or "reviews"); the owner's devices always get every alert.
export async function sendPush(payload, store = crmStore()) {
  try {
    const all = await listSubs(store);
    let subs = all;
    if (all.some((s) => s.who && s.who !== "owner")) {
      const { listTeam } = await import("./team.mjs");
      const team = await listTeam(store);
      const ok = (s) => !s.who || s.who === "owner" || team.some((m) => m.id === s.who && m.active !== false && m.pwHash && (!payload.perm || (m.perms || []).includes(payload.perm)));
      subs = all.filter(ok);
    }
    const { perm, ...msg } = payload; payload = msg;
    if (!subs.length) return { sent: 0 };
    const k = await vapidKeys(store);
    webpush.setVapidDetails("mailto:" + OWNER.email(), k.publicKey, k.privateKey);
    let sent = 0; const dead = [], errors = [];
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 86400, urgency: "high" }); sent++; }
      catch (e) { errors.push((new URL(s.endpoint).host) + ": " + (e.statusCode || "") + " " + String(e.body || e.message || "").slice(0, 160)); if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); }
    }));
    if (dead.length) await store.setJSON(SUBS, all.filter((s) => !dead.includes(s.endpoint)));
    return { sent, devices: subs.length, errors };
  } catch (e) { return { error: e.message }; }
}
