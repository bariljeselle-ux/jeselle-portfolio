// Backup route: if Netlify Forms refuses a submission, the page sends it here instead.
// Same result: saved to your CRM + confirmation email to the client + alert email to you.
import { handleSubmission } from "../lib/core.mjs";

const seen = new Map(); // simple flood guard per warm instance
export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const ip = req.headers.get("x-nf-client-connection-ip") || "x";
  const now = Date.now(), last = seen.get(ip) || 0;
  if (now - last < 5000) return Response.json({ error: "Too many requests" }, { status: 429 });
  seen.set(ip, now);
  let data;
  try { data = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  if (!data || typeof data !== "object") return Response.json({ error: "Bad request" }, { status: 400 });
  const clean = {};
  for (const [k, v] of Object.entries(data).slice(0, 80)) clean[String(k).slice(0, 60)] = String(v ?? "").slice(0, 5000);
  const r = await handleSubmission(clean);
  return Response.json(r, { status: r.ok || r.skipped === "duplicate" ? 200 : 400 });
};

export const config = { path: "/api/submit" };
