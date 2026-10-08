import { esc } from './util.mjs';
import { SCHEMES, TYPES, SHAPES, brandCss } from './teams.mjs';
import { APPS } from './apps.mjs';
import { browserName } from './tools.mjs';

// Every screen, server-rendered on ui-design v2 (scheme midnight). Buttons and forms name the tool they call
// (data-tool); public/app.js sends them to /api/tools/<name>. Links that only move around carry data-tool="none".

export const TAGLINE = 'Free. We ask so we can keep it fast and fair, and so your AI can act as you.';
const REPO = 'https://github.com/warOnSaaS/account';

// The pixel tank from ui-design, in one colour, so it sits quietly on the midnight scheme.
export const MARK = `<svg class="ac-mark" viewBox="0 0 16 13" width="22" height="18" shape-rendering="crispEdges" aria-hidden="true"><g fill="currentColor"><rect x="3" y="0" width="1" height="5" opacity=".55"/><rect x="4" y="0" width="3" height="2"/><rect x="4" y="2" width="2" height="1"/><rect x="5" y="4" width="4" height="3"/><rect x="10" y="5" width="6" height="1" opacity=".55"/><rect x="0" y="7" width="15" height="4"/><rect x="1" y="11" width="13" height="2" opacity=".55"/></g></svg>`;

const ICON = {
  github: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
  google: '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 009 18z"/><path fill="#FBBC05" d="M3.96 10.72A5.4 5.4 0 013.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.05l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
};

export function layout({ title, body, scripts = false, bodyClass = '', brand = null }) {
  return `<!doctype html><html lang="en" data-scheme="midnight" data-mode="dark" data-shape="soft" data-type="grotesk" data-surface="elevated" data-motion="subtle"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · warOnSaaS</title><meta name="robots" content="noindex"><meta name="color-scheme" content="dark light">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/ui/fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/ui/src/ui.css"><link rel="stylesheet" href="/ui/src/tokens.css"><link rel="stylesheet" href="/account.css">
${brand ? `<style>${brandCss(brand)}</style>` : ''}${scripts ? '<script src="/app.js" defer></script>' : ''}</head>
<body class="${bodyClass}">${body}</body></html>`;
}

// ---------- sign-in ----------

export function signInPage({ next = '/', note = '', providers, app = null, email = '', mode = 'sign-in' }) {
  const n = encodeURIComponent(next);
  const heading = app ? `Sign in to use ${esc(app)}` : 'Sign in to warOnSaaS';
  return layout({
    title: 'Sign in',
    bodyClass: 'ac-gate-page',
    body: `<main class="ac-gate-wrap">
<a class="ac-brand" href="/" data-tool="none" data-why="Goes to the account home">${MARK}<span>warOnSaaS</span></a>
<section class="ui-gate ac-gate" aria-labelledby="h">
<h1 id="h">${heading}</h1>
<p class="ac-tagline">${TAGLINE}</p>
${note ? `<div class="ui-notice ${/sent|check/i.test(note) ? '' : 'is-quiet'} ac-note" role="status">${note}</div>` : ''}
<div class="ac-ways">
${providers.github ? `<a class="ui-btn is-lg is-block ac-way" href="/auth/github?next=${n}" data-tool="none" data-why="Starts GitHub sign-in">${ICON.github}<span>Continue with GitHub</span></a>` : ''}
${providers.google ? `<a class="ui-btn is-quiet is-lg is-block ac-way" href="/auth/google?next=${n}" data-tool="none" data-why="Starts Google sign-in">${ICON.google}<span>Continue with Google</span></a>` : ''}
</div>
${providers.github || providers.google ? '<div class="ac-or"><span>or</span></div>' : ''}
<form class="ac-email" method="post" action="/auth/email" data-tool="none" data-why="Sends a sign-in link; signing in is not a tool">
<label class="ui-field"><span>Email</span><input class="ui-input" type="email" name="email" required autocomplete="email" inputmode="email" placeholder="you@company.example" value="${esc(email)}"></label>
<input type="hidden" name="next" value="${esc(next)}">
<button class="ui-btn is-accent is-lg is-block" type="submit">${ICON.mail}<span>Email me a sign-in link</span></button>
</form>
<p class="ui-hint ac-fine">No password. New here? The same buttons make your free account.</p>
</section>
<p class="ac-foot">Every page, demo and shared link stays open without an account. <a href="${REPO}" data-tool="none" data-why="Opens the source code">Host it yourself, free</a>.</p>
</main>`,
  });
}

