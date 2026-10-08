// Creates the "warOnSaaS Account" GitHub App with one click, through GitHub's manifest flow, and puts its keys
// straight into the Vercel project's settings. Nothing secret is printed or written to disk.
//
//   node scripts/github-app.mjs [--org warOnSaaS] [--port 3991] [--issuer https://account.waronsaas.com]
//        [--vercel-scope battle-juice] [--no-deploy]
//
// Then open http://127.0.0.1:3991/ and press "Create GitHub App for warOnSaaS". Sign-in only: the app asks for
// the person's email addresses (read) and nothing else; no repo permissions.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const org = opt('org', 'warOnSaaS');
const port = Number(opt('port', 3991));
const issuer = opt('issuer', 'https://account.waronsaas.com');
const scope = opt('vercel-scope', 'battle-juice');
const statusFile = opt('status-file', '.github-app-status');
const state = crypto.randomBytes(16).toString('hex');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const manifest = {
  name: 'warOnSaaS Account',
  url: issuer,
  description: 'Sign in to warOnSaaS with GitHub. Reads your verified email address to link your account; no access to your repos.',
  public: true,
  redirect_url: `http://127.0.0.1:${port}/done`,
  callback_urls: [`${issuer}/auth/github/callback`],
  request_oauth_on_install: false,
  hook_attributes: { url: `${issuer}/github/events`, active: false },
  default_permissions: { emails: 'read' },
  default_events: [],
};
const action = `https://github.com/${org ? `organizations/${encodeURIComponent(org)}/` : ''}settings/apps/new?state=${state}`;

const page = (inner) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>warOnSaaS Account: GitHub App</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#fafafa;font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:16px">
<main style="width:min(440px,100%);background:#111113;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:28px">${inner}</main></body>`;

const write = (o) => fs.writeFileSync(statusFile, `${JSON.stringify({ at: new Date().toISOString(), ...o })}\n`);
write({ status: 'waiting', url: `http://127.0.0.1:${port}/` });

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${port}`);
  if (u.pathname === '/done') {
    if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) return res.writeHead(400).end('This was not the reply we were waiting for. Run the command again.');
    try {
      const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(u.searchParams.get('code'))}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json', 'user-agent': 'warOnSaaS-account' } });
      const b = await r.json();
      if (!r.ok) throw new Error(`GitHub ${r.status}: ${b.message ?? ''}`);
      const env = { GITHUB_APP_ID: String(b.id), GITHUB_APP_SLUG: b.slug, GITHUB_APP_CLIENT_ID: b.client_id, GITHUB_APP_CLIENT_SECRET: b.client_secret, GITHUB_APP_PRIVATE_KEY: b.pem };
      const saved = [];
      for (const [k, v] of Object.entries(env)) {
        spawnSync('vercel', ['env', 'rm', k, 'production', '--yes', '--scope', scope], { stdio: 'ignore' });
        const x = spawnSync('vercel', ['env', 'add', k, 'production', '--scope', scope], { input: v, stdio: ['pipe', 'ignore', 'ignore'] });
        saved.push(`${k}:${x.status === 0 ? 'ok' : 'failed'}`);
      }
      let deployed = 'skipped';
      if (!args.includes('--no-deploy')) deployed = spawnSync('vercel', ['deploy', '--prod', '--yes', '--scope', scope], { stdio: 'ignore' }).status === 0 ? 'ok' : 'failed';
      write({ status: 'done', slug: b.slug, app: b.html_url, saved, deployed });
      console.log(`GitHub App ${b.slug} created; keys saved to Vercel (${saved.join(', ')}); deploy ${deployed}.`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(`<h1 style="margin:0 0 8px;font-size:22px">Done</h1><p style="color:#a1a1aa;margin:0">The warOnSaaS Account GitHub App exists and its keys are saved in Vercel. GitHub sign-in on account.waronsaas.com is switching on now. You can close this tab.</p>`));
    } catch (e) {
      write({ status: 'failed', error: e.message });
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' }).end(page(`<h1 style="margin:0 0 8px;font-size:22px">That did not finish</h1><p style="color:#a1a1aa">${esc(e.message)}</p>`));
    }
    srv.close();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(`<h1 style="margin:0 0 8px;font-size:22px">One click: GitHub sign-in</h1>
<p style="color:#a1a1aa;margin:0 0 20px">This makes the <b style="color:#fafafa">warOnSaaS Account</b> GitHub App in the ${esc(org)} organization. It is only for signing in: it reads a person's email address and has no access to any repo. GitHub shows the form filled in; press <b style="color:#fafafa">Create GitHub App</b> there.</p>
<form method="post" action="${esc(action)}"><input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}">
<button style="width:100%;min-height:44px;border:0;border-radius:9px;background:#7dd3fc;color:#04202e;font:600 15px system-ui;cursor:pointer">Create GitHub App for ${esc(org)}</button></form></main>`));
});
srv.listen(port, '127.0.0.1', () => console.log(`Open http://127.0.0.1:${port}/ and press the button.`));
setTimeout(() => { write({ status: 'timed_out' }); srv.close(); process.exit(1); }, 6 * 3600_000).unref();
