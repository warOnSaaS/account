// Fails when a private name (listed in the git-ignored .names file, one per line) or something shaped like a
// secret is in any tracked file. Run before anything goes public: npm run check:clean
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const names = fs.existsSync('.names') ? fs.readFileSync('.names', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : [];
const secrets = [/gh[opsu]_[A-Za-z0-9]{30,}/, /re_[A-Za-z0-9]{20,}_[A-Za-z0-9]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /postgres(ql)?:\/\/[^\s'"`]+:[^\s'"`@]{8,}@(?!host)[a-z0-9.-]+\.(neon\.tech|com|io|net)/i, /sk-[A-Za-z0-9]{32,}/, /wcs_[A-Za-z0-9_-]{30,}/];
const files = execFileSync('git', ['ls-files']).toString().split('\n').filter((f) => f && !f.startsWith('public/ui/fonts/') && fs.existsSync(f));
const bad = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const n of names) if (s.toLowerCase().includes(n.toLowerCase())) bad.push(`${f}: private name "${n}"`);
  for (const r of secrets) if (r.test(s)) bad.push(`${f}: looks like a secret (${r})`);
  if (s.includes(String.fromCharCode(0x2014))) bad.push(`${f}: em dash`);
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log(`check:clean: ${files.length} files, no private names, secrets or em dashes`);
