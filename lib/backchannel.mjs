import crypto from 'node:crypto';
import { signJwt } from './keys.mjs';

// OpenID Connect back-channel logout: when someone signs out everywhere or deletes their account, every one of
// our apps hears it at once, without waiting for its next liveness check. Each first-party client with a
// home_url gets a POST to <home_url>/auth/waronsaas/backchannel with a signed logout_token (form field).
// Apps verify it with WosAccount.verifyLogoutToken(). Fire and forget: an app that is down catches up through
// isLive() within a minute anyway.
export const LOGOUT = 'http://schemas.openid.net/event/backchannel-logout';
export const DELETED = 'https://waronsaas.com/events/account-deleted';

export async function tellApps(db, issuer, { sub, deleted = false }) {
  const clients = await db.query("SELECT id, home_url FROM clients WHERE first_party AND home_url IS NOT NULL");
  await Promise.allSettled(clients.map(async (c) => {
    const token = await signJwt(db, { iss: issuer, aud: c.id, sub, jti: crypto.randomUUID(), events: { [LOGOUT]: {}, ...(deleted ? { [DELETED]: {} } : {}) } }, 120);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    try {
      await fetch(`${c.home_url.replace(/\/$/, '')}/auth/waronsaas/backchannel`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ logout_token: token }), signal: ctl.signal });
    } finally {
      clearTimeout(t);
    }
  }));
}
