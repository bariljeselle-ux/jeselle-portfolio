// Jeselle's website on Cloudflare.
// Pages (public/) are served free and unlimited. This file runs only for forms, the CRM API and timed jobs.
import { bindEnv, getStore } from "./blobs.mjs";
import booked from "../netlify/functions/booked.mjs";
import crm from "../netlify/functions/crm.mjs";
import reviews from "../netlify/functions/reviews.mjs";
import submit from "../netlify/functions/submit.mjs";
import googleCallback from "../netlify/functions/google-callback.mjs";
import capacity from "../netlify/functions/capacity.mjs";
import { handleSubmission, runReminders, runNudges, runMonthlyBackup, OWNER } from "../netlify/lib/core.mjs";
import { runMonthlyCheckin } from "../netlify/lib/capacity.mjs";
import { runUptime, checkPages, runDomainCheck } from "../netlify/lib/uptime.mjs";
import { getContent, serveImage } from "../netlify/lib/site.mjs";

const ROUTES = { "/api/booked": booked, "/api/crm": crm, "/api/reviews": reviews, "/api/submit": submit, "/api/google/callback": googleCallback, "/api/capacity": capacity,
  // Easy-to-share link to the JB Creates VA Facebook Page
  "/facebook": () => Response.redirect("https://www.facebook.com/profile.php?id=61596950876603", 302),
  "/messenger": () => Response.redirect("https://m.me/61596950876603", 302) };
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

// Homepage with the owner's "Edit website" changes applied (text + photo).
// ?original=1 shows the page as built, which the editor uses to list what can be changed.
// Each menu item is its own page with its own address; they all use index.html,
// which shows just that page's sections. Title/description/link are set here for Google.
const PAGES = {
  "/works": { title: "Works: Websites Built by JB | Cebu, Philippines", desc: "See websites built by JB: a travel agency booking site in Antipolo, plus sample café and cleaning-business sites with booking, quotes and owner dashboards." },
  "/services": { title: "Services & Rates: Websites, SEO & Graphic Design | JB", desc: "Website creation and development (3 to 7 pages) with built-in booking, payments and a private CRM, landing pages, SEO, logos and graphic design, with clear one-time prices in USD and pesos. By JB in Cebu, Philippines." },
  "/book": { title: "Book a Free Call | JB", desc: "Book a free 15-minute Google Meet call with JB. Pick a time in your own time zone." },
  "/contact": { title: "Contact | JB, jeselle.va", desc: "Send an inquiry, email, call or message JB, Filipino virtual assistant for websites, SEO, graphic design and CRM systems." },
};
const OLD_PATHS = { "/portfolio": "/works", "/portfolio.html": "/works", "/works.html": "/works", "/rates": "/services#rates", "/rates/": "/services#rates" };

async function homePage(req, env, url) {
  const page = PAGES[url.pathname];
  const h = new Headers(req.headers); h.delete("if-none-match"); h.delete("if-modified-since");
  const res = await env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: "GET", headers: h }));
  if (!res.ok || url.searchParams.has("original")) return res;
  let c = null;
  try { c = await getContent(); } catch (e) { console.log("site content:", e.message); }
  const text = c?.text || {}, img = c?.img || {};
  const out = new Response(res.body, res);
  out.headers.delete("etag"); out.headers.set("Cache-Control", "no-cache");
  const rw = new HTMLRewriter();
  if (page) {
    const link = "https://jeselleva.com" + url.pathname;
    rw.on("title", { element(el) { el.setInnerContent(page.title); } })
      .on('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"]', { element(el) { el.setAttribute("content", page.desc); } })
      .on('meta[property="og:title"],meta[name="twitter:title"]', { element(el) { el.setAttribute("content", page.title); } })
      .on('link[rel="canonical"],meta[property="og:url"]', { element(el) { el.setAttribute(el.tagName === "link" ? "href" : "content", link); } });
    if (page.noindex) rw.on('meta[name="robots"]', { element(el) { el.setAttribute("content", "noindex"); } });
  }
  if (!Object.keys(text).length && !Object.keys(img).length) return page ? rw.transform(out) : out;
  return rw
    .on("[data-edit]", { element(el) { const v = text[el.getAttribute("data-edit")]; if (v) el.setInnerContent(v, { html: true }); } })
    .on("[data-edit-img]", { element(el) { const v = img[el.getAttribute("data-edit-img")]; if (v) { el.setAttribute("src", v); el.removeAttribute("srcset"); } } })
    .transform(out);
}

const worker = {
  async fetch(req, env, ctx) {
    bindEnv(env);
    const url = new URL(req.url);
    try {
      const handler = ROUTES[url.pathname];
      if (handler) return await handler(withIp(req), ctx);
      if (url.pathname === "/api/uptime-test") return Response.json({ problems: await checkPages(OWNER.site(), (u, i) => worker.fetch(new Request(u, i), env, ctx)) });
      if (url.pathname === "/api/upload") return await serveUpload(url);
      if (url.pathname === "/api/site-image") return await serveImage(url);
      if (req.method === "POST" && !url.pathname.startsWith("/api/")) return await formPost(req);
    } catch (e) {
      console.log("error:", url.pathname, e.stack || e.message);
      return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
    if (OLD_PATHS[url.pathname]) { const [p, h] = OLD_PATHS[url.pathname].split("#"); return Response.redirect(new URL(p + url.search + (h ? "#" + h : ""), url), 301); }
    if (url.pathname.length > 1 && url.pathname.endsWith("/") && PAGES[url.pathname.slice(0, -1)]) return Response.redirect(new URL(url.pathname.slice(0, -1) + url.search, url), 301);
    if (url.pathname === "/" || url.pathname === "/index.html" || PAGES[url.pathname]) return await homePage(req, env, url);
    return env.ASSETS.fetch(req);
  },

  // Timed jobs (times are UTC: 01:00 UTC = 9 AM Philippine time)
  async scheduled(event, env, ctx) {
    bindEnv(env);
    const job = event.cron === "*/15 * * * *" ? () => Promise.allSettled([runReminders(), runUptime({ fetchFn: (u, init) => worker.fetch(new Request(u, init), env, ctx) })]).then((r) => r.map((x) => x.value || x.reason?.message)) : event.cron === "0 1 * * *" ? () => Promise.allSettled([runNudges(), runDomainCheck(), import("../netlify/lib/tax.mjs").then((t) => t.runTaxReminders())]).then((r) => r.map((x) => x.value || x.reason?.message)) : event.cron === "0 1 1 * *" ? () => Promise.allSettled([runMonthlyBackup(), runMonthlyCheckin()]).then((r) => r.map((x) => x.value || x.reason?.message)) : null;
    if (job) ctx.waitUntil(job().then((r) => console.log(event.cron, JSON.stringify(r))).catch((e) => console.log(event.cron, "failed:", e.message)));
  },
};
export default worker;
