// Shared backend logic: CRM storage, emails, calendar files, link checks.
import { getStore } from "@netlify/blobs";
import nodemailer from "nodemailer";
import crypto from "node:crypto";
import { scopeCheck, KIT_URL } from "./scope.mjs";

export const OWNER = {
  name: "Jeselle Baril",
  title: "Digital Solutions & Creative Services",
  email: () => process.env.GMAIL_USER || "bariljeselle@gmail.com",
  tz: "Asia/Manila",
  site: () => (process.env.SITE_URL || process.env.URL || "https://jeselleva.com").replace(/\/$/, ""),
};
export const CALL_MINUTES = 15;

// ---------- storage ----------
export const crmStore = () => getStore({ name: "crm", consistency: "strong" });

export function recordKey(data) {
  const type = (data.type || "Inquiry").toLowerCase().replace(/[^a-z]+/g, "-");
  const META = new Set(["ip", "user_agent", "referrer", "form-name", "bot-field", "type"]);
  const basis = JSON.stringify(Object.keys(data).filter((k) => !META.has(k) && !/^file_\d$/.test(k)).sort().map((k) => [k, data[k]]));
  return `${type}/${crypto.createHash("sha256").update(basis).digest("hex").slice(0, 20)}`;
}

// ---------- formatting ----------
export function fmt(date, tz, withYear = true) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", ...(withYear ? { year: "numeric" } : {}),
    hour: "numeric", minute: "2-digit", timeZone: tz || "UTC", timeZoneName: "short",
  }).format(date);
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const validTz = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return !!tz; } catch { return false; } };
export const clientTz = (rec) => (validTz(rec.data.client_time_zone) ? rec.data.client_time_zone : "UTC");
const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function gcalLink(start, title, details) {
  const end = new Date(start.getTime() + CALL_MINUTES * 60000);
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) +
    "&dates=" + icsDate(start) + "/" + icsDate(end) + "&details=" + encodeURIComponent(details);
}

