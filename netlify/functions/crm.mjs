// Private CRM API for admin.html. Protected by the ADMIN_PASSWORD environment variable.
import { crmStore, sendMail, OWNER, bookingEmails } from "../lib/core.mjs";
import { googleStatus, authUrl, disconnect, createMeet, cancelMeet, createSpace } from "../lib/google.mjs";
import crypto from "node:crypto";

const ok = (req) => {
  const pass = process.env.ADMIN_PASSWORD || "";
  const given = req.headers.get("x-admin-key") || "";
  if (!pass || given.length !== pass.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pass));
};
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default async (req) => {
  if (!process.env.ADMIN_PASSWORD) return Response.json({ error: "Set ADMIN_PASSWORD in Netlify environment variables first." }, { status: 503 });
  if (!ok(req)) return Response.json({ error: "Wrong password" }, { status: 401 });
  const store = crmStore();
  const url = new URL(req.url);

  if (req.method === "POST") {
    const body = await req.json();
    if (body.action === "test-email") {
      await sendMail({ to: OWNER.email(), subject: "✅ Test email from your website CRM", html: "<p>Your website can send emails. Bookings, reminders and inquiries will arrive here.</p>" });
      return Response.json({ ok: true });
    }
    if (body.action === "google-status") return Response.json(await googleStatus(store));
    if (body.action === "google-connect") {
      try { return Response.json({ url: await authUrl(store) }); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
    }
    if (body.action === "google-disconnect") { await disconnect(store); return Response.json({ ok: true }); }
    if (String(body.key || "").startsWith("settings/")) return Response.json({ error: "Not found" }, { status: 404 });
    const rec = await store.get(String(body.key || ""), { type: "json" });
    if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
    if (body.action === "update") {
      if (typeof body.status === "string") {
        rec.status = body.status.slice(0, 40);
        if (/cancel|lost/i.test(rec.status) && rec.gcalEventId) {
          try { if (await cancelMeet(rec, store)) { rec.gcalEventId = ""; rec.meetLink = ""; rec.meetCancelled = new Date().toISOString(); } } catch {}
        }
      }
      if (typeof body.notes === "string") rec.notes = body.notes.slice(0, 4000);
      if (typeof body.followUp === "string") rec.followUp = body.followUp.slice(0, 20);
      await store.setJSON(body.key, rec);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "make-room") {
      // Give an older inquiry/brief its own Google Meet room link (no time needed)
      let m;
      try { m = await createSpace(store); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
      if (!m) return Response.json({ error: "Connect Google Calendar first (button at the top of your CRM)." }, { status: 400 });
      rec.meetLink = m.meetLink; rec.meetRoom = true; rec.meetError = "";
      await store.setJSON(body.key, rec);
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
      try { m = await createMeet(rec, store); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
      if (!m) return Response.json({ error: "Connect Google Calendar first (button at the top of your CRM)." }, { status: 400 });
      rec.meetLink = m.meetLink; rec.gcalEventId = m.eventId; rec.gcalEventLink = m.eventLink; rec.meetError = "";
      const log = [];
      for (const msg of bookingEmails(rec)) { try { await sendMail(msg); log.push("sent:" + msg.to); } catch (e) { log.push("failed:" + msg.to + ":" + e.message); } }
      rec.emailLog = [...(rec.emailLog || []), ...log];
      await store.setJSON(body.key, rec);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "delete") { await store.delete(body.key); return Response.json({ ok: true }); }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  const { blobs } = await store.list();
  const recs = [];
  for (const b of blobs) { if (b.key.startsWith("settings/")) continue; const r = await store.get(b.key, { type: "json" }); if (r) recs.push(r); }
  recs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (url.searchParams.get("format") === "csv") {
    const cols = ["createdAt", "type", "status", "start", "name", "email", "business", "service", "phone", "client_time_zone", "followUp", "notes"];
    const extra = [...new Set(recs.flatMap((r) => Object.keys(r.data || {})))].filter((k) => !cols.includes(k) && !["form-name", "bot-field", "type"].includes(k));
    const head = [...cols, ...extra];
    const rows = recs.map((r) => head.map((c) => csvCell(r[c] ?? r.data?.[c] ?? "")).join(","));
    return new Response([head.map(csvCell).join(","), ...rows].join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="crm-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }
  return Response.json({ records: recs }, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/crm" };
