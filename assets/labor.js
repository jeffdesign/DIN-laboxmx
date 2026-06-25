/* =====================================================================
   LaborMX — shared interaction + i18n engine
   Operates on the current document. Imported from each page's
   Design Component logic class (componentDidMount → import('labor.js')).
   ===================================================================== */

const EASE = 'cubic-bezier(0.16,1,0.3,1)';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;

/* ---------- helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));
const lerp = (a, b, n) => (1 - n) * a + n * b;

/* ---------- FORM WEBHOOK CONFIG ----------
   Production setup:
   1) Replace zapierWebhookUrl with the Zapier Catch Hook URL.
   2) Replace backupEmailTo with the backup email that Zapier should send the full lead to.
   3) In Zapier, map `email_backup_subject`, `email_backup_body` and `backup_email_to` to an Email action.
   Do not set custom headers/content-type in the request. The form is sent as FormData.
*/
const FORM_DEFAULT_CONFIG = {
  zapierWebhookUrl: 'COLOCA_AQUI_TU_WEBHOOK_DE_ZAPIER',
  backupEmailTo: 'CAMBIAR_CORREO_DE_RESPALDO@DOMINIO.COM',
  thankYouPage: 'Gracias.dc.html',
  localBackupKey: 'labormx_pending_leads'
};
const FORM_CONFIG = Object.assign({}, FORM_DEFAULT_CONFIG, window.LABORMX_FORM_CONFIG || {});
const WEBHOOK_PLACEHOLDERS = new Set(['', 'COLOCA_AQUI_TU_WEBHOOK_DE_ZAPIER', 'https://hook.zapier.com/tu-webhook-aqui']);
const TRACKING_KEYS = [
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
  'gclid','fbclid','msclkid','ttclid','wbraid','gbraid'
];
const SYSTEM_FIELDS = [
  'event','lead_status','form_service','form_id','landing_name','page_title','page_url','page_path','referrer','initial_referrer',
  'submitted_at','user_agent','browser_language','site_language','timezone','backup_email_to','email_backup_subject',
  'email_backup_body','lead_payload_json','privacy_acceptance','privacy_accepted_at'
];

