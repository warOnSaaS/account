// End to end against a real Postgres (TEST_DATABASE_URL): email link, GitHub and Google sign-in (fake servers),
// a first-party app through the client library, an AI app through dynamic registration and MCP, approvals,
// sign out everywhere, limits, brand kit and data home.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) throw new Error('Set TEST_DATABASE_URL (a throwaway database; every table in it is dropped)');

let base, server, fake, fakeUrl, mails = [];
const jar = () => {
  const c = new Map();
  return {
    set(res) { for (const s of res.headers.getSetCookie?.() ?? []) { const [kv] = s.split(';'); const [k, ...v] = kv.split('='); if (/Max-Age=0/.test(s)) c.delete(k); else c.set(k, v.join('=')); } },
    get header() { return [...c].map(([k, v]) => `${k}=${v}`).join('; '); },
    has: (k) => c.has(k),
  };
};
async function req(path, { method = 'GET', body, cookies, headers = {}, form = false } = {}) {
  const h = { ...headers };
  if (cookies) h.cookie = cookies.header;
  let b;
  if (body !== undefined) { if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(body).toString(); } else { h['content-type'] = 'application/json'; b = JSON.stringify(body); } }
  const r = await fetch(path.startsWith('http') ? path : base + path, { method, headers: h, body: b, redirect: 'manual' });
  cookies?.set(r);
  return r;
}
const pkce = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };

async function emailSignIn(email) {
  const c = jar();
  const r = await req('/auth/email', { method: 'POST', form: true, body: { email, next: '/' }, cookies: c });
  assert.equal(r.status, 200);
  const page = await r.text();
  assert.match(page, /Check your email/);
  const link = mails.at(-1).text.match(/(http\S+\/auth\/email\/verify\?t=\S+)/)[1];
  const t = new URL(link).searchParams.get('t');
  const g = await req(link.replace(/^http:\/\/[^/]+/, ''), { cookies: c });
  assert.match(await g.text(), /Sign in as/);
  const p = await req('/auth/email/verify', { method: 'POST', form: true, body: { t }, cookies: c });
  assert.equal(p.status, 302);
  assert.ok(c.has('wos_account'));
  return c;
}
const tool = (name, input, cookies) => req(`/api/tools/${name}`, { method: 'POST', body: input, cookies, headers: { 'x-wos-call': '1' } });

before(async () => {
  const c = new pg.Client({ connectionString: DB.replace(/[?&]sslmode=require/, ''), ssl: /neon/.test(DB) ? { rejectUnauthorized: false } : undefined });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();

  // Fake GitHub and Google.
  fake = http.createServer(async (rq, rs) => {
    const u = new URL(rq.url, 'http://x');
    const send = (o) => rs.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (u.pathname === '/gh/login/oauth/access_token') return send({ access_token: 'gho_fake' });
    if (u.pathname === '/ghapi/user') return send({ id: 4242, login: 'casey-dev', name: 'Casey Riley', avatar_url: 'https://avatars.example/c.png' });
    if (u.pathname === '/ghapi/user/emails') return send([{ email: 'casey@acme.example', verified: true, primary: true }]);
    if (u.pathname === '/g/token') return send({ access_token: 'ya29_fake' });
    if (u.pathname === '/g/userinfo') return send({ sub: 'g-777', email: 'casey@acme.example', email_verified: true, name: 'Casey R' });
    rs.writeHead(404).end();
  }).listen(0);
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { GITHUB_WEB_BASE: `${fakeUrl}/gh`, GITHUB_API_BASE: `${fakeUrl}/ghapi`, GOOGLE_TOKEN_URL: `${fakeUrl}/g/token`, GOOGLE_USERINFO_URL: `${fakeUrl}/g/userinfo` });

  const { createHandler } = await import('../server.mjs');
  const { mailer } = await import('../lib/mail.mjs');
  server = http.createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const env = { DATABASE_URL: DB, PUBLIC_URL: base, GITHUB_APP_CLIENT_ID: 'Iv1.fake', GITHUB_APP_CLIENT_SECRET: 'fake', GOOGLE_CLIENT_ID: 'g.fake', GOOGLE_CLIENT_SECRET: 'fake' };
  const h = createHandler(env);
  server.on('request', h);
  // Capture mail instead of sending it.
  const orig = console.log;
  console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[mail]')) mails.push({ text: s }); else orig(...a); };
  void mailer;
});
after(() => { server?.close(); fake?.close(); setTimeout(() => process.exit(0), 50); });

