// Parity: every tool has a handler, every handler is in the catalogue, and every button, link-action, select and
// form on every screen names a tool (or data-tool="none" with a reason). Fails the build otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CATALOGUE, makeTools, byName } from '../lib/tools.mjs';
import * as P from '../lib/pages.mjs';

test('every tool has a handler and every handler a tool', () => {
  const H = makeTools({ db: {}, store: {}, teams: {}, connect: async () => {} });
  for (const t of CATALOGUE) assert.ok(H[t.name], `${t.name} has no handler`);
  for (const k of Object.keys(H)) assert.ok(byName.has(k), `${k} is not in tools.json or team.tools.json`);
  for (const t of CATALOGUE) {
    assert.ok(t.title && t.description && t.input?.type === 'object' && t.output && t.scope && t.confirm, `${t.name} is missing a field`);
    assert.ok(!new RegExp(String.fromCharCode(0x2014)).test(JSON.stringify(t)), `${t.name} has an em dash`);
  }
});

const sample = () => {
  const me = { id: 'acc_1', name: 'Sam Rivera', email: 'sam@acme.example', updates_opt_in: false, created_at: new Date().toISOString(), identities: [{ id: 'i1', provider: 'email', email: 'sam@acme.example' }, { id: 'i2', provider: 'github', login: 'sam' }], teams: [{ id: 't1', slug: 'acme-dental', name: 'Acme Dental', role: 'owner' }, { id: 't2', slug: 'sams-team', name: "Sam's team", role: 'owner', personal: true }] };
  const team = { id: 't1', slug: 'acme-dental', name: 'Acme Dental', personal: false, your_role: 'owner', members: [{ id: 'acc_1', name: 'Sam Rivera', email: 'sam@acme.example', role: 'owner' }, { id: 'acc_2', name: 'Jordan Lee', email: 'jordan@acme.example', role: 'member' }], invites: [{ id: 'inv1', email: 'casey@acme.example', role: 'member' }], brand: { accent: '#4635ff', custom_domain: { name: 'work.acme.example', status: 'requested', cname: 'cname.vercel-dns.com' } }, data_home: { kind: 'github', repo: 'acme-dental/wos-data', installed: false } };
  const sessions = [{ id: 's1', kind: 'browser', name: 'Chrome on Mac', current: true, method: 'github' }, { id: 's2', kind: 'app', name: 'CRM', parent_id: 's1' }, { id: 's3', kind: 'connection', name: 'Claude Code' }];
  const approvals = [{ id: 'apr1', tool: 'account.delete', input: {}, asked_by: 'Claude Code', created_at: new Date().toISOString() }];
  return { me, team, teams: me.teams, sessions, approvals, providers: { github: true, google: true, email: true } };
};

function actions(html) {
  const out = [];
  const re = /<(button|form|select|a|input)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, tag, attrs] = m;
    if (tag === 'input' && !/type="(file|color|submit|button)"/.test(attrs)) continue;
    if (tag === 'input' && /data-into=/.test(attrs) === false && /type="(file|color)"/.test(attrs)) { out.push({ tag, attrs, bad: 'file or colour input without data-tool' }); continue; }
    if (tag === 'select' && !/data-tool=/.test(attrs) && /\bname="/.test(attrs)) continue; // a field inside a tool form
    if (tag === 'button' && !/data-tool=/.test(attrs)) {
      // a submit button inside a form that names the tool is covered by the form
      const before = html.slice(0, m.index);
      const open = before.lastIndexOf('<form');
      const close = before.lastIndexOf('</form>');
      if (open > close && /data-tool=/.test(html.slice(open, html.indexOf('>', open)))) continue;
    }
    out.push({ tag, attrs });
  }
  return out;
}

test('every screen action names a tool (parity)', () => {
  const s = sample();
  const screens = {
    home: P.homePage(s),
    signIn: P.signInPage({ next: '/', providers: s.providers }),
    signInForApp: P.signInPage({ next: '/oauth/authorize?x', providers: s.providers, app: 'CRM' }),
    checkEmail: P.checkEmailPage({ email: 'sam@acme.example', next: '/' }),
    confirm: P.confirmLinkPage({ email: 'sam@acme.example', token: 't' }),
    consent: P.consentPage({ client: { name: 'Claude Code', first_party: false }, account: { email: 'sam@acme.example' }, scope: 'openid account', request: { r: 'r', back: '/' } }),
    message: P.messagePage({ title: 'x', text: 'y', link: { href: '/', label: 'Back' } }),
  };
  const report = {};
  let missing = [];
  for (const [name, html] of Object.entries(screens)) {
    const acts = actions(html);
    let tools = 0, none = 0;
    for (const a of acts) {
      const t = /data-tool="([^"]+)"/.exec(a.attrs)?.[1];
      if (!t || a.bad) { missing.push(`${name}: <${a.tag}${a.attrs.slice(0, 80)}>`); continue; }
      if (t === 'none') { if (!/data-why="[^"]+"/.test(a.attrs)) missing.push(`${name}: data-tool="none" without data-why`); none++; continue; }
      if (!byName.has(t)) missing.push(`${name}: names ${t}, which is not a tool`); else tools++;
    }
    report[name] = { actions: acts.length, tools, moves_only: none };
  }
  // Every tool a person can use has a button somewhere (team.get, team.list and the like are read by the page).
  const home = screens.home;
  const onScreen = new Set([...home.matchAll(/data-tool="([a-z_.]+)"/g)].map((x) => x[1]));
  const readByPage = ['account.me', 'account.list_sessions', 'account.list_approvals', 'team.list', 'team.get', 'team.get_brand', 'team.get_data_home'];
  const noButton = CATALOGUE.map((t) => t.name).filter((n) => !onScreen.has(n) && !readByPage.includes(n));
  fs.mkdirSync('.shots', { recursive: true });
  fs.writeFileSync('parity-report.json', `${JSON.stringify({ screens: report, tools: CATALOGUE.length, tools_with_button: onScreen.size, tools_read_by_page: readByPage, tools_without_screen: noButton, missing }, null, 2)}\n`);
  assert.deepEqual(missing, []);
  assert.deepEqual(noButton, [], `tools with no screen: ${noButton.join(', ')}`);
});

test('no em dashes in copy or code', () => {
  for (const f of ['server.mjs', 'lib/pages.mjs', 'lib/tools.mjs', 'public/app.js', 'public/prompt.js', 'client/account-client.mjs', 'tools.json', 'team.tools.json']) {
    assert.ok(!fs.readFileSync(f, 'utf8').includes(String.fromCharCode(0x2014)), `${f} has an em dash`);
  }
});

test('the served copy of the client library matches the source', () => {
  assert.equal(fs.readFileSync('public/account-client.mjs', 'utf8'), fs.readFileSync('client/account-client.mjs', 'utf8'));
});
