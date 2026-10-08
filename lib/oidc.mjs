import crypto from 'node:crypto';
import { id, secret, sha256, safeEqual, nowSec, DAY } from './util.mjs';
import { json, redirect, bodyOf, clientCreds, bearerOf } from './http.mjs';
import { signJwt, jwks } from './keys.mjs';

// An OpenID Connect provider (OAuth 2.1: authorization code with PKCE, refresh tokens that rotate, dynamic client
// registration for MCP clients). Our own apps are first-party clients with a secret and skip the consent screen;
// AI apps (Claude, ChatGPT, Codex, Claude Code) register themselves and get asked once.

export const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'account', 'teams'];
const ACCESS_TTL = 3600;
const APP_TTL = 30 * DAY;
const CONNECTION_TTL = 365 * DAY;

export const discovery = (issuer) => ({
  issuer,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint: `${issuer}/oauth/token`,
  userinfo_endpoint: `${issuer}/oauth/userinfo`,
  jwks_uri: `${issuer}/jwks.json`,
  registration_endpoint: `${issuer}/oauth/register`,
  revocation_endpoint: `${issuer}/oauth/revoke`,
  end_session_endpoint: `${issuer}/oauth/end-session`,
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  scopes_supported: SCOPES,
  claims_supported: ['sub', 'name', 'email', 'email_verified', 'picture', 'github_login', 'teams', 'sid', 'auth_time', 'amr', 'nonce'],
  prompt_values_supported: ['none', 'login', 'consent'],
  service_documentation: 'https://github.com/warOnSaaS/account/blob/main/docs/INTEGRATION.md',
});

export const resourceMetadata = (issuer) => ({
  resource: `${issuer}/mcp`,
  authorization_servers: [issuer],
  bearer_methods_supported: ['header'],
  scopes_supported: ['account', 'teams'],
  resource_name: 'warOnSaaS Account',
});

// https anywhere; plain http only for this computer (Claude Code, Codex and local development).
export function okRedirect(uri) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

// Loopback redirects may use any port (RFC 8252 section 7.3).
function redirectAllowed(client, uri) {
  const list = client.redirect_uris ?? [];
  if (list.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return false;
    return list.some((r) => { const x = new URL(r); return x.protocol === 'http:' && x.hostname === u.hostname && x.pathname === u.pathname; });
  } catch {
    return false;
  }
}

export class Oidc {
  constructor({ db, store, teams, issuer }) {
    Object.assign(this, { db, store, teams, issuer });
  }

  // ---------- clients ----------

  async register(req, res) {
    const b = await bodyOf(req);
    const uris = Array.isArray(b.redirect_uris) ? [...new Set(b.redirect_uris.map(String))] : [];
    if (!uris.length || !uris.every(okRedirect)) return json(res, 400, { error: 'invalid_redirect_uri', error_description: 'Every redirect_uri must be https, or http on localhost' });
    if (uris.length > 10) return json(res, 400, { error: 'invalid_client_metadata', error_description: 'At most 10 redirect URIs' });
    const name = String(b.client_name ?? 'An app').replace(/[<>]/g, '').slice(0, 80) || 'An app';
    const cid = id('dcr');
    await this.db.run('INSERT INTO clients (id, name, redirect_uris, first_party, kind, home_url) VALUES ($1, $2, $3, FALSE, $4, $5)', [cid, name, JSON.stringify(uris), 'registered', okRedirect(b.client_uri ?? '') ? b.client_uri : null]);
    json(res, 201, { client_id: cid, client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: nowSec() });
  }

  async client(clientId) {
    const c = await this.store.client(clientId);
    if (!c) return null;
    return { ...c, redirect_uris: typeof c.redirect_uris === 'string' ? JSON.parse(c.redirect_uris) : c.redirect_uris };
  }

  async authClient(req, body) {
    const { id: cid, secret: sec } = clientCreds(req, body);
    const c = await this.client(cid);
    if (!c) return null;
    if (c.secret_hash) return sec && safeEqual(sha256(sec), c.secret_hash) ? c : null;
    return c;
  }

  // ---------- authorize ----------

