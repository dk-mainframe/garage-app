/* Budget — phone screens. Talks to the Apps Script back end in the Expense Tracker Sheet. */
(function () {
  'use strict';
  const E = window.BudgetEngine, M = window.BudgetMedia;
  const app = document.getElementById('app');

  /* ---------- Storage (per phone) ---------- */
  const store = {
    get(k) { try { return localStorage.getItem('budget.' + k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem('budget.' + k); else localStorage.setItem('budget.' + k, v); } catch (e) { /* private mode */ } }
  };
  const state = { api: store.get('api'), key: store.get('key'), data: null, view: 'native', busy: false,
    statsView: 'native', statsBack: 0, histCat: 'all', histQuery: '', draft: null };

  /* ---------- Icons ---------- */
  const I = {
    chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    back: '<path d="M15 6l-6 6 6 6"/>', next: '<path d="M9 6l6 6-6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    car: '<path d="M5 17h14M3 17v-4l2-5h14l2 5v4M7 17v2M17 17v2"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
    loop: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5"/>', payback: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
    del: '<path d="M9 5h11v14H9l-6-7z"/><path d="M13 9.5l5 5M18 9.5l-5 5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', alert: '<path d="M12 8v5M12 16.5v.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>'
  };
  // The Add button's dollar bill, drawn in the same thick outline as the wallet logo.
  const BILL = '<svg width="46" height="30" viewBox="0 0 46 30" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="2" width="42" height="26" rx="5"/><path d="M26.4 11.2c-.8-1-2-1.6-3.4-1.6-2 0-3.5 1.1-3.5 2.6 0 3.6 7.1 2 7.1 5.6 0 1.5-1.5 2.6-3.6 2.6-1.5 0-2.8-.6-3.6-1.7M23 7.4v2.2M23 20.4v2.2"/>' +
    '<path d="M8.5 9v0M37.5 21v0" stroke-width="3.6"/></svg>';
  function svg(p, o) { o = o || {}; return '<svg width="' + (o.size || 20) + '" height="' + (o.size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="' + (o.stroke || 'currentColor') +
    '" stroke-width="' + (o.w || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }

  /* ---------- Formatting ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function money(n, sign) {
    const v = E.round2(n), a = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + a;
  }
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dshort(s) { const d = E.parse(s); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function dlong(s) { const d = E.parse(s); return DOW[d.getUTCDay()] + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function range(w) { return w.start === w.end ? dlong(w.start) : dlong(w.start) + ' – ' + dlong(w.end); }
  function rangeShort(w) { return w.start === w.end ? dlong(w.start) : dshort(w.start) + ' – ' + dshort(w.end); }

  /* ---------- Back end ---------- */
  const SLOW = { voice: 1, scan: 1, addEntry: 1 };
  async function api(action, data) {
    const ctl = new AbortController(), secs = SLOW[action] ? 60 : 30, timer = setTimeout(() => ctl.abort(), secs * 1000);
    let res;
    try {
      res = await fetch(state.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctl.signal,
        body: JSON.stringify({ key: state.key, action: action, data: data || null }) });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('No reply from your Sheet after ' + secs + ' seconds, so it didn’t go through.');
      throw new Error('No connection, so it didn’t go through.');
    } finally { clearTimeout(timer); }
    let j; try { j = await res.json(); } catch (e) { throw new Error('Your Sheet sent back something unexpected. Check the web app URL.'); }
    if (!j.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  }
  async function run(btn, label, action, data, after) {
    if (state.busy) return null;
    state.busy = true;
    const old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = label; }
    try {
      const r = await api(action, data);
      if (r.who) setData(r);
      if (after) after(r); else if (r.toast) toast(r.toast);
      return r;
    } catch (err) {
      fail(err.message, () => run(null, label, action, data, after));
      return null;
    } finally {
      state.busy = false;
      if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = old; }
    }
  }
  /* The last numbers this phone saw, so Budget can open instantly and refresh in the background. */
  function localToday() { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); }
  function saveCache(d) { try { localStorage.setItem('budget.cache', JSON.stringify({ key: state.key, data: d })); } catch (e) { /* full or private mode */ } }
  function readCache() {
    try { const c = JSON.parse(localStorage.getItem('budget.cache') || 'null'); return c && c.key === state.key && c.data && c.data.today === localToday() ? c.data : null; }
    catch (e) { return null; }
  }
  function setData(d) {
    state.data = d;
    saveCache(d);
    setTheme(d);
  }
  function setTheme(d) {
    document.body.className = d.person.theme === 'rose' ? 'rose' : 'mint';
    const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = d.person.theme === 'rose' ? '#0E0A10' : '#050807';
  }

  /* ---------- Banners ---------- */
  let floatEl = null;
  function float(kind, title, sub, retry) {
    if (floatEl) floatEl.remove();
    const b = document.createElement('div');
    b.className = 'banner float ' + kind; b.setAttribute('role', kind === 'ok' ? 'status' : 'alert');
    b.innerHTML = '<span class="bicon">' + svg(kind === 'ok' ? I.check : I.alert, { size: 18, stroke: '#000', w: 2.6 }) + '</span>' +
      '<span class="grow"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span>' +
      (retry ? '<button class="mini" data-retry>Try again</button>' : '') +
      '<button class="iconbtn" style="background:transparent;width:36px;height:36px" aria-label="Dismiss">' + svg(I.x, { size: 16 }) + '</button>';
    b.addEventListener('click', e => { const r = e.target.closest('[data-retry]'); b.remove(); floatEl = null; if (r && retry) retry(); });
    document.body.appendChild(b); floatEl = b;
    if (kind === 'ok') setTimeout(() => { if (floatEl === b) { b.remove(); floatEl = null; } }, 2600);
  }
  function toast(t) { float('ok', t); }
  function fail(msg, retry) { float('fail', 'Didn’t go through', msg, retry); }

  /* ---------- Numbers for a window ---------- */
  function data() { return state.data; }
  function activeCats(d) { return d.categories.filter(c => !c.hidden); }
  function spentIn(d, w, catId) {
    const end = w.end < d.today ? w.end : d.today;
    return E.round2(d.entries.filter(e => e.date >= w.start && e.date <= end && e.categoryId !== 'adj' && e.categoryId !== 'maint' &&
      (catId ? e.categoryId === catId : true)).reduce((t, e) => t + e.amount, 0));
  }
  function adjIn(d, w) { return E.round2(d.entries.filter(e => e.categoryId === 'adj' && e.date >= w.start && e.date <= w.end).reduce((t, e) => t + e.amount, 0)); }

  /** Everything Home shows for the chosen view. */
  function snapshot(view) {
    const d = data(), p = d.person, native = view === 'native';
    const w = native ? d.period : E.windowFor(p, view, d.today);
    const st = d.state, cats = activeCats(d);
    const tiles = cats.map(c => {
      const base = c.budget == null ? 0 : c.budget;
      const carry = native ? (st.catCarry[c.id] || 0) : 0;
      const budget = E.round2((native ? base : E.convert(base, p.cadence, view, w.days)) + carry);
      const spent = spentIn(d, w, c.id);
      return { c: c, budget: budget, spent: spent, left: E.round2(budget - spent), pace: E.pace(spent, budget, w, d.today), notYet: c.budget == null };
    });
    const budgetSum = E.round2(tiles.reduce((t, x) => t + x.budget, 0));
    const spentSum = E.round2(tiles.reduce((t, x) => t + x.spent, 0));
    const adj = native ? adjIn(d, w) : 0;
    const extra = native ? E.round2(st.carry - st.paybackThisPeriod - adj) : 0;
    const available = E.round2(budgetSum + extra);
    return { w: w, tiles: tiles, budgetSum: budgetSum, spentSum: spentSum, adj: adj, available: available,
      remaining: E.round2(available - spentSum), pace: E.pace(spentSum, available, w, d.today) };
  }
  function paceWords(pc, left) {
    if (pc.overBudget) return { cls: 'over', text: 'Over budget' };
    if (pc.status === 'over') return { cls: 'over', text: 'Well ahead of pace' };
    if (pc.status === 'warn') return { cls: 'warn', text: 'Ahead of pace' };
    return { cls: '', text: '' };
  }

  /* ---------- Screens ---------- */
  function go(name, arg) { state.screen = name; window.scrollTo(0, 0); SCREENS[name](arg); }

  function connect(msg) {
    document.body.className = 'mint';
    app.innerHTML = '<div class="screen">' +
      '<div class="eyebrow">Budget</div><h1>Connect your Sheet</h1>' +
      '<p class="note">Paste the web app URL and <b>your own</b> app key from the setup log. Your key decides whose budget opens on this phone.</p>' +
      (msg ? '<div class="banner fail"><span class="bicon">' + svg(I.alert, { size: 18, stroke: '#000', w: 2.6 }) + '</span><span class="grow"><b>Couldn’t connect</b><span>' + esc(msg) + '</span></span></div>' : '') +
      '<div class="group"><div class="gi col"><label for="u">Web app URL</label><input id="u" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(state.api || '') + '"></div>' +
      '<div class="gi col"><label for="k">Your app key</label><input id="k" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(state.key || '') + '"></div></div>' +
      '<button class="primary" id="go">Connect</button></div>';
    document.getElementById('go').onclick = async (e) => {
      const u = document.getElementById('u').value.trim(), k = document.getElementById('k').value.trim();
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) { connect('The URL should start with https://script.google.com/ and end with /exec.'); return; }
      if (!k) { connect('Paste your app key.'); return; }
      state.api = u; state.key = k;
      e.target.disabled = true; e.target.textContent = 'Connecting…';
      try { const r = await api('load'); store.set('api', u); store.set('key', k); setData(r); go('home'); }
      catch (err) { connect(err.message); }
    };
  }

  function home() {
    const d = data(), p = d.person;
    const views = E.viewsFor(p);
    if (!views.some(v => v.id === state.view)) state.view = 'native';
    const s = snapshot(state.view), native = state.view === 'native';
    const daysLeft = E.diffDays(d.today, s.w.end);
    const st = d.state;
    let html = '<div class="screen has-actions">';

    // Banners
    d.newVehicles.forEach(v => {
      html += '<button class="banner info" data-newveh="' + esc(v.vehicle) + '"><span class="bicon">' + svg(I.car, { size: 18, stroke: '#000', w: 2.2 }) + '</span>' +
        '<span class="grow"><b>New vehicle found in Garage: ' + esc(v.vehicle) + '</b><span>Tap to set it up.</span></span></button>';
    });
    if (d.pendingChoice.length) {
      html += '<button class="banner info" data-choice><span class="bicon">' + svg(I.loop, { size: 18, stroke: '#000', w: 2.2 }) + '</span>' +
        '<span class="grow"><b>Where should last pay period’s leftover go?</b><span>Tap to choose.</span></span></button>';
    }
    if (st.debtTotal > 0) {
      const n = st.periodsLeft;
      html += '<div class="banner pay"><span class="bicon">' + svg(I.payback, { size: 18, stroke: '#2A1C10', w: 2.4 }) + '</span>' +
        '<span class="grow"><b>Paying back ' + money(st.debtTotal) + '</b><span>' + n + ' pay period' + (n === 1 ? '' : 's') + ' left at ' + money(p.paybackMax).replace('.00', '') + (n === 1 ? '' : ' each') + '</span></span></div>';
    }

    // Header
    html += '<div class="between"><span class="row" style="gap:10px"><span class="chip-me"><i></i>' + esc(d.who) + '</span>' +
      (state.refreshing ? '<span class="updating">Updating…</span>' : '') + '</span><div class="row" style="gap:8px">' +
      '<button class="iconbtn" data-go="stats" aria-label="Stats">' + svg(I.chart) + '</button>' +
      '<button class="iconbtn" data-go="settings" aria-label="Settings">' + svg(I.gear) + '</button></div></div>';
    html += '<h1 class="dates">' + esc(range(s.w)) + '</h1>';
    html += '<div class="seg">' + views.map(v => '<button data-view="' + v.id + '" aria-pressed="' + (v.id === state.view) + '">' + esc(v.label) + '</button>').join('') + '</div>';

    if (d.notStarted) {
      html += '<div class="hero"><div class="lbl">Your budget starts</div><div class="num" style="font-size:34px">' + esc(dlong(p.startDate)) + '</div>' +
        '<div class="meta"><span>' + money(s.budgetSum) + ' to spend that pay period</span></div></div>';
    } else {
      const pw = paceWords(s.pace), cls = s.remaining < 0 ? 'over' : pw.cls;
      html += '<div class="hero ' + cls + '"><div class="between"><span class="lbl">Total remaining</span>' + (pw.text ? '<span class="tag">' + pw.text + '</span>' : '') + '</div>' +
        '<div class="num">' + money(s.remaining) + '</div>' +
        '<div class="meta"><span>' + money(s.spentSum) + ' spent of ' + money(s.available) + '</span><span>' + (daysLeft <= 0 ? 'Last day' : daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left') + '</span></div>';
      if (native) {
        if (st.paybackThisPeriod > 0) html += '<div class="line">' + svg(I.payback, { size: 16, w: 2.2 }) + '<span class="grow">Payback this period</span><span>−' + money(st.paybackThisPeriod) + '</span></div>';
        const carried = E.round2(st.carry + E.sum(st.catCarry));
        if (carried > 0) html += '<div class="line">' + svg(I.loop, { size: 16, w: 2.2 }) + '<span class="grow">Carried over</span><span>' + money(carried, true) + '</span></div>';
        if (s.adj) html += '<div class="line">' + svg(I.loop, { size: 16, w: 2.2 }) + '<span class="grow">Fixes to past pay periods</span><span>' + money(-s.adj, true) + '</span></div>';
      }
      html += '</div>';
    }

    // Category tiles
    html += '<div class="tiles">' + s.tiles.map(t => {
      const pw = paceWords(t.pace), over = t.left < 0;
      const leftTxt = over ? money(-t.left) + ' over' : money(t.left) + ' left';
      const pct = t.budget > 0 ? Math.min(100, Math.round(t.spent / t.budget * 100)) : (t.spent > 0 ? 100 : 0);
      return '<div class="tile"><div class="between" style="align-items:baseline"><span class="name">' + esc(t.c.name) + '</span>' +
        '<span class="left ' + (pw.cls ? pw.cls + '-t' : '') + '">' + leftTxt + '</span></div>' +
        '<div class="barbg"><i class="' + pw.cls + '" style="width:' + pct + '%"></i></div>' +
        '<div class="sub"><span>' + money(t.spent) + ' of ' + money(t.budget) + (t.notYet ? ' · starts ' + dshort(t.c.countsFrom || d.nextPayday) : '') + '</span>' +
        (pw.text ? '<span class="' + pw.cls + '-t" style="font-weight:600">' + pw.text + '</span>' : '') + '</div>' +
        (t.c.gas ? '<div class="note-gas">⛽ Auto-filled from Garage. Log fill-ups there.</div>' : '') + '</div>';
    }).join('') + '</div>';

    // Vehicles
    const vs = d.vehicles.filter(v => v.active);
    if (vs.length) {
      html += '<div class="section">Car maintenance</div>' + vs.map(v =>
        '<button class="bar" data-veh="' + esc(v.vehicle) + '"><span class="well">' + svg(I.car, { size: 24, stroke: 'var(--accent)' }) + '</span>' +
        '<span class="grow"><span style="display:block;font-size:16px;font-weight:600">' + esc(v.vehicle) + '</span><span style="display:block;font-size:13px;color:var(--muted);margin-top:4px">Adds ' + money(v.perPayday) + ' each payday</span></span>' +
        '<span style="font-size:18px;font-weight:700" class="' + (v.balance < 0 ? 'over-t' : '') + '">' + money(v.balance) + '</span>' + svg(I.next, { size: 18, stroke: 'var(--muted)' }) + '</button>').join('');
    }

    // Actions
    html += '<div class="actions">' +
      '<button class="add" data-go="add" aria-label="Add expense">' + BILL + '</button>' +
      '<button class="round" data-go="talk" aria-label="Talk it in"' + (d.gemini ? '' : ' disabled') + '>' + svg(I.mic, { size: 24 }) + '</button>' +
      '<button class="round" data-go="scan" aria-label="Scan receipt"' + (d.gemini ? '' : ' disabled') + '>' + svg(I.cam, { size: 24 }) + '</button></div>';
    if (!d.gemini) html += '<p class="note center">Talk it in and Scan receipt turn on once the Gemini key is added to your Sheet’s script.</p>';
    html += '</div>';
    app.innerHTML = html;

    app.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; home(); });
    app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
    app.querySelectorAll('[data-veh]').forEach(b => b.onclick = () => go('vehicle', b.dataset.veh));
    app.querySelectorAll('[data-newveh]').forEach(b => b.onclick = () => go('newVehicle', b.dataset.newveh));
    const ch = app.querySelector('[data-choice]'); if (ch) ch.onclick = () => choiceSheet();
  }

  function header(title, backTo, extra) {
    return '<div class="row"><button class="iconbtn" data-back aria-label="Back">' + svg(I.back, { w: 2.2 }) + '</button><h1 class="grow">' + esc(title) + '</h1>' + (extra || '') + '</div>';
  }
  function wireBack(to) { const b = app.querySelector('[data-back]'); if (b) b.onclick = () => go(to || 'home'); }

  /* Quick entry, also the "Look right?" screen after Talk it in or Scan. */
  function add(prefill) {
    const d = data(), cats = activeCats(d).filter(c => !c.gas);
    const f = state.draft = prefill || { amount: '', categoryId: null, date: d.today, note: '', source: 'Manual', photo: null };
    if (!f.categoryId || !cats.some(c => c.id === f.categoryId)) {
      const last = store.get('last.' + d.who); f.categoryId = cats.some(c => c.id === last) ? last : (cats[0] && cats[0].id);
    }
    const look = f.source !== 'Manual';
    function amt() { const n = Number(f.amount || 0); return '$' + (f.amount === '' ? '0.00' : f.amount.indexOf('.') >= 0 ? f.amount : n.toLocaleString('en-US')); }
    app.innerHTML = '<div class="screen">' + header(look ? 'Look right?' : 'Add expense') +
      (f.photo ? '<img class="thumb" alt="Receipt photo" src="' + f.photo.preview + '">' : '') +
      '<div class="amount"><div class="eyebrow">Amount</div><div class="v" id="amt">' + esc(amt()) + '</div></div>' +
      '<div class="cats">' + cats.map(c => '<button data-cat="' + c.id + '" aria-pressed="' + (c.id === f.categoryId) + '">' + esc(c.name) + '</button>').join('') + '</div>' +
      '<div class="group"><div class="gi"><label for="dt">Date</label><input id="dt" type="date" value="' + esc(f.date) + '" max="' + esc(d.today) + '"></div>' +
      '<div class="gi col"><label for="nt">Note</label><input id="nt" maxlength="200" placeholder="Optional" value="' + esc(f.note) + '"></div></div>' +
      '<div class="keys">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map(k => '<button data-k="' + k + '">' + k + '</button>').join('') +
      '<button data-k="del" aria-label="Delete digit">' + svg(I.del, { size: 24 }) + '</button></div>' +
      '<button class="primary" id="save">Save</button></div>';
    wireBack('home');
    const out = document.getElementById('amt'), save = document.getElementById('save');
    const label = () => { save.textContent = Number(f.amount) > 0 ? 'Save ' + amt() : 'Save'; save.disabled = !(Number(f.amount) > 0); };
    label();
    app.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      if (k === 'del') f.amount = f.amount.slice(0, -1);
      else if (k === '.') { if (f.amount.indexOf('.') < 0) f.amount = (f.amount || '0') + '.'; }
      else { const dot = f.amount.indexOf('.'); if (dot >= 0 && f.amount.length - dot > 2) return; if (f.amount === '0') f.amount = ''; if (f.amount.replace('.', '').length >= 7) return; f.amount += k; }
      out.textContent = amt(); label();
    });
    app.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      f.categoryId = b.dataset.cat; app.querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-pressed', x === b));
    });
    document.getElementById('dt').onchange = e => { f.date = e.target.value || d.today; };
    document.getElementById('nt').oninput = e => { f.note = e.target.value; };
    save.onclick = () => {
      store.set('last.' + d.who, f.categoryId);
      run(save, 'Saving…', 'addEntry', { amount: Number(f.amount), categoryId: f.categoryId, date: f.date, note: f.note, source: f.source,
        photo: f.photo ? { mime: f.photo.mime, data: f.photo.data } : null }, r => { state.draft = null; go('home'); toast(r.toast || 'Saved'); });
    };
  }

  function talk() {
    app.innerHTML = '<div class="screen">' + header('Talk it in') +
      '<p class="note">Tap the button and say what you spent, like “eight dollars on a beer” or “fifty-seven at Wegmans.” Tap again to stop.</p>' +
      '<button class="mic" id="mic" aria-label="Start recording">' + svg(I.mic, { size: 64, w: 2 }) + '</button>' +
      '<p class="center note" id="st">Ready</p></div>';
    wireBack('home');
    const btn = document.getElementById('mic'), st = document.getElementById('st');
    let rec = null;
    btn.onclick = async () => {
      if (!rec) {
        try { rec = await M.startRecording(30); } catch (e) { fail(e.message || 'Couldn’t use the microphone.'); return; }
        btn.classList.add('rec'); btn.innerHTML = svg(I.stop, { size: 56 }); btn.setAttribute('aria-label', 'Stop recording'); st.textContent = 'Listening…';
        rec.timedOut.then(() => { if (rec) btn.click(); });
        return;
      }
      const r = rec; rec = null; btn.disabled = true; st.textContent = 'Reading what you said…';
      const audio = await r.stop();
      if (!audio || audio.seconds < 0.6) { st.textContent = 'That was too short. Try again.'; btn.disabled = false; btn.classList.remove('rec'); btn.innerHTML = svg(I.mic, { size: 64 }); return; }
      try {
        const res = await api('voice', { mime: audio.mime, data: audio.data });
        const p = res.parsed || {};
        add({ amount: p.amount ? String(p.amount) : '', categoryId: p.categoryId, date: p.date && p.date <= data().today ? p.date : data().today, note: p.note || '', source: 'Voice', photo: null });
        if (!p.amount) fail('Gemini didn’t catch an amount. Type it in.');
      } catch (e) { go('home'); fail(e.message); }
    };
  }

  async function scan() {
    let photo;
    try { photo = await M.pickPhoto(); } catch (e) { fail(e.message); return; }
    if (!photo) { home(); return; }
    app.innerHTML = '<div class="screen">' + header('Scan receipt') + '<img class="thumb" alt="Receipt photo" src="' + photo.preview + '"><p class="center note">Reading the receipt…</p><div class="spin" style="margin:16px auto"></div></div>';
    wireBack('home');
    try {
      const res = await api('scan', { mime: photo.mime, data: photo.data });
      const p = res.parsed || {};
      add({ amount: p.amount ? String(p.amount) : '', categoryId: p.categoryId, date: p.date && p.date <= data().today ? p.date : data().today, note: p.note || '', source: 'Scan', photo: photo });
      if (!p.amount) fail('Gemini couldn’t find a total. Type it in; the photo still saves.');
    } catch (e) {
      add({ amount: '', categoryId: null, date: data().today, note: '', source: 'Scan', photo: photo });
      fail(e.message);
    }
  }

  function vehicle(name) {
    const d = data(), v = d.vehicles.find(x => x.vehicle === name);
    if (!v) { home(); return; }
    const year = d.today.slice(0, 4);
    const repairs = d.entries.filter(e => e.categoryId === 'maint' && e.vehicle === name).sort((a, b) => a.date < b.date ? 1 : -1);
    const thisYear = E.round2(repairs.filter(e => e.date.slice(0, 4) === year).reduce((t, e) => t + e.amount, 0));
    const pct = v.yearly > 0 ? Math.min(100, Math.round(thisYear / v.yearly * 100)) : 0;
    app.innerHTML = '<div class="screen">' + header(v.vehicle) +
      '<div class="hero' + (v.balance < 0 ? ' over' : '') + '"><div class="lbl">Maintenance pot</div><div class="num">' + money(v.balance) + '</div>' +
      '<div class="meta"><span>Adds ' + money(v.perPayday) + ' each payday</span><span>' + money(v.yearly).replace('.00', '') + ' a year</span></div></div>' +
      '<div class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="kv"><span>Spent in ' + year + '</span><span>' + money(thisYear) + ' of ' + money(v.yearly) + '</span></div>' +
      '<div class="barbg"><i style="width:' + pct + '%"></i></div><div class="hint">Repairs come out of the pot, never your weekly budget. Log them in Garage.</div></div>' +
      '<div class="section">Repair history</div><div class="card" style="padding:0 16px">' +
      (repairs.length ? repairs.map(e => '<div class="item" style="cursor:default"><div class="grow"><div class="t">' + esc(e.note || 'Service') + '</div><div class="s">' + esc(dlong(e.date)) + '</div></div><div class="a">' + money(e.amount) + '</div></div>').join('')
        : '<div class="item" style="cursor:default"><div class="s">No repairs since the pot started on ' + esc(dlong(v.potStart)) + '.</div></div>') + '</div></div>';
    wireBack('home');
  }

  function newVehicle(name) {
    const d = data();
    let owner = null;
    app.innerHTML = '<div class="screen">' + header('New vehicle') +
      '<p class="note"><b>' + esc(name) + '</b> showed up in Garage. Its fill-ups and repairs are held aside until you set it up.</p>' +
      '<div class="section">Whose is it?</div><div class="cats"><button data-o="DK" aria-pressed="false">DK</button><button data-o="MF" aria-pressed="false">MF</button></div>' +
      '<div class="group"><div class="gi"><label for="yb">Yearly maintenance budget</label><input id="yb" class="n" inputmode="decimal" placeholder="$0"></div></div>' +
      '<button class="primary" id="sv" disabled>Save vehicle</button></div>';
    wireBack('home');
    const sv = document.getElementById('sv'), yb = document.getElementById('yb');
    const ok = () => { sv.disabled = !(owner && Number(yb.value.replace(/[$,]/g, '')) >= 0 && yb.value.trim() !== ''); };
    app.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { owner = b.dataset.o; app.querySelectorAll('[data-o]').forEach(x => x.setAttribute('aria-pressed', x === b)); ok(); });
    yb.oninput = ok;
    sv.onclick = () => run(sv, 'Saving…', 'assignVehicle', { vehicle: name, owner: owner, yearly: Number(yb.value.replace(/[$,]/g, '')) }, r => { go('home'); toast(r.toast); });
  }

  function choiceSheet() {
    const d = data(), pc = d.pendingChoice[0];
    if (!pc) return;
    const o = d.state.outcomes.find(x => x.start === pc.start) || {};
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = '<div class="sheet" role="dialog" aria-label="Choose where the leftover goes"><b style="font-size:18px">' + money(o.leftover || 0) + ' left from ' + esc(rangeShort(pc)) + '</b>' +
      '<p class="note" style="padding:0">Where should it go?</p>' +
      [['A', 'One pooled carryover', 'Adds to Total Remaining; any category can use it.'], ['B', 'Each category keeps its own', 'Food’s leftover stays with Food, and so on.'],
       ['C', 'Send to savings', 'This pay period starts fresh; your Saved total grows.']]
        .map(x => '<button class="opt" data-opt="' + x[0] + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></button>').join('') +
      '<button class="link" data-close>Decide later</button></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', e => {
      if (e.target === bg || e.target.closest('[data-close]')) { bg.remove(); return; }
      const b = e.target.closest('[data-opt]'); if (!b) return;
      bg.remove(); run(null, 'Saving…', 'chooseCarry', { start: pc.start, option: b.dataset.opt }, r => { home(); toast(r.toast); });
    });
  }

  /* ---------- Stats and History ---------- */
  function statViews(p) {
    const third = p.cadence === 'semimonthly' || p.cadence === 'biweekly' ? { id: 'native', label: p.cadence === 'biweekly' ? 'Bi-week' : 'Pay period' } : { id: 'biweek', label: 'Bi-week' };
    const week = p.cadence === 'weekly' ? { id: 'native', label: 'Week' } : { id: 'week', label: 'Week' };
    const month = p.cadence === 'monthly' ? { id: 'native', label: 'Month' } : { id: 'month', label: 'Month' };
    return [{ id: 'day', label: 'Day' }, week, third, month, { id: 'quarter', label: 'Quarter' }, { id: 'year', label: 'Year' }];
  }
  function windowBack(p, view, today, back) {
    let w = E.windowFor(p, view, today);
    for (let i = 0; i < back; i++) w = E.windowFor(p, view, E.addDays(w.start, -1));
    return w;
  }
  function budgetFor(w, view) {
    const d = data(), p = d.person;
    if (view === 'native') { const s = d.snapshots.find(x => x.start === w.start); if (s) return E.round2(E.sum(s.budgets)); }
    const total = activeCats(d).reduce((t, c) => t + (c.budget || c.baseBudget || 0), 0);
    return E.round2(view === 'native' ? total : E.convert(total, p.cadence, view, w.days));
  }

  function stats() {
    const d = data(), p = d.person, views = statViews(p);
    if (!views.some(v => v.id === state.statsView)) state.statsView = 'native';
    const view = state.statsView, w = windowBack(p, view, d.today, state.statsBack);
    const prev = windowBack(p, view, d.today, state.statsBack + 1);
    const budget = budgetFor(w, view), spent = spentIn(d, w), prevSpent = spentIn(d, prev);
    const elapsed = Math.max(1, Math.min(w.days, E.diffDays(w.start, d.today < w.end ? d.today : w.end) + 1));
    const perDay = d.today < w.start ? 0 : spent / elapsed;
    const change = prevSpent > 0 ? (spent - prevSpent) / prevSpent : null;
    const cats = activeCats(d);

    let html = '<div class="screen">' + header('Stats') +
      '<div class="seg"><button aria-pressed="true">Stats</button><button data-go="history" aria-pressed="false">History</button></div>' +
      '<div class="chips">' + views.map(v => '<button data-sv="' + v.id + '" aria-pressed="' + (v.id === view) + '">' + esc(v.label) + '</button>').join('') + '</div>' +
      '<div class="between"><button class="iconbtn" data-step="1" aria-label="Previous">' + svg(I.back, { size: 18, w: 2.2 }) + '</button>' +
      '<span style="font-size:16px;font-weight:600">' + esc(rangeShort(w)) + '</span>' +
      '<button class="iconbtn" data-step="-1" aria-label="Next"' + (state.statsBack === 0 ? ' disabled style="opacity:.35"' : '') + '>' + svg(I.next, { size: 18, w: 2.2 }) + '</button></div>';

    // 1. Summary
    const under = budget - spent;
    html += '<div class="stat2"><div class="stat wide"><span class="eyebrow">Spent</span><span class="huge">' + money(spent) + ' <span style="font-size:15px;font-weight:500;color:var(--muted)">of ' + money(budget) + '</span></span>' +
      '<span style="font-size:13px;font-weight:600" class="' + (under < 0 ? 'over-t' : '') + '" ' + (under >= 0 ? 'style="color:var(--accent)"' : '') + '>' + (under >= 0 ? money(under) + ' under budget' : money(-under) + ' over budget') + '</span></div>' +
      '<div class="stat"><span class="eyebrow">Per day</span><span class="big">' + money(perDay) + '</span></div>' +
      '<div class="stat"><span class="eyebrow">Vs previous</span><span class="big" style="color:' + (change == null ? 'var(--muted)' : change > 0 ? 'var(--over)' : 'var(--accent)') + '">' +
      (change == null ? '—' : (change > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(change * 100)) + '%') + '</span></div></div>';

    // 2. By category
    html += '<div class="card pad" style="display:flex;flex-direction:column;gap:14px"><span class="eyebrow">By category</span>' + cats.map(c => {
      const b = view === 'native' ? ((d.snapshots.find(x => x.start === w.start) || {}).budgets || {})[c.id] : null;
      const cb = E.round2(b != null ? b : (view === 'native' ? (c.budget || c.baseBudget || 0) : E.convert(c.budget || c.baseBudget || 0, p.cadence, view, w.days)));
      const cs = spentIn(d, w, c.id), pct = cb > 0 ? Math.min(100, Math.round(cs / cb * 100)) : (cs > 0 ? 100 : 0);
      return '<div style="display:flex;flex-direction:column;gap:8px"><div class="kv"><span style="color:var(--text)">' + esc(c.name) + '</span><span>' + money(cs) + ' / ' + money(cb).replace('.00', '') + '</span></div>' +
        '<div class="barbg"><i class="' + (cs > cb ? 'over' : '') + '" style="width:' + pct + '%"></i></div></div>';
    }).join('') + '</div>';

    // 3. Trend
    const trend = [];
    for (let i = 11; i >= 0; i--) { const tw = windowBack(p, view, d.today, state.statsBack + i); if (tw.end >= p.startDate) trend.push({ w: tw, spent: spentIn(d, tw), budget: budgetFor(tw, view) }); }
    html += '<div class="card pad" style="display:flex;flex-direction:column;gap:12px"><span class="eyebrow">' + (trend.length > 1 ? 'Last ' + trend.length : 'Trend') + '</span>' +
      (trend.length > 1 ? trendSvg(trend, d.today) : '<div class="hint">The trend fills in as pay periods go by.</div>') + '</div>';

    // 4. Scorecard (closed pay periods)
    const outs = d.state.outcomes;
    const underN = outs.filter(o => o.spentTotal <= o.budgetTotal).length;
    let streak = 0; for (let i = outs.length - 1; i >= 0 && outs[i].spentTotal <= outs[i].budgetTotal; i--) streak++;
    const unit = p.cadence === 'weekly' ? 'week' : 'pay period';
    html += '<div class="stat2"><div class="stat"><span class="eyebrow">Under budget</span><span class="big">' + (outs.length ? underN + ' of ' + outs.length : '—') + '</span><span class="hint">' + unit + 's closed</span></div>' +
      '<div class="stat"><span class="eyebrow">Streak</span><span class="big" style="color:var(--accent)">' + (outs.length ? streak + ' ' + unit + (streak === 1 ? '' : 's') : '—') + '</span><span class="hint">under budget</span></div></div>';

    // 5. Carryover and payback
    const st = d.state, carried = E.round2(st.carry + E.sum(st.catCarry));
    html += '<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><span class="eyebrow">Carryover and payback</span>' +
      '<div class="kv"><span>Carried over</span><span style="font-weight:700;color:var(--accent)">' + money(carried, true) + '</span></div>' +
      (outs.length > 1 ? sparkSvg(outs.slice(-12).map(o => o.carryOut)) : '') +
      (st.debtTotal > 0 ? '<div class="kv"><span>Payback</span><span style="font-weight:700;color:var(--pay)">' + money(st.debtTotal) + ' left</span></div><div class="hint">' + st.periodsLeft + ' pay period' + (st.periodsLeft === 1 ? '' : 's') + ' left at ' + money(p.paybackMax) + '</div>'
        : '<div class="hint">No payback in progress.</div>') +
      (st.saved > 0 ? '<div class="kv"><span>Saved total</span><span>' + money(st.saved) + '</span></div>' : '') + '</div>';

    // 6. Vehicles
    d.vehicles.forEach(v => {
      const year = w.end.slice(0, 4);
      const maint = E.round2(d.entries.filter(e => e.categoryId === 'maint' && e.vehicle === v.vehicle && e.date.slice(0, 4) === year).reduce((t, e) => t + e.amount, 0));
      const gas = E.round2(d.entries.filter(e => e.source === 'Garage fuel' && e.vehicle === v.vehicle && e.date >= w.start && e.date <= w.end).reduce((t, e) => t + e.amount, 0));
      html += '<div class="card pad" style="display:flex;flex-direction:column;gap:12px"><span class="eyebrow">Vehicles · ' + esc(v.vehicle) + '</span>' +
        '<div class="kv"><span>Maintenance pot</span><span style="font-weight:700" class="' + (v.balance < 0 ? 'over-t' : '') + '">' + money(v.balance) + '</span></div>' +
        '<div style="display:flex;flex-direction:column;gap:8px"><div class="kv"><span>Maintenance in ' + year + '</span><span>' + money(maint).replace('.00', '') + ' / ' + money(v.yearly).replace('.00', '') + '</span></div>' +
        '<div class="barbg"><i style="width:' + (v.yearly > 0 ? Math.min(100, Math.round(maint / v.yearly * 100)) : 0) + '%"></i></div></div>' +
        '<div class="kv"><span>Gas in this ' + esc((views.find(x => x.id === view) || {}).label || '').toLowerCase() + '</span><span>' + money(gas) + '</span></div>' +
        '<div class="note-gas">⛽ Auto-filled from Garage.</div></div>';
    });
    html += '</div>';
    app.innerHTML = html;
    wireBack('home');
    app.querySelector('[data-go=history]').onclick = () => go('history');
    app.querySelectorAll('[data-sv]').forEach(b => b.onclick = () => { state.statsView = b.dataset.sv; state.statsBack = 0; stats(); });
    app.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { const n = state.statsBack + Number(b.dataset.step); if (n >= 0) { state.statsBack = n; stats(); } });
  }

  function trendSvg(t, today) {
    const W = 314, H = 140, max = Math.max(1, ...t.map(x => Math.max(x.spent, x.budget))) * 1.08;
    const bw = 18, gap = t.length > 1 ? (W - 10 - bw * t.length) / (t.length - 1) : 0;
    const y = v => H - v / max * (H - 6);
    let s = '<svg width="100%" viewBox="0 0 ' + W + ' ' + (H + 20) + '" role="img" aria-label="Spending for the last 12 periods against budget">';
    const by = y(t[t.length - 1].budget);
    s += '<line x1="0" y1="' + by + '" x2="' + W + '" y2="' + by + '" stroke="var(--muted)" stroke-dasharray="4 4"/>';
    t.forEach((x, i) => {
      const h = Math.max(2, H - y(x.spent)), cur = x.w.end >= today;
      s += '<rect x="' + (5 + i * (bw + gap)) + '" y="' + (H - h) + '" width="' + bw + '" height="' + h + '" rx="5" fill="' + (x.spent > x.budget ? 'var(--over)' : 'var(--accent)') + '"' + (cur ? ' opacity=".5"' : '') + '><title>' + esc(rangeShort(x.w)) + ': ' + money(x.spent) + '</title></rect>';
    });
    s += '<line x1="0" y1="' + (H + .5) + '" x2="' + W + '" y2="' + (H + .5) + '" stroke="var(--line)"/>' +
      '<text x="5" y="' + (H + 16) + '" font-size="10" fill="var(--muted)" font-family="Sora,sans-serif">' + esc(dshort(t[0].w.start)) + '</text>' +
      '<text x="' + (W - 5) + '" y="' + (H + 16) + '" text-anchor="end" font-size="10" fill="var(--muted)" font-family="Sora,sans-serif">' + esc(dshort(t[t.length - 1].w.start)) + '</text></svg>';
    return s + '<div class="hint">Dashed line: budget. Bars over budget are red; this period is faded.</div>';
  }
  function sparkSvg(vals) {
    const W = 314, H = 44, max = Math.max(1, ...vals), n = vals.length;
    const pts = vals.map((v, i) => (n === 1 ? 0 : i * W / (n - 1)).toFixed(1) + ',' + (H - 4 - v / max * (H - 8)).toFixed(1)).join(' ');
    return '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Carried-over balance over recent pay periods"><polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function history() {
    const d = data(), cats = d.categories;
    const q = state.histQuery.toLowerCase();
    const list = d.entries.filter(e => (state.histCat === 'all' || e.categoryId === state.histCat) &&
      (!q || (e.note + ' ' + e.category + ' ' + e.vehicle + ' ' + e.amount).toLowerCase().indexOf(q) >= 0))
      .sort((a, b) => a.date === b.date ? (a.time < b.time ? 1 : -1) : (a.date < b.date ? 1 : -1)).slice(0, 300);
    const filters = [{ id: 'all', name: 'All' }].concat(cats.map(c => ({ id: c.id, name: c.name + (c.hidden ? ' (removed)' : '') })), [{ id: 'maint', name: 'Car maintenance' }]);
    app.innerHTML = '<div class="screen">' + header('History') +
      '<div class="seg"><button data-go="stats" aria-pressed="false">Stats</button><button aria-pressed="true">History</button></div>' +
      '<input class="search" id="q" type="search" placeholder="Search notes, amounts" value="' + esc(state.histQuery) + '" aria-label="Search">' +
      '<div class="chips">' + filters.map(f => '<button data-f="' + f.id + '" aria-pressed="' + (f.id === state.histCat) + '">' + esc(f.name) + '</button>').join('') + '</div>' +
      '<div class="card" style="padding:0 16px">' + (list.length ? list.map(e => {
        const sub = dlong(e.date) + (e.time ? ' · ' + e.time : '') + (e.source && e.source !== 'Manual' ? ' · ' + e.source : '') + (e.vehicle ? ' · ' + e.vehicle : '');
        return '<button class="item" data-e="' + esc(e.id) + '"><div class="grow"><div class="t">' + esc(e.categoryId === 'adj' ? 'Carryover adjustment' : e.category) + '</div>' +
          '<div class="s">' + esc(sub) + (e.note ? '<br>' + esc(e.note) : '') + '</div></div><div class="a">' + money(e.categoryId === 'adj' ? -e.amount : e.amount, e.categoryId === 'adj') + '</div></button>';
      }).join('') : '<div class="item" style="cursor:default"><div class="s">Nothing here yet.</div></div>') + '</div></div>';
    wireBack('home');
    app.querySelector('[data-go=stats]').onclick = () => go('stats');
    const qi = document.getElementById('q');
    qi.oninput = () => { state.histQuery = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { history(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
    app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.histCat = b.dataset.f; history(); });
    app.querySelectorAll('[data-e]').forEach(b => b.onclick = () => go('edit', b.dataset.e));
  }

  function edit(id) {
    const d = data(), e = d.entries.find(x => x.id === id);
    if (!e) { history(); return; }
    const locked = e.source.indexOf('Garage') === 0 || e.categoryId === 'adj';
    if (locked) {
      app.innerHTML = '<div class="screen">' + header(e.categoryId === 'adj' ? 'Carryover adjustment' : e.category) +
        '<div class="amount"><div class="eyebrow">' + esc(dlong(e.date)) + '</div><div class="v">' + money(e.categoryId === 'adj' ? -e.amount : e.amount, e.categoryId === 'adj') + '</div></div>' +
        '<div class="card pad"><div class="kv"><span>Source</span><span>' + esc(e.source) + '</span></div>' + (e.vehicle ? '<div class="kv" style="margin-top:8px"><span>Vehicle</span><span>' + esc(e.vehicle) + '</span></div>' : '') +
        (e.note ? '<div class="kv" style="margin-top:8px"><span>Note</span><span>' + esc(e.note) + '</span></div>' : '') + '</div>' +
        '<p class="note">' + (e.categoryId === 'adj' ? 'This moves your carryover because an entry from a closed pay period changed. It isn’t spending.' : 'This came from Garage. Edit or delete it there and Budget follows.') + '</p></div>';
      wireBack('history'); return;
    }
    const cats = d.categories.filter(c => !c.gas && (!c.hidden || c.id === e.categoryId));
    const f = { amount: String(e.amount), categoryId: e.categoryId, date: e.date, note: e.note };
    app.innerHTML = '<div class="screen">' + header('Edit entry') +
      (e.receipt ? '<a class="link" href="' + esc(e.receipt) + '" target="_blank" rel="noopener">Open receipt photo</a>' : '') +
      '<div class="group"><div class="gi"><label for="ea">Amount</label><input id="ea" class="n" inputmode="decimal" value="' + esc(f.amount) + '"></div>' +
      '<div class="gi"><label for="ed">Date</label><input id="ed" type="date" value="' + esc(f.date) + '" max="' + esc(d.today) + '"></div>' +
      '<div class="gi col"><label for="en">Note</label><input id="en" maxlength="200" value="' + esc(f.note) + '"></div></div>' +
      '<div class="cats">' + cats.map(c => '<button data-cat="' + c.id + '" aria-pressed="' + (c.id === f.categoryId) + '">' + esc(c.name) + '</button>').join('') + '</div>' +
      (e.date < d.period.start ? '<p class="note">This is from a closed pay period. Your stats update right away, and the difference is added to this pay period’s carryover.</p>' : '') +
      '<button class="primary" id="sv">Save changes</button><button class="danger" id="dl">Delete entry</button></div>';
    wireBack('history');
    app.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { f.categoryId = b.dataset.cat; app.querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    document.getElementById('sv').onclick = (ev) => {
      const amount = Number(document.getElementById('ea').value.replace(/[$,]/g, ''));
      if (!(amount > 0)) { fail('Enter an amount above $0.'); return; }
      run(ev.target, 'Saving…', 'updateEntry', { id: id, amount: amount, categoryId: f.categoryId, date: document.getElementById('ed').value || e.date, note: document.getElementById('en').value },
        r => { go('history'); toast(r.toast); });
    };
    document.getElementById('dl').onclick = (ev) => {
      if (!confirm('Delete this ' + money(e.amount) + ' entry? This can’t be undone.')) return;
      run(ev.target, 'Deleting…', 'deleteEntry', { id: id }, r => { go('history'); toast(r.toast); });
    };
  }

  /* ---------- Settings ---------- */
  function amountWords(p) {
    return { weekly: 'Enter your weekly amount (you’re paid weekly).', biweekly: 'Enter your amount per pay period (you’re paid every two weeks).',
      semimonthly: 'Enter your amount per pay period (you’re paid on the 1st and 15th).', monthly: 'Enter your monthly amount (you’re paid monthly).' }[p.cadence];
  }
  function settings() {
    const d = data(), p = d.person, shown = d.categories.filter(c => !c.hidden), hidden = d.categories.filter(c => c.hidden);
    const pc = p.pendingCadence || p.cadence, pp = p.pendingPayday !== '' && p.pendingPayday != null ? p.pendingPayday : p.payday, po = p.pendingOption || p.option;
    const when = d.notStarted ? 'right away' : 'on your next payday, ' + dlong(d.nextPayday);
    let html = '<div class="screen">' + header('Settings') +
      '<p class="note">Changes start ' + esc(when) + '. Past pay periods never change.</p>' +
      '<div class="section">Budgets</div><div class="group"><div class="gi col" style="padding-bottom:4px"><span class="hint">' + esc(amountWords(p)) + '</span></div>' +
      shown.map(c => '<div class="gi"><label for="b' + c.id + '">' + esc(c.name) + (c.gas ? ' ⛽' : '') +
        (c.pendingBudget != null ? '<span class="hint" style="display:block">' + money(c.pendingBudget) + ' from ' + esc(dshort(c.pendingFrom)) + '</span>' : '') + '</label>' +
        '<input class="n" id="b' + c.id + '" data-b="' + c.id + '" inputmode="decimal" value="' + (c.pendingBudget != null ? c.pendingBudget : c.baseBudget).toFixed(2) + '"></div>').join('') + '</div>' +
      '<div class="section">Pay schedule</div><div class="group"><div class="gi"><label for="cad">Paid</label><select id="cad">' +
      [['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['semimonthly', '1st and 15th'], ['monthly', 'Monthly']].map(x => '<option value="' + x[0] + '"' + (x[0] === pc ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select></div>' +
      '<div class="gi" id="pdrow"></div></div>' +
      '<div class="section">Leftover money each payday</div><div style="display:flex;flex-direction:column;gap:8px">' +
      [['A', 'One pooled carryover', 'Adds to Total Remaining; any category can use it.'], ['B', 'Each category keeps its own', 'Leftovers stay with the category they came from.'],
       ['C', 'Send to savings', 'Each pay period starts fresh; a Saved total grows.'], ['D', 'Choose each payday', 'Budget asks you after each payday.']]
        .map(x => '<button class="opt" data-opt="' + x[0] + '" aria-pressed="' + (x[0] === po) + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></button>').join('') + '</div>' +
      '<p class="hint" style="padding:0 6px">Overspending is paid back in pieces of up to ' + money(p.paybackMax) + ' per pay period.</p>' +
      '<button class="primary" id="save">Save settings</button>' +
      '<div class="section">Categories</div><div class="group">' + shown.map(c => '<div class="gi"><span>' + esc(c.name) + '</span><span class="row" style="gap:6px"><button class="mini" data-ren="' + c.id + '">Rename</button>' +
        (c.gas ? '' : '<button class="mini" data-hide="' + c.id + '">Remove</button>') + '</span></div>').join('') +
      hidden.map(c => '<div class="gi"><span style="color:var(--muted)">' + esc(c.name) + ' (removed)</span><button class="mini" data-res="' + c.id + '">Restore</button></div>').join('') +
      '<div class="gi"><span>New category</span><button class="mini" id="addc">Add</button></div></div>' +
      '<div class="section">Vehicles</div><div class="group">' + (d.vehicles.length ? d.vehicles.map(v => '<div class="gi"><label for="v' + esc(v.vehicle) + '">' + esc(v.vehicle) + ' <span class="hint" style="display:block">Yearly maintenance pot</span></label>' +
        '<span class="row" style="gap:6px"><input class="n" style="width:104px" id="v' + esc(v.vehicle) + '" inputmode="decimal" value="' + v.yearly.toFixed(0) + '"><button class="mini" data-veh="' + esc(v.vehicle) + '">Save</button></span></div>').join('')
        : '<div class="gi"><span class="hint">No vehicles assigned to you.</span></div>') + '</div>' +
      '<div class="section">This phone</div><div class="group"><div class="gi"><span>Connected as</span><span>' + esc(d.who) + '</span></div>' +
      '<div class="gi"><span>Talk it in and Scan</span><span>' + (d.gemini ? 'On' : 'Off — add the Gemini key') + '</span></div>' +
      '<div class="gi"><span>Connection</span><button class="mini" id="disc">Change</button></div></div></div>';
    app.innerHTML = html;
    wireBack('home');

    let opt = po;
    const pdrow = document.getElementById('pdrow'), cad = document.getElementById('cad');
    function payRow() {
      const c = cad.value;
      if (c === 'weekly') pdrow.innerHTML = '<label for="pd">Payday</label><select id="pd">' + DOW.map((n, i) => '<option value="' + i + '"' + (Number(pp) === i ? ' selected' : '') + '>' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i] + '</option>').join('') + '</select>';
      else if (c === 'biweekly') pdrow.innerHTML = '<label for="pd">A recent payday</label><input id="pd" type="date" value="' + esc(p.anchor || d.today) + '">';
      else if (c === 'monthly') pdrow.innerHTML = '<label for="pd">Day of the month</label><input id="pd" class="n" style="width:80px" inputmode="numeric" value="' + esc(pp || 1) + '">';
      else pdrow.innerHTML = '<span class="hint">Pay periods run the 1st–14th and the 15th–end of month.</span>';
    }
    payRow(); cad.onchange = payRow;
    app.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => { opt = b.dataset.opt; app.querySelectorAll('[data-opt]').forEach(x => x.setAttribute('aria-pressed', x === b)); });

    document.getElementById('save').onclick = (ev) => {
      const budgets = {};
      let bad = false;
      app.querySelectorAll('[data-b]').forEach(i => { const v = Number(i.value.replace(/[$,]/g, '')); if (!(v >= 0)) bad = true; budgets[i.dataset.b] = v; });
      if (bad) { fail('Budgets must be numbers, $0 or more.'); return; }
      const c = cad.value, pdEl = document.getElementById('pd');
      const data = { budgets: budgets, cadence: c, option: opt };
      if (c === 'weekly') data.payday = Number(pdEl.value);
      else if (c === 'monthly') data.payday = Math.min(31, Math.max(1, Number(pdEl.value) || 1));
      else if (c === 'biweekly') { data.anchor = pdEl.value; data.payday = ''; }
      else data.payday = '';
      run(ev.target, 'Saving…', 'saveSettings', data, r => { settings(); toast(r.toast); });
    };
    app.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => {
      const c = d.categories.find(x => x.id === b.dataset.ren), n = prompt('New name for ' + c.name + ' (past entries move to the new name):', c.name);
      if (n && n.trim() && n.trim() !== c.name) run(null, '', 'renameCategory', { id: c.id, name: n.trim() }, r => { settings(); toast(r.toast); });
    });
    app.querySelectorAll('[data-hide]').forEach(b => b.onclick = () => {
      const c = d.categories.find(x => x.id === b.dataset.hide);
      if (confirm('Remove ' + c.name + '? It disappears from Home and Add, its history stays in Stats, and its budget stops counting on your next payday. You can restore it later.'))
        run(null, '', 'hideCategory', { id: c.id }, r => { settings(); toast(r.toast); });
    });
    app.querySelectorAll('[data-res]').forEach(b => b.onclick = () => run(null, '', 'restoreCategory', { id: b.dataset.res }, r => { settings(); toast(r.toast); }));
    document.getElementById('addc').onclick = () => {
      const n = prompt('Name of the new category:'); if (!n || !n.trim()) return;
      const amt = prompt(amountWords(p) + '\nBudget for ' + n.trim() + ':', '0'); if (amt == null) return;
      const v = Number(String(amt).replace(/[$,]/g, '')); if (!(v >= 0)) { fail('That budget isn’t a number.'); return; }
      run(null, '', 'addCategory', { name: n.trim(), budget: v }, r => { settings(); toast(r.toast + '. Its budget starts ' + (d.notStarted ? 'with your first pay period.' : dlong(d.nextPayday) + '.')); });
    };
    app.querySelectorAll('[data-veh]').forEach(b => b.onclick = () => {
      const v = d.vehicles.find(x => x.vehicle === b.dataset.veh), input = document.getElementById('v' + v.vehicle);
      const y = Number(input.value.replace(/[$,]/g, '')); if (!(y >= 0)) { fail('Enter a yearly amount.'); return; }
      run(b, '…', 'assignVehicle', { vehicle: v.vehicle, owner: v.owner, yearly: y }, r => { settings(); toast(r.toast); });
    });
    document.getElementById('disc').onclick = () => connect();
  }

  const SCREENS = { home: home, add: add, talk: talk, scan: scan, vehicle: vehicle, newVehicle: newVehicle, stats: stats, history: history, edit: edit, settings: settings };

  /* ---------- Start ---------- */
  async function start() {
    if (!state.api || !state.key) { connect(); return; }
    const cached = readCache();
    if (cached) {
      // Show the last numbers right away, then swap in fresh ones.
      state.data = cached; setTheme(cached); state.refreshing = true; go('home');
      try {
        const r = await api('load'); state.refreshing = false; setData(r);
        if (state.screen === 'home' && !state.busy) home();
      } catch (err) {
        state.refreshing = false;
        if (state.screen === 'home') home();
        if (/Not authorized/.test(err.message)) { connect(err.message); return; }
        float('fail', 'Couldn’t refresh', 'Showing your last numbers. ' + err.message, start);
      }
      return;
    }
    try { setData(await api('load')); go('home'); }
    catch (err) {
      if (/Not authorized/.test(err.message)) { connect(err.message); return; }
      app.innerHTML = '<div class="screen"><h1>Budget</h1><div class="banner fail"><span class="bicon">' + svg(I.alert, { size: 18, stroke: '#000', w: 2.6 }) + '</span><span class="grow"><b>Couldn’t reach your Sheet</b><span>' + esc(err.message) + '</span></span></div>' +
        '<button class="primary" id="re">Try again</button><button class="secondary" id="cn">Check connection</button></div>';
      document.getElementById('re').onclick = start; document.getElementById('cn').onclick = () => connect();
    }
  }
  // Refresh when the app comes back to the front, so paydays and Garage fill-ups show up.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.data && !state.busy && document.querySelector('.add')) {
      api('load').then(r => { setData(r); if (document.querySelector('.add')) home(); }).catch(() => {});
    }
  });
  window.BudgetApp = { state: state, go: go, snapshot: snapshot };
  start();
})();
