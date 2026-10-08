import { id, seal, unseal, later, DAY } from './util.mjs';

export const ROLES = ['owner', 'admin', 'member', 'guest'];
const RANK = { owner: 4, admin: 3, member: 2, guest: 1 };
export const atLeast = (role, want) => (RANK[role] ?? 0) >= (RANK[want] ?? 99);

// The ui-design v2 options a team can pick (see waronsaas-ui-design README, "The look").
export const SCHEMES = ['ops', 'midnight', 'neutral', 'ember', 'tide', 'sage', 'arcade', 'warroom'];
export const MODES = ['light', 'dark', 'auto'];
export const TYPES = ['grotesk', 'mono', 'editorial', 'humanist', 'pixel', 'system'];
export const SHAPES = ['sharp', 'soft', 'round'];

const HEX = /^#[0-9a-f]{6}$/i;
const okUrl = (u, { data = false } = {}) => {
  if (!u) return true;
  if (data && /^data:image\/(png|svg\+xml|webp|jpeg);base64,[a-z0-9+/=]+$/i.test(u)) return u.length <= 300_000;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
};
const FONT_HREF = /^https:\/\/fonts\.(googleapis|bunny)\.net\/css2?\?/;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Checks and tidies a brand kit. Returns { brand } or { error }. */
export function cleanBrand(input = {}, prev = {}) {
  const b = { ...prev };
  const set = (k, v) => { if (v === null || v === '') delete b[k]; else if (v !== undefined) b[k] = v; };
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (has('logo_light')) { if (!okUrl(input.logo_light, { data: true })) return { error: 'logo_light must be an https link or a small image (png, svg, webp, jpeg) under 220 KB' }; set('logo_light', input.logo_light); }
  if (has('logo_dark')) { if (!okUrl(input.logo_dark, { data: true })) return { error: 'logo_dark must be an https link or a small image (png, svg, webp, jpeg) under 220 KB' }; set('logo_dark', input.logo_dark); }
  if (has('accent')) { if (input.accent && !HEX.test(input.accent)) return { error: 'accent must be a colour like #4635ff' }; set('accent', input.accent?.toLowerCase()); }
  if (has('on_accent')) { if (input.on_accent && !HEX.test(input.on_accent)) return { error: 'on_accent must be a colour like #ffffff' }; set('on_accent', input.on_accent?.toLowerCase()); }
  if (has('scheme')) { if (input.scheme && !SCHEMES.includes(input.scheme)) return { error: `scheme must be one of ${SCHEMES.join(', ')}` }; set('scheme', input.scheme); }
  if (has('mode')) { if (input.mode && !MODES.includes(input.mode)) return { error: `mode must be one of ${MODES.join(', ')}` }; set('mode', input.mode); }
  if (has('type')) { if (input.type && !TYPES.includes(input.type)) return { error: `type must be one of ${TYPES.join(', ')}` }; set('type', input.type); }
  if (has('shape')) { if (input.shape && !SHAPES.includes(input.shape)) return { error: `shape must be one of ${SHAPES.join(', ')}` }; set('shape', input.shape); }
  for (const k of ['font', 'display']) {
    if (has(k)) { const v = input[k] == null ? '' : String(input[k]).trim().slice(0, 120); if (/[;{}<>]/.test(v)) return { error: `${k} must be a font name, like "Poppins, sans-serif"` }; set(k, v); }
  }
  if (has('fonts_href')) { if (input.fonts_href && !FONT_HREF.test(input.fonts_href)) return { error: 'fonts_href must be a Google Fonts or Bunny Fonts stylesheet link' }; set('fonts_href', input.fonts_href); }
  if (has('custom_domain')) {
    const d = input.custom_domain ? String(input.custom_domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
    if (d && !DOMAIN.test(d)) return { error: 'custom_domain must be a domain name, like work.acme.example' };
    if (d) b.custom_domain = { name: d, status: prev.custom_domain?.name === d ? prev.custom_domain.status : 'requested', cname: 'cname.vercel-dns.com' };
    else delete b.custom_domain;
  }
  return { brand: b };
}

/** The brand as ui-design v2 CSS: options as data attributes, the brand layer as custom properties. */
export function brandCss(brand = {}) {
  const v = [];
  if (brand.accent) v.push(`--ui-accent:${brand.accent}`, '--ui-btn-bg:var(--ui-accent)');
  if (brand.on_accent) v.push(`--ui-on-accent:${brand.on_accent}`, `--ui-btn-ink:${brand.on_accent}`);
  if (brand.font) v.push(`--ui-font:${brand.font}`);
  if (brand.display) v.push(`--ui-display:${brand.display}`);
  const imp = brand.fonts_href ? `@import url("${brand.fonts_href}");\n` : '';
  return `${imp}:root{${v.join(';')}}\n`;
}

export const brandAttrs = (brand = {}) => ({ 'data-scheme': brand.scheme, 'data-mode': brand.mode, 'data-type': brand.type, 'data-shape': brand.shape });

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';

export class Teams {
  constructor(db) { this.db = db; }

  async uniqueSlug(t, name) {
    const base = slugify(name);
    for (let n = 1; n < 200; n++) {
      const s = n === 1 ? base : `${base}-${n}`;
      if (!(await t.get('SELECT 1 FROM teams WHERE slug = $1', [s]))) return s;
    }
    return `${base}-${id('x').slice(2, 8).toLowerCase()}`;
  }

  async create(accountId, name, { personal = false, t = this.db } = {}) {
    const n = String(name ?? '').trim().slice(0, 80);
    if (!n) return { error: 'A team needs a name' };
    const tid = id('team');
    const slug = await this.uniqueSlug(t, n);
    await t.run('INSERT INTO teams (id, slug, name, personal, created_by) VALUES ($1, $2, $3, $4, $5)', [tid, slug, n, personal, accountId]);
    await t.run('INSERT INTO team_members (team_id, account_id, role) VALUES ($1, $2, $3)', [tid, accountId, 'owner']);
    return { team: await t.get('SELECT * FROM teams WHERE id = $1', [tid]) };
  }

  /** Everyone gets a team of their own on first sign-in, and joins any team that invited their verified email. */
  async onSignIn(account, verifiedEmails = []) {
    const emails = [...new Set([account.email, ...verifiedEmails].filter(Boolean).map((e) => e.toLowerCase()))];
    for (const e of emails) {
      for (const inv of await this.db.query('SELECT * FROM team_invites WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()', [e])) {
        await this.db.run('INSERT INTO team_members (team_id, account_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [inv.team_id, account.id, inv.role]);
        await this.db.run('UPDATE team_invites SET accepted_at = now() WHERE id = $1', [inv.id]);
      }
    }
    if (!(await this.db.get('SELECT 1 FROM team_members WHERE account_id = $1 LIMIT 1', [account.id]))) {
      await this.create(account.id, `${String(account.name).split(' ')[0]}'s team`, { personal: true });
    }
  }

  of(accountId) {
    return this.db.query('SELECT t.id, t.slug, t.name, t.personal, m.role, t.brand, t.data_home, t.created_at FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.account_id = $1 ORDER BY t.personal DESC, t.created_at', [accountId]);
  }

  /** The team, if the account is on it with at least `want` role. Accepts an id or a slug; none means their first team. */
  async access(accountId, ref, want = 'guest') {
    const row = ref
      ? await this.db.get('SELECT t.*, m.role FROM teams t JOIN team_members m ON m.team_id = t.id AND m.account_id = $1 WHERE t.id = $2 OR t.slug = $2', [accountId, String(ref)])
      : await this.db.get('SELECT t.*, m.role FROM teams t JOIN team_members m ON m.team_id = t.id AND m.account_id = $1 ORDER BY t.personal DESC, t.created_at LIMIT 1', [accountId]);
    if (!row) return { error: 'not_found', message: 'No such team, or you are not on it' };
    if (!atLeast(row.role, want)) return { error: 'forbidden', message: `This needs the ${want} role on ${row.name}; you are ${row.role}` };
    return { team: row };
  }

  members(teamId) {
    return this.db.query('SELECT a.id, a.name, a.email, a.avatar_url, m.role, m.added_at FROM team_members m JOIN accounts a ON a.id = m.account_id WHERE m.team_id = $1 ORDER BY m.added_at', [teamId]);
  }
  invites(teamId) {
    return this.db.query('SELECT id, email, role, created_at, expires_at FROM team_invites WHERE team_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at', [teamId]);
  }

  async rename(teamId, name) {
    const n = String(name ?? '').trim().slice(0, 80);
    if (!n) return { error: 'A team needs a name' };
    await this.db.run('UPDATE teams SET name = $2, updated_at = now() WHERE id = $1', [teamId, n]);
    return { ok: true };
  }

  async invite(teamId, email, role, by) {
    const e = String(email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: 'That email address does not look right' };
    if (!ROLES.includes(role) || role === 'owner') return { error: 'role must be admin, member or guest' };
    const known = await this.db.get('SELECT a.id FROM accounts a WHERE lower(a.email) = $1 UNION SELECT account_id FROM identities WHERE lower(email) = $1 AND email_verified LIMIT 1', [e]);
    if (known) {
      await this.db.run('INSERT INTO team_members (team_id, account_id, role) VALUES ($1, $2, $3) ON CONFLICT (team_id, account_id) DO NOTHING', [teamId, known.id, role]);
      return { added: true, account_id: known.id };
    }
    const iid = id('inv');
    await this.db.run('INSERT INTO team_invites (id, team_id, email, role, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [iid, teamId, e, role, by, later(14 * DAY)]);
    return { invited: true, invite_id: iid };
  }

  async revokeInvite(teamId, inviteId) {
    return { ok: (await this.db.run('UPDATE team_invites SET revoked_at = now() WHERE id = $1 AND team_id = $2 AND accepted_at IS NULL', [inviteId, teamId])) > 0 };
  }

  async owners(teamId) { return (await this.db.get("SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND role = 'owner'", [teamId])).n; }

  async setRole(teamId, accountId, role) {
    if (!ROLES.includes(role)) return { error: `role must be one of ${ROLES.join(', ')}` };
    const m = await this.db.get('SELECT role FROM team_members WHERE team_id = $1 AND account_id = $2', [teamId, accountId]);
    if (!m) return { error: 'not_found', message: 'That person is not on the team' };
    if (m.role === 'owner' && role !== 'owner' && (await this.owners(teamId)) < 2) return { error: 'A team needs at least one owner. Make someone else owner first.' };
    await this.db.run('UPDATE team_members SET role = $3 WHERE team_id = $1 AND account_id = $2', [teamId, accountId, role]);
    return { ok: true };
  }

  async removeMember(teamId, accountId) {
    const m = await this.db.get('SELECT role FROM team_members WHERE team_id = $1 AND account_id = $2', [teamId, accountId]);
    if (!m) return { error: 'not_found', message: 'That person is not on the team' };
    if (m.role === 'owner' && (await this.owners(teamId)) < 2) return { error: 'A team needs at least one owner. Make someone else owner first.' };
    await this.db.run('DELETE FROM team_members WHERE team_id = $1 AND account_id = $2', [teamId, accountId]);
    return { ok: true };
  }

  async setBrand(teamId, input) {
    const row = await this.db.get('SELECT brand FROM teams WHERE id = $1', [teamId]);
    const out = cleanBrand(input, row?.brand ?? {});
    if (out.error) return out;
    await this.db.run('UPDATE teams SET brand = $2, updated_at = now() WHERE id = $1', [teamId, out.brand]);
    return { brand: out.brand };
  }

  async brandBySlug(ref) {
    const row = await this.db.get('SELECT slug, name, brand FROM teams WHERE slug = $1 OR id = $1', [String(ref)]);
    return row ? { team: row.slug, name: row.name, ...row.brand } : null;
  }

  /** The data home as a screen or an agent may see it: never the database password. */
  static publicHome(home = {}) {
    const h = { kind: home.kind ?? 'cloud' };
    if (h.kind === 'postgres') Object.assign(h, { host: home.host, database: home.database, checked_at: home.checked_at });
    if (h.kind === 'github') Object.assign(h, { repo: home.repo, installed: !!home.installation_id, checked_at: home.checked_at, install_url: home.install_url });
    return h;
  }

  async setHome(teamId, home, secretUrl = null) {
    await this.db.run('UPDATE teams SET data_home = $2, data_secret = $3, updated_at = now() WHERE id = $1', [teamId, home, secretUrl ? seal(secretUrl, 'data-home') : null]);
  }

  /** For our own apps only (client credentials): where this team's rows live, password included. */
  async homeForApp(teamRef) {
    const row = await this.db.get('SELECT id, slug, data_home, data_secret FROM teams WHERE id = $1 OR slug = $1', [String(teamRef)]);
    if (!row) return null;
    const h = { team: row.id, slug: row.slug, ...Teams.publicHome(row.data_home) };
    if (h.kind === 'postgres' && row.data_secret) h.database_url = unseal(row.data_secret, 'data-home');
    if (h.kind === 'github') h.installation_id = row.data_home.installation_id ?? null;
    return h;
  }

  async remove(teamId) { await this.db.run('DELETE FROM teams WHERE id = $1', [teamId]); }
}

/** A Postgres URL, checked by connecting and running SELECT 1. Returns what may be shown, or an error. */
export async function checkPostgres(url, connect) {
  let u;
  try { u = new URL(url); } catch { return { error: 'That does not look like a database address. It starts with postgres://' }; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { error: 'Only Postgres addresses work here (postgres:// or postgresql://)' };
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(u.hostname)) return { error: 'That address is on a private network we cannot reach. Use one reachable from the internet, with SSL.' };
  try {
    await connect(url);
  } catch (e) {
    return { error: `We could not connect: ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[address]').slice(0, 200)}` };
  }
  return { host: u.hostname, database: u.pathname.slice(1) || 'postgres' };
}
