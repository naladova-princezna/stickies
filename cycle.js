/* ==========================================================================
   Fáze cyklu (volitelné, jen z tebou označených začátků)
   --------------------------------------------------------------------------
   Vstup:  seznam dnů, kdy začal nový cyklus (YYYY-MM-DD).
   Výstup: v jaké fázi je zadaný den a co o ní říkají studie.

   Fáze se odhadují z délky cyklu: menstruace prvních ~5 dní, ovulace kolem
   14 dní před koncem cyklu, luteální fáze po ní a posledních ~5 dní je
   předmenstruační týden. Je to hrubý odhad podle kalendáře, ne měření.

   Zdroj poznámek: Wynchank et al., J Clin Med 2025;15(1):121, narativní
   přehled 29 studií. U žen s ADHD jsou důkazy zatím omezené (hlavně
   kvalitativní a malé soubory), proto jsou poznámky formulované opatrně.
   ========================================================================== */
(function () {
  "use strict";

  const CFG = { defaultLength: 28, minLength: 18, maxLength: 45, menstrDays: 5, lutealLen: 14, preDays: 5, staleAfter: 7 };

  const PHASES = {
    menstrual: {
      id: "menstrual", label: "Menstruace", sensitive: false,
      note: "Kolem menstruace a ovulace popisují některé studie vyšší impulzivitu. Výsledky nejsou jednotné.",
      tips: ["Plánuj jednodušeji a nech si prostor na odpočinek."],
    },
    follicular: {
      id: "follicular", label: "Folikulární fáze", sensitive: false,
      note: "Zhoršení pozornosti a plánování se v přehledu studií popisuje hlavně později v cyklu. Tahle fáze bývá bez něj.",
      tips: ["Dobré místo pro úkol, který se odkládá, ale rozhoduje tvoje dnešní energie."],
    },
    ovulation: {
      id: "ovulation", label: "Ovulace", sensitive: false,
      note: "Kolem ovulace může být vyšší impulzivita. Výsledky studií nejsou jednotné.",
      tips: ["Než se pustíš do něčeho nového, zkus si to rozepsat na kroky."],
    },
    luteal: {
      id: "luteal", label: "Luteální fáze", sensitive: true,
      note: "U žen s ADHD studie popisují horší pozornost, plánování a zvládání emocí. U žen bez ADHD bývá pozornost spíš lepší, ale víc se rozptylují.",
      tips: ["Rozepiš úkoly na menší kroky a plánuj na zhruba 80 % kapacity.", "Neměř se podle běžných dnů. Stejná práce teď stojí víc sil."],
    },
    premenstrual: {
      id: "premenstrual", label: "Předmenstruační dny", sensitive: true,
      note: "Studie popisují horší pozornost, plánování a emoční regulaci, u PMDD i větší únavu a horší spánek. Některé ženy zmiňují slabší účinek léků na ADHD. To patří probrat s lékařem nebo lékařkou, ne řešit sama.",
      tips: ["Vyber méně úkolů a rozepiš je na kroky. Odpočinek se počítá.", "Zhoršení je hormonální kolísání, ne selhání. Víš o něm předem, tak ho zahrň do plánu."],
    },
  };

  const pad = (n) => String(n).padStart(2, "0");
  const dn = (s) => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const median = (a) => { const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

  /** Obvyklá délka cyklu: medián rozumných rozestupů mezi označenými začátky, jinak 28. */
  function lengthOf(anchors) {
    const a = [...new Set(anchors)].sort().map(dn), gaps = [];
    for (let i = 1; i < a.length; i++) {
      const g = a[i] - a[i - 1];
      if (g >= CFG.minLength && g <= CFG.maxLength) gaps.push(g);
    }
    return gaps.length ? Math.round(median(gaps)) : CFG.defaultLength;
  }

  function phaseByDay(day, L) {
    const ov = L - CFG.lutealLen;
    if (day <= CFG.menstrDays) return PHASES.menstrual;
    if (day > L - CFG.preDays) return PHASES.premenstrual;
    if (day >= ov - 1 && day <= ov + 1) return PHASES.ovulation;
    if (day < ov - 1) return PHASES.follicular;
    return PHASES.luteal;
  }

  /** Fáze zadaného dne, nebo null (žádný začátek před tím), nebo {stale:true} (nový začátek už se dávno čeká). */
  function phaseOf(date, anchors) {
    const a = [...new Set(anchors || [])].sort();
    if (!a.length) return null;
    const n = dn(date), before = a.filter((x) => dn(x) <= n);
    if (!before.length) return null;
    const last = before[before.length - 1], day = n - dn(last) + 1;
    const next = a.find((x) => dn(x) > n);
    let L = lengthOf(a);
    if (next) { const g = dn(next) - dn(last); if (g >= CFG.minLength && g <= CFG.maxLength) L = g; }
    if (!next && day > L + CFG.staleAfter) return { stale: true, day, length: L, start: last };
    const phase = phaseByDay(Math.min(day, L), L);
    return { stale: false, day, length: L, start: last, phase, sensitive: phase.sensitive, predicted: !next };
  }

  /** Průměry tvých zadaných dnů podle fáze. Fáze s méně než minDays dny se nevypisují. */
  function byPhase(rows, anchors, points, minDays) {
    const need = minDays || 3, acc = {};
    for (const r of rows || []) {
      const p = phaseOf(r.date, anchors);
      if (!p || p.stale) continue;
      const a = (acc[p.phase.id] = acc[p.phase.id] || { id: p.phase.id, days: 0, e: 0, l: 0, b: 0 });
      a.days++; a.e += r.energy; a.l += r.load; a.b += (points && points[r.date]) || 0;
    }
    return Object.values(acc).filter((a) => a.days >= need).map((a) => ({
      id: a.id, days: a.days, energy: Math.round(a.e / a.days), load: Math.round(a.l / a.days), points: Math.round((a.b / a.days) * 10) / 10,
    }));
  }

  const api = { CFG, PHASES, lengthOf, phaseOf, phaseByDay, byPhase, ORDER: ["menstrual", "follicular", "ovulation", "luteal", "premenstrual"] };
  if (typeof window !== "undefined") window.Cycle = api;
  if (typeof module !== "undefined") module.exports = api;
})();
