// Downtime alerts: every 15 minutes, check that the main pages open.
// Emails you once when the site is down (after 2 failed checks in a row) and once when it's back.
import { crmStore, sendMail, layout, OWNER } from "./core.mjs";

const PAGES = ["/", "/services", "/book", "/contact"];

export async function checkPages(base) {
  const bad = [];
  for (const p of PAGES) {
    try {
      const r = await fetch(base + p + (p.includes("?") ? "&" : "?") + "uptime=" + Date.now(), { headers: { "user-agent": "jeselleva-uptime" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      const t = r.ok ? await r.text() : "";
      if (!r.ok) bad.push(`${p}: error ${r.status}`);
      else if (!t.includes("JB")) bad.push(`${p}: page opened but looks empty or broken`);
    } catch (e) { bad.push(`${p}: did not open (${e.name === "TimeoutError" ? "too slow" : e.message})`); }
  }
  return bad;
}

export async function runUptime({ store = crmStore(), base = OWNER.site() } = {}) {
  const bad = await checkPages(base);
  const s = (await store.get("settings/uptime", { type: "json" }).catch(() => null)) || { fails: 0, down: false };
  const now = new Date().toISOString();
  let note = "ok";
  if (bad.length) {
    s.fails = (s.fails || 0) + 1; s.lastProblem = bad; s.lastFailAt = now;
    if (s.fails >= 2 && !s.down) {
      s.down = true; s.downSince = now; note = "alert sent";
      await sendMail({ to: OWNER.email(), subject: "⚠️ Your website may be down", html: layout("Your website may be down",
        `<p>I checked ${base} twice in a row (15 minutes apart) and some pages didn't open properly:</p><ul>${bad.map((b) => `<li>${b}</li>`).join("")}</ul>` +
        `<p>What to do: open <a href="${base}">${base}</a> on your phone with mobile data. If it doesn't load, check that your domain hasn't expired (Cloudflare dashboard → Domains), then ask Claude to look at it. I'll email you again when it's back.</p>`) });
    } else note = "problem " + s.fails;
  } else {
    if (s.down) {
      note = "recovery sent";
      await sendMail({ to: OWNER.email(), subject: "✅ Your website is back up", html: layout("Your website is back up", `<p>${base} is opening normally again. It was down from about ${new Date(s.downSince).toLocaleString("en-US", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} (PH time).</p>`) });
    }
    s.fails = 0; s.down = false; s.lastOkAt = now;
  }
  await store.setJSON("settings/uptime", s);
  return note;
}