  /**
   * Checks an authorization request. Returns { client, q } when it can go on, { bad } for a page error (never
   * redirect to an address we have not checked), or { back } to send the error to the app.
   */
  async checkAuthorize(q) {
    const client = await this.client(q.client_id);
    if (!client) return { bad: 'This sign-in link is not valid. Start again from your app.' };
    if (!q.redirect_uri || !redirectAllowed(client, q.redirect_uri)) return { bad: 'This app asked to send you somewhere it did not register. Start again from your app.' };
    const back = (error, description) => {
      const u = new URL(q.redirect_uri);
      u.searchParams.set('error', error);
      if (description) u.searchParams.set('error_description', description);
      if (q.state) u.searchParams.set('state', q.state);
      u.searchParams.set('iss', this.issuer);
      return { back: u.toString() };
    };
    if ((q.response_type ?? 'code') !== 'code') return back('unsupported_response_type');
    if (!q.code_challenge || (q.code_challenge_method ?? 'plain') !== 'S256') return back('invalid_request', 'PKCE with S256 is required');
    const scopes = String(q.scope ?? 'openid profile email').split(/\s+/).filter((s) => SCOPES.includes(s));
    return { client, q: { ...q, scope: scopes.join(' ') || 'openid' }, back };
  }

  /** Has this person already said yes to this app? First-party apps never ask. */
  async consented(accountId, client) {
    if (client.first_party) return true;
    return !!(await this.db.get("SELECT 1 FROM events WHERE account_id = $1 AND action = 'consent.given' AND detail->>'client' = $2 LIMIT 1", [accountId, client.id]));
  }

  async rememberConsent(accountId, client, scope) {
    await this.store.event(accountId, 'consent.given', { client: client.id, name: client.name, scope });
  }

  /** The person is signed in (browser session `browser`) and agreed: make a one-time code and send it back. */
  async issueCode(browser, client, q) {
    const raw = secret('wac');
    const connection = !client.first_party || /\boffline_access\b/.test(q.scope);
    await this.store.putOnce(raw, 'code', {
      account: browser.account_id, client: client.id, redirect: q.redirect_uri, cc: q.code_challenge, nonce: q.nonce ?? null, scope: q.scope,
      parent: connection ? null : browser.id, kind: connection ? 'connection' : 'app', label: q.connection ? String(q.connection).slice(0, 80) : null,
      team: q.team ?? null, auth_time: Math.floor(new Date(browser.created_at).getTime() / 1000), method: browser.method,
    }, 300);
    const u = new URL(q.redirect_uri);
    u.searchParams.set('code', raw);
    if (q.state) u.searchParams.set('state', q.state);
    u.searchParams.set('iss', this.issuer);
    return u.toString();
  }

  // ---------- token ----------

  async token(req, res) {
    const b = await bodyOf(req);
    const client = await this.authClient(req, b);
    if (!client) return json(res, 401, { error: 'invalid_client' }, { 'www-authenticate': 'Basic realm="warOnSaaS"' });
    this.db.run('UPDATE clients SET last_used_at = now() WHERE id = $1', [client.id]).catch(() => {});

    if (b.grant_type === 'authorization_code') {
      const got = await this.store.takeOnceStrict(String(b.code ?? ''), 'code');
      if (got.reused) {
        // A code used twice: someone may have stolen it. End what the first use made.
        await this.db.run("UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND client_id = $2 AND created_at > now() - interval '10 minutes' AND revoked_at IS NULL", [got.data.account, got.data.client]);
        return json(res, 400, { error: 'invalid_grant', error_description: 'This code was already used' });
      }
      const g = got.data;
      if (!g || g.client !== client.id) return json(res, 400, { error: 'invalid_grant' });
      if (b.redirect_uri && b.redirect_uri !== g.redirect) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri does not match' });
      const s256 = crypto.createHash('sha256').update(String(b.code_verifier ?? '')).digest('base64url');
      if (!b.code_verifier || s256 !== g.cc) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE check failed' });
      if (g.parent && !(await this.store.live(g.parent))) return json(res, 400, { error: 'invalid_grant', error_description: 'You signed out' });
      const sid = await this.store.createSession(g.account, { kind: g.kind, parentId: g.parent, clientId: client.id, label: g.label ?? client.name, scopes: g.scope, method: g.method, userAgent: req.headers['user-agent'], ttl: g.kind === 'connection' ? CONNECTION_TTL : APP_TTL });
      if (g.team) await this.db.run('UPDATE sessions SET team_id = $2 WHERE id = $1', [sid, g.team]);
      if (g.kind === 'connection') await this.store.event(g.account, 'connection.added', { client: client.id, name: g.label ?? client.name });
      return json(res, 200, await this.tokensFor(sid, client, g));
    }

    if (b.grant_type === 'refresh_token') {
      const raw = String(b.refresh_token ?? '');
      const row = await this.db.get('SELECT t.*, s.client_id, s.account_id FROM tokens t JOIN sessions s ON s.id = t.session_id WHERE t.hash = $1 AND t.kind = $2', [sha256(raw), 'refresh']);
      if (!row || row.client_id !== client.id) return json(res, 400, { error: 'invalid_grant' });
      if (row.used_at) {
        // A refresh token used twice: the family is compromised. End the session.
        await this.db.run('UPDATE sessions SET revoked_at = now() WHERE id = $1', [row.session_id]);
        return json(res, 400, { error: 'invalid_grant', error_description: 'This refresh token was already used' });
      }
      const s = await this.store.live(row.session_id);
      if (!s || new Date(row.expires_at) < new Date()) return json(res, 400, { error: 'invalid_grant', error_description: 'Signed out' });
      await this.db.run('UPDATE tokens SET used_at = now() WHERE hash = $1', [row.hash]);
      return json(res, 200, await this.tokensFor(s.id, client, { scope: s.scopes, auth_time: Math.floor(new Date(s.created_at).getTime() / 1000), method: s.method }));
    }

    json(res, 400, { error: 'unsupported_grant_type' });
  }

