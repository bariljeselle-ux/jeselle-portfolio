// Client reviews & feedback for reviews.html (public) and admin.html (private).
// Public:  GET  /api/reviews                      -> published reviews + rating summary
//          POST /api/reviews {action:"submit"...}  -> new review (shows right away if the client allowed it)
// Private: POST /api/reviews with header x-admin-key = ADMIN_PASSWORD
//          {action:"list"} | {action:"publish"|"hide"|"delete", key} | {action:"reply", key, reply} | {action:"add", ...collected testimonial}
import { getStore } from "@netlify/blobs";
import { sendMail, layout, OWNER } from "../lib/core.mjs";
import crypto from "node:crypto";

export const reviewStore = () => getStore({ name: "reviews", consistency: "strong" });
export const photoStore = () => getStore({ name: "review-photos", consistency: "strong" });

// Client photo: a small square JPEG made in the browser (max ~150 KB). Returns a Buffer, null, or { error }.
export function parsePhoto(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) return { error: "That photo couldn't be read. Please try another one." };
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 150000 || buf.length < 200 || buf[0] !== 0xff || buf[1] !== 0xd8) return { error: "That photo couldn't be read. Please try another one." };
  return buf;
}
const CRIT = ["communication", "quality", "speed", "value"];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const str = (v, n) => String(v ?? "").replace(/\s+$/g, "").slice(0, n);
const star = (n) => "★".repeat(n) + "☆".repeat(5 - n);

const isAdmin = (req) => {
  const pass = process.env.ADMIN_PASSWORD || "";
  const given = req.headers.get("x-admin-key") || "";
  if (!pass || given.length !== pass.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pass));
};

// What visitors may see: never the email or the private "what to improve" note.
export function publicView(r) {
  return {
    id: r.id, createdAt: r.createdAt, name: r.showName ? r.name : r.name.split(/\s+/)[0] + (r.name.trim().includes(" ") ? " " + r.name.trim().split(/\s+/).pop()[0] + "." : ""),
    business: r.showName ? r.business : "", service: r.service, rating: r.rating, scores: r.scores, recommend: r.recommend,
    title: r.title, text: r.text, tags: r.tags, reply: r.reply || "", replyAt: r.replyAt || "", source: r.source || "",
    photo: r.hasPhoto ? `/api/reviews?photo=${r.id}` : "",
  };
}

export function summary(list) {
  const n = list.length;
  const avg = (f) => (n ? Math.round((list.reduce((a, r) => a + (f(r) || 0), 0) / n) * 10) / 10 : 0);
  const counts = [5, 4, 3, 2, 1].map((s) => list.filter((r) => r.rating === s).length);
  const scores = Object.fromEntries(CRIT.map((c) => { const has = list.filter((r) => r.scores?.[c]); return [c, has.length ? Math.round((has.reduce((a, r) => a + r.scores[c], 0) / has.length) * 10) / 10 : 0]; }));
  const answered = list.filter((r) => r.recommend), rec = answered.filter((r) => r.recommend === "Yes").length;
  return { count: n, average: avg((r) => r.rating), counts, scores, recommendPct: answered.length ? Math.round((rec / answered.length) * 100) : null };
}

export function cleanSubmission(b) {
  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "Please choose a star rating." };
  const name = str(b.name, 80).trim();
  if (!name) return { error: "Please type your name." };
  const text = str(b.text, 2000).trim();
  const improve = str(b.improve, 2000).trim();
  if (!text && !improve) return { error: "Please write a few words about your experience." };
  const email = str(b.email, 120).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please check your email address." };
  const scores = {};
  for (const c of CRIT) { const v = Number(b.scores?.[c]); if (Number.isInteger(v) && v >= 1 && v <= 5) scores[c] = v; }
  const tags = Array.isArray(b.tags) ? b.tags.slice(0, 8).map((t) => str(t, 40)).filter(Boolean) : [];
  return {
    rec: {
      name, email, business: str(b.business, 100).trim(), service: str(b.service, 80).trim(), rating, scores,
      recommend: ["Yes", "Maybe", "No"].includes(b.recommend) ? b.recommend : "", mood: str(b.mood, 20),
      title: str(b.title, 120).trim(), text, improve, tags,
      canPublish: b.canPublish === true || b.canPublish === "yes", showName: b.showName !== false && b.showName !== "no",
    },
  };
}

