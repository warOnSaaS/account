import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { openDb, migrate } from './lib/db.mjs';
import { Store } from './lib/store.mjs';
import { Teams, brandCss } from './lib/teams.mjs';
import { Oidc, discovery, resourceMetadata } from './lib/oidc.mjs';
import { makeTools, runTool, fromWire, ToolError, CATALOGUE } from './lib/tools.mjs';
import { handleMcp } from './lib/mcp.mjs';
import { hit } from './lib/limits.mjs';
import { mailer } from './lib/mail.mjs';
import { enabled, github, google } from './lib/providers.mjs';
import { sign, verify, secret, sha256, DAY } from './lib/util.mjs';
import { json, html, redirect, bodyOf, cookieOf, cookie, safeNext, clientIp, bearerOf } from './lib/http.mjs';
import * as P from './lib/pages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const COOKIE = 'wos_account';
const HINT = 'wos_signed_in';
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

/** Builds the request handler. Same code under `npm start` and on Vercel (api/index.mjs). */
export function createHandler(env = process.env) {
  const issuer = (env.PUBLIC_URL || 'http://localhost:3990').replace(/\/$/, '');
  const secure = issuer.startsWith('https://');
  const hintDomain = env.COOKIE_DOMAIN || null; // .waronsaas.com when hosted
  let ready = null;
  let ctx = null;

  const boot = () => (ready ??= (async () => {
    const db = openDb(env.DATABASE_URL);
    await migrate(db);
    const store = new Store(db);
    const teams = new Teams(db);
    const oidc = new Oidc({ db, store, teams, issuer });
    const connect = async (url) => {
      const c = new pg.Client({ connectionString: url.replace(/[?&]sslmode=require/, ''), ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
      await c.connect();
      try { await c.query('SELECT 1'); } finally { await c.end().catch(() => {}); }
    };
    const H = makeTools({ db, store, teams, connect, issuer });
    ctx = { db, store, teams, oidc, H, mail: mailer(env) };
    return ctx;
  })().catch((e) => { ready = null; throw e; }));

  const setSession = (raw, ttl) => [cookie(COOKIE, raw, ttl, { secure }), cookie(HINT, ttl ? '1' : '', ttl, { domain: hintDomain, httpOnly: false, secure })];

  async function browserSession(req) {
    const raw = cookieOf(req, COOKIE);
    return raw ? ctx.store.byToken(raw, 'browser') : null;
  }

  async function finishSignIn(req, res, identity, next, linkTo = null) {
    const r = await ctx.store.fromIdentity(identity, { linkTo });
    if (r.error === 'identity_taken') return html(res, 409, P.messagePage({ title: 'Already in use', text: `That ${identity.provider === 'github' ? 'GitHub' : 'Google'} account already signs in to another warOnSaaS account. Sign in with it and delete that account first, or keep them apart.`, link: { href: '/#signins', label: 'Back to my account' } }));
    await ctx.teams.onSignIn(r.account, identity.verifiedEmails ?? (identity.emailVerified ? [identity.email] : []));
    if (linkTo) return redirect(res, safeNext(next));
    const sid = await ctx.store.createSession(r.account.id, { kind: 'browser', method: identity.provider, userAgent: req.headers['user-agent'], ttl: 30 * DAY });
    const raw = await ctx.store.issueToken(sid, 'browser', 30 * DAY);
    await ctx.store.event(r.account.id, 'signed_in', { method: identity.provider });
    redirect(res, safeNext(next), { 'set-cookie': setSession(raw, 30 * DAY) });
  }

  // Shows "Sign in to use <app>" when the sign-in was asked for by one of our apps or an AI app.
  async function appNameFor(next) {
    if (!String(next).startsWith('/oauth/authorize')) return null;
    const q = new URL(next, issuer).searchParams;
    const c = await ctx.oidc.client(q.get('client_id'));
    return c ? (q.get('connection') || c.name) : null;
  }

  async function signIn(res, next, note = '', email = '') {
    html(res, 200, P.signInPage({ next, note, providers: enabled(env), app: await appNameFor(next), email }));
  }

  // Who is calling a tool: a person on the account page (cookie plus the x-wos-call header, which a form on
  // another site cannot send), or an app or AI app with a bearer token.
  async function caller(req) {
    const bearer = bearerOf(req);
    if (bearer) {
      const s = await ctx.store.byToken(bearer, 'access');
      if (!s) return null;
      const account = await ctx.store.account(s.account_id);
      const client = await ctx.store.client(s.client_id);
      const viaScreen = client?.first_party && req.headers['x-wos-via'] === 'screen';
      return account && { account, session: s, via: viaScreen ? 'screen' : 'agent', client: s.label || client?.name };
    }
    if (req.headers['x-wos-call'] !== '1') return null;
    const origin = req.headers.origin;
    if (origin && origin !== issuer) return null;
    const s = await browserSession(req);
    if (!s) return null;
    const account = await ctx.store.account(s.account_id);
    return account && { account, session: s, via: 'screen' };
  }

  async function handle(req, res) {
    const url = new URL(req.url, issuer);
    // Vercel rewrites every path to the function and passes the original as __p.
    const p = url.searchParams.get('__p') ? decodeURI(url.searchParams.get('__p')) : url.pathname;
    if (url.searchParams.has('__p')) url.searchParams.delete('__p');
    const q = Object.fromEntries(url.searchParams);

    // ---------- static files (served by Vercel from public/ in production) ----------
    if (req.method === 'GET' && /^\/(ui\/|account\.css$|app\.js$|prompt\.js$|favicon\.svg$|account-client\.mjs$)/.test(p)) return serveStatic(res, p);
    if (p === '/health') return json(res, 200, { ok: true });

    // ---------- discovery (no database needed except jwks) ----------
    if (p === '/.well-known/openid-configuration' || p === '/.well-known/oauth-authorization-server') return json(res, 200, discovery(issuer), { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' });
    if (p.startsWith('/.well-known/oauth-protected-resource')) return json(res, 200, resourceMetadata(issuer), { 'access-control-allow-origin': '*' });
    if (req.method === 'OPTIONS') return res.writeHead(204, cors()).end();

    await boot();

    if (p === '/jwks.json') return ctx.oidc.jwks(res);

    // ---------- public brand kit, for every app ----------
    let m;
    if ((m = /^\/brand\/([a-z0-9-]+)\.css$/.exec(p))) {
      const b = await ctx.teams.brandBySlug(m[1]);
      res.writeHead(b ? 200 : 404, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=60', ...cors() });
      return res.end(b ? brandCss(b) : '/* no such team */');
    }
    if ((m = /^\/api\/teams\/([A-Za-z0-9_-]+)\/brand$/.exec(p))) {
      const b = await ctx.teams.brandBySlug(m[1]);
      return b ? json(res, 200, b, { ...cors(), 'cache-control': 'public, max-age=60' }) : json(res, 404, { error: { code: 'not_found', message: 'No such team' } }, cors());
    }

    // ---------- for our own apps (client id and secret) ----------
    if (p === '/api/limits/hit' && req.method === 'POST') {
      const b = await bodyOf(req);
      const c = await ctx.oidc.authClient(req, b);
      if (!c?.first_party) return json(res, 401, { error: { code: 'invalid_client', message: 'Send your app\'s client id and secret' } });
      const r = await hit(ctx.db, { account: b.account ?? b.sub, bucket: b.bucket, max: b.max, per: b.per, cost: b.cost, peek: b.peek });
      return r.error ? json(res, 400, { error: { code: 'invalid_input', message: r.error } }) : json(res, 200, r);
    }
    if (p === '/api/sessions/check' && req.method === 'POST') {
      const b = await bodyOf(req);
      return ctx.oidc.checkSession(req, res, b);
    }
    if ((m = /^\/api\/teams\/([A-Za-z0-9_-]+)\/data-home$/.exec(p))) {
      const c = await ctx.oidc.authClient(req, q);
      if (!c?.first_party) return json(res, 401, { error: { code: 'invalid_client', message: 'Send your app\'s client id and secret' } });
      const h = await ctx.teams.homeForApp(m[1]);
      return h ? json(res, 200, h) : json(res, 404, { error: { code: 'not_found', message: 'No such team' } });
    }

    // ---------- OAuth and OpenID Connect ----------
    if (p === '/oauth/register' && req.method === 'POST') return ctx.oidc.register(req, res);
    if (p === '/oauth/token' && req.method === 'POST') return ctx.oidc.token(req, res);
    if (p === '/oauth/userinfo') return ctx.oidc.userinfo(req, res);
    if (p === '/oauth/revoke' && req.method === 'POST') return ctx.oidc.revoke(req, res);
    if (p === '/oauth/authorize') return authorize(req, res, url, q);
    if (p === '/oauth/consent' && req.method === 'POST') return consent(req, res);
    if (p === '/oauth/end-session') return endSession(req, res, q);

    // ---------- tools and MCP ----------
    if (p === '/mcp') {
      const call = await caller(req);
      return handleMcp(req, res, { H: ctx.H, db: ctx.db, call: call?.via === 'agent' || call?.session ? call : null, issuer });
    }
    if (p === '/api/tools' && req.method === 'GET') return json(res, 200, { tools: CATALOGUE });
    if ((m = /^\/api\/tools\/([a-z_.]+)$/.exec(p))) {
      if (req.method !== 'POST') return json(res, 405, { error: { code: 'method', message: 'Use POST' } });
      const call = await caller(req);
      if (!call) return json(res, 401, { error: { code: 'sign_in', message: 'Sign in to your warOnSaaS account' } }, { 'www-authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"` });
      try {
        const r = await runTool(ctx.H, ctx.db, fromWire(m[1]), await bodyOf(req), call);
        return r.pending ? json(res, 202, r) : json(res, 200, r);
      } catch (e) {
        if (e instanceof ToolError) return json(res, e.status, { error: { code: e.code, message: e.message } });
        throw e;
      }
    }

    // ---------- sign in ----------
    if (p === '/sign-in') {
      const next = safeNext(q.next);
      if (await browserSession(req) && q.prompt !== 'login') return redirect(res, next);
      return signIn(res, next, q.note === 'expired' ? 'That sign-in expired. Try again.' : '', q.login_hint ?? '');
    }
    if (p === '/sign-out') {
      const s = await browserSession(req);
      if (req.method === 'POST' || q.next) { if (s) await ctx.store.revokeSession(s.account_id, s.id); }
      return redirect(res, q.next ? `/sign-in?next=${encodeURIComponent(safeNext(q.next))}` : '/sign-in', { 'set-cookie': setSession('', 0) });
    }

    if (p === '/auth/github' || p === '/auth/google') {
      const which = p.endsWith('github') ? 'github' : 'google';
      if (!enabled(env)[which]) return signIn(res, safeNext(q.next), `${which === 'github' ? 'GitHub' : 'Google'} sign-in is not switched on here yet. Use an email link.`);
      let link = null;
      if (q.link) { const s = await browserSession(req); link = s?.account_id ?? null; }
      const nonce = crypto.randomBytes(12).toString('base64url');
      const state = sign({ k: which, n: safeNext(q.next), l: link, nonce }, 900);
      const redirectUri = `${issuer}/auth/${which}/callback`;
      return redirect(res, which === 'github' ? github.authorizeUrl(env, { redirectUri, state }) : google.authorizeUrl(env, { redirectUri, state, nonce }));
    }
    if (p === '/auth/github/callback' || p === '/auth/google/callback') {
      const which = p.includes('github') ? 'github' : 'google';
      const st = verify(q.state, which);
      if (!st || !q.code) return signIn(res, st?.n ?? '/', q.error === 'access_denied' ? 'Sign-in was cancelled.' : 'That sign-in expired. Try again.');
      const identity = await (which === 'github' ? github : google).identity(env, { code: q.code, redirectUri: `${issuer}/auth/${which}/callback` });
      if (!identity) return signIn(res, st.n, `${which === 'github' ? 'GitHub' : 'Google'} sign-in did not go through. Try again.`);
      // Linking is only for the account still signed in here.
      let linkTo = null;
      if (st.l) { const s = await browserSession(req); if (s?.account_id === st.l) linkTo = st.l; }
      return finishSignIn(req, res, identity, st.n, linkTo);
    }

    if (p === '/auth/email' && req.method === 'POST') {
      const b = await bodyOf(req);
      const email = String(b.email ?? '').trim().toLowerCase();
      const next = safeNext(b.next);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return signIn(res, next, 'That email address does not look right.', email);
      const perEmail = await hit(ctx.db, { account: `email:${sha256(email)}`, bucket: 'signin.email', max: 5, per: 3600 });
      const perIp = await hit(ctx.db, { account: `ip:${sha256(clientIp(req))}`, bucket: 'signin.email', max: 30, per: 3600 });
      if (!perEmail.ok || !perIp.ok) return signIn(res, next, 'Too many links asked for. Wait a few minutes, or use the last link we sent.', email);
      const raw = secret('wel');
      await ctx.store.putOnce(raw, 'email', { e: email, n: next }, 900);
      const link = `${issuer}/auth/email/verify?t=${encodeURIComponent(raw)}`;
      const app = await appNameFor(next);
      await ctx.mail.send({
        to: email,
        subject: app ? `Sign in to use ${app}` : 'Your warOnSaaS sign-in link',
        text: `Sign in to warOnSaaS${app ? ` and continue to ${app}` : ''}:\n\n${link}\n\nThe link works once, for 15 minutes. If you did not ask for it, ignore this email; nothing happens without it.\n\nwarOnSaaS`,
        html: emailHtml({ link, app }),
      });
      return html(res, 200, P.checkEmailPage({ email, next, dev: env.ACCOUNT_DEV_LINKS === '1' ? link : null }));
    }
    if (p === '/auth/email/verify') {
      if (req.method !== 'POST') {
        // Mail scanners open links, so signing in takes a press. Peek without using the link up.
        const row = await ctx.db.get('SELECT data FROM one_time WHERE hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()', [sha256(String(q.t ?? '')), 'email']);
        if (!row) return signIn(res, '/', 'That link has expired or was already used. Ask for a new one.');
        return html(res, 200, P.confirmLinkPage({ email: row.data.e, token: q.t }));
      }
      const b = await bodyOf(req);
      const got = await ctx.store.takeOnceStrict(String(b.t ?? ''), 'email');
      if (!got.data || got.reused) return signIn(res, '/', 'That link has expired or was already used. Ask for a new one.');
      return finishSignIn(req, res, { provider: 'email', subject: got.data.e, email: got.data.e, emailVerified: true, verifiedEmails: [got.data.e], name: null }, got.data.n);
    }

    // ---------- the account page ----------
    if (p === '/' && req.method === 'GET') {
      const s = await browserSession(req);
      if (!s) return signIn(res, '/');
      const account = await ctx.store.account(s.account_id);
      const call = { account, session: s, via: 'screen' };
      const me = await ctx.H['account.me']({}, call);
      const teams = me.teams;
      const pick = teams.find((t) => t.slug === q.team || t.id === q.team) ?? teams[0];
      const team = await ctx.H['team.get']({ team: pick.slug }, call);
      const sessions = (await ctx.H['account.list_sessions']({}, call)).sessions.map((x, i, all) => ({ ...x, parent_id: null }));
      // list_sessions does not carry parents; read them for grouping apps under their browser.
      const parents = new Map((await ctx.db.query('SELECT id, parent_id FROM sessions WHERE account_id = $1', [account.id])).map((r) => [r.id, r.parent_id]));
      sessions.forEach((x) => { x.parent_id = parents.get(x.id) ?? null; x.current = x.id === s.id; });
      const approvals = (await ctx.H['account.list_approvals']({}, call)).approvals;
      return html(res, 200, P.homePage({ me, sessions, approvals, team, teams, providers: enabled(env), flash: q.flash ?? '' }));
    }

    html(res, 404, P.messagePage({ title: 'Nothing here', text: 'This page does not exist.', link: { href: '/', label: 'Go to my account' } }));
  }

  async function authorize(req, res, url, q) {
    const chk = await ctx.oidc.checkAuthorize(q);
    if (chk.bad) return html(res, 400, P.messagePage({ title: 'This link is not valid', text: chk.bad }));
    if (chk.back && !chk.client) return redirect(res, chk.back);
    if (chk.client === undefined) return redirect(res, chk.back);
    const { client } = chk;
    const s = await browserSession(req);
    const here = `/oauth/authorize?${new URLSearchParams(Object.entries(q).filter(([k]) => k !== 'prompt')).toString()}`;
    if (!s || q.prompt === 'login') {
      if (q.prompt === 'none') return redirect(res, chk.back('login_required').back);
      // The app's prompt offered GitHub or Google directly: skip the choice.
      if (['github', 'google'].includes(q.provider) && enabled(env)[q.provider]) return redirect(res, `/auth/${q.provider}?next=${encodeURIComponent(here)}`);
      return redirect(res, `/sign-in?next=${encodeURIComponent(here)}${q.login_hint ? `&login_hint=${encodeURIComponent(q.login_hint)}` : ''}${q.prompt === 'login' ? '&prompt=login' : ''}`);
    }
    if (q.prompt === 'consent' || !(await ctx.oidc.consented(s.account_id, client))) {
      if (q.prompt === 'none') return redirect(res, chk.back('consent_required').back);
      const r = sign({ k: 'consent', q: chk.q, a: s.account_id }, 900);
      const account = await ctx.store.account(s.account_id);
      return html(res, 200, P.consentPage({ client, account, scope: chk.q.scope, request: { r, connection: q.connection, back: here } }));
    }
    return redirect(res, await ctx.oidc.issueCode(s, client, chk.q));
  }

  async function consent(req, res) {
    const b = await bodyOf(req);
    const r = verify(b.r, 'consent');
    const s = await browserSession(req);
    if (!r || !s || s.account_id !== r.a) return html(res, 400, P.messagePage({ title: 'That expired', text: 'Go back to your app and connect again.' }));
    const chk = await ctx.oidc.checkAuthorize(r.q);
    if (!chk.client) return html(res, 400, P.messagePage({ title: 'This link is not valid', text: chk.bad ?? 'Start again from your app.' }));
    if (b.answer !== 'allow') return redirect(res, chk.back('access_denied', 'The person said no').back);
    await ctx.oidc.rememberConsent(s.account_id, chk.client, chk.q.scope);
    return redirect(res, await ctx.oidc.issueCode(s, chk.client, chk.q));
  }

  // RP-initiated sign-out: an app's "Sign out" can end the account session too, then go back to the app.
  async function endSession(req, res, q) {
    const s = await browserSession(req);
    if (s) await ctx.store.revokeSession(s.account_id, s.id);
    let to = '/sign-in';
    if (q.post_logout_redirect_uri && q.client_id) {
      const c = await ctx.oidc.client(q.client_id);
      const want = (() => { try { return new URL(q.post_logout_redirect_uri).origin; } catch { return null; } })();
      if (c && want && c.redirect_uris.some((u) => new URL(u).origin === want)) to = q.post_logout_redirect_uri;
    }
    redirect(res, to, { 'set-cookie': setSession('', 0) });
  }

  function serveStatic(res, p) {
    const file = path.join(here, 'public', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(here, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res, 404, { error: 'not_found' });
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': p.startsWith('/ui/fonts/') ? 'public, max-age=31536000, immutable' : 'public, max-age=60', ...(['/prompt.js', '/account-client.mjs'].includes(p) ? cors() : {}) });
    res.end(fs.readFileSync(file));
  }

  return async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) html(res, 500, P.messagePage({ title: 'Something went wrong', text: 'That is on us. Try again in a moment.' }));
      else res.end();
    }
  };
}

const cors = () => ({ 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' });

function emailHtml({ link, app }) {
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html><body style="margin:0;background:#09090b;padding:32px 16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#fafafa">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;background:#111113;border:1px solid rgba(255,255,255,.14);border-radius:14px">
<tr><td style="padding:28px 28px 8px;font-size:13px;color:#a1a1aa;letter-spacing:.02em">warOnSaaS</td></tr>
<tr><td style="padding:0 28px;font-size:22px;font-weight:600">${app ? `Sign in to use ${e(app)}` : 'Sign in to warOnSaaS'}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:14px;line-height:1.55;color:#a1a1aa">Press the button to sign in. It works once, for 15 minutes.</td></tr>
<tr><td style="padding:22px 28px"><a href="${e(link)}" style="display:block;text-align:center;background:#7dd3fc;color:#04202e;text-decoration:none;font-weight:600;font-size:15px;padding:12px 16px;border-radius:9px">Sign in</a></td></tr>
<tr><td style="padding:0 28px 26px;font-size:12.5px;line-height:1.5;color:#8b8b95">If you did not ask for this, ignore it; nothing happens without the link.</td></tr>
</table></td></tr></table></body></html>`;
}

// npm start
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3990);
  http.createServer(createHandler()).listen(port, () => console.log(`warOnSaaS Account on ${process.env.PUBLIC_URL || `http://localhost:${port}`}`));
}
