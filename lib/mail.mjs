// Email through Resend when RESEND_API_KEY is set; otherwise the message goes to the server log, so a
// self-hoster can sign in before setting up mail. Optionally SMTP later; Resend is all the hosted copy needs.
export function mailer(env = process.env) {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM || 'warOnSaaS <signin@notify.waronsaas.com>';
  return {
    configured: !!key,
    async send({ to, subject, text, html, fromName }) {
      if (!key) {
        console.log(`[mail] to=${to} subject=${subject}\n${text}`);
        return { logged: true };
      }
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: fromName ? `${String(fromName).replace(/[<>"\r\n]/g, '')} <${from.replace(/^.*<|>.*$/g, '')}>` : from, to: [to], subject, text, html }),
      });
      if (!r.ok) throw new Error(`Email could not be sent (Resend ${r.status})`);
      return r.json();
    },
  };
}
