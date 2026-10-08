// Per-account limits every app shares ("20 scans an hour"). A fixed window per bucket, counted in Postgres so
// every copy of every app sees the same number. Apps call POST /api/limits/hit with their client secret.

const BUCKET = /^[a-z0-9][a-z0-9._:-]{0,79}$/;

export async function hit(db, { account, bucket, max, per, cost = 1, peek = false }) {
  if (!account) return { error: 'account is required' };
  if (!BUCKET.test(String(bucket ?? ''))) return { error: 'bucket must be lower case letters, digits, dot, colon, dash or underscore, like scanner.scan' };
  const m = Math.floor(Number(max));
  const p = Math.floor(Number(per));
  if (!(m >= 1 && m <= 1_000_000)) return { error: 'max must be between 1 and 1000000' };
  if (!(p >= 1 && p <= 31 * 86400)) return { error: 'per must be seconds, between 1 and 2678400 (31 days)' };
  const c = Math.max(0, Math.min(1000, Math.floor(Number(cost ?? 1))));
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % p);
  let hits;
  if (peek || c === 0) {
    hits = (await db.get('SELECT hits FROM limits WHERE account_id = $1 AND bucket = $2 AND window_start = $3', [account, bucket, start]))?.hits ?? 0;
  } else {
    // Count only while under the limit, so a blocked call does not push the window further.
    const row = await db.get(
      `INSERT INTO limits (account_id, bucket, window_start, hits) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, bucket, window_start) DO UPDATE SET hits = limits.hits + $4 WHERE limits.hits + $4 <= $5
       RETURNING hits`, [account, bucket, start, c, m]);
    if (!row) {
      hits = (await db.get('SELECT hits FROM limits WHERE account_id = $1 AND bucket = $2 AND window_start = $3', [account, bucket, start]))?.hits ?? m;
      return { ok: false, hits, max: m, remaining: Math.max(0, m - hits), reset_at: new Date((start + p) * 1000).toISOString(), retry_after: start + p - now };
    }
    hits = row.hits;
    if (Math.random() < 0.01) db.run('DELETE FROM limits WHERE window_start < $1', [now - 32 * 86400]).catch(() => {});
  }
  return { ok: hits <= m, hits, max: m, remaining: Math.max(0, m - hits), reset_at: new Date((start + p) * 1000).toISOString(), retry_after: hits <= m ? 0 : start + p - now };
}