function getConfiguredWebhook(){
  const url = (FORM_CONFIG.zapierWebhookUrl || '').trim();
  return WEBHOOK_PLACEHOLDERS.has(url) ? '' : url;
}
function ensureHiddenInput(form, name){
  let input = form.querySelector(`input[type="hidden"][name="${name}"]`);
  if (!input) {
    input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    form.appendChild(input);
  }
  return input;
}
function captureTrackingParams(){
  const params = new URLSearchParams(window.location.search);
  TRACKING_KEYS.forEach(key => {
    const value = params.get(key);
    if (value) {
      try { localStorage.setItem(key, value); } catch (e) {}
    }
  });
  try {
    if (!localStorage.getItem('initial_referrer')) localStorage.setItem('initial_referrer', document.referrer || 'direct');
    if (!localStorage.getItem('first_landing_page')) localStorage.setItem('first_landing_page', location.href);
  } catch (e) {}
}
function populateTrackingFields(form){
  [...TRACKING_KEYS, ...SYSTEM_FIELDS].forEach(name => ensureHiddenInput(form, name));
  TRACKING_KEYS.forEach(key => {
    let value = '';
    try { value = localStorage.getItem(key) || ''; } catch (e) {}
    form.querySelectorAll(`input[name="${key}"]`).forEach(input => { input.value = value; });
  });
}
function fieldLabel(field){
  const aria = field.getAttribute('aria-label');
  if (aria) return aria;
  const placeholder = field.getAttribute('placeholder');
  if (placeholder) return placeholder;
  return field.name || field.id || 'campo';
}
function collectLeadPayload(form){
  populateTrackingFields(form);
  const svc = form.dataset.svc || 'general';
  const lang = document.documentElement.lang || 'es';
  const now = new Date().toISOString();
  const privacy = form.querySelector('input[type="checkbox"][required]');
  const firstNamedFields = Array.from(form.querySelectorAll('input,select,textarea'))
    .filter(field => field.name && field.type !== 'hidden' && field.type !== 'submit' && field.type !== 'button')
    .map(field => ({
      name: field.name,
      label: fieldLabel(field),
      value: field.type === 'checkbox' ? (field.checked ? 'Sí' : 'No') : field.value
    }));
  let initialReferrer = '';
  try { initialReferrer = localStorage.getItem('initial_referrer') || document.referrer || 'direct'; } catch (e) { initialReferrer = document.referrer || 'direct'; }
  const payload = {
    event: 'lead_created',
    lead_status: 'new',
    form_service: svc,
    form_id: form.getAttribute('id') || svc,
    landing_name: document.body.className || '',
    page_title: document.title,
    page_url: location.href,
    page_path: location.pathname,
    referrer: document.referrer || 'direct',
    initial_referrer: initialReferrer,
    submitted_at: now,
    user_agent: navigator.userAgent,
    browser_language: navigator.language || '',
    site_language: lang,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    backup_email_to: FORM_CONFIG.backupEmailTo,
    privacy_acceptance: privacy && privacy.checked ? 'accepted' : '',
    privacy_accepted_at: privacy && privacy.checked ? now : '',
    fields: firstNamedFields
  };
  TRACKING_KEYS.forEach(key => {
    try { payload[key] = localStorage.getItem(key) || ''; } catch (e) { payload[key] = ''; }
  });
  return payload;
}
function payloadToEmailBody(payload){
  const lines = [];
  lines.push('Nuevo lead LaborMX');
  lines.push('');
  lines.push(`Servicio/Formulario: ${payload.form_service}`);
  lines.push(`Fecha de envío: ${payload.submitted_at}`);
  lines.push(`Página: ${payload.page_url}`);
  lines.push(`Referidor: ${payload.referrer}`);
  lines.push(`Primer referidor: ${payload.initial_referrer}`);
  lines.push('');
  lines.push('Datos del formulario:');
  payload.fields.forEach(item => lines.push(`- ${item.label}: ${item.value}`));
  lines.push('');
  lines.push('Tracking:');
  TRACKING_KEYS.forEach(key => lines.push(`- ${key}: ${payload[key] || ''}`));
  lines.push(`- browser_language: ${payload.browser_language}`);
  lines.push(`- site_language: ${payload.site_language}`);
  lines.push(`- timezone: ${payload.timezone}`);
  lines.push(`- user_agent: ${payload.user_agent}`);
  return lines.join('\n');
}
function applyPayloadToFormData(form, payload){
  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'fields') return;
    const input = ensureHiddenInput(form, key);
    input.value = String(value ?? '');
  });
  const subject = `Nuevo lead LaborMX · ${payload.form_service}`;
  const body = payloadToEmailBody(payload);
  ensureHiddenInput(form, 'email_backup_subject').value = subject;
  ensureHiddenInput(form, 'email_backup_body').value = body;
  ensureHiddenInput(form, 'lead_payload_json').value = JSON.stringify(payload);
  ensureHiddenInput(form, 'backup_email_to').value = FORM_CONFIG.backupEmailTo;
  return new FormData(form);
}
function saveLocalLeadBackup(payload){
  try {
    const list = JSON.parse(localStorage.getItem(FORM_CONFIG.localBackupKey) || '[]');
    list.push(payload);
    localStorage.setItem(FORM_CONFIG.localBackupKey, JSON.stringify(list.slice(-25)));
  } catch (e) {}
}
function setFormSubmitting(form, on){
  form.classList.toggle('is-submitting', on);
  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = on;
  let status = form.querySelector('[data-form-status]');
  if (!status) {
    status = document.createElement('div');
    status.setAttribute('data-form-status', '');
    form.appendChild(status);
  }
  status.textContent = on ? 'Enviando…' : '';
}
async function postToZapier(formData){
  const webhookUrl = getConfiguredWebhook();
  if (!webhookUrl) return { ok: true, skipped: true };
  try {
    const response = await fetch(webhookUrl, { method: 'POST', body: formData, keepalive: true });
    if (response && (response.ok || response.type === 'opaque')) return { ok: true };
    throw new Error('Webhook response not ok');
  } catch (err) {
    if (navigator.sendBeacon && navigator.sendBeacon(webhookUrl, formData)) return { ok: true, beacon: true };
    throw err;
  }
}
function redirectToThankYou(svc){
  const lang = document.documentElement.lang || 'es';
  const base = FORM_CONFIG.thankYouPage || 'Gracias.dc.html';
  location.href = `${base}?svc=${encodeURIComponent(svc || 'general')}&lang=${encodeURIComponent(lang)}`;
}


