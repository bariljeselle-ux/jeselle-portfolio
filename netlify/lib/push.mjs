// Phone/computer notifications for Jeselle (Web Push). Keys are created once and kept in the private "crm" store.
import webpush from "web-push";
import { crmStore, OWNER } from "./core.mjs";

const VAPID = "settings/vapid";
const SUBS = "settings/push-subs";

export async function vapidKeys(store = crmStore()) {
  let k = await store.get(VAPID, { type: "json" });
  if (!k?.publicKey) { k = webpush.generateVAPIDKeys(); await store.setJSON(VAPID, k); }
  return k;
}
export async function listSubs(store = crmStore()) { return (await store.get(SUBS, { type: "json" })) || []; }
export async function addSub(sub, label, store = crmStore()) {
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Bad subscription");
  const subs = (await listSubs(store)).filter((s) => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, label: String(label || "").slice(0, 80), at: new Date().toISOString() });
  await store.setJSON(SUBS, subs.slice(-10));
  return subs.length;
}
export async function removeSub(endpoint, store = crmStore()) {
  const subs = (await listSubs(store)).filter((s) => s.endpoint !== endpoint);
  await store.setJSON(SUBS, subs);
  return subs.length;
}
// payload: { title, body, url, tag }
export async function sendPush(payload, store = crmStore()) {
  try {
    const subs = await listSubs(store);
    if (!subs.length) return { sent: 0 };
    const k = await vapidKeys(store);
    webpush.setVapidDetails("mailto:" + OWNER.email(), k.publicKey, k.privateKey);
    let sent = 0; const dead = [];
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 86400, urgency: "high" }); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); }
    }));
    if (dead.length) await store.setJSON(SUBS, subs.filter((s) => !dead.includes(s.endpoint)));
    return { sent };
  } catch (e) { return { error: e.message }; }
}
