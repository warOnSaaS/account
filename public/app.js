// The account page: every button and form that names a tool (data-tool) calls /api/tools/<name>, the same
// handler AI apps reach over MCP. Nothing else talks to the server.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const toast = (text) => {
    const t = $('#toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('is-on'), 2600);
  };

  async function callTool(name, input) {
    const r = await fetch(`/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wos-call': '1' }, body: JSON.stringify(input), credentials: 'same-origin' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error?.message || 'That did not work. Try again.');
    return body.result;
  }
  window.callTool = callTool;

  const ask = (title, label) => new Promise((resolve) => {
    const d = $('#ask');
    $('[data-ask-title]', d).textContent = title;
    const field = $('[data-ask-field]', d);
    field.hidden = !label;
    $('[data-ask-label]', d).textContent = label || '';
    const inp = $('input', d);
    inp.value = '';
    d.returnValue = '';
    d.showModal();
    if (label) inp.focus();
    d.addEventListener('close', () => resolve(d.returnValue === 'ok' ? (label ? inp.value : true) : null), { once: true });
  });

  function download(name, data) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function after(el, result) {
    const then = el.dataset.then;
    if (then === 'reload') return location.reload();
    if (then === 'signout' || then === 'home') return (location.href = then === 'home' ? '/' : '/sign-in');
    if (then === 'team') return (location.href = `/?team=${encodeURIComponent(result.slug)}#team`);
    if (then === 'download') { download(el.dataset.file || 'export.json', result); return toast('Downloaded'); }
    if (then === 'move') return showMove(result);
    toast(el.dataset.ok || 'Done');
  }

  function formInput(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled || el.type === 'file') continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.value !== '' || form.hasAttribute('data-keep-empty')) out[el.name] = el.value;
    }
    return out;
  }

  async function run(el, input) {
    if (el.dataset.confirm && !(await ask(el.dataset.confirm))) return;
    if (el.dataset.ask) {
      const v = await ask('Are you sure?', el.dataset.askLabel);
      if (v === null) return;
      input[el.dataset.ask] = v;
    }
    const busy = el.tagName === 'FORM' ? $('[type=submit]', el) : el;
    busy?.setAttribute('aria-disabled', 'true');
    try {
      after(el, await callTool(el.dataset.tool, input));
    } catch (e) {
      toast(e.message);
    } finally {
      busy?.removeAttribute('aria-disabled');
    }
  }

  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.dataset.tool || f.dataset.tool === 'none') return;
    e.preventDefault();
    run(f, formInput(f));
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tool]');
    if (!b || b.dataset.tool === 'none' || b.type === 'submit' && b.form?.dataset.tool) return;
    e.preventDefault();
    let input = b.dataset.input ? JSON.parse(b.dataset.input) : {};
    if (b.dataset.fromForm) {
      input = { ...formInput($(b.dataset.fromForm)), ...input };
      for (const pair of (b.dataset.map || '').split(',').filter(Boolean)) {
        const [from, to] = pair.split(':');
        input[to] = input[from];
        delete input[from];
      }
    }
    run(b, input);
  });

  document.addEventListener('change', (e) => {
    const s = e.target;
    if (s.tagName === 'SELECT' && s.dataset.tool && s.dataset.tool !== 'none') {
      run(s, { ...JSON.parse(s.dataset.input || '{}'), [s.dataset.field]: s.value });
    }
    // colour pickers and file inputs fill the text field they belong to
    if (s.dataset.into) {
      const target = s.closest('form').elements[s.dataset.into];
      if (s.type === 'color') { target.value = s.value; preview(); }
      if (s.type === 'file' && s.files[0]) {
        if (s.files[0].size > 220_000) { toast('That image is over 220 KB. Use a smaller file or an https link.'); s.value = ''; return; }
        const rd = new FileReader();
        rd.onload = () => { target.value = rd.result; preview(); };
        rd.readAsDataURL(s.files[0]);
      }
    }
    if (s.name === 'kind') homes();
  });
  document.addEventListener('input', (e) => { if (e.target.closest('[data-tool="team.set_brand"]')) preview(); });

  // Live preview of the brand kit.
  function preview() {
    const f = $('form[data-tool="team.set_brand"]');
    const pv = $('[data-preview]');
    if (!f || !pv) return;
    const v = (n) => f.elements[n]?.value?.trim();
    const ok = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
    pv.style.setProperty('--pv-accent', ok(v('accent')) ? v('accent') : '');
    pv.style.setProperty('--pv-on', ok(v('on_accent')) ? v('on_accent') : '');
    pv.style.setProperty('--pv-font', v('font') || '');
    for (const side of ['light', 'dark']) {
      const src = v(`logo_${side}`);
      const box = $(`[data-side="${side}"] .ac-preview-top`, pv);
      if (src && /^(https:|data:image\/)/.test(src)) box.innerHTML = `<img alt="" src="${src.replace(/"/g, '&quot;')}">`;
    }
  }

  // The data home form shows the field for the choice made.
  function homes() {
    const f = $('form[data-tool="team.set_data_home"]');
    if (!f) return;
    const kind = f.elements.kind.value;
    f.querySelectorAll('[data-when]').forEach((el) => { el.hidden = el.dataset.when !== kind; });
  }

  function showMove(r) {
    const box = $('.ac-move-plan');
    box.hidden = false;
    box.innerHTML = `<div class="ui-card"><p><b>Move planned</b> from ${r.from.kind} to ${r.to.kind}. Each app copies its own data:</p><ol class="ac-steps">${r.steps.map((s) => `<li><b>${s.name}</b> <span class="ui-chip is-soft is-warn">${s.ready ? 'ready' : 'not built yet'}</span><br><small>${s.does}</small></li>`).join('')}</ol><p class="ui-hint">Until each app's copy is built, use Export everything to take the data now.</p></div>`;
  }

  // Section nav highlights the section in view.
  const links = [...document.querySelectorAll('.ac-nav a')];
  const io = 'IntersectionObserver' in window && new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) links.forEach((a) => a.toggleAttribute('aria-current', a.hash === `#${en.target.id}`));
  }, { rootMargin: '-30% 0px -60% 0px' });
  if (io) document.querySelectorAll('.ac-sec[id]').forEach((s) => io.observe(s));

  homes();
  preview();
})();
