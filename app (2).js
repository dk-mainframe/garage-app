/* Garage Assistant · phone app (fill-ups, services, tires, to-dos, vehicles, settings, scanning, voice, photos, stats).
   Talks to the Apps Script back end inside your Google Sheet. Nothing is stored on the phone except
   your app link, app key, which vehicle you used last, and any saves waiting for a connection. */
(function () {
  'use strict';

  const $app = document.getElementById('app');
  const store = {
    get(k) { try { return localStorage.getItem('garage.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('garage.' + k, v); } catch (e) { /* private mode */ } }
  };
  const state = {
    api: store.get('api') || '', key: store.get('key') || '',
    data: null, vehicle: store.get('vehicle') || '', entry: null, warnings: [], result: null, busy: false,
    newCar: null, review: null, editing: null, svc: null, tireForm: null, savedKind: 'fuel'
  };
  const offlineErr = err => err.message === 'Failed to fetch' || err.name === 'TypeError' || err.name === 'Timeout' || !navigator.onLine;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* Saves made without a connection wait here and are sent automatically later. Each has an id,
     so a save that gets sent twice is still only logged once. */
  const queue = {
    all() { try { return JSON.parse(store.get('queue') || '[]'); } catch (e) { return []; } },
    put(list) { try { localStorage.setItem('garage.queue', JSON.stringify(list)); return true; } catch (e) { return false; } },
    add(item) {
      const l = queue.all(); l.push(item);
      if (queue.put(l)) return;
      // Phone storage is full (photos are big): keep the numbers, drop the attached photo.
      item.data.photo = null; queue.put(l); toast('Saved without the photo; there wasn’t room to hold it offline.');
    },
    drop(id) { queue.put(queue.all().filter(x => x.data.clientId !== id)); }
  };
  let flushing = false;
  async function flushQueue() {
    if (flushing || !state.api) return;
    const items = queue.all();
    if (!items.length) return;
    flushing = true;
    let sent = 0, merged = 0;
    try {
      for (const item of items) {
        try {
          let r = await api(item.action, item.data);
          if (r && r.needsMerge) { item.data.mergeRow = 'new'; r = await api(item.action, item.data); merged++; }
          queue.drop(item.data.clientId); sent++;
        }
        catch (err) { if (offlineErr(err)) break; queue.drop(item.data.clientId); toast('A saved entry couldn’t sync: ' + err.message); }
      }
    } finally { flushing = false; }
    if (sent) { confirmBanner(sent + ' waiting save' + (sent === 1 ? '' : 's') + ' sent', merged ? 'A visit was already logged that day, so one was saved as a separate visit. Fix it in the Sheet if needed.' : undefined); if (current === 'home') load(); }
  }
  window.addEventListener('online', flushQueue);
  /** Sends a save; if there's no connection, keeps it on the phone for later. */
  async function saveOrQueue(btn, action, data) {
    data.clientId = data.clientId || newId();
    if (state.busy) return null;
    state.busy = true;
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try { return await api(action, data); }
    catch (err) {
      if (offlineErr(err)) {
        queue.add({ action: action, data: data });
        return { offline: true, undoId: data.clientId };
      }
      failBanner(err.message); return null;
    } finally { state.busy = false; if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = old; } }
  }

  /* ---------- small helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const num = v => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return v === '' || v == null || isNaN(n) ? null : n; };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const shortDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const vehicle = () => state.data.vehicles.find(v => v.name === state.vehicle) || state.data.vehicles[0];
  const isTruck = v => String(v.drive) === '4x4' || /f-?150|f-?250|truck|pickup|silverado|ram|tacoma|tundra|sierra|ranger|colorado/i.test(v.name + ' ' + (v.model || ''));
  const shortName = name => String(name).replace(/^\d{4}\s+/, '').split(/\s+/)[0] || name;
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const appliesTo = (rule, drive) => !rule || rule === 'All' || rule.split(',').map(x => x.trim().toLowerCase()).indexOf(String(drive).toLowerCase()) >= 0;

  const svg = (d, opts) => {
    const o = Object.assign({ size: 22, stroke: 'currentColor', w: 1.9 }, opts || {});
    return '<svg aria-hidden="true" width="' + o.size + '" height="' + o.size + '" viewBox="0 0 24 24" fill="none" stroke="' + o.stroke +
      '" stroke-width="' + o.w + '" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  };
  const I = {
    back: '<path d="M15 18l-6-6 6-6"></path>',
    arrow: '<path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path>',
    chev: '<path d="M9 6l6 6-6 6"></path>',
    gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path>',
    pump: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"></path><path d="M3 21h13"></path><path d="M7 7h5v4H7z"></path><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"></path>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"></path>',
    scan: '<path d="M3 8V6a3 3 0 0 1 3-3h2"></path><path d="M16 3h2a3 3 0 0 1 3 3v2"></path><path d="M21 16v2a3 3 0 0 1-3 3h-2"></path><path d="M8 21H6a3 3 0 0 1-3-3v-2"></path><path d="M8 9h8"></path><path d="M8 12h8"></path><path d="M8 15h5"></path>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"></path>',
    alert: '<path d="M12 3l10 18H2z"></path><path d="M12 10v4"></path><path d="M12 17.5h.01"></path>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path>',
    list: '<rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="M8.5 12l2.5 2.5 4.5-5"></path>',
    tire: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="3.5"></circle><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"></path>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18z"></path><path d="M3 3l18 18"></path>',
    q: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5"></path><path d="M12 17h.01"></path>',
    car: '<path d="M5 16H3v-3.5L5 9h9l3.5 3.5H20a1 1 0 0 1 1 1V16h-2"></path><path d="M9 16h6"></path><circle cx="7" cy="16" r="2"></circle><circle cx="17" cy="16" r="2"></circle>',
    truck: '<path d="M5 16H2v-5h9V7h5l3 4h2a1 1 0 0 1 1 1v4h-2"></path><path d="M9 16h6"></path><path d="M11 11h8"></path><circle cx="7" cy="16" r="2"></circle><circle cx="17" cy="16" r="2"></circle>'
  };
  const vIcon = (v, size) => svg(isTruck(v) ? I.truck : I.car, { size: size || 20, w: 1.7 });

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
  }

  /* Every request gets a deadline, so a button never just sits on "Saving…". Reading photos or voice gets longer. */
  const SLOW = { scanFuel: 1, scanService: 1, voice: 1 };
  /** Green check banner: stays until tapped, so a save is never in doubt. */
  function confirmBanner(title, sub) {
    const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    banner('ok', title, sub || 'Synced to your Sheet · ' + now);
  }
  function failBanner(msg, retry) { banner('fail', 'Didn’t go through', msg, retry); }
  let shown = null; // the banner stays at the top of every screen until tapped
  function banner(kind, title, sub, retry) { shown = { kind: kind, title: title, sub: sub, retry: retry }; placeBanner(); }
  function placeBanner() {
    document.querySelectorAll('.banner').forEach(b => b.remove());
    const host = $app.querySelector('.screen');
    if (!shown || !host) return;
    const x = shown, b = document.createElement('div');
    b.className = 'banner ' + x.kind; b.setAttribute('role', x.kind === 'ok' ? 'status' : 'alert');
    b.innerHTML = '<span class="bicon">' + svg(x.kind === 'ok' ? I.check : I.alert, { size: 20, stroke: '#000', w: 2.6 }) + '</span>' +
      '<span class="grow"><b>' + esc(x.title) + '</b><span>' + esc(x.sub) + '</span></span>' +
      (x.retry ? '<button class="mini" data-retry style="border-color:var(--red);color:var(--red)">Try again</button>' : '') +
      '<button class="bclose" aria-label="Dismiss">' + svg('<path d="M6 6l12 12M18 6L6 18"></path>', { size: 18, w: 2 }) + '</button>';
    b.addEventListener('click', e => { const rt = e.target.closest('[data-retry]'); shown = null; b.remove(); if (rt && x.retry) x.retry(); });
    host.insertBefore(b, host.firstChild);
  }

  async function api(action, data) {
    const ctl = new AbortController(), secs = SLOW[action] ? 60 : 20;
    const timer = setTimeout(() => ctl.abort(), secs * 1000);
    let res;
    try {
      res = await fetch(state.api, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctl.signal,
        body: JSON.stringify({ key: state.key, action: action, data: data || null })
      });
    } catch (err) {
      if (err.name === 'AbortError') { const t = new Error('No reply from your Sheet after ' + secs + ' seconds, so it didn’t go through.'); t.name = 'Timeout'; throw t; }
      throw err;
    } finally { clearTimeout(timer); }
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  }
  /** Runs a request that returns fresh Home data, with the button showing progress. */
  async function busy(btn, label, fn) {
    if (state.busy) return null;
    state.busy = true;
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = label; }
    let ok = false;
    try { const r = await fn(); ok = true; return r; }
    catch (err) {
      failBanner(err.message === 'Failed to fetch' ? 'No connection, so it didn’t go through.' : err.message, () => {
        // Retry by pressing the same button, so the whole save (and its confirmation) runs again.
        if (btn && document.body.contains(btn)) btn.click();
        else busy(null, label, fn).then(r => { if (r) confirmBanner('Done'); });
      });
      return null;
    }
    finally {
      state.busy = false;
      if (btn && document.body.contains(btn)) {
        btn.disabled = false;
        if (ok && old) { btn.textContent = 'Saved ✓'; btn.classList.add('ok'); setTimeout(() => { if (document.body.contains(btn)) { btn.textContent = old; btn.classList.remove('ok'); } }, 2500); }
        else btn.textContent = old;
      }
    }
  }
  function adopt(home) {
    if (!home || !home.vehicles) return;
    state.data = home; state.stats = null;
    if (!home.vehicles.some(v => v.name === state.vehicle)) state.vehicle = home.vehicles[0].name;
  }

  /* Each screen is a function that returns HTML; go() draws it and wires its buttons. */
  let current = 'home';
  function go(name) {
    if (name === 'todo' && current !== 'todo') state.todoFrom = current === 'home' ? 'home' : 'all';
    current = name; render(); window.scrollTo(0, 0);
  }
  /* Back (arrow or swipe). On a form with something entered, asks first so a mis-tap doesn't lose it. */
  const dirty = {
    manual: () => { const e = state.entry; return !!e && (e.odometer != null || e.gallons != null || e.total != null || !!e.photo || (e.photoUrls || []).length > 0); },
    serviceManual: () => { const f = state.svc; return !!f && (f.picked.length > 0 || !!f.total || !!f.shop || !!f.notes || !!f.photo || (f.photoUrls || []).length > 0); },
    tires: () => { const f = state.tireForm; return !!f && !!(f.dot || f.cost || f.shop); },
    scanFuel: () => !!state.scan && !!(state.scan.receipt || state.scan.dash),
    scanService: () => !!state.scan && (state.scan.pages || []).length > 0,
    addVehicle: () => { const n = state.newCar; return !!n && !!(n.name || n.make || n.model); }
  };
  function back(to) {
    if (dirty[current] && dirty[current]()) {
      const scanned = /^scan/.test(current) || (current === 'manual' && (state.entry.photoUrls || []).length) || (current === 'serviceManual' && (state.svc.photoUrls || []).length);
      if (!window.confirm('Discard this entry?' + (scanned ? ' Photos already saved stay in your Garage Log.' : ''))) return;
      if (current === 'manual') state.entry = null;
      if (current === 'serviceManual') state.svc = null;
      if (current === 'tires') state.tireForm = null;
      if (/^scan/.test(current)) state.scan = null;
      if (current === 'addVehicle') state.newCar = null;
    }
    go(to);
  }
  // Swipe in from the left edge to go back, like other iPhone apps (the Home Screen app doesn't get Safari's gesture).
  (function () {
    let x0 = null, y0 = 0, dx = 0;
    document.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX <= 24 && $app.querySelector('[data-back]') ? t.clientX : null; y0 = t.clientY; dx = 0; }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (x0 == null) return;
      const t = e.touches[0]; dx = t.clientX - x0;
      if (Math.abs(t.clientY - y0) > 60) { x0 = null; $app.style.transform = ''; return; }
      $app.style.transform = dx > 0 ? 'translateX(' + Math.min(dx * 0.5, 120) + 'px)' : '';
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (x0 == null) return;
      x0 = null; $app.style.transition = 'transform .18s'; $app.style.transform = '';
      setTimeout(() => { $app.style.transition = ''; }, 200);
      const b = $app.querySelector('[data-back]');
      if (dx > 80 && b) b.click();
    });
  })();
  function render() {
    $app.innerHTML = screens[current]();
    $app.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => go(el.dataset.go)));
    $app.querySelectorAll('[data-back]').forEach(el => el.addEventListener('click', () => back(el.dataset.back)));
    (wire[current] || function () {})();
    placeBanner();
  }

  const header = (backTo, v, label) =>
    '<div class="row"><button class="iconbtn" aria-label="Back" data-back="' + backTo + '">' + svg(I.back) + '</button>' +
    (v ? '<div class="crumb">' + vIcon(v) + esc(v.name) + '</div>' : label ? '<div class="crumb">' + esc(label) + '</div>' : '') + '</div>';

  function switcher(d, v) {
    if (d.vehicles.length < 2) return '';
    const btn = x => '<button data-vehicle="' + esc(x.name) + '" aria-pressed="' + (x.name === v.name) + '">' + vIcon(x) + esc(d.vehicles.length > 3 ? x.name.replace(/^\d{4}\s+/, '') : shortName(x.name)) + '</button>';
    return d.vehicles.length <= 3
      ? '<div class="seg" role="group" aria-label="Vehicle">' + d.vehicles.map(btn).join('') + '</div>'
      : '<div class="chips" role="group" aria-label="Vehicle">' + d.vehicles.map(btn).join('') + '</div>';
  }

  /* ---------- screens ---------- */
  const screens = {
    setup() {
      const back = state.data ? header('settings', null, 'Settings') : '<div class="eyebrow">Garage</div>';
      return '<div class="screen">' + back + '<h1>Connect your Sheet</h1>' +
        '<div class="sub">Paste the two items from the setup guide. You only do this once on this phone.</div>' +
        '<div class="field small"><label for="api">App link (Web app URL)</label><input id="api" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(state.api) + '"></div>' +
        '<div class="field small"><label for="key">App key</label><input id="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="From the Apps Script log" value="' + esc(state.key) + '"></div>' +
        '<div class="grow"></div><button class="primary" id="connect">Connect</button></div>';
    },

    home() {
      const d = state.data, v = vehicle();
      const digits = String(Math.round(v.odometer || 0)).padStart(6, '0').split('');
      const oil = v.oil, ringColor = !oil ? 'var(--line)' : oil.status === 'Overdue' ? 'var(--red)' : oil.status === 'Due soon' ? 'var(--amber)' : 'var(--blue)';
      const top = v.attention.filter(i => i.status !== 'Needs baseline').slice(0, 4);
      return '<div class="screen">' +
        '<div class="between"><span class="eyebrow" style="padding-left:4px;display:flex;align-items:center;gap:10px">Garage' +
          (state.refreshing ? '<span class="updating" role="status">Updating…</span>' : '') + '</span>' +
          '<button class="iconbtn" aria-label="Settings" data-go="settings">' + svg(I.gear, { w: 1.8 }) + '</button></div>' +
        switcher(d, v) +
        '<button class="card between" data-go="stats" aria-label="Stats and trends" style="padding:14px 16px;border:0;width:100%;text-align:left;color:inherit"><span style="display:flex;flex-direction:column;gap:8px"><span class="eyebrow" style="font-size:11px">Odometer</span>' +
          '<span class="digits" aria-label="' + fmt(v.odometer || 0) + ' miles">' + digits.map((c, i) => '<span' + (i === digits.length - 1 ? ' class="lit"' : '') + '>' + c + '</span>').join('') +
          '<em style="font-style:normal;font-size:12px;color:var(--muted);margin-left:4px;padding-bottom:4px">mi</em></span></span>' +
          '<span style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><span><span style="font-size:22px;font-weight:600">' + (v.avgMpg != null ? v.avgMpg.toFixed(1) : '—') +
          '</span> <span style="font-size:12px;color:var(--muted)">avg mpg</span></span>' + sparkline(v.recentMpg) + '<span style="font-size:11px;color:var(--amber);font-weight:600">Stats ›</span></span></button>' +
        '<button class="big amber" data-go="fuel" style="gap:28px"><span class="well">' + svg(I.pump, { size: 30, stroke: '#000' }) + '</span>' +
          '<span class="between" style="align-items:flex-end"><span><span class="title" style="font-size:28px">Fuel Up</span>' +
          '<span class="desc" style="display:block">' + (v.lastFillDate ? 'Last fill-up ' + shortDate(v.lastFillDate) : 'No fill-ups yet') + '</span></span>' + svg(I.arrow, { size: 28, stroke: '#000', w: 2 }) + '</span></button>' +
        '<button class="bar" id="service"><span class="well">' + svg(I.wrench, { size: 26, stroke: 'var(--blue)' }) + '</span>' +
          '<span class="grow" style="font-size:22px;font-weight:700;letter-spacing:-.02em;text-align:left">Service</span>' + svg(I.arrow, { size: 24, stroke: 'var(--soft)', w: 2 }) + '</button>' +
        '<div class="card" style="padding:16px 16px 0;display:flex;flex-direction:column;gap:14px">' +
          '<div class="row" style="gap:16px">' + ring(oil, ringColor) +
          '<div class="grow" style="display:flex;flex-direction:column;gap:8px;min-width:0"><div class="between"><span style="font-size:14px;font-weight:600">Needs attention</span>' +
          (v.overdue ? '<span class="pill" style="background:var(--red);color:#000">' + v.overdue + '</span>' : '') + '</div>' +
          (top.length ? top.map(i => '<div class="line"><span>' + esc(i.service) + '</span><span class="' + (i.status === 'Overdue' ? 'over' : 'soon') + '">' + esc(i.label) + '</span></div>').join('')
            : v.attention.length
              ? '<div class="line"><span>' + v.attention.length + ' service' + (v.attention.length === 1 ? ' needs' : 's need') + ' info</span><span class="soon">Add in See all</span></div>'
              : '<div class="line"><span>All caught up</span><span></span></div>') + '</div></div>' +
          '<button class="link" data-go="all" style="border-top:1px solid var(--line);margin:0 -16px;width:calc(100% + 32px)">' +
          (v.attention.length ? 'See all ' + v.attention.length : 'See all services') + svg(I.chev, { size: 16, w: 2 }) + '</button></div>' +
        todoLine(v) + pendingLine() +
        '</div>';
    },

    service() {
      const v = vehicle();
      return '<div class="screen">' + header('home', v) +
        '<div style="padding:4px 4px 8px"><h1 style="font-size:34px">Service</h1><div class="sub" style="margin-top:6px">What got done?</div></div>' +
        '<button class="big blue" data-go="scanService"><span class="well">' + svg(I.scan, { size: 32, stroke: '#000' }) + '</span><span><span class="title">Scan invoice</span>' +
          '<span class="desc" style="display:block;color:#0D2347">Snap the shop invoice; it’s saved to your Garage Log</span></span></button>' +
        '<button class="big dark" id="talkSvc"><span class="well">' + svg(I.mic, { size: 30, stroke: 'var(--blue)' }) + '</span><span><span class="title">Talk it in</span>' +
          '<span class="desc" style="display:block">Say it: “Oil change and tire rotation at 100,040”</span></span></button>' +
        '<button class="bar" data-go="tires" style="height:64px"><span class="well" style="width:40px;height:40px">' + svg(I.tire, { size: 22, stroke: 'var(--blue)' }) + '</span>' +
          '<span class="grow" style="font-size:17px;font-weight:600;text-align:left">Replace tires</span>' + svg(I.chev, { size: 18, stroke: 'var(--soft)', w: 2 }) + '</button>' +
        '<div class="grow"></div><button class="link" data-go="serviceManual" style="color:var(--muted);text-decoration:underline;text-underline-offset:4px;font-weight:500;font-size:15px">Enter manually</button></div>';
    },

    serviceManual() {
      const v = vehicle(), f = state.svc || (state.svc = newSvc(v));
      const names = v.all.filter(i => i.kind !== 'tire').sort((a, b) => rankName(a) - rankName(b) || a.service.localeCompare(b.service)).map(i => i.service);
      const chip = n => { const on = f.picked.indexOf(n) >= 0;
        return '<button class="svc-chip" data-pick="' + esc(n) + '" aria-pressed="' + on + '" style="height:40px;padding:0 14px;border-radius:20px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;' +
          (on ? 'border:0;background:var(--blue);color:#000' : 'border:1px solid var(--line);background:transparent;color:var(--soft)') + '">' + (on ? svg(I.check, { size: 16, w: 2.6 }) : '') + esc(n) + '</button>'; };
      return '<div class="screen">' + header('service', v) + '<h1 style="padding:0 4px">' + (f.fromAI ? 'Look right?' : 'Log service') + '</h1>' +
        (f.fromAI ? '<div class="note">' + esc(f.fromAI) + '</div>' : '') +
        '<div class="group"><label class="gi"><span>Date</span><input id="sDate" type="date" value="' + esc(f.date) + '"></label>' +
          '<label class="gi"><span>Odometer</span><input class="n" id="sOdo" inputmode="numeric" value="' + esc(f.odometer) + '"></label></div>' +
        '<div class="section" style="color:var(--muted)">Services done</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px">' + names.map(chip).join('') +
          '<button data-go="tires" style="height:40px;padding:0 14px;border-radius:20px;border:1px dashed #4A4A52;background:transparent;color:var(--soft);font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px">' +
          svg(I.tire, { size: 16, w: 2 }) + 'New tires</button></div>' +
        (f.picked.length ? '<div class="section" style="color:var(--muted)">Cost (optional)</div><div class="group">' +
          f.picked.map(n => '<label class="gi"><span>' + esc(n) + '</span><input class="n" data-cost="' + esc(n) + '" inputmode="decimal" placeholder="$" value="' + esc(f.costs[n] != null ? f.costs[n] : '') + '"></label>').join('') + '</div>' : '') +
        '<div class="between" style="padding:6px 6px 0"><span class="section" style="color:var(--muted);padding:0">Other work</span>' +
          '<button class="mini" id="addOther" style="color:var(--blue);border-color:var(--blue)">' + svg(I.plus, { size: 14, w: 2.4 }) + ' Add</button></div>' +
        (f.other.length ? '<div class="group">' + f.other.map((o, i) => '<div class="gi" style="flex-wrap:wrap;gap:8px;padding:10px 0">' +
            '<input data-otitle="' + i + '" aria-label="Work done" placeholder="e.g. Wheel bearing" value="' + esc(o.title) + '" style="width:100%">' +
            '<span style="display:flex;gap:8px;align-items:center;margin-left:auto">' +
            '<input class="n" data-oprice="' + i + '" aria-label="Price" inputmode="decimal" placeholder="$" value="' + esc(o.price != null ? o.price : '') + '">' +
            '<button class="xbtn" data-odel="' + i + '" aria-label="Remove ' + esc(o.title || 'line') + '">' + svg('<path d="M6 6l12 12M18 6L6 18"></path>', { size: 16, w: 2 }) + '</button></span></div>').join('') + '</div>'
          : '<div class="note">Repairs and charges that aren’t on the reminder list, like a wheel bearing or diagnostic fee.</div>') +
        (f.picked.length || f.other.length ? '<div class="group"><label class="gi"><span style="font-weight:600;color:var(--text)">Total paid</span><input class="n" id="sTotal" inputmode="decimal" placeholder="$" value="' + esc(f.total) + '"></label></div>' +
          totalNote(f) : '') +
        declinedBlock(f) +
        '<div class="group"><label class="gi"><span>Shop</span><input id="sShop" style="width:60%" placeholder="Optional" value="' + esc(f.shop) + '"></label>' +
          '<label class="gi"><span>Notes</span><input id="sNotes" style="width:60%" placeholder="Optional" value="' + esc(f.notes) + '"></label></div>' +
        photoRow(f, 'var(--blue)') +
        '<div class="grow"></div>' + sayBar('service', 'Missed something? Say it', '“They also did wipers, 32 dollars”', 'var(--blue)') +
        (f.mergeOffer ? mergeCard(f.mergeOffer, svcTotal(f))
          : '<button class="primary" id="saveService" style="background:var(--blue);box-shadow:0 10px 36px rgba(125,179,255,.32)">Save service</button>') + '</div>';
    },

    tires() {
      const v = vehicle(), f = state.tireForm || (state.tireForm = { picked: ['Tire 1', 'Tire 2', 'Tire 3', 'Tire 4'], date: today(), odometer: v.odometer || '', dot: '', cost: '', shop: '' });
      const awd = /awd|4x4/i.test(v.drive || '');
      return '<div class="screen">' + header('service', v) + '<h1 style="padding:0 4px">Replace tires</h1>' +
        '<div class="section" style="color:var(--muted)">Which ones</div><div class="group">' +
          ['Tire 1', 'Tire 2', 'Tire 3', 'Tire 4', 'Spare'].map(t => '<label class="gi"><span>' + t + '</span><span class="switch"><input type="checkbox" data-tire="' + t + '"' +
            (f.picked.indexOf(t) >= 0 ? ' checked' : '') + ' aria-label="' + t + '"><span></span></span></label>').join('') + '</div>' +
        (awd ? '<div class="tip" style="padding:0 6px">On AWD or 4x4, replace all four together, or match tread depth closely to protect the drivetrain.</div>' : '') +
        '<div class="group"><label class="gi"><span>Date</span><input id="tDate" type="date" value="' + esc(f.date) + '"></label>' +
          '<label class="gi"><span>Odometer</span><input class="n" id="tOdo" inputmode="numeric" value="' + esc(f.odometer) + '"></label>' +
          '<label class="gi"><span>DOT date code</span><input class="n" id="tDot" inputmode="numeric" maxlength="4" placeholder="e.g. 2324" value="' + esc(f.dot) + '"></label>' +
          '<label class="gi"><span>Total cost</span><input class="n" id="tCost" inputmode="decimal" placeholder="$" value="' + esc(f.cost) + '"></label>' +
          '<label class="gi"><span>Shop</span><input id="tShop" style="width:55%" placeholder="Optional" value="' + esc(f.shop) + '"></label></div>' +
        '<div class="note">The DOT date code is the last 4 digits on the sidewall (week and year made). It makes the 6-year age check exact. Optional.</div>' +
        '<div class="grow"></div><button class="primary" id="saveTires" style="background:var(--blue);box-shadow:0 10px 36px rgba(125,179,255,.32)">Save tires</button></div>';
    },

    todo() {
      const d = state.data, v = vehicle(), t = d.todo || { tasks: [], shop: [] };
      const mine = x => !x.vehicle || x.vehicle === 'Both' || x.vehicle === v.name;
      const tasks = t.tasks.filter(mine).sort((a, b) => a.done - b.done), shop = t.shop.filter(mine);
      const box = on => '<span style="width:22px;height:22px;border-radius:7px;flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
        (on ? 'background:var(--blue)' : 'border:2px solid #6E6E76') + '">' + (on ? svg(I.check, { size: 14, stroke: '#000', w: 3 }) : '') + '</span>';
      return '<div class="screen">' + header(state.todoFrom || 'all', v) + '<h1 style="padding:0 4px">To-do</h1>' +
        '<div class="between" style="padding:4px 6px 0"><span class="eyebrow" style="font-size:11px;color:var(--blue)">One-time tasks</span><span style="font-size:12px;color:var(--muted)">' + tasks.filter(x => !x.done).length + ' open</span></div>' +
        '<div class="card" style="display:flex;flex-direction:column">' + (tasks.length ? tasks.map(x =>
          '<button class="itembtn" data-task="' + x.row + '" aria-pressed="' + x.done + '">' + box(x.done) + '<span style="display:flex;flex-direction:column;gap:3px;min-width:0">' +
          '<span style="font-size:15px;font-weight:600;' + (x.done ? 'color:var(--muted);text-decoration:line-through' : '') + '">' + esc(x.task) + '</span>' +
          '<span class="tip">' + esc(x.done ? 'Done' : (x.vehicle === 'Both' ? 'Both vehicles' : '') + (x.notes ? (x.vehicle === 'Both' ? ' · ' : '') + x.notes : '')) + '</span></span></button>').join('')
          : '<div class="note" style="padding:14px 16px">Nothing open.</div>') + '</div>' +
        '<div class="row"><input id="newTask" placeholder="Add a task, e.g. book alignment" style="flex-grow:1;height:48px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--text);padding:0 14px;font-size:16px;outline:none">' +
          '<button class="iconbtn" id="addTask" aria-label="Add task" style="background:var(--blue);color:#000">' + svg(I.plus, { w: 2.4 }) + '</button></div>' +
        '<div class="section" style="color:var(--amber)">Ask at the shop</div>' +
        '<div class="card" style="display:flex;flex-direction:column">' + (shop.length ? shop.map(x =>
          '<button class="itembtn" data-shop="' + x.row + '" aria-pressed="' + !x.active + '" style="align-items:center">' +
          (x.active ? svg(I.q, { size: 20, stroke: 'var(--amber)' }) : svg(I.check, { size: 20, stroke: 'var(--muted)', w: 2.4 })) +
          '<span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:14px;' + (x.active ? 'color:var(--soft)' : 'color:var(--muted);text-decoration:line-through') + '">' + esc(x.ask) + '</span>' +
          (x.why && x.active ? '<span class="tip">' + esc(x.why) + '</span>' : '') + '</span></button>').join('')
          : '<div class="note" style="padding:14px 16px">Nothing to ask right now.</div>') + '</div>' +
        '<div class="note">Tap a question once you’ve asked it, so it drops off the digest.</div></div>';
    },

    fuel() {
      const v = vehicle();
      return '<div class="screen">' + header('home', v) +
        '<div style="padding:4px 4px 8px"><h1 style="font-size:34px">Fuel Up</h1><div class="sub" style="margin-top:6px">How do you want to log it?</div></div>' +
        '<button class="big amber" data-go="scanFuel"><span class="well">' + svg(I.scan, { size: 32, stroke: '#000' }) + '</span><span><span class="title">Scan receipt</span>' +
          '<span class="desc" style="display:block">Snap the pump receipt, then your dash for the odometer</span></span></button>' +
        '<button class="big dark" id="talk"><span class="well">' + svg(I.mic, { size: 30, stroke: 'var(--amber)' }) + '</span><span><span class="title">Talk it in</span>' +
          '<span class="desc" style="display:block">Say it: “100,412 miles, 23 gallons, 98 dollars”</span></span></button>' +
        '<div class="grow"></div><button class="link" data-go="manual" style="color:var(--muted);text-decoration:underline;text-underline-offset:4px;font-weight:500;font-size:15px">Enter manually</button></div>';
    },

    manual() {
      const v = vehicle(), e = state.entry || {}, bad = f => state.warnings.some(w => w.field === f) ? ' bad' : '';
      return '<div class="screen">' + header('fuel', v) + '<h1 style="padding:0 4px">' + (e.fromAI ? 'Look right?' : 'Enter fill-up') + '</h1>' +
        (e.fromAI ? '<div class="note">' + esc(e.fromAI) + '</div>' : '') +
        state.warnings.map(w => '<div class="warn">' + svg(I.alert, { stroke: 'var(--red)', w: 2 }) + '<div><b>' + esc(w.title) + '</b><span>' + esc(w.text) + '</span></div></div>').join('') +
        '<div class="field"><label for="odo">Odometer</label><input id="odo" class="' + bad('odometer') + '" inputmode="numeric" placeholder="Last: ' + fmt(v.lastFillOdo || v.odometer || 0) + '" value="' + esc(e.odometer != null ? e.odometer : '') + '"></div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">' +
          '<div class="field"><label for="gal">Gallons</label><input id="gal" class="' + bad('gallons') + '" inputmode="decimal" placeholder="0.000" value="' + esc(e.gallons != null ? e.gallons : '') + '"></div>' +
          '<div class="field"><label for="tot">Total $</label><input id="tot" class="' + bad('total') + '" inputmode="decimal" placeholder="0.00" value="' + esc(e.total != null ? e.total : '') + '"></div></div>' +
        '<div class="between" style="padding:0 6px;font-size:14px;color:var(--muted)"><span id="ppg">Price / gal calculates automatically</span>' +
          '<label style="display:flex;align-items:center;gap:6px">Date <input id="date" type="date" value="' + esc(e.date || today()) + '" style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 8px;color:var(--text);font-size:16px"></label></div>' +
        '<div class="seg" role="group" aria-label="Fill type">' + ['Full', 'Partial', 'Missed'].map(t =>
          '<button data-fill="' + t + '" aria-pressed="' + ((e.fillType || 'Full') === t) + '">' + (t === 'Full' ? 'Full tank' : t === 'Missed' ? 'Missed one' : 'Partial') + '</button>').join('') + '</div>' +
        photoRow(e, 'var(--amber)') +
        '<div class="grow"></div>' + sayBar('fuel', 'Something off? Say it', '“Odometer was 100,412”', 'var(--amber)') +
        (state.warnings.length
          ? '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px"><button class="secondary" id="anyway">Save anyway</button><button class="primary" id="save" style="height:56px;font-size:16px">Check again</button></div>'
          : '<button class="primary" id="save">Save fill-up</button>') +
        '</div>';
    },

    saved() {
      const r = state.result, kind = state.savedKind, fuel = kind === 'fuel';
      const color = fuel ? 'var(--amber)' : 'var(--blue)', glow = fuel ? '245,165,36' : '125,179,255';
      const title = r.offline ? 'Saved on your phone' : fuel ? 'Saved' : kind === 'tires' ? 'Tires logged' : 'Service logged';
      const sub = r.offline ? svg(I.cloud, { size: 18, stroke: color }) + 'No connection. It’ll sync on its own.'
        : r.emailed ? svg(I.mail, { size: 18, stroke: color }) + 'Heads-up sent to your Gmail'
        : r.duplicate ? 'Already in your Sheet' : 'Logged to your Sheet · ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      let body = '';
      if (!r.offline && fuel && r.saved) {
        const s = r.saved;
        body = '<div class="card" style="width:100%;padding:18px 20px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">' +
          stat('MPG', s.mpg != null ? s.mpg.toFixed(1) : '—') + stat('Per mile', s.perMile != null ? '$' + s.perMile.toFixed(2) : '—') +
          stat('Overdue', String(r.overdue || 0), r.overdue ? 'var(--red)' : '') + '</div>' +
          (r.changed && r.changed.length ? '<div class="card" style="width:100%;padding:14px 16px;display:flex;flex-direction:column;gap:6px"><div class="eyebrow" style="font-size:11px;color:var(--amber)">Now on the radar</div>' +
            r.changed.map(i => '<div class="line"><span>' + esc(i.service) + '</span><span class="' + (i.status === 'Overdue' ? 'over' : 'soon') + '">' + esc(i.label) + '</span></div>').join('') + '</div>' : '');
      } else if (!r.offline && kind === 'service' && r.logged) {
        body = '<div class="card" style="width:100%;padding:14px 16px;display:flex;flex-direction:column;gap:6px"><div class="eyebrow" style="font-size:11px;color:var(--blue)">' +
          r.reset + ' reminder' + (r.reset === 1 ? '' : 's') + ' reset</div>' + r.logged.map(n => '<div class="line"><span>' + esc(n) + '</span><span style="color:var(--muted)">Done</span></div>').join('') +
          (r.total != null ? '<div class="line"><span>Total</span><span style="color:var(--muted)">$' + Number(r.total).toFixed(2) + '</span></div>' : '') +
          (r.other || []).map(o => '<div class="line"><span>' + esc(o.title) + '</span><span style="color:var(--muted)">' + (o.price != null ? '$' + Number(o.price).toFixed(2) : 'Done') + '</span></div>').join('') +
          (r.asked && r.asked.length ? '<div class="tip">Added to Ask at the shop: ' + esc(r.asked.join(', ')) + '</div>' : '') +
          (r.merged ? '<div class="tip">Added to the visit already logged that day.</div>' : '') +
          (r.kept && r.kept.length ? '<div class="tip">Reminder kept for ' + esc(r.kept.join(', ')) + ': done more recently, so this older entry adds history and price only.</div>' : '') + '</div>';
      } else if (!r.offline && kind === 'tires' && r.replaced) {
        body = '<div class="card" style="width:100%;padding:14px 16px"><div class="line"><span>Replaced</span><span style="color:var(--muted)">' + esc(r.replaced.join(', ')) + '</span></div></div>';
      }
      return '<div class="screen" style="align-items:center;gap:22px"><div class="grow"></div>' +
        '<div class="pop" style="width:120px;height:120px;border-radius:60px;background:' + color + ';display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 14px rgba(' + glow + ',.14),0 14px 48px rgba(' + glow + ',.45)">' +
          svg(r.offline ? I.cloud : I.check, { size: 58, stroke: '#000', w: 2.4 }) + '</div>' +
        '<div class="center" style="margin-top:12px"><h1>' + title + '</h1><div class="sub" style="margin-top:8px;display:flex;gap:8px;align-items:center;justify-content:center">' + sub + '</div></div>' +
        body + '<div class="grow"></div>' +
        '<div style="width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px"><button class="secondary" id="undo">Undo</button><button class="secondary" id="done">Done</button></div></div>';
    },

    all() {
      const v = vehicle(), groups = [['Overdue', 'var(--red)'], ['Due soon', 'var(--amber)'], ['Needs baseline', 'var(--muted)'], ['OK', '#6E6E76']];
      return '<div class="screen">' + header('home', v) + '<h1 style="padding:0 4px">All services</h1>' +
        '<button class="bar" data-go="todo" style="height:60px;border-radius:18px;padding:0 16px">' + svg(I.list, { size: 22, stroke: 'var(--blue)' }) +
          '<span class="grow" style="font-size:15px;font-weight:600;text-align:left">To-do &amp; shop list</span><span style="font-size:13px;font-weight:600;color:var(--blue)">' + todoCount(v).label + '</span>' +
          svg(I.chev, { size: 16, stroke: 'var(--muted)', w: 2 }) + '</button>' +
        '<div class="note">Tap a service to change its interval or when it was last done. Tap tires to log new ones.</div>' +
        groups.map(([g, color]) => {
          const items = v.all.filter(i => i.status === g);
          if (!items.length) return '';
          return '<div class="section" style="color:' + color + '">' + (g === 'Needs baseline' ? 'Needs info' : g === 'OK' ? 'On track' : g) + '</div>' +
            '<div class="card" style="display:flex;flex-direction:column">' + items.map(i => '<button class="itembtn" data-edit="' + esc(i.service) + '"><span class="dot" style="background:' + color + '"></span>' +
              '<span class="grow" style="display:flex;flex-direction:column;gap:3px;min-width:0"><span class="between"><span style="font-size:15px;font-weight:600">' + esc(i.service) + '</span>' +
              '<span style="font-size:13px;font-weight:600;color:' + (g === 'OK' ? 'var(--muted)' : color) + ';white-space:nowrap">' + esc(i.label) + '</span></span>' +
              (g === 'Overdue' && i.tip ? '<span class="tip">' + esc(i.tip) + '</span>' : '') + '</span></button>').join('') + '</div>';
        }).join('') + '</div>';
    },

    editService() {
      const v = vehicle(), i = state.editing;
      return '<div class="screen">' + header('all', v) + '<h1 style="padding:0 4px">' + esc(i.service) + '</h1>' +
        (i.tip ? '<div class="tip" style="font-size:14px;padding:0 6px">' + esc(i.tip) + '</div>' : '') +
        '<div class="section" style="color:var(--muted)">How often</div><div class="group">' +
          '<label class="gi"><span>Every (miles)</span><input class="n" id="intMi" inputmode="numeric" placeholder="—" value="' + esc(i.intMi != null ? i.intMi : '') + '"></label>' +
          '<label class="gi"><span>Every (months)</span><input class="n" id="intMo" inputmode="numeric" placeholder="—" value="' + esc(i.intMo != null ? i.intMo : '') + '"></label></div>' +
        '<div class="note">Leave one blank if it only goes by miles or only by time. With both, whichever comes first.</div>' +
        '<div class="section" style="color:var(--muted)">Last done</div><div class="group">' +
          '<label class="gi"><span>Date</span><input id="lastDate" type="date" value="' + esc(i.lastDate || '') + '"></label>' +
          '<label class="gi"><span>Odometer</span><input class="n" id="lastOdo" inputmode="numeric" placeholder="—" value="' + esc(i.lastOdo != null ? i.lastOdo : '') + '"></label></div>' +
        '<div class="note">' + (i.source ? 'Source: ' + esc(i.source) + '. ' : '') + 'Logging a service in the app updates this on its own; edit it here to set a starting point or fix a mistake.</div>' +
        '<div class="grow"></div><button class="primary" id="saveSvc">Save</button></div>';
    },

    settings() {
      const d = state.data, s = d.settings, dg = parseDigest(s.digest);
      const hours = [];
      for (let h = 5; h <= 21; h++) for (const m of [0, 30]) hours.push((h % 12 || 12) + ':' + (m ? '30' : '00') + ' ' + (h < 12 ? 'AM' : 'PM'));
      return '<div class="screen">' + header('home', null, 'Garage') + '<h1 style="padding:0 4px">Settings</h1>' +
        '<div class="section" style="color:var(--amber)">Email</div><div class="group">' +
          '<label class="gi" style="flex-direction:column;align-items:stretch;padding-top:12px"><span>Send digests and heads-ups to</span>' +
          '<textarea id="emails" autocapitalize="off" spellcheck="false" placeholder="you@gmail.com, partner@gmail.com">' + esc(s.emails) + '</textarea></label></div>' +
        '<div class="note">Separate several addresses with commas.</div>' +
        '<div class="group">' +
          '<label class="gi"><span>Instant heads-up</span><span class="switch"><input type="checkbox" id="headsUp"' + (s.headsUp ? ' checked' : '') + ' aria-label="Instant heads-up"><span></span></span></label>' +
          '<div class="gi"><span>Weekly digest</span><span class="row" style="gap:6px"><select id="dDay" aria-label="Digest day">' +
            ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(x => '<option' + (x === dg.day ? ' selected' : '') + '>' + x + '</option>').join('') +
          '</select><select id="dTime" aria-label="Digest time">' + hours.map(x => '<option' + (x === dg.time ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></span></div></div>' +
        '<div class="section" style="color:var(--amber)">Due soon</div><div class="group">' +
          '<label class="gi"><span>Within (miles)</span><input class="n" id="dueMiles" inputmode="numeric" value="' + esc(s.dueMiles) + '"></label>' +
          '<label class="gi"><span>Within (days)</span><input class="n" id="dueDays" inputmode="numeric" value="' + esc(s.dueDays) + '"></label></div>' +
        '<div class="section" style="color:var(--amber)">Tires</div><div class="group">' +
          '<label class="gi"><span>Tread life (miles)</span><input class="n" id="tireLife" inputmode="numeric" value="' + esc(s.tireLife) + '"></label>' +
          '<label class="gi"><span>Max age (years)</span><input class="n" id="tireAge" inputmode="numeric" value="' + esc(s.tireAge) + '"></label></div>' +
        '<button class="primary" id="saveSettings">Save settings</button>' +
        '<button class="secondary" id="testDigest">Send a test digest now</button>' +
        '<div class="section" style="color:var(--blue)">Vehicles</div><div class="group">' +
          d.vehicles.map(v => '<div class="gi"><span class="row" style="gap:10px;color:var(--text)">' + vIcon(v) + esc(v.name) + '</span>' +
            '<button class="mini" data-archive="' + esc(v.name) + '">Archive</button></div>').join('') +
          d.archived.map(n => '<div class="gi"><span style="color:var(--faint)">' + esc(n) + ' · archived</span><button class="mini" data-restore="' + esc(n) + '">Restore</button></div>').join('') +
          '<button class="link" data-go="addVehicle" style="justify-content:flex-start;color:var(--blue)">' + svg(I.plus, { size: 18, w: 2.2 }) + 'Add vehicle</button></div>' +
        '<div class="note">Archiving hides a vehicle from the app and emails. Its history stays in your Sheet, and you can restore it anytime.</div>' +
        '<div class="section" style="color:var(--muted)">Connection</div><div class="group">' +
          '<div class="gi"><span>Interval suggestions</span><span style="font-size:13px;color:' + (s.geminiReady ? 'var(--amber)' : 'var(--faint)') + '">' + (s.geminiReady ? 'On (Gemini)' : 'Off · no Gemini key') + '</span></div>' +
          '<button class="link" data-go="setup" style="justify-content:flex-start;color:var(--soft)">Change app link or key</button></div>' +
        '</div>';
    },

    addVehicle() {
      const n = state.newCar || { drive: 'FWD', condition: 'used', startDate: today() };
      const f = (id, label, ph, mode) => '<div class="field small"><label for="' + id + '">' + label + '</label><input id="' + id + '"' + (mode ? ' inputmode="' + mode + '"' : '') +
        ' placeholder="' + esc(ph) + '" value="' + esc(n[id] != null ? n[id] : '') + '"></div>';
      return '<div class="screen">' + header('settings', null, 'Settings') + '<h1 style="padding:0 4px">Add vehicle</h1>' +
        f('name', 'Nickname (shown everywhere)', 'e.g. 2021 CR-V Gray') +
        '<div style="display:grid;grid-template-columns:90px minmax(0,1fr) minmax(0,1fr);gap:10px">' + f('year', 'Year', '2021', 'numeric') + f('make', 'Make', 'Honda') + f('model', 'Model', 'CR-V EX') + '</div>' +
        f('engine', 'Engine (optional, improves suggestions)', 'e.g. 1.5L turbo') +
        '<div class="field small"><label>Drive</label><div class="seg" role="group" aria-label="Drive">' + ['FWD', 'AWD', 'RWD', '4x4'].map(x =>
          '<button data-drive="' + x + '" aria-pressed="' + (n.drive === x) + '">' + x + '</button>').join('') + '</div></div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + f('odometer', 'Current odometer', '0', 'numeric') + f('tank', 'Tank size (gal)', '14.0', 'decimal') + '</div>' +
        '<div class="field small"><label>Condition</label><div class="seg" role="group" aria-label="Condition">' +
          '<button data-cond="new" aria-pressed="' + (n.condition === 'new') + '">Bought new</button><button data-cond="used" aria-pressed="' + (n.condition === 'used') + '">Used</button></div></div>' +
        (n.condition === 'new' ? '<div class="field small"><label for="startDate">In-service date (when you got it)</label><input id="startDate" type="date" value="' + esc(n.startDate || today()) + '"></div>'
          : '<div class="note">Used: services start as “Needs info.” Add what you know about each one from All services, or from a Carfax.</div>') +
        '<div class="grow"></div><button class="primary" id="toReview">Continue</button></div>';
    },

    reviewVehicle() {
      const n = state.newCar, r = state.review;
      return '<div class="screen">' + header('addVehicle', null, 'Add vehicle') + '<h1 style="padding:0 4px">Review intervals</h1>' +
        (r.available
          ? '<div class="card" style="padding:14px 16px;display:flex;gap:10px;align-items:flex-start">' + svg(I.spark, { size: 20, stroke: 'var(--amber)' }) +
            '<span class="note" style="padding:0">Suggested by Gemini for the ' + esc([n.year, n.make, n.model].filter(Boolean).join(' ')) + '. Amber boxes differ from the standard template. Check your owner’s manual for anything important.</span></div>'
          : '<div class="note">' + esc(r.reason || 'Showing the standard template.') + ' You can change any of these now or later.</div>') +
        '<div class="group">' + r.rows.map((x, k) => '<div class="rv' + (x.changed ? ' changed' : '') + '"><div class="between"><span style="font-size:15px;font-weight:600">' + esc(x.service) + '</span>' +
          (x.changed ? '<span style="font-size:12px;color:var(--faint)">template ' + esc(intervalText(x.tMi, x.tMo)) + '</span>' : '') + '</div>' +
          '<div class="ins"><input class="n" data-k="' + k + '" data-f="intMi" inputmode="numeric" placeholder="—" value="' + esc(x.intMi != null ? x.intMi : '') + '" aria-label="' + esc(x.service) + ' miles"> mi' +
          '<input class="n" data-k="' + k + '" data-f="intMo" inputmode="numeric" placeholder="—" value="' + esc(x.intMo != null ? x.intMo : '') + '" aria-label="' + esc(x.service) + ' months"> mo</div>' +
          (x.note ? '<span class="tip">' + esc(x.note) + '</span>' : '') + '</div>').join('') + '</div>' +
        '<button class="primary" id="create">Add ' + esc(n.name) + '</button></div>';
    },

    scanFuel() {
      const v = vehicle(), s = state.scan || (state.scan = { receipt: null, dash: null });
      const ai = state.data.settings.geminiReady;
      return '<div class="screen">' + header('fuel', v) + '<h1 style="padding:0 4px">Scan receipt</h1>' +
        '<div class="sub" style="padding:0 4px">' + (ai ? 'Snap the pump receipt, then your dash so the odometer gets read too.' : 'Photos are saved to your Garage Log; you’ll type the numbers next.') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">' +
          shotTile('receipt', 'Receipt', s.receipt, 'var(--amber)') + shotTile('dash', 'Dashboard', s.dash, 'var(--amber)', 'Optional') + '</div>' +
        '<div class="grow"></div>' +
        '<button class="primary" id="readScan"' + (s.receipt ? '' : ' disabled') + '>' + (ai ? 'Read it' : 'Save photos and continue') + '</button>' +
        '<button class="link" data-go="manual" style="color:var(--muted);font-weight:500">Skip, enter manually</button></div>';
    },

    scanService() {
      const v = vehicle(), s = state.scan || (state.scan = { pages: [] });
      const ai = state.data.settings.geminiReady;
      s.pages = s.pages || [];
      return '<div class="screen">' + header('service', v) + '<h1 style="padding:0 4px">Scan invoice</h1>' +
        '<div class="sub" style="padding:0 4px">' + (ai ? 'Up to 3 pages. Services, prices, and the total get filled in for you to check.' : 'Up to 3 pages, saved to your Garage Log. You’ll pick the services next.') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">' +
          s.pages.map((p, i) => shotTile('page' + i, 'Page ' + (i + 1), p, 'var(--blue)')).join('') +
          (s.pages.length < 3 ? shotTile('page' + s.pages.length, s.pages.length ? 'Add page' : 'Page 1', null, 'var(--blue)', s.pages.length ? 'Optional' : '') : '') + '</div>' +
        '<div class="grow"></div>' +
        '<button class="primary" id="readScan" style="background:var(--blue);box-shadow:0 10px 36px rgba(125,179,255,.32)"' + (s.pages.length ? '' : ' disabled') + '>' + (ai ? 'Read invoice' : 'Save and continue') + '</button>' +
        '<button class="link" data-go="serviceManual" style="color:var(--muted);font-weight:500">Skip, enter manually</button></div>';
    },

    talk() {
      const v = vehicle(), t = state.talk, fuel = t.kind === 'fuel', color = fuel ? 'var(--amber)' : 'var(--blue)';
      const back = t.correct ? (fuel ? 'manual' : 'serviceManual') : (fuel ? 'fuel' : 'service');
      const title = t.correct ? 'Say the fix' : fuel ? 'Talk it in' : 'Tell me the service';
      if (!state.data.settings.geminiReady) {
        return '<div class="screen">' + header(back, v) + '<h1 style="padding:0 4px">' + title + '</h1>' +
          '<div class="note">Voice reading needs a Gemini key (see the setup guide). Meanwhile, tap the microphone on your keyboard and dictate here.</div>' +
          '<div class="group"><textarea id="said" rows="4" placeholder="' + (fuel ? '100,412 miles, 23.1 gallons, 98 dollars' : 'Oil change and tire rotation at 100,040, 89 dollars') + '"></textarea></div>' +
          '<div class="grow"></div><button class="primary" id="useText"' + (fuel ? '' : ' style="background:var(--blue)"') + '>Continue</button></div>';
      }
      const rec = t.phase === 'rec', working = t.phase === 'working';
      const ex = t.correct ? (fuel ? '“The gallons were 23.4”' : '“Add wipers, 32 dollars”')
        : fuel ? '“100,412 miles, 23.1 gallons, 98 dollars. Full tank.”' : '“Oil change and tire rotation at 100,040. 89 dollars at Valvoline.”';
      return '<div class="screen">' + header(back, v) + '<h1 style="padding:0 4px">' + title + '</h1>' +
        '<div class="sub" style="padding:0 4px">Say it any way you like, for example ' + ex + '</div>' +
        '<div class="grow"></div>' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:18px">' +
          '<button id="mic" aria-label="' + (rec ? 'Stop recording' : 'Start recording') + '"' + (working ? ' disabled' : '') + ' style="width:132px;height:132px;border-radius:66px;border:0;display:flex;align-items:center;justify-content:center;' +
            (rec ? 'background:' + color + ';box-shadow:0 0 0 10px rgba(255,255,255,.06)' : 'background:var(--card);border:2px solid ' + color) + '">' +
            (rec ? '<span style="width:38px;height:38px;border-radius:10px;background:#000"></span>' : working ? '<span class="spin" style="margin:0"></span>' : svg(I.mic, { size: 52, stroke: color, w: 1.8 })) + '</button>' +
          '<div id="meter" style="width:180px;height:6px;border-radius:3px;background:var(--line);overflow:hidden"><div id="lvl" style="height:100%;width:0;background:' + color + ';transition:width .08s"></div></div>' +
          '<div id="recState" style="font-size:15px;color:var(--soft);font-weight:600">' + (rec ? 'Listening… tap to stop' : working ? 'Reading what you said…' : 'Tap to start') + '</div>' +
        '</div><div class="grow"></div>' +
        '<div class="note center">Up to 30 seconds. The recording is only used to fill the form; it isn’t saved.</div></div>';
    },

    stats() {
      const v = vehicle(), d = (state.stats || {})[v.name], range = state.statsRange || '12m';
      return '<div class="screen">' + header('home', v) + '<h1 style="padding:0 4px">Stats</h1>' +
        '<div class="seg" role="group" aria-label="Time range">' + [['12m', 'Last 12 months'], ['all', 'All time']].map(r =>
          '<button data-range="' + r[0] + '" aria-pressed="' + (range === r[0]) + '">' + r[1] + '</button>').join('') + '</div>' +
        '<div id="statsBody">' + (d ? GarageStats.render(d, range) : '<div class="spin" style="margin:20vh auto" role="status" aria-label="Loading"></div>') + '</div></div>';
    },

    error() {
      return '<div class="screen"><div class="grow"></div><div class="warn">' + svg(I.alert, { stroke: 'var(--red)', w: 2 }) + '<div><b>Couldn’t reach your Sheet</b><span>' + esc(state.error) +
        '</span></div></div><button class="primary" id="retry">Try again</button><button class="secondary" data-go="setup">Check connection settings</button><div class="grow"></div></div>';
    }
  };

  /** A photo slot: shows the picture once taken; tapping (re)takes it. */
  function shotTile(id, label, photo, color, hint) {
    return '<button data-shot="' + id + '" aria-label="' + esc(label) + (photo ? ', retake' : ', take photo') + '" style="aspect-ratio:3/4;border-radius:20px;padding:0;overflow:hidden;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;' +
      (photo ? 'border:0;background:#000' : 'border:1.5px dashed #4A4A52;background:var(--card);color:var(--soft)') + '">' +
      (photo ? '<img src="' + photo.preview + '" alt="" style="width:100%;height:100%;object-fit:cover">' +
        '<span style="position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.7);border-radius:10px;padding:4px 8px;font-size:12px;font-weight:600;color:#fff">' + esc(label) + ' · Retake</span>'
        : svg(I.scan, { size: 34, stroke: color }) + '<span style="font-size:15px;font-weight:600">' + esc(label) + '</span>' +
          (hint ? '<span style="font-size:12px;color:var(--muted)">' + esc(hint) + '</span>' : '')) + '</button>';
  }
  /** Shown when a visit is already logged that day: fill it in, or log a separate visit. */
  function mergeCard(matches, total) {
    const money = n => '$' + Number(n).toFixed(2);
    const btns = m => (m.cost != null && total != null)
      ? '<button class="primary" data-merge="' + m.row + '" data-price="add" style="height:48px;font-size:15px;background:var(--blue);box-shadow:none">Add to visit · new total ' + money(m.cost + total) + '</button>' +
        '<button class="secondary" data-merge="' + m.row + '" data-price="replace" style="height:48px;font-size:15px>Replace ' + money(m.cost) + ' with ' + money(total) + '</button>'
      : '<button class="primary" data-merge="' + m.row + '" style="height:48px;font-size:16px;background:var(--blue);box-shadow:none">Add to this visit' + (total != null ? ' · ' + money(total) : '') + '</button>';
    return '<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px;border:1px solid var(--blue)">' +
      '<div><b style="font-size:16px">Already logged on ' + esc(longDate(matches[0].date)) + '</b><div class="note" style="padding:4px 0 0">Add this invoice to that visit, so it isn’t listed twice?</div></div>' +
      matches.map(m => '<div style="display:flex;flex-direction:column;gap:8px;padding:10px 12px;background:var(--well);border-radius:14px">' +
        '<span style="font-size:14px;color:var(--soft)">' + esc(m.services || 'Service') + '</span>' +
        '<span style="font-size:12px;color:var(--muted)">' + [m.odometer ? fmt(m.odometer) + ' mi' : '', m.cost != null ? '$' + Number(m.cost).toFixed(2) : 'No price yet', m.shop, m.source ? 'from ' + m.source : ''].filter(Boolean).map(esc).join(' · ') + '</span>' +
        btns(m) + '</div>').join('') +
      '<button class="secondary" data-merge="new" style="height:48px;font-size:15px">Save as a separate visit</button>' +
      '<button class="link" id="mergeCancel" style="color:var(--muted);height:36px">Cancel</button></div>';
  }
  function svcTotal(f) {
    if (num(f.total) != null) return num(f.total);
    const each = f.picked.map(n => num(f.costs[n])).concat(f.other.filter(o => o.title).map(o => num(o.price)));
    return each.length && each.every(c => c != null) ? Math.round(each.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  }
  const longDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  /** "Attach photo" on manual screens; also shows photos already saved by a scan. */
  function photoRow(o, color) {
    const saved = (o.photoUrls || []).length;
    if (o.photo) {
      return '<div class="card row" style="padding:10px 12px"><img src="' + o.photo.preview + '" alt="Attached photo" style="width:44px;height:44px;border-radius:10px;object-fit:cover">' +
        '<span class="grow" style="font-size:14px;color:var(--soft)">Photo attached' + (saved ? ' · ' + saved + ' from scan' : '') + '</span><button class="mini" id="dropPhoto">Remove</button></div>';
    }
    return '<div class="between" style="padding:0 6px"><span style="font-size:13px;color:var(--muted)">' + (saved ? saved + ' photo' + (saved === 1 ? '' : 's') + ' saved to Garage Log' : 'Receipt or invoice photo') + '</span>' +
      '<button class="mini" id="attach" style="color:' + color + ';border-color:' + color + '">' + (saved ? 'Add another' : 'Attach photo') + '</button></div>';
  }
  /** The "Something off? Say it" bar for voice corrections (needs Gemini). */
  function sayBar(kind, label, hint, color) {
    if (!state.data.settings.geminiReady) return '';
    return '<button class="bar" id="say" style="height:64px;border-color:' + color + '"><span class="well" style="width:40px;height:40px">' + svg(I.mic, { size: 22, stroke: color }) + '</span>' +
      '<span class="grow" style="text-align:left;display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:600">' + esc(label) + '</span><span style="font-size:12px;color:var(--muted)">' + esc(hint) + '</span></span></button>';
  }
  const bare = p => p ? { mime: p.mime, data: p.data } : null;
  /** Fills the fuel form from what Gemini read; keeps anything it didn't. */
  function applyFuel(f, from) {
    const e = state.entry = state.entry || {};
    if (f) {
      if (f.odometer != null) e.odometer = Math.round(f.odometer);
      if (f.gallons != null) e.gallons = f.gallons;
      if (f.total != null) e.total = f.total;
      else if (f.pricePerGallon != null && e.gallons) e.total = Math.round(f.pricePerGallon * e.gallons * 100) / 100;
      if (f.date && /^\d{4}-\d{2}-\d{2}$/.test(f.date)) e.date = f.date;
      if (f.fillType) e.fillType = f.fillType;
      if (f.station && !e.notes) e.notes = f.station;
    }
    e.fromAI = from;
    state.warnings = [];
  }
  function newSvc(v) { return { date: today(), odometer: v.odometer || '', picked: [], costs: {}, total: '', shop: '', notes: '', other: [], declined: [], inv: null, totalLocked: false }; }
  /* Declined work that's already a reminder or already on the shop list starts unchecked, so nothing doubles up. */
  const STOP = /^(service|services|maintenance|fluid|fluids|condition|replacement|replace|system|check|inspection|exchange|level|basic|front|rear|left|right|driver|passenger|side|and|the|with|from)$/;
  const keyWords = t => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP.test(w)).map(w => w.replace(/s$/, ''));
  function dupOf(title) {
    const v = vehicle(), k = keyWords(title), hit = t => keyWords(t).some(w => k.indexOf(w) >= 0);
    const shop = ((state.data.todo || {}).shop || []).filter(x => x.active && (!x.vehicle || x.vehicle === v.name || x.vehicle === 'Both'));
    if (shop.some(x => hit(x.ask))) return 'Already on your shop list';
    if (v.all.some(i => hit(i.service))) return 'Already a reminder';
    return '';
  }
  function totalNote(f) {
    const money = n => '$' + Number(n).toFixed(2), i = f.inv;
    const lines = f.picked.map(n => num(f.costs[n])).concat(f.other.filter(o => o.title).map(o => num(o.price))).filter(c => c != null);
    const sum = lines.reduce((a, b) => a + b, 0), t = num(f.total);
    const parts = i ? [i.subtotal != null ? 'Subtotal ' + money(i.subtotal) : '', i.fees ? 'Fees ' + money(i.fees) : '', i.discounts ? 'Discounts −' + money(i.discounts) : '', i.tax ? 'Tax ' + money(i.tax) : '', i.total != null ? 'Total ' + money(i.total) : ''].filter(Boolean) : [];
    const gap = t != null && lines.length && Math.abs(sum - t) >= 0.01 ? 'Line prices add up to ' + money(sum) + '; the visit is saved at ' + money(t) + (i ? ' (fees and tax included).' : '.') : '';
    return parts.length || gap ? '<div class="note">' + [parts.length ? 'Invoice: ' + parts.join(' · ') + '.' : '', gap].filter(Boolean).join(' ') + '</div>' : '';
  }
  function declinedBlock(f) {
    if (!f.declined.length) return '';
    return '<div class="section" style="color:var(--amber)">Declined at the shop</div><div class="group">' + f.declined.map((x, i) =>
      '<label class="gi" style="align-items:flex-start;padding:10px 0"><span style="display:flex;flex-direction:column;gap:3px;min-width:0"><span style="font-size:15px;color:var(--soft)">' + esc(x.title) + '</span>' +
      '<span class="tip">' + esc(x.dup || (x.note ? x.note : 'Add to Ask at the shop')) + '</span></span>' +
      '<span class="switch"><input type="checkbox" data-dec="' + i + '"' + (x.on ? ' checked' : '') + ' aria-label="Add ' + esc(x.title) + ' to Ask at the shop"><span></span></span></label>').join('') + '</div>' +
      '<div class="note">Checked items go on your Ask at the shop list and show in the weekly digest.</div>';
  }
  function applyService(f, from) {
    const v = vehicle(), s = state.svc = state.svc || newSvc(v);
    if (f) {
      (f.items || []).forEach(x => { if (s.picked.indexOf(x.service) < 0) s.picked.push(x.service); if (x.cost != null) s.costs[x.service] = String(x.cost); });
      // Invoice scan: tracked jobs become chips with prices; everything else is Other work.
      (f.jobs || []).forEach(j => {
        if (j.service) {
          if (s.picked.indexOf(j.service) < 0) s.picked.push(j.service);
          if (j.price != null) s.costs[j.service] = String(Math.round(((num(s.costs[j.service]) || 0) + j.price) * 100) / 100);
        } else s.other.push({ title: j.title, price: j.price != null ? String(j.price) : '' });
        if (j.note && s.notes.indexOf(j.note) < 0) s.notes = s.notes ? s.notes + '; ' + j.note : j.note;
      });
      if (f.jobs) {
        s.inv = { subtotal: f.subtotal, fees: f.fees, discounts: f.discounts, tax: f.tax, total: f.total };
        if (f.total != null) s.totalLocked = true;
        s.declined = (f.declined || []).map(x => { const dup = dupOf(x.title); return { title: x.title, note: x.note || '', on: !dup, dup: dup }; });
      }
      if (f.odometer != null) s.odometer = String(Math.round(f.odometer));
      if (f.date && /^\d{4}-\d{2}-\d{2}$/.test(f.date)) s.date = f.date;
      if (f.total != null) s.total = String(f.total);
      if (f.shop) s.shop = f.shop;
      const extra = (f.other || []).filter(x => typeof x === 'string').concat(f.note ? [f.note] : []).join('; ');
      if (extra && s.notes.indexOf(extra) < 0) s.notes = s.notes ? s.notes + '; ' + extra : extra;
    }
    s.fromAI = from;
  }
  function attachWire(obj) {
    const a = document.getElementById('attach'), r = document.getElementById('dropPhoto');
    if (a) a.addEventListener('click', async () => {
      try { const p = await GarageMedia.pickPhoto(); if (p) { obj().photo = p; render(); } } catch (err) { toast(err.message); }
    });
    if (r) r.addEventListener('click', () => { obj().photo = null; render(); });
  }

  function rankName(i) { return i.status === 'Overdue' ? 0 : i.status === 'Due soon' ? 1 : 2; }
  function todoCount(v) {
    const t = state.data.todo || { tasks: [], shop: [] }, mine = x => !x.vehicle || x.vehicle === 'Both' || x.vehicle === v.name;
    const open = t.tasks.filter(x => mine(x) && !x.done).length, ask = t.shop.filter(x => mine(x) && x.active).length;
    return { open: open, ask: ask, label: [open ? open + ' open' : '', ask ? ask + ' to ask' : ''].filter(Boolean).join(' · ') || 'All done' };
  }
  function todoLine(v) {
    const c = todoCount(v);
    if (!c.open && !c.ask) return '';
    return '<button class="link" data-go="todo" style="justify-content:space-between;padding:0 6px;height:40px;color:var(--soft);font-weight:500">' +
      '<span class="row" style="gap:8px">' + svg(I.list, { size: 18, stroke: 'var(--blue)' }) + 'To-do</span><span class="row" style="gap:6px;color:var(--blue);font-weight:600">' + c.label + svg(I.chev, { size: 16, w: 2 }) + '</span></button>';
  }
  function pendingLine() {
    const n = queue.all().length;
    return n ? '<div class="note center" style="display:flex;gap:8px;justify-content:center;align-items:center">' + svg(I.cloud, { size: 16, stroke: 'var(--amber)' }) +
      n + ' save' + (n === 1 ? '' : 's') + ' waiting for a connection</div>' : '';
  }
  function intervalText(mi, mo) { return [mi ? fmt(mi) + ' mi' : '', mo ? mo + ' mo' : ''].filter(Boolean).join(' / ') || 'none'; }
  function parseDigest(text) {
    const m = String(text || '').match(/^(\w+)\s+(\d{1,2}:\d{2}\s*(AM|PM))$/i);
    return m ? { day: m[1], time: m[2].replace(/\s+/, ' ').toUpperCase() } : { day: 'Monday', time: '7:00 AM' };
  }
  function stat(label, value, color) {
    return '<div style="display:flex;flex-direction:column;gap:4px"><span class="eyebrow" style="font-size:11px">' + label + '</span><span style="font-size:20px;font-weight:600' + (color ? ';color:' + color : '') + '">' + esc(value) + '</span></div>';
  }
  function sparkline(vals) {
    if (!vals || vals.length < 2) return '';
    const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 1;
    const pts = vals.map((v, i) => [Math.round(i / (vals.length - 1) * 114 * 10) / 10 + 3, Math.round((25 - (v - lo) / span * 22) * 10) / 10]);
    const last = pts[pts.length - 1];
    return '<svg role="img" aria-label="MPG over the last ' + vals.length + ' fill-ups" width="120" height="28" viewBox="0 0 120 28" fill="none"><polyline points="' + pts.map(p => p.join(',')).join(' ') +
      '" stroke="var(--amber)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline><circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="var(--amber)"></circle></svg>';
  }
  function ring(oil, color) {
    const c = 2 * Math.PI * 32, used = oil ? oil.used : 0;
    const word = !oil ? '—' : oil.status === 'Overdue' ? 'Due' : oil.status === 'Needs baseline' ? '?' : Math.round((1 - used) * 100) + '%';
    return '<div style="position:relative;width:76px;height:76px;flex-shrink:0"><svg role="img" aria-label="Oil life: ' + esc(oil ? oil.label : 'no data') + '" width="76" height="76" viewBox="0 0 76 76">' +
      '<circle cx="38" cy="38" r="32" fill="none" stroke="var(--line)" stroke-width="7"></circle>' +
      '<circle cx="38" cy="38" r="32" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (c * used).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 38 38)"></circle></svg>' +
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Oil</span>' +
      '<span style="font-size:13px;font-weight:700;color:' + color + '">' + word + '</span></div></div>';
  }

  /* ---------- screen wiring ---------- */
  const wire = {
    setup() {
      document.getElementById('connect').addEventListener('click', async () => {
        state.api = val('api'); state.key = val('key');
        if (!/^https:\/\/script\.google\.com\//.test(state.api)) { toast('That link should start with https://script.google.com/'); return; }
        store.set('api', state.api); store.set('key', state.key);
        await load();
      });
    },
    home() {
      $app.querySelectorAll('[data-vehicle]').forEach(b => b.addEventListener('click', () => {
        state.vehicle = b.dataset.vehicle; store.set('vehicle', state.vehicle); render();
      }));
      document.getElementById('service').addEventListener('click', () => { state.svc = null; go('service'); });
    },
    service() {
      state.tireForm = null; state.scan = null; state.svc = null;
      document.getElementById('talkSvc').addEventListener('click', () => { state.talk = { kind: 'service', phase: 'idle' }; go('talk'); });
    },
    serviceManual() {
      const f = state.svc;
      const read = () => {
        const nd = val('sDate') || today(); if (f.mergeOffer && nd !== f.date) { f.mergeOffer = null; setTimeout(render, 0); }
        f.date = nd; f.odometer = val('sOdo'); f.shop = val('sShop'); f.notes = val('sNotes');
        $app.querySelectorAll('[data-cost]').forEach(i => { f.costs[i.dataset.cost] = i.value.trim(); });
        $app.querySelectorAll('[data-otitle]').forEach(i => { f.other[Number(i.dataset.otitle)].title = i.value.trim(); });
        $app.querySelectorAll('[data-oprice]').forEach(i => { f.other[Number(i.dataset.oprice)].price = i.value.trim(); });
        $app.querySelectorAll('[data-dec]').forEach(i => { f.declined[Number(i.dataset.dec)].on = i.checked; });
        const tot = document.getElementById('sTotal');
        if (tot) {
          // Until you type a total (or a scan reads the invoice's grand total), Total is the sum of the prices.
          const lines = f.picked.map(n => num(f.costs[n])).concat(f.other.filter(o => o.title).map(o => num(o.price)));
          if (!f.totalLocked && lines.length && lines.every(c => c != null) && document.activeElement !== tot) tot.value = lines.reduce((a, b) => a + b, 0).toFixed(2);
          f.total = tot.value.trim();
        }
      };
      $app.querySelectorAll('input').forEach(i => i.addEventListener('input', read));
      const totEl = document.getElementById('sTotal');
      if (totEl) totEl.addEventListener('input', () => { f.totalLocked = totEl.value.trim() !== ''; });
      $app.querySelectorAll('[data-dec]').forEach(i => i.addEventListener('change', read));
      document.getElementById('addOther').addEventListener('click', () => { read(); f.other.push({ title: '', price: '' }); render();
        const all = $app.querySelectorAll('[data-otitle]'); if (all.length) all[all.length - 1].focus(); });
      $app.querySelectorAll('[data-odel]').forEach(b => b.addEventListener('click', () => { read(); f.other.splice(Number(b.dataset.odel), 1); render(); }));
      $app.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
        read(); const n = b.dataset.pick, k = f.picked.indexOf(n);
        if (k >= 0) f.picked.splice(k, 1); else f.picked.push(n);
        render();
      }));
      attachWire(() => { read(); return f; });
      const say = document.getElementById('say');
      if (say) say.addEventListener('click', () => { read(); state.talk = { kind: 'service', phase: 'idle', correct: true }; go('talk'); });
      const send = async (btn, mergeRow, priceMode) => {
        read();
        if (!f.picked.length && !f.other.some(o => o.title)) { toast('Pick a service, or add the work done under Other work.'); return; }
        if (!num(f.odometer)) { toast('Add the odometer reading.'); return; }
        const costs = {}; f.picked.forEach(n => { if (num(f.costs[n]) != null) costs[n] = num(f.costs[n]); });
        const r = await saveOrQueue(btn, 'saveService', { vehicle: vehicle().name, date: f.date, odometer: num(f.odometer), services: f.picked.slice(),
          costs: costs, total: num(f.total), other: f.other.filter(o => o.title).map(o => ({ title: o.title, price: num(o.price) })),
          declined: f.declined.filter(x => x.on).map(x => ({ title: x.title, note: x.note })), shop: f.shop, notes: f.notes, photo: bare(f.photo), photoUrls: f.photoUrls || [], scanFileIds: f.scanFileIds || [],
          mergeRow: mergeRow || null, priceMode: priceMode || null, clientId: f.clientId || (f.clientId = newId()) });
        if (!r) return;
        if (r.needsMerge) { f.mergeOffer = r.matches; render(); window.scrollTo(0, document.body.scrollHeight); return; }
        if (r.vehicles) adopt(r); state.result = r; state.savedKind = 'service'; state.svc = null; go('saved');
      };
      const sv = document.getElementById('saveService');
      if (sv) sv.addEventListener('click', e => send(e.currentTarget));
      $app.querySelectorAll('[data-merge]').forEach(b => b.addEventListener('click', e => send(e.currentTarget, b.dataset.merge, b.dataset.price)));
      const mc = document.getElementById('mergeCancel');
      if (mc) mc.addEventListener('click', () => { read(); f.mergeOffer = null; render(); });
    },
    tires() {
      const f = state.tireForm;
      const read = () => {
        f.date = val('tDate') || today(); f.odometer = val('tOdo'); f.dot = val('tDot'); f.cost = val('tCost'); f.shop = val('tShop');
        f.picked = Array.prototype.filter.call($app.querySelectorAll('[data-tire]'), i => i.checked).map(i => i.dataset.tire);
      };
      $app.querySelectorAll('input').forEach(i => i.addEventListener('input', read));
      $app.querySelectorAll('[data-tire]').forEach(i => i.addEventListener('change', read));
      document.getElementById('saveTires').addEventListener('click', async e => {
        read();
        if (!f.picked.length) { toast('Pick which tires were replaced.'); return; }
        if (!num(f.odometer)) { toast('Add the odometer reading.'); return; }
        if (f.dot && !/^\d{4}$/.test(f.dot)) { toast('The DOT date code is 4 digits, like 2324.'); return; }
        const r = await saveOrQueue(e.currentTarget, 'replaceTires', { vehicle: vehicle().name, tires: f.picked.slice(), date: f.date, odometer: num(f.odometer),
          dot: f.dot, cost: num(f.cost), shop: f.shop, clientId: f.clientId || (f.clientId = newId()) });
        if (r) { if (r.vehicles) adopt(r); state.result = r; state.savedKind = 'tires'; state.tireForm = null; go('saved'); }
      });
    },
    todo() {
      const t = state.data.todo;
      const toggle = async (list, row, done, btn) => {
        const item = (list === 'shop' ? t.shop : t.tasks).find(x => x.row === row);
        btn.style.opacity = '.5';
        const r = await busy(null, '', () => api('toggleTask', { list: list, row: row, text: list === 'shop' ? item.ask : item.task, done: done }));
        if (r) { state.data.todo = r.todo; render(); confirmBanner(list === 'shop' ? (done ? 'Marked as asked' : 'Back on the shop list') : (done ? 'Marked done' : 'Reopened')); }
        else btn.style.opacity = '';
      };
      $app.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => {
        const row = Number(b.dataset.task), x = t.tasks.find(y => y.row === row); toggle('tasks', row, !x.done, b);
      }));
      $app.querySelectorAll('[data-shop]').forEach(b => b.addEventListener('click', () => {
        const row = Number(b.dataset.shop), x = t.shop.find(y => y.row === row); toggle('shop', row, x.active, b);
      }));
      document.getElementById('addTask').addEventListener('click', async e => {
        const text = val('newTask');
        if (!text) { toast('Type the task first.'); return; }
        const r = await busy(e.currentTarget, '', () => api('addTask', { vehicle: vehicle().name, task: text }));
        if (r) { state.data.todo = r.todo; render(); confirmBanner('Task added'); }
      });
    },
    fuel() {
      state.entry = null; state.warnings = []; state.scan = null;
      document.getElementById('talk').addEventListener('click', () => { state.talk = { kind: 'fuel', phase: 'idle' }; go('talk'); });
    },
    scanFuel() {
      const s = state.scan;
      $app.querySelectorAll('[data-shot]').forEach(b => b.addEventListener('click', async () => {
        try { const p = await GarageMedia.pickPhoto(); if (p) { s[b.dataset.shot] = p; render(); } } catch (err) { toast(err.message); }
      }));
      document.getElementById('readScan').addEventListener('click', async e => {
        const r = await busy(e.currentTarget, state.data.settings.geminiReady ? 'Reading…' : 'Saving…',
          () => api('scanFuel', { vehicle: vehicle().name, receipt: bare(s.receipt), dash: bare(s.dash) }));
        if (!r) return;
        state.entry = { photoUrls: r.photoUrls, scanFileIds: r.scanFileIds };
        applyFuel(r.available ? r.fields : null, r.available ? 'Read from your ' + (s.dash ? 'receipt and dash' : 'receipt') + (s.dash ? '.' : '. Add the odometer.') : r.reason);
        state.scan = null; go('manual');
      });
    },
    scanService() {
      const s = state.scan;
      $app.querySelectorAll('[data-shot]').forEach(b => b.addEventListener('click', async () => {
        try { const p = await GarageMedia.pickPhoto(); if (p) { s.pages[Number(b.dataset.shot.slice(4))] = p; render(); } } catch (err) { toast(err.message); }
      }));
      document.getElementById('readScan').addEventListener('click', async e => {
        const r = await busy(e.currentTarget, state.data.settings.geminiReady ? 'Reading…' : 'Saving…',
          () => api('scanService', { vehicle: vehicle().name, pages: s.pages.map(bare) }));
        if (!r) return;
        state.svc = null; applyService(r.available ? r.fields : null,
          r.available ? ((r.fields.jobs || []).length ? 'Read ' + r.fields.jobs.length + ' job' + (r.fields.jobs.length === 1 ? '' : 's') + ' from your invoice. Check the services, other work, and total.' : 'Couldn’t read the jobs on this invoice; add them below.') : r.reason);
        state.svc.photoUrls = r.photoUrls; state.svc.scanFileIds = r.scanFileIds;
        state.scan = null; go('serviceManual');
      });
    },
    talk() {
      const t = state.talk, fuel = t.kind === 'fuel';
      const done = () => go(fuel ? 'manual' : 'serviceManual');
      const useText = document.getElementById('useText');
      if (useText) {
        useText.addEventListener('click', () => {
          const text = val('said');
          if (fuel) { const p = GarageMedia.parseFuel(text); applyFuel(p, 'Filled in from what you typed. Check each number.'); }
          else { applyService(null, ''); if (text) state.svc.notes = state.svc.notes ? state.svc.notes + '; ' + text : text; state.svc.fromAI = 'Your note is saved below. Pick the services done.'; }
          done();
        });
        return;
      }
      const mic = document.getElementById('mic');
      const finish = async () => {
        const rec = t.rec; t.rec = null; clearInterval(t.meter);
        const audio = rec ? await rec.stop() : null;
        if (!audio) return;
        if (audio.seconds < 0.8) { t.phase = 'idle'; render(); toast('That was too short. Tap and speak, then tap again.'); return; }
        t.phase = 'working'; render();
        const current = fuel ? (state.entry ? { odometer: state.entry.odometer, gallons: state.entry.gallons, total: state.entry.total, date: state.entry.date, fillType: state.entry.fillType } : null)
          : (state.svc ? { date: state.svc.date, odometer: num(state.svc.odometer), shop: state.svc.shop, total: num(state.svc.total),
            items: state.svc.picked.map(n => ({ service: n, cost: num(state.svc.costs[n]) })), note: state.svc.notes } : null);
        try {
          const r = await api('voice', { vehicle: vehicle().name, kind: t.kind, audio: { mime: audio.mime, data: audio.data }, current: t.correct ? current : null });
          if (!r.available) { toast(r.reason); t.phase = 'idle'; render(); return; }
          if (fuel) applyFuel(r.fields, t.correct ? 'Updated from what you said.' : 'Heard you. Check each number.');
          else {
            if (t.correct && state.svc && r.fields.items) state.svc.picked = []; // the reply is the full corrected list
            applyService(r.fields, t.correct ? 'Updated from what you said.' : 'Heard you. Check the services and prices.');
          }
          done();
        } catch (err) {
          t.phase = 'idle'; render(); failBanner(err.message === 'Failed to fetch' ? 'No connection. Tap the mic to try again, or enter it manually.' : err.message);
        }
      };
      mic.addEventListener('click', async () => {
        if (t.phase === 'rec') { finish(); return; }
        if (t.phase !== 'idle') return;
        try {
          t.rec = await GarageMedia.startRecording(30);
        } catch (err) { toast(err.name === 'NotAllowedError' ? 'Allow the microphone for this app in Settings, then try again.' : err.message); return; }
        t.phase = 'rec'; render();
        t.meter = setInterval(() => { const l = document.getElementById('lvl'); if (l && t.rec) l.style.width = Math.min(100, Math.round(t.rec.level() * 180)) + '%'; }, 80);
        t.rec.timedOut.then(() => { if (t.phase === 'rec' && t.rec) finish(); });
      });
      // Leaving the screen stops the microphone.
      $app.querySelectorAll('[data-go],[data-back]').forEach(b => b.addEventListener('click', () => { if (t.rec) { t.rec.stop(); t.rec = null; clearInterval(t.meter); t.phase = 'idle'; } }, { capture: true }));
    },
    async stats() {
      const v = vehicle();
      $app.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { state.statsRange = b.dataset.range; render(); }));
      state.stats = state.stats || {};
      if (state.stats[v.name]) { GarageStats.wire(document.getElementById('statsBody')); return; }
      try {
        const r = await api('stats', { vehicle: v.name });
        state.stats[v.name] = r;
        if (current === 'stats') render();
      } catch (err) {
        const el = document.getElementById('statsBody');
        if (el) el.innerHTML = '<div class="note center" style="padding-top:20vh">' + esc(err.message === 'Failed to fetch' ? 'Stats need a connection. Try again when you’re online.' : err.message) + '</div>';
      }
    },
    manual() {
      const read = () => {
        const e = state.entry = Object.assign(state.entry || {}, {
          odometer: num(val('odo')), gallons: num(val('gal')), total: num(val('tot')), date: val('date') || today()
        });
        e.fillType = e.fillType || 'Full';
        document.getElementById('ppg').textContent = e.gallons && e.total ? '$' + (e.total / e.gallons).toFixed(3) + ' / gal' : 'Price / gal calculates automatically';
        return e;
      };
      ['odo', 'gal', 'tot', 'date'].forEach(id => document.getElementById(id).addEventListener('input', read));
      read();
      $app.querySelectorAll('[data-fill]').forEach(b => b.addEventListener('click', () => { read(); state.entry.fillType = b.dataset.fill; state.warnings = []; render(); }));
      attachWire(() => read());
      const say = document.getElementById('say');
      if (say) say.addEventListener('click', () => { read(); state.talk = { kind: 'fuel', phase: 'idle', correct: true }; go('talk'); });
      document.getElementById('save').addEventListener('click', () => {
        const e = read();
        if (!e.odometer || !e.gallons || e.total == null) { toast('Odometer, gallons, and total are all needed.'); return; }
        state.warnings = GarageChecks.runChecks(vehicle(), e);
        if (state.warnings.length) { render(); return; }
        saveFuel();
      });
      const anyway = document.getElementById('anyway');
      if (anyway) anyway.addEventListener('click', () => { read(); saveFuel(); });
    },
    saved() {
      document.getElementById('done').addEventListener('click', () => load());
      document.getElementById('undo').addEventListener('click', async e => {
        const r = state.result;
        if (r.offline) { queue.drop(r.undoId); confirmBanner('Undone', 'Removed from this phone. Nothing was sent.'); load(); return; }
        if (!r.undoId) { toast('This one can’t be undone here. Fix it in the Sheet.'); return; }
        const home = await busy(e.currentTarget, 'Undoing…', () => api('undo', { id: r.undoId }));
        if (home) { adopt(home); confirmBanner('Undone', state.savedKind === 'tires' ? 'Removed from your Sheet' : 'Removed from your Sheet. Any photos went to the Drive trash.'); go('home'); }
      });
    },
    all() {
      $app.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
        const item = vehicle().all.find(i => i.service === b.dataset.edit);
        if (item.kind === 'tire') {
          const v = vehicle();
          state.tireForm = { picked: (item.tires || []).slice(), date: today(), odometer: v.odometer || '', dot: '', cost: '', shop: '' };
          go('tires'); return;
        }
        state.editing = item; go('editService');
      }));
    },
    editService() {
      document.getElementById('saveSvc').addEventListener('click', async e => {
        const i = state.editing, v = vehicle();
        const body = { vehicle: v.name, service: i.service, intMi: num(val('intMi')), intMo: num(val('intMo')), lastDate: val('lastDate'), lastOdo: num(val('lastOdo')) };
        if (body.lastOdo != null && body.lastOdo > (v.odometer || 0) + 5) { toast('That odometer is higher than the current reading of ' + fmt(v.odometer) + '.'); return; }
        const home = await busy(e.currentTarget, 'Saving…', () => api('updateService', body));
        if (home) { adopt(home); confirmBanner(i.service + ' updated'); go('all'); }
      });
    },
    settings() {
      document.getElementById('saveSettings').addEventListener('click', async e => {
        const body = {
          emails: val('emails'), headsUp: document.getElementById('headsUp').checked,
          digest: document.getElementById('dDay').value + ' ' + document.getElementById('dTime').value,
          dueMiles: num(val('dueMiles')), dueDays: num(val('dueDays')), tireLife: num(val('tireLife')), tireAge: num(val('tireAge'))
        };
        const home = await busy(e.currentTarget, 'Saving…', () => api('updateSettings', body));
        if (home) { adopt(home); confirmBanner('Settings saved'); }
      });
      document.getElementById('testDigest').addEventListener('click', async e => {
        const r = await busy(e.currentTarget, 'Sending…', () => api('testDigest'));
        if (r) { if (r.sent) confirmBanner('Test digest sent', 'To ' + r.to.join(', ')); else failBanner(r.reason); }
      });
      $app.querySelectorAll('[data-archive]').forEach(b => b.addEventListener('click', async () => {
        const name = b.dataset.archive;
        if (!window.confirm('Archive ' + name + '? It disappears from the app and emails, but all its history stays in your Sheet and you can restore it anytime.')) return;
        const home = await busy(b, '…', () => api('setVehicleActive', { name: name, active: false }));
        if (home) { adopt(home); confirmBanner(name + ' archived', 'History kept. Restore it anytime in Settings.'); render(); }
      }));
      $app.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
        const home = await busy(b, '…', () => api('setVehicleActive', { name: b.dataset.restore, active: true }));
        if (home) { adopt(home); confirmBanner(b.dataset.restore + ' restored'); render(); }
      }));
    },
    addVehicle() {
      const read = () => {
        const n = state.newCar = Object.assign(state.newCar || { drive: 'FWD', condition: 'used' }, {
          name: val('name'), year: val('year'), make: val('make'), model: val('model'), engine: val('engine'),
          odometer: num(val('odometer')), tank: num(val('tank'))
        });
        if (document.getElementById('startDate')) n.startDate = val('startDate');
        return n;
      };
      $app.querySelectorAll('[data-drive]').forEach(b => b.addEventListener('click', () => { read().drive = b.dataset.drive; render(); }));
      $app.querySelectorAll('[data-cond]').forEach(b => b.addEventListener('click', () => { read().condition = b.dataset.cond; render(); }));
      document.getElementById('toReview').addEventListener('click', async e => {
        const n = read();
        if (!n.name) { toast('Give the vehicle a nickname.'); return; }
        if (state.data.vehicles.some(v => v.name.toLowerCase() === n.name.toLowerCase()) || state.data.archived.some(a => a.toLowerCase() === n.name.toLowerCase())) { toast('That nickname is already used.'); return; }
        if (n.odometer == null) { toast('Add the current odometer.'); return; }
        const tpl = state.data.template.filter(t => appliesTo(t.appliesTo, n.drive));
        let sug = { available: false, reason: 'Interval suggestions are off (no Gemini key), so this is the standard template.' };
        if (state.data.settings.geminiReady) {
          const r = await busy(e.currentTarget, 'Getting suggestions…', () => api('suggestIntervals', { year: n.year, make: n.make, model: n.model, engine: n.engine, drive: n.drive }));
          if (r) sug = r;
        }
        const by = {};
        (sug.suggestions || []).forEach(x => { by[x.service] = x; });
        state.review = {
          available: !!sug.available, reason: sug.reason,
          rows: tpl.map(t => {
            const s = sug.available && by[t.service] ? by[t.service] : null;
            const intMi = s ? s.intMi : t.intMi, intMo = s ? s.intMo : t.intMo;
            return { service: t.service, tMi: t.intMi, tMo: t.intMo, intMi: intMi, intMo: intMo,
              changed: !!s && (intMi !== t.intMi || intMo !== t.intMo), note: s ? s.note : '' };
          })
        };
        go('reviewVehicle');
      });
    },
    reviewVehicle() {
      $app.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('input', () => {
        state.review.rows[Number(inp.dataset.k)][inp.dataset.f] = num(inp.value);
      }));
      document.getElementById('create').addEventListener('click', async e => {
        const n = state.newCar;
        const body = Object.assign({}, n, { services: state.review.rows.map(x => ({ service: x.service, intMi: x.intMi, intMo: x.intMo })) });
        const home = await busy(e.currentTarget, 'Adding…', () => api('addVehicle', body));
        if (home) {
          adopt(home); state.vehicle = n.name; store.set('vehicle', n.name);
          state.newCar = null; state.review = null;
          confirmBanner(n.name + ' added', 'Reminders, tires, and prices set up'); go('home');
        }
      });
    },
    error() { document.getElementById('retry').addEventListener('click', () => load()); }
  };

  async function saveFuel() {
    const btn = document.getElementById('save') || document.getElementById('anyway');
    state.entry.clientId = state.entry.clientId || newId();
    const e = state.entry;
    const r = await saveOrQueue(btn, 'saveFuel', { vehicle: vehicle().name, odometer: e.odometer, gallons: e.gallons, total: e.total, date: e.date, fillType: e.fillType,
      notes: e.notes || '', photo: bare(e.photo), photoUrls: e.photoUrls || [], scanFileIds: e.scanFileIds || [], clientId: e.clientId });
    if (r) { state.result = r; state.savedKind = 'fuel'; state.entry = null; state.warnings = []; go('saved'); }
  }

  /* Instant open: show the last synced Home right away, then refresh it from the Sheet in the background. */
  let loadSeq = 0;
  async function load() {
    if (!state.api || !state.key) { go('setup'); return; }
    const seq = ++loadSeq;
    const cached = state.data || (() => { try { return JSON.parse(store.get('home') || 'null'); } catch (e) { return null; } })();
    const instant = !!(cached && cached.vehicles && cached.vehicles.length);
    if (instant) { adopt(cached); state.refreshing = true; go('home'); }
    else $app.innerHTML = '<div class="spin" role="status" aria-label="Loading"></div>';
    try {
      const home = await api('home');
      if (seq !== loadSeq) return; // a newer refresh started
      if (!home.vehicles.length) throw new Error('No active vehicles on the Vehicles tab.');
      const keepStats = state.stats;
      adopt(home); store.set('home', JSON.stringify(home));
      state.refreshing = false;
      if (instant && current !== 'home') state.stats = keepStats; // don't redraw a screen you're using
      if (!instant || current === 'home') { if (current === 'home') render(); else go('home'); }
      flushQueue();
    } catch (err) {
      if (seq !== loadSeq) return;
      state.refreshing = false;
      if (instant) {
        if (current === 'home') render();
        if (offlineErr(err)) toast('Offline. Showing your last synced data; saves will sync later.');
        else failBanner(err.message, () => load());
        return;
      }
      state.error = err.message === 'Failed to fetch' ? 'Check your internet connection and that the app link is right.' : err.message;
      go('error');
    }
  }

  load();
})();
