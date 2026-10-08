// Writes tools.json from the list below, so every tool has the same shape. Run: node scripts/build-tools.mjs
import fs from 'node:fs';

const S = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });
const team = str('The team id or slug. Leave out for your own team.');
const ok = S({ ok: bool('Done') });
const T = (name, title, description, input, output, scope, confirm = 'none', emits = []) => ({ name, title, description, input, output, scope, confirm, emits, test: 'test/tools.test.mjs' });

const brandProps = {
  logo_light: str('Logo for light backgrounds: an https link or a data: image under 220 KB. Empty to remove.'),
  logo_dark: str('Logo for dark backgrounds: an https link or a data: image under 220 KB. Empty to remove.'),
  accent: str('Accent colour, like #4635ff.'),
  on_accent: str('Text colour on the accent, like #ffffff.'),
  scheme: str('ui-design colour scheme.', { enum: ['ops', 'midnight', 'neutral', 'ember', 'tide', 'sage', 'arcade', 'warroom', ''] }),
  mode: str('Light, dark, or follow the device.', { enum: ['light', 'dark', 'auto', ''] }),
  type: str('ui-design type set.', { enum: ['grotesk', 'mono', 'editorial', 'humanist', 'pixel', 'system', ''] }),
  shape: str('Corners.', { enum: ['sharp', 'soft', 'round', ''] }),
  font: str('Body font, like "Poppins, sans-serif".'),
  display: str('Heading font, like "Anybody, sans-serif".'),
  fonts_href: str('A Google Fonts or Bunny Fonts stylesheet link that loads the fonts above.'),
  custom_domain: str('Your own address for the apps, like work.acme.example. Empty to remove.'),
};
const brandOut = { type: 'object', description: 'The brand kit', properties: Object.fromEntries(Object.keys(brandProps).map((k) => [k, k === 'custom_domain' ? { type: 'object' } : { type: 'string' }])) };
const home = { type: 'object', description: 'Where the team data lives', properties: { kind: str('cloud, postgres or github'), host: str('Database host (postgres)'), database: str('Database name (postgres)'), repo: str('owner/name (github)'), installed: bool('The GitHub App is installed on the repo (github)'), install_url: str('Where to install the GitHub App (github)') } };

