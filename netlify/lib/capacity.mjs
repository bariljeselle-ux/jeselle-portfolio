// Capacity: how many projects Jeselle can run at once, and the earliest start / delivery date for a new client.
// A record counts as an active project when it has a delivery date and isn't Delivered, Lost or Cancelled.
// Settings (owner, in the CRM): maxProjects, minDays (shortest delivery time in working days, Mon–Fri), paused.
import { crmStore } from "./core.mjs";

const KEY = "settings/capacity";
export const DEFAULTS = { maxProjects: 3, minDays: 7, paused: false };
const DONE = /deliver|lost|cancel/i;
const TZ = "Asia/Manila";
export const phDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));

export async function getSettings(store = crmStore()) { return { ...DEFAULTS, ...((await store.get(KEY, { type: "json" })) || {}) }; }
export async function saveSettings(input, store = crmStore()) {
  const n = (v, lo, hi, d) => { const x = Math.round(Number(v)); return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  const s = { maxProjects: n(input.maxProjects, 1, 50, DEFAULTS.maxProjects), minDays: n(input.minDays, 1, 90, DEFAULTS.minDays), paused: input.paused === true, at: new Date().toISOString() };
  await store.setJSON(KEY, s);
  return s;
}

// Add working days (Mon–Fri) to a YYYY-MM-DD date
export function addWorkdays(day, n) {
  const d = new Date(day + "T00:00:00Z");
  let left = n;
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return d.toISOString().slice(0, 10);
}
const nextWorkday = (day) => { const d = new Date(day + "T00:00:00Z"); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

export const isActiveProject = (r) => !!(r && /^\d{4}-\d{2}-\d{2}$/.test(r.delivery || "") && r.type !== "Payment" && !DONE.test(r.status || ""));

// records: all CRM records (bookings, inquiries, briefs…). Returns what the owner and new clients should know.
export function computeCapacity(records, settings, today = phDay()) {
  const s = { ...DEFAULTS, ...settings };
  const active = records.filter(isActiveProject).sort((a, b) => a.delivery.localeCompare(b.delivery));
  const taken = active.length, slotsOpen = Math.max(0, s.maxProjects - taken);
  // A spot frees up the working day after a project's delivery date
  let start = addWorkdays(today, 1); // a new project starts the next working day
  if (taken >= s.maxProjects) { const freeAfter = active[taken - s.maxProjects].delivery; start = nextWorkday(addWorkdays(freeAfter < today ? today : freeAfter, 1)); }
  const earliestStart = s.paused ? null : start;
  const earliestDelivery = s.paused ? null : addWorkdays(start, s.minDays - 1);
  const full = s.paused || taken >= s.maxProjects;
  return { full, paused: s.paused, taken, max: s.maxProjects, slotsOpen, minDays: s.minDays, earliestStart, earliestDelivery,
    nextDue: active.slice(0, 5).map((r) => ({ key: r.key, name: r.data?.name || "", business: r.data?.business || "", delivery: r.delivery, status: r.status })) };
}
// What visitors may see (no client names)
export const publicCapacity = (c) => ({ full: c.full, paused: c.paused, slotsOpen: c.full ? 0 : c.slotsOpen, earliestStart: c.earliestStart, earliestDelivery: c.earliestDelivery, minDays: c.minDays });

export async function loadCapacity(store = crmStore()) {
  const { blobs } = await store.list();
  const recs = [];
  for (const b of blobs) {
    if (/^(settings|income|expense)\//.test(b.key)) continue;
    const r = await store.get(b.key, { type: "json" });
    if (r) recs.push(r);
  }
  return computeCapacity(recs, await getSettings(store));
}

// Turn what a client typed into a date if we can ("2026-12-15", "Dec 15", "12/15/2026"); otherwise ""
export function parseWanted(data, today = phDay()) {
  const raw = String(data?.deadline || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw) { const t = Date.parse(raw + (/\d{4}/.test(raw) ? "" : " " + today.slice(0, 4))); if (!isNaN(t)) { let d = phDay(t); if (d < today) d = phDay(new Date(t).setFullYear(new Date(t).getFullYear() + 1)); return d; } }
  const tl = String(data?.timeline || "");
  if (/as soon/i.test(tl)) return today;
  if (/2 weeks/i.test(tl)) return addWorkdays(today, 10);
  if (/within a month/i.test(tl)) return addWorkdays(today, 21);
  return "";
}
// For a new brief: can she make the date they asked for?
export function checkRequest(data, cap) {
  const wanted = parseWanted(data);
  if (cap.paused) return { wanted, tooSoon: !!wanted, full: true, earliestStart: null, earliestDelivery: null };
  return { wanted, full: cap.full, earliestStart: cap.earliestStart, earliestDelivery: cap.earliestDelivery, tooSoon: !!wanted && wanted < cap.earliestDelivery };
}

// ---------- Monthly check-in (1st of the month, 9 AM PH): open spots, deliveries due, waitlist ----------
export async function runMonthlyCheckin({ store = crmStore(), now = new Date() } = {}) {
  const { sendMail, layout, OWNER } = await import("./core.mjs");
  const { blobs } = await store.list();
  const recs = [];
  for (const b of blobs) { if (/^(settings|income|expense)\//.test(b.key)) continue; const r = await store.get(b.key, { type: "json" }); if (r) recs.push(r); }
  const settings = await getSettings(store), cap = computeCapacity(recs, settings, phDay(now));
  const month = phDay(now).slice(0, 7);
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nice = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const who = (r) => esc((r.data && (r.data.business || r.data.name)) || "A client");
  const active = recs.filter(isActiveProject).sort((a, b) => a.delivery.localeCompare(b.delivery));
  const dueNow = active.filter((r) => r.delivery.slice(0, 7) <= month);
  const wait = recs.filter((r) => r.status === "Waitlist").sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const P = (t) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${t}</p>`;
  const L = (items) => items.length ? `<ul style="margin:0 0 14px;padding-left:18px;font-size:15px;line-height:1.7">${items.join("")}</ul>` : "";
  const head = cap.paused ? "⏸️ New projects are <b>paused</b>." : cap.full ? `🔴 You're <b>fully booked</b> (${cap.taken} of ${cap.max} spots). Next spot opens <b>${nice(cap.earliestStart)}</b>.` : `🟢 <b>${cap.slotsOpen} of ${cap.max} project spot${cap.max > 1 ? "s" : ""} open.</b> You can take ${cap.slotsOpen === 1 ? "1 new client" : cap.slotsOpen + " new clients"} now.`;
  const html = layout("Your monthly check-in",
    P(head) +
    (dueNow.length ? P("<b>📦 Due this month</b>") + L(dueNow.map((r) => `<li>${nice(r.delivery)} · ${who(r)} <span style="color:#6E625A">(${esc(r.status)})</span></li>`)) : P("📦 No deliveries due this month.")) +
    (wait.length ? P(`<b>🗓️ On your waitlist (${wait.length})</b>`) + L(wait.slice(0, 10).map((r) => `<li>${who(r)} <span style="color:#6E625A">· waiting since ${nice(phDay(r.createdAt))}</span></li>`)) + (cap.full ? "" : P("👉 You have an open spot: contact the first person on your waitlist.")) : "") +
    P(`New clients currently see: earliest start <b>${nice(cap.earliestStart) || "paused"}</b>, earliest delivery <b>${nice(cap.earliestDelivery) || "paused"}</b>. Change your limit in CRM → ⚙️ Capacity settings.`) +
    P(`<a href="${OWNER.site()}/admin.html" style="color:#7A4E3A">Open your CRM →</a>`));
  const last = await store.get("settings/checkin-sent", { type: "json" });
  if (last?.month === month) return { skipped: "already sent this month" };
  await sendMail({ to: OWNER.email(), subject: `🗓️ Monthly check-in: ${cap.full ? "fully booked" : cap.slotsOpen + " spot" + (cap.slotsOpen === 1 ? "" : "s") + " open"}${wait.length ? `, ${wait.length} waiting` : ""}`, html });
  await store.setJSON("settings/checkin-sent", { month, at: new Date().toISOString() });
  return { sent: true, open: cap.slotsOpen, waiting: wait.length, due: dueNow.length };
}
