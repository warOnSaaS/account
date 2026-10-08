# Signing in with a warOnSaaS account: how an app plugs in

For every hosted warOnSaaS app (board, CRM, chat, email, meetings, scanner, suite, decks, sheets). Live at **https://account.waronsaas.com**.

## The rule: look freely, sign in to use

| Anyone, signed out | Needs a free account |
|---|---|
| Every page, demo, doc, shared report, shared deck or sheet, recording link. Guests join a meeting by link. | Any action that creates, changes, sends, runs or costs: save, post, scan, create a deck, join as a member, connect an AI app. |

Never put a wall in front of a page. Show the prompt **at the moment of action** (the `prompt.js` script below does this for you). An API or MCP call without a session answers `401 { "error": { "code": "sign_in", "message": "Sign in to your warOnSaaS account" } }`.

## Endpoints

| What | Where |
|---|---|
| Discovery | `https://account.waronsaas.com/.well-known/openid-configuration` (also `/.well-known/oauth-authorization-server`) |
| Authorize | `GET /oauth/authorize` (code flow, PKCE S256 required) |
| Token | `POST /oauth/token` (`authorization_code`, `refresh_token`; refresh tokens rotate, a reused one ends the session) |
| User info | `GET /oauth/userinfo` with `Bearer <access_token>` |
| Keys | `GET /jwks.json` (RS256) |
| Register (AI apps) | `POST /oauth/register` (RFC 7591, public clients, PKCE) |
| Revoke | `POST /oauth/revoke` |
| Sign out | `GET /oauth/end-session?client_id=..&post_logout_redirect_uri=..` |
| Session still live? | `POST /api/sessions/check` with client credentials, body `{ "sid": "ses_..." }` or a list |
| Rate limit | `POST /api/limits/hit` with client credentials (below) |
| Brand kit | `GET /api/teams/<slug>/brand` (JSON, public) and `GET /brand/<slug>.css` (public) |
| Data home | `GET /api/teams/<slug>/data-home` with client credentials (first-party apps only; includes the database address for "my own database") |
| Account tools | `POST /api/tools/<name>` and MCP at `/mcp` (account and team tools) |

Scopes: `openid profile email` always; add `teams` to get the person's teams and roles in the ID token; `offline_access` makes a long-lived **connection** (what an AI app gets) instead of a session tied to the browser.

