/* Spuštění: TZ=Europe/Prague node tests/due.test.js */
"use strict";
const assert = require("node:assert/strict");
const Due = require("../due.js");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

t("parse: platná a neplatná data", () => {
  assert.ok(Due.valid("2026-11-22"));
  assert.ok(Due.valid("2028-02-29"));            // přestupný rok
  for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-1", "22.11.2026", "", null, undefined, 5, "2026-11-22T10:00"]) assert.equal(Due.valid(bad), false, String(bad));
});

t("diff a add přes letní čas, konec roku a přestupný den", () => {
  assert.equal(Due.diff("2026-10-26", "2026-10-24"), 2);   // změna na zimní čas 25. 10. 2026
  assert.equal(Due.diff("2027-03-29", "2027-03-27"), 2);   // změna na letní čas 28. 3. 2027
  assert.equal(Due.diff("2027-01-01", "2026-12-31"), 1);
  assert.equal(Due.add("2028-02-28", 1), "2028-02-29");
  assert.equal(Due.add("2027-02-28", 1), "2027-03-01");
  assert.equal(Due.add("2026-12-31", 1), "2027-01-01");
  assert.equal(Due.add("2026-03-01", -1), "2026-02-28");
  assert.ok(Number.isNaN(Due.diff("x", "2026-01-01")));
});

t("weekday: pondělí = 0", () => {
  assert.equal(Due.weekday("2026-11-22"), 6);   // neděle
  assert.equal(Due.weekday("2026-11-23"), 0);   // pondělí
  assert.equal(Due.weekday("2026-11-28"), 5);   // sobota
});

t("bucket: dnes je neděle 22. 11. 2026 (tento týden je prázdný)", () => {
  const today = "2026-11-22";
  const b = (d) => Due.bucket(d, today);
  assert.equal(b("2026-11-21"), "overdue");
  assert.equal(b("2026-11-22"), "today");
  assert.equal(b("2026-11-23"), "tomorrow");
  assert.equal(b("2026-11-24"), "next");
  assert.equal(b("2026-11-29"), "next");        // neděle příštího týdne
  assert.equal(b("2026-11-30"), "later");
  assert.equal(b(""), "none");
  assert.equal(b("nesmysl"), "none");
});

t("bucket: dnes je pondělí 23. 11. 2026", () => {
  const today = "2026-11-23";
  const b = (d) => Due.bucket(d, today);
  assert.equal(b("2026-11-24"), "tomorrow");
  assert.equal(b("2026-11-25"), "week");
  assert.equal(b("2026-11-29"), "week");        // neděle tohoto týdne
  assert.equal(b("2026-11-30"), "next");
  assert.equal(b("2026-12-06"), "next");
  assert.equal(b("2026-12-07"), "later");
});

t("bucket: dnes je sobota (zítřek je neděle, ještě tento týden)", () => {
  const today = "2026-11-28";
  assert.equal(Due.bucket("2026-11-29", today), "tomorrow");
  assert.equal(Due.bucket("2026-11-30", today), "next");
  assert.equal(Due.bucket("2026-12-06", today), "next");
  assert.equal(Due.bucket("2026-12-07", today), "later");
});

t("bucket: každý den v roce spadne přesně do jedné skupiny a pořadí skupin odpovídá datu", () => {
  const order = Due.BUCKETS;
  for (const today of ["2026-11-22", "2026-11-23", "2026-11-28", "2028-02-27", "2026-12-31"]) {
    let last = -1;
    for (let i = -10; i <= 60; i++) {
      const d = Due.add(today, i);
      const idx = order.indexOf(Due.bucket(d, today));
      assert.ok(idx >= 0);
      assert.ok(idx >= last, `${today} +${i}: skupiny nesmí jít zpět`);
      last = idx;
    }
  }
});

