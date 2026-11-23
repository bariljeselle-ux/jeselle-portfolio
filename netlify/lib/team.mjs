// Team accounts for the CRM: the owner (ADMIN_PASSWORD / her own password) adds staff who log in
// with their own email + password and only see what the owner allows.
// Staff list, login sessions and the activity log live in the private "crm" store under settings/.
import { crmStore, sendMail, layout, OWNER } from "./core.mjs";
import { checkAdminKey } from "./auth.mjs";

export const PERMS = {
  bookings: "Bookings, inquiries & briefs (calls, notes, follow-ups)",
  payments: "Payments & money (payment proofs, income, expenses)",
  reviews: "Reviews",
};
const ALL = Object.keys(PERMS);
const TEAM = "settings/team";
const SESSIONS = "settings/team-sessions";
const ACTIVITY = "settings/activity";
const SESSION_DAYS = 30, INVITE_DAYS = 7;

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n) => hex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
const sha = async (t) => hex(await subtle().digest("SHA-256", enc.encode(String(t))));
async function pbkdf2(pw, saltHex) {
  const key = await subtle().importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const cleanEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 120);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const listTeam = async (store = crmStore()) => (await store.get(TEAM, { type: "json" })) || [];
const saveTeam = (team, store) => store.setJSON(TEAM, team);
// What the CRM page may show about a team member (never password data)
export const publicMember = (m) => ({ id: m.id, name: m.name, email: m.email, perms: m.perms, active: m.active !== false, invited: !!m.invite && !m.pwHash, lastLogin: m.lastLogin || "", createdAt: m.createdAt });

// ---------- Who is calling? ----------
// Header x-admin-key: the owner's password, or "staff:<session token>" for a team member.
export async function actorFor(req, store = crmStore()) {
  const key = req.headers.get("x-admin-key") || "";
  if (key.startsWith("staff:")) {
    const token = key.slice(6);
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const sessions = (await store.get(SESSIONS, { type: "json" })) || {};
    const s = sessions[await sha(token)];
    if (!s || s.exp < Date.now()) return null;
    const m = (await listTeam(store)).find((x) => x.id === s.id);
    if (!m || m.active === false || !m.pwHash) return null;
    return { role: "staff", id: m.id, name: m.name, email: m.email, perms: m.perms || [] };
  }
  if (await checkAdminKey(key, store)) return { role: "owner", id: "owner", name: OWNER.name, email: OWNER.email(), perms: ALL };
  return null;
}
export const can = (actor, perm) => !!actor && (actor.role === "owner" || (actor.perms || []).includes(perm));
// Records: payment proofs need "payments", everything else needs "bookings"
export const permForRecord = (rec) => (rec?.type === "Payment" ? "payments" : "bookings");

// ---------- Activity log (owner sees it) ----------
export async function logActivity(actor, text, key = "", store = crmStore()) {
  try {
    const list = (await store.get(ACTIVITY, { type: "json" })) || [];
    list.unshift({ at: new Date().toISOString(), who: actor?.name || "System", role: actor?.role || "system", text: String(text).slice(0, 200), key });
    await store.setJSON(ACTIVITY, list.slice(0, 300));
  } catch (e) { console.log("activity log:", e.message); }
}
export const listActivity = async (store = crmStore()) => (await store.get(ACTIVITY, { type: "json" })) || [];

