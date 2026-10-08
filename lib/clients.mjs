import { secret, sha256 } from './util.mjs';
import { okRedirect } from './oidc.mjs';

/**
 * Adds or updates one of our own apps as a first-party client: no consent screen, a client secret, exact
 * redirect URIs. Returns the secret only when it is new (rotate: true makes a new one).
 */
export async function upsertClient(db, { id, name, redirectUris, app = null, home = null, rotate = false }) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new Error('client id: lower case letters, digits and dashes');
  const uris = [...new Set(redirectUris)];
  if (!uris.length || !uris.every(okRedirect)) throw new Error('every redirect URI must be https, or http on localhost');
  const had = await db.get('SELECT id, secret_hash FROM clients WHERE id = $1', [id]);
  let raw = null;
  if (!had || rotate || !had.secret_hash) raw = secret('wcs');
  if (had) {
    await db.run('UPDATE clients SET name = $2, redirect_uris = $3, first_party = TRUE, kind = $4, app = $5, home_url = $6' + (raw ? ', secret_hash = $7' : '') + ' WHERE id = $1', [id, name, JSON.stringify(uris), 'first_party', app, home, ...(raw ? [sha256(raw)] : [])]);
  } else {
    await db.run('INSERT INTO clients (id, name, secret_hash, redirect_uris, first_party, kind, app, home_url) VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7)', [id, name, sha256(raw), JSON.stringify(uris), 'first_party', app, home]);
  }
  return { id, secret: raw };
}
