// Private CRM API for admin.html. The owner logs in with her password (ADMIN_PASSWORD or the one she set);
// team members log in with their own email + password and only see what the owner allowed (see lib/team.mjs).
import { changeAdminPassword, requestPasswordReset, resetPasswordWithToken } from "../lib/auth.mjs";
import { actorFor, can, permForRecord, logActivity, listActivity, listTeam, publicMember, staffLogin, acceptInvite, staffChangePassword, saveMember, resendInvite, removeMember, logoutStaff, assignable, PERMS } from "../lib/team.mjs";
import { crmStore, sendMail, OWNER, bookingEmails, roomLink } from "../lib/core.mjs";
import { getSettings as capSettings, saveSettings as capSave, computeCapacity } from "../lib/capacity.mjs";
import { googleStatus, authUrl, disconnect, createMeet, cancelMeet, createSpace, addGuest } from "../lib/google.mjs";
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
const receiptStore = () => getStore({ name: "receipts", consistency: "strong" });
const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX_RECEIPT = 4 * 1024 * 1024;
const recKeyOk = (k) => /^(income|expense)\/[0-9]{8}-[0-9a-f]{8}$/.test(k);

const NO = () => Response.json({ error: "You don't have access to this. Ask the owner." }, { status: 403 });
const who = (rec) => rec?.data?.name || rec?.data?.email || "a client";
const csvCell = (v) => { let t = String(v ?? ""); if (/^[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };

// Expense entry: what you spent for your business, in pesos.
export const EXPENSE_CATEGORIES = ["Electricity (work share)", "Internet & mobile load", "Devices & equipment", "Software & subscriptions", "Domain & hosting", "Courses & training", "Transfer & payment fees", "Advertising & promotion", "Office supplies", "Repairs & maintenance", "Workspace rent (work share)", "Transportation & delivery", "Professional fees", "Government & registration fees", "Other"];
export function cleanExpense(e) {
  const s = (v, n) => String(v ?? "").trim().slice(0, n);
  const date = s(e.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date))) return { error: "Pick the date you paid." };
  const description = s(e.description, 200);
  if (!description) return { error: "Type what you paid for." };
  const n = Number(String(e.php ?? "").replace(/[^0-9.]/g, ""));
  const php = isFinite(n) ? Math.round(n * 100) / 100 : 0;
  if (!(php > 0)) return { error: "Type how much you paid in pesos (₱)." };
  const cat = e.category === "Equipment & gadgets" ? "Devices & equipment" : e.category;
  const category = EXPENSE_CATEGORIES.includes(cat) ? cat : "Other";
  const n2 = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  const bill = n2(e.bill);
  const workpct = Math.min(100, Math.max(0, Math.round(n2(e.workpct))));
  return { date, category, description, vendor: s(e.vendor, 120), php, bill: bill || null, workpct: workpct || null, method: s(e.method, 40), receipt: e.receipt === true || e.receipt === "on" || e.receipt === "yes", notes: s(e.notes, 500) };
}

// Income entry: what you actually received, in pesos, for your records and BIR.
export function cleanIncome(e) {
  const s = (v, n) => String(v ?? "").trim().slice(0, n);
  const date = s(e.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date))) return { error: "Pick the date you received the payment." };
  const client = s(e.client, 120);
  if (!client) return { error: "Type the client's name." };
  const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  const php = num(e.php);
  if (!(php > 0)) return { error: "Type how much you received in pesos (₱)." };
  const currency = ["PHP", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "Other"].includes(e.currency) ? e.currency : "PHP";
  return { date, client, service: s(e.service, 80), description: s(e.description, 200), amount: num(e.amount) || (currency === "PHP" ? php : 0), currency, php, method: s(e.method, 40), reference: s(e.reference, 80), invoice: s(e.invoice, 40), notes: s(e.notes, 500), sourceKey: s(e.sourceKey, 120) };
}