const tools = [
  T('account.me', 'Show my account', 'Your warOnSaaS account: name, email, the ways you sign in (GitHub, Google, email), your teams, and whether you get update emails.', S(), S({ id: str('Account id'), name: str('Name'), email: str('Email'), updates_opt_in: bool('Gets update emails'), identities: { type: 'array' }, teams: { type: 'array' } }), 'read'),
  T('account.update_profile', 'Save my profile', 'Change your name, or turn update emails on or off. Update emails are rare: new apps and big changes, never ads from others.', S({ name: str('Your name as teammates see it'), updates_opt_in: bool('Send me update emails') }), ok, 'write'),
  T('account.list_sessions', 'List where I am signed in', 'Every browser, app and AI connection signed in to your account, newest first. Connections are AI apps (Claude, ChatGPT, Codex, Claude Code) acting as you.', S(), S({ sessions: { type: 'array' } }), 'read'),
  T('account.end_session', 'Sign out of one place', 'Sign out one browser, app or AI connection by its session id. A browser takes the apps it signed in to with it.', S({ session_id: str('From account.list_sessions') }, ['session_id']), ok, 'write', 'none', ['account.session.ended']),
  T('account.sign_out_everywhere', 'Sign out everywhere', 'Sign out every browser, app and AI connection on your account, this one included.', S(), S({ ended: { type: 'integer' } }), 'write', 'none', ['account.session.ended']),
  T('account.unlink_identity', 'Remove a way to sign in', 'Remove GitHub, Google or an email address as a way into this account. You always keep at least one.', S({ identity_id: str('From account.me identities') }, ['identity_id']), ok, 'write'),
  T('account.export', 'Export my account', 'Everything warOnSaaS Account keeps about you, as JSON: profile, ways in, sessions, teams, and the history of changes.', S(), { type: 'object' }, 'read'),
  T('account.delete', 'Delete my account', 'Delete your account and sign out everywhere. Teams you alone are on go with it; on shared teams the next person becomes owner. Cannot be undone.', S({ confirm: str('Type delete to confirm') }, ['confirm']), ok, 'delete', 'human', ['account.deleted']),
  T('account.list_approvals', 'List what waits for my yes', 'Actions an AI app asked to do that need you to say yes first, like deleting the account.', S(), S({ approvals: { type: 'array' } }), 'read'),
  T('account.answer_approval', 'Answer an approval', 'Say yes or no to an action an AI app asked for. Only a person on a screen can answer.', S({ approval_id: str('From account.list_approvals'), answer: str('yes or no', { enum: ['yes', 'no'] }) }, ['approval_id', 'answer']), { type: 'object' }, 'admin'),

  T('team.list', 'List my teams', 'The teams you are on, with your role on each.', S(), S({ teams: { type: 'array' } }), 'read'),
  T('team.create', 'Create a team', 'Start a new team. You are its owner. It gets the default brand and keeps its data in warOnSaaS Cloud until you choose another home.', S({ name: str('Team name, like Acme Dental') }, ['name']), S({ id: str('Team id'), slug: str('Short name used in links') }), 'write', 'none', ['team.created']),
  T('team.get', 'Show a team', 'A team: name, members, open invites, brand kit and data home.', S({ team }), { type: 'object' }, 'read'),
  T('team.update', 'Rename a team', 'Change the team name. Admins and owners only.', S({ team, name: str('New name') }, ['name']), ok, 'admin'),
  T('team.invite', 'Invite someone', 'Invite a person by email. If they already have an account they join now; otherwise they join the first time they sign in with that address.', S({ team, email: str('Their email'), role: str('admin, member or guest', { enum: ['admin', 'member', 'guest'] }) }, ['email']), S({ added: bool('Joined now'), invited: bool('Will join on first sign-in') }), 'admin', 'none', ['team.member.invited']),
  T('team.revoke_invite', 'Cancel an invite', 'Cancel an invite that was not used yet.', S({ team, invite_id: str('From team.get') }, ['invite_id']), ok, 'admin'),
  T('team.set_role', 'Change a role', 'Make someone owner, admin, member or guest. A team always keeps one owner.', S({ team, account_id: str('From team.get members'), role: str('The new role', { enum: ['owner', 'admin', 'member', 'guest'] }) }, ['account_id', 'role']), ok, 'admin', 'none', ['team.member.role_changed']),
  T('team.remove_member', 'Remove someone', 'Take a person off the team. They keep their account.', S({ team, account_id: str('From team.get members') }, ['account_id']), ok, 'admin', 'none', ['team.member.left']),
  T('team.leave', 'Leave a team', 'Take yourself off a team. The last owner must hand over first.', S({ team: str('The team id or slug') }, ['team']), ok, 'write', 'none', ['team.member.left']),
  T('team.delete', 'Delete a team', 'Delete a team and its brand and settings. Data each app keeps for the team is deleted by that app. Owners only. Cannot be undone.', S({ team: str('The team id or slug'), confirm: str('Type the team name to confirm') }, ['team', 'confirm']), ok, 'delete', 'human', ['team.deleted']),

  T('team.get_brand', 'Show the brand kit', 'The team look every app uses: logos for light and dark, accent colour, fonts, scheme, and the custom domain if any.', S({ team }), brandOut, 'read'),
  T('team.set_brand', 'Save the brand kit', 'Change any part of the team look. Only the fields you send change; send an empty string to clear one. Every app picks it up within a minute.', S({ team, ...brandProps }), brandOut, 'admin', 'none', ['team.brand.changed']),

  T('team.get_data_home', 'Show where data lives', 'Where the team data lives: warOnSaaS Cloud (the default), your own Postgres, or a repo in your own GitHub account. Database passwords are never shown.', S({ team }), home, 'read'),
  T('team.set_data_home', 'Choose where data lives', 'Point the team at a data home. cloud needs nothing. postgres needs database_url (checked by connecting, then kept encrypted). github needs repo (owner/name in your own account or organization) with the warOnSaaS GitHub App installed there; we never create organizations or keep your repos. Existing data does not move: use team.move_data_home for that.', S({ team, kind: str('cloud, postgres or github', { enum: ['cloud', 'postgres', 'github'] }), database_url: str('postgres only: postgres://user:password@host/db'), repo: str('github only: owner/name') }, ['kind']), home, 'admin', 'none', ['team.data_home.changed']),
  T('team.move_data_home', 'Move my data home', 'Plan or start copying every app\'s data from the current home to a new one. Returns the steps per app and what each one does. The copy runs per app; apps without a mover yet say so.', S({ team, to: str('cloud, postgres or github', { enum: ['cloud', 'postgres', 'github'] }), database_url: str('postgres only'), repo: str('github only: owner/name'), start: bool('false (default) only plans; true starts the copy') }, ['to']), S({ move_id: str('Move id'), status: str('planned, running, done or failed'), steps: { type: 'array' } }), 'admin', 'human', ['team.data_home.moved']),
  T('team.export', 'Export everything', 'One bundle of everything the team has: team, members, brand, data home, plus a download link per app (board, CRM, chat, email, meetings, scanner).', S({ team }), { type: 'object' }, 'admin'),
];

// One file per app id, as the suite checker wants: tools.json (account.*) and team.tools.json (team.*).
for (const [app, file] of [['account', 'tools.json'], ['team', 'team.tools.json']]) {
  const list = tools.filter((t) => t.name.startsWith(`${app}.`));
  const out = { $schema: 'https://raw.githubusercontent.com/warOnSaaS/suite/main/packages/tools/tools.schema.json', app, version: 1, tools: list };
  fs.writeFileSync(new URL(`../${file}`, import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${file}: ${list.length} tools`);
}