export function checkEmailPage({ email, next, dev = null }) {
  return layout({
    title: 'Check your email',
    bodyClass: 'ac-gate-page',
    body: `<main class="ac-gate-wrap"><a class="ac-brand" href="/" data-tool="none" data-why="Goes to the account home">${MARK}<span>warOnSaaS</span></a>
<section class="ui-gate ac-gate"><div class="ac-big-icon">${ICON.mail}</div><h1>Check your email</h1>
<p class="ac-tagline">We sent a sign-in link to <b>${esc(email)}</b>. Open it on this device. It works for 15 minutes.</p>
${dev ? `<div class="ui-notice is-quiet">Development server: <a href="${esc(dev)}" data-tool="none" data-why="Opens the emailed link">open the link</a>.</div>` : ''}
<a class="ui-btn is-quiet is-block" href="/sign-in?next=${encodeURIComponent(next)}" data-tool="none" data-why="Back to the sign-in choices">Use another way</a>
<p class="ui-hint ac-fine">Nothing there? Check spam, or ask again in a minute.</p></section></main>`,
  });
}

export function confirmLinkPage({ email, token }) {
  return layout({
    title: 'Sign in',
    bodyClass: 'ac-gate-page',
    body: `<main class="ac-gate-wrap"><a class="ac-brand" href="/" data-tool="none" data-why="Goes to the account home">${MARK}<span>warOnSaaS</span></a>
<section class="ui-gate ac-gate"><h1>Sign in as ${esc(email)}</h1><p class="ac-tagline">One press and you are in.</p>
<form method="post" action="/auth/email/verify" data-tool="none" data-why="Finishes the email sign-in"><input type="hidden" name="t" value="${esc(token)}"><button class="ui-btn is-accent is-lg is-block" type="submit">Continue</button></form></section></main>`,
  });
}

export function consentPage({ client, account, request, scope }) {
  const can = [
    'Know your name and email',
    /\baccount\b|\bteams\b/.test(scope) || !client.first_party ? 'Read and change your warOnSaaS account and teams, as you' : null,
    /\boffline_access\b/.test(scope) || !client.first_party ? 'Stay connected until you sign it out on this page' : null,
  ].filter(Boolean);
  return layout({
    title: 'Allow access',
    bodyClass: 'ac-gate-page',
    body: `<main class="ac-gate-wrap"><a class="ac-brand" href="/" data-tool="none" data-why="Goes to the account home">${MARK}<span>warOnSaaS</span></a>
<section class="ui-gate ac-gate ac-consent"><h1>${esc(request.connection || client.name)} wants to act as you</h1>
<p class="ac-tagline">Signed in as <b>${esc(account.email || account.name)}</b>.</p>
<ul class="ac-can">${can.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
<p class="ui-hint">Anything that deletes or pays still waits for your yes here. You can sign it out any time under Where you are signed in.</p>
<form method="post" action="/oauth/consent" data-tool="none" data-why="Answers the sign-in request"><input type="hidden" name="r" value="${esc(request.r)}">
<button class="ui-btn is-accent is-lg is-block" name="answer" value="allow" type="submit">Allow</button>
<button class="ui-btn is-ghost is-block ac-mt" name="answer" value="deny" type="submit">Cancel</button></form>
<p class="ui-hint ac-fine">Not you? <a href="/sign-out?next=${encodeURIComponent(request.back)}" data-tool="none" data-why="Signs out of this browser">Use another account</a></p></section></main>`,
  });
}