/* ---------- 1. CUSTOM CURSOR ---------- */
function initCursor() {
  if (coarse || reduceMotion) return;
  const dot = $('.cursor-dot'), fol = $('.cursor-follower');
  if (!dot || !fol) return;
  document.body.style.cursor = 'none';
  let mx = innerWidth / 2, my = innerHeight / 2, fx = mx, fy = my, dx = mx, dy = my;
  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
  (function loop() {
    dx = lerp(dx, mx, 0.35); dy = lerp(dy, my, 0.35);
    fx = lerp(fx, mx, 0.14); fy = lerp(fy, my, 0.14);
    dot.style.transform = `translate3d(${dx}px,${dy}px,0) translate(-50%,-50%)`;
    fol.style.transform = `translate3d(${fx}px,${fy}px,0) translate(-50%,-50%)`;
    requestAnimationFrame(loop);
  })();
  const hov = 'a,button,.cursor-target,[data-faq],input,select,textarea,label';
  document.addEventListener('mouseover', e => { if (e.target.closest(hov)) document.body.classList.add('cursor-active'); });
  document.addEventListener('mouseout',  e => { if (e.target.closest(hov)) document.body.classList.remove('cursor-active'); });
  addEventListener('mousedown', () => document.body.classList.add('cursor-down'));
  addEventListener('mouseup',   () => document.body.classList.remove('cursor-down'));
}

/* ---------- 2. SCROLL PROGRESS ---------- */
function initProgress() {
  const bar = $('.scroll-progress');
  if (!bar) return;
  const upd = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + '%';
  };
  addEventListener('scroll', upd, { passive: true });
  addEventListener('resize', upd); upd();
}

/* ---------- 3. NAVBAR SCROLL STATE ---------- */
function initNavbar() {
  const nav = $('[data-nav]');
  if (!nav) return;
  const upd = () => nav.classList.toggle('is-scrolled', scrollY > 24);
  addEventListener('scroll', upd, { passive: true }); upd();
  // smooth anchor scroll
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const t = $(id);
    if (t) { e.preventDefault(); window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 78, behavior: reduceMotion ? 'auto' : 'smooth' }); }
  });
  // mobile menu
  const burger = $('[data-burger]'), menu = $('[data-mobile-menu]');
  if (burger && menu) {
    const close = () => { menu.classList.remove('open'); burger.classList.remove('open'); document.body.style.overflow = ''; };
    burger.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      burger.classList.toggle('open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });
    menu.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  }
}

