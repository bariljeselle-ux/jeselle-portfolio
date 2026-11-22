// Jeselle's website on Cloudflare.
// Pages (public/) are served free and unlimited. This file runs only for forms, the CRM API and timed jobs.
import { bindEnv, getStore } from "./blobs.mjs";
import booked from "../netlify/functions/booked.mjs";
import crm from "../netlify/functions/crm.mjs";
import reviews from "../netlify/functions/reviews.mjs";
import submit from "../netlify/functions/submit.mjs";
import googleCallback from "../netlify/functions/google-callback.mjs";
import { handleSubmission, runReminders, runNudges, runMonthlyBackup, OWNER } from "../netlify/lib/core.mjs";

const ROUTES = { "/api/booked": booked, "/api/crm": crm, "/api/reviews": reviews, "/api/submit": submit, "/api/google/callback": googleCallback };
const FORM_TYPES = { booking: "Booking", "project-brief": "Project brief", payment: "Payment", inquiry: "Inquiry", permission: "Portfolio permission", "portfolio-permission": "Portfolio permission" };
const MAX_FILE = 20 * 1024 * 1024; // 20 MB per uploaded file
const seen = new Map(); // simple flood guard

// Netlify-style IP header, so the existing spam guards keep working
const withIp = (req) => { const h = new Headers(req.headers); h.set("x-nf-client-connection-ip", req.headers.get("cf-connecting-ip") || "x"); return new Request(req, { headers: h }); };
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

// A website form was sent (booking, inquiry, project brief, payment, portfolio permission)
async function formPost(req) {
  const ip = req.headers.get("cf-connecting-ip") || "x", now = Date.now();
  if (now - (seen.get(ip) || 0) < 3000) return Response.json({ error: "Too many requests" }, { status: 429 });
  seen.set(ip, now);
  let fd;
  try { fd = await req.formData(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const data = {}, uploads = [];
  for (const [k, v] of fd.entries()) {
    const key = String(k).slice(0, 60);
    if (typeof v === "string") { data[key] = data[key] ? data[key] + ", " + v.slice(0, 5000) : v.slice(0, 5000); continue; }
    if (!v || !v.size) continue;
    if (v.size > MAX_FILE) return Response.json({ error: `${v.name} is over 20 MB. Please share it with a Google Drive link instead.` }, { status: 413 });
    uploads.push([key, v]);
  }
  if (data["bot-field"]) return Response.json({ ok: true });
  if (!data.type && data["form-name"]) data.type = FORM_TYPES[data["form-name"]] || "Inquiry";
  const store = getStore("uploads");
  for (const [key, file] of uploads.slice(0, 10)) {
    const id = hex(16);
    await store.set(id, await file.arrayBuffer(), { metadata: { type: file.type || "application/octet-stream", name: String(file.name || "file").replace(/[^\w .()\-]/g, "_").slice(0, 100) } });
    data[key] = `${OWNER.site()}/api/upload?id=${id}`;
  }
  const r = await handleSubmission(data);
  const ok = r.ok || r.skipped === "duplicate";
  if (/json/.test(req.headers.get("accept") || "") || req.headers.get("sec-fetch-mode") === "cors") return Response.json(r, { status: ok ? 200 : 400 });
  // Sent without JavaScript: show a simple thank-you page
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><body style="margin:0;font:16px/1.6 system-ui,sans-serif;background:#F7F3EE;color:#231E1B;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box"><div style="max-width:440px;background:#fff;border:1px solid #E2D9CF;border-radius:8px;padding:28px;text-align:center"><h1 style="font-family:Georgia,serif;font-weight:normal">${ok ? "Thank you!" : "Something went wrong"}</h1><p>${ok ? "Your message was sent. Check your email for a confirmation." : "Please email bariljeselle@gmail.com instead."}</p><a href="/" style="color:#7A4E3A">Back to the website</a></div></body>`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Files clients uploaded with a form (links in your CRM and emails; the link itself is the password)
async function serveUpload(url) {
  const id = url.searchParams.get("id") || "";
  if (!/^[0-9a-f]{32}$/.test(id)) return new Response("Not found", { status: 404 });
  const got = await getStore("uploads").getWithMetadata(id, { type: "arrayBuffer" });
  if (!got) return new Response("Not found", { status: 404 });
  const type = String(got.metadata.type || "application/octet-stream");
  const inline = /^(image\/(png|jpe?g|gif|webp|heic|heif)|application\/pdf|video\/(mp4|quicktime|webm))$/i.test(type);
  return new Response(got.data, { headers: {
    "Content-Type": inline ? type : "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600",
    "Content-Security-Policy": "sandbox", "X-Robots-Tag": "noindex",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${String(got.metadata.name || "file").replace(/"/g, "")}"`,
  } });
}

export default {
  async fetch(req, env, ctx) {
    bindEnv(env);
    const url = new URL(req.url);
    try {
      const handler = ROUTES[url.pathname];
      if (handler) return await handler(withIp(req), ctx);
      if (url.pathname === "/api/upload") return await serveUpload(url);
      if (req.method === "POST" && !url.pathname.startsWith("/api/")) return await formPost(req);
    } catch (e) {
      console.log("error:", url.pathname, e.stack || e.message);
      return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
    if (url.pathname === "/") return env.ASSETS.fetch(new Request(new URL("/index.html", url), req));
    return env.ASSETS.fetch(req);
  },

  // Timed jobs (times are UTC: 01:00 UTC = 9 AM Philippine time)
  async scheduled(event, env, ctx) {
    bindEnv(env);
    const job = event.cron === "*/15 * * * *" ? runReminders : event.cron === "0 1 * * *" ? runNudges : event.cron === "0 1 1 * *" ? runMonthlyBackup : null;
    if (job) ctx.waitUntil(job().then((r) => console.log(event.cron, JSON.stringify(r))).catch((e) => console.log(event.cron, "failed:", e.message)));
  },
};