export function messagePage({ title, text, link = null }) {
  return layout({
    title,
    bodyClass: 'ac-gate-page',
    body: `<main class="ac-gate-wrap"><a class="ac-brand" href="/" data-tool="none" data-why="Goes to the account home">${MARK}<span>warOnSaaS</span></a>
<section class="ui-gate ac-gate"><h1>${esc(title)}</h1><p class="ac-tagline">${text}</p>${link ? `<a class="ui-btn is-quiet is-block" href="${esc(link.href)}" data-tool="none" data-why="Navigation">${esc(link.label)}</a>` : ''}</section></main>`,
  });
}

// ---------- account home ----------

const when = (d) => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const initials = (n) => String(n ?? '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
const avatar = (a, cls = '') => (a.avatar_url ? `<img class="ui-avatar ${cls}" src="${esc(a.avatar_url)}" alt="">` : `<span class="ui-avatar ${cls}" aria-hidden="true">${esc(initials(a.name))}</span>`);
const input = (o) => esc(JSON.stringify(o));
const PROVIDER = { github: 'GitHub', google: 'Google', email: 'Email link' };

export function homePage({ me, sessions, approvals, team, teams, providers, flash = '' }) {
  const browsers = sessions.filter((s) => s.kind === 'browser');
  const apps = sessions.filter((s) => s.kind === 'app');
  const conns = sessions.filter((s) => s.kind === 'connection');
  const admin = ['owner', 'admin'].includes(team.your_role);
  const brand = team.brand ?? {};
  const home = team.data_home ?? { kind: 'cloud' };
  const has = (p) => me.identities.some((i) => i.provider === p);

  const nav = [['profile', 'Profile'], ['signins', 'Sign-ins'], ['apps', 'Apps'], ['team', 'Team'], ['brand', 'Brand kit'], ['data', 'Data home'], ['danger', 'Export and delete']];

  const sessionRow = (s, extra = '') => `<li class="ac-row"><div class="ac-row-main"><b>${esc(s.name)}${s.current ? '<span class="ui-chip is-good is-soft">This browser</span>' : ''}${extra}</b><small>${s.kind === 'browser' ? `Signed in with ${esc(PROVIDER[s.method] ?? s.method ?? 'a link')}` : s.kind === 'connection' ? 'Acts as you' : 'Through this browser'} · last used ${when(s.last_used_at)}</small></div>
<button class="ui-btn is-quiet is-sm" data-tool="account.end_session" data-input="${input({ session_id: s.id })}" data-then="reload"${s.current ? ' data-confirm="Sign out of this browser?"' : ''}>Sign out</button></li>`;

  const body = `<div class="ac-shell">
<header class="ac-top"><a class="ac-brand is-small" href="/" data-tool="none" data-why="Goes to the account home">${MARK}<span>warOnSaaS</span><span class="ac-sub">Account</span></a>
<div class="ac-top-r"><span class="ac-who hide-sm">${esc(me.email ?? me.name)}</span>${avatar(me, 'is-sm')}<form method="post" action="/sign-out" data-tool="none" data-why="Signs out of this browser; ending other places is account.end_session"><button class="ui-btn is-ghost is-sm" type="submit">Sign out</button></form></div></header>
<div class="ac-body">
<nav class="ac-nav" aria-label="Account">${nav.map(([id, label], i) => `<a href="#${id}" data-tool="none" data-why="Jumps to a section"${i === 0 ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>
<main class="ac-main">
${flash ? `<div class="ui-notice ac-flash" role="status">${flash}</div>` : ''}
${approvals.length ? `<section class="ac-sec ac-approvals" id="approvals"><h2>Waiting for your yes</h2>${approvals.map((a) => `<div class="ui-card ac-approval"><p><b>${esc(a.asked_by)}</b> asked to <b>${esc(a.tool === 'account.delete' ? 'delete your account' : a.tool === 'team.delete' ? `delete the team ${a.input.team}` : a.tool === 'team.move_data_home' ? 'move your team data' : a.tool)}</b> · ${when(a.created_at)}</p>
<div class="ac-actions"><button class="ui-btn is-danger is-sm" data-tool="account.answer_approval" data-input="${input({ approval_id: a.id, answer: 'yes' })}" data-then="reload" data-confirm="Let it go ahead?">Yes, go ahead</button><button class="ui-btn is-quiet is-sm" data-tool="account.answer_approval" data-input="${input({ approval_id: a.id, answer: 'no' })}" data-then="reload">No</button></div></div>`).join('')}</section>` : ''}

<section class="ac-sec" id="profile"><div class="ac-head">${avatar(me, 'is-lg')}<div><h1>${esc(me.name)}</h1><p class="ui-mute">${esc(me.email ?? 'No email yet')} · free account since ${when(me.created_at)}</p></div></div>
<form class="ui-card ac-form" data-tool="account.update_profile" data-then="toast" data-ok="Saved">
<label class="ui-field"><span>Name</span><input class="ui-input" name="name" value="${esc(me.name)}" maxlength="80" required autocomplete="name"></label>
<label class="ui-check"><input type="checkbox" name="updates_opt_in" ${me.updates_opt_in ? 'checked' : ''}><span>Email me about new apps and big changes. A few a year, never anyone else's ads.</span></label>
<div class="ac-actions"><button class="ui-btn is-accent" type="submit">Save</button></div></form></section>

<section class="ac-sec" id="signins"><h2>Ways to sign in</h2>
<ul class="ui-card ac-list">${me.identities.map((i) => `<li class="ac-row"><div class="ac-row-main"><b>${esc(PROVIDER[i.provider] ?? i.provider)}</b><small>${esc(i.login ? `@${i.login}` : '')}${i.login && i.email ? ' · ' : ''}${esc(i.email ?? '')} · last used ${when(i.last_used_at)}</small></div>
${me.identities.length > 1 ? `<button class="ui-btn is-ghost is-sm" data-tool="account.unlink_identity" data-input="${input({ identity_id: i.id })}" data-then="reload" data-confirm="Remove ${esc(PROVIDER[i.provider] ?? i.provider)} as a way to sign in?">Remove</button>` : '<span class="ui-hint">Your only way in</span>'}</li>`).join('')}</ul>
<div class="ac-actions is-left">${providers.github && !has('github') ? `<a class="ui-btn is-quiet is-sm" href="/auth/github?link=1&next=/%23signins" data-tool="none" data-why="Starts GitHub sign-in to add it">${ICON.github}Add GitHub</a>` : ''}${providers.google && !has('google') ? `<a class="ui-btn is-quiet is-sm" href="/auth/google?link=1&next=/%23signins" data-tool="none" data-why="Starts Google sign-in to add it">${ICON.google}Add Google</a>` : ''}</div>
<h2 class="ac-mt-l">Where you are signed in</h2>
<ul class="ui-card ac-list">${browsers.map((s) => sessionRow(s, apps.filter((a) => a.parent_id === s.id).length ? ` <span class="ui-chip is-outline">${apps.filter((a) => a.parent_id === s.id).map((a) => esc(a.name)).join(', ')}</span>` : '')).join('') || '<li class="ac-row ui-mute">Nowhere else.</li>'}</ul>
<h2 class="ac-mt-l">AI apps acting as you</h2>
<p class="ui-mute ac-lede">Claude, ChatGPT, Codex and Claude Code connect to an app's MCP address and sign in here. Each one shows up below until you sign it out.</p>
<ul class="ui-card ac-list">${conns.map((s) => sessionRow(s)).join('') || '<li class="ac-row ui-mute">None connected yet.</li>'}</ul>
<div class="ac-actions is-left"><button class="ui-btn is-danger is-sm" data-tool="account.sign_out_everywhere" data-then="signout" data-confirm="Sign out every browser, app and AI connection, this one too?">Sign out everywhere</button></div></section>

<section class="ac-sec" id="apps"><h2>Your apps</h2><p class="ui-mute ac-lede">One account for all of them. Looking is always free and open; signing in lets you use them.</p>
<div class="ac-apps">${APPS.map((a) => `<a class="ui-linkcard ac-app" href="${esc(a.url)}" data-tool="none" data-why="Opens the app"><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></a>`).join('')}</div></section>

<section class="ac-sec" id="team"><div class="ac-sec-h"><h2>Team</h2>
${teams.length > 1 ? `<label class="ac-team-pick"><span class="ui-sr">Team</span><select class="ui-select" data-tool="none" data-why="Switches which team this page shows" onchange="location.search='?team='+encodeURIComponent(this.value)+location.hash">${teams.map((t) => `<option value="${esc(t.slug)}"${t.id === team.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : ''}</div>
<div class="ui-card">
<form class="ac-inline" data-tool="team.update" data-then="reload"><input type="hidden" name="team" value="${esc(team.slug)}"><label class="ui-field"><span>Team name</span><input class="ui-input" name="name" value="${esc(team.name)}" ${admin ? '' : 'disabled'} required></label>${admin ? '<button class="ui-btn is-quiet" type="submit">Rename</button>' : ''}</form>
<ul class="ac-list is-flat">${team.members.map((m) => `<li class="ac-row">${avatar(m, 'is-sm')}<div class="ac-row-main"><b>${esc(m.name)}${m.id === me.id ? ' <span class="ui-mute">(you)</span>' : ''}</b><small>${esc(m.email ?? '')}</small></div>
${admin && m.id !== me.id ? `<select class="ui-select ac-role" aria-label="Role for ${esc(m.name)}" data-tool="team.set_role" data-input="${input({ team: team.slug, account_id: m.id })}" data-field="role" data-then="toast" data-ok="Role changed">${['owner', 'admin', 'member', 'guest'].map((r) => `<option${r === m.role ? ' selected' : ''}>${r}</option>`).join('')}</select>
<button class="ui-btn is-ghost is-sm" data-tool="team.remove_member" data-input="${input({ team: team.slug, account_id: m.id })}" data-then="reload" data-confirm="Take ${esc(m.name)} off ${esc(team.name)}?">Remove</button>` : `<span class="ui-chip is-outline">${esc(m.role)}</span>`}</li>`).join('')}
${team.invites.map((v) => `<li class="ac-row"><span class="ui-avatar is-sm is-empty" aria-hidden="true"></span><div class="ac-row-main"><b>${esc(v.email)}</b><small>Invited as ${esc(v.role)} · joins on first sign-in</small></div>${admin ? `<button class="ui-btn is-ghost is-sm" data-tool="team.revoke_invite" data-input="${input({ team: team.slug, invite_id: v.id })}" data-then="reload">Cancel invite</button>` : ''}</li>`).join('')}</ul>
${admin ? `<form class="ac-inline" data-tool="team.invite" data-then="reload"><input type="hidden" name="team" value="${esc(team.slug)}"><label class="ui-field"><span>Invite by email</span><input class="ui-input" type="email" name="email" placeholder="casey@acme.example" required></label><label class="ui-field ac-narrow"><span>Role</span><select class="ui-select" name="role"><option>member</option><option>admin</option><option>guest</option></select></label><button class="ui-btn is-accent" type="submit">Invite</button></form>` : ''}
</div>
<div class="ac-actions is-left"><form class="ac-inline is-compact" data-tool="team.create" data-then="team"><label class="ui-field"><span class="ui-sr">New team name</span><input class="ui-input" name="name" placeholder="New team name" required></label><button class="ui-btn is-quiet" type="submit">Create a team</button></form>
${!team.personal || teams.length > 1 ? `<button class="ui-btn is-ghost" data-tool="team.leave" data-input="${input({ team: team.slug })}" data-then="home" data-confirm="Leave ${esc(team.name)}?">Leave team</button>` : ''}</div></section>

<section class="ac-sec" id="brand"><h2>Brand kit</h2><p class="ui-mute ac-lede">Your logo, colour and type on every app your team uses, and your own address if you want one.</p>
<div class="ac-brand-grid">
<form class="ui-card ac-form" data-tool="team.set_brand" data-then="toast" data-ok="Brand saved. Apps pick it up within a minute." data-keep-empty>
<input type="hidden" name="team" value="${esc(team.slug)}">
<div class="ac-two"><label class="ui-field"><span>Logo on light <small>https link or upload</small></span><input class="ui-input" name="logo_light" value="${esc(brand.logo_light?.startsWith('data:') ? '' : brand.logo_light ?? '')}" placeholder="https://acme.example/logo.svg" ${admin ? '' : 'disabled'}><input class="ac-file" type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" data-into="logo_light" data-tool="none" data-why="Reads a file into the field above" ${admin ? '' : 'disabled'}></label>
<label class="ui-field"><span>Logo on dark <small>https link or upload</small></span><input class="ui-input" name="logo_dark" value="${esc(brand.logo_dark?.startsWith('data:') ? '' : brand.logo_dark ?? '')}" placeholder="https://acme.example/logo-white.svg" ${admin ? '' : 'disabled'}><input class="ac-file" type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" data-into="logo_dark" data-tool="none" data-why="Reads a file into the field above" ${admin ? '' : 'disabled'}></label></div>
<div class="ac-two"><label class="ui-field"><span>Accent</span><span class="ac-colour"><input type="color" value="${esc(brand.accent ?? '#7dd3fc')}" data-into="accent" data-tool="none" data-why="Picks a colour into the field beside it" ${admin ? '' : 'disabled'}><input class="ui-input" name="accent" value="${esc(brand.accent ?? '')}" placeholder="#7dd3fc" pattern="#[0-9a-fA-F]{6}" ${admin ? '' : 'disabled'}></span></label>
<label class="ui-field"><span>Text on accent</span><span class="ac-colour"><input type="color" value="${esc(brand.on_accent ?? '#04202e')}" data-into="on_accent" data-tool="none" data-why="Picks a colour into the field beside it" ${admin ? '' : 'disabled'}><input class="ui-input" name="on_accent" value="${esc(brand.on_accent ?? '')}" placeholder="#04202e" pattern="#[0-9a-fA-F]{6}" ${admin ? '' : 'disabled'}></span></label></div>
<div class="ac-three"><label class="ui-field"><span>Scheme</span><select class="ui-select" name="scheme" ${admin ? '' : 'disabled'}><option value="">Each app's own</option>${SCHEMES.map((s) => `<option${brand.scheme === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
<label class="ui-field"><span>Light or dark</span><select class="ui-select" name="mode" ${admin ? '' : 'disabled'}><option value="">Scheme's own</option>${['light', 'dark', 'auto'].map((s) => `<option${brand.mode === s ? ' selected' : ''} value="${s}">${s === 'auto' ? 'follow the device' : s}</option>`).join('')}</select></label>
<label class="ui-field"><span>Corners</span><select class="ui-select" name="shape" ${admin ? '' : 'disabled'}><option value="">Default</option>${SHAPES.map((s) => `<option${brand.shape === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label></div>
<div class="ac-three"><label class="ui-field"><span>Type set</span><select class="ui-select" name="type" ${admin ? '' : 'disabled'}><option value="">Default</option>${TYPES.map((s) => `<option${brand.type === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
<label class="ui-field"><span>Body font <small>optional</small></span><input class="ui-input" name="font" value="${esc(brand.font ?? '')}" placeholder="Poppins, sans-serif" ${admin ? '' : 'disabled'}></label>
<label class="ui-field"><span>Heading font <small>optional</small></span><input class="ui-input" name="display" value="${esc(brand.display ?? '')}" placeholder="Anybody, sans-serif" ${admin ? '' : 'disabled'}></label></div>
<label class="ui-field"><span>Font stylesheet <small>Google Fonts or Bunny Fonts link</small></span><input class="ui-input" name="fonts_href" value="${esc(brand.fonts_href ?? '')}" placeholder="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" ${admin ? '' : 'disabled'}></label>
<label class="ui-field"><span>Your own address <small>optional</small></span><input class="ui-input" name="custom_domain" value="${esc(brand.custom_domain?.name ?? '')}" placeholder="work.acme.example" ${admin ? '' : 'disabled'}></label>
${brand.custom_domain ? `<p class="ui-hint">Point <b>${esc(brand.custom_domain.name)}</b> at <code>${esc(brand.custom_domain.cname)}</code> with a CNAME record. Status: ${esc(brand.custom_domain.status)}. We switch it on once the record is there.</p>` : ''}
${admin ? '<div class="ac-actions"><button class="ui-btn is-accent" type="submit">Save brand kit</button></div>' : '<p class="ui-hint">Only admins and owners change the brand.</p>'}
</form>
<aside class="ac-preview" aria-label="Preview" data-preview><div class="ac-preview-card" data-side="dark"><div class="ac-preview-top">${brand.logo_dark ? `<img src="${esc(brand.logo_dark)}" alt="" data-logo="dark">` : `<b data-logo="dark">${esc(team.name)}</b>`}</div><p>Ready when you are.</p><span class="ac-preview-btn">New deal</span></div>
<div class="ac-preview-card is-light" data-side="light"><div class="ac-preview-top">${brand.logo_light ? `<img src="${esc(brand.logo_light)}" alt="" data-logo="light">` : `<b data-logo="light">${esc(team.name)}</b>`}</div><p>Ready when you are.</p><span class="ac-preview-btn">New deal</span></div>
<p class="ui-hint">Apps load it from <code>/brand/${esc(team.slug)}.css</code>.</p></aside></div></section>

<section class="ac-sec" id="data"><h2>Data home</h2><p class="ui-mute ac-lede">Where your team's records live. Change it any time; nothing is locked in.</p>
<form class="ui-card ac-form" data-tool="team.set_data_home" data-then="reload">
<input type="hidden" name="team" value="${esc(team.slug)}">
<div class="ui-choices ac-homes">
<label><input type="radio" name="kind" value="cloud" ${home.kind === 'cloud' ? 'checked' : ''} ${admin ? '' : 'disabled'}><span><b>warOnSaaS Cloud</b><small>Our Postgres, kept apart by team. Nothing to set up.</small></span></label>
<label><input type="radio" name="kind" value="postgres" ${home.kind === 'postgres' ? 'checked' : ''} ${admin ? '' : 'disabled'}><span><b>My own database</b><small>Any Postgres you run. We keep the address encrypted.</small></span></label>
<label><input type="radio" name="kind" value="github" ${home.kind === 'github' ? 'checked' : ''} ${admin ? '' : 'disabled'}><span><b>My GitHub</b><small>A repo in your own account or organization.</small></span></label></div>
<div class="ac-when" data-when="postgres"><label class="ui-field"><span>Database address</span><input class="ui-input" name="database_url" type="password" autocomplete="off" placeholder="${home.kind === 'postgres' ? `Saved: ${esc(home.host)}/${esc(home.database)}. Paste a new one to change it.` : 'postgres://user:password@host/db?sslmode=require'}" ${admin ? '' : 'disabled'}></label><p class="ui-hint">We connect once to check it, then keep it encrypted. It is never shown again, here or to an AI app.</p></div>
<div class="ac-when" data-when="github"><label class="ui-field"><span>Repo</span><input class="ui-input" name="repo" value="${esc(home.repo ?? '')}" placeholder="acme-dental/wos-data" ${admin ? '' : 'disabled'}></label><p class="ui-hint">Make the repo in your own account or organization, then <a href="${esc(home.install_url ?? 'https://github.com/apps/waronsaas-board/installations/new')}" data-tool="none" data-why="Opens GitHub to install the app">install the warOnSaaS GitHub App</a> on it. We never create organizations for you or keep your repos.</p>${home.kind === 'github' ? `<p class="ui-hint">GitHub App on ${esc(home.repo)}: ${home.installed ? 'installed' : 'not installed yet'}</p>` : ''}</div>
${admin ? '<div class="ac-actions"><button class="ui-btn is-accent" type="submit">Save data home</button></div>' : '<p class="ui-hint">Only admins and owners change where data lives.</p>'}
</form>
${admin ? `<div class="ui-card ac-move"><div class="ac-row-main"><b>Move my data home</b><small>Plans a copy of every app's data from ${home.kind === 'cloud' ? 'warOnSaaS Cloud' : home.kind === 'postgres' ? 'your database' : 'your repo'} to the home you pick above, app by app, with row counts checked on both sides.</small></div>
<button class="ui-btn is-quiet" data-tool="team.move_data_home" data-from-form="#data form" data-map="kind:to" data-then="move">Plan the move</button></div><div class="ac-move-plan" hidden></div>` : ''}
</section>

<section class="ac-sec" id="danger"><h2>Export and delete</h2>
<div class="ui-card ac-list">
<div class="ac-row"><div class="ac-row-main"><b>Export my account</b><small>Your profile, ways in, sessions, teams and history, as JSON.</small></div><button class="ui-btn is-quiet is-sm" data-tool="account.export" data-then="download" data-file="waronsaas-account.json">Export</button></div>
${admin ? `<div class="ac-row"><div class="ac-row-main"><b>Export everything for ${esc(team.name)}</b><small>Team, members, brand and data home, plus a download link for each app's data.</small></div><button class="ui-btn is-quiet is-sm" data-tool="team.export" data-input="${input({ team: team.slug })}" data-then="download" data-file="${esc(team.slug)}-export.json">Export</button></div>` : ''}
${team.your_role === 'owner' && !team.personal ? `<div class="ac-row"><div class="ac-row-main"><b>Delete ${esc(team.name)}</b><small>Removes the team, its brand and settings. Each app deletes its own data for the team.</small></div><button class="ui-btn is-danger is-sm" data-tool="team.delete" data-input="${input({ team: team.slug })}" data-ask="confirm" data-ask-label="Type ${esc(team.name)} to delete the team" data-then="home">Delete team</button></div>` : ''}
<div class="ac-row"><div class="ac-row-main"><b>Delete my account</b><small>Signs you out everywhere and removes your account. Teams only you are on go with it. Cannot be undone.</small></div><button class="ui-btn is-danger is-sm" data-tool="account.delete" data-ask="confirm" data-ask-label="Type delete to delete your account" data-then="signout">Delete account</button></div>
</div></section>
<p class="ac-foot is-left">warOnSaaS Account is open source (AGPL-3.0). <a href="${REPO}" data-tool="none" data-why="Opens the source code">Host it yourself, free</a>.</p>
</main></div></div>
<dialog class="ui-dialog ac-ask" id="ask"><form method="dialog" data-tool="none" data-why="Holds the confirm dialog buttons"><h3 data-ask-title>Are you sure?</h3><label class="ui-field" data-ask-field><span data-ask-label></span><input class="ui-input" name="v" autocomplete="off"></label><div class="ui-dialog-a"><button class="ui-btn is-ghost" value="cancel" data-tool="none" data-why="Closes the dialog">Cancel</button><button class="ui-btn is-danger" value="ok" data-tool="none" data-why="Confirms the action the dialog was opened for">Continue</button></div></form></dialog>
<div class="ui-toast" id="toast" role="status" aria-live="polite"></div>`;
  return layout({ title: 'Your account', body, scripts: true });
}

export { browserName };
