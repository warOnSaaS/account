# warOnSaaS Account

One free account for every warOnSaaS app: the board, CRM, chat, email, meetings, the scanner and the suite.

**Look freely, sign in to use.** Every page, demo, doc and shared link stays open to anyone. Doing something (saving, scanning, posting, joining as a member) asks for a free account, at that moment, never as a wall on arrival.

Sign in with **GitHub**, **Google** or an **email link**. No passwords. Claude, ChatGPT, Codex and Claude Code connect afterwards, as MCP connectors that sign in here and act as you.

| Use ours | Host it yourself, free |
|---|---|
| [account.waronsaas.com](https://account.waronsaas.com). Nothing to set up. | `docker compose up`, or `npm start` with any Postgres in `DATABASE_URL`. Same code, AGPL-3.0. |

## What it does

| | |
|---|---|
| Sign in | GitHub, Google, email link. Ways in are linked by verified email, so one person is one account. |
| Your apps sign in here | An OpenID Connect provider: authorization code with PKCE, refresh tokens that rotate, dynamic client registration for AI apps. |
| Signed in everywhere at once | Sign in once and every `*.waronsaas.com` app signs you in silently. |
| Sessions | See every browser, app and AI connection; sign out one or all of them. |
| Teams | Members and roles, invites by email, a **brand kit** (logos for light and dark, accent, fonts, scheme, your own domain) and a **data home** (warOnSaaS Cloud, your own Postgres, or a repo in your own GitHub). |
| Fair use | A per-account rate limit every app shares. |
| Yours | Export everything as JSON; delete your account any time. Update emails only if you say yes. |
| Agents too | Every action on the account page is also a tool: `/mcp` for AI apps, `POST /api/tools/<name>` for programs. Deleting asks for your yes first. |

## For app builders

Read [docs/INTEGRATION.md](docs/INTEGRATION.md). In short:

```js
import { WosAccount } from '@waronsaas/account/client';      // or copy client/account-client.mjs
const account = WosAccount.fromEnv(process.env, { redirectUri: 'https://crm.example/auth/waronsaas/callback' });
```

```html
<script src="https://account.waronsaas.com/prompt.js" data-signed-in="false" data-app="CRM" defer></script>
```

## Run it

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Any Postgres. Tables are made on start. |
| `PUBLIC_URL` | Where it is reached, like `https://account.example.com`. |
| `ACCOUNT_SECRET` | 32+ random characters. Seals the signing key and data-home passwords. Keep it. |
| `COOKIE_DOMAIN` | Optional, like `.example.com`, so apps on sibling subdomains sign in silently. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email links. Without them, links are written to the server log. |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | GitHub sign-in (a GitHub App or OAuth app). `npm run github-app` makes one. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. Steps in [docs/GOOGLE.md](docs/GOOGLE.md). |

```sh
npm install
DATABASE_URL=postgres://... PUBLIC_URL=http://localhost:3990 npm start
npm run add-client -- --id crm --name CRM --redirect https://crm.example/auth/waronsaas/callback --secret-file crm.env
TEST_DATABASE_URL=postgres://.../throwaway npm test
```

## License

AGPL-3.0. The bundled ui-design kit is Apache 2.0 and its fonts are under the SIL Open Font License; see `public/ui/`.
