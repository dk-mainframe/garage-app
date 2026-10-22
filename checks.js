/* Fill-up checks and MPG preview. Kept in its own file so it can be tested on its own.
   Each check only fires when something is clearly wrong, never over small differences. */
(function (root) {
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  /** Estimated MPG for this fill if it's a full tank, using the last full (or missed) fill as the starting point. */
  function previewMpg(v, odo, gal, fillType) {
    if (fillType !== 'Full' || !v.baseline || !(odo > v.baseline.odo) || !(gal > 0)) return null;
    return Math.round(((odo - v.baseline.odo) / (v.baseline.partialGallons + gal)) * 10) / 10;
  }

  /**
   * v: the vehicle from the Home data. e: { odometer, gallons, total, price (optional), fillType }.
   * Returns a list of { field, title, text }. Empty list = looks fine.
   */
  function runChecks(v, e) {
    const out = [];
    const last = v.lastFillOdo || v.odometer || 0;

    // 1. Odometer going backward, or a jump of more than about 1.5 tanks.
    if (e.odometer <= last) {
      out.push({ field: 'odometer', title: 'Odometer looks off',
        text: fmt(e.odometer) + ' is ' + (e.odometer < last ? 'lower than' : 'the same as') + ' your last reading of ' + fmt(last) + '. A digit may have been missed.' });
    } else if (v.milesPerTank && e.fillType !== 'Missed' && e.odometer - last > v.milesPerTank * 1.5) {
      out.push({ field: 'odometer', title: 'Big jump since your last fill-up',
        text: fmt(e.odometer - last) + ' miles is more than a tank and a half. If you skipped logging a fill-up, choose “Missed one.”' });
    }

    // 2. More gallons than the tank holds.
    if (v.tank && e.gallons > v.tank * 1.05) {
      out.push({ field: 'gallons', title: 'More than the tank holds',
        text: e.gallons.toFixed(3) + ' gallons is more than the ' + v.tank + '-gallon tank. Check the gallons.' });
    }

    // 3. The math doesn't add up (only when a price per gallon was read separately, e.g. from a receipt).
    if (e.price && Math.abs(e.price * e.gallons - e.total) > 2) {
      out.push({ field: 'total', title: 'The numbers don’t add up',
        text: e.gallons.toFixed(3) + ' gal × $' + e.price.toFixed(3) + ' is $' + (e.price * e.gallons).toFixed(2) + ', not $' + e.total.toFixed(2) + '.' });
    }

    // 4. Price per gallon far from your recent average.
    const ppg = e.price || (e.gallons ? e.total / e.gallons : 0);
    if (v.recentPrice && ppg && Math.abs(ppg - v.recentPrice) / v.recentPrice > 0.3) {
      out.push({ field: 'total', title: 'Price looks unusual',
        text: '$' + ppg.toFixed(3) + '/gal is far from your recent average of $' + v.recentPrice.toFixed(3) + '. Check the total and gallons.' });
    }

    // 5. MPG far outside this vehicle's normal range.
    const mpg = previewMpg(v, e.odometer, e.gallons, e.fillType);
    if (mpg !== null && v.mpgRange && (mpg < v.mpgRange[0] || mpg > v.mpgRange[1]) && !out.some(c => c.field === 'odometer')) {
      out.push({ field: 'gallons', title: 'MPG looks unusual',
        text: 'This works out to ' + mpg + ' MPG; your usual range is ' + v.mpgRange[0] + '–' + v.mpgRange[1] + '. If you didn’t fill the tank, choose “Partial”; if a fill-up wasn’t logged, choose “Missed one.”' });
    }
    return out;
  }

  root.GarageChecks = { runChecks: runChecks, previewMpg: previewMpg };
  if (typeof module !== 'undefined') module.exports = root.GarageChecks;
})(typeof window !== 'undefined' ? window : globalThis);
