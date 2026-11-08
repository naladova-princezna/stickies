/* ==========================================================================
   Statistiky a odhad energie / vytížení
   --------------------------------------------------------------------------
   Vstup:  záznamy po dnech {date:"YYYY-MM-DD", energy, load, cycle_start?}
           (jen ty, které člověk opravdu zadal), plus kolik bodů úkolů se ten
           den splnilo.
   Výstup: průměry, týdenní rytmus, odhad na dnes a dalších 6 dní,
           a když se v datech opakuje vzorec, i odhad "vlastního cyklu".

   Je to statistika z tvých vlastních záznamů, ne měření a ne zdravotní
   pomůcka. Čím víc dní zadáš, tím je odhad lepší. Cyklus se tvrdí až při
   dostatku dat a zřetelném opakování.

   Postup (vše jde zkontrolovat v testech test_stats.js):
   1. odečte se celkový průměr a vliv dne v týdnu (zmenšený, když je dat málo),
   2. ze zbytku se hledá opakování po 18–45 dnech (autokorelace se dvěma pojistkami
      proti pomalým trendům) nebo se použijí ručně označené začátky cyklu,
   3. zbytky se "složí" podle pozice v cyklu a vyhladí,
   4. odhad = průměr + den v týdnu + cyklus (zmenšený podle jistoty) + krátký
      doznívající vliv posledních dní.
   ========================================================================== */