  async tokensFor(sid, client, g) {
    const s = await this.store.live(sid);
    const access = await this.store.issueToken(sid, 'access', ACCESS_TTL);
    const left = Math.max(60, Math.floor((new Date(s.expires_at) - Date.now()) / 1000));
    const refresh = await this.store.issueToken(sid, 'refresh', left);
    const claims = await this.claims(s.account_id, g.scope ?? s.scopes, sid);
    const out = { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: g.scope ?? s.scopes };
    if (/\bopenid\b/.test(out.scope)) {
      out.id_token = await signJwt(this.db, { iss: this.issuer, aud: client.id, ...claims, ...(g.nonce ? { nonce: g.nonce } : {}), auth_time: g.auth_time, amr: [g.method ?? 'link'] }, ACCESS_TTL);
    }
    return out;
  }

  async claims(accountId, scope = '', sid = null) {
    const a = await this.store.account(accountId);
    const c = { sub: a.id };
    if (sid) c.sid = sid;
    if (/\bprofile\b/.test(scope) || !scope) {
      c.name = a.name;
      if (a.avatar_url) c.picture = a.avatar_url;
      const gh = await this.db.get("SELECT login FROM identities WHERE account_id = $1 AND provider = 'github' ORDER BY last_used_at DESC NULLS LAST LIMIT 1", [accountId]);
      if (gh?.login) c.github_login = gh.login;
    }
    if (/\bemail\b/.test(scope) || !scope) {
      c.email = a.email;
      c.email_verified = !!a.email;
    }
    if (/\bteams\b/.test(scope)) c.teams = (await this.teams.of(accountId)).map((t) => ({ id: t.id, slug: t.slug, name: t.name, role: t.role }));
    return c;
  }

  // ---------- userinfo, revoke, check ----------

  async sessionFromBearer(req) {
    const raw = bearerOf(req);
    return raw ? this.store.byToken(raw, 'access') : null;
  }

  async userinfo(req, res) {
    const s = await this.sessionFromBearer(req);
    if (!s) return json(res, 401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer error="invalid_token"' });
    json(res, 200, await this.claims(s.account_id, s.scopes, s.id));
  }

  async revoke(req, res) {
    const b = await bodyOf(req);
    const client = await this.authClient(req, b);
    if (!client) return json(res, 401, { error: 'invalid_client' });
    const raw = String(b.token ?? '');
    const row = await this.db.get('SELECT s.id, s.account_id, s.client_id FROM tokens t JOIN sessions s ON s.id = t.session_id WHERE t.hash = $1', [sha256(raw)]);
    if (row && row.client_id === client.id) await this.store.revokeSession(row.account_id, row.id);
    res.writeHead(200, { 'cache-control': 'no-store' }).end();
  }

  /** For our apps: is this session (the sid in an ID token) still signed in? Lets "sign out everywhere" reach them. */
  async checkSession(req, res, body) {
    const client = await this.authClient(req, body);
    if (!client?.first_party) return json(res, 401, { error: 'invalid_client' });
    const ids = (Array.isArray(body.sid) ? body.sid : [body.sid]).filter(Boolean).slice(0, 100).map(String);
    const live = ids.length ? await this.db.query(`SELECT s.id FROM sessions s WHERE s.id = ANY($1) AND ${this.store.constructor.LIVE}`, [ids]) : [];
    const set = new Set(live.map((r) => r.id));
    json(res, 200, { sessions: Object.fromEntries(ids.map((x) => [x, set.has(x)])) });
  }

  async jwks(res) {
    json(res, 200, await jwks(this.db), { 'cache-control': 'public, max-age=300' });
  }
}
