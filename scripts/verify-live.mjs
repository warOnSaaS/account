// Live check across the hosted apps with one throwaway account (a mail.tm inbox, never a real person):
//   1. sign in at account.waronsaas.com by email link;
//   2. open each app in the same browser: it must sign in silently (signed in on several apps at once);
//   3. connect to an app's /mcp the way Claude Code does (dynamic registration, PKCE, a loopback redirect),
//      list tools and call one as the account; optionally save the token for `claude mcp add --header`;
//   4. delete the test account at the end (unless --keep).
// node scripts/verify-live.mjs [--apps suite,crm,chat,...] [--mcp crm] [--keep] [--token-file path]
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Mailbox } from './mailbox.mjs';

const { chromium } = createRequire(`${process.env.HOME}/crm/package.json`)('playwright');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const A = 'https://account.waronsaas.com';
const HOSTS = { suite: 'https://app.waronsaas.com', board: 'https://kanban.waronsaas.com', crm: 'https://crm.waronsaas.com', chat: 'https://chat.waronsaas.com', email: 'https://mail.waronsaas.com', scanner: 'https://scanner.waronsaas.com', meet: 'https://meet.waronsaas.com' };
const apps = opt('apps', 'chat,crm,email,scanner,board,suite').split(',').filter(Boolean);
const mcpApp = opt('mcp', 'crm');
fs.mkdirSync('.shots', { recursive: true });
const out = { account: null, apps: {}, mcp: null };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// 1. Email link sign-in at the account.
const box = await Mailbox.create();
await page.goto(`${A}/sign-in`);
await page.fill('input[name=email]', box.address);
await page.click('form.ac-email button');
await page.waitForSelector('text=Check your email');
const mail = await box.waitFor(/Sign in/);
const link = mail.text.match(/https:\/\/account\.waronsaas\.com\/auth\/email\/verify\?t=[^\s\]]+/)[0];
await page.goto(link);
await page.click('button:has-text("Continue")');
await page.waitForSelector('text=What should we call you');
await page.fill('input[name=name]', 'Riley Test');
await page.click('button:has-text("Continue")');
await page.waitForSelector('#profile');
out.account = { email: box.address, from: mail.from };
console.log(`signed in at the account by email link (mail from ${mail.from})`);

