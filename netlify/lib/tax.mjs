// BIR tax calendar for a self-employed individual / professional (non-VAT, gross sales ≤ ₱3M).
// Rules (NIRC as amended by TRAIN Law and the Ease of Paying Taxes Act, RA 11976):
//  • 1701Q quarterly income tax: May 15 (Q1), Aug 15 (Q2), Nov 15 (Q3). No Q4 quarterly.
//  • 1701A annual income tax: April 15 of the following year (covers the whole year).
//  • 2551Q 3% percentage tax: only on graduated rates, within 25 days after each quarter.
//    The 8% option replaces both graduated income tax and percentage tax, so 8% filers skip it.
//  • 8% option: choose it on the first quarterly return of the year (or on Form 1901 when registering).
//  • The ₱500 annual registration fee was abolished (no more January 0605 payment).
//  • A deadline on a Saturday/Sunday moves to the next working day. Holidays and BIR extensions
//    are not built in: always check bir.gov.ph near the date.
import { crmStore, sendMail, OWNER } from "./core.mjs";

const KEY = "settings/tax";
const iso = (d) => d.toISOString().slice(0, 10);
const workday = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); while ([0, 6].includes(t.getUTCDay())) t.setUTCDate(t.getUTCDate() + 1); return iso(t); };

export async function getTax(store = crmStore()) {
  const t = (await store.get(KEY, { type: "json" })) || {};
  return { registered: !!t.registered, since: t.since || "", regime: t.regime === "graduated" ? "graduated" : "8%", filed: t.filed || {}, remind: t.remind !== false };
}
export async function saveTax(body, store = crmStore()) {
  const cur = await getTax(store);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(body.since || "") ? body.since : cur.since;
  const next = { ...cur, registered: body.registered === undefined ? cur.registered : !!body.registered, since,
    regime: body.regime === "graduated" ? "graduated" : body.regime === "8%" ? "8%" : cur.regime, remind: body.remind === undefined ? cur.remind : !!body.remind };
  if (body.filed && typeof body.filed === "object") {
    for (const [k, v] of Object.entries(body.filed).slice(0, 20)) if (/^\d{4}-[a-z0-9-]{2,12}$/.test(k)) { if (v) next.filed[k] = new Date().toISOString().slice(0, 10); else delete next.filed[k]; }
  }
  await store.setJSON(KEY, next);
  return next;
}

// Every filing for income earned in `year` (the annual return falls in year+1).
export function deadlines(year, regime) {
  const list = [
    { id: `${year}-q1`, form: "1701Q", title: `Quarterly income tax, Q1 ${year} (Jan–Mar)`, due: workday(year, 5, 15), note: regime === "8%" ? "Choose the 8% option on this return if you haven't yet." : "" },
    { id: `${year}-q2`, form: "1701Q", title: `Quarterly income tax, Q2 ${year} (Apr–Jun)`, due: workday(year, 8, 15) },
    { id: `${year}-q3`, form: "1701Q", title: `Quarterly income tax, Q3 ${year} (Jul–Sep)`, due: workday(year, 11, 15) },
    { id: `${year}-annual`, form: "1701A", title: `Annual income tax for ${year} (covers Q4 too)`, due: workday(year + 1, 4, 15) },
  ];
  if (regime === "graduated") [[1, 4, 25], [2, 7, 25], [3, 10, 25], [4, 1, 25]].forEach(([q, m, d]) =>
    list.push({ id: `${year}-pt${q}`, form: "2551Q", title: `3% percentage tax, Q${q} ${year}`, due: workday(q === 4 ? year + 1 : year, m, d) }));
  return list.sort((a, b) => a.due.localeCompare(b.due));
}
// Upcoming filings that apply (only from the month you registered).
export function upcoming(t, today) {
  const y = Number(today.slice(0, 4));
  return [...deadlines(y - 1, t.regime), ...deadlines(y, t.regime)]
    .filter((d) => d.due >= today && !t.filed[d.id])
    .filter((d) => !t.since || d.due >= t.since);
}

// Daily job (9 AM Philippine time): email + phone alert 7 days and 1 day before each deadline, and on the day.
export async function runTaxReminders({ store = crmStore(), now = new Date() } = {}) {
  const t = await getTax(store);
  if (!t.registered || !t.remind) return { skipped: "not registered or reminders off" };
  const today = new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
  const days = (d) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
  const due = upcoming(t, today).filter((d) => [7, 1, 0].includes(days(d.due)));
  if (!due.length) return { count: 0 };
  const when = (n) => (n === 0 ? "TODAY" : n === 1 ? "tomorrow" : `in ${n} days`);
  const nice = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
  const items = due.map((d) => `<li style="margin:0 0 10px"><b>BIR Form ${d.form}</b>: ${d.title}<br>Due <b>${nice(d.due)}</b> (${when(days(d.due))})${d.note ? `<br><i>${d.note}</i>` : ""}</li>`).join("");
  const site = OWNER.site ? OWNER.site() : "";
  try {
    await sendMail({ to: OWNER.email(), subject: `🧾 BIR reminder: ${due[0].form} due ${when(days(due[0].due))}`, html:
      `<div style="font:15px/1.6 Arial,sans-serif;color:#231E1B;max-width:560px"><h2 style="font-family:Georgia,serif;font-weight:normal">BIR filing reminder</h2><ul style="padding-left:18px">${items}</ul>` +
      `<p>File and pay online through the BIR's eBIRForms or an accredited payment channel (GCash, Maya, banks). File even if you owe ₱0.</p>` +
      `<p>Your income records and estimate: <a href="${site}/admin.html#income">open your CRM</a>. When done, tick <b>Filed</b> there so the reminders stop.</p>` +
      `<p style="font-size:13px;color:#6E625A">Deadlines follow the usual BIR schedule. The BIR sometimes moves dates (holidays, extensions), so check bir.gov.ph. This is a reminder, not tax advice.</p></div>` });
  } catch (e) { console.log("tax email:", e.message); }
  try { const { sendPush } = await import("./push.mjs"); await sendPush({ title: `🧾 BIR ${due[0].form} due ${when(days(due[0].due))}`, body: due[0].title, url: "/admin.html#income", tag: "tax-" + due[0].id }, store); } catch (e) { console.log("tax push:", e.message); }
  return { count: due.length };
}