let sam;
test('email link signs in, makes an account and a personal team, scanner-safe', async () => {
  sam = await emailSignIn('sam@acme.example');
  const home = await (await req('/', { cookies: sam })).text();
  assert.match(home, /Sam/);
  assert.match(home, /Sam&#39;s team/);
  const me = await (await tool('account.me', {}, sam)).json();
  assert.equal(me.result.email, 'sam@acme.example');
  assert.equal(me.result.teams.length, 1);
  // The same link cannot be used twice.
  const link = mails.at(-1).text.match(/t=(\S+)/)[1];
  const again = await req('/auth/email/verify', { method: 'POST', form: true, body: { t: decodeURIComponent(link) } });
  assert.match(await again.text(), /expired or was already used/);
});

test('tools need the x-wos-call header from a browser (no cross-site forms)', async () => {
  const r = await req('/api/tools/account.me', { method: 'POST', body: {}, cookies: sam });
  assert.equal(r.status, 401);
});

test('GitHub then Google link to one account by verified email', async () => {
  const casey = jar();
  let r = await req('/auth/github?next=/', { cookies: casey });
  const state = new URL(r.headers.get('location')).searchParams.get('state');
  r = await req(`/auth/github/callback?code=x&state=${encodeURIComponent(state)}`, { cookies: casey });
  assert.equal(r.status, 302);
  const g = jar();
  r = await req('/auth/google?next=/', { cookies: g });
  const gs = new URL(r.headers.get('location')).searchParams.get('state');
  r = await req(`/auth/google/callback?code=x&state=${encodeURIComponent(gs)}`, { cookies: g });
  const a = (await (await tool('account.me', {}, casey)).json()).result;
  const b = (await (await tool('account.me', {}, g)).json()).result;
  assert.equal(a.id, b.id);
  assert.deepEqual(a.identities.map((i) => i.provider).sort(), ['github', 'google']);
  assert.equal(a.name, 'Casey Riley');
});

let crmSecret;
test('first-party app signs in through the client library, silently when already signed in', async () => {
  const { openDb } = await import('../lib/db.mjs');
  const { upsertClient } = await import('../lib/clients.mjs');
  const db = openDb(DB);
  crmSecret = (await upsertClient(db, { id: 'crm', name: 'CRM', redirectUris: ['http://localhost:9999/auth/waronsaas/callback'] })).secret;
  await db.close();
  const { WosAccount } = await import('../client/account-client.mjs');
  const acct = new WosAccount({ issuer: base, clientId: 'crm', clientSecret: crmSecret, redirectUri: 'http://localhost:9999/auth/waronsaas/callback' });

  // Signed out + prompt=none: the app hears login_required and stays open to look at.
  const anon = jar();
  let s = acct.start({ next: '/deals', prompt: 'none', secure: false });
  let r = await req(s.location, { cookies: anon });
  assert.match(r.headers.get('location'), /error=login_required/);

  // Signed in (Sam): no screen at all, straight back with a code.
  s = acct.start({ next: '/deals', secure: false });
  r = await req(s.location, { cookies: sam });
  const back = r.headers.get('location');
  assert.match(back, /^http:\/\/localhost:9999\/auth\/waronsaas\/callback\?code=/);
  const done = await acct.finish({ url: back.replace('http://localhost:9999', ''), headers: { cookie: s.cookie.split(';')[0] } });
  assert.equal(done.error, undefined);
  assert.equal(done.profile.email, 'sam@acme.example');
  assert.equal(done.next, '/deals');
  assert.ok(done.profile.sid);
  assert.equal(done.profile.teams[0].role, 'owner');
  assert.equal(await acct.isLive(done.profile.sid), true);

  // Userinfo with the access token.
  const ui = await (await req('/oauth/userinfo', { headers: { authorization: `Bearer ${done.tokens.access_token}` } })).json();
  assert.equal(ui.sub, done.profile.sub);

  // A code works once.
  const again = await req('/oauth/token', { method: 'POST', form: true, body: { grant_type: 'authorization_code', code: new URL(back).searchParams.get('code'), code_verifier: 'x', client_id: 'crm', client_secret: crmSecret } });
  assert.equal(again.status, 400);

  // Limits shared by every app.
  for (let i = 0; i < 3; i++) assert.equal((await acct.limit(done.profile.sub, 'scanner.scan', 3, 3600)).ok, true);
  const no = await acct.limit(done.profile.sub, 'scanner.scan', 3, 3600);
  assert.equal(no.ok, false);
  assert.ok(no.retry_after > 0);
});

test('an AI app registers itself, asks once, and acts as the person over MCP', async () => {
  const reg = await (await req('/oauth/register', { method: 'POST', body: { client_name: 'Claude Code', redirect_uris: ['http://localhost:33418/callback'] } })).json();
  assert.ok(reg.client_id);
  const { v, c } = pkce();
  const q = new URLSearchParams({ client_id: reg.client_id, redirect_uri: 'http://localhost:33418/callback', response_type: 'code', code_challenge: c, code_challenge_method: 'S256', state: 'st1', scope: 'openid profile email account teams offline_access' });
  let r = await req(`/oauth/authorize?${q}`, { cookies: sam });
  const page = await r.text();
  assert.match(page, /Claude Code wants to act as you/);
  const rr = page.match(/name="r" value="([^"]+)"/)[1];
  r = await req('/oauth/consent', { method: 'POST', form: true, body: { r: rr.replace(/&amp;/g, '&'), answer: 'allow' }, cookies: sam });
  const code = new URL(r.headers.get('location')).searchParams.get('code');
  const tok = await (await req('/oauth/token', { method: 'POST', form: true, body: { grant_type: 'authorization_code', code, code_verifier: v, client_id: reg.client_id, redirect_uri: 'http://localhost:33418/callback' } })).json();
  assert.ok(tok.access_token && tok.refresh_token);
  const auth = { authorization: `Bearer ${tok.access_token}` };
  const rpc = async (method, params) => (await (await req('/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method, params }, headers: auth })).json()).result;
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.serverInfo.name, 'warOnSaaS Account');
  const list = await rpc('tools/list');
  assert.ok(list.tools.some((t) => t.name === 'team_set_brand'));
  assert.ok(list.tools.every((t) => /^[a-z]+_[a-z_]+$/.test(t.name)));
  const set = await rpc('tools/call', { name: 'team_set_brand', arguments: { accent: '#4635ff', scheme: 'tide', font: 'Poppins, sans-serif' } });
  assert.equal(set.isError, false);
  const css = await (await req(`/brand/${set.structuredContent.team}.css`)).text();
  assert.match(css, /--ui-accent:#4635ff/);
  const bad = await rpc('tools/call', { name: 'team_set_brand', arguments: { accent: 'red' } });
  assert.equal(bad.isError, true);

  // A connection shows up on the account page.
  const sessions = (await (await tool('account.list_sessions', {}, sam)).json()).result.sessions;
  assert.ok(sessions.some((x) => x.kind === 'connection' && x.name === 'Claude Code'));

  // Deleting the account from an AI app waits for the person's yes.
  const del = await rpc('tools/call', { name: 'account_delete', arguments: { confirm: 'delete' } });
  assert.ok(del.structuredContent.pending.approval_id);
  const aps = (await (await tool('account.list_approvals', {}, sam)).json()).result.approvals;
  assert.equal(aps.length, 1);
  // The AI app cannot answer its own approval.
  const self = await rpc('tools/call', { name: 'account_answer_approval', arguments: { approval_id: aps[0].id, answer: 'yes' } });
  assert.equal(self.isError, true);
  await tool('account.answer_approval', { approval_id: aps[0].id, answer: 'no' }, sam);

  // Refresh rotates; a reused refresh token ends the connection.
  const r1 = await (await req('/oauth/token', { method: 'POST', form: true, body: { grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id } })).json();
  assert.ok(r1.access_token);
  const r2 = await req('/oauth/token', { method: 'POST', form: true, body: { grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id } });
  assert.equal(r2.status, 400);
  const dead = await req('/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { authorization: `Bearer ${r1.access_token}` } });
  assert.equal(dead.status, 401);
});

test('teams: invite by email joins on first sign-in; roles; data home never shows the password', async () => {
  const t = (await (await tool('team.create', { name: 'Birch Law' }, sam)).json()).result;
  assert.equal(t.slug, 'birch-law');
  await tool('team.invite', { team: t.slug, email: 'jordan@birch.example', role: 'admin' }, sam);
  const jordan = await emailSignIn('jordan@birch.example');
  const jt = (await (await tool('team.list', {}, jordan)).json()).result.teams;
  assert.ok(jt.some((x) => x.slug === 'birch-law' && x.role === 'admin'));
  const r = await tool('team.set_data_home', { team: t.slug, kind: 'postgres', database_url: DB }, jordan);
  const h = (await r.json()).result;
  assert.equal(h.kind, 'postgres');
  assert.ok(!JSON.stringify(h).includes('@'));
  const gh = (await (await tool('team.set_data_home', { team: t.slug, kind: 'github', repo: 'waronsaas/data' }, jordan)).json());
  assert.equal(gh.error.code, 'invalid_input');
  const mv = (await (await tool('team.move_data_home', { team: t.slug, to: 'cloud' }, jordan)).json()).result;
  assert.equal(mv.status, 'planned');
  assert.ok(mv.steps.find((s) => s.app === 'crm'));
  const ex = (await (await tool('team.export', { team: t.slug }, jordan)).json()).result;
  assert.equal(ex.members.length, 2);
  // An admin cannot make an owner.
  const own = await tool('team.set_role', { team: t.slug, account_id: ex.members[1].id, role: 'owner' }, jordan);
  assert.equal(own.status, 403);
});

test('sign out everywhere reaches the apps', async () => {
  const { WosAccount } = await import('../client/account-client.mjs');
  const acct = new WosAccount({ issuer: base, clientId: 'crm', clientSecret: crmSecret, redirectUri: 'http://localhost:9999/auth/waronsaas/callback' });
  const s = acct.start({ secure: false });
  const back = (await req(s.location, { cookies: sam })).headers.get('location');
  const done = await acct.finish({ url: back.replace('http://localhost:9999', ''), headers: { cookie: s.cookie.split(';')[0] } });
  await tool('account.sign_out_everywhere', {}, sam);
  acct.live.clear();
  assert.equal(await acct.isLive(done.profile.sid), false);
  assert.equal((await tool('account.me', {}, sam)).status, 401);
});

test('delete account from the screen', async () => {
  const riley = await emailSignIn('riley@acme.example');
  const r = (await (await tool('account.delete', { confirm: 'delete' }, riley)).json());
  assert.equal(r.result.ok, true);
  assert.equal((await req('/', { cookies: riley })).status, 200);
  assert.match(await (await req('/', { cookies: riley })).text(), /Sign in to warOnSaaS/);
});

test('sign out everywhere and delete reach apps over the back-channel', async () => {
  const got = [];
  const app = http.createServer(async (rq, rs) => { let b = ''; for await (const c of rq) b += c; got.push({ path: rq.url, token: new URLSearchParams(b).get('logout_token') }); rs.writeHead(200).end(); }).listen(0);
  const home = `http://127.0.0.1:${app.address().port}`;
  const { openDb } = await import('../lib/db.mjs');
  const { upsertClient } = await import('../lib/clients.mjs');
  const db = openDb(DB);
  const sec = (await upsertClient(db, { id: 'chat', name: 'Chat', redirectUris: ['http://localhost:9998/auth/waronsaas/callback'], home })).secret;
  await db.close();
  const { WosAccount } = await import('../client/account-client.mjs');
  const acct = new WosAccount({ issuer: base, clientId: 'chat', clientSecret: sec, redirectUri: 'http://localhost:9998/auth/waronsaas/callback' });
  const jordan = await emailSignIn('jordan2@birch.example');
  const me = (await (await tool('account.me', {}, jordan)).json()).result;
  await tool('account.sign_out_everywhere', {}, jordan);
  assert.equal(got.length, 1);
  assert.equal(got[0].path, '/auth/waronsaas/backchannel');
  assert.deepEqual(await acct.verifyLogoutToken(got[0].token), { sub: me.id, deleted: false });
  assert.equal(await acct.verifyLogoutToken('nope.nope.nope'), null);
  const j2 = await emailSignIn('jordan2@birch.example');
  await tool('account.delete', { confirm: 'delete' }, j2);
  assert.deepEqual(await acct.verifyLogoutToken(got.at(-1).token), { sub: me.id, deleted: true });
  app.close();
});