// ---------- Sessions ----------
async function newSession(id, store) {
  const token = rand(32);
  const sessions = (await store.get(SESSIONS, { type: "json" })) || {};
  for (const [h, s] of Object.entries(sessions)) if (s.exp < Date.now()) delete sessions[h];
  sessions[await sha(token)] = { id, exp: Date.now() + SESSION_DAYS * 864e5, at: new Date().toISOString() };
  await store.setJSON(SESSIONS, sessions);
  return token;
}
async function endSessions(id, store) {
  const sessions = (await store.get(SESSIONS, { type: "json" })) || {};
  for (const [h, s] of Object.entries(sessions)) if (s.id === id || s.exp < Date.now()) delete sessions[h];
  await store.setJSON(SESSIONS, sessions);
}
export async function logoutStaff(req, store = crmStore()) {
  const key = req.headers.get("x-admin-key") || "";
  if (!key.startsWith("staff:")) return;
  const sessions = (await store.get(SESSIONS, { type: "json" })) || {};
  delete sessions[await sha(key.slice(6))];
  await store.setJSON(SESSIONS, sessions);
}

// ---------- Staff login ----------
const fail = (error, status = 400) => ({ status, error });
export async function staffLogin(email, password, store = crmStore()) {
  email = cleanEmail(email); password = String(password || "");
  const team = await listTeam(store);
  const m = team.find((x) => x.email === email);
  const wrong = fail("Wrong email or password.", 401);
  if (!m || !m.pwHash || m.active === false) { await sha(password); return m && m.active === false ? fail("Your access was turned off. Please ask the owner.", 403) : wrong; }
  if (m.lockUntil && m.lockUntil > Date.now()) return fail("Too many tries. Please wait 15 minutes and try again.", 429);
  if (!same(await pbkdf2(password, m.pwSalt), m.pwHash)) {
    m.fails = (m.fails || 0) + 1;
    if (m.fails >= 5) { m.lockUntil = Date.now() + 15 * 60000; m.fails = 0; }
    await saveTeam(team, store);
    return wrong;
  }
  m.fails = 0; m.lockUntil = 0; m.lastLogin = new Date().toISOString();
  await saveTeam(team, store);
  await logActivity({ name: m.name, role: "staff" }, "logged in", "", store);
  return { ok: true, token: await newSession(m.id, store), name: m.name };
}

async function setPassword(m, next) {
  next = String(next || "");
  if (next.length < 8) return "Use at least 8 characters.";
  if (next.length > 200) return "That password is too long.";
  m.pwSalt = rand(16); m.pwHash = await pbkdf2(next, m.pwSalt); m.pwAt = new Date().toISOString();
  return "";
}
// Staff changes their own password (needs the current one)
export async function staffChangePassword(actor, current, next, store = crmStore()) {
  const team = await listTeam(store);
  const m = team.find((x) => x.id === actor.id);
  if (!m || !same(await pbkdf2(String(current || ""), m.pwSalt), m.pwHash)) return fail("Your current password is not correct.", 401);
  const err = await setPassword(m, next);
  if (err) return fail(err);
  await saveTeam(team, store);
  return { ok: true };
}

// ---------- Invites: the team member chooses their own password from an emailed link ----------
async function sendInvite(m, store) {
  const token = rand(24);
  m.invite = { hash: await sha(token), exp: Date.now() + INVITE_DAYS * 864e5 };
  const link = `${OWNER.site()}/admin.html#invite=${token}`;
  if (process.env.MAIL_TEST === "1") console.log("INVITE LINK", m.email, link);
  const p = (t) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${t}</p>`;
  await sendMail({
    to: m.email, replyTo: OWNER.email(),
    subject: `You're invited to help manage ${OWNER.name}'s CRM`,
    html: layout(`Hi ${esc(m.name)}!`, p(`${esc(OWNER.name)} added you to the team for her client CRM. You can help with: <b>${m.perms.map((x) => esc(PERMS[x] || x)).join("; ")}</b>.`) +
      p("Tap the button to choose your own password. The link works once and expires in 7 days.") +
      `<a href="${link}" style="display:inline-block;background:#7A4E3A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px;font-size:14px">Set my password</a>` +
      `<p style="margin:16px 0 0;font-size:13px;color:#6E625A">After that, log in any time at <a href="${OWNER.site()}/admin.html" style="color:#7A4E3A">${OWNER.site().replace(/^https?:\/\//, "")}/admin.html</a> with your email and password. Please don't share your login.</p>`),
  });
}
export async function acceptInvite(token, next, store = crmStore()) {
  token = String(token || "");
  if (!/^[0-9a-f]{48}$/.test(token)) return fail("This invite link is not valid. Ask the owner to send a new one.");
  const h = await sha(token);
  const team = await listTeam(store);
  const m = team.find((x) => x.invite && same(x.invite.hash, h));
  if (!m || m.invite.exp < Date.now() || m.active === false) return fail("This invite link has expired or was already used. Ask the owner to send a new one.");
  const err = await setPassword(m, next);
  if (err) return fail(err);
  m.invite = null; m.lastLogin = new Date().toISOString();
  await saveTeam(team, store);
  await logActivity({ name: m.name, role: "staff" }, "set their password and joined the team", "", store);
  return { ok: true, token: await newSession(m.id, store), name: m.name };
}

