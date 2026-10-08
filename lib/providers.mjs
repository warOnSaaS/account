// The ways in: GitHub (the "warOnSaaS Account" GitHub App, sign-in only), Google (switched on by
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET), and an email link (lib/server routes). Each returns the same shape:
// { provider, subject, email, emailVerified, verifiedEmails, login, name, avatar }.

const GH_WEB = () => process.env.GITHUB_WEB_BASE || 'https://github.com';
const GH_API = () => process.env.GITHUB_API_BASE || 'https://api.github.com';
const G_AUTH = () => process.env.GOOGLE_AUTH_BASE || 'https://accounts.google.com/o/oauth2/v2/auth';
const G_TOKEN = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const G_INFO = () => process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';

const ghId = (env) => env.GITHUB_APP_CLIENT_ID || env.GITHUB_OAUTH_CLIENT_ID || '';
const ghSecret = (env) => env.GITHUB_APP_CLIENT_SECRET || env.GITHUB_OAUTH_CLIENT_SECRET || '';

export const enabled = (env = process.env) => ({
  github: !!(ghId(env) && ghSecret(env)),
  google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  email: true,
});

export const github = {
  authorizeUrl(env, { redirectUri, state }) {
    const u = new URL(`${GH_WEB()}/login/oauth/authorize`);
    u.searchParams.set('client_id', ghId(env));
    u.searchParams.set('redirect_uri', redirectUri);
    // A GitHub App ignores scope (its permissions decide); an OAuth app needs these two.
    u.searchParams.set('scope', 'read:user user:email');
    u.searchParams.set('state', state);
    u.searchParams.set('allow_signup', 'true');
    return u.toString();
  },
  async identity(env, { code, redirectUri }) {
    const tok = await fetch(`${GH_WEB()}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: ghId(env), client_secret: ghSecret(env), code, redirect_uri: redirectUri }),
    }).then((r) => r.json()).catch(() => ({}));
    if (!tok.access_token) return null;
    const gh = (p) => fetch(`${GH_API()}${p}`, { headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'warOnSaaS-account' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [user, emails] = await Promise.all([gh('/user'), gh('/user/emails')]);
    if (!user?.id) return null;
    const verified = (emails ?? []).filter((e) => e.verified).sort((a, b) => Number(b.primary) - Number(a.primary)).map((e) => String(e.email).toLowerCase());
    // GitHub's no-reply addresses are not a way to reach anyone; skip them as the account email.
    const real = verified.filter((e) => !e.endsWith('@users.noreply.github.com'));
    return { provider: 'github', subject: String(user.id), email: real[0] ?? null, emailVerified: !!real[0], verifiedEmails: real, login: user.login, name: user.name || user.login, avatar: user.avatar_url ?? null };
  },
};

export const google = {
  authorizeUrl(env, { redirectUri, state, nonce }) {
    const u = new URL(G_AUTH());
    u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', state);
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('prompt', 'select_account');
    return u.toString();
  },
  // The code is traded straight with Google over TLS, so the userinfo answer is trusted as is.
  async identity(env, { code, redirectUri }) {
    const tok = await fetch(G_TOKEN(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    }).then((r) => r.json()).catch(() => ({}));
    if (!tok.access_token) return null;
    const info = await fetch(G_INFO(), { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!info?.sub) return null;
    const email = info.email ? String(info.email).toLowerCase() : null;
    const verified = !!(email && info.email_verified);
    return { provider: 'google', subject: String(info.sub), email, emailVerified: verified, verifiedEmails: verified ? [email] : [], login: null, name: info.name || (email ? email.split('@')[0] : null), avatar: info.picture ?? null };
  },
};
