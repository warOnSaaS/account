import { id, secret, sha256, later, DAY } from './util.mjs';

// Accounts, the ways people sign in, and their sessions. Every secret is stored as a hash.
export class Store {
  constructor(db) { this.db = db; }

  account(accountId) { return this.db.get('SELECT * FROM accounts WHERE id = $1', [accountId]); }
  identities(accountId) { return this.db.query('SELECT id, provider, subject, email, email_verified, login, name, avatar_url, created_at, last_used_at FROM identities WHERE account_id = $1 ORDER BY created_at', [accountId]); }

  async event(accountId, action, detail = {}) {
    await this.db.run('INSERT INTO events (account_id, action, detail) VALUES ($1, $2, $3)', [accountId, action, detail]);
  }

  /**
   * Someone came back from GitHub, Google or an email link. Find their account, or link this way in to the
   * account with the same verified email, or start a new account.
   * linkTo: the signed-in account asking to add this way in (Profile, Link GitHub).
   */
  async fromIdentity(i, { linkTo = null } = {}) {
    const email = i.email ? String(i.email).toLowerCase() : null;
    const verified = !!(email && i.emailVerified);
    return this.db.tx(async (t) => {
      const known = await t.get('SELECT * FROM identities WHERE provider = $1 AND subject = $2', [i.provider, String(i.subject)]);
      if (known) {
        if (linkTo && known.account_id !== linkTo) return { error: 'identity_taken' };
        await t.run('UPDATE identities SET email = $2, email_verified = $3, login = $4, name = COALESCE($5, name), avatar_url = COALESCE($6, avatar_url), last_used_at = now() WHERE id = $1', [known.id, email, verified, i.login ?? null, i.name ?? null, i.avatar ?? null]);
        await t.run('UPDATE accounts SET last_seen_at = now(), avatar_url = COALESCE(avatar_url, $2) WHERE id = $1', [known.account_id, i.avatar ?? null]);
        return { account: await t.get('SELECT * FROM accounts WHERE id = $1', [known.account_id]), created: false, linked: false };
      }
      let accountId = linkTo;
      if (!accountId && verified) {
        const byEmail = (await t.get('SELECT id FROM accounts WHERE lower(email) = $1', [email]))
          ?? (await t.get('SELECT account_id AS id FROM identities WHERE lower(email) = $1 AND email_verified ORDER BY created_at LIMIT 1', [email]));
        accountId = byEmail?.id ?? null;
      }
      let created = false;
      if (!accountId) {
        accountId = id('acc');
        const name = i.name || i.login || (email ? email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'New person');
        // Only a verified address becomes the account's email, and only if no other account holds it.
        const free = verified && !(await t.get('SELECT 1 FROM accounts WHERE lower(email) = $1', [email]));
        await t.run('INSERT INTO accounts (id, name, email, avatar_url, last_seen_at) VALUES ($1, $2, $3, $4, now())', [accountId, name, free ? email : null, i.avatar ?? null]);
        created = true;
      } else {
        await t.run('UPDATE accounts SET last_seen_at = now(), avatar_url = COALESCE(avatar_url, $2) WHERE id = $1', [accountId, i.avatar ?? null]);
        if (verified && !(await t.get('SELECT 1 FROM accounts WHERE lower(email) = $1', [email]))) await t.run('UPDATE accounts SET email = COALESCE(email, $2) WHERE id = $1', [accountId, email]);
      }
      await t.run('INSERT INTO identities (id, account_id, provider, subject, email, email_verified, login, name, avatar_url, last_used_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())', [id('idn'), accountId, i.provider, String(i.subject), email, verified, i.login ?? null, i.name ?? null, i.avatar ?? null]);
      await t.run('INSERT INTO events (account_id, action, detail) VALUES ($1, $2, $3)', [accountId, created ? 'account.created' : 'identity.linked', { provider: i.provider, login: i.login ?? null, email }]);
      return { account: await t.get('SELECT * FROM accounts WHERE id = $1', [accountId]), created, linked: !created };
    });
  }

  async unlink(accountId, identityId) {
    const all = await this.identities(accountId);
    if (!all.some((x) => x.id === identityId)) return { error: 'not_found' };
    if (all.length < 2) return { error: 'last_identity' };
    const gone = all.find((x) => x.id === identityId);
    await this.db.run('DELETE FROM identities WHERE id = $1 AND account_id = $2', [identityId, accountId]);
    await this.event(accountId, 'identity.unlinked', { provider: gone.provider, login: gone.login, email: gone.email });
    return { ok: true };
  }

  // ---------- sessions and tokens ----------