export default async (req) => {
  if (!process.env.ADMIN_PASSWORD) return Response.json({ error: "Set ADMIN_PASSWORD in your website settings first." }, { status: 503 });
  {
    const u = new URL(req.url);
    if (req.method === "POST" && u.searchParams.get("forgot")) { try { await requestPasswordReset(); } catch (e) { console.log("reset email:", e.message); } return Response.json({ ok: true }); }
    if (req.method === "POST" && u.searchParams.get("reset")) {
      let b; try { b = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
      const r = await resetPasswordWithToken(b.token, b.next);
      return Response.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : r.status });
    }
    // Team members: log in with email + password, or accept an invite (choose a password)
    if (req.method === "POST" && (u.searchParams.get("login") || u.searchParams.get("invite"))) {
      let b; try { b = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
      const r = u.searchParams.get("login") ? await staffLogin(b.email, b.password) : await acceptInvite(b.token, b.next);
      return Response.json(r.ok ? { ok: true, token: r.token, name: r.name } : { error: r.error }, { status: r.ok ? 200 : r.status });
    }
  }
  const me = await actorFor(req);
  if (!me) return Response.json({ error: "Wrong password" }, { status: 401 });
  const owner = me.role === "owner";
  const store = crmStore();
  const url = new URL(req.url);

  if (req.method === "POST") {
    const body = await req.json();
    if (body.action === "logout") { await logoutStaff(req); return Response.json({ ok: true }); }
    if (body.action === "change-password") {
      const r = owner ? await changeAdminPassword(body.current, body.next) : await staffChangePassword(me, body.current, body.next);
      return Response.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : r.status });
    }
    // ----- Team accounts (owner only) -----
    if (/^team-|^activity$/.test(body.action || "")) {
      if (!owner) return NO();
      if (body.action === "activity") return Response.json({ activity: await listActivity(store) });
      if (body.action === "team-list") return Response.json({ team: (await listTeam(store)).map(publicMember), perms: PERMS });
      const r = body.action === "team-save" ? await saveMember(me, body.member || {}, store)
        : body.action === "team-resend" ? await resendInvite(me, String(body.id || ""), store)
        : body.action === "team-remove" ? await removeMember(me, String(body.id || ""), store)
        : { status: 400, error: "Unknown action" };
      return Response.json(r.ok ? r : { error: r.error }, { status: r.ok ? 200 : r.status });
    }
    if (["test-email", "google-connect", "google-disconnect", "capacity-save"].includes(body.action) && !owner) return NO();
    if (body.action === "capacity-save") { const c = await capSave(body.settings || {}, store); await logActivity(me, `set capacity: ${c.maxProjects} projects at once, ${c.minDays} working days minimum${c.paused ? ", paused new projects" : ""}`, "", store); return Response.json({ ok: true, settings: c }); }
    if (/^(receipt-|income-|expense-)/.test(body.action || "") && !can(me, "payments")) return NO();
    if (body.action === "test-email") {
      await sendMail({ to: OWNER.email(), subject: "✅ Test email from your website CRM", html: "<p>Your website can send emails. Bookings, reminders and inquiries will arrive here.</p>" });
      return Response.json({ ok: true });
    }
    if (body.action === "google-status") return Response.json(await googleStatus(store));
    if (body.action === "google-connect") {
      try { return Response.json({ url: await authUrl(store) }); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
    }
    if (body.action === "google-disconnect") { await disconnect(store); return Response.json({ ok: true }); }
    // ----- Income records (for your own books and BIR) -----
    if (body.action === "push-key") { const { vapidKeys, listSubs } = await import("../lib/push.mjs"); const k = await vapidKeys(store); return Response.json({ publicKey: k.publicKey, devices: (await listSubs(store)).length }); }
    if (body.action === "push-subscribe") { const { addSub } = await import("../lib/push.mjs"); try { const n = await addSub(body.sub, (owner ? "" : me.name + " · ") + String(body.label || ""), store, me.id); return Response.json({ ok: true, devices: n }); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); } }
    if (body.action === "push-unsubscribe") { const { removeSub } = await import("../lib/push.mjs"); return Response.json({ ok: true, devices: await removeSub(String(body.endpoint || ""), store) }); }
    if (body.action === "push-test") { const { sendPush } = await import("../lib/push.mjs"); const r = await sendPush({ title: "🔔 Notifications are on", body: "You'll get an alert here for every booking, inquiry, brief, payment and review.", url: "/admin.html", tag: "test" }, store); return Response.json({ ok: true, ...r }); }
    if (body.action === "receipt-upload") {
      const key = String(body.key || "");
      if (!recKeyOk(key)) return Response.json({ error: "Save the entry first." }, { status: 400 });
      const rec = await store.get(key, { type: "json" });
      if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
      const type = String(body.type || "");
      if (!RECEIPT_TYPES.includes(type)) return Response.json({ error: "Attach a photo, screenshot or PDF." }, { status: 400 });
      let buf;
      try { buf = Buffer.from(String(body.data || ""), "base64"); } catch { return Response.json({ error: "Could not read the file." }, { status: 400 }); }
      if (!buf.length) return Response.json({ error: "The file is empty." }, { status: 400 });
      if (buf.length > MAX_RECEIPT) return Response.json({ error: "That file is over 4 MB. Please attach a smaller screenshot or PDF." }, { status: 400 });
      const files = Array.isArray(rec.files) ? rec.files : [];
      if (files.length >= 10) return Response.json({ error: "Up to 10 attachments per entry." }, { status: 400 });
      const id = crypto.randomBytes(6).toString("hex");
      const name = String(body.name || "receipt").replace(/[^\w .()\-]/g, "_").slice(0, 80) || "receipt";
      await receiptStore().set(key + "/" + id, buf, { metadata: { type, name } });
      rec.files = [...files, { id, name, type, size: buf.length, at: new Date().toISOString() }];
      if (key.startsWith("expense/")) rec.receipt = true;
      rec.updatedAt = new Date().toISOString();
      await store.setJSON(key, rec);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "receipt-delete") {
      const key = String(body.key || ""), id = String(body.id || "");
      if (!recKeyOk(key) || !/^[0-9a-f]{12}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
      const rec = await store.get(key, { type: "json" });
      if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
      await receiptStore().delete(key + "/" + id);
      rec.files = (rec.files || []).filter((f) => f.id !== id);
      rec.updatedAt = new Date().toISOString();
      await store.setJSON(key, rec);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "income-save") {
      const v = cleanIncome(body.entry || {});
      if (v.error) return Response.json({ error: v.error }, { status: 400 });
      let key = String(body.key || "");
      let prev = null;
      if (key) { if (!key.startsWith("income/")) return Response.json({ error: "Not found" }, { status: 404 }); prev = await store.get(key, { type: "json" }); if (!prev) return Response.json({ error: "Not found" }, { status: 404 }); }
      else key = "income/" + v.date.replace(/-/g, "") + "-" + crypto.randomBytes(4).toString("hex");
      const rec = { ...(prev || { createdAt: new Date().toISOString() }), ...v, key, id: key.slice(7), updatedAt: new Date().toISOString() };
      await store.setJSON(key, rec);
      await logActivity(me, `${prev ? "edited" : "added"} income: ${rec.client} ₱${rec.php}`, key, store);
      // mark the linked payment proof as Paid
      if (v.sourceKey && !prev) { try { const src = await store.get(v.sourceKey, { type: "json" }); if (src) { src.status = "Paid"; src.incomeKey = key; await store.setJSON(v.sourceKey, src); } } catch {} }
      return Response.json({ ok: true, rec });
    }
    if (body.action === "expense-save") {
      const v = cleanExpense(body.entry || {});
      if (v.error) return Response.json({ error: v.error }, { status: 400 });
      let key = String(body.key || ""), prev = null;
      if (key) { if (!key.startsWith("expense/")) return Response.json({ error: "Not found" }, { status: 404 }); prev = await store.get(key, { type: "json" }); if (!prev) return Response.json({ error: "Not found" }, { status: 404 }); }
      else key = "expense/" + v.date.replace(/-/g, "") + "-" + crypto.randomBytes(4).toString("hex");
      const rec = { ...(prev || { createdAt: new Date().toISOString() }), ...v, key, id: key.slice(8), updatedAt: new Date().toISOString() };
      await store.setJSON(key, rec);
      await logActivity(me, `${prev ? "edited" : "added"} expense: ${rec.description} ₱${rec.php}`, key, store);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "expense-delete") {
      const key = String(body.key || "");
      if (!key.startsWith("expense/")) return Response.json({ error: "Not found" }, { status: 404 });
      try { const r = await store.get(key, { type: "json" }); for (const f of (r?.files || [])) await receiptStore().delete(key + "/" + f.id); } catch {}
      await store.delete(key);
      await logActivity(me, "deleted an expense entry", "", store);
      return Response.json({ ok: true });
    }
    if (body.action === "income-delete") {
      const key = String(body.key || "");
      if (!key.startsWith("income/")) return Response.json({ error: "Not found" }, { status: 404 });
      try { const r = await store.get(key, { type: "json" }); for (const f of (r?.files || [])) await receiptStore().delete(key + "/" + f.id); } catch {}
      await store.delete(key);
      return Response.json({ ok: true });
    }
    if (String(body.key || "").startsWith("settings/") || String(body.key || "").startsWith("income/") || String(body.key || "").startsWith("expense/")) return Response.json({ error: "Not found" }, { status: 404 });
    const rec = await store.get(String(body.key || ""), { type: "json" });
    if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
    if (!can(me, permForRecord(rec))) return NO();
    if (body.action === "update") {
      const was = { status: rec.status, notes: rec.notes || "", followUp: rec.followUp || "", assignee: rec.assignee?.id || "", delivery: rec.delivery || "" };
      if (typeof body.delivery === "string") { if (body.delivery && !/^\d{4}-\d{2}-\d{2}$/.test(body.delivery)) return Response.json({ error: "Pick a valid delivery date." }, { status: 400 }); rec.delivery = body.delivery; }
      // Assign to a team member (or back to the owner with "")
      if (typeof body.assignedTo === "string" && body.assignedTo !== was.assignee) {
        if (body.assignedTo) {
          const m = (await assignable(permForRecord(rec), store)).find((x) => x.id === body.assignedTo);
          if (!m) return Response.json({ error: "That team member can't handle this kind of record." }, { status: 400 });
          rec.assigneePrev = rec.assignee?.email || "";
          rec.assignee = { id: m.id, name: m.name, email: m.email, at: new Date().toISOString(), by: me.name };
          try { if (await addGuest(rec, rec.assignee, store)) rec.assignee.onCall = true; } catch {}
          try {
            const d = rec.data || {};
            await sendMail({ to: m.email, replyTo: OWNER.email(), subject: `👤 Assigned to you: ${who(rec)} (${rec.type})`,
              html: `<p style="font:15px/1.6 Arial,sans-serif">Hi ${String(m.name).replace(/[<>&]/g, "")}, ${String(me.name).replace(/[<>&]/g, "")} assigned you a ${String(rec.type || "record").toLowerCase()} from <b>${String(who(rec)).replace(/[<>&]/g, "")}</b>${d.business ? " (" + String(d.business).replace(/[<>&]/g, "") + ")" : ""}.${rec.start ? "<br>Call: <b>" + new Date(rec.start).toLocaleString("en-US", { timeZone: OWNER.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " (PH time)</b>" : ""}${rec.meetLink ? `<br>Meeting link: <a href="${rec.meetLink}">${rec.meetLink}</a>` : ""}</p><p style="font:15px/1.6 Arial,sans-serif"><a href="${OWNER.site()}/admin.html#${encodeURIComponent(body.key)}">Open it in the CRM →</a></p>` });
          } catch (e) { console.log("assign email:", e.message); }
        } else { rec.assigneePrev = rec.assignee?.email || ""; rec.assignee = null; }
      }
      if (typeof body.status === "string") {
        if (rec.status !== body.status.slice(0, 40)) rec.statusAt = new Date().toISOString();
        rec.status = body.status.slice(0, 40);
        if (/cancel|lost/i.test(rec.status) && rec.gcalEventId) {
          try { if (await cancelMeet(rec, store)) { rec.gcalEventId = ""; rec.meetLink = ""; rec.meetCancelled = new Date().toISOString(); } } catch {}
        }
      }
      if (typeof body.notes === "string") rec.notes = body.notes.slice(0, 4000);
      if (typeof body.followUp === "string") rec.followUp = body.followUp.slice(0, 20);
      await store.setJSON(body.key, rec);
      const did = [];
      if (rec.status !== was.status) did.push(`status → ${rec.status}`);
      if ((rec.assignee?.id || "") !== was.assignee) did.push(rec.assignee ? `assigned to ${rec.assignee.name}` : "unassigned");
      if ((rec.notes || "") !== was.notes) did.push("notes");
      if ((rec.delivery || "") !== was.delivery) did.push(rec.delivery ? `delivery date ${rec.delivery}` : "delivery date cleared");
      if ((rec.followUp || "") !== was.followUp) did.push(rec.followUp ? `follow-up ${rec.followUp}` : "follow-up cleared");
      if (did.length) await logActivity(me, `updated ${who(rec)} (${rec.type}): ${did.join(", ")}`, body.key, store);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "make-room") {
      // Give an older inquiry/brief its own Google Meet room link (no time needed)
      let m;
      try { m = await createSpace(store); } catch (e) { m = null; }
      rec.meetLink = m ? m.meetLink : roomLink(rec); rec.meetFallback = !m; rec.meetRoom = true; rec.meetError = "";
      await store.setJSON(body.key, rec);
      await logActivity(me, `created a meeting link for ${who(rec)}`, body.key, store);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "make-meet") {
      // Schedule (inquiries/briefs) or (re)create a Meet link (bookings), invite the client and email both
      const start = body.start ? new Date(body.start) : rec.start ? new Date(rec.start) : null;
      if (!start || isNaN(start)) return Response.json({ error: "Pick a date and time first." }, { status: 400 });
      if (rec.gcalEventId) { try { await cancelMeet(rec, store); } catch {} }
      rec.start = start.toISOString();
      if (rec.type !== "Booking" && !/won|paid/i.test(rec.status)) rec.status = "Call booked";
      rec.reminders = {};
      let m;
      try { m = await createMeet(rec, store); } catch (e) { m = null; rec.meetError = e.message; }
      if (m) { rec.meetLink = m.meetLink; rec.gcalEventId = m.eventId; rec.gcalEventLink = m.eventLink; rec.meetError = ""; rec.meetFallback = false; }
      else { rec.gcalEventId = ""; if (!rec.meetLink || !rec.meetFallback) rec.meetLink = roomLink(rec); rec.meetFallback = true; }
      const log = [];
      for (const msg of bookingEmails(rec)) { try { await sendMail(msg); log.push("sent:" + msg.to); } catch (e) { log.push("failed:" + msg.to + ":" + e.message); } }
      rec.emailLog = [...(rec.emailLog || []), ...log];
      await store.setJSON(body.key, rec);
      await logActivity(me, `scheduled a call with ${who(rec)} for ${new Date(rec.start).toLocaleString("en-US", { timeZone: OWNER.tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`, body.key, store);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "delete") {
      if (!owner) return Response.json({ error: "Only the owner can delete records. Set the status to Lost or Cancelled instead." }, { status: 403 });
      await store.delete(body.key); await logActivity(me, `deleted ${who(rec)} (${rec.type})`, "", store);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  const { blobs } = await store.list();
  const recs = [], income = [], expenses = [], allRecs = [];
  for (const b of blobs) {
    if (b.key.startsWith("settings/")) continue;
    const r = await store.get(b.key, { type: "json" });
    if (!r) continue;
    if (b.key.startsWith("income/") || b.key.startsWith("expense/")) { if (can(me, "payments")) (b.key.startsWith("income/") ? income : expenses).push(r); }
    else { allRecs.push(r); if (can(me, permForRecord(r))) recs.push(r); }
  }
  recs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  income.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  expenses.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));

  if ((url.searchParams.get("receipt") || /^(income|expense)-csv$/.test(url.searchParams.get("format") || "")) && !can(me, "payments")) return NO();
  if (url.searchParams.get("receipt")) {
    const key = String(url.searchParams.get("rec") || ""), id = String(url.searchParams.get("receipt") || "");
    if (!recKeyOk(key) || !/^[0-9a-f]{12}$/.test(id)) return new Response("Not found", { status: 404 });
    const got = await receiptStore().getWithMetadata(key + "/" + id, { type: "arrayBuffer" });
    if (!got) return new Response("Not found", { status: 404 });
    const type = RECEIPT_TYPES.includes(got.metadata?.type) ? got.metadata.type : "application/octet-stream";
    return new Response(got.data, { headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${String(got.metadata?.name || "receipt").replace(/"/g, "")}"` } });
  }
  if (url.searchParams.get("format") === "expense-csv") {
    const year = (url.searchParams.get("year") || "").slice(0, 4);
    const list = expenses.filter((r) => !year || (r.date || "").startsWith(year)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const head = ["Date", "Category", "What", "Paid to", "Amount (PHP)", "Full bill (PHP)", "Work share %", "Paid with", "Receipt kept", "Attachments", "Notes"];
    const rows = list.map((r) => [r.date, r.category, r.description, r.vendor, r.php, r.bill ?? "", r.workpct ?? "", r.method, r.receipt ? "Yes" : "No", (r.files || []).length, r.notes].map(csvCell).join(","));
    const total = list.reduce((a, r) => a + (Number(r.php) || 0), 0);
    rows.push(["", "", "TOTAL", "", total.toFixed(2), "", "", "", "", "", ""].map(csvCell).join(","));
    return new Response("\ufeff" + [head.map(csvCell).join(","), ...rows].join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="expenses-${year || "all"}.csv"` },
    });
  }

  if (url.searchParams.get("format") === "income-csv") {
    const year = (url.searchParams.get("year") || "").slice(0, 4);
    const list = income.filter((r) => !year || (r.date || "").startsWith(year)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const head = ["Date", "Invoice no.", "Client", "Service", "Description", "Amount", "Currency", "Received (PHP)", "Payment method", "Reference no.", "Attachments", "Notes"];
    const rows = list.map((r) => [r.date, r.invoice || "", r.client, r.service, r.description, r.amount, r.currency, r.php, r.method, r.reference, (r.files || []).length, r.notes].map(csvCell).join(","));
    const total = list.reduce((a, r) => a + (Number(r.php) || 0), 0);
    rows.push(["", "", "", "", "TOTAL", "", "", total.toFixed(2), "", "", "", ""].map(csvCell).join(","));
    return new Response("\ufeff" + [head.map(csvCell).join(","), ...rows].join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="income-${year || "all"}.csv"` },
    });
  }

  if (url.searchParams.get("format") === "csv") {
    const cols = ["createdAt", "type", "status", "start", "name", "email", "business", "service", "phone", "client_time_zone", "followUp", "notes"];
    const extra = [...new Set(recs.flatMap((r) => Object.keys(r.data || {})))].filter((k) => !cols.includes(k) && !["form-name", "bot-field", "type"].includes(k));
    const head = [...cols, ...extra];
    const rows = recs.map((r) => head.map((c) => csvCell(r[c] ?? r.data?.[c] ?? "")).join(","));
    return new Response([head.map(csvCell).join(","), ...rows].join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="crm-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }
  // Who's logged in, and who records can be assigned to (names only for team members)
  const team = (await listTeam(store)).filter((m) => m.active !== false && m.pwHash || owner && m.active !== false).map((m) => ({ id: m.id, name: m.name, perms: m.perms }));
  const capacity = { ...computeCapacity(allRecs, await capSettings(store)), settings: owner ? await capSettings(store) : undefined };
  if (!owner) capacity.nextDue = capacity.nextDue.filter((x) => recs.some((r) => r.key === x.key));
  return Response.json({ records: recs, income, expenses, capacity, me: { role: me.role, id: me.id, name: me.name, perms: me.perms }, team }, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/crm" };