const seen = new Map();
export default async (req) => {
  const store = reviewStore();
  if (req.method === "GET") {
    const pid = new URL(req.url).searchParams.get("photo");
    if (pid) {
      // Photos are only served for reviews that are live on the page
      if (!/^[\w-]{6,40}$/.test(pid)) return new Response("Not found", { status: 404 });
      const r = await store.get("review/" + pid, { type: "json" });
      const img = r && r.status === "Published" && r.hasPhoto ? await photoStore().get(pid, { type: "arrayBuffer" }) : null;
      if (!img) return new Response("Not found", { status: 404 });
      return new Response(img, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
    }
    const all = await loadAll(store);
    const pub = all.filter((r) => r.status === "Published");
    return Response.json({ summary: summary(pub), reviews: pub.map(publicView) }, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  if (body.action === "submit") {
    if (body.website) return Response.json({ ok: true }); // honeypot: bots fill hidden field
    const ip = req.headers.get("x-nf-client-connection-ip") || "x";
    const now = Date.now();
    if (now - (seen.get(ip) || 0) < 20000) return Response.json({ error: "Please wait a moment before sending another review." }, { status: 429 });
    seen.set(ip, now);
    const { rec, error } = cleanSubmission(body);
    if (error) return Response.json({ error }, { status: 400 });
    const photo = parsePhoto(body.photo);
    if (photo?.error) return Response.json({ error: photo.error }, { status: 400 });
    const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + crypto.randomBytes(4).toString("hex");
    Object.assign(rec, { id, key: "review/" + id, createdAt: new Date().toISOString(), status: rec.canPublish ? "Published" : "Private" });
    if (photo) { await photoStore().set(id, photo); rec.hasPhoto = true; }
    await store.setJSON(rec.key, rec);
    try { await notify(rec); } catch (e) { console.log("review email failed:", e.message); }
    try { const { sendPush } = await import("../lib/push.mjs"); await sendPush({ title: `⭐ New review: ${rec.name || "A client"} (${rec.rating}/5)`, body: String(rec.text || rec.improve || "Tap to read it.").slice(0, 120), url: "/admin.html#reviews", tag: rec.key }); } catch {}
    return Response.json({ ok: true });
  }

  // ----- admin only -----
  if (!process.env.ADMIN_PASSWORD) return Response.json({ error: "Set ADMIN_PASSWORD in your website settings first." }, { status: 503 });
  if (!isAdmin(req)) return Response.json({ error: "Wrong password" }, { status: 401 });
  if (body.action === "list") {
    const all = await loadAll(store);
    return Response.json({ reviews: all, summary: summary(all.filter((r) => r.status === "Published")) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (body.action === "add") {
    // A testimonial you collected elsewhere (Messenger, email, Google…), published right away
    const { rec, error } = cleanSubmission({ ...body, canPublish: true });
    if (error) return Response.json({ error }, { status: 400 });
    const photo = parsePhoto(body.photo);
    if (photo?.error) return Response.json({ error: photo.error }, { status: 400 });
    const when = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? new Date(body.date + "T12:00:00+08:00") : new Date();
    const id = when.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + crypto.randomBytes(4).toString("hex");
    Object.assign(rec, { id, key: "review/" + id, createdAt: when.toISOString(), status: "Published", source: str(body.source, 60).trim(), addedByOwner: true });
    if (photo) { await photoStore().set(id, photo); rec.hasPhoto = true; }
    await store.setJSON(rec.key, rec);
    return Response.json({ ok: true, rec });
  }
  const key = String(body.key || "");
  if (!key.startsWith("review/")) return Response.json({ error: "Not found" }, { status: 404 });
  if (body.action === "delete") { await store.delete(key); try { await photoStore().delete(key.slice(7)); } catch {} return Response.json({ ok: true }); }
  const rec = await store.get(key, { type: "json" });
  if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
  if (body.action === "publish") {
    if (!rec.canPublish) return Response.json({ error: "This client asked to keep their feedback private." }, { status: 400 });
    rec.status = "Published"; rec.publishedAt = new Date().toISOString();
  } else if (body.action === "hide") rec.status = "Hidden";
  else if (body.action === "remove-photo") { try { await photoStore().delete(rec.id); } catch {} rec.hasPhoto = false; }
  else if (body.action === "reply") { rec.reply = str(body.reply, 1500).trim(); rec.replyAt = rec.reply ? new Date().toISOString() : ""; }
  else return Response.json({ error: "Unknown action" }, { status: 400 });
  await store.setJSON(key, rec);
  return Response.json({ ok: true, rec });
};

async function loadAll(store) {
  const { blobs } = await store.list({ prefix: "review/" });
  const out = [];
  for (const b of blobs) { const r = await store.get(b.key, { type: "json" }); if (r) out.push(r); }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

async function notify(r) {
  const rows = [
    ["Rating", `<span style="color:#E0A526;font-size:18px">${star(r.rating)}</span> ${r.rating}/5`, 1],
    ...CRIT.filter((c) => r.scores[c]).map((c) => [c[0].toUpperCase() + c.slice(1), `<span style="color:#E0A526">${star(r.scores[c])}</span>`, 1]),
    ["Would recommend", r.recommend], ["Service", r.service], ["Business", r.business], ["Email", r.email],
    ["Highlights", r.tags.join(", ")], ["Title", r.title], ["Review", r.text], ["What to improve (private)", r.improve],
    ["OK to publish", r.canPublish ? "Yes" : "No, private feedback only"],
  ].filter(([, v]) => v);
  const table = `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([k, v, raw]) => `<tr><td style="padding:7px 8px;border-bottom:1px solid #F1ECE5;color:#6E625A;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:7px 8px;border-bottom:1px solid #F1ECE5">${raw ? v : esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`;
  await sendMail({
    to: OWNER.email(),
    subject: `${"⭐".repeat(r.rating)} New review from ${r.name}`,
    html: layout(`New ${r.rating}-star review`, `<p style="margin:0 0 12px;font-size:15px">${esc(r.name)} left feedback on your website. ${r.canPublish ? "It's now live on your reviews page. You can reply, hide or delete it in your CRM." : "They asked to keep it private, so only you can see it in your CRM."}</p>${table}<p style="margin:16px 0 0"><a href="${OWNER.site()}/admin.html#reviews" style="display:inline-block;background:#7A4E3A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px;font-size:14px">Open reviews in CRM</a></p>`),
  });
  if (r.email) {
    await sendMail({
      to: r.email,
      subject: "Thank you for your feedback 💛",
      html: layout("Thank you for your feedback!", `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">Hi ${esc(r.name.split(" ")[0])},</p><p style="margin:0 0 12px;font-size:15px;line-height:1.6">Thank you for taking the time to rate my work (${star(r.rating)}). Your feedback helps me improve and helps other business owners decide.</p><p style="margin:0;font-size:15px">Jeselle</p>`),
    });
  }
}

export const config = { path: "/api/reviews" };
