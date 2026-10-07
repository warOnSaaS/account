import crypto from 'node:crypto';

export const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
export const secret = (prefix, bytes = 32) => `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');
export const nowSec = () => Math.floor(Date.now() / 1000);
export const later = (seconds) => new Date(Date.now() + seconds * 1000);
export const DAY = 86400;

const SECRET = () => {
  const s = process.env.ACCOUNT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('ACCOUNT_SECRET is not set');
  return s || 'dev-account-secret-change-me';
};
const keyFor = (purpose) => crypto.createHash('sha256').update(`${SECRET()}:${purpose}`).digest();

// HMAC-signed, expiring payloads for state that travels through the browser.
export function sign(payload, seconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: nowSec() + seconds })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', keyFor('sign')).update(body).digest('base64url')}`;
}
export function verify(token, kind) {
  const [body, mac] = String(token ?? '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', keyFor('sign')).update(body).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.k === kind && p.exp >= nowSec() ? p : null;
  } catch {
    return null;
  }
}

// AES-GCM for things kept at rest (the signing key).
export function seal(text, purpose = 'seal') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(purpose), iv);
  const out = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), out].map((b) => b.toString('base64url')).join('.');
}
export function unseal(sealed, purpose = 'seal') {
  const [iv, tag, out] = String(sealed).split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(purpose), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(out), d.final()]).toString('utf8');
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