// ---------- Owner: manage the team ----------
export async function saveMember(actor, input, store = crmStore()) {
  const name = String(input.name || "").trim().slice(0, 80);
  const email = cleanEmail(input.email);
  const perms = (Array.isArray(input.perms) ? input.perms : []).filter((p) => ALL.includes(p));
  if (!name) return fail("Type their name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Type a valid email address.");
  if (email === cleanEmail(OWNER.email())) return fail("That's your own email. Use a different one for team members.");
  if (!perms.length) return fail("Tick at least one thing they can help with.");
  const team = await listTeam(store);
  if (team.some((x) => x.email === email && x.id !== input.id)) return fail("Someone on your team already uses that email.");
  let m = input.id ? team.find((x) => x.id === input.id) : null;
  if (input.id && !m) return fail("Not found", 404);
  const isNew = !m;
  if (isNew) { if (team.length >= 20) return fail("Up to 20 team members."); m = { id: rand(6), createdAt: new Date().toISOString(), active: true }; team.push(m); }
  const emailChanged = !isNew && m.email !== email;
  m.name = name; m.email = email; m.perms = perms;
  if (typeof input.active === "boolean") m.active = input.active;
  if (emailChanged) { m.pwHash = ""; m.pwSalt = ""; await endSessions(m.id, store); }
  let mailError = "";
  if (isNew || emailChanged) { try { await sendInvite(m, store); } catch (e) { mailError = e.message; } }
  if (m.active === false) await endSessions(m.id, store);
  await saveTeam(team, store);
  await logActivity(actor, isNew ? `added ${name} to the team (${perms.join(", ")})` : `updated ${name}'s access (${m.active === false ? "turned off" : perms.join(", ")})`, "", store);
  return { ok: true, member: publicMember(m), mailError };
}
export async function resendInvite(actor, id, store = crmStore()) {
  const team = await listTeam(store);
  const m = team.find((x) => x.id === id);
  if (!m) return fail("Not found", 404);
  m.pwHash = ""; m.pwSalt = ""; m.active = true; m.fails = 0; m.lockUntil = 0;
  await endSessions(m.id, store);
  try { await sendInvite(m, store); } catch (e) { return fail("Couldn't send the email: " + e.message, 502); }
  await saveTeam(team, store);
  await logActivity(actor, `sent ${m.name} a new set-password link`, "", store);
  return { ok: true, member: publicMember(m) };
}
export async function removeMember(actor, id, store = crmStore()) {
  const team = await listTeam(store);
  const m = team.find((x) => x.id === id);
  if (!m) return fail("Not found", 404);
  await endSessions(id, store);
  await saveTeam(team.filter((x) => x.id !== id), store);
  await logActivity(actor, `removed ${m.name} from the team`, "", store);
  return { ok: true };
}
// Who can be assigned to a record of this kind (active members with the right access)
export async function assignable(perm, store = crmStore()) {
  return (await listTeam(store)).filter((m) => m.active !== false && (m.perms || []).includes(perm));
}
