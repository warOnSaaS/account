import fs from 'node:fs';
import { id, later, DAY } from './util.mjs';
import { Teams, checkPostgres } from './teams.mjs';
import { APPS } from './apps.mjs';

// Every account and team action, written once. The account screens call these through /api/tools/<name>,
// AI apps call them through /mcp; both reach the same handler with a `call`:
//   { account, session, via: 'screen' | 'agent', client }  (client: the AI app's name, for agents)

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).tools;
export const CATALOGUE = [...read('tools.json'), ...read('team.tools.json')];
export const byName = new Map(CATALOGUE.map((t) => [t.name, t]));
export const toWire = (n) => n.replace('.', '_');
export const fromWire = (n) => (byName.has(n) ? n : String(n).replace('_', '.'));

export class ToolError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new ToolError(code, message, status); };
const must = (r) => { if (r?.error) fail(r.error === 'not_found' ? 'not_found' : r.error === 'forbidden' ? 'scope' : 'invalid_input', r.message ?? r.error, r.error === 'not_found' ? 404 : r.error === 'forbidden' ? 403 : 400); return r; };

export function makeTools({ db, store, teams, connect }) {
  const team = async (call, ref, want = 'guest') => must(await teams.access(call.account.id, ref, want)).team;

  const H = {
    // ---------- account ----------
    async 'account.me'(_, call) {
      const a = call.account;
      return {
        id: a.id, name: a.name, email: a.email, avatar_url: a.avatar_url, updates_opt_in: a.updates_opt_in, created_at: a.created_at,
        identities: (await store.identities(a.id)).map((i) => ({ id: i.id, provider: i.provider, email: i.email, login: i.login, last_used_at: i.last_used_at })),
        teams: (await teams.of(a.id)).map((t) => ({ id: t.id, slug: t.slug, name: t.name, role: t.role, personal: t.personal })),
      };
    },
    async 'account.update_profile'(input, call) {
      if (input.name !== undefined && !(await store.rename(call.account.id, input.name))) fail('invalid_input', 'Your name cannot be empty');
      if (input.updates_opt_in !== undefined) await store.setUpdates(call.account.id, !!input.updates_opt_in);
      return { ok: true };
    },
    async 'account.list_sessions'(_, call) {
      const rows = await store.sessions(call.account.id);
      return { sessions: rows.map((s) => ({ id: s.id, kind: s.kind, name: s.kind === 'browser' ? browserName(s.user_agent) : s.label ?? s.client_name ?? 'An app', client: s.client_name, method: s.method, current: s.id === call.session?.id || s.id === call.session?.parent_id, created_at: s.created_at, last_used_at: s.last_used_at, expires_at: s.expires_at })) };
    },
    async 'account.end_session'(input, call) {
      if (!(await store.revokeSession(call.account.id, String(input.session_id)))) fail('not_found', 'No such session, or it already ended', 404);
      return { ok: true };
    },
    async 'account.sign_out_everywhere'(_, call) {
      return { ended: await store.revokeAll(call.account.id) };
    },
    async 'account.unlink_identity'(input, call) {
      const r = await store.unlink(call.account.id, String(input.identity_id));
      if (r.error === 'last_identity') fail('invalid_input', 'This is your only way to sign in. Add another one first.');
      if (r.error) fail('not_found', 'No such way to sign in on your account', 404);
      return { ok: true };
    },
    async 'account.export'(_, call) {
      const out = await store.export(call.account.id);
      out.teams = await teams.of(call.account.id);
      out.teams = out.teams.map((t) => ({ ...t, data_home: Teams.publicHome(t.data_home) }));
      return out;
    },
    async 'account.delete'(input, call) {
      if (String(input.confirm).trim().toLowerCase() !== 'delete') fail('invalid_input', 'Type delete to confirm');
      const a = call.account.id;
      await db.tx(async (t) => {
        for (const m of await t.query('SELECT team_id, role FROM team_members WHERE account_id = $1', [a])) {
          const others = await t.query("SELECT account_id, role FROM team_members WHERE team_id = $1 AND account_id <> $2 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, added_at", [m.team_id, a]);
          if (!others.length) await t.run('DELETE FROM teams WHERE id = $1', [m.team_id]);
          else if (m.role === 'owner' && !others.some((o) => o.role === 'owner')) await t.run("UPDATE team_members SET role = 'owner' WHERE team_id = $1 AND account_id = $2", [m.team_id, others[0].account_id]);
        }
      });
      await store.remove(a);
      return { ok: true };
    },
    async 'account.list_approvals'(_, call) {
      return { approvals: await db.query('SELECT id, tool, input, asked_by, created_at, expires_at FROM approvals WHERE account_id = $1 AND answered_at IS NULL AND expires_at > now() ORDER BY created_at DESC', [call.account.id]) };
    },
    async 'account.answer_approval'(input, call) {
      if (call.via !== 'screen') fail('scope', 'Only a person on the account page can answer an approval', 403);
      const ap = await db.get('SELECT * FROM approvals WHERE id = $1 AND account_id = $2 AND answered_at IS NULL AND expires_at > now()', [String(input.approval_id), call.account.id]);
      if (!ap) fail('not_found', 'No such approval, or it was already answered', 404);
      const yes = input.answer === 'yes';
      await db.run('UPDATE approvals SET answered_at = now(), answer = $2 WHERE id = $1', [ap.id, yes ? 'yes' : 'no']);
      if (!yes) return { answered: 'no' };
      const result = await H[ap.tool](ap.input, { ...call, via: 'approved' });
      return { answered: 'yes', tool: ap.tool, result };
    },

    // ---------- teams ----------
    async 'team.list'(_, call) {
      return { teams: (await teams.of(call.account.id)).map((t) => ({ id: t.id, slug: t.slug, name: t.name, role: t.role, personal: t.personal })) };
    },
    async 'team.create'(input, call) {
      const r = must(await teams.create(call.account.id, input.name));
      await store.event(call.account.id, 'team.created', { team: r.team.id, name: r.team.name });
      return { id: r.team.id, slug: r.team.slug };
    },
    async 'team.get'(input, call) {
      const t = await team(call, input.team);
      return { id: t.id, slug: t.slug, name: t.name, personal: t.personal, your_role: t.role, members: await teams.members(t.id), invites: await teams.invites(t.id), brand: t.brand, data_home: Teams.publicHome(t.data_home) };
    },
    async 'team.update'(input, call) {
      const t = await team(call, input.team, 'admin');
      return must(await teams.rename(t.id, input.name));
    },
    async 'team.invite'(input, call) {
      const t = await team(call, input.team, 'admin');
      return must(await teams.invite(t.id, input.email, input.role ?? 'member', call.account.id));
    },
    async 'team.revoke_invite'(input, call) {
      const t = await team(call, input.team, 'admin');
      const r = await teams.revokeInvite(t.id, String(input.invite_id));
      if (!r.ok) fail('not_found', 'No such open invite', 404);
      return r;
    },
    async 'team.set_role'(input, call) {
      const t = await team(call, input.team, 'admin');
      if (input.role === 'owner' && t.role !== 'owner') fail('scope', 'Only an owner can make someone owner', 403);
      return must(await teams.setRole(t.id, String(input.account_id), input.role));
    },
    async 'team.remove_member'(input, call) {
      const t = await team(call, input.team, 'admin');
      return must(await teams.removeMember(t.id, String(input.account_id)));
    },
    async 'team.leave'(input, call) {
      const t = await team(call, input.team);
      return must(await teams.removeMember(t.id, call.account.id));
    },
    async 'team.delete'(input, call) {
      const t = await team(call, input.team, 'owner');
      if (String(input.confirm ?? '').trim() !== t.name) fail('invalid_input', `Type the team name (${t.name}) to confirm`);
      await teams.remove(t.id);
      await store.event(call.account.id, 'team.deleted', { team: t.id, name: t.name });
      return { ok: true };
    },

    // ---------- brand kit ----------
    async 'team.get_brand'(input, call) {
      const t = await team(call, input.team);
      return { team: t.slug, ...t.brand };
    },
    async 'team.set_brand'(input, call) {
      const t = await team(call, input.team, 'admin');
      const { team: _, ...rest } = input;
      const r = must(await teams.setBrand(t.id, rest));
      return { team: t.slug, ...r.brand };
    },

    // ---------- data home ----------
    async 'team.get_data_home'(input, call) {
      const t = await team(call, input.team);
      return Teams.publicHome(t.data_home);
    },
    async 'team.set_data_home'(input, call) {
      const t = await team(call, input.team, 'admin');
      const next = await resolveHome(input, { connect, t });
      await teams.setHome(t.id, next.home, next.secret);
      await store.event(call.account.id, 'team.data_home.changed', { team: t.id, kind: next.home.kind });
      return Teams.publicHome(next.home);
    },
    async 'team.move_data_home'(input, call) {
      const t = await team(call, input.team, 'admin');
      const to = await resolveHome({ ...input, kind: input.to }, { connect, t });
      const from = Teams.publicHome(t.data_home);
      const steps = APPS.map((a) => ({
        app: a.id, name: a.name,
        status: 'waiting',
        does: `Export ${a.name} data for ${t.name} from ${label(from)}, write it into ${label(to.home)}, count rows on both sides, then switch ${a.name} over. The old copy stays read-only for 30 days.`,
        ready: false,
        note: `The copy for ${a.name} is designed but not built yet. Use team.export to take the data now.`,
      }));
      const mid = id('move');
      await db.run('INSERT INTO moves (id, team_id, from_home, to_home, status, steps, started_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [mid, t.id, from, Teams.publicHome(to.home), input.start ? 'waiting' : 'planned', JSON.stringify(steps), call.account.id]);
      return { move_id: mid, status: input.start ? 'waiting' : 'planned', from, to: Teams.publicHome(to.home), steps };
    },
    async 'team.export'(input, call) {
      const t = await team(call, input.team, 'admin');
      return {
        exported_at: new Date().toISOString(),
        team: { id: t.id, slug: t.slug, name: t.name, created_at: t.created_at },
        members: await teams.members(t.id), invites: await teams.invites(t.id), brand: t.brand, data_home: Teams.publicHome(t.data_home),
        apps: APPS.map((a) => ({ app: a.id, name: a.name, export_tool: a.export, export_url: `${a.url}/api/tools/${a.export}?team=${encodeURIComponent(t.slug)}` })),
        note: 'Each app hands over its own data through its export tool, signed in as you. Call each export_url with POST, or ask your AI app to.',
      };
    },
  };

  return H;
}

async function resolveHome(input, { connect, t }) {
  const kind = input.kind ?? 'cloud';
  if (kind === 'cloud') return { home: { kind: 'cloud' } };
  if (kind === 'postgres') {
    if (!input.database_url) fail('invalid_input', 'database_url is required for your own database');
    const r = await checkPostgres(String(input.database_url), connect);
    if (r.error) fail('invalid_input', r.error);
    return { home: { kind: 'postgres', host: r.host, database: r.database, checked_at: new Date().toISOString() }, secret: String(input.database_url) };
  }
  if (kind === 'github') {
    const repo = String(input.repo ?? '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo)) fail('invalid_input', 'repo must be owner/name, in your own GitHub account or organization');
    const owner = repo.split('/')[0].toLowerCase();
    if (['waronsaas'].includes(owner)) fail('invalid_input', 'Your data lives in your own GitHub account or organization, never in ours. Pick a repo you own.');
    const slug = process.env.GITHUB_DATA_APP_SLUG || 'waronsaas-board';
    const installationId = await findInstallation(repo).catch(() => null);
    return { home: { kind: 'github', repo, installation_id: installationId, install_url: `https://github.com/apps/${slug}/installations/new`, checked_at: new Date().toISOString(), team: t.id } };
  }
  fail('invalid_input', 'kind must be cloud, postgres or github');
}

// With the data GitHub App's key (GITHUB_DATA_APP_ID, GITHUB_DATA_APP_PRIVATE_KEY) we can see whether it is
// installed on the repo. Without it the home is saved and shows "install the app" until an app checks.
async function findInstallation(repo) {
  const appId = process.env.GITHUB_DATA_APP_ID;
  const key = String(process.env.GITHUB_DATA_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!appId || !key) return null;
  const crypto = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const jwt = `${body}.${crypto.sign('sha256', Buffer.from(body), key).toString('base64url')}`;
  const r = await fetch(`https://api.github.com/repos/${repo}/installation`, { headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'user-agent': 'warOnSaaS-account' } });
  return r.ok ? (await r.json()).id : null;
}

const label = (h) => (h.kind === 'cloud' ? 'warOnSaaS Cloud' : h.kind === 'postgres' ? `your database at ${h.host}` : `your repo ${h.repo}`);

export function browserName(ua = '') {
  const s = String(ua ?? '');
  const b = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'A browser';
  const os = /iPhone|iPad/.test(s) ? 'iPhone' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}

/** Runs a tool for a caller. A confirm: human tool asked for by an AI app waits for the person's yes. */
export async function runTool(H, db, name, input, call) {
  const spec = byName.get(name);
  if (!spec || !H[name]) throw new ToolError('no_tool', `There is no tool called ${name}`, 404);
  const clean = validate(spec.input, input ?? {});
  if (spec.confirm === 'human' && call.via === 'agent') {
    const aid = id('apr');
    await db.run('INSERT INTO approvals (id, account_id, tool, input, asked_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [aid, call.account.id, name, clean, call.client ?? 'An AI app', later(7 * DAY)]);
    return { pending: { approval_id: aid, message: `Waiting for ${call.account.name} to say yes at ${process.env.PUBLIC_URL ?? ''}/#approvals` } };
  }
  return { result: await H[name](clean, call) };
}

// A small JSON Schema check: types, required, enums, no unknown keys. Enough for flat tool inputs.
export function validate(schema, input) {
  if (typeof input !== 'object' || Array.isArray(input) || input === null) throw new ToolError('invalid_input', 'The input must be an object');
  const props = schema.properties ?? {};
  for (const r of schema.required ?? []) if (input[r] === undefined || input[r] === null || input[r] === '') throw new ToolError('invalid_input', `${r}: required`);
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const p = props[k];
    if (!p) { if (schema.additionalProperties === false) throw new ToolError('invalid_input', `${k}: not a field of this tool`); continue; }
    if (v === undefined) continue;
    if (p.type === 'string' && typeof v !== 'string') throw new ToolError('invalid_input', `${k}: must be text`);
    if (p.type === 'boolean' && typeof v !== 'boolean') throw new ToolError('invalid_input', `${k}: must be true or false`);
    if (p.enum && !p.enum.includes(v)) throw new ToolError('invalid_input', `${k}: must be one of ${p.enum.filter(Boolean).join(', ')}`);
    out[k] = v;
  }
  return out;
}