  async createSession(accountId, { kind, parentId = null, clientId = null, label = null, scopes = '', method = null, userAgent = null, ttl = 30 * DAY }) {
    const sid = id('ses');
    await this.db.run('INSERT INTO sessions (id, account_id, kind, parent_id, client_id, label, scopes, method, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [sid, accountId, kind, parentId, clientId, label, scopes, method, userAgent ? String(userAgent).slice(0, 300) : null, later(ttl)]);
    return sid;
  }

  async issueToken(sessionId, kind, ttl) {
    const raw = secret({ browser: 'wab', access: 'wat', refresh: 'wrt' }[kind] ?? 'wax');
    await this.db.run('INSERT INTO tokens (hash, session_id, kind, expires_at) VALUES ($1, $2, $3, $4)', [sha256(raw), sessionId, kind, later(ttl)]);
    return raw;
  }

  // A live session: not revoked, not expired, and its parent (for app sessions) still live.
  static LIVE = `s.revoked_at IS NULL AND s.expires_at > now() AND (s.parent_id IS NULL OR EXISTS (SELECT 1 FROM sessions p WHERE p.id = s.parent_id AND p.revoked_at IS NULL AND p.expires_at > now()))`;

  async byToken(raw, kind) {
    if (!raw) return null;
    const row = await this.db.get(`SELECT s.*, t.kind AS token_kind, t.used_at AS token_used_at, t.hash AS token_hash FROM tokens t JOIN sessions s ON s.id = t.session_id WHERE t.hash = $1 AND t.kind = $2 AND t.expires_at > now() AND ${Store.LIVE}`, [sha256(raw), kind]);
    if (row) this.db.run('UPDATE sessions SET last_used_at = now() WHERE id = $1 AND last_used_at < now() - interval \'5 minutes\'', [row.id]).catch(() => {});
    return row;
  }

  async live(sessionId) {
    return this.db.get(`SELECT s.* FROM sessions s WHERE s.id = $1 AND ${Store.LIVE}`, [sessionId]);
  }

  async revokeSession(accountId, sessionId) {
    const n = await this.db.run('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND (id = $2 OR parent_id = $2) AND revoked_at IS NULL', [accountId, sessionId]);
    if (n) await this.event(accountId, 'session.revoked', { session: sessionId });
    return n;
  }

  async revokeAll(accountId) {
    const n = await this.db.run('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [accountId]);
    await this.event(accountId, 'sessions.revoked_all', { count: n });
    return n;
  }

  async sessions(accountId) {
    return this.db.query(`SELECT s.id, s.kind, s.label, s.client_id, c.name AS client_name, s.method, s.user_agent, s.created_at, s.last_used_at, s.expires_at, s.parent_id
      FROM sessions s LEFT JOIN clients c ON c.id = s.client_id WHERE s.account_id = $1 AND ${Store.LIVE} ORDER BY s.last_used_at DESC`, [accountId]);
  }

  // ---------- one-time codes and links ----------

  async putOnce(raw, kind, data, ttl) {
    await this.db.run('INSERT INTO one_time (hash, kind, data, expires_at) VALUES ($1, $2, $3, $4)', [sha256(raw), kind, data, later(ttl)]);
  }
  // Used once. A second use reports reused, so a replayed authorization code can revoke what it made.
  async takeOnceStrict(raw, kind) {
    return this.db.tx(async (t) => {
      const row = await t.get('SELECT * FROM one_time WHERE hash = $1 AND kind = $2 FOR UPDATE', [sha256(raw), kind]);
      if (!row) return { missing: true };
      if (row.used_at) return { reused: true, data: row.data };
      if (new Date(row.expires_at) < new Date()) return { expired: true };
      await t.run('UPDATE one_time SET used_at = now() WHERE hash = $1', [sha256(raw)]);
      return { data: row.data };
    });
  }

  // ---------- clients ----------

  client(clientId) { return clientId ? this.db.get('SELECT * FROM clients WHERE id = $1', [String(clientId)]) : null; }

  // ---------- profile ----------

  async setUpdates(accountId, on) {
    await this.db.run('UPDATE accounts SET updates_opt_in = $2, updated_at = now() WHERE id = $1', [accountId, !!on]);
    await this.event(accountId, on ? 'updates.on' : 'updates.off');
  }
  async rename(accountId, name) {
    const n = String(name ?? '').trim().slice(0, 80);
    if (!n) return false;
    await this.db.run('UPDATE accounts SET name = $2, updated_at = now() WHERE id = $1', [accountId, n]);
    return true;
  }

  async export(accountId) {
    const a = await this.account(accountId);
    if (!a) return null;
    return {
      exported_at: new Date().toISOString(),
      account: { id: a.id, name: a.name, email: a.email, avatar_url: a.avatar_url, updates_opt_in: a.updates_opt_in, created_at: a.created_at, last_seen_at: a.last_seen_at },
      identities: await this.identities(accountId),
      sessions: await this.sessions(accountId),
      events: await this.db.query('SELECT action, detail, at FROM events WHERE account_id = $1 ORDER BY at', [accountId]),
      limits: await this.db.query('SELECT bucket, window_start, hits FROM limits WHERE account_id = $1 ORDER BY window_start DESC LIMIT 500', [accountId]),
      note: 'This is everything warOnSaaS Account keeps about you. Each app (board, CRM, chat and the rest) exports its own data from its own settings.',
    };
  }

  async remove(accountId) {
    await this.db.tx(async (t) => {
      await t.run('DELETE FROM limits WHERE account_id = $1', [accountId]);
      await t.run('DELETE FROM accounts WHERE id = $1', [accountId]);
    });
  }
}
