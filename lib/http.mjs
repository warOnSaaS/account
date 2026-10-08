// Small helpers shared by every route. No framework: the same handler runs under node:http and on Vercel.

export async function bodyOf(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let s = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString() : '';
  if (!s) for await (const c of req) { s += c; if (s.length > 1_500_000) throw Object.assign(new Error('Body too large'), { status: 413 }); }
  if (!s) return {};
  try {
    return (req.headers['content-type'] ?? '').includes('json') || /^\s*[{[]/.test(s) ? JSON.parse(s) : Object.fromEntries(new URLSearchParams(s));
  } catch {
    return {};
  }
}

export const json = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};

export const html = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin', ...headers });
  res.end(body);
};

export const redirect = (res, location, headers = {}) => {
  res.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
  res.end();
};

export const cookieOf = (req, name) => {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie ?? '');
  return m ? decodeURIComponent(m[1]) : '';
};

// The session cookie lives on this host only. The hint cookie (no secret, just "someone is signed in here")
// is shared with every *.waronsaas.com app so they can sign the person in silently.
export function cookie(name, value, maxAge, { domain = null, httpOnly = true, secure = true } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; ${httpOnly ? 'HttpOnly; ' : ''}SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}${domain ? `; Domain=${domain}` : ''}`;
}

export const safeNext = (n, fallback = '/') => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : fallback);

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || '';
}

// Client credentials from the body or a Basic header.
export function clientCreds(req, body) {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Basic ')) {
    const [id, ...rest] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    return { id: decodeURIComponent(id), secret: decodeURIComponent(rest.join(':')) };
  }
  return { id: body.client_id ?? null, secret: body.client_secret ?? null };
}

export const bearerOf = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
