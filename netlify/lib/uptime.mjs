// Downtime alerts: every 15 minutes, check that the main pages open.
// Emails you once when the site is down (after 2 failed checks in a row) and once when it's back.
import { crmStore, sendMail, layout, OWNER } from "./core.mjs";

const PAGES = ["/", "/services", "/book", "/contact"];

export async function checkPages(base, fetchFn = fetch) {
  const bad = [];
  for (const p of PAGES) {
    try {
      const r = await fetchFn(base + p + (p.includes("?") ? "&" : "?") + "uptime=" + Date.now(), { headers: { "user-agent": "jeselleva-uptime" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      const t = r.ok ? await r.text() : "";
      if (!r.ok) bad.push(`${p}: error ${r.status}`);
      else if (!t.includes("JB")) bad.push(`${p}: page opened but looks empty or broken`);
    } catch (e) { bad.push(`${p}: did not open (${e.name === "TimeoutError" ? "too slow" : e.message})`); }
  }
  return bad;
}

export async function runUptime({ store = crmStore(), base = OWNER.site(), fetchFn = fetch } = {}) {
  const bad = await checkPages(base, fetchFn);
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

// Daily: warn 30, 14 and 3 days before the domain expires (if auto-renew is off or the card failed)
export async function runDomainCheck({ store = crmStore(), base = OWNER.site() } = {}) {
  const host = new URL(base).hostname, tld = host.split(".").pop();
  if (tld !== "com") return "skip";
  const r = await fetch(`https://rdap.verisign.com/com/v1/domain/${host}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) return "rdap " + r.status;
  const exp = ((await r.json()).events || []).find((e) => e.eventAction === "expiration")?.eventDate;
  if (!exp) return "no date";
  const days = Math.floor((new Date(exp) - Date.now()) / 86400000);
  const s = (await store.get("settings/uptime", { type: "json" }).catch(() => null)) || {};
  s.domainExpires = exp;
  const step = days <= 3 ? 3 : days <= 14 ? 14 : days <= 30 ? 30 : 0;
  if (step && s.domainWarned !== step + ":" + exp) {
    s.domainWarned = step + ":" + exp;
    await sendMail({ to: OWNER.email(), subject: `⚠️ ${host} expires in ${days} days`, html: layout("Your domain is about to expire",
      `<p>Your domain <b>${host}</b> expires on <b>${new Date(exp).toDateString()}</b> (${days} days). If it expires, your website and emails stop working.</p><p>Renew it in your Cloudflare dashboard → Domain Registration, or turn on auto-renew. If auto-renew is already on, check that your card is still valid.</p>`) });
  }
  await store.setJSON("settings/uptime", s);
  return `${days} days left`;
}
