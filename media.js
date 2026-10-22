/* Camera, microphone, and the no-AI number reader. */
(function (root) {
  'use strict';

  /** Opens the camera (or photo library) and returns a resized JPEG: { mime, data (base64), preview (data URL) }. */
  function pickPhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) { resolve(null); return; }
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => {
          const max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          const dataUrl = c.toDataURL('image/jpeg', 0.8);
          resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t read that photo. Try again.')); };
        img.src = url;
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Records from the microphone as a small 16 kHz WAV (a format Gemini reads reliably).
   * start() resolves to a recorder with stop() -> { mime, data } and level() -> 0..1 for a meter.
   */
  async function startRecording(maxSeconds) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser can’t use the microphone.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    let peak = 0, stopped = false;
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let m = 0; for (let i = 0; i < d.length; i += 64) m = Math.max(m, Math.abs(d[i]));
      peak = m;
    };
    src.connect(proc); proc.connect(ctx.destination);
    let timer;
    const done = new Promise(res => { timer = setTimeout(() => res(), (maxSeconds || 30) * 1000); });
    async function stop() {
      if (stopped) return null;
      stopped = true; clearTimeout(timer);
      proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop());
      const rate = ctx.sampleRate; await ctx.close();
      const len = chunks.reduce((n, c) => n + c.length, 0), all = new Float32Array(len);
      let o = 0; chunks.forEach(c => { all.set(c, o); o += c.length; });
      return { mime: 'audio/wav', data: wavBase64(downsample(all, rate, 16000), 16000), seconds: len / rate };
    }
    return { stop: stop, level: () => peak, timedOut: done };
  }

  function downsample(buf, from, to) {
    if (to >= from) return buf;
    const ratio = from / to, out = new Float32Array(Math.floor(buf.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.min(buf.length, Math.floor((i + 1) * ratio));
      let s = 0; for (let j = a; j < b; j++) s += buf[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }
  function wavBase64(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    const bytes = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /* ---------- No-AI reader for typed or dictated text ---------- */
  const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  /** Turns number words into digits: "twenty three point one two four" -> "23.124". */
  function wordsToDigits(text) {
    const toks = String(text).toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/[,;]/g, ' | ').replace(/[^a-z0-9.$|\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
    const out = [];
    let num = null, group = 0, decimals = null, ds = '', started = false;
    const settleDigits = () => { if (ds) { group += Number(ds); ds = ''; } };
    const flush = () => {
      settleDigits();
      if (!started && decimals === null) return;
      const v = (num || 0) + group;
      out.push(decimals !== null && decimals !== '' ? v + '.' + decimals : String(v));
      num = null; group = 0; decimals = null; started = false;
    };
    let prevSingle = false, wasSingle = false;
    for (const t of toks) {
      if (t === '|') { if (decimals !== null || started) flush(); prevSingle = wasSingle = false; continue; } // a comma ends a number
      const single = t in ONES && ONES[t] < 10, before = wasSingle;
      wasSingle = single && ONES[t] > 0;
      if (t === 'point' || t === 'dot') { settleDigits(); started = true; decimals = ''; prevSingle = false; continue; }
      if (decimals !== null && (single || /^\d+$/.test(t))) { decimals += single ? ONES[t] : t; continue; }
      if (decimals !== null) flush();
      if (/^\d+(\.\d+)?$/.test(t)) { flush(); out.push(t); prevSingle = false; continue; }
      if (single && (prevSingle || (!started))) { ds += ONES[t]; started = true; prevSingle = true; continue; }
      prevSingle = false;
      // "four twelve" or "four fifty" after a single digit means 412 / 450, as people read odometers.
      const join = before && (ONES[t] >= 10 || t in TENS);
      if (t in ONES) { settleDigits(); group = join ? group * 100 + ONES[t] : group + ONES[t]; started = true; continue; }
      if (t in TENS) { settleDigits(); group = join ? group * 100 + TENS[t] : group + TENS[t]; started = true; continue; }
      if (t === 'hundred') { settleDigits(); group = (group || 1) * 100; started = true; continue; }
      if (t === 'thousand') { settleDigits(); num = (num || 0) + (group || 1) * 1000; group = 0; started = true; continue; }
      if (t === 'and' && started) continue;
      flush(); out.push(t);
    }
    flush();
    // "98 dollars and 24 cents" -> "98.24 dollars"
    return out.join(' ').replace(/(\d+) dollars? (?:and )?(\d{1,2}) cents?/g, (m, a, b) => a + '.' + b.padStart(2, '0') + ' dollars');
  }

  /** Finds odometer, gallons, and total in plain text. Returns only what it's confident about. */
  function parseFuel(text) {
    const s = wordsToDigits(text) + ' ';
    const r = {};
    const near = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
    r.odometer = near(/(\d{3,7})\s*(?:miles|mile|mi|on the odometer|odometer)/) || near(/odometer\s*(?:is|at|of)?\s*(\d{3,7})/);
    r.gallons = near(/(\d{1,3}(?:\.\d+)?)\s*(?:gallons|gallon|gal)/);
    r.total = near(/\$\s*(\d{1,4}(?:\.\d{1,2})?)/) || near(/(\d{1,4}(?:\.\d{1,2})?)\s*(?:dollars|bucks|total)/) || near(/(?:total|paid|cost)\s*(?:of|was|is)?\s*(\d{1,4}(?:\.\d{1,2})?)/);
    if (/partial|didn.?t fill|not full/.test(s)) r.fillType = 'Partial';
    // Leftover numbers: largest is usually the odometer.
    const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n !== r.odometer && n !== r.gallons && n !== r.total);
    if (r.odometer == null) { const big = nums.filter(n => n >= 1000).sort((a, b) => b - a)[0]; if (big) r.odometer = big; }
    return r;
  }

  root.GarageMedia = { pickPhoto: pickPhoto, startRecording: startRecording, wordsToDigits: wordsToDigits, parseFuel: parseFuel };
  if (typeof module !== 'undefined') module.exports = root.GarageMedia;
})(typeof window !== 'undefined' ? window : globalThis);
