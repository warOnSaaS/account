import crypto from 'node:crypto';
import { seal, unseal, nowSec } from './util.mjs';

// The RS256 key that signs ID tokens. Made on first start and sealed in the database, so a self-hoster
// sets nothing. Apps check tokens against /jwks.json.
let cached = null;

export async function signingKey(db) {
  if (cached) return cached;
  let row = await db.get('SELECT * FROM signing_keys WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1');
  if (!row) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = crypto.randomBytes(8).toString('hex');
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
    await db.run('INSERT INTO signing_keys (kid, sealed, public_jwk) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [kid, seal(privateKey.export({ format: 'pem', type: 'pkcs8' }), 'jwk'), jwk]);
    row = await db.get('SELECT * FROM signing_keys WHERE retired_at IS NULL ORDER BY created_at ASC LIMIT 1');
  }
  cached = { kid: row.kid, key: crypto.createPrivateKey(unseal(row.sealed, 'jwk')) };
  return cached;
}

export async function jwks(db) {
  await signingKey(db);
  const rows = await db.query("SELECT public_jwk FROM signing_keys WHERE retired_at IS NULL OR retired_at > now() - interval '30 days'");
  return { keys: rows.map((r) => r.public_jwk) };
}

export async function signJwt(db, claims, seconds) {
  const { kid, key } = await signingKey(db);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = nowSec();
  const head = enc({ alg: 'RS256', typ: 'JWT', kid });
  const body = enc({ iat, exp: iat + seconds, ...claims });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export const _reset = () => { cached = null; };