t("isFire a tone", () => {
  const today = "2026-11-22";
  assert.equal(Due.isFire("2026-11-01", today), true);
  assert.equal(Due.isFire("2026-11-24", today), true);   // +2
  assert.equal(Due.isFire("2026-11-25", today), false);  // +3
  assert.equal(Due.isFire("", today), false);
  assert.equal(Due.tone("2026-11-21", today), "overdue");
  assert.equal(Due.tone("2026-11-22", today), "today");
  assert.equal(Due.tone("2026-11-24", today), "soon");
  assert.equal(Due.tone("2026-11-29", today), "near");
  assert.equal(Due.tone("2026-12-30", today), "far");
  assert.equal(Due.tone(undefined, today), "none");
});

t("compare: bez termínu až na konec, stabilně", () => {
  const list = ["", "2026-12-01", "x", "2026-11-30", undefined, "2026-11-30"];
  const sorted = [...list].sort(Due.compare);
  assert.deepEqual(sorted.slice(0, 3), ["2026-11-30", "2026-11-30", "2026-12-01"]);
  assert.ok(sorted.slice(3).every((v) => !Due.valid(v)));
});

t("relative a short", () => {
  const today = "2026-11-22";
  assert.equal(Due.relative("2026-11-22", today), "Dnes");
  assert.equal(Due.relative("2026-11-23", today), "Zítra");
  assert.equal(Due.relative("2026-11-21", today), "Včera");
  assert.equal(Due.relative("2026-11-19", today), "Před 3 dny");
  assert.equal(Due.relative("2026-11-24", today), "Za 2 dny");
  assert.equal(Due.relative("2026-11-27", today), "Za 5 dnů");
  assert.equal(Due.relative("2026-11-28", today), "Za 6 dnů");
  assert.equal(Due.relative("2026-11-29", today), "Ne 29. 11.");
  assert.equal(Due.relative("2027-01-05", today), "Út 5. 1. 2027");
  assert.equal(Due.relative("", today), "");
  assert.equal(Due.full("2026-11-27"), "pátek 27. 11. 2026");
});

t("range: popisky skupin", () => {
  assert.equal(Due.range("week", "2026-11-23"), "do neděle 29. 11.");
  assert.equal(Due.range("week", "2026-11-28"), "");            // sobota: tento týden = jen zítřek
  assert.equal(Due.range("next", "2026-11-23"), "30. 11. – 6. 12.");
  assert.equal(Due.range("next", "2026-11-22"), "24. 11. – 29. 11.");      // neděle: pondělí je „Zítra“
  assert.equal(Due.range("later", "2026-11-23"), "od 7. 12.");
  assert.equal(Due.range("today", "2026-11-23"), "pondělí 23. 11. 2026");
});

t("presets: bez duplicit", () => {
  const vals = (today) => Due.presets(today).map((p) => p.id + ":" + p.value);
  assert.deepEqual(vals("2026-11-22"), ["today:2026-11-22", "tomorrow:2026-11-23", "week:2026-11-29"]);  // neděle: pondělí = zítra
  assert.deepEqual(vals("2026-11-23"), ["today:2026-11-23", "tomorrow:2026-11-24", "week:2026-11-30"]);  // pondělí: příští pondělí = za týden
  assert.deepEqual(vals("2026-11-25"), ["today:2026-11-25", "tomorrow:2026-11-26", "monday:2026-11-30", "week:2026-12-02"]);
  for (const today of ["2026-11-22", "2026-11-24", "2026-11-27", "2026-11-28"]) {
    const v = Due.presets(today).map((p) => p.value);
    assert.equal(new Set(v).size, v.length, today);
  }
  assert.deepEqual(Due.presets("zle"), []);
});

t("key: místní datum", () => {
  assert.equal(Due.key(new Date(2026, 10, 22, 23, 59)), "2026-11-22");
  assert.equal(Due.key(new Date(2026, 0, 5, 0, 0)), "2026-01-05");
});

console.log(`\n${n} skupin testů prošlo.`);