export function buildIcs({ uid, start, title, description, attendeeName, attendeeEmail, method = "REQUEST" }) {
  const end = new Date(start.getTime() + CALL_MINUTES * 60000);
  const fold = (s) => s.replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jeselle Baril//Bookings//EN", "CALSCALE:GREGORIAN", `METHOD:${method}`,
    "BEGIN:VEVENT", `UID:${uid}@jeselleva`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${fold(title)}`, `DESCRIPTION:${fold(description)}`,
    `ORGANIZER;CN=${fold(OWNER.name)}:mailto:${OWNER.email()}`,
    attendeeEmail ? `ATTENDEE;CN=${fold(attendeeName || attendeeEmail)};RSVP=TRUE:mailto:${attendeeEmail}` : null,
    "BEGIN:VALARM", "TRIGGER:-PT60M", "ACTION:DISPLAY", "DESCRIPTION:Call in 1 hour", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

// ---------- link check (is a shared folder link public?) ----------
export async function checkLink(url) {
  if (!url || !/^https?:\/\//i.test(url)) return { url, status: "none" };
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (link check)" } });
    clearTimeout(t);
    const loc = r.headers.get("location") || "";
    if (r.status >= 300 && r.status < 400 && /accounts\.google\.com|ServiceLogin|\/login|signin/i.test(loc)) return { url, status: "private" };
    if (r.status === 401 || r.status === 403) return { url, status: "private" };
    if (r.status === 404) return { url, status: "broken" };
    if (r.status >= 200 && r.status < 400) {
      if (r.status < 300) {
        const body = (await r.text()).slice(0, 60000);
        if (/You need access|Request access|need permission|Sign in - Google Accounts/i.test(body)) return { url, status: "private" };
      }
      return { url, status: "public" };
    }
    return { url, status: "unknown" };
  } catch { return { url, status: "unknown" }; }
}
export const linkFields = ["materials_link", "assets_link"];

// ---------- email ----------
let _transport;
export function transport() {
  if (_transport) return _transport;
  if (process.env.MAIL_TEST === "1") { _transport = nodemailer.createTransport({ jsonTransport: true }); return _transport; }
  // On Cloudflare: Brevo's email API (same free 300 emails/day)
  if (process.env.BREVO_API_KEY) { _transport = nodemailer.createTransport({ brevoApi: true }); return _transport; }
  // Option A (no 2-Step Verification needed): Brevo free email service, 300 emails/day
  if (process.env.BREVO_LOGIN && process.env.BREVO_SMTP_KEY) {
    _transport = nodemailer.createTransport({ host: "smtp-relay.brevo.com", port: 587, secure: false, auth: { user: process.env.BREVO_LOGIN.trim(), pass: process.env.BREVO_SMTP_KEY.trim() } });
    return _transport;
  }
  // Option B: Gmail with an App Password
  if (process.env.GMAIL_APP_PASSWORD) {
    _transport = nodemailer.createTransport({ service: "gmail", auth: { user: OWNER.email(), pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") } });
    return _transport;
  }
  throw new Error("Email is not set up yet: add BREVO_API_KEY in your website settings");
}
export const sent = [];
export async function sendMail(msg) {
  const info = await transport().sendMail({ from: `"${OWNER.name}" <${OWNER.email()}>`, ...msg });
  sent.push(msg);
  return info;
}

const COLORS = { bg: "#F7F3EE", card: "#FFFFFF", ink: "#231E1B", muted: "#6E625A", accent: "#7A4E3A", line: "#E2D9CF" };
export function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:${COLORS.bg};font-family:Arial,Helvetica,sans-serif;color:${COLORS.ink}">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;color:${COLORS.ink}">Jeselle Baril <span style="font-size:13px;color:${COLORS.muted};font-family:Arial,sans-serif">· ${OWNER.title}</span></p>
<div style="background:${COLORS.card};border:1px solid ${COLORS.line};border-radius:8px;padding:24px">
<h1 style="margin:0 0 14px;font-family:Georgia,serif;font-weight:normal;font-size:26px;line-height:1.2">${esc(title)}</h1>
${bodyHtml}
</div>
<p style="margin:16px 0 0;font-size:12px;color:${COLORS.muted};text-align:center">${esc(OWNER.name)} · Bogo City, Cebu, Philippines · <a href="${OWNER.site()}" style="color:${COLORS.accent}">${OWNER.site().replace(/^https?:\/\//, "")}</a></p>
</div></body></html>`;
}
const p = (html) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${html}</p>`;
const btn = (href, label) => `<a href="${href}" style="display:inline-block;background:${COLORS.accent};color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px;font-size:14px;margin:4px 6px 4px 0">${esc(label)}</a>`;
// Instant video room that works with no setup (used until Google is connected). Unguessable: based on the record's hash.
export const roomLink = (rec) => `https://meet.jit.si/JeselleBarilVA-${rec.id}`;
const callName = (url) => (/meet\.google\.com/.test(url) ? "Google Meet" : "video call");
const joinBox = (url) => `<div style="background:#F7F3EE;border:1px solid ${COLORS.line};border-radius:6px;padding:16px;margin:0 0 14px;text-align:center"><a href="${esc(url)}" style="display:inline-block;background:#1A73E8;color:#fff;text-decoration:none;padding:14px 26px;border-radius:6px;font-size:16px;font-weight:bold">🎥 Join ${callName(url)}</a><p style="margin:10px 0 0;font-size:13px;color:${COLORS.muted}">One click at call time · <a href="${esc(url)}" style="color:${COLORS.accent}">${esc(url.replace(/^https:\/\//, ""))}</a></p></div>`;
const roomBox = (url, owner) => `<div style="background:#F7F3EE;border:1px solid ${COLORS.line};border-radius:6px;padding:14px;margin:0 0 14px"><p style="margin:0 0 8px;font-size:14px;line-height:1.5">🎥 <b>${owner ? `${callName(url)} link for this client` : `Your private ${callName(url)} link`}</b><br><span style="color:${COLORS.muted};font-size:13px">${owner ? "Use this link for any call with them." : "We'll use this link for our calls. I'll confirm the time with you first."}</span></p><a href="${esc(url)}" style="display:inline-block;background:#1A73E8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:bold">Join ${callName(url)}</a> <span style="font-size:13px;color:${COLORS.muted}">${esc(url.replace(/^https:\/\//, ""))}</span></div>`;
const scopeBox = (rec) => {
  const f = rec.scopeFlags || [];
  if (!f.length) return "";
  const items = f.map((x) => `<li style="margin:0 0 10px">${x.emoji} <b>${esc(x.name)}</b> <span style="color:${COLORS.muted};font-size:13px">(${esc(x.label)})</span>${x.warn ? ` <b style="color:#8A2E1E">Against platform rules. Don't accept.</b>` : ""}<br><span style="font-size:13px;color:${COLORS.muted}">They wrote: "${esc(x.quote)}"</span><br><span style="font-size:14px">👉 ${esc(x.todo)}</span></li>`).join("");
  return `<div style="background:#FBF3E4;border-left:3px solid #E0A526;padding:12px 14px;margin:0 0 14px;font-size:15px;line-height:1.5"><b>⚠️ Heads up: this may include work outside your listed services</b><ul style="margin:10px 0 6px;padding-left:18px">${items}</ul><span style="font-size:13px">Reply "Let me check and get back to you today." Templates: <a href="${KIT_URL}" style="color:${COLORS.accent}">Client Delivery Kit → "When a client asks for something not on your list"</a>. Not sure? Paste their message to Claude.</span></div>`;
};
const box = (html) => `<div style="background:${COLORS.bg};border-left:3px solid ${COLORS.accent};padding:12px 14px;margin:0 0 14px;font-size:15px;line-height:1.6">${html}</div>`;

const LABELS = {
  date_time_client: "Call time (client)", date_time_philippines: "Call time (Philippines)", client_time_zone: "Client time zone",
  business_description: "About the business", current_links: "Current links", service_details: "What they need",
  main_goal: "Main goal", success_3_months: "Success in 3 months", reference_links: "Reference links",
  brand_assets: "Brand materials", assets_link: "Materials folder link", materials_link: "Materials folder link",
  business_link: "Business page / website", content_by: "Texts & photos by", accounts_needed: "Accounts needed",
  current_tools: "Current tools", payment_method: "Payment method", update_channel: "Updates via", portfolio_permission: "Portfolio permission", selected_packages: "Picked on website", estimated_total: "Website estimate", picks_confirmed: "Picks confirmed", business_link: "Link to show", show_items: "What may be shown", project: "Project", consent: "Consent given",
};
const SKIP = new Set(["form-name", "bot-field", "start_utc", "type", "ip", "user_agent", "referrer"]);
export function detailsTable(data) {
  const rows = Object.entries(data).filter(([k, v]) => v && !SKIP.has(k)).map(([k, v]) => {
    const label = LABELS[k] || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    const val = esc(v).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${COLORS.accent}">$1</a>`);
    return `<tr><td style="padding:8px 10px;border-bottom:1px solid ${COLORS.line};font-size:13px;color:${COLORS.muted};vertical-align:top;width:38%">${esc(label)}</td><td style="padding:8px 10px;border-bottom:1px solid ${COLORS.line};font-size:14px;vertical-align:top">${val}</td></tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;margin:6px 0 14px">${rows}</table>`;
}
const fileLinks = (rec, label) => rec.files?.length ? p(`📎 <b>${label}:</b> ` + rec.files.map((u, i) => /^https:\/\//.test(u) ? `<a href="${esc(u)}" style="color:${COLORS.accent}">File ${i + 1}</a>` : esc(u)).join(" · ")) : "";
const linkNote = (checks) => checks.filter((c) => c.status !== "none").map((c) =>
  `${c.status === "public" ? "✅ Public" : c.status === "private" ? "⚠️ PRIVATE (needs access)" : c.status === "broken" ? "❌ Broken link" : "❔ Couldn't check"} — <a href="${esc(c.url)}" style="color:${COLORS.accent}">${esc(c.url)}</a>`).join("<br>");

// ---------- message builders ----------
export function bookingEmails(rec) {
  const d = rec.data, start = new Date(rec.start || d.start_utc), tz = clientTz(rec);
  const first = (d.name || "there").split(" ")[0];
  const clientTime = fmt(start, tz), phTime = fmt(start, OWNER.tz);
  const title = `Free call: ${d.name || "Client"} × Jeselle Baril`;
  const details = `15-minute call about ${d.business || "your business"}.\nService: ${d.service || "-"}\nQuestions? Reply to the confirmation email.`;
  const meet = rec.meetLink || "";
  const ics = buildIcs({ uid: rec.id, start, title, description: details + (meet ? `\nJoin the ${callName(meet)}: ${meet}` : ""), attendeeName: d.name, attendeeEmail: d.email });
  // With Google connected, Google itself sends the calendar invite, so skip the .ics to avoid a double entry
  const attach = rec.gcalEventId ? [] : [{ filename: "call-with-jeselle.ics", content: ics, contentType: "text/calendar; charset=utf-8; method=REQUEST" }];
  const client = {
    to: d.email, replyTo: OWNER.email(),
    subject: `${rec.type === "Booking" ? "Confirmed" : "Scheduled"}: your call with Jeselle – ${fmt(start, tz, false)}`,
    html: layout(`You're booked, ${first}!`,
      p(rec.type === "Booking" ? "Thank you for booking a free 15-minute call. Here's your schedule:" : `Thank you for your ${rec.type === "Project brief" ? "project brief" : "inquiry"}! I've scheduled a ${CALL_MINUTES}-minute call so we can talk it through:`) +
      box(`<b>${esc(clientTime)}</b><br><span style="color:${COLORS.muted};font-size:13px">${esc(phTime)} in the Philippines · ${CALL_MINUTES} minutes</span>`) +
      (meet ? joinBox(meet) : "") +
      (rec.gcalEventId
        ? p(`A Google Calendar invite is on its way too. You'll also get a reminder 24 hours and 1 hour before, with the same link.`)
        : p(`You'll get a reminder 24 hours and 1 hour before${meet ? ", with the same link" : ""}.`) +
          btn(gcalLink(start, title, details + (meet ? `\nJoin: ${meet}` : "")), "Add to Google Calendar") +
          p(`<span style="font-size:13px;color:${COLORS.muted}">The attached calendar file works with Apple Calendar and Outlook.</span>`)) +
      p(`<b>Get a head start:</b> fill in the <a href="${OWNER.site()}/brief.html" style="color:${COLORS.accent}">project brief</a> so I can prepare for our call.`) +
      p(`Need to change the time? Just reply to this email.`) +
      `<p style="margin:16px 0 0;font-size:13px;color:${COLORS.muted}">Your booking details</p>` + detailsTable(d)),
    attachments: attach,
  };
  const owner = {
    to: OWNER.email(), replyTo: d.email,
    subject: `${rec.scopeFlags?.length ? "⚠️ " : ""}📅 New booking: ${d.name} – ${fmt(start, OWNER.tz, false)}`,
    html: layout("New booking", scopeBox(rec) + box(`<b>${esc(phTime)}</b> (your time)<br><span style="color:${COLORS.muted};font-size:13px">${esc(clientTime)} for the client</span>`) +
      (meet ? joinBox(meet) : "") +
      (rec.gcalEventId ? p(`✅ Added to your Google Calendar and the client was invited.`)
        : btn(gcalLink(start, title, details + `\nClient email: ${d.email}` + (meet ? `\nJoin: ${meet}` : "")), "Add to my Google Calendar") +
          btn(`mailto:${encodeURIComponent(d.email)}`, "Email client")) +
      (rec.links?.length ? box("<b>Shared links</b><br>" + linkNote(rec.links)) : "") + detailsTable(d) +
      p(`<a href="${OWNER.site()}/admin.html" style="color:${COLORS.accent}">Open your CRM →</a>`)),
    attachments: attach,
  };
  return [client, owner];
}

export function reminderEmails(rec, label) {
  const d = rec.data, start = new Date(rec.start || d.start_utc), tz = clientTz(rec);
  const first = (d.name || "there").split(" ")[0];
  const when = label === "24h" ? "tomorrow" : "in 1 hour";
  const title = `Free call: ${d.name || "Client"} × Jeselle Baril`;
  const client = {
    to: d.email, replyTo: OWNER.email(),
    subject: `Reminder: our call is ${when} – ${fmt(start, tz, false)}`,
    html: layout(`See you ${when}, ${first}!`,
      p("This is a friendly reminder of our free 15-minute call:") +
      box(`<b>${esc(fmt(start, tz))}</b><br><span style="color:${COLORS.muted};font-size:13px">${esc(fmt(start, OWNER.tz))} in the Philippines</span>`) +
      (rec.meetLink ? joinBox(rec.meetLink) : btn(gcalLink(start, title, "15-minute call"), "Add to Google Calendar")) +
      p("Can't make it? Just reply to this email and we'll find a new time.")),
  };
  const owner = {
    to: OWNER.email(), replyTo: d.email,
    subject: `⏰ Reminder: call with ${d.name} ${when} – ${fmt(start, OWNER.tz, false)}`,
    html: layout(`Call ${when}`, box(`<b>${esc(fmt(start, OWNER.tz))}</b> with <b>${esc(d.name)}</b> (${esc(d.business || "")})<br>Client time: ${esc(fmt(start, tz))}`) +
      (rec.meetLink ? joinBox(rec.meetLink) : "") + btn(`mailto:${encodeURIComponent(d.email)}`, "Email client") + detailsTable(d)),
  };
  return [client, owner];
}

export function permissionEmails(rec) {
  const d = rec.data, first = (d.name || "there").split(" ")[0];
  const yes = !/^No/.test(d.portfolio_permission || "");
  const when = new Date(rec.createdAt || Date.now()).toLocaleString("en-US", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" }) + " (Philippine time)";
  const consent = d.consent ? `<br><br><b>✅ Consent given</b><br>${esc(d.name)}${d.business ? " of " + esc(d.business) : ""} agreed on ${when}:<br><i>“${esc(d.consent)}”</i>` : "";
  const summary = box(`<b>Your choice:</b> ${yes ? "📸" : "🔒"} ${esc(d.portfolio_permission)}<br><b>Business:</b> ${esc(d.business || "")}${d.project ? `<br><b>Project:</b> ${esc(d.project)}` : ""}${d.show_items ? `<br><b>What may be shown:</b> ${esc(d.show_items)}` : ""}${d.business_link ? `<br><b>Link to show:</b> ${esc(d.business_link)}` : ""}${d.message ? `<br><b>Please leave out:</b> ${esc(d.message)}` : ""}${consent}`);
  return [{
    to: d.email, replyTo: OWNER.email(),
    subject: `Portfolio permission confirmed – thank you, ${first}!`,
    html: layout(`Thank you, ${first}!`,
      p(yes ? "Thank you for letting me feature our work together. Here's what you chose:" : "Thank you for letting me know. I'll keep your project private. Here's what you chose:") + summary +
      p("You can change your answer anytime. Just reply to this email, and I'll update or remove it within 7 days. I never show private details like customer information, logins or the prices you charge.")),
  }, {
    to: OWNER.email(), replyTo: d.email,
    subject: `${yes ? "📸" : "🔒"} Portfolio permission: ${d.business || d.name}`,
    html: layout("Portfolio permission received", summary + detailsTable(d) +
      p(yes ? "Next: send Claude 2–5 images of the work and say \"add to selected works\"." : "Don't show this project anywhere.") +
      p(`<a href="${OWNER.site()}/admin.html" style="color:${COLORS.accent}">Open your CRM →</a>`)),
  }];
}

export function inquiryEmails(rec) {
  const d = rec.data, first = (d.name || "there").split(" ")[0];
  const privateLinks = (rec.links || []).filter((c) => c.status === "private");
  return [{
    to: d.email, replyTo: OWNER.email(),
    subject: `Thanks for your inquiry, ${first}!`,
    html: layout(`Thank you, ${first}!`,
      p(`I received your message about <b>${esc(d.service || "your project")}</b> and will reply within 1 working day with next steps.`) +
      (privateLinks.length ? box(`⚠️ <b>Your shared folder link is private.</b> Please open it, click <b>Share</b> → <b>General access</b> → <b>Anyone with the link</b> (Viewer), so I can see your files.`) : "") +
      (rec.meetLink ? roomBox(rec.meetLink) : "") +
      btn(`${OWNER.site()}/#book`, "Book a free call") + btn(`${OWNER.site()}/brief.html`, "Fill in project brief") +
      `<p style="margin:16px 0 0;font-size:13px;color:${COLORS.muted}">Your message</p>` + detailsTable(d)),
  }, {
    to: OWNER.email(), replyTo: d.email,
    subject: `${rec.scopeFlags?.length ? "⚠️ " : ""}✉️ New inquiry: ${d.name}${d.business ? " – " + d.business : ""}`,
    html: layout("New inquiry", scopeBox(rec) + (rec.meetLink ? roomBox(rec.meetLink, true) : "") + (rec.links?.length ? box("<b>Shared links</b><br>" + linkNote(rec.links)) : "") + detailsTable(d) +
      fileLinks(rec, "Uploaded files") +
      p(`<a href="${OWNER.site()}/admin.html" style="color:${COLORS.accent}">Open your CRM →</a>`)),
  }];
}

function picksBox(d, owner) {
  if (!d.selected_packages && !d.portfolio_permission && !d.budget) return "";
  const rows = [];
  if (d.selected_packages) rows.push(`<b>${owner ? "Picked on the website" : "Your picked services"}</b>${d.picks_confirmed && owner ? ` <span style="color:${/^Yes/.test(d.picks_confirmed) ? "#2F6B3F" : "#B5761A"}">(${esc(d.picks_confirmed)})</span>` : ""}<br>` +
    esc(d.selected_packages).split("\n").map((l) => /^\s+Note:/.test(l) ? `<span style="display:block;margin:0 0 6px 14px;color:${COLORS.muted}">📝 ${l.trim().replace(/^Note:\s*/, "")}</span>` : `<span style="display:block;margin-top:4px">• ${l}</span>`).join(""));
  if (d.estimated_total) rows.push(`<b>${owner ? "Website estimate" : "Estimate"}:</b> ${esc(d.estimated_total)}${owner ? "" : " (the final price is in your written quote)"}`);
  if (owner && d.budget) rows.push(`<b>Budget:</b> ${esc(d.budget)}${d.timeline ? " · <b>Timeline:</b> " + esc(d.timeline) : ""}`);
  if (owner && d.portfolio_permission) rows.push(`<b>Portfolio:</b> ${/^No/.test(d.portfolio_permission) ? "🔒 " : "📸 "}${esc(d.portfolio_permission)}`);
  return box(rows.join(`<span style="display:block;height:10px"></span>`));
}
export function briefEmails(rec) {
  const d = rec.data, first = (d.name || "there").split(" ")[0];
  const privateLinks = (rec.links || []).filter((c) => c.status === "private");
  return [{
    to: d.email, replyTo: OWNER.email(),
    subject: `Project brief received – thank you, ${first}!`,
    html: layout("Your project brief is in!",
      p(`Thank you for the details about <b>${esc(d.business || "your business")}</b>. I'll review everything and reply within 1 working day with a plan and quote.`) +
      picksBox(d, false) +
      (d.payment_method ? p(`<b>Payment:</b> after you accept the quote, I'll email you a private payment link for <b>${esc(d.payment_method)}</b>.`) : "") +
      (privateLinks.length ? box(`⚠️ <b>Your shared folder link is private.</b> Please open it, click <b>Share</b> → <b>General access</b> → <b>Anyone with the link</b> (Viewer), so I can see your files.`) : "") +
      (rec.meetLink ? roomBox(rec.meetLink) : "") +
      p("Want to talk it through sooner? Pick a time and you'll get your call link right away.") + btn(`${OWNER.site()}/#book`, "Book a free call") +
      `<p style="margin:16px 0 0;font-size:13px;color:${COLORS.muted}">A copy of your answers</p>` + detailsTable(d)),
  }, {
    to: OWNER.email(), replyTo: d.email,
    subject: `${rec.scopeFlags?.length ? "⚠️ " : ""}🗂️ New project brief: ${d.business || d.name}`,
    html: layout("New project brief", scopeBox(rec) + picksBox(d, true) + (rec.meetLink ? roomBox(rec.meetLink, true) : "") + (rec.links?.length ? box("<b>Shared links</b><br>" + linkNote(rec.links)) : "") + detailsTable(d) +
      fileLinks(rec, "Uploaded files") +
      p(`<a href="${OWNER.site()}/admin.html" style="color:${COLORS.accent}">Open your CRM →</a>`)),
  }];
}


export function paymentEmails(rec) {
  const d = rec.data, first = (d.name || "there").split(" ")[0];
  return [{
    to: d.email, replyTo: OWNER.email(),
    subject: `Proof of payment received – thank you, ${first}!`,
    html: layout(`Thank you, ${first}!`,
      p(`I received your proof of payment of <b>${esc(d.amount)}</b> via <b>${esc(d.payment_method)}</b>. I'll verify it and confirm by email within 1 working day (Mon–Fri), then we'll get started.`) +
      `<p style="margin:16px 0 0;font-size:13px;color:${COLORS.muted}">Your payment details</p>` + detailsTable(d)),
  }, {
    to: OWNER.email(), replyTo: d.email,
    subject: `💰 Payment proof: ${d.amount} via ${d.payment_method} – ${d.name}`,
    html: layout("New payment proof", box(`<b>${esc(d.amount)}</b> via <b>${esc(d.payment_method)}</b>${d.reference ? "<br>Reference: " + esc(d.reference) : ""}`) +
      p("Check your GCash / Maya / Wise / Remitly app to confirm the money arrived, then reply to the client.") +
      fileLinks(rec, "Receipt") + detailsTable(d) +
      p(`<a href="${OWNER.site()}/admin.html" style="color:${COLORS.accent}">Open your CRM →</a>`)),
  }];
}

// ---------- main entry: a form was submitted ----------
export async function handleSubmission(data, { store = crmStore() } = {}) {
  data = Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v == null ? "" : typeof v === "object" ? (v.url || JSON.stringify(v)) : String(v)]));
  if (data["bot-field"]) return { skipped: "spam" };
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return { skipped: "no valid email" };
  const type = data.type || (data.start_utc ? "Booking" : "Inquiry");
  data.type = type;
  if (type === "Portfolio permission" && (!data.consent || !data.portfolio_permission)) return { skipped: "no consent" };
  const key = recordKey(data);
  const files = Object.keys(data).filter((k) => /^file_\d$/.test(k) && data[k]);
  const links = await Promise.all(linkFields.filter((f) => data[f]).map((f) => checkLink(data[f])));
  const rec = { id: key.split("/")[1], key, type, status: type === "Booking" ? "Call booked" : type === "Payment" ? "Payment to verify" : type === "Portfolio permission" ? "Permission received" : "New", createdAt: new Date().toISOString(), data, links, files: files.length ? files.map((k) => data[k]) : null, notes: "", reminders: {} };
  if (type === "Booking") {
    const start = new Date(data.start_utc);
    if (isNaN(start)) return { skipped: "bad start time" };
    rec.start = start.toISOString();
  }
  if (type !== "Payment" && type !== "Portfolio permission") { try { rec.scopeFlags = scopeCheck(data); } catch { rec.scopeFlags = []; } }
  // Capacity: can she take this on, and by the date they asked? (shown in the CRM card)
  if (type === "Project brief" || type === "Inquiry" || type === "Booking") { try { const c = await import("./capacity.mjs"); rec.capacity = c.checkRequest(data, await c.loadCapacity(store || crmStore())); rec.capacity.at = c.phDay(); } catch (e) { console.log("capacity:", e.message); } }
  // onlyIfNew = process each submission exactly once, even if two triggers fire
  const res = await store.setJSON(key, rec, { onlyIfNew: true });
  if (res && res.modified === false) return { skipped: "duplicate" };
  if (type === "Booking") {
    try {
      const { createMeet } = await import("./google.mjs");
      const m = await createMeet(rec, store);
      if (m) { rec.meetLink = m.meetLink; rec.gcalEventId = m.eventId; rec.gcalEventLink = m.eventLink; }
    } catch (e) { rec.meetError = e.message; }
  } else if (type === "Inquiry" || type === "Project brief") {
    try {
      const { createSpace } = await import("./google.mjs");
      const m = await createSpace(store);
      if (m) { rec.meetLink = m.meetLink; rec.meetRoom = true; }
    } catch (e) { rec.meetError = e.message; }
  }
  if (type !== "Payment" && type !== "Portfolio permission" && !rec.meetLink) { rec.meetLink = roomLink(rec); rec.meetFallback = true; }
  const mails = type === "Booking" ? bookingEmails(rec) : type === "Project brief" ? briefEmails(rec) : type === "Payment" ? paymentEmails(rec) : type === "Portfolio permission" ? permissionEmails(rec) : inquiryEmails(rec);
  const results = [];
  for (const m of mails) { try { await sendMail(m); results.push("sent:" + m.to); } catch (e) { results.push("failed:" + m.to + ":" + e.message); } }
  rec.emailLog = results;
  await store.setJSON(key, rec);
  try {
    const { sendPush } = await import("./push.mjs");
    const icon = { Booking: "📅", Inquiry: "💬", "Project brief": "📝", Payment: "💰", "Portfolio permission": "📸" }[type] || "🔔";
    const who = data.name || data.email;
    const body = type === "Booking" ? "Call on " + new Date(rec.start).toLocaleString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " (PH time)"
      : type === "Payment" ? [data.amount, data.payment_method].filter(Boolean).join(" via ") || "Proof of payment uploaded"
      : type === "Portfolio permission" ? (data.portfolio_permission || "") + (data.business ? " · " + data.business : "")
      : type === "Project brief" ? (data.service || "New project brief") + (data.estimated_total ? " · " + data.estimated_total : "")
      : String(data.message || data.service || "New message").slice(0, 120);
    await sendPush({ title: `${icon} New ${type.toLowerCase()}: ${who}${rec.scopeFlags?.length ? " ⚠️" : ""}${rec.capacity?.tooSoon ? " ⏳" : ""}`, body, url: "/admin.html#" + key, tag: key, perm: type === "Payment" ? "payments" : "bookings" }, store);
  } catch {}
  return { ok: true, key, results };
}

// ---------- reminders (run every 15 min) ----------
export async function runReminders({ store = crmStore(), now = new Date() } = {}) {
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: "json" });
    if (b.key.startsWith("settings/") || !rec || !rec.start || /cancel|lost/i.test(rec.status || "")) continue;
    const mins = (new Date(rec.start) - now) / 60000;
    if (mins <= 0) continue;
    let label = null;
    if (mins <= 70 && !rec.reminders?.["1h"]) label = "1h";
    else if (mins <= 24 * 60 + 10 && mins > 70 && !rec.reminders?.["24h"]) label = "24h";
    if (!label) continue;
    rec.reminders = { ...(rec.reminders || {}), [label]: now.toISOString() };
    if (label === "1h") rec.reminders["24h"] = rec.reminders["24h"] || "skipped";
    await store.setJSON(b.key, rec);
    for (const m of reminderEmails(rec, label)) { try { await sendMail(m); out.push(`${label}:${m.to}`); } catch (e) { out.push(`fail:${m.to}:${e.message}`); } }
  }
  return out;
}

