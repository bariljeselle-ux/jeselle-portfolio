// "Edit website": the owner's own text and photo changes for the homepage.
// Saved changes are applied to the page by cloudflare/worker.mjs (HTMLRewriter), so Google sees them too.
// Only elements marked data-edit="..." / data-edit-img="..." in public/index.html can be changed.
// Prices, packages, services, hours and FAQ are NOT marked on purpose: they appear on several pages,
// so those changes go through Claude to update everywhere at once.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const KEY_OK = /^[a-z]+-\d{1,3}$/;
const contentStore = () => getStore({ name: "site", consistency: "strong" });
const imageStore = () => getStore({ name: "site-images", consistency: "strong" });
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function getContent() {
  const c = (await contentStore().get("content", { type: "json" })) || {};
  return { text: c.text || {}, img: c.img || {}, updated: c.updated || null };
}

// Keep only simple formatting: line breaks, bold, italic (and the italic accent style the page already uses).
const OPEN = /^<(b|strong|i|em)>$|^<span style="font-style: italic(; color: #[0-9A-Fa-f]{6})?">$/;
export function cleanHtml(input) {
  const parts = String(input ?? "").slice(0, 3000).split(/(<[^>]*>)/);
  const stack = [];
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith("<")) {
      if (/^<br\s*\/?>$/i.test(p)) { out += "<br>"; continue; }
      const m = p.match(OPEN);
      if (m) { const tag = m[1] || "span"; stack.push(tag); out += p; continue; }
      const c = p.match(/^<\/(b|strong|i|em|span)>$/);
      if (c && stack.includes(c[1])) { while (stack.length) { const t = stack.pop(); out += `</${t}>`; if (t === c[1]) break; } }
      continue; // anything else is dropped
    }
    out += p.replace(/&(?!(amp|lt|gt|quot|#\d{1,6});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out.trim();
}

// changes: { "about-3": "<new html>", "top-1": null }  (null = back to the original)
export async function saveText(changes) {
  const c = await getContent();
  let n = 0;
  for (const [k, v] of Object.entries(changes || {}).slice(0, 200)) {
    if (!KEY_OK.test(k)) continue;
    if (v === null || v === undefined) { if (k in c.text) { delete c.text[k]; n++; } continue; }
    const h = cleanHtml(v);
    if (!h.replace(/<[^>]+>/g, "").trim()) continue; // never save an empty heading or paragraph
    c.text[k] = h; n++;
  }
  c.updated = new Date().toISOString();
  await contentStore().setJSON("content", c);
  return { ok: true, changed: n, content: c };
}

export async function saveImage(key, type, base64) {
  if (!KEY_OK.test(String(key))) return { status: 400, error: "Unknown photo." };
  const c = await getContent();
  if (base64 === null) { // back to the original photo
    const old = c.img[key]; delete c.img[key];
    if (old) { const id = (old.match(/id=([0-9a-f]{32})/) || [])[1]; if (id) try { await imageStore().delete(id); } catch {} }
    c.updated = new Date().toISOString(); await contentStore().setJSON("content", c);
    return { ok: true, content: c };
  }
  if (!IMG_TYPES.includes(type)) return { status: 400, error: "Choose a JPG, PNG or WebP photo." };
  let buf;
  try { buf = Buffer.from(String(base64 || ""), "base64"); } catch { return { status: 400, error: "Could not read the photo." }; }
  if (!buf.length || buf.length > 5 * 1024 * 1024) return { status: 400, error: "The photo is over 5 MB. Please choose a smaller one." };
  const id = crypto.randomBytes(16).toString("hex");
  await imageStore().set(id, buf, { metadata: { type } });
  const old = c.img[key];
  c.img[key] = `/api/site-image?id=${id}`;
  c.updated = new Date().toISOString();
  await contentStore().setJSON("content", c);
  if (old) { const oid = (old.match(/id=([0-9a-f]{32})/) || [])[1]; if (oid) try { await imageStore().delete(oid); } catch {} }
  return { ok: true, content: c };
}

export async function serveImage(url) {
  const id = url.searchParams.get("id") || "";
  if (!/^[0-9a-f]{32}$/.test(id)) return new Response("Not found", { status: 404 });
  const got = await imageStore().getWithMetadata(id, { type: "arrayBuffer" });
  if (!got) return new Response("Not found", { status: 404 });
  const type = IMG_TYPES.includes(got.metadata.type) ? got.metadata.type : "image/jpeg";
  // each new photo gets a new id, so it can be cached for a long time
  return new Response(got.data, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