(function () {
  "use strict";

  const CFG = {
    minRows: 7,            // pod tímto počtem dní žádný odhad
    weekdayRows: 14,       // od tohoto počtu se používá den v týdnu
    weekdayShrink: 3,      // zmenšení vlivu dne v týdnu (kolik "pozorování" navíc se předpokládá)
    lagMin: 18, lagMax: 45,// hledaná délka cyklu ve dnech
    lagMinPairs: 12,       // kolik dvojic dnů je nutné pro korelaci
    lagMinRows: 35,        // minimum dní pro automatické hledání cyklu
    lagMinCorr: 0.35,      // minimální korelace
    lagPeakGap: 0.25,      // korelace na délce cyklu musí převyšovat polovinu délky o tolik
    lagSpanCycles: 1.6,    // data musí pokrýt aspoň tolik cyklů
    minAmplitude: 8,       // cyklus se tvrdí, jen když je rozdíl nejvyšší a nejnižší fáze aspoň tolik %
    smoothRadius: 3,       // vyhlazení křivky cyklu (± dní)
    driftWeight: 0.4,      // jak moc se bere v úvahu odchylka posledních dní
    driftDecay: 0.85,      // zeslabení za každý den dopředu
    driftDays: 5,
    minSd: 6,              // nejmenší rozptyl odhadu v %
    bands: [[0, 40, "Nízká energie (pod 40 %)"], [40, 70, "Střední energie (40–69 %)"], [70, 101, "Vysoká energie (70 % a víc)"]],
    bandMinDays: 3,
  };

  const WD = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
  const pad = (n) => String(n).padStart(2, "0");
  const dn = (s) => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const ds = (n) => { const d = new Date(n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const wdOf = (n) => (((n + 3) % 7) + 7) % 7;               // 0 = pondělí (1. 1. 1970 byl čtvrtek)
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

  function pearson(a, b) {
    const ma = mean(a), mb = mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }

  /** Průměr a vliv dne v týdnu pro jednu veličinu. */
  function baseModel(rows, key, useWeekday) {
    const pts = rows.map((r) => ({ n: dn(r.date), v: r[key] }));
    const mu = mean(pts.map((p) => p.v));
    const sum = Array(7).fill(0), cnt = Array(7).fill(0);
    for (const p of pts) { sum[wdOf(p.n)] += p.v - mu; cnt[wdOf(p.n)]++; }
    const wd = sum.map((s, i) => (useWeekday && cnt[i] ? s / (cnt[i] + CFG.weekdayShrink) : 0));
    const resid = pts.map((p) => ({ n: p.n, v: p.v - mu - wd[wdOf(p.n)] }));
    return { mu, wd, cnt, resid };
  }

  /** Najde délku cyklu podle opakování ve zbytcích. */
  function detectLag(resid) {
    if (resid.length < CFG.lagMinRows) return null;
    const map = new Map(resid.map((r) => [r.n, r.v]));
    const ns = resid.map((r) => r.n);
    const span = Math.max(...ns) - Math.min(...ns);
    const corr = {};
    for (let L = Math.max(2, Math.floor(CFG.lagMin / 2)); L <= CFG.lagMax; L++) {
      const a = [], b = [];
      for (const [n, v] of map) { const w = map.get(n + L); if (w !== undefined) { a.push(v); b.push(w); } }
      corr[L] = a.length >= CFG.lagMinPairs ? pearson(a, b) : null;
    }
    let best = null;
    for (let L = CFG.lagMin; L <= CFG.lagMax; L++) {
      const c = corr[L];
      if (c == null || span < CFG.lagSpanCycles * L) continue;
      const half = corr[Math.round(L / 2)];
      if (half == null || c < half + CFG.lagPeakGap) continue;
      if (!best || c > best.c) best = { L, c, span };
    }
    return best && best.c >= CFG.lagMinCorr ? best : null;
  }

  /** Pozice dne v cyklu: od ručně označeného začátku, nebo od prvního zadaného dne. */
  function makePhase(L, anchors, firstN) {
    if (anchors && anchors.length) {
      const a = [...anchors].sort((x, y) => x - y);
      return (n) => {
        let last = null;
        for (const x of a) if (x <= n) last = x;
        if (last == null) return mod(n - a[0], L);
        if (last === a[a.length - 1]) return mod(n - last, L);        // po posledním začátku: předpoklad pravidelnosti
        return Math.min(n - last, L - 1);                              // mezi dvěma začátky
      };
    }
    return (n) => mod(n - firstN, L);
  }

  function foldEffect(resid, L, phase) {
    const sum = Array(L).fill(0), cnt = Array(L).fill(0);
    for (const r of resid) { const p = phase(r.n); sum[p] += r.v; cnt[p]++; }
    const R = CFG.smoothRadius, out = Array(L).fill(0);
    for (let i = 0; i < L; i++) {
      let num = 0, den = 0;
      for (let k = -R; k <= R; k++) {
        const w = 1 - Math.abs(k) / (R + 1), j = mod(i + k, L);
        num += w * sum[j]; den += w * cnt[j];
      }
      out[i] = den >= 1 ? num / den : 0;
    }
    return out;
  }

  function analyze(allRows, opts) {
    const o = Object.assign({ today: null, points: {}, tasks: {}, anchors: [] }, opts || {});
    const rows = (allRows || [])
      .filter((r) => r && r.date && Number.isFinite(+r.energy) && Number.isFinite(+r.load))
      .map((r) => ({ date: r.date, energy: +r.energy, load: +r.load }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const todayN = o.today ? dn(o.today) : rows.length ? dn(rows[rows.length - 1].date) : 0;
    const res = {
      n: rows.length, confidence: "none", mean: null, weekday: [], cycle: null, forecast: [], bands: [], rows,
      need: Math.max(0, CFG.minRows - rows.length),
    };
    if (!rows.length) return res;

    res.mean = { energy: Math.round(mean(rows.map((r) => r.energy))), load: Math.round(mean(rows.map((r) => r.load))) };

    const useWd = rows.length >= CFG.weekdayRows;
    const E = baseModel(rows, "energy", useWd), Lm = baseModel(rows, "load", useWd);
    res.weekday = WD.map((label, i) => ({
      wd: i, label, count: E.cnt[i],
      energy: E.cnt[i] ? Math.round(mean(rows.filter((r) => wdOf(dn(r.date)) === i).map((r) => r.energy))) : null,
      load: E.cnt[i] ? Math.round(mean(rows.filter((r) => wdOf(dn(r.date)) === i).map((r) => r.load))) : null,
    }));

    // výkon podle energie
    // počítají se jen dny od prvního splněného úkolu v aplikaci (dřív by nuly zkreslovaly výsledek)
    const taskDays = Object.keys(o.tasks).filter((k) => o.tasks[k] > 0).sort();
    const sinceTasks = taskDays.length ? taskDays[0] : null;
    for (const [lo, hi, label] of CFG.bands) {
      const sel = sinceTasks ? rows.filter((r) => r.energy >= lo && r.energy < hi && r.date >= sinceTasks) : [];
      if (sel.length >= CFG.bandMinDays) {
        res.bands.push({
          label, days: sel.length,
          avgPoints: +mean(sel.map((r) => o.points[r.date] || 0)).toFixed(1),
          avgTasks: +mean(sel.map((r) => o.tasks[r.date] || 0)).toFixed(1),
        });
      }
    }

    if (rows.length < CFG.minRows) return res;

    // ---- cyklus ----
    const firstN = dn(rows[0].date);
    let cyc = null;
    const anchors = (o.anchors || []).map(dn).sort((a, b) => a - b);
    if (anchors.length >= 2) {
      const gaps = [];
      for (let i = 1; i < anchors.length; i++) gaps.push(anchors[i] - anchors[i - 1]);
      const ok = gaps.filter((g) => g >= CFG.lagMin && g <= CFG.lagMax);
      if (ok.length) cyc = { kind: "anchors", L: Math.round(median(ok)), strength: Math.min(1, ok.length / 3), anchors };
    }
    if (!cyc) {
      const lag = detectLag(E.resid);
      if (lag) cyc = { kind: "auto", L: lag.L, strength: clamp(lag.c, 0, 0.9) * Math.min(1, lag.span / (3 * lag.L)), corr: lag.c, span: lag.span };
    }
    let effE = null, effL = null, phase = null;
    if (cyc) {
      phase = makePhase(cyc.L, cyc.kind === "anchors" ? cyc.anchors : null, firstN);
      const fe = foldEffect(E.resid, cyc.L, phase), fl = foldEffect(Lm.resid, cyc.L, phase);
      const sh = cyc.kind === "anchors" ? 0.9 * cyc.strength : cyc.strength;
      effE = fe.map((x) => x * sh); effL = fl.map((x) => x * sh);
      const amp = Math.max(...effE) - Math.min(...effE);
      if (amp < CFG.minAmplitude) { cyc = null; effE = effL = phase = null; }
      else { cyc.amplitude = Math.round(amp); cyc.curve = effE; }
    }

    // ---- odhad ----
    const model = (M, eff) => {
      const after = M.resid.map((r) => r.v - (eff ? eff[phase(r.n)] : 0));
      return { sd: Math.max(CFG.minSd, sd(after)), recent: after.slice(-CFG.driftDays) };
    };
    const mE = model(E, effE), mL = model(Lm, effL);
    const predict = (M, mm, eff, n) => {
      const ahead = Math.max(0, n - todayN);
      const drift = CFG.driftWeight * mean(mm.recent) * CFG.driftDecay ** ahead;
      const v = M.mu + M.wd[wdOf(n)] + (eff ? eff[phase(n)] : 0) + drift;
      const r = Math.round(mm.sd * (useWd ? 1 : 1.2));
      return { v: Math.round(clamp(v, 5, 100)), lo: Math.round(clamp(v - r, 0, 100)), hi: Math.round(clamp(v + r, 0, 100)) };
    };
    for (let k = 0; k < 7; k++) {
      const n = todayN + k;
      res.forecast.push({ date: ds(n), wd: wdOf(n), label: WD[wdOf(n)], energy: predict(E, mE, effE, n), load: predict(Lm, mL, effL, n) });
    }

    res.confidence = cyc && (cyc.kind === "anchors" || cyc.span >= 3 * cyc.L) ? "high" : useWd ? "mid" : "low";

    if (cyc) {
      const L = cyc.L, now = phase(todayN);
      const amp = cyc.amplitude, e = effE[now];
      let nextHigh = null, nextLow = null, hi = -1e9, lo = 1e9;
      for (let k = 0; k < L; k++) {
        const v = effE[phase(todayN + k)];
        if (v > hi) { hi = v; nextHigh = todayN + k; }
        if (v < lo) { lo = v; nextLow = todayN + k; }
      }
      res.cycle = {
        kind: cyc.kind, length: L, amplitude: amp,
        day: now + 1, level: e > amp * 0.25 ? "high" : e < -amp * 0.25 ? "low" : "mid",
        curve: effE.map((x) => Math.round(x * 10) / 10), phaseNow: now,
        nextHigh: ds(nextHigh), nextLow: ds(nextLow),
        strength: Math.round(cyc.strength * 100) / 100, corr: cyc.corr != null ? Math.round(cyc.corr * 100) / 100 : null,
        cycles: Math.round((rows.length ? dn(rows[rows.length - 1].date) - firstN : 0) / L * 10) / 10,
      };
    }
    return res;
  }

  const api = { analyze, CFG, dn, ds, wdOf, WD };
  if (typeof window !== "undefined") window.Stats = api;
  if (typeof module !== "undefined") module.exports = api;
})();
