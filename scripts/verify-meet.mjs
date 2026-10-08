// Live check for Meetings: signed out it is open and starting needs the account; signed in to the account it
// signs in silently and can start a meeting; a guest with only the link joins with no account.
import { createRequire } from 'node:module';
import { Mailbox } from './mailbox.mjs';
const { chromium } = createRequire(`${process.env.HOME}/crm/package.json`)('playwright');
const M = 'https://meet.waronsaas.com';
const A = 'https://account.waronsaas.com';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const tool = (p, name, input = {}) => p.evaluate(async ([n, i]) => (await fetch(`/api/tools/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(i) })).json(), [name, input]);

for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  await p.goto(M);
  await p.waitForTimeout(2500);
  const who = await tool(p, 'meet.whoami');
  console.log(`${w} signed out: user=${who.result.user} can_start=${who.result.can_start} signin_url=${who.result.signin_url}; page says "${(await p.innerText('body')).match(/Sign in[^\n]*/)?.[0]}"`);
  await p.screenshot({ path: `.shots/live-meet-signed-out-${w}.png` });
}

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const box = await Mailbox.create();
await p.goto(`${A}/sign-in`);
await p.fill('input[name=email]', box.address);
await p.click('form.ac-email button');
const mail = await box.waitFor(/Sign in/);
await p.goto(mail.text.match(/https:\/\/account\.waronsaas\.com\/auth\/email\/verify\?t=[^\s\]]+/)[0]);
await p.click('button:has-text("Continue")');
await p.waitForSelector('text=What should we call you');
await p.fill('input[name=name]', 'Jordan Test');
await p.click('button:has-text("Continue")');
await p.waitForSelector('#profile');
const m = await ctx.newPage();
await m.goto(M);
let me = null;
for (let i = 0; i < 20 && !me; i++) { await m.waitForTimeout(750); me = (await tool(m, 'meet.whoami').catch(() => null))?.result?.user; }
console.log('signed in silently:', me ? `${me.name} (${me.id})` : 'NO');
await m.screenshot({ path: '.shots/live-meet-signed-in-1440.png' });
const made = await tool(m, 'meet.create', { title: 'Acme Dental standup' });
console.log('start a meeting:', made.ok ? made.result.join_url : JSON.stringify(made.error));

const g = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await g.goto(made.result.join_url);
await g.waitForTimeout(3000);
await g.screenshot({ path: '.shots/live-meet-guest-390.png' });
const gj = await tool(g, 'meet.join', { meeting: made.result.join_url.split('/m/')[1], name: 'Casey' });
console.log('guest with only the link:', gj.ok ? `joined as guest=${gj.result.participant.is_guest}, status=${gj.result.participant.status}` : JSON.stringify(gj.error));
await tool(m, 'meet.end', { meeting: made.result.id }).catch(() => {});
await p.goto(A);
console.log('test account:', await p.evaluate(() => window.callTool('account.delete', { confirm: 'delete' }).then(() => 'deleted').catch((e) => e.message)));
await b.close();