/* ---------- 4/5/6. REVEAL + SPLIT + COUNTERS via one IntersectionObserver ---------- */
function show(el) {
  el.style.opacity = '1';
  el.style.transform = 'none';
  el.style.filter = 'none';
}
function revealEl(el) {
  if (el.dataset.revealed) return;
  el.dataset.revealed = '1';
  el.classList.add('is-visible');
  requestAnimationFrame(() => {
    if (el.classList.contains('split-title')) {
      show(el);
      $$('.line', el).forEach(show);
    } else {
      show(el);
    }
    if (el.classList.contains('counter')) animateCount(el);
    $$('.counter', el).forEach(animateCount);
  });
}
function animateCount(el) {
  if (el.dataset.counted) return; el.dataset.counted = '1';
  const target = parseFloat(el.dataset.count || '0');
  const suffix = el.dataset.suffix || '';
  const prefix = el.dataset.prefix || '';
  const dur = 1300, t0 = performance.now();
  const dec = (el.dataset.count || '').includes('.') ? 1 : 0;
  const final = () => { el.textContent = prefix + target.toLocaleString('en-US', { maximumFractionDigits: dec }) + suffix; };
  if (reduceMotion) { final(); return; }
  // fallback in case rAF is throttled/frozen: guarantee the final value shows
  const fb = setTimeout(final, 1500);
  (function step(now) {
    if (Math.min(1,(now-t0)/dur) >= 1) clearTimeout(fb);
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const v = target * e;
    el.textContent = prefix + (dec ? v.toFixed(1) : Math.round(v).toLocaleString('en-US')) + suffix;
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}
function initReveal() {
  const items = $$('.reveal, .split-title, .fade-up, .counter');
  if (!items.length) return;
  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach(revealEl);
    $$('.ri').forEach(show);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        revealEl(entry.target);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  items.forEach(el => io.observe(el));
  // Safety: never leave text hidden if a browser throttles observers.
  setTimeout(() => items.forEach(el => { if (!el.dataset.revealed) revealEl(el); }), 1400);
}

/* ---------- 7. PARALLAX / TILT ---------- */
function initParallax() {
  if (reduceMotion) return;
  const scrollEls = $$('[data-parallax]');
  if (scrollEls.length) {
    const upd = () => scrollEls.forEach(el => {
      const f = parseFloat(el.dataset.parallax) || 0.08;
      const r = el.getBoundingClientRect();
      const off = (r.top + r.height / 2 - innerHeight / 2);
      el.style.transform = `translate3d(0,${(-off * f).toFixed(1)}px,0)`;
    });
    addEventListener('scroll', upd, { passive: true }); upd();
  }
  if (!coarse) {
    const tilts = $$('[data-tilt]');
    tilts.forEach(el => {
      const wrap = el.closest('[data-tilt-area]') || el.parentElement;
      wrap.addEventListener('mousemove', e => {
        const r = wrap.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(1100px) rotateY(${px * 7}deg) rotateX(${-py * 7}deg) translate3d(${px*8}px,${py*8}px,0)`;
      });
      wrap.addEventListener('mouseleave', () => { el.style.transform = 'perspective(1100px) rotateY(0) rotateX(0)'; });
    });
  }
}

/* ---------- 8. CANVAS PARTICLES ---------- */
function initParticles(canvas) {
  if (reduceMotion) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const color = canvas.dataset.color || '61,125,255';
  let w, h, parts;
  function size() {
    w = canvas.offsetWidth; h = canvas.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(46, Math.round(w * h / 26000));
    parts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 1.6 + 0.6, a: Math.random() * 0.4 + 0.12
    }));
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fillStyle = `rgba(${color},${p.a})`; ctx.fill();
      for (let j = i + 1; j < parts.length; j++) {
        const q = parts[j], dx = p.x - q.x, dy = p.y - q.y, d = dx*dx + dy*dy;
        if (d < 11000) {
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(${color},${0.07 * (1 - d/11000)})`; ctx.lineWidth = 1; ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  size(); addEventListener('resize', size); draw();
}

/* ---------- 9. MARQUEE (reduced-motion guard) ---------- */
function initMarquee() {
  if (!reduceMotion) return;
  $$('.marquee-track').forEach(t => { t.style.animation = 'none'; });
}

/* ---------- 10. FAQ ACCORDION ---------- */
function initFAQ() {
  $$('[data-faq]').forEach((btn, i) => {
    const panel = btn.nextElementSibling;
    const open = (on) => {
      btn.classList.toggle('active', on);
      panel.style.maxHeight = on ? panel.scrollHeight + 'px' : '0px';
      panel.style.opacity = on ? '1' : '0';
      btn.setAttribute('aria-expanded', on);
    };
    if (btn.dataset.open === '1') requestAnimationFrame(() => open(true));
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('active');
      $$('[data-faq]').forEach(b => { if (b !== btn) { b.classList.remove('active'); b.nextElementSibling.style.maxHeight = '0px'; b.nextElementSibling.style.opacity = '0'; b.setAttribute('aria-expanded','false'); } });
      open(on);
    });
  });
}

/* ---------- 11. FLOATING CTA ---------- */
function initFloatingCTA() {
  const cta = $('[data-floating-cta]');
  if (!cta) return;
  const upd = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    const p = h > 0 ? scrollY / h : 0;
    cta.classList.toggle('show', p > 0.55 && p < 0.97);
  };
  addEventListener('scroll', upd, { passive: true }); upd();
}

/* ---------- 12. LEAD FORM → ZAPIER WEBHOOK → THANK YOU PAGE ---------- */
function initForm() {
  captureTrackingParams();
  $$('form[data-lead-form]').forEach(form => {
    populateTrackingFields(form);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const svc = form.dataset.svc || 'general';
      const flash = $('[data-thankyou-flash]');
      const payload = collectLeadPayload(form);
      const formData = applyPayloadToFormData(form, payload);
      setFormSubmitting(form, true);
      if (flash && !reduceMotion) flash.classList.add('show');
      try {
        await postToZapier(formData);
      } catch (error) {
        payload.webhook_error = error && error.message ? error.message : 'Webhook error';
        saveLocalLeadBackup(payload);
        console.error('LaborMX form webhook error:', error);
      } finally {
        setTimeout(() => redirectToThankYou(svc), flash && !reduceMotion ? 650 : 0);
      }
    });
  });
}

/* ---------- 13. i18n (ES default · EN toggle · auto-detect) ---------- */
function applyLang(lang) {
  const en = lang === 'en';
  document.documentElement.lang = lang;
  $$('[data-en]').forEach(el => {
    if (el.dataset.es === undefined) el.dataset.es = el.textContent;
    el.textContent = en ? el.dataset.en : el.dataset.es;
  });
  $$('[data-en-html]').forEach(el => {
    if (el.dataset.esHtml === undefined) el.dataset.esHtml = el.innerHTML;
    el.innerHTML = en ? el.dataset.enHtml : el.dataset.esHtml;
  });
  $$('[data-en-ph]').forEach(el => {
    if (el.dataset.esPh === undefined) el.dataset.esPh = el.getAttribute('placeholder') || '';
    el.setAttribute('placeholder', en ? el.dataset.enPh : el.dataset.esPh);
  });
  $$('[data-lang-toggle] [data-lang-label]').forEach(l => l.textContent = en ? 'EN' : 'ES');
  $$('[data-lang-opt]').forEach(o => o.classList.toggle('on', o.dataset.langOpt === lang));
  try { localStorage.setItem('labor_lang', lang); } catch (e) {}
}
function detectLang() {
  try { const s = localStorage.getItem('labor_lang'); if (s) return s; } catch (e) {}
  const url = new URLSearchParams(location.search).get('lang');
  if (url === 'en' || url === 'es') return url;
  const n = (navigator.language || 'es').toLowerCase();
  return n.startsWith('es') ? 'es' : 'en';
}
function initLang() {
  applyLang(detectLang());
  $$('[data-lang-toggle]').forEach(t => t.addEventListener('click', () => {
    applyLang(document.documentElement.lang === 'es' ? 'en' : 'es');
  }));
}





/* ---------- 13B. STAFFING SERVICE TABS ---------- */
function initTabs() {
  const buttons = $$('[data-tab-btn]');
  const panels = $$('[data-tab-panel]');
  if (!buttons.length || !panels.length) return;
  const setActive = (id) => {
    buttons.forEach(btn => {
      const on = btn.dataset.tabBtn === id;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.style.background = on ? '#16234d' : '#fff';
      btn.style.color = on ? '#fff' : '#16234d';
      btn.style.borderColor = on ? '#16234d' : '#dde2ee';
    });
    panels.forEach(panel => {
      const on = panel.dataset.tabPanel === id;
      panel.classList.toggle('on', on);
      panel.hidden = !on;
      panel.style.display = on ? 'block' : 'none';
    });
  };
  buttons.forEach(btn => {
    btn.setAttribute('role','tab');
    btn.addEventListener('click', () => setActive(btn.dataset.tabBtn));
  });
  panels.forEach(panel => panel.setAttribute('role','tabpanel'));
  const initial = (buttons.find(btn => btn.classList.contains('on')) || buttons[0]).dataset.tabBtn;
  setActive(initial);
}

/* ---------- 14. BRAND PIPELINE ANIMATION ---------- */
function initPipelines(){
  $$('.icon-pipeline').forEach((pipeline, idx)=>{
    const nodeStack = $('.pipeline-node-stack', pipeline);
    const nodeX = $('.pipeline-node-center', pipeline);
    const nodeShield = $('.pipeline-node-shield', pipeline);
    const gradient = $('.beam-gradient', pipeline);
    const paths = $$('.beam-path', pipeline);
    const splash = $('.splash', pipeline);
    if(!nodeStack || !nodeX || !nodeShield || !gradient || !paths.length) return;

    // Make SVG ids unique so multiple landing sections can coexist safely.
    const svg = $('.beam-svg', pipeline);
    const unique = `beam-${idx}-${Math.random().toString(36).slice(2,7)}`;
    const glow = svg?.querySelector('#glow');
    const grad = svg?.querySelector('#beam-gradient');
    if(glow) glow.id = `${unique}-glow`;
    if(grad){ grad.id = `${unique}-gradient`; paths.forEach(p => p.setAttribute('stroke', `url(#${unique}-gradient)`)); }
    paths.forEach(p => { if(p.hasAttribute('filter')) p.setAttribute('filter', `url(#${unique}-glow)`); });

    function updatePath(){
      const pRect = pipeline.getBoundingClientRect();
      const sRect = nodeStack.getBoundingClientRect();
      const xRect = nodeX.getBoundingClientRect();
      const shRect = nodeShield.getBoundingClientRect();
      const startX = sRect.left + sRect.width/2 - pRect.left;
      const startY = sRect.top + sRect.height/2 - pRect.top;
      const midX = xRect.left + xRect.width/2 - pRect.left;
      const midY = xRect.top + xRect.height/2 - pRect.top;
      const endX = shRect.left + shRect.width/2 - pRect.left;
      const endY = shRect.top + shRect.height/2 - pRect.top;
      const d = `M ${startX},${startY} L ${midX},${midY} L ${endX},${endY}`;
      paths.forEach(path => path.setAttribute('d', d));
    }
    updatePath(); addEventListener('resize', updatePath, {passive:true});

    let state='p1'; let last=performance.now();
    function setBeam(on){ paths.forEach(path => path.style.opacity = on ? (path.classList.contains('beam-glow-path') ? '.6' : '1') : '0'); }
    function tick(now){
      const elapsed = now - last;
      let percentage = 0;
      if(state === 'p1'){
        const p = Math.min(elapsed/800,1); percentage = p * .5;
        nodeStack.classList.toggle('active', p < .4); nodeShield.classList.remove('active');
        if(p >= 1){ state='splash'; last=now; setBeam(false); nodeStack.classList.remove('active'); splash?.classList.add('animate'); }
      } else if(state === 'splash'){
        percentage = .5;
        if(elapsed >= 800){ state='p2'; last=now; splash?.classList.remove('animate'); setBeam(true); }
      } else if(state === 'p2'){
        const p = Math.min(elapsed/800,1); percentage = .5 + p * .5;
        nodeShield.classList.toggle('active', p > .6);
        if(p >= 1){ state='idle'; last=now; nodeShield.classList.remove('active'); }
      } else {
        percentage = 1;
        if(elapsed >= 1000){ state='p1'; last=now; setBeam(true); }
      }
      const center = percentage * 100; const halfWidth = 5;
      gradient.setAttribute('x1', `${center - halfWidth}%`);
      gradient.setAttribute('x2', `${center + halfWidth}%`);
      gradient.setAttribute('y1','0%'); gradient.setAttribute('y2','0%');
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

/* ---------- boot ---------- */
export function init(opts = {}) {
  initLang();
  initCursor();
  initProgress();
  initNavbar();
  initReveal();
  initParallax();
  initMarquee();
  initFAQ();
  initTabs();
  initFloatingCTA();
  initForm();
  $$('canvas[data-particles]').forEach(initParticles);
  initPipelines();
}
export { initParticles };


/* LaborMX_AUTO_INIT: direct static HTML boot. */
if (typeof window !== 'undefined') {
  const runLaborMX = () => { if (!window.__laborMXBooted) { window.__laborMXBooted = true; init(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runLaborMX, { once: true });
  else queueMicrotask(runLaborMX);
}

/* ---------- 17. SEAMLESS LOGO MARQUEE ---------- */
function initLogoMarquees(){
  document.querySelectorAll('.client-logo-carousel .logo-track').forEach(track => {
    if (track.dataset.seamlessReady === '1') return;
    const originalItems = Array.from(track.children).filter(el => el.tagName && el.tagName.toLowerCase() === 'img');
    if (!originalItems.length) return;
    track.innerHTML = '';
    const makeSequence = (clone) => {
      const seq = document.createElement('div');
      seq.className = 'logo-sequence';
      if (clone) seq.setAttribute('aria-hidden','true');
      originalItems.forEach(item => {
        const img = item.cloneNode(true);
        img.removeAttribute('style');
        img.loading = 'eager';
        img.decoding = 'async';
        seq.appendChild(img);
      });
      return seq;
    };
    track.appendChild(makeSequence(false));
    track.appendChild(makeSequence(true));
    track.dataset.seamlessReady = '1';
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLogoMarquees);
} else {
  initLogoMarquees();
}
