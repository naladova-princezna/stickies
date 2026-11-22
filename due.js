/* Termíny: čisté funkce bez závislosti na DOM (testy: tests/due.test.js).
   Datum je vždy řetězec RRRR-MM-DD v místním čase uživatele. Rozdíly dnů se počítají v UTC,
   takže je nerozhodí přechod na letní/zimní čas. Týden začíná v pondělí. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Due = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY = 864e5;
  /** Úkol s termínem za tolik dnů a méně (včetně uplynulých) se bere jako „hoří“. */
  const FIRE_DAYS = 2;
  const BUCKETS = ["overdue", "today", "tomorrow", "week", "next", "later", "none"];
  const WD = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
  const WD_LONG = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"];

  const GROUPS = {
    overdue:  { label: "Termín uplynul", hint: "Nic se neděje. Přeplánuj je, nebo začni nejstarším." },
    today:    { label: "Dnes", hint: "Termín je dnes." },
    tomorrow: { label: "Zítra", hint: "" },
    week:     { label: "Tento týden", hint: "" },
    next:     { label: "Příští týden", hint: "" },
    later:    { label: "Později", hint: "" },
    none:     { label: "Bez termínu", hint: "Nic nehoří. Vybírej podle energie." },
  };

  function parse(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? "" : s));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = Date.UTC(y, mo - 1, d);
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y, m: mo, d, t };
  }

  const valid = (s) => parse(s) !== null;

  /** Klíč dne v místním čase. */
  function key(d) {
    const x = d || new Date();
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  }

  function fromUtc(t) {
    const x = new Date(t);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
  }

  /** a − b ve dnech. NaN, když některé datum není platné. */
  function diff(a, b) {
    const pa = parse(a), pb = parse(b);
    return pa && pb ? Math.round((pa.t - pb.t) / DAY) : NaN;
  }

  function add(s, n) {
    const p = parse(s);
    return p ? fromUtc(p.t + n * DAY) : "";
  }

  /** 0 = pondělí … 6 = neděle */
  function weekday(s) {
    const p = parse(s);
    return p ? (new Date(p.t).getUTCDay() + 6) % 7 : -1;
  }

  /** Do které skupiny termín patří. Bez platného termínu „none“. */
  function bucket(due, today) {
    const n = diff(due, today);
    if (Number.isNaN(n)) return "none";
    if (n < 0) return "overdue";
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    const toSunday = 6 - weekday(today);
    if (n <= toSunday) return "week";
    if (n <= toSunday + 7) return "next";
    return "later";
  }

  /** Hoří = termín je nejdál za FIRE_DAYS dnů (a platný). */
  function isFire(due, today) {
    const n = diff(due, today);
    return !Number.isNaN(n) && n <= FIRE_DAYS;
  }

  /** Odstín štítku: overdue, today, soon, near, far, none. */
  function tone(due, today) {
    const n = diff(due, today);
    if (Number.isNaN(n)) return "none";
    if (n < 0) return "overdue";
    if (n === 0) return "today";
    if (n <= FIRE_DAYS) return "soon";
    if (n <= 7) return "near";
    return "far";
  }

  /** Úkoly bez termínu až na konec, jinak podle data. */
  function compare(a, b) {
    const va = valid(a), vb = valid(b);
    if (va && vb) return a < b ? -1 : a > b ? 1 : 0;
    return va ? -1 : vb ? 1 : 0;
  }

  /** „Út 24. 11.“, v jiném roce než dnes i s rokem. */
  function short(due, today) {
    const p = parse(due);
    if (!p) return "";
    const base = `${WD[weekday(due)]} ${p.d}. ${p.m}.`;
    const t = parse(today);
    return t && t.y !== p.y ? `${base} ${p.y}` : base;
  }

  /** „pátek 27. 11. 2026“ */
  function full(due) {
    const p = parse(due);
    return p ? `${WD_LONG[weekday(due)]} ${p.d}. ${p.m}. ${p.y}` : "";
  }

  const daysWord = (n) => (n === 1 ? "den" : n >= 2 && n <= 4 ? "dny" : "dnů");

  /** Text na lístek: Dnes, Zítra, Včera, Za 3 dny, Před 4 dny, jinak datum. */
  function relative(due, today) {
    const n = diff(due, today);
    if (Number.isNaN(n)) return "";
    if (n === 0) return "Dnes";
    if (n === 1) return "Zítra";
    if (n === -1) return "Včera";
    if (n < 0 && n >= -6) return `Před ${-n} dny`;
    if (n > 1 && n <= 6) return `Za ${n} ${daysWord(n)}`;
    return short(due, today);
  }

  /** Rozsah dat, který skupina pokrývá (do záhlaví). */
  function range(b, today) {
    const p = (s) => { const x = parse(s); return `${x.d}. ${x.m}.`; };
    const toSunday = 6 - weekday(today);
    if (b === "today") return full(today);
    if (b === "tomorrow") return full(add(today, 1));
    if (b === "week") return toSunday >= 2 ? `do neděle ${p(add(today, toSunday))}` : "";
    if (b === "next") return `${p(add(today, Math.max(toSunday + 1, 2)))} – ${p(add(today, toSunday + 7))}`;
    if (b === "later") return `od ${p(add(today, toSunday + 8))}`;
    return "";
  }

  /** Rychlé volby termínu: Dnes, Zítra, příští pondělí (když se neshoduje), Za týden. */
  function presets(today) {
    if (!parse(today)) return [];
    const out = [{ id: "today", label: "Dnes", value: today }, { id: "tomorrow", label: "Zítra", value: add(today, 1) }];
    const toMonday = 7 - weekday(today);
    if (toMonday >= 2 && toMonday !== 7) out.push({ id: "monday", label: "Pondělí", value: add(today, toMonday) });
    out.push({ id: "week", label: "Za týden", value: add(today, 7) });
    return out;
  }

  return { FIRE_DAYS, BUCKETS, GROUPS, parse, valid, key, diff, add, weekday, bucket, isFire, tone, compare, short, full, relative, range, presets };
});
