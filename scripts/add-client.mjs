// Registers one of our apps with the account server. The secret is never printed: it goes to a file you name
// (mode 600), or straight into the app's Vercel project.
//
//   node scripts/add-client.mjs --id crm --name CRM --redirect https://crm.waronsaas.com/auth/waronsaas/callback \
//        [--redirect more] [--home https://crm.waronsaas.com] [--rotate] [--secret-file path] [--vercel-project crm --vercel-scope battle-juice]
//
// Needs DATABASE_URL (the account database).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { openDb, migrate } from '../lib/db.mjs';
import { upsertClient } from '../lib/clients.mjs';

const args = process.argv.slice(2);
const one = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const many = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));

const db = openDb();
await migrate(db);
const r = await upsertClient(db, { id: one('id'), name: one('name') ?? one('id'), redirectUris: many('redirect'), app: one('app') ?? one('id'), home: one('home'), rotate: args.includes('--rotate') });
await db.close();
console.log(`client ${r.id} saved${r.secret ? ' with a new secret' : ' (secret unchanged)'}`);

if (r.secret) {
  if (one('secret-file')) {
    fs.writeFileSync(one('secret-file'), `WOS_ACCOUNT_CLIENT_ID=${r.id}\nWOS_ACCOUNT_CLIENT_SECRET=${r.secret}\n`, { mode: 0o600 });
    console.log(`secret written to ${one('secret-file')}`);
  }
  const project = one('vercel-project');
  if (project) {
    const scope = one('vercel-scope') ?? 'battle-juice';
    const cwd = one('vercel-cwd') ?? process.cwd();
    for (const [k, v] of [['WOS_ACCOUNT_CLIENT_ID', r.id], ['WOS_ACCOUNT_CLIENT_SECRET', r.secret]]) {
      spawnSync('vercel', ['env', 'rm', k, 'production', '--yes', '--scope', scope], { cwd, stdio: 'ignore' });
      const x = spawnSync('vercel', ['env', 'add', k, 'production', '--scope', scope], { cwd, input: v, stdio: ['pipe', 'ignore', 'inherit'] });
      console.log(`${k} -> ${project} ${x.status === 0 ? 'saved' : 'FAILED'}`);
    }
  }
  if (!one('secret-file') && !project) console.log('Nowhere to put the secret: pass --secret-file or --vercel-project. Run again with --rotate.');
}
