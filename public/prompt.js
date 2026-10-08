// "Look freely, sign in to use." Drop this into any warOnSaaS app page:
//
//   <script src="https://account.waronsaas.com/prompt.js" defer
//           data-signed-in="false" data-app="CRM" data-signin="/auth/waronsaas"></script>
//
// While signed out, every action (an element with data-tool other than "none", data-needs-account, or a POST form)
// opens a friendly prompt instead of running. Viewing is never blocked. Apps can also call
// window.wosAccount.prompt('Save this deal') themselves, for example when an API answers 401.
// If the browser is already signed in to warOnSaaS somewhere (the wos_signed_in hint cookie), the page signs in
// silently once per tab, so moving between apps needs no clicks.
(() => {
  const me = document.currentScript;
  const cfg = {
    signedIn: me?.dataset.signedIn === 'true',
    app: me?.dataset.app || 'this app',
    signin: me?.dataset.signin || '/auth/waronsaas',
    providers: (me?.dataset.providers || 'github,google,email').split(','),
    silent: me?.dataset.silent !== 'false',
  };
  const here = () => location.pathname + location.search + location.hash;
  const go = (extra = '') => `${cfg.signin}?next=${encodeURIComponent(here())}${extra}`;

  // Silent sign-in, once per tab, only when the hint says an account session exists.
  try {
    if (!cfg.signedIn && cfg.silent && /(?:^|;\s*)wos_signed_in=1/.test(document.cookie) && !sessionStorage.getItem('wos_silent_tried')) {
      sessionStorage.setItem('wos_silent_tried', '1');
      location.replace(go('&prompt=none'));
      return;
    }
    if (cfg.signedIn) sessionStorage.removeItem('wos_silent_tried');
  } catch { /* storage blocked: skip silent sign-in */ }

  const css = `.wos-ap{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:var(--ui-scrim,rgba(0,0,0,.55));-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:wos-ap-in .16s ease-out}
.wos-ap-card{width:min(400px,100%);background:var(--ui-surface,#111113);color:var(--ui-ink,#fafafa);border:1px solid var(--ui-line-2,rgba(255,255,255,.14));border-radius:var(--ui-radius-lg,14px);padding:26px 24px 20px;box-shadow:var(--ui-shadow-lg,0 24px 60px rgba(0,0,0,.45));font-family:var(--ui-font,system-ui,sans-serif)}
.wos-ap h2{color:var(--ui-ink,#fafafa);margin:0 0 6px;font-size:20px;line-height:1.25;font-family:var(--ui-display,inherit);font-weight:var(--ui-display-weight,600)}
.wos-ap p{margin:0 0 18px;color:var(--ui-ink-2,#a1a1aa);font-size:14px;line-height:1.55}
.wos-ap-b{display:grid;gap:8px}
.wos-ap a,.wos-ap button{display:flex;align-items:center;justify-content:center;gap:10px;min-height:42px;border-radius:var(--ui-radius-sm,8px);font:500 15px/1 var(--ui-font,system-ui,sans-serif);text-decoration:none;cursor:pointer;border:1px solid var(--ui-line,rgba(255,255,255,.1));background:var(--ui-surface-2,#18181b);color:var(--ui-ink,#fafafa)}
.wos-ap a.is-main{background:var(--ui-accent,#7dd3fc);color:var(--ui-on-accent,#04202e);border-color:transparent}
.wos-ap button.is-quiet{background:none;border-color:transparent;color:var(--ui-ink-2,#a1a1aa);min-height:36px;font-size:14px;margin-top:4px}
.wos-ap small{display:block;margin-top:12px;text-align:center;color:var(--ui-ink-3,#8b8b95);font-size:12.5px}
@keyframes wos-ap-in{from{opacity:0}to{opacity:1}}
@media (max-width:560px){.wos-ap{place-items:end center;padding:0}.wos-ap-card{border-radius:var(--ui-radius-lg,14px) var(--ui-radius-lg,14px) 0 0;width:100%}}`;
  const GH = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  const G = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 009 18z"/><path fill="#FBBC05" d="M3.96 10.72A5.4 5.4 0 013.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.05l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  let open = null;
  function prompt(action) {
    if (open) return false;
    if (!document.getElementById('wos-ap-css')) {
      const st = document.createElement('style');
      st.id = 'wos-ap-css';
      st.textContent = css;
      document.head.appendChild(st);
    }
    const prev = document.activeElement;
    const el = document.createElement('div');
    el.className = 'wos-ap';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'wos-ap-h');
    const what = action ? `${esc(String(action).replace(/\s+/g, ' ').trim().slice(0, 60))}` : '';
    el.innerHTML = `<div class="wos-ap-card"><h2 id="wos-ap-h">${what ? `Sign in to ${what.charAt(0).toLowerCase() + what.slice(1)}` : `Sign in to use ${esc(cfg.app)}`}</h2>
<p>Free. We ask so we can keep it fast and fair, and so your AI can act as you.</p><div class="wos-ap-b">
${cfg.providers.includes('github') ? `<a class="is-main" href="${esc(go('&provider=github'))}" data-tool="none" data-why="Starts sign-in">${GH}Continue with GitHub</a>` : ''}
${cfg.providers.includes('google') ? `<a href="${esc(go('&provider=google'))}" data-tool="none" data-why="Starts sign-in">${G}Continue with Google</a>` : ''}
${cfg.providers.includes('email') ? `<a href="${esc(go())}" data-tool="none" data-why="Starts sign-in">Use my email</a>` : ''}
<button type="button" class="is-quiet" data-tool="none" data-why="Closes the prompt">Keep looking</button></div>
<small>Everything stays open to look at. One free account works in every warOnSaaS app.</small></div>`;
    const close = () => { el.remove(); open = null; document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('button.is-quiet')) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(el);
    open = el;
    el.querySelector('a,button')?.focus();
    return false;
  }

  const isAction = (t) => {
    const a = t.closest?.('[data-needs-account],[data-tool]');
    if (!a || a.closest('.wos-ap')) return null;
    if (a.hasAttribute('data-needs-account')) return a;
    const tool = a.getAttribute('data-tool');
    if (!tool || tool === 'none' || a.hasAttribute('data-public')) return null;
    return a;
  };
  const label = (a) => a.getAttribute('data-action-label') || a.getAttribute('aria-label') || a.getAttribute('title') || (a.tagName === 'FORM' ? a.querySelector('[type=submit], button:not([type])')?.textContent : a.textContent) || '';

  if (!cfg.signedIn) {
    document.addEventListener('click', (e) => {
      const a = isAction(e.target);
      if (!a || a.tagName === 'FORM') return;
      // A text field inside an action area is for typing; only presses act.
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'submit' && e.target.type !== 'checkbox') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      prompt(label(a));
    }, true);
    document.addEventListener('submit', (e) => {
      const f = e.target;
      if (f.hasAttribute('data-public') || f.getAttribute('data-tool') === 'none') return;
      if (!isAction(f) && (f.method || 'get').toLowerCase() !== 'post') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      prompt(label(f));
    }, true);
    // Drag and drop on boards counts as an action too.
    document.addEventListener('dragstart', (e) => { if (isAction(e.target)) { e.preventDefault(); prompt('move cards'); } }, true);
  }

  window.wosAccount = { signedIn: cfg.signedIn, prompt, signInUrl: go };
})();
