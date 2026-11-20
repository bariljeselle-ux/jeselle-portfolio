// Private CRM API for admin.html. Protected by the ADMIN_PASSWORD environment variable.
import { crmStore, sendMail, OWNER } from "../lib/core.mjs";
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
    const rec = await store.get(String(body.key || ""), { type: "json" });
    if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
    if (body.action === "update") {
      if (typeof body.status === "string") rec.status = body.status.slice(0, 40);
      if (typeof body.notes === "string") rec.notes = body.notes.slice(0, 4000);
      if (typeof body.followUp === "string") rec.followUp = body.followUp.slice(0, 20);
      await store.setJSON(body.key, rec);
      return Response.json({ ok: true, rec });
    }
    if (body.action === "delete") { await store.delete(body.key); return Response.json({ ok: true }); }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  const { blobs } = await store.list();
  const recs = [];
  for (const b of blobs) { const r = await store.get(b.key, { type: "json" }); if (r) recs.push(r); }
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
