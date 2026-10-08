// Screenshots of every account screen at 1440 and 390 into .shots/. Runs against a local server with
// ACCOUNT_DEV_LINKS=1 (the email link shows on the page): node scripts/shots.mjs http://localhost:3990
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.HOME}/crm/package.json`);
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://localhost:3990';
fs.mkdirSync('.shots', { recursive: true });
const browser = await chromium.launch();
for (const [w, h, tag] of [[1440, 960, '1440'], [390, 844, '390']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/sign-in`);
  await page.screenshot({ path: `.shots/signin-${tag}.png` });
  await page.fill('input[name=email]', `sam.rivera+${tag}@acme.example`);
  await page.click('form.ac-email button');
  await page.waitForSelector('text=Check your email');
  await page.screenshot({ path: `.shots/check-email-${tag}.png` });
  await page.click('text=open the link');
  await page.waitForSelector('text=Sign in as');
  await page.screenshot({ path: `.shots/confirm-${tag}.png` });
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('#profile');
  // Fill in a little so the page looks used.
  await page.evaluate(async () => {
    await window.callTool('account.update_profile', { name: 'Sam Rivera' });
    const t = await window.callTool('team.create', { name: 'Acme Dental' });
    await window.callTool('team.invite', { team: t.slug, email: 'casey@acme.example', role: 'member' });
    await window.callTool('team.set_brand', { team: t.slug, accent: '#4635ff', on_accent: '#ffffff', scheme: 'midnight', custom_domain: 'work.acme.example' });
    location.href = `/?team=${t.slug}`;
  });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `.shots/home-${tag}.png`, fullPage: true });
  await page.goto(`${base}/sign-in?next=${encodeURIComponent('/oauth/authorize?client_id=crm')}`);
  await ctx.close();
}
// The consent screen an AI app sees.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/sign-in`);
  await page.fill('input[name=email]', 'jordan@acme.example');
  await page.click('form.ac-email button');
  await page.click('text=open the link');
  await page.click('button:has-text("Continue")');
  const reg = await page.evaluate(async () => (await fetch('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude Code', redirect_uris: ['http://localhost:33418/callback'] }) })).json());
  await page.goto(`${base}/oauth/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent('http://localhost:33418/callback')}&response_type=code&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&code_challenge_method=S256&scope=openid%20account`);
  await page.screenshot({ path: '.shots/consent-1440.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.shots/consent-390.png' });
  await ctx.close();
}
await browser.close();
console.log('screenshots in .shots/');