// ---------- Daily nudges: follow-ups due, quotes with no reply, new requests not answered ----------
const DAY = 86400000;
const phDate = (d) => new Date(new Date(d).getTime() + 8 * 3600000).toISOString().slice(0, 10);
export function nudgeList(recs, now = new Date()) {
  const today = phDate(now), out = [];
  for (const r of recs) {
    if (!r || !r.type || r.type === "Portfolio permission" || /won|lost|cancel|paid/i.test(r.status || "")) continue;
    const who = (r.data && (r.data.business || r.data.name)) || "A client";
    const since = new Date(r.statusAt || r.createdAt || now);
    if (r.followUp && r.followUp <= today) out.push({ key: r.key, kind: "follow", text: `Follow up with ${who}${r.followUp < today ? " (was due " + r.followUp + ")" : " today"}` });
    else if (r.status === "Proposal sent" && now - since >= 3 * DAY) out.push({ key: r.key, kind: "quote", text: `${who} hasn't replied to your quote in ${Math.floor((now - since) / DAY)} days. Send a friendly check-in.` });
    else if (r.status === "New" && r.type !== "Payment" && now - since >= DAY) out.push({ key: r.key, kind: "new", text: `${who}'s ${String(r.type).toLowerCase()} is still marked New after ${Math.floor((now - since) / DAY)} day(s). Reply and set it to Contacted.` });
    else if (r.status === "Payment to verify" && now - since >= DAY) out.push({ key: r.key, kind: "pay", text: `Check ${who}'s payment proof and record it as income.` });
  }
  return out;
}
export async function runNudges({ store = crmStore(), now = new Date() } = {}) {
  const { blobs } = await store.list();
  const recs = [];
  for (const b of blobs) { if (/^(settings|income|expense)\//.test(b.key)) continue; const r = await store.get(b.key, { type: "json" }); if (r) recs.push(r); }
  const list = nudgeList(recs, now);
  const today = phDate(now);
  const last = await store.get("settings/nudges-sent", { type: "json" });
  if (!list.length || last?.date === today) return { count: list.length, skipped: !list.length ? "nothing due" : "already sent today" };
  await store.setJSON("settings/nudges-sent", { date: today, count: list.length });
  const items = list.map((n) => `<li style="margin:0 0 8px">${{ follow: "📅", quote: "⏳", new: "🆕", pay: "💰" }[n.kind]} ${esc(n.text)}</li>`).join("");
  try { await sendMail({ to: OWNER.email(), subject: `☀️ ${list.length} thing${list.length > 1 ? "s" : ""} to follow up today`, html: layout("Today's follow-ups", `<ul style="padding-left:18px;margin:0 0 14px">${items}</ul>` + p(`<a href="${OWNER.site()}/admin.html" style="color:${COLORS.accent}">Open your CRM →</a>`)) }); } catch {}
  try { const { sendPush } = await import("./push.mjs"); await sendPush({ title: `☀️ ${list.length} follow-up${list.length > 1 ? "s" : ""} today`, body: list.slice(0, 2).map((n) => n.text).join(" · "), url: "/admin.html#today", tag: "nudges-" + today, perm: "bookings" }, store); } catch {}
  return { count: list.length };
}

// ---------- Monthly backup: on the 1st, email last month's income, expenses and clients as CSV files ----------
const csvCell2 = (v) => { let t = String(v ?? ""); if (/^[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
const toCsv = (head, rows) => "﻿" + [head, ...rows].map((r) => r.map(csvCell2).join(",")).join("\n");
export async function runMonthlyBackup({ store = crmStore(), now = new Date() } = {}) {
  const ph = new Date(now.getTime() + 8 * 3600000);
  const prev = new Date(Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth() - 1, 15));
  const month = prev.toISOString().slice(0, 7);
  const label = prev.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const done = await store.get("settings/backup-sent", { type: "json" });
  if (done?.month === month) return { skipped: "already sent", month };
  const { blobs } = await store.list();
  const income = [], expenses = [], clients = [];
  for (const b of blobs) {
    if (b.key.startsWith("settings/")) continue;
    const r = await store.get(b.key, { type: "json" }); if (!r) continue;
    if (b.key.startsWith("income/")) { if ((r.date || "").startsWith(month)) income.push(r); }
    else if (b.key.startsWith("expense/")) { if ((r.date || "").startsWith(month)) expenses.push(r); }
    else if (r.createdAt && new Date(new Date(r.createdAt).getTime() + 8 * 3600000).toISOString().startsWith(month)) clients.push(r);
  }
  const by = (a, b) => (a.date || a.createdAt || "").localeCompare(b.date || b.createdAt || "");
  income.sort(by); expenses.sort(by); clients.sort(by);
  const inTot = income.reduce((a, r) => a + (Number(r.php) || 0), 0), exTot = expenses.reduce((a, r) => a + (Number(r.php) || 0), 0);
  const attachments = [
    { filename: `income-${month}.csv`, content: toCsv(["Date", "Invoice no.", "Client", "Service", "Description", "Amount", "Currency", "Received (PHP)", "Payment method", "Reference no.", "Attachments", "Notes"],
      [...income.map((r) => [r.date, r.invoice || "", r.client, r.service, r.description, r.amount, r.currency, r.php, r.method, r.reference, (r.files || []).length, r.notes]), ["", "", "", "", "TOTAL", "", "", inTot.toFixed(2), "", "", "", ""]]) },
    { filename: `expenses-${month}.csv`, content: toCsv(["Date", "Category", "What", "Paid to", "Amount (PHP)", "Full bill (PHP)", "Work share %", "Paid with", "Receipt kept", "Attachments", "Notes"],
      [...expenses.map((r) => [r.date, r.category, r.description, r.vendor, r.php, r.bill ?? "", r.workpct ?? "", r.method, r.receipt ? "Yes" : "No", (r.files || []).length, r.notes]), ["", "", "TOTAL", "", exTot.toFixed(2), "", "", "", "", "", ""]]) },
    { filename: `clients-${month}.csv`, content: toCsv(["Received", "Type", "Status", "Name", "Email", "Business", "Service", "Picked on website", "Estimate", "Notes"],
      clients.map((r) => { const d = r.data || {}; return [r.createdAt, r.type, r.status, d.name, d.email, d.business, d.service, d.selected_packages, d.estimated_total, r.notes]; })) },
  ];
  const peso = (n) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await sendMail({ to: OWNER.email(), subject: `🗂️ Your ${label} backup: income, expenses and clients`, attachments,
    html: layout(`${label} backup`, p(`Here are your records for <b>${label}</b>, attached as files you can open in Excel or Google Sheets.`) +
      box(`<b>Income:</b> ${peso(inTot)} (${income.length} payment${income.length === 1 ? "" : "s"})<br><b>Expenses:</b> ${peso(exTot)} (${expenses.length})<br><b>Profit:</b> ${peso(inTot - exTot)}<br><b>New clients and requests:</b> ${clients.length}`) +
      p("Tip: save these in your Google Drive folder \"Bookkeeping [year]\". Receipt photos stay safely in your CRM.") +
      p(`<a href="${OWNER.site()}/admin.html#income" style="color:${COLORS.accent}">Open your CRM →</a>`)) });
  await store.setJSON("settings/backup-sent", { month, at: now.toISOString() });
  return { month, income: income.length, expenses: expenses.length, clients: clients.length };
}
