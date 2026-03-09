/**
 * Color Transition Logger — paste into browser console.
 *
 * Watches every RangeSlider for amber↔cyan↔ghost transitions on:
 *   - --range-thumb-color (low/high thumb inputs)
 *   - --oob-lo / --oob-hi (track container, identified by data-column)
 *
 * Logs every transition with sub-ms timing from performance.now().
 * Call window.__stopColorLog() to tear down.
 */
(() => {
  'use strict';

  const POLL_MS = 4; // ~250Hz, catches every rAF frame
  const t0 = performance.now();
  const log = [];
  const state = new Map(); // element → { prop → lastValue }

  const classify = (prop, val) => {
    if (prop === '--range-thumb-color') {
      if (val.includes('amber')) return 'AMBER';
      if (val.includes('cyan')) return 'CYAN';
      if (val.includes('fg-3')) return 'GHOST';
      return val || 'NONE';
    }
    // --oob-lo / --oob-hi: "0" = no void, "0.5" = amber void visible
    const n = parseFloat(val);
    return n > 0 ? 'AMBER' : 'CYAN';
  };

  const sliderName = (el) => {
    // Walk up to find data-column on the track container
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.dataset?.column) return cur.dataset.column;
      cur = cur.parentElement;
    }
    return '??';
  };

  const targets = [];

  const discover = () => {
    // Find track containers by data-column attribute
    const tracks = document.querySelectorAll('[data-column]');
    const seen = new Set(targets.map((t) => t.el));

    tracks.forEach((track) => {
      const col = track.dataset.column;

      // Track container itself: --oob-lo, --oob-hi
      if (!seen.has(track)) {
        targets.push({ el: track, props: ['--oob-lo', '--oob-hi'], kind: 'track', col });
        seen.add(track);
      }

      // Find the two range inputs inside
      const inputs = track.querySelectorAll('input[type="range"]');
      inputs.forEach((inp, i) => {
        if (!seen.has(inp)) {
          targets.push({ el: inp, props: ['--range-thumb-color'], kind: i === 0 ? 'thumb-lo' : 'thumb-hi', col });
          seen.add(inp);
        }
      });
    });
  };

  const poll = () => {
    const now = performance.now() - t0;
    for (const { el, props, kind, col } of targets) {
      if (!state.has(el)) {
        state.set(el, {});
        for (const prop of props) {
          state.get(el)[prop] = classify(prop, el.style.getPropertyValue(prop));
        }
        continue;
      }
      const s = state.get(el);
      for (const prop of props) {
        const cur = classify(prop, el.style.getPropertyValue(prop));
        const prev = s[prop];
        if (cur !== prev) {
          const entry = {
            t: +now.toFixed(2),
            slider: col,
            part: kind,
            prop,
            from: prev,
            to: cur,
            dt: null,
          };
          // Compute dt from last transition on same slider+prop+part
          for (let i = log.length - 1; i >= 0; i--) {
            if (log[i].slider === col && log[i].prop === prop && log[i].part === kind) {
              entry.dt = +(now - log[i].t).toFixed(2);
              break;
            }
          }
          log.push(entry);
          const arrow = `${prev} → ${cur}`;
          const dtStr = entry.dt != null ? ` (Δ${entry.dt}ms)` : '';
          console.log(
            `%c[${now.toFixed(1)}ms]%c ${col} %c${kind}%c ${prop}: %c${arrow}%c${dtStr}`,
            'color: #666',
            'color: #0ff; font-weight: bold',
            'color: #888',
            'color: #aaa',
            arrow.includes('AMBER') ? 'color: #f90; font-weight: bold' : 'color: #0ff; font-weight: bold',
            'color: #666',
          );
          s[prop] = cur;
        }
      }
    }
  };

  // Initial discovery
  discover();

  // Re-discover periodically (handles drawers opening, new sliders mounting)
  const discoverInterval = setInterval(discover, 2000);

  // High-frequency poll
  const pollInterval = setInterval(poll, POLL_MS);

  // Expose controls
  window.__colorLog = log;
  window.__stopColorLog = () => {
    clearInterval(pollInterval);
    clearInterval(discoverInterval);
    console.log(`%cColor logger stopped. ${log.length} transitions captured.`, 'color: #f90');
    console.table(log);
  };
  window.__colorLogSummary = () => {
    const groups = {};
    for (const e of log) {
      const k = `${e.slider} | ${e.part} | ${e.prop} | ${e.from}→${e.to}`;
      if (!groups[k]) groups[k] = { transition: k, count: 0, dts: [] };
      groups[k].count++;
      if (e.dt != null) groups[k].dts.push(e.dt);
    }
    const summary = Object.values(groups).map((g) => ({
      transition: g.transition,
      count: g.count,
      minDt: g.dts.length ? Math.min(...g.dts).toFixed(1) : '-',
      maxDt: g.dts.length ? Math.max(...g.dts).toFixed(1) : '-',
      avgDt: g.dts.length ? (g.dts.reduce((a, b) => a + b, 0) / g.dts.length).toFixed(1) : '-',
    }));
    console.table(summary);
    return summary;
  };

  const trackCount = document.querySelectorAll('[data-column]').length;
  console.log(
    '%cColor Transition Logger active%c — found ' + trackCount + ' sliders (' + targets.length + ' elements)\n' +
    'window.__colorLog        → raw log array\n' +
    'window.__colorLogSummary() → grouped stats\n' +
    'window.__stopColorLog()  → stop & dump',
    'color: #0ff; font-weight: bold; font-size: 14px',
    'color: #aaa',
  );
})();
