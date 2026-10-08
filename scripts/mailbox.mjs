// A throwaway inbox we can read through an API (mail.tm), for live end-to-end tests of email sign-in.
// Never used for real people. Usage (from code): const box = await Mailbox.create(); await box.waitFor(/verify/)
export class Mailbox {
  static API = 'https://api.mail.tm';
  static async create() {
    const d = await fetch(`${Mailbox.API}/domains`).then((r) => r.json());
    const domain = d['hydra:member'][0].domain;
    const address = `wos-test-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`;
    const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const c = await fetch(`${Mailbox.API}/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, password }) });
    if (!c.ok) throw new Error(`mail.tm account: ${c.status}`);
    const t = await fetch(`${Mailbox.API}/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, password }) }).then((r) => r.json());
    const box = new Mailbox();
    Object.assign(box, { address, token: t.token });
    return box;
  }
  async waitFor(re, { timeoutMs = 120_000 } = {}) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const list = await fetch(`${Mailbox.API}/messages`, { headers: { authorization: `Bearer ${this.token}` } }).then((r) => r.json());
      for (const m of list['hydra:member'] ?? []) {
        const full = await fetch(`${Mailbox.API}/messages/${m.id}`, { headers: { authorization: `Bearer ${this.token}` } }).then((r) => r.json());
        const text = `${full.subject}\n${full.text ?? ''}`;
        if (re.test(text)) return { subject: full.subject, from: full.from?.address, text, html: Array.isArray(full.html) ? full.html.join('') : full.html };
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('No email arrived in time');
  }
}