// 2. Each app, same browser: signed in without a click?
for (const app of apps) {
  const t0 = Date.now();
  const p = await ctx.newPage();
  try {
    await p.goto(HOSTS[app], { waitUntil: 'domcontentloaded' });
    // Apps sign in silently through /auth/waronsaas?prompt=none (prompt.js) or straight from their sign-in page.
    let signedIn = false;
    for (let i = 0; i < 40 && !signedIn; i++) {
      await p.waitForTimeout(750);
      signedIn = await p.evaluate(() => {
        const s = document.querySelector('script[src*="account.waronsaas.com/prompt.js"]');
        if (s) return s.dataset.signedIn === 'true';
        return null;
      }).catch(() => false);
      if (signedIn === null) {
        // No prompt.js (the suite): ask the app who this is.
        const who = await p.evaluate(async () => { const r = await fetch('/api/tools/account.me', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wos': '1' }, body: '{}' }); return r.ok ? (await r.json()).result?.user?.email ?? null : null; }).catch(() => null);
        signedIn = who === out.account.email;
        if (!signedIn && i === 3 && /\/auth\/sign-in|\/$/.test(new URL(p.url()).pathname)) {
          // The suite opens its demo for a first visit; signing in is one press there.
          await p.goto(`${HOSTS[app]}/auth/waronsaas?next=/`);
        }
      }
    }
    await p.screenshot({ path: `.shots/live-${app}-1440.png` });
    out.apps[app] = { signedIn: !!signedIn, url: p.url(), ms: Date.now() - t0 };
    console.log(`${app}: ${signedIn ? 'signed in' : 'NOT signed in'} at ${p.url()} (${Date.now() - t0} ms)`);
  } catch (e) {
    out.apps[app] = { error: e.message.slice(0, 200) };
    console.log(`${app}: error ${e.message.slice(0, 120)}`);
  } finally {
    await p.close();
  }
}

// 3. MCP the way Claude Code connects: register, authorize in the browser, loopback, token, tools.
if (mcpApp) {
  const base = HOSTS[mcpApp];
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${srv.address().port}/callback`;
  const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  const reg = await (await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude Code', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(8).toString('hex');
  const got = new Promise((resolve) => srv.on('request', (rq, rs) => { const u = new URL(rq.url, 'http://x'); rs.writeHead(200).end('ok'); resolve(Object.fromEntries(u.searchParams)); }));
  const au = new URL(meta.authorization_endpoint);
  Object.entries({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, resource: `${base}/mcp` }).forEach(([k, v]) => au.searchParams.set(k, v));
  const p = await ctx.newPage();
  await p.goto(au.toString());
  // Some apps ask "Allow?" once; press it if shown.
  for (let i = 0; i < 6; i++) {
    const allow = p.locator('button:has-text("Allow"), button:has-text("Connect"), button:has-text("Continue")').first();
    if (await allow.isVisible().catch(() => false)) { await p.screenshot({ path: `.shots/live-${mcpApp}-mcp-consent-1440.png` }); await allow.click().catch(() => {}); }
    const done = await Promise.race([got.then(() => true), p.waitForTimeout(1500).then(() => false)]);
    if (done) break;
  }
  const q = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 20000))]);
  srv.close();
  if (!q?.code) { out.mcp = { error: `no code (at ${p.url()})` }; console.log('mcp: no code', p.url()); }
  else {
    const tok = await (await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) })).json();
    const rpc = async (method, params) => (await (await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).text());
    const parse = (t) => JSON.parse(t.startsWith('event:') || t.startsWith('data:') ? t.split('\n').find((l) => l.startsWith('data:')).slice(5) : t);
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: 'verify' } });
    const list = parse(await rpc('tools/list', {})).result?.tools ?? [];
    console.log('tools:', list.map((t) => t.name).slice(0, 40).join(' '));
    const whoTool = list.find((t) => /whoami|[._]me$|get_me|my_profile/.test(t.name)) ?? list.find((t) => /[._](list|find|search)/.test(t.name));
    const call = whoTool ? parse(await rpc('tools/call', { name: whoTool.name, arguments: {} })).result : null;
    out.mcp = { app: mcpApp, tools: list.length, called: whoTool?.name, result: JSON.stringify(call?.structuredContent ?? call?.content?.[0]?.text ?? null).slice(0, 300), sessions: null };
    console.log(`mcp ${mcpApp}: ${list.length} tools; ${whoTool?.name} -> ${out.mcp.result}`);
    if (opt('token-file')) fs.writeFileSync(opt('token-file'), tok.access_token, { mode: 0o600 });
    // Claude Code itself: add the app's MCP with this account-issued token, ask Claude Code whether it connects
    // (a health check, no model run), then remove it again. The token never prints.
    if (args.includes('--claude')) {
      const { spawnSync } = await import('node:child_process');
      const cwd = fs.mkdtempSync('/tmp/wos-claude-');
      const name = `wos-${mcpApp}-verify`;
      spawnSync('claude', ['mcp', 'add', '--transport', 'http', '--scope', 'local', name, `${base}/mcp`, '--header', `Authorization: Bearer ${tok.access_token}`], { cwd, stdio: 'ignore' });
      const listed = spawnSync('claude', ['mcp', 'list'], { cwd, encoding: 'utf8', timeout: 90000 }).stdout ?? '';
      const line = listed.split('\n').find((l) => l.includes(name)) ?? '';
      out.mcp.claude_code = line.replace(/Bearer\s+\S+/g, 'Bearer ***').trim();
      console.log('claude mcp list:', out.mcp.claude_code || '(not listed)');
      spawnSync('claude', ['mcp', 'remove', '--scope', 'local', name], { cwd, stdio: 'ignore' });
    }
    // The account lists the connection as an AI app acting as this person.
    await page.goto(`${A}/#signins`);
    const sess = await page.evaluate(() => window.callTool('account.list_sessions', {}));
    out.mcp.sessions = sess.sessions.map((s) => `${s.kind}: ${s.name}`);
    console.log('account sessions:', out.mcp.sessions.join(' | '));
    await page.screenshot({ path: '.shots/live-account-sessions-1440.png', fullPage: false });
  }
  await p.close();
}

// 4. Clean up.
if (!args.includes('--keep')) {
  const r = await page.evaluate(() => window.callTool('account.delete', { confirm: 'delete' }).then(() => 'deleted').catch((e) => e.message));
  console.log('test account:', r);
}
fs.writeFileSync('.shots/live-report.json', `${JSON.stringify(out, null, 2)}\n`);
await browser.close();
