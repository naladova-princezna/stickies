/* Diplomka: čistá logika pro sekci Práce ve Studiu (bez DOM, jde testovat v Node).
   Plán týdenního sprintu, osnova (šablony a vložení textem), zápis napsaných stran,
   zaparkované věci, kostra do LaTeXu a brief pro Clauda. */
(function (root) {
'use strict';

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parse(s) { return new Date(s + 'T00:00:00'); }
function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
function listDays(a, b) {
  var out = [], d = a;
  while (d <= b && out.length < 120) { out.push(d); d = addDays(d, 1); }
  return out;
}
function r1(x) { return Math.round(x * 10) / 10; }
function num(v) { v = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(v) && v > 0 ? v : 0; }
var _n = 0;
function uid() { _n++; return Math.random().toString(36).slice(2, 8) + _n.toString(36); }

/* ---------- osnova: šablony a vložení textem ---------- */
var TEMPLATES = {
  navrh: {
    name: 'Návrhová a ověřovací práce (návrh řešení a ověření v praxi)',
    chapters: [
      ['Úvod', 5, ['Motivace a téma', 'Cíle práce a výzkumné otázky', 'Struktura práce']],
      ['Teoretická východiska', 30, ['Vymezení pojmů a rámec tématu', 'Dosavadní poznatky a literatura', 'Shrnutí a vymezení problému']],
      ['Návrh řešení', 28, ['Požadavky a výchozí podmínky', 'Popis navrženého řešení', 'Zdůvodnění návrhu']],
      ['Ověření v praxi', 32, ['Metodika a vzorek', 'Průběh ověření', 'Výsledky', 'Diskuse a omezení']],
      ['Závěr', 5, ['Shrnutí výsledků', 'Doporučení a další práce']],
      ['Abstrakt, literatura a přílohy', 0, ['Abstrakt česky a anglicky', 'Seznam literatury', 'Přílohy']]
    ]
  },
  teor: {
    name: 'Teoretická a rešeršní práce',
    chapters: [
      ['Úvod', 6, ['Téma a jeho význam', 'Cíle a struktura práce']],
      ['Vymezení pojmů', 22, ['Základní pojmy', 'Historický kontext']],
      ['Dosavadní poznatky', 32, ['Přehled literatury', 'Srovnání přístupů']],
      ['Analýza a diskuse', 34, ['Analýza', 'Diskuse', 'Omezení']],
      ['Závěr', 6, ['Shrnutí', 'Doporučení']],
      ['Abstrakt, literatura a přílohy', 0, ['Abstrakt česky a anglicky', 'Seznam literatury', 'Přílohy']]
    ]
  }
};

function mkSection(t, id) { return { id: id || uid(), title: String(t).trim(), done: false }; }
function mkChapter(o) {
  return {
    id: o.id || uid(), title: String(o.title || '').trim() || 'Kapitola', status: o.status || 'todo',
    pages: num(o.pages), target: num(o.target), note: o.note || '',
    sections: (o.sections || []).filter(function (s) { return String(s).trim(); }).map(function (s) { return typeof s === 'string' ? mkSection(s) : s; })
  };
}
/* Rozdělí cílový rozsah podle podílů tak, aby součet přesně seděl. */
function fromTemplate(key, total) {
  var t = TEMPLATES[key] || TEMPLATES.navrh;
  total = Math.max(0, Math.round(Number(total) || 0));
  var sumShare = t.chapters.reduce(function (a, c) { return a + c[1]; }, 0) || 1;
  var tg = t.chapters.map(function (c) { return Math.round(total * c[1] / sumShare); });
  var diff = total - tg.reduce(function (a, b) { return a + b; }, 0);
  if (diff) { var big = 0; t.chapters.forEach(function (c, i) { if (c[1] > t.chapters[big][1]) big = i; }); tg[big] += diff; }
  return t.chapters.map(function (c, i) { return mkChapter({ title: c[0], target: tg[i], sections: c[2] }); });
}
/* Vložený text: řádek bez odsazení = kapitola, odsazený nebo s pomlčkou = oddíl.
   Na konci kapitoly jde napsat cíl, např. "Teorie (18)" nebo "Teorie [18 stran]". */
function parseOutline(text) {
  var out = [], cur = null;
  String(text || '').split(/\r?\n/).forEach(function (raw) {
    if (!raw.trim()) return;
    var isSec = /^\s+\S/.test(raw) || /^\s*[-–•*]\s+/.test(raw);
    var line = raw.trim().replace(/^[-–•*]\s+/, '');
    if (isSec) {
      if (!cur) { cur = { title: 'Kapitola', target: 0, sections: [] }; out.push(cur); }
      cur.sections.push(line.replace(/^\d+(\.\d+)*\.?\s+/, ''));
    } else {
      var target = 0;
      line = line.replace(/\s*[\(\[]\s*(\d+(?:[.,]\d+)?)\s*(?:s|str|stran\w*|stránek)?\.?\s*[\)\]]\s*$/i, function (m, n) { target = num(n); return ''; });
      cur = { title: line.replace(/^\d+\.?\s+/, '').trim() || 'Kapitola', target: target, sections: [] };
      out.push(cur);
    }
  });
  return out.map(function (c) { return mkChapter(c); });
}
function sectionsText(ch) { return (ch.sections || []).map(function (s) { return s.title; }).join('\n'); }
/* Z textu (jeden oddíl na řádek) udělá oddíly a zachová stav hotovo u těch, které se jmenují stejně. */
function setSections(ch, text) {
  var old = {}; (ch.sections || []).forEach(function (s) { old[s.title] = s; });
  ch.sections = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (t) { return old[t] || mkSection(t); });
}
/* Doplní chybějící pole u kapitol uložených starší verzí. */
function fixChapter(c) {
  c.pages = num(c.pages); c.target = num(c.target);
  if (c.note == null) c.note = '';
  if (!Array.isArray(c.sections)) c.sections = [];
  if (!c.status) c.status = 'todo';
  return c;
}

/* ---------- průběh ---------- */
function pagesTotal(th) { return r1(th.chapters.reduce(function (a, c) { return a + num(c.pages); }, 0)); }
function targetTotal(th) { return r1(th.chapters.reduce(function (a, c) { return a + num(c.target); }, 0)); }
function chapterRemaining(c) { return c.status === 'done' ? 0 : Math.max(0, num(c.target) - num(c.pages)); }
function chapterPct(c) {
  if (c.status === 'done') return 100;
  var t = num(c.target);
  if (t) return Math.min(99, Math.round(100 * num(c.pages) / t));
  var n = (c.sections || []).length;
  return n ? Math.min(99, Math.round(100 * c.sections.filter(function (s) { return s.done; }).length / n)) : 0;
}
function loggedOn(th, date) { return r1((th.log || []).reduce(function (a, e) { return a + (e.date === date ? num(e.pages) : 0); }, 0)); }

/* Zápis napsaných stran: přidá je do kapitoly i do deníku. Vrací záznam (pro vrácení zpět). */
function addLog(th, o) {
  var ch = th.chapters.filter(function (c) { return c.id === o.chId; })[0];
  var pg = num(o.pages);
  if (!ch || !pg) return null;
  var e = { id: o.id || uid(), date: o.date, chId: ch.id, pages: pg, prev: ch.status };
  ch.pages = r1(num(ch.pages) + pg);
  if (ch.status === 'todo') ch.status = 'wip';
  th.log.push(e);
  return e;
}
function removeLog(th, id) {
  var i = th.log.map(function (e) { return e.id; }).indexOf(id);
  if (i < 0) return false;
  var e = th.log[i], ch = th.chapters.filter(function (c) { return c.id === e.chId; })[0];
  if (ch) {
    ch.pages = Math.max(0, r1(num(ch.pages) - num(e.pages)));
    if (e.prev === 'todo' && ch.status === 'wip' && ch.pages === 0) ch.status = 'todo';
  }
  th.log.splice(i, 1);
  return true;
}

/* ---------- plán sprintu ----------
   Plán se pokaždé spočítá znovu z toho, co zbývá napsat, a rozloží se do zbývajících psacích dnů.
   Zameškaný den se tedy nikde nehromadí jako dluh, jen se mírně zvedne denní dávka. */
var HARD = 8, OVER = 12; /* stran za den: odhad zdravého rozumu, ne měření */
function plan(th, today) {
  var sp = th.sprint || {};
  if (!sp.start || !sp.end || sp.end < sp.start) return { active: false };
  var days = listDays(sp.start, sp.end), rest = {}; (sp.rest || []).forEach(function (d) { rest[d] = 1; });
  var finalDay = days.length >= 4 ? sp.end : '';
  var t = today < sp.start ? sp.start : today;
  var fut = days.filter(function (d) { return d >= t && !rest[d] && d !== finalDay; });
  var chs = th.chapters.filter(function (c) { return chapterRemaining(c) > 0; });
  var R = r1(chs.reduce(function (a, c) { return a + chapterRemaining(c); }, 0));
  var W = fut.length, todayIn = fut.length && fut[0] === today;
  var tl = todayIn ? loggedOn(th, today) : 0;
  var q = W ? (R + tl) / W : 0, q2 = q, todayRem = q;
  if (todayIn) { if (tl >= q) { todayRem = 0; q2 = W > 1 ? R / (W - 1) : 0; } else todayRem = q - tl; }
  var queue = chs.map(function (c) { return { id: c.id, title: c.title, rem: chapterRemaining(c) }; });
  var alloc = {};
  fut.forEach(function (d) {
    var cap = (todayIn && d === today) ? todayRem : q2, list = [];
    while (cap > 1e-6 && queue.length) {
      var take = Math.min(cap, queue[0].rem);
      list.push({ chId: queue[0].id, title: queue[0].title, pages: r1(take) });
      queue[0].rem -= take; cap -= take;
      if (queue[0].rem <= 1e-6) queue.shift();
    }
    alloc[d] = list;
  });
  var out = days.map(function (d) {
    var kind = d < t ? 'past' : rest[d] ? 'rest' : d === finalDay ? 'final' : d === today ? 'today' : 'future';
    if (d < today && d >= t) kind = 'past';
    return { date: d, kind: kind, logged: loggedOn(th, d), alloc: alloc[d] || [], isToday: d === today,
      quota: kind === 'today' ? r1(todayRem) : (kind === 'future' ? r1(q2) : 0) };
  });
  var peak = q2, level;
  if (!th.chapters.length || !targetTotal(th)) level = 'notargets';
  else if (R <= 0) level = 'done';
  else if (!W) level = 'nodays';
  else level = peak > OVER ? 'over' : peak > HARD ? 'hard' : 'ok';
  return { active: true, start: sp.start, end: sp.end, finalDay: finalDay, days: out, remaining: R, writingDays: W,
    perDay: r1(peak), todayQuota: todayIn ? r1(todayRem) : 0, todayLogged: loggedOn(th, today), todayIsWriting: !!todayIn,
    level: level, reach: r1(OVER * W + tl), notStarted: today < sp.start };
}

/* Další malý krok, když nevíš, kde začít. */
function nextStep(th) {
  var open = th.chapters.filter(function (c) { return c.status !== 'done'; });
  if (!th.chapters.length) return { none: true, text: 'Nejdřív si vlož osnovu kapitol. Stačí hrubá, jde ji pak upravit.' };
  if (!open.length) return { none: true, text: 'Všechny kapitoly jsou hotové. Zbývá revize a kontrola před odevzdáním.' };
  var wip = open.filter(function (c) { return c.status === 'wip'; });
  var ch = (wip[0] || open[0]);
  var sec = (ch.sections || []).filter(function (s) { return !s.done; })[0];
  var text;
  if (sec) text = 'Napiš oddíl „' + sec.title + '“ v kapitole „' + ch.title + '“. Stačí hrubý koncept, dopilovat budeš později.';
  else if (!num(ch.pages)) text = 'Napiš pro kapitolu „' + ch.title + '“ osnovu o 3 až 5 bodech. Samotný text přijde potom.';
  else text = 'Dopiš kapitolu „' + ch.title + '“ aspoň o jednu stranu. Co nevíš (citace, obrázek), zaparkuj a pokračuj.';
  return { chId: ch.id, secId: sec ? sec.id : '', title: ch.title, text: text };
}

/* ---------- zaparkované věci a kontrolní seznam ---------- */
var PARK_KINDS = { src: 'Zdroj nebo citace', fig: 'Obrázek, graf, tabulka', ask: 'Zeptat se vedoucí', todo: 'Dodělat později' };
function defaultChecklist() {
  return ['Zadání práce schválené a v souladu s názvem práce', 'Název práce česky a anglicky',
    'Abstrakt česky a anglicky a klíčová slova', 'Prohlášení a poděkování', 'Obsah a seznamy obrázků a tabulek bez chyb',
    'Citace v textu odpovídají seznamu literatury (ČSN ISO 690)', 'Přílohy očíslované a odkazované z textu',
    'Kontrola překlepů a formátování podle šablony katedry', 'Finální verze přečtená vedoucím', 'PDF nahrané do STAG a otevírá se']
    .map(function (t) { return { id: uid(), title: t, done: false }; });
}

/* ---------- export ---------- */
function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kapitola';
}
function texEsc(s) {
  return String(s).replace(/[\\&%$#_{}~^]/g, function (c) {
    return { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[c];
  });
}
function oneLine(s) { return String(s || '').replace(/\s*[\r\n]+\s*/g, ' ').trim(); }
/* Kostra kapitol pro LaTeX. Poznámky a zaparkované věci jsou v komentářích, takže nic nerozbijí. */
function latex(th, today) {
  var used = {}, L = [];
  L.push('% Kostra kapitol ze Stickies (' + today + ')');
  if (th.title) L.push('% Práce: ' + oneLine(th.title));
  L.push('% Vlož do hlavního souboru šablony nebo rozděl do souborů podle kapitol.', '');
  th.chapters.forEach(function (c) {
    var s = slug(c.title), k = s, i = 2; while (used[k]) k = s + '-' + (i++); used[k] = 1;
    L.push('\\chapter{' + texEsc(c.title) + '}', '\\label{kap:' + k + '}');
    L.push('% cíl: ' + (num(c.target) ? num(c.target) + ' stran' : 'bez cíle') + ', napsáno: ' + num(c.pages) + ', stav: ' + c.status);
    if (c.note) L.push('% poznámka: ' + oneLine(c.note));
    (th.parking || []).filter(function (p) { return p.chId === c.id && !p.done; }).forEach(function (p) {
      L.push('% TODO [' + (PARK_KINDS[p.kind] || p.kind) + ']: ' + oneLine(p.text));
    });
    L.push('');
    (c.sections || []).forEach(function (sec) {
      L.push('\\section{' + texEsc(sec.title) + '}', sec.done ? '% hotovo' : '% TODO: napsat', '');
    });
  });
  var loose = (th.parking || []).filter(function (p) { return !p.done && !th.chapters.some(function (c) { return c.id === p.chId; }); });
  if (loose.length) { L.push('% --- Zaparkované bez kapitoly ---'); loose.forEach(function (p) { L.push('% TODO [' + (PARK_KINDS[p.kind] || p.kind) + ']: ' + oneLine(p.text)); }); }
  return L.join('\n') + '\n';
}

/* Brief pro Clauda: kontext práce, který jde vložit do chatu. S chId se zaměří na jednu kapitolu. */
function brief(th, o) {
  o = o || {};
  var ch = o.chId ? th.chapters.filter(function (c) { return c.id === o.chId; })[0] : null;
  var L = [];
  L.push('# Diplomová práce: kontext', '');
  L.push('Název: ' + (th.title || 'zatím bez názvu'));
  if (th.supervisor) L.push('Vedoucí: ' + th.supervisor + (th.department ? ' (' + th.department + ')' : ''));
  if (th.dates && th.dates.submit) L.push('Odevzdání: ' + th.dates.submit);
  L.push('Cílový rozsah: ' + (th.targetPages || targetTotal(th) || '?') + ' stran, napsáno ' + pagesTotal(th), '');
  L.push('## Osnova a stav');
  th.chapters.forEach(function (c, i) {
    var mark = ch && ch.id === c.id ? ' <- TEĎ PÍŠU' : '';
    L.push((i + 1) + '. ' + c.title + ' [' + c.status + ', ' + num(c.pages) + (num(c.target) ? ' / ' + num(c.target) : '') + ' stran]' + mark);
    (c.sections || []).forEach(function (s) { L.push('   - ' + (s.done ? '[x] ' : '[ ] ') + s.title); });
    if (c.note && (!ch || ch.id === c.id)) L.push('   Poznámka: ' + oneLine(c.note));
  });
  var open = (th.parking || []).filter(function (p) { return !p.done && (!ch || p.chId === ch.id || !p.chId); });
  if (open.length) { L.push('', '## Zaparkované věci'); open.forEach(function (p) { L.push('- [' + (PARK_KINDS[p.kind] || p.kind) + '] ' + oneLine(p.text)); }); }
  var cons = (th.consultations || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 3);
  if (cons.length) { L.push('', '## Poslední konzultace'); cons.forEach(function (c) { L.push('- ' + c.date + ': ' + oneLine(c.note)); }); }
  if (th.notes) L.push('', '## Poznámky', th.notes.trim());
  L.push('', '## Zadání');
  L.push(ch ? 'Pomoz mi napsat koncept kapitoly „' + ch.title + '“ podle oddílů výše. Piš česky, odborným ale srozumitelným stylem. Kde potřebuješ zdroj nebo údaj, který nemám, označ to jako [DOPLNIT] místo vymýšlení.'
            : 'Pomoz mi s další částí práce podle osnovy výše. Piš česky, odborným ale srozumitelným stylem. Kde potřebuješ zdroj nebo údaj, který nemám, označ to jako [DOPLNIT] místo vymýšlení.');
  return L.join('\n') + '\n';
}

var api = {
  TEMPLATES: TEMPLATES, PARK_KINDS: PARK_KINDS, HARD: HARD, OVER: OVER,
  fromTemplate: fromTemplate, parseOutline: parseOutline, mkChapter: mkChapter, fixChapter: fixChapter,
  sectionsText: sectionsText, setSections: setSections, pagesTotal: pagesTotal, targetTotal: targetTotal,
  chapterRemaining: chapterRemaining, chapterPct: chapterPct, loggedOn: loggedOn, addLog: addLog, removeLog: removeLog,
  plan: plan, nextStep: nextStep, defaultChecklist: defaultChecklist, latex: latex, brief: brief,
  slug: slug, texEsc: texEsc, addDays: addDays, listDays: listDays, uid: uid
};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Diplomka = api;
})(typeof window !== 'undefined' ? window : this);
