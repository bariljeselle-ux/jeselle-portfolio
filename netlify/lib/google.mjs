// Google Calendar + Google Meet: creates a calendar event with a Meet link for every booking.
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Netlify env vars), then a one-time
// "Connect Google Calendar" click in admin.html, which stores the refresh token in Netlify Blobs.
import crypto from "node:crypto";
import { OWNER, CALL_MINUTES, crmStore } from "./core.mjs";

const SETTINGS = "settings/google";
const STATE = "settings/google-state";
const SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/meetings.space.created";
export const redirectUri = () => `${OWNER.site()}/api/google/callback`;
const hasKeys = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export async function googleStatus(store = crmStore()) {
  const s = await store.get(SETTINGS, { type: "json" });
  return { keys: hasKeys(), connected: !!(hasKeys() && s?.refresh_token), email: s?.email || "", redirectUri: redirectUri() };
}

export async function authUrl(store = crmStore()) {
  if (!hasKeys()) throw new Error("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify environment variables first, then redeploy.");
  const state = crypto.randomBytes(18).toString("hex");
  await store.setJSON(STATE, { state, at: Date.now() });
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: "code",
    scope: `${SCOPE} openid email`, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function finishAuth(code, state, store = crmStore()) {
  const saved = await store.get(STATE, { type: "json" });
  if (!saved || saved.state !== state || Date.now() - saved.at > 15 * 60000) throw new Error("This link expired. Go back to your CRM and click Connect Google Calendar again.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(), grant_type: "authorization_code" }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "Google didn't return a refresh token. Try again.");
  let email = "";
  try { email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email || ""; } catch {}
  await store.setJSON(SETTINGS, { refresh_token: j.refresh_token, email, connectedAt: new Date().toISOString() });
  await store.delete(STATE);
  return { email };
}

export async function disconnect(store = crmStore()) { await store.delete(SETTINGS); }

async function accessToken(store) {
  const s = await store.get(SETTINGS, { type: "json" });
  if (!hasKeys() || !s?.refresh_token) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: s.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google sign-in expired: reconnect Google Calendar in your CRM (" + (j.error || r.status) + ")");
  return j.access_token;
}

// Creates the event on her Google Calendar with a Meet link and invites the client.
export async function createMeet(rec, store = crmStore()) {
  const token = await accessToken(store);
  if (!token) return null;
  const d = rec.data, start = new Date(rec.start || d.start_utc), end = new Date(start.getTime() + CALL_MINUTES * 60000);
  const body = {
    summary: `Free call: ${d.name || "Client"} × Jeselle Baril`,
    description: `${CALL_MINUTES}-minute discovery call.\nBusiness: ${d.business || "-"}\nService: ${d.service || "-"}\nClient: ${d.name || ""} <${d.email}>\n\nBooked via ${OWNER.site()}`,
    start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
    attendees: [{ email: d.email, displayName: d.name || undefined }],
    conferenceData: { createRequest: { requestId: rec.id, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }, { method: "popup", minutes: 10 }] },
    guestsCanModify: false,
  };
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const r = await fetch(`${base}?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let ev = await r.json();
  if (!r.ok) throw new Error("Google Calendar: " + (ev.error?.message || r.status));
  for (let i = 0; i < 3 && !ev.hangoutLink; i++) { // Meet link is sometimes still being made
    await new Promise((res) => setTimeout(res, 1200));
    ev = await (await fetch(`${base}/${ev.id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  }
  if (ev.hangoutLink) { // also paste the Meet link into the event's location and notes, so it's visible everywhere
    try {
      await fetch(`${base}/${ev.id}?sendUpdates=none`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ location: ev.hangoutLink, description: `🎥 Google Meet: ${ev.hangoutLink}\n\n${body.description}` }),
      });
    } catch {}
  }
  return { meetLink: ev.hangoutLink || "", eventId: ev.id, eventLink: ev.htmlLink || "" };
}

// A Google Meet room with no fixed time (for inquiries and briefs). Needs the Google Meet API enabled.
export async function createSpace(store = crmStore()) {
  const token = await accessToken(store);
  if (!token) return null;
  const r = await fetch("https://meet.googleapis.com/v2/spaces", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ config: { accessType: "TRUSTED" } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Google Meet: " + (j.error?.message || r.status));
  return { meetLink: j.meetingUri, meetCode: j.meetingCode };
}

export async function cancelMeet(rec, store = crmStore()) {
  if (!rec.gcalEventId) return false;
  const token = await accessToken(store);
  if (!token) return false;
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(rec.gcalEventId)}?sendUpdates=all`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  return r.ok || r.status === 410 || r.status === 404;
}
