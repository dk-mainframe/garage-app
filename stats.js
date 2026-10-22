/* Stats screen: KPI tiles and three charts, drawn as SVG with tap/hover tooltips.
   Colors were checked with a palette validator against the dark card (#232326):
   fuel #C98010 and service #4F8FE6 pass lightness, CVD separation, and contrast. */
(function (root) {
  'use strict';
  const FUEL = '#C98010', SERVICE = '#4F8FE6';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const money2 = n => '$' + n.toFixed(2);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parse = iso => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const label = iso => { const d = parse(iso); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); };

  /** Totals and series for a time range. range: '12m' | 'all'. */
  function compute(data, range) {
    const now = new Date(), from = range === '12m' ? new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()) : new Date(1900, 0, 1);
    const fills = data.fills.filter(f => f.date && parse(f.date) >= from);
    const services = data.services.filter(s => s.date && parse(s.date) >= from);
    const mpgs = fills.filter(f => f.mpg).map(f => f.mpg);
    const fuel = fills.reduce((a, f) => a + (f.total || 0), 0);
    const svc = services.reduce((a, s) => a + (s.cost || 0), 0);
    const gal = fills.reduce((a, f) => a + (f.gal || 0), 0);
    const odos = fills.map(f => f.odo).concat(services.map(s => s.odo)).filter(Boolean);
    const miles = odos.length > 1 ? Math.max.apply(null, odos) - Math.min.apply(null, odos) : 0;
    // Monthly buckets (quarters when the range is long).
    const start = fills.concat(services).map(s => parse(s.date)).sort((a, b) => a - b)[0] || now;
    const months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth() + 1;
    const step = range === 'all' && months > 18 ? 3 : 1;
    const span = range === '12m' ? 12 : Math.ceil(months / step);
    const buckets = [];
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i * step, 1);
      const s0 = step === 3 ? new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1) : d;
      const key = step === 3 ? 'Q' + (Math.floor(s0.getMonth() / 3) + 1) + ' ' + String(s0.getFullYear()).slice(2) : MON[s0.getMonth()] + (s0.getMonth() === 0 || i === span - 1 ? ' ' + String(s0.getFullYear()).slice(2) : '');
      if (buckets.length && buckets[buckets.length - 1].start.getTime() === s0.getTime()) continue;
      buckets.push({ key: key, start: s0, end: new Date(s0.getFullYear(), s0.getMonth() + step, 1), fuel: 0, service: 0 });
    }
    fills.forEach(f => { const d = parse(f.date), b = buckets.find(x => d >= x.start && d < x.end); if (b) b.fuel += f.total || 0; });
    services.forEach(s => { const d = parse(s.date), b = buckets.find(x => d >= x.start && d < x.end); if (b) b.service += s.cost || 0; });
    return {
      kpi: {
        avgMpg: mpgs.length ? mpgs.reduce((a, b) => a + b, 0) / mpgs.length : null,
        bestMpg: mpgs.length ? Math.max.apply(null, mpgs) : null,
        miles: miles, fuel: fuel, service: svc, perMile: miles ? (fuel + svc) / miles : null,
        avgPrice: gal ? fuel / gal : null, fillups: fills.length
      },
      mpg: fills.filter(f => f.mpg).map(f => ({ x: f.date, y: f.mpg })),
      price: fills.filter(f => f.price).map(f => ({ x: f.date, y: f.price })),
      buckets: buckets, step: step
    };
  }

  function tile(lbl, value, sub) {
    return '<div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:4px;min-width:0"><span class="eyebrow" style="font-size:11px">' + lbl + '</span>' +
      '<span style="font-size:22px;font-weight:600;font-variant-numeric:tabular-nums">' + value + '</span>' + (sub ? '<span style="font-size:12px;color:var(--muted)">' + sub + '</span>' : '') + '</div>';
  }

  /** Line chart with a recessive average line, end-point label, and a crosshair tooltip. */
  function lineChart(id, title, pts, fmtY, avg, avgLabel) {
    if (pts.length < 2) return chartCard(title, '<div class="note" style="padding:20px 0">Not enough data in this range yet.</div>', '');
    const W = 350, H = 170, L = 36, R = 12, T = 12, B = 26;
    const ys = pts.map(p => p.y), lo0 = Math.min.apply(null, ys), hi0 = Math.max.apply(null, ys), pad = (hi0 - lo0) * 0.12 || 1;
    const lo = lo0 - pad, hi = hi0 + pad;
    const t0 = parse(pts[0].x).getTime(), t1 = parse(pts[pts.length - 1].x).getTime() || t0 + 1;
    const X = t => L + (W - L - R) * ((t - t0) / Math.max(1, t1 - t0)), Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const coords = pts.map(p => [X(parse(p.x).getTime()), Y(p.y)]);
    const ticks = [lo0, (lo0 + hi0) / 2, hi0];
    const grid = ticks.map(v => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="#36363C" stroke-width="1"></line>' +
      '<text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#A8A8B0">' + esc(fmtY(v, true)) + '</text>').join('');
    const xl = [pts[0], pts[pts.length - 1]].map((p, i) => '<text x="' + (i ? W - R : L) + '" y="' + (H - 6) + '" text-anchor="' + (i ? 'end' : 'start') + '" font-size="10" fill="#A8A8B0">' + esc(label(p.x)) + '</text>').join('');
    const avgLine = avg != null ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(avg).toFixed(1) + '" y2="' + Y(avg).toFixed(1) + '" stroke="#8E8E96" stroke-width="1" stroke-dasharray="4 4"></line>' +
      '<text x="' + (W - R) + '" y="' + (Y(avg) - 5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#A8A8B0">' + esc(avgLabel) + '</text>' : '';
    const last = coords[coords.length - 1];
    const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(title) + ', ' + pts.length + ' points" data-chart="' + id + '" style="display:block;touch-action:pan-y">' +
      grid + avgLine + xl +
      '<polyline points="' + coords.map(c => c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ') + '" fill="none" stroke="' + FUEL + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="4" fill="' + FUEL + '" stroke="#232326" stroke-width="2"></circle>' +
      '<line class="xh" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="#D6D6DC" stroke-width="1" opacity="0"></line>' +
      '<circle class="xd" r="5" fill="' + FUEL + '" stroke="#232326" stroke-width="2" opacity="0"></circle></svg>';
    const table = '<table style="width:100%;font-size:13px;border-collapse:collapse">' + pts.slice().reverse().map(p =>
      '<tr><td style="padding:4px 0;color:var(--muted)">' + esc(label(p.x)) + '</td><td style="text-align:right">' + esc(fmtY(p.y)) + '</td></tr>').join('') + '</table>';
    root.__charts[id] = { kind: 'line', coords: coords, pts: pts, fmt: p => label(p.x) + ' · ' + fmtY(p.y) };
    return chartCard(title, svg, table);
  }

  /** Stacked monthly bars, fuel under service, 2px gap between segments, tap tooltip. */
  function barChart(id, title, buckets) {
    const W = 350, H = 180, L = 40, R = 8, T = 10, B = 26;
    const max = Math.max(1, Math.max.apply(null, buckets.map(b => b.fuel + b.service)));
    const n = buckets.length, slot = (W - L - R) / n, bw = Math.max(4, Math.min(22, slot - 6));
    const Y = v => T + (H - T - B) * (1 - v / max);
    const ticks = [0, max / 2, max];
    const grid = ticks.map(v => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="#36363C" stroke-width="1"></line>' +
      '<text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#A8A8B0">' + money(v) + '</text>').join('');
    const bars = buckets.map((b, i) => {
      const x = L + slot * i + (slot - bw) / 2, base = Y(0), yf = Y(b.fuel), ys = Y(b.fuel + b.service);
      const fuelH = base - yf, svcH = yf - ys;
      const r = Math.min(4, bw / 2);
      const seg = (y, h, c, top) => h <= 0.5 ? '' : top
        ? '<path d="M' + x + ',' + (y + h) + 'v' + (-(h - r)) + 'q0,' + (-r) + ' ' + r + ',' + (-r) + 'h' + (bw - 2 * r) + 'q' + r + ',0 ' + r + ',' + r + 'v' + (h - r) + 'z" fill="' + c + '"></path>'
        : '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" fill="' + c + '"></rect>';
      const svcTop = b.service > 0;
      return seg(yf, Math.max(0, fuelH - (svcTop && fuelH > 2 ? 2 : 0)) , FUEL, !svcTop) + seg(ys, svcH, SERVICE, true) +
        (i % Math.ceil(n / 6) === 0 || i === n - 1 ? '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#A8A8B0">' + esc(b.key) + '</text>' : '') +
        '<rect class="hit" data-i="' + i + '" x="' + (L + slot * i) + '" y="' + T + '" width="' + slot + '" height="' + (H - T - B) + '" fill="transparent"></rect>';
    }).join('');
    const legend = '<div class="row" style="gap:16px;font-size:12px;color:var(--soft);margin:2px 0 6px">' +
      '<span class="row" style="gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:' + FUEL + '"></span>Fuel</span>' +
      '<span class="row" style="gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:' + SERVICE + '"></span>Service</span></div>';
    const svg = legend + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(title) + '" data-chart="' + id + '" style="display:block">' + grid + bars + '</svg>';
    const table = '<table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th style="text-align:left;color:var(--muted);font-weight:500">Period</th><th style="text-align:right;color:var(--muted);font-weight:500">Fuel</th><th style="text-align:right;color:var(--muted);font-weight:500">Service</th></tr>' +
      buckets.slice().reverse().map(b => '<tr><td style="padding:4px 0">' + esc(b.key) + '</td><td style="text-align:right">' + money(b.fuel) + '</td><td style="text-align:right">' + money(b.service) + '</td></tr>').join('') + '</table>';
    root.__charts[id] = { kind: 'bar', buckets: buckets, slot: slot, L: L, fmt: b => b.key + ' · Fuel ' + money(b.fuel) + ' · Service ' + money(b.service) };
    return chartCard(title, svg, table);
  }

  function chartCard(title, body, table) {
    return '<div class="card" style="padding:14px 16px;position:relative"><div style="font-size:15px;font-weight:600;margin-bottom:6px">' + esc(title) + '</div>' + body +
      '<div class="ctip" role="status" style="position:absolute;top:10px;right:12px;font-size:12px;color:var(--text);background:#000;border:1px solid #36363C;border-radius:8px;padding:4px 8px;opacity:0;pointer-events:none;transition:opacity .15s"></div>' +
      (table ? '<details style="margin-top:8px"><summary style="font-size:13px;color:var(--muted);cursor:pointer;min-height:32px;display:flex;align-items:center">View as table</summary><div style="max-height:220px;overflow:auto;margin-top:6px">' + table + '</div></details>' : '') + '</div>';
  }

  function render(data, range) {
    root.__charts = {};
    const c = compute(data, range), k = c.kpi;
    const mpgFmt = (v, axis) => axis ? v.toFixed(0) : v.toFixed(1) + ' mpg';
    const priceFmt = (v, axis) => '$' + v.toFixed(axis ? 2 : 3);
    return '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' +
        tile('Avg MPG', k.avgMpg != null ? k.avgMpg.toFixed(1) : '—', k.bestMpg != null ? 'Best ' + k.bestMpg.toFixed(1) : '') +
        tile('Cost per mile', k.perMile != null ? '$' + k.perMile.toFixed(2) : '—', 'Fuel + service') +
        tile('Fuel spend', money(k.fuel), k.fillups + ' fill-ups') +
        tile('Service spend', money(k.service), 'Logged visits') +
        tile('Miles driven', k.miles ? Math.round(k.miles).toLocaleString('en-US') : '—', '') +
        tile('Avg price / gal', k.avgPrice != null ? '$' + k.avgPrice.toFixed(3) : '—', '') + '</div>' +
      lineChart('mpg', 'MPG per full tank', c.mpg, mpgFmt, k.avgMpg, k.avgMpg != null ? 'avg ' + k.avgMpg.toFixed(1) : '') +
      barChart('spend', c.step === 3 ? 'Spending by quarter' : 'Spending by month', c.buckets) +
      lineChart('price', 'Price per gallon', c.price, priceFmt, k.avgPrice, k.avgPrice != null ? 'avg $' + k.avgPrice.toFixed(2) : '');
  }

  /** Wires tap/hover tooltips on every chart inside el. */
  function wire(el) {
    el.querySelectorAll('svg[data-chart]').forEach(svg => {
      const ch = root.__charts[svg.dataset.chart]; if (!ch) return;
      const tip = svg.closest('.card').querySelector('.ctip');
      const toX = e => { const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal; return (e.clientX - r.left) / r.width * vb.width; };
      const show = e => {
        const x = toX(e);
        if (ch.kind === 'line') {
          let best = 0; ch.coords.forEach((c, i) => { if (Math.abs(c[0] - x) < Math.abs(ch.coords[best][0] - x)) best = i; });
          const c = ch.coords[best], xh = svg.querySelector('.xh'), xd = svg.querySelector('.xd');
          xh.setAttribute('x1', c[0]); xh.setAttribute('x2', c[0]); xh.setAttribute('opacity', '0.5');
          xd.setAttribute('cx', c[0]); xd.setAttribute('cy', c[1]); xd.setAttribute('opacity', '1');
          tip.textContent = ch.fmt(ch.pts[best]);
        } else {
          const i = Math.max(0, Math.min(ch.buckets.length - 1, Math.floor((x - ch.L) / ch.slot)));
          tip.textContent = ch.fmt(ch.buckets[i]);
        }
        tip.style.opacity = '1';
      };
      const hide = () => { tip.style.opacity = '0'; const xh = svg.querySelector('.xh'), xd = svg.querySelector('.xd'); if (xh) xh.setAttribute('opacity', '0'); if (xd) xd.setAttribute('opacity', '0'); };
      svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
    });
  }

  root.__charts = {};
  root.GarageStats = { render: render, wire: wire, compute: compute };
  if (typeof module !== 'undefined') module.exports = root.GarageStats;
})(typeof window !== 'undefined' ? window : globalThis);
