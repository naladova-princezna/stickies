/* ==========================================================================
   Plánovač kapacity dne
   --------------------------------------------------------------------------
   Vstup:  energie (0–100 %) a vytížení dne (0–100 % = kolik dne už zabírají
           pevné závazky: schůzky, výuka, cestování, povinnosti).
   Výstup: kolik "bodů" dnes rozumně unesu a jak je rozdělit mezi lehké,
           střední a náročné úkoly.

   Je to heuristika, ne diagnostika. Vychází z běžně používaných principů:
   - energetický rozpočet (síly jsou omezený zdroj, ne bezedný pytel),
   - limit rozpracovaného (víc než ~5 priorit za den se málokdy stihne),
   - náročná práce patří do chvil s nejvyšší energií,
   - rozdělení velkého úkolu na kroky snižuje práh, který brání začít,
   - plánovat ne na 100 % kapacity (plánovací omyl).

   Všechny konstanty jsou nahoře v CFG, ať se dají časem doladit podle toho,
   jak ti doporučení sedí.
   ========================================================================== */
(function () {
  "use strict";

  const CFG = {
    cost: { light: 1, medium: 2, hard: 4 }, // "body" jednotlivých typů úkolů
    maxPoints: 12,        // kapacita při 100 % energie a 0 % vytížení
    minEffort: 0.2,       // základ výkonu při nízké energii (drobná údržba)
    curve: 1.3,           // >1 = nízká energie kapacitu snižuje víc než lineárně
    zeroEnergy: 10,       // pod tuto energii: dnes jen odpočinek (0 bodů)
    reserveEnergy: 25,    // pod tuto energii (pásmo Rezerva): nanejvýš…
    reserveMaxPoints: 2,  // …tolik bodů (jeden lehký, maximálně dva drobné úkoly)
    hardMinEnergy: 65,    // od jaké energie se doporučují náročné úkoly
    hardMinFree: 0.4,     // a kolik volného dne k tomu musí být
    hardTwoEnergy: 85,    // dva náročné úkoly jen při velmi vysoké energii
    hardTwoFree: 0.6,
    maxTasks: 5,          // strop priorit za den
    fullLoad: 80,         // od tohoto vytížení je den "skoro plný"
    fullLoadMaxTasks: 3,
  };

  const ZONES = [
    { max: 25, id: "rezerva", label: "Rezerva", desc: "Energie je na dně. Dnešní cíl je minimum a odpočinek." },
    { max: 50, id: "setrici", label: "Šetřící režim", desc: "Zvládneš jednoduché věci. Náročné nech na lepší den." },
    { max: 75, id: "bezny", label: "Běžný provoz", desc: "Vydrží ti střídání práce a krátkých pauz." },
    { max: 101, id: "vykon", label: "Vysoký výkon", desc: "Dobrý den na úkol, který se odkládá." },
  ];

  const clamp = (n) => Math.max(0, Math.min(100, Number.isFinite(+n) ? +n : 0));
  const zoneOf = (e) => ZONES.find((z) => e < z.max);

  function tipsFor(e, l, rec) {
    const t = [];
    if (rec.points <= 0) {
      t.push("Dnes nejde o výkon. Odpočinek se počítá a zítra se to vrátí.");
    }
    if (rec.hard > 0) {
      t.push("Náročný úkol udělej jako první, dokud je energie. Čím později, tím víc se odkládá.");
    } else if (e < CFG.hardMinEnergy && rec.points > 0) {
      t.push("Náročné úkoly dnes jen po krocích. Stačí první krok, který zabere nanejvýš 25 minut.");
    }
    if (l >= CFG.fullLoad) {
      t.push("Den je skoro plný. Každý úkol navíc se platí klidem.");
    } else if (e < 45 && l < 50) {
      t.push("Času máš dost, sil míň. Pracuj v krátkých blocích: 25 minut práce, 5 minut pauza.");
    } else if (e >= 70 && l >= 60) {
      t.push("Síla je, času málo. Vyber jedno nejdůležitější a zbytek vědomě odlož.");
    }
    if (t.length < 2) t.push("Plánuj zhruba na 70 % kapacity. Zbytek patří překvapením.");
    return t.slice(0, 3);
  }

  /** Doporučení pro daný den. */
  function recommend(energy, load) {
    const e = clamp(energy), l = clamp(load);
    const free = 1 - l / 100;
    const eff = CFG.minEffort + (1 - CFG.minEffort) * Math.pow(e / 100, CFG.curve);
    let points = Math.round(CFG.maxPoints * free * eff);
    if (e < CFG.zeroEnergy) points = 0;
    else if (e < CFG.reserveEnergy) points = Math.min(points, CFG.reserveMaxPoints);

    const hardOk = e >= CFG.hardMinEnergy && free >= CFG.hardMinFree && points >= CFG.cost.hard;
    const hardMax = hardOk ? (e >= CFG.hardTwoEnergy && free >= CFG.hardTwoFree ? 2 : 1) : 0;
    const maxTotal = l >= CFG.fullLoad ? CFG.fullLoadMaxTasks : CFG.maxTasks;

    let hard = Math.min(hardMax, Math.floor(points / CFG.cost.hard));
    let rem = points - hard * CFG.cost.hard;
    let medium = Math.floor(rem / 3);
    rem -= medium * CFG.cost.medium;
    let light = Math.min(rem, 3);

    while (hard + medium + light > maxTotal) {
      if (light > 0) light--;
      else if (medium > 0) medium--;
      else hard--;
    }

    const rec = {
      energy: e, load: l, free, points,
      hard, medium, light,
      total: hard + medium + light,
      hardMax, maxTotal,
      zone: zoneOf(e),
    };
    rec.usedPoints = hard * CFG.cost.hard + medium * CFG.cost.medium + light * CFG.cost.light;
    rec.tips = tipsFor(e, l, rec);
    return rec;
  }

  /** Porovná doporučení s tím, co už je na dnešek naplánované (otevřené i splněné). */
  function evaluate(rec, planned) {
    const have = { hard: 0, medium: 0, light: 0 };
    let used = 0;
    for (const t of planned) {
      const k = CFG.cost[t.effort] ? t.effort : "medium";
      have[k]++;
      used += CFG.cost[k];
    }
    const over = Math.max(0, used - rec.points);

    // Co ještě doplnit: nejdřív náročný (je-li povolen a vejde se), pak střední, pak lehký.
    const need = [];
    let left = rec.points - used;
    let count = planned.length;
    const h = { ...have };
    let guard = 0;
    while (count < rec.maxTotal && left >= 1 && guard++ < 10) {
      if (h.hard < rec.hardMax && h.hard < rec.hard && left >= CFG.cost.hard) { need.push("hard"); h.hard++; left -= CFG.cost.hard; }
      else if (h.medium < rec.medium && left >= CFG.cost.medium) { need.push("medium"); h.medium++; left -= CFG.cost.medium; }
      else if (h.light < rec.light && left >= CFG.cost.light) { need.push("light"); h.light++; left -= CFG.cost.light; }
      else break;
      count++;
    }
    return { have, used, left: rec.points - used, over, need };
  }

  const api = { CFG, ZONES, recommend, evaluate, zoneOf, clamp };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.Plan = api;
})();
