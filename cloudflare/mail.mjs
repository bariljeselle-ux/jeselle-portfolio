// Cloudflare replacement for "nodemailer": sends through Brevo's email API (works on Cloudflare,
// same 300 free emails/day). Needs the BREVO_API_KEY secret.
const toB64 = (s) => {
  const bytes = typeof s === "string" ? new TextEncoder().encode(s) : new Uint8Array(s);
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const addr = (v) => {
  if (!v) return null;
  const m = String(v).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2].trim() } : { email: String(v).trim() };
};
const list = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map(addr).filter((x) => x && x.email);

function createTransport(opts = {}) {
  return {
    async sendMail(msg) {
      if (opts.jsonTransport) return { message: JSON.stringify(msg) };
      const key = (globalThis.process?.env?.BREVO_API_KEY || "").trim();
      if (!key) throw new Error("Email is not set up yet: add the BREVO_API_KEY secret in Cloudflare");
      const body = {
        sender: addr(msg.from), to: list(msg.to), subject: msg.subject,
        htmlContent: msg.html || undefined, textContent: msg.html ? undefined : (msg.text || " "),
      };
      if (msg.replyTo) body.replyTo = addr(msg.replyTo);
      if (msg.cc) body.cc = list(msg.cc);
      if (msg.bcc) body.bcc = list(msg.bcc);
      if (msg.attachments?.length) body.attachment = msg.attachments.map((a) => ({ name: a.filename, content: toB64(a.content) }));
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST", headers: { "api-key": key, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("Brevo: " + (j.message || r.status));
      return { messageId: j.messageId };
    },
    async verify() { return true; },
  };
}
export default { createTransport };
export { createTransport };
