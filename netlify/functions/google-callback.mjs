// Google sends her back here after she clicks "Connect Google Calendar" in the CRM.
import { finishAuth } from "../lib/google.mjs";

const page = (title, msg, ok) => new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<body style="margin:0;font:16px/1.6 system-ui,sans-serif;background:#F7F3EE;color:#231E1B;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box">
<div style="max-width:440px;background:#fff;border:1px solid #E2D9CF;border-radius:8px;padding:28px;text-align:center">
<p style="font-size:40px;margin:0">${ok ? "✅" : "⚠️"}</p><h1 style="font-family:Georgia,serif;font-weight:normal;margin:8px 0">${title}</h1><p style="margin:0 0 18px;color:#5E534C">${msg}</p>
<a href="/admin.html" style="display:inline-block;background:#7A4E3A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px">Back to your CRM</a></div></body>`,
  { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export default async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("error")) return page("Not connected", "Google sign-in was cancelled. You can try again from your CRM.", false);
  try {
    const { email } = await finishAuth(u.searchParams.get("code") || "", u.searchParams.get("state") || "");
    return page("Google Calendar connected", `New bookings will now get a Google Meet link automatically${email ? ` on <b>${email.replace(/[<>&"]/g, "")}</b>` : ""}.`, true);
  } catch (e) {
    return page("Not connected", String(e.message).replace(/[<>&]/g, ""), false);
  }
};

export const config = { path: "/api/google/callback" };