ID token claims: `sub` (account id, stable, use it as the person key), `sid` (this sign-in's session), `name`, `email`, `email_verified`, `picture`, `github_login` (when GitHub is linked), `teams` (`[{ id, slug, name, role }]` with scope `teams`), `auth_time`, `amr`, `nonce`.

## 1. Get a client

Every app above already has one. Its id and secret are in `~/.waronsaas/account-clients/<app>.env` (mode 600) as `WOS_ACCOUNT_CLIENT_ID` and `WOS_ACCOUNT_CLIENT_SECRET`. Pipe them into your Vercel project; never print them:

```sh
set -a; . ~/.waronsaas/account-clients/decks.env; set +a
printf '%s' "$WOS_ACCOUNT_CLIENT_ID"     | vercel env add WOS_ACCOUNT_CLIENT_ID production --scope battle-juice
printf '%s' "$WOS_ACCOUNT_CLIENT_SECRET" | vercel env add WOS_ACCOUNT_CLIENT_SECRET production --scope battle-juice
```

Registered redirect URIs: `https://<app host>/auth/waronsaas/callback`, plus `http://localhost:<any port>/auth/waronsaas/callback` for development. The hosts: suite `app.`, board `kanban.`, crm `crm.`, chat `chat.`, email `mail.`, meet `meet.`, scanner `scanner.`, decks `decks.`, sheets `sheets.waronsaas.com`. Need another URI? Ask the Accounts lane, or run `npm run add-client` in `~/wos-account` (it keeps the secret unless you pass `--rotate`).

First-party clients never see a consent screen. AI apps do, once.

## 2. Server: two routes

Copy `client/account-client.mjs` from [warOnSaaS/account](https://github.com/warOnSaaS/account) into your app (no dependencies).

```js
import { WosAccount, authProvider } from './lib/account-client.mjs';
const account = WosAccount.fromEnv(process.env, { redirectUri: `${PUBLIC_URL}/auth/waronsaas/callback`, secret: process.env.SESSION_SECRET });

// GET /auth/waronsaas?next=/deals[&prompt=none][&provider=github|google]
const { location, cookie } = account.start({ next, prompt, provider });
res.writeHead(302, { location, 'set-cookie': cookie }).end();

// GET /auth/waronsaas/callback
const r = await account.finish(req);
if (r.error) {
  // login_required after a silent try, or the person cancelled: back to the page, still signed out, still open.
  return res.writeHead(302, { location: r.next, 'set-cookie': r.clear }).end();
}
// r.profile: { sub, sid, email, name, picture, github_login, teams }. Find or create your person by r.profile.sub
// (match existing people by verified email or github_login once, then store sub), set your own session cookie
// carrying sub and sid, and go to r.next.
```

Keep your own session cookie (you already have one). Put `sid` in it and call `account.isLive(sid)` when you read the session (cached a minute) so **Sign out everywhere** reaches your app.

Your **Sign out** button: clear your cookie, then redirect to `account.endSessionUrl(PUBLIC_URL)` to sign out of the account too.

## 3. Screen: one script

```html
<script src="https://account.waronsaas.com/prompt.js" defer
        data-signed-in="${signedIn}" data-app="Decks" data-signin="/auth/waronsaas"></script>
```

| While signed out it | |
|---|---|
| Lets every page, link and read-only view work. | |
| Catches presses on anything with `data-tool` (not `none`), `data-needs-account`, POST forms and drags, and shows "Sign in to <action>" with GitHub, Google and email. | Mark something that must work signed out with `data-public`. |
| Signs in silently, once per tab, when the browser is already signed in to warOnSaaS (the `wos_signed_in` hint cookie on `.waronsaas.com`), so moving between apps takes no clicks. | Turn off with `data-silent="false"`. |
| Exposes `window.wosAccount.prompt('Save this deck')` for your own code, for example when a call answers 401. | |

**Cookie domain.** The account session cookie lives only on `account.waronsaas.com`. Apps never read it. The only shared cookie is `wos_signed_in=1` on `.waronsaas.com`, which holds no secret; it only says "worth trying a silent sign-in". Each app keeps its own HttpOnly session cookie on its own host.

## 4. MCP and AI apps

Keep your `/mcp` with its own OAuth (discovery, registration, PKCE) as the board and CRM do. Change one step: where you used to send the person to GitHub, send them to the account instead, as a **connection**:

```js
const { location, cookie } = account.start({ carry: mcpRequest, connection: `${clientName} via CRM` });
// ...callback: r.carry is your MCP request; issue your code to the AI app as before, for person r.profile.sub.
```

The account shows "Claude Code via CRM" under *AI apps acting as you* and can sign it out. Put the account `sid` in the tokens you issue and check `isLive` on use.

## 5. Per-account limits

```js
const r = await account.limit(person.sub, 'scanner.scan', 20, 3600);   // 20 an hour
if (!r.ok) return { error: { code: 'limit', message: `That is 20 scans this hour. More at ${r.reset_at}.` } };
```

Bucket names are `app.thing`. The count is shared by every copy of every app. If the account server cannot be reached, the call answers `{ ok: true, unchecked: true }`, so a hiccup never blocks people.

## 6. Brand kit

A team's look: `logo_light`, `logo_dark`, `accent`, `on_accent`, `scheme`, `mode`, `type`, `shape`, `font`, `display`, `fonts_href`, `custom_domain`. Tools: `team.get_brand`, `team.set_brand` (wire names `team_get_brand`, `team_set_brand`).

Apply it on ui-design v2: put `scheme`, `mode`, `type` and `shape` on `<html data-scheme data-mode data-type data-shape>`, link `https://account.waronsaas.com/brand/<slug>.css` after `tokens.css` (it sets `--ui-accent`, `--ui-on-accent`, `--ui-font`, `--ui-display` and imports the fonts), and show `logo_dark` or `logo_light` by mode. `account.brand(slug)` gives the JSON, cached a minute.

## 7. Data home

| Kind | Where rows live | What the app does |
|---|---|---|
| `cloud` (default) | Our Postgres, every row has `team_id` | Nothing new. |
| `postgres` | The team's own `DATABASE_URL`, stored encrypted | `account.dataHome(slug)` returns `database_url`; open a pool per team and run your migrations there. |
| `github` | A repo in the team's **own** account or organization, through the GitHub App installed there | `dataHome` returns `repo` and `installation_id`; use the installation token as the board does. We never create organizations or keep repos in ours. |

Tools: `team.get_data_home`, `team.set_data_home`, `team.move_data_home` (plans the per-app copy; `confirm: human`), `team.export` (team data plus each app's `export_tool` and link). **Each app should ship an `<app>.export` tool** returning everything for a team: the account's export points at it.

## 8. Self-hosted installs

`AUTH_PROVIDER=waronsaas|github|local`. Hosted copies use `waronsaas`. A self-hoster keeps GitHub or local sign-in and needs nothing from us; `authProvider(env)` in the client library reads it (default: `waronsaas` when `WOS_ACCOUNT_CLIENT_ID` is set, else `github`). Someone who runs warOnSaaS Account themselves points `WOS_ACCOUNT_URL` at it.

## 9. Account and team tools

`account.me`, `account.update_profile`, `account.list_sessions`, `account.end_session`, `account.sign_out_everywhere`, `account.unlink_identity`, `account.export`, `account.delete` (human), `account.list_approvals`, `account.answer_approval` (screen only), `team.list`, `team.create`, `team.get`, `team.update`, `team.invite`, `team.revoke_invite`, `team.set_role`, `team.remove_member`, `team.leave`, `team.delete` (human), `team.get_brand`, `team.set_brand`, `team.get_data_home`, `team.set_data_home`, `team.move_data_home` (human), `team.export`. Catalogues: `tools.json` and `team.tools.json` in the repo.

## 10. Hearing sign-outs and deletions at once (optional, recommended)

When someone presses **Sign out everywhere** or deletes their account, the account POSTs to `https://<app host>/auth/waronsaas/backchannel` with a form field `logout_token` (an OpenID Connect back-channel logout token). Verify it with `await account.verifyLogoutToken(token)`: it returns `{ sub, deleted }` or `null`. End every session of that `sub`; when `deleted` is true, remove or anonymise the person by your app's rules. Always answer 200. Without this route, `isLive(sid)` still catches the sign-out within a minute.
