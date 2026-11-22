// Cloudflare replacement for "web-push" (phone/computer notifications), built on Web Crypto.
// Uses the same key format as web-push, so devices already subscribed keep working.
const enc = new TextEncoder();
const b64u = (buf) => { const b = new Uint8Array(buf); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const concat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const S = crypto.subtle;

let vapid = null;
export function setVapidDetails(subject, publicKey, privateKey) { vapid = { subject, publicKey, privateKey }; }

export async function generateVAPIDKeys() {
  const kp = await S.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await S.exportKey("jwk", kp.privateKey);
  return { publicKey: b64u(concat([4], unb64u(jwk.x), unb64u(jwk.y))), privateKey: jwk.d };
}

async function vapidHeader(endpoint) {
  const pub = unb64u(vapid.publicKey);
  const key = await S.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: vapid.privateKey, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject })));
  const sig = await S.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await S.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await S.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bytes * 8));

// RFC 8291 (aes128gcm) message encryption
export async function encrypt(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const local = await S.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await S.exportKey("raw", local.publicKey));
  const uaKey = await S.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await S.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await S.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const data = typeof payload === "string" ? enc.encode(payload) : new Uint8Array(payload || []);
  const cipher = new Uint8Array(await S.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(data, [2])));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, [asPublic.length], asPublic, cipher);
}

export async function sendNotification(sub, payload, opts = {}) {
  if (!vapid) throw new Error("VAPID details not set");
  const body = await encrypt(sub, payload);
  const r = await fetch(sub.endpoint, {
    method: "POST", body,
    headers: { TTL: String(opts.TTL ?? 86400), Urgency: opts.urgency || "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: await vapidHeader(sub.endpoint) },
  });
  if (!r.ok) { const e = new Error("Push failed: " + r.status); e.statusCode = r.status; e.body = await r.text().catch(() => ""); throw e; }
  return { statusCode: r.status };
}
export default { setVapidDetails, generateVAPIDKeys, sendNotification };
