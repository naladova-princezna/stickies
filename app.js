(() => {
  "use strict";

  const Plan = window.Plan;

  /* =====================================================================
     Konstanty
     ===================================================================== */
  const COLORS = ["violet", "teal", "pink", "amber", "blue", "lime"];
  const COLOR_NAMES = { violet: "Fialová", teal: "Tyrkysová", pink: "Růžová", amber: "Oranžová", blue: "Modrá", lime: "Zelená" };
  const DEFAULT_CATS = [["Práce", "violet"], ["Studium", "teal"], ["Domácnost", "amber"], ["Osobní", "pink"]];
  const EFFORTS = ["light", "medium", "hard"];
  const EFFORT_LABEL = { light: "Lehký", medium: "Střední", hard: "Náročný" };
  /* Skupiny lístků v zásobníku: co hoří, co je priorita a co počká */
  const LANES = ["fire", "prio", "wait"];
  const LANE_LABEL = { fire: "Hoří deadline", prio: "Priorita", wait: "Počká" };
  const LANE_HINT = { fire: "Termín je blízko nebo už uplynul.", prio: "Důležité, ale ještě nehoří.", wait: "Může chvíli počkat, nic se neděje." };
  const laneOf = (t) => (LANES.includes(t.lane) ? t.lane : "wait");
  const STATUSES = ["today", "backlog", "done"];
  const TOMBSTONE_DAYS = 60;
  const SAVE_DELAY = 1500;
  const POLL_MS = 45000;
  const STEP_TEMPLATE = [
    "Ujasnit si, jak vypadá hotový výsledek",
    "Připravit podklady a pracovní místo",
    "Udělat první krok (do 25 minut)",
    "Zkontrolovat a dokončit",
  ];
  const NS = "http://www.w3.org/2000/svg";
  const EPOCH = "1970-01-01T00:00:00.000Z";

  const K = { session: "stickies:session", pref: "stickies:pref", v2: "stickies:v2:local:cache" };
  let USER = null;                 // přihlášený uživatel (null = režim bez přihlášení)
  function setNamespace(user) {
    USER = user;
    const p = user ? `stickies:v3:u:${user}:` : "stickies:v3:";
    K.study = p + "study"; K.data = p + "data"; K.meta = p + "meta"; K.gh = p + "gh"; K.seeded = p + "seeded"; K.lastcat = p + "lastcat";
  }
  setNamespace(null);

  /* =====================================================================
     Pomocné funkce
     ===================================================================== */
  const $ = (id) => document.getElementById(id);
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const byPos = (a, b) => a.pos - b.pos;
  const nowIso = () => new Date().toISOString();
  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const x = [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isToday = (iso) => Boolean(iso) && dayKey(new Date(iso)) === dayKey();
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });

  /* Česká čísla: 1 náročný, 2–4 náročné, 5+ náročných */
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* plné úložiště apod. */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* nic */ } },
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else el.setAttribute(k, v === true ? "" : v);
    }
    el.append(...kids.flat().filter((x) => x != null && x !== false));
    return el;
  }

  function icon(name) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("class", "i");
    s.setAttribute("aria-hidden", "true");
    const u = document.createElementNS(NS, "use");
    u.setAttribute("href", "#i-" + name);
    s.append(u);
    return s;
  }

  function iconBtn(name, label, fn, k) {
    return h("button", {
      class: "icon-btn", type: "button", "aria-label": label, title: label, "data-k": k,
      on: { click: (e) => { e.stopPropagation(); fn(); } },
    }, icon(name));
  }

  /** Deterministický zápis (seřazené klíče) pro porovnání obsahu. */
  function stable(o) {
    if (Array.isArray(o)) return "[" + o.map(stable).join(",") + "]";
    if (o && typeof o === "object") return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
    return JSON.stringify(o === undefined ? null : o);
  }

  /* =====================================================================
     Datový model
     ===================================================================== */
  function nCat(c) {
    const o = {
      id: String(c.id),
      name: String(c.name || "Bez názvu").slice(0, 40),
      color: COLORS.includes(c.color) ? c.color : "violet",
      pos: Number(c.pos) || 0,
      updated_at: c.updated_at || EPOCH,
    };
    if (c.deleted) o.deleted = true;
    return o;
  }

  function nTask(t) {
    const o = {
      id: String(t.id),
      category_id: String(t.category_id || ""),
      text: String(t.text || "").slice(0, 200),
      status: STATUSES.includes(t.status) ? t.status : "backlog",
      done_at: t.done_at || null,
      pos: Number(t.pos) || 0,
      effort: EFFORTS.includes(t.effort) ? t.effort : "medium",
      lane: LANES.includes(t.lane) ? t.lane : "wait",
      steps: (Array.isArray(t.steps) ? t.steps : [])
        .filter((s) => s && String(s.text || "").trim())
        .map((s) => ({ id: String(s.id || uuid()), text: String(s.text).slice(0, 200), done: Boolean(s.done) })),
      updated_at: t.updated_at || EPOCH,
    };
    if (t.link && t.link.r) o.link = { s: String(t.link.s || ""), r: String(t.link.r), x: String(t.link.x || ""), c: String(t.link.c || ""), d: Boolean(t.link.d) };
    if (t.routine_id) { o.routine_id = String(t.routine_id); o.routine_item = String(t.routine_item || ""); }
    if (t.deleted) o.deleted = true;
    return o;
  }

  function nRoutine(r) {
    const o = {
      id: String(r.id),
      category_id: String(r.category_id || ""),
      name: String(r.name || "Rutina").slice(0, 60),
      items: (Array.isArray(r.items) ? r.items : [])
        .filter((i) => i && String(i.text || "").trim())
        .map((i) => ({ id: String(i.id || uuid()), text: String(i.text).slice(0, 200) })),
      effort: EFFORTS.includes(r.effort) ? r.effort : "medium",
      every_days: Math.max(0, Math.min(365, Math.round(Number(r.every_days) || 0))),
      last_added: r.last_added ? String(r.last_added) : null,
      snooze: r.snooze ? String(r.snooze) : null,
      pos: Number(r.pos) || 0,
      updated_at: r.updated_at || EPOCH,
    };
    if (r.deleted) o.deleted = true;
    return o;
  }

  /** Záznam jednoho dne: id je samo datum, takže z každého dne existuje nejvýš jeden záznam. */
  function nDayRec(d) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ""))) return null;
    const c = (v, def) => (Number.isFinite(+v) ? Math.max(0, Math.min(100, Math.round(+v))) : def);
    const o = { id: String(d.date), date: String(d.date), energy: c(d.energy, 60), load: c(d.load, 40), set: d.set !== false, updated_at: d.updated_at || EPOCH };
    if (d.cycle_start) o.cycle_start = true;
    if (d.deleted) o.deleted = true;
    return o;
  }

  /* Studium je pro hostitele jeden záznam; jeho obsah řeší stránka Studium (studium.js). */
  const studyStr = (o) => { const c = { ...o }; delete c.updated_at; delete c.deleted; return stable(c); };
  const studyMark = new WeakMap();      // objekt studia → obsah, jak je uložený (pro zjištění změn)
  function nStudy(x) {
    const o = x.deleted ? { id: String(x.id), deleted: true } : { ...x, id: String(x.id) };
    o.updated_at = x.updated_at || EPOCH;
    studyMark.set(o, studyStr(o));
    return o;
  }

  function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const cats = (Array.isArray(r.categories) ? r.categories : []).filter((x) => x && x.id).map(nCat);
    const tasks = (Array.isArray(r.tasks) ? r.tasks : []).filter((x) => x && x.id).map(nTask);
    const routines = (Array.isArray(r.routines) ? r.routines : []).filter((x) => x && x.id).map(nRoutine);
    const map = new Map();
    for (const x of (Array.isArray(r.days) ? r.days : []).map(nDayRec).filter(Boolean)) map.set(x.id, x);
    const legacy = nDayRec(r.day);                       // starší verze ukládaly jen dnešek
    if (legacy && legacy.set && !map.has(legacy.id)) map.set(legacy.id, legacy);
    const studies = (Array.isArray(r.studies) ? r.studies : []).filter((x) => x && x.id).map(nStudy);
    return { categories: cats, tasks, routines, days: [...map.values()], studies };
  }

  const canon = (s) => stable({
    c: [...s.categories].sort((a, b) => (a.id < b.id ? -1 : 1)),
    t: [...s.tasks].sort((a, b) => (a.id < b.id ? -1 : 1)),
    r: [...(s.routines || [])].sort((a, b) => (a.id < b.id ? -1 : 1)),
    d: [...(s.days || [])].sort((a, b) => (a.id < b.id ? -1 : 1)),
    s: [...(s.studies || [])].sort((a, b) => (a.id < b.id ? -1 : 1)),
  });

  function pickNewer(x, y) {
    if (!x) return y;
    if (!y) return x;
    const dx = Date.parse(x.updated_at) || 0, dy = Date.parse(y.updated_at) || 0;
    if (dy > dx) return y;
    if (dx > dy) return x;
    return stable(y) > stable(x) ? y : x;       // shoda času: určitý, na zařízení nezávislý výsledek
  }

  function mergeLists(la, lb) {
    const m = new Map(la.map((x) => [x.id, x]));
    for (const y of lb) m.set(y.id, pickNewer(m.get(y.id), y));
    return [...m.values()];
  }

  /** Sloučí dva stavy po záznamech podle nejnovějšího updated_at. */
  function merge(a, b) {
    const cats = mergeLists(a.categories, b.categories);
    const tasks = mergeLists(a.tasks, b.tasks);
    const routines = mergeLists(a.routines || [], b.routines || []);
    const days = mergeLists(a.days || [], b.days || []);
    const studies = mergeLists(a.studies || [], b.studies || []);
    const alive = new Set(cats.filter((c) => !c.deleted).map((c) => c.id));
    const now = nowIso();
    for (const r of routines) {
      if (!r.deleted && !alive.has(r.category_id)) { r.deleted = true; r.updated_at = now; }
    }
    for (const t of tasks) {
      if (!t.deleted && !alive.has(t.category_id)) { t.deleted = true; t.updated_at = now; }  // osiřelé úkoly
    }
    const limit = Date.now() - TOMBSTONE_DAYS * 864e5;
    const fresh = (x) => !(x.deleted && (Date.parse(x.updated_at) || 0) < limit);
    return { categories: cats.filter(fresh), tasks: tasks.filter(fresh), routines: routines.filter(fresh), days: days.filter(fresh), studies: studies.filter(fresh) };
  }

  /** Změněným záznamům nastaví updated_at. */
  function touch(prev, next) {
    const now = nowIso();
    const strip = (o) => { const c = { ...o }; delete c.updated_at; return stable(c); };
    for (const key of ["categories", "tasks", "routines", "days", "studies"]) {
      const pm = new Map((prev[key] || []).map((x) => [x.id, strip(x)]));
      for (const x of next[key] || []) if (pm.get(x.id) !== strip(x)) x.updated_at = now;
    }
  }

  /* =====================================================================
     Stav, uložení
     ===================================================================== */
  let state = { categories: [], tasks: [], routines: [], days: [], studies: [] };
  let meta = { sha: null, dirty: false };
  let gh = null;                    // {repo, token, path, branch}
  let version = 0;                  // počítadlo lokálních změn

  const liveCats = () => state.categories.filter((c) => !c.deleted).sort(byPos);
  const liveTasks = () => state.tasks.filter((t) => !t.deleted);
  const catById = (id) => liveCats().find((c) => c.id === id);
  const taskById = (id) => liveTasks().find((t) => t.id === id);
  const effRank = { hard: 0, medium: 1, light: 2 };
  const todayOpen = () => liveTasks().filter((t) => t.status === "today").sort((a, b) => effRank[a.effort] - effRank[b.effort] || a.pos - b.pos);
  const doneToday = () => liveTasks().filter((t) => t.status === "done" && isToday(t.done_at)).sort((a, b) => new Date(b.done_at) - new Date(a.done_at));
  const backlogOf = (cid) => liveTasks().filter((t) => t.status === "backlog" && t.category_id === cid).sort(byPos);

  function persist() {
    store.set(K.data, state);
    store.set(K.meta, meta);
  }

  function loadLocal() {
    let raw = store.get(K.data, null);
    let migrated = false;
    if (!raw) {
      const v2 = store.get(K.v2, null);
      if (v2 && Array.isArray(v2.tasks)) { raw = v2; migrated = true; }
    }
    state = normalize(raw || {});
    meta = Object.assign({ sha: null, dirty: false }, store.get(K.meta, {}));
    if (!USER) gh = null;
    if (migrated) { store.set(K.seeded, true); persist(); }
  }

  const needsSeed = () => !state.categories.length && !state.tasks.length && !store.get(K.seeded, false) && !gh;
  function seedDefaults() {
    store.set(K.seeded, true);
    commit((s) => {
      const t0 = Date.now();
      DEFAULT_CATS.forEach(([name, color], i) => s.categories.push({ id: uuid(), name, color, pos: t0 + i, updated_at: nowIso() }));
    });
  }

  /** Jediné místo, kudy procházejí změny dat. Volitelně nabídne „Zpět“. */
  function commit(mutate, msg, opts = {}) {
    const before = clone(state);
    mutate(state);
    touch(before, state);
    reconcileStudyLinks();
    version++;
    meta.dirty = true;
    persist();
    render();
    scheduleSave();
    if (msg) {
      toast(msg, {
        undo: () => {
          const cur = state;
          state = clone(before);
          touch(cur, state);
          reconcileStudyLinks();
          version++;
          meta.dirty = true;
          persist();
          render();
          scheduleSave();
        },
        action: opts.action,
        ms: opts.ms,
      });
    }
  }

  /* =====================================================================
     Úložiště: Supabase (přihlášení + řádek s daty chráněný Row Level Security)
     ===================================================================== */
  const SYNC = {
    local:   ["Jen v tomto zařízení", "warn", "Lokálně"],
    pending: ["Čeká na uložení", "busy", "Ukládání"],
    saving:  ["Ukládám…", "busy", "Ukládám"],
    ok:      ["Uloženo v cloudu", "ok", "Uloženo"],
    offline: ["Offline · uloží se později", "warn", "Offline"],
    error:   ["Chyba · zkouším znovu", "bad", "Chyba"],
    auth:    ["Přihlášení vypršelo", "bad", "Přihlásit"],
  };
  let syncKind = "local", syncDetail = "";

  function setSync(kind, detail = "") {
    syncKind = kind; syncDetail = detail;
    const [txt, cls, short] = SYNC[kind];
    for (const [btn, t, s] of [[$("sync"), $("sync-text"), txt], [$("sync-mini"), $("sync-mini-text"), short]]) {
      btn.className = btn.className.replace(/\b(ok|warn|bad|busy)\b/g, "").trim() + " " + cls;
      t.textContent = s;
    }
    renderStoreStatus();
  }

  const CloudError = window.StickiesCloud ? window.StickiesCloud.CloudError : class extends Error {};

  async function ghGetFile() {
    const row = await window.StickiesCloud.getDoc();
    if (!row) return null;
    if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) throw new Error("Data v cloudu nemají očekávaný tvar. Nepřepisuji je.");
    return { sha: row.rev, data: normalize(row.data) };
  }

  async function ghPutFile(snapshot, rev) {
    const res = await window.StickiesCloud.putDoc({ app: "stickies", v: 3, saved_at: nowIso(), ...snapshot }, rev == null ? null : rev);
    return res.conflict ? { conflict: true } : { sha: res.rev };
  }

  let saveTimer = null, retryTimer = null, syncing = false, again = false;

  function scheduleSave(delay = SAVE_DELAY) {
    if (!gh) return;
    clearTimeout(saveTimer);
    setSync(navigator.onLine ? "pending" : "offline");
    saveTimer = setTimeout(sync, delay);
  }

  async function sync() {
    if (!gh) return;
    if (syncing) { again = true; return; }
    if (!navigator.onLine) { setSync("offline"); return; }
    syncing = true;
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    setSync("saving");
    try {
      let settled = false;
      for (let i = 0; i < 4 && !settled; i++) {
        const remote = await ghGetFile();
        if (!remote && !state.categories.length && !state.tasks.length) {
          // nový uživatel bez dat v repozitáři: výchozí kategorie
          store.set(K.seeded, true);
          const t0 = Date.now();
          DEFAULT_CATS.forEach(([name, color], i) => state.categories.push({ id: uuid(), name, color, pos: t0 + i, updated_at: nowIso() }));
          version++; persist(); render();
        }
        // Od teď synchronně: sloučit s aktuálním stavem (uživatel mohl mezitím něco změnit).
        let merged = remote ? merge(state, remote.data) : state;
        if (canon(merged) !== canon(state)) { state = merged; version++; persist(); render(); }
        if (reconcileStudyLinks()) { version++; persist(); render(); }
        merged = state;
        const snapVer = version;
        const same = remote && canon(merged) === canon(remote.data);
        if (same) {
          meta.sha = remote.sha;
          if (snapVer === version) meta.dirty = false;
          settled = true;
        } else {
          const res = await ghPutFile({ categories: merged.categories, tasks: merged.tasks, routines: merged.routines || [], days: merged.days || [], studies: merged.studies || [] }, remote ? remote.sha : null);
          if (res.conflict) continue;
          meta.sha = res.sha;
          if (snapVer === version) meta.dirty = false;
          settled = true;
        }
      }
      if (!settled) throw new Error("Soubor se mezitím měnil z jiného zařízení. Zkusím to znovu.");
      persist();
      if (meta.dirty) scheduleSave(); else setSync("ok");
    } catch (err) {
      console.warn("[sync]", err);
      if (err instanceof CloudError && (err.status === 401 || err.status === 403)) {
        setSync("auth", "Přihlášení vypršelo. Přihlas se znovu, nic se neztratí.");
        showLogin("Přihlášení vypršelo. Přihlas se znovu, změny na tomto zařízení zůstaly uložené.");
      }
      else { setSync(navigator.onLine ? "error" : "offline", err.message || ""); retryTimer = setTimeout(sync, 20000); }
    } finally {
      syncing = false;
      if (again) { again = false; scheduleSave(300); }
    }
  }

  let lastRefresh = 0;
  function refresh() {
    if (!gh || document.hidden) return;
    if (Date.now() - lastRefresh < 2000) return;
    lastRefresh = Date.now();
    sync();
  }


  /* =====================================================================
     Toast
     ===================================================================== */
  let toastTimer = null;
  function toast(msg, o = {}) {
    $("toast-msg").textContent = msg;
    const u = $("toast-undo"), a = $("toast-action");
    u.hidden = !o.undo;
    u.onclick = o.undo ? () => { hideToast(); o.undo(); } : null;
    a.hidden = !o.action;
    if (o.action) { a.textContent = o.action.label; a.onclick = () => { hideToast(); o.action.fn(); }; }
    else a.onclick = null;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, o.ms || (o.undo || o.action ? 8000 : 4500));
  }
  function hideToast() { $("toast").classList.remove("show"); clearTimeout(toastTimer); }

  /* =====================================================================
     Akce
     ===================================================================== */
  const PRAISE = ["Hotovo.", "Odškrtnuto.", "Jedna věc míň.", "Skvělé, další hotovo.", "Dobrá práce."];

  /** Malá oslava dokončení. Vypíná se v nastavení i podle systému. */
  function celebrate(rect, big) {
    if (reduceMotion()) return;
    const n = big ? 42 : 14;
    const cx = rect.left + (rect.width || 0) / 2, cy = rect.top + (rect.height || 0) / 2;
    const colors = ["#7c6cff", "#1fe0b8", "#ff7ab0", "#ffc861", "#5cc8ff", "#a4ec7a"];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = (big ? 140 : 60) + Math.random() * (big ? 220 : 70);
      const s = h("span", { class: "confetti", "aria-hidden": "true" });
      s.style.cssText = `left:${cx}px;top:${cy}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--r:${Math.round(Math.random() * 540 - 270)}deg`;
      document.body.append(s);
      setTimeout(() => s.remove(), 1000);
    }
  }


  /* =====================================================================
     Tisk (do tiskárny nebo do PDF): úkoly ze všech kategorií
     ===================================================================== */
  function printNode(root) {
    const old = document.getElementById("print-root"); if (old) old.remove();
    root.id = "print-root";
    document.body.append(root);
    const cleanup = () => { root.remove(); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => window.print(), 80);
  }
  function printTasks(withDone, withSteps) {
    const tasks = liveTasks(), cats = liveCats();
    const root = h("div");
    const stamp = new Date().toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
    root.append(h("h1", null, "Úkoly"), h("p", { class: "pr-sub" }, `Vytištěno ${stamp}`));
    let count = 0;
    const box = (on) => h("span", { class: "pr-box" + (on ? " pr-on" : ""), "aria-hidden": "true" });
    const row = (t) => {
      const done = t.status === "done";
      const meta = [done ? "hotovo" : t.status === "today" ? "dnes" : null, EFFORT_LABEL[t.effort]].filter(Boolean).join(" · ");
      const li = h("li", { class: done ? "pr-done" : "" },
        h("div", { class: "pr-line" }, box(done), h("span", { class: "pr-text" }, t.text), h("span", { class: "pr-meta" }, meta)));
      if (withSteps && t.steps.length) {
        li.append(h("ul", { class: "pr-steps" }, ...t.steps.map((s) => h("li", { class: s.done ? "pr-done" : "" },
          h("div", { class: "pr-line" }, box(s.done), h("span", { class: "pr-text" }, s.text))))));
      }
      count++;
      return li;
    };
    for (const c of cats) {
      const mine = tasks.filter((t) => t.category_id === c.id);
      const open = mine.filter((t) => t.status !== "done")
        .sort((x, y) => (x.status === "today" ? 0 : 1) - (y.status === "today" ? 0 : 1) || byPos(x, y));
      const done = withDone ? mine.filter((t) => t.status === "done").sort((x, y) => new Date(y.done_at || 0) - new Date(x.done_at || 0)) : [];
      if (!open.length && !done.length) continue;
      root.append(h("section", { class: "pr-sec" }, h("h2", null, c.name), h("ul", { class: "pr-list" }, ...open.map(row), ...done.map(row))));
    }
    if (!count) { toast("Není co tisknout."); return; }
    printNode(root);
  }

  const act = {
    complete(id, src) {
      const rect = src ? src.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
      const open = todayOpen();
      const last = open.length === 1 && open[0].id === id;
      const msg = last ? "Dnešek je splněný. Teď si můžeš odpočinout." : PRAISE[doneToday().length % PRAISE.length];
      commit((s) => { const t = s.tasks.find((x) => x.id === id); t.status = "done"; t.done_at = nowIso(); }, msg);
      celebrate(rect, last);
    },
    reopen(id) {
      commit((s) => {
        const t = s.tasks.find((x) => x.id === id);
        t.status = isToday(t.done_at) ? "today" : "backlog";
        t.done_at = null;
        t.pos = Date.now();
      });
    },
    toToday(id) {
      commit((s) => { const t = s.tasks.find((x) => x.id === id); t.status = "today"; t.pos = Date.now(); }, "Přesunuto na dnes.");
    },
    toBacklog(id) {
      commit((s) => { const t = s.tasks.find((x) => x.id === id); t.status = "backlog"; t.pos = Date.now(); }, "Vráceno do zásobníku.");
    },
    setLane(id, lane) {
      if (!LANES.includes(lane)) return;
      commit((s) => { const t = s.tasks.find((x) => x.id === id); if (t) t.lane = lane; }, `Přesunuto: ${LANE_LABEL[lane]}.`);
    },
    remove(id) {
      commit((s) => { const t = s.tasks.find((x) => x.id === id); t.deleted = true; }, "Úkol smazán.");
    },
    step(tid, sid) {
      commit((s) => {
        const st = s.tasks.find((x) => x.id === tid).steps.find((x) => x.id === sid);
        st.done = !st.done;
      });
    },
    addStep(tid, text) {
      const v = String(text || "").trim();
      if (!v) return;
      commit((s) => { s.tasks.find((x) => x.id === tid).steps.push({ id: uuid(), text: v.slice(0, 200), done: false }); });
    },
    removeStep(tid, sid) {
      commit((s) => { const t = s.tasks.find((x) => x.id === tid); t.steps = t.steps.filter((x) => x.id !== sid); });
    },
    template(tid) {
      commit((s) => {
        const t = s.tasks.find((x) => x.id === tid);
        const have = t.steps.map((x) => x.text);
        STEP_TEMPLATE.filter((x) => !have.includes(x)).forEach((x) => t.steps.push({ id: uuid(), text: x, done: false }));
      });
    },
    /** Z nesplněných kroků vzniknou samostatné lehké úkoly ve stejné kategorii. */
    split(tid) {
      const src = taskById(tid);
      if (!src) return;
      const todo = src.steps.filter((x) => !x.done);
      if (!todo.length) return;
      commit((s) => {
        const t = s.tasks.find((x) => x.id === tid);
        const base = Date.now();
        todo.forEach((st, i) => s.tasks.push({
          id: uuid(), category_id: t.category_id, text: st.text, status: t.status === "done" ? "backlog" : t.status,
          done_at: null, pos: base + i, effort: "light", steps: [], updated_at: nowIso(),
        }));
        t.deleted = true;
      }, `Rozděleno na ${todo.length} ${plural(todo.length, "úkol", "úkoly", "úkolů")}.`);
    },
  };

  /* =====================================================================
     Studium: stránka v rámečku (studium.html), data jsou součástí dat uživatele
     ===================================================================== */
  const liveStudies = () => state.studies.filter((s) => !s.deleted);
  let studyFrame = null, studyRoute = "";

  /* ---------- Úkoly ze studia ve vybraném seznamu (kategorii) ----------
     Podmínka předmětu (nebo úkol závěrečné práce) se zobrazí jako lístek v kategorii, kterou si u studia vybereš.
     Odškrtnutí platí oběma směry. Změna textu nebo termínu ve Studiu přepíše lístek, úpravy lístku ve Stickies
     se nevracejí. Smazaný lístek se znovu nevytvoří. */
  const studyThesisLabel = (st) => (st.level === "bc" ? "Bakalářka" : st.level === "phd" ? "Disertace" : st.level === "other" ? "Závěrečná práce" : "Diplomka");
  function studyTaskText(label, r) {
    let t = `${label}: ${String(r.title || "").trim()}`;
    if (r.due) { const d = new Date(r.due + "T00:00:00"); t += ` (do ${d.getDate()}. ${d.getMonth() + 1}.)`; }
    return t.slice(0, 200);
  }
  /** Podmínka předmětu (nebo úkol závěrečné práce), ze které lístek vznikl. */
  function findStudyReq(t, src = state) {
    if (!t || !t.link) return null;
    const st = (src.studies || []).find((x) => !x.deleted && x.id === t.link.s);
    if (!st) return null;
    for (const sj of st.subjects || []) for (const r of sj.reqs || []) if (r.id === t.link.r) return { st, r };
    for (const r of (st.thesis && st.thesis.tasks) || []) if (r.id === t.link.r) return { st, r };
    return null;
  }
  const dueOf = (t) => { const lr = findStudyReq(t); return lr && lr.r.due ? lr.r.due : ""; };

  function reconcileStudyLinks() {
    const now = nowIso();
    let changed = false;
    const cats = new Set(liveCats().map((c) => c.id));
    const byId = new Map(state.tasks.map((t) => [t.id, t]));
    const reqMap = new Map();
    const kill = (t) => { if (!t.deleted) { t.deleted = true; t.updated_at = now; changed = true; } };
    let n = 0;
    for (const st of liveStudies()) {
      const catOk = Boolean(st.category_id) && cats.has(st.category_id);
      const all = st.taskMode === "all";
      const items = [];
      for (const sj of st.subjects || []) {
        const passed = Boolean(sj.grade) && sj.grade !== "F";
        const label = sj.code || String(sj.name || "").slice(0, 30);
        for (const r of sj.reqs || []) items.push({ r, label, passed });
      }
      for (const r of (st.thesis && st.thesis.tasks) || []) items.push({ r, label: studyThesisLabel(st), passed: false });
      for (const { r, label, passed } of items) {
        reqMap.set(st.id + "/" + r.id, r);
        const t = r.tid ? byId.get(r.tid) : null;
        const alive = t && !t.deleted;
        const wanted = catOk && !passed && (all || Boolean(r.due));
        const text = studyTaskText(label, r);
        if (alive) {
          const tdone = t.status === "done";
          if (!t.link) t.link = { s: st.id, r: r.id, x: "", c: "", d: Boolean(r.done) };
          if (tdone !== Boolean(t.link.d)) {                 // změnilo se ve Stickies
            if (Boolean(r.done) !== tdone) { r.done = tdone; r.doneAt = tdone ? dayKey() : ""; }
            t.link.d = tdone; t.updated_at = now; changed = true;
          } else if (Boolean(r.done) !== tdone) {            // změnilo se ve Studiu
            if (r.done) { t.status = "done"; t.done_at = now; } else { t.status = "backlog"; t.done_at = null; }
            t.link.d = Boolean(r.done); t.updated_at = now; changed = true;
          }
          if (t.status !== "done") {
            if (!wanted) { kill(t); r.tid = ""; changed = true; continue; }
            let touched = false;
            if (t.link.x !== text) { t.text = text; t.link.x = text; touched = true; }
            if (t.link.c !== st.category_id) { t.category_id = st.category_id; t.link.c = st.category_id; touched = true; }
            if (touched) { t.updated_at = now; changed = true; }
          }
        } else if (!r.tid && wanted && !r.done) {
          const id = uuid();
          const w = Number(r.weight) || 1;
          state.tasks.push({
            id, category_id: st.category_id, text, status: "backlog", done_at: null, pos: Date.now() + n++,
            effort: w >= 3 ? "hard" : w === 2 ? "medium" : "light", lane: "wait", steps: [], updated_at: now,
            link: { s: st.id, r: r.id, x: text, c: st.category_id, d: false },
          });
          r.tid = id; changed = true;
        }
      }
    }
    // lístky, jejichž podmínka už neexistuje (nebo ukazuje na jiný lístek), se uklidí
    for (const t of state.tasks) {
      if (t.deleted || !t.link) continue;
      const r = reqMap.get(t.link.s + "/" + t.link.r);
      if ((!r || r.tid !== t.id) && t.status !== "done") kill(t);
    }
    if (changed) {
      for (const st of liveStudies()) {
        const str = studyStr(st);
        if (studyMark.get(st) !== str) { st.updated_at = now; studyMark.set(st, str); }
      }
    }
    return changed;
  }

  /** Rozhraní, které používá stránka Studium (rámeček je ze stejného původu). */
  window.StickiesStudy = {
    getStudies: () => liveStudies(),
    getActive: () => store.get(K.study, ""),
    /** Stav lístku podle id: "today", "backlog", "done" nebo "" (neexistuje). */
    taskState: (id) => { const t = taskById(id); return t ? t.status : ""; },
    focus: (id) => { if (taskById(id)) openFocus(id); },
    toToday: (id) => { if (taskById(id)) act.toToday(id); },
    getCategories: () => liveCats().map((c) => ({ id: c.id, name: c.name })),
    /** Tisk z rámečku Studium: dostane hotové HTML (už ošetřené) a vytiskne ho z hlavní stránky. */
    print: (html) => { const r = h("div"); r.innerHTML = html; printNode(r); },
    setActive: (id) => store.set(K.study, id),
    /** Doplnění výchozích polí při načtení není změna dat. */
    mark: (list) => { for (const x of list) studyMark.set(x, studyStr(x)); },
    /** Uloží studia ze stránky (objekty se v ní mění na místě). Změněným nastaví updated_at, chybějící smaže. */
    setStudies(list) {
      const now = nowIso();
      const ids = new Set(list.map((x) => x.id));
      let changed = false;
      for (const x of list) {
        const str = studyStr(x);
        if (studyMark.get(x) !== str || x.deleted) { x.updated_at = now; delete x.deleted; studyMark.set(x, str); changed = true; }
      }
      const gone = state.studies.filter((x) => !x.deleted && !ids.has(x.id)).map((x) => nStudy({ id: x.id, deleted: true, updated_at: now }));
      if (gone.length) changed = true;
      const keepTombs = state.studies.filter((x) => x.deleted && !ids.has(x.id));
      if (!changed) return;
      state.studies = [...list, ...keepTombs, ...gone];
      reconcileStudyLinks();
      version++; meta.dirty = true; persist(); scheduleSave();
      setTimeout(render, 0);
    },
    route(r, push) {
      if (r === studyRoute) return;
      studyRoute = r;
      const h = "#/studium/" + r;
      if (location.hash === h) return;
      if (push) history.pushState(null, "", h); else history.replaceState(null, "", h);
      ROUTE = { name: "studium", sub: r };
    },
  };

  function studyGoto(sub) {
    if (!sub || sub === studyRoute) return;
    studyRoute = sub;
    const w = studyFrame && studyFrame.contentWindow;
    if (w && w.Studium) w.Studium.go(sub);
  }

  function renderStudy() {
    const box = $("study-box");
    if (!studyFrame) {
      studyFrame = h("iframe", { class: "study-frame", title: "Studium", src: "studium.html" + (ROUTE.sub ? "#" + ROUTE.sub : "") });
      studyRoute = ROUTE.sub || "";
      studyFrame.addEventListener("load", syncStudyFrame);
      box.replaceChildren(studyFrame);
    } else {
      syncStudyFrame();
      const w = studyFrame.contentWindow;
      if (w && w.Studium) w.Studium.refresh();
    }
  }

  /** Předá rámečku nastavení vzhledu z „Pohodlí a vzhled“. */
  function syncStudyFrame() {
    const d = studyFrame && studyFrame.contentDocument;
    if (!d) return;
    const r = d.documentElement;
    r.style.setProperty("--fs", String(prefs.fs));
    r.dataset.calm = prefs.calm ? "1" : "0";
    r.dataset.still = prefs.still ? "1" : "0";
  }

  /* =====================================================================
     Routing
     ===================================================================== */
  let ROUTE = { name: "dnes" };

  function parseRoute() {
    const m = (location.hash || "").match(/^#\/(dnes|zasobnik|rutiny|prehled|kat|studium)(?:\/([\w-]+))?$/);
    if (!m) return { name: "dnes" };
    if (m[1] === "studium") return { name: "studium", sub: m[2] || "" };
    if (m[1] === "kat") return catById(m[2]) ? { name: "kat", id: m[2] } : { name: "dnes", fix: true };
    return { name: m[1] };
  }

  function applyRoute(initial) {
    const prev = ROUTE;
    ROUTE = parseRoute();
    if (ROUTE.fix) { ROUTE = { name: "dnes" }; history.replaceState(null, "", "#/dnes"); }
    closeSide();
    if (!initial && (prev.name !== ROUTE.name || prev.id !== ROUTE.id)) {
      window.scrollTo(0, 0);
      setComposerDefaults();
    }
    if (ROUTE.name === "studium") studyGoto(ROUTE.sub);
    render();
    if (!initial) { const mainEl = $("main"); if (mainEl) mainEl.focus({ preventScroll: true }); }
  }

  /* =====================================================================
     Vykreslování
     ===================================================================== */
  function render() {
    // pokud mezitím zmizela kategorie, ze které se právě díváme
    if (ROUTE.name === "kat" && !catById(ROUTE.id)) { ROUTE = { name: "dnes" }; history.replaceState(null, "", "#/dnes"); }

    const active = document.activeElement;
    const focusKey = pendingFocus || (active && active.dataset ? active.dataset.k : null);
    const typed = active && active.tagName === "INPUT" && active.dataset && active.dataset.k ? active.value : null;
    pendingFocus = null;

    renderSide();
    $("view-today").hidden = ROUTE.name !== "dnes";
    $("view-backlog").hidden = ROUTE.name !== "zasobnik";
    $("view-cat").hidden = ROUTE.name !== "kat";
    $("view-routines").hidden = ROUTE.name !== "rutiny";
    $("view-stats").hidden = ROUTE.name !== "prehled";
    $("view-study").hidden = ROUTE.name !== "studium";
    if (ROUTE.name === "dnes") renderToday();
    else if (ROUTE.name === "zasobnik") renderBacklog();
    else if (ROUTE.name === "rutiny") renderRoutines();
    else if (ROUTE.name === "prehled") renderStats();
    else if (ROUTE.name === "studium") renderStudy();
    else renderCat();
    renderComposerOptions();
    setTitle();

    if (focusKey) {
      const el = document.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
      if (el && el !== active) el.focus({ preventScroll: true });
      if (el && typed && el.tagName === "INPUT" && !el.value) el.value = typed;
    }
    renderFocus();
  }

  function setBadge(id, n) { const el = $(id); el.textContent = n; el.hidden = !n; }

  function renderSide() {
    const cats = liveCats();
    const open = todayOpen().length;
    const backlog = liveTasks().filter((t) => t.status === "backlog").length;
    for (const a of qa("[data-route]")) {
      if (a.dataset.route === ROUTE.name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    setBadge("nav-today-n", open); setBadge("nav-backlog-n", backlog);
    setBadge("tab-today-n", open); setBadge("tab-backlog-n", backlog);
    setBadge("nav-routines-n", dueRoutines().length);

    const box = $("side-cats");
    box.replaceChildren(...cats.map((c) => {
      const n = liveTasks().filter((t) => t.category_id === c.id && t.status !== "done").length;
      return h("a", {
        class: `nav-item c-${c.color}`, href: "#/kat/" + c.id, "data-k": "cat:" + c.id,
        "aria-current": ROUTE.name === "kat" && ROUTE.id === c.id ? "page" : false,
      }, h("span", { class: "dot" }), h("span", { class: "nav-label" }, c.name), n ? h("b", { class: "nav-n" }, String(n)) : null);
    }));
    if (!cats.length) box.append(h("p", { class: "side-empty" }, "Zatím žádné kategorie. Přidej první tlačítkem +."));
  }

  /* ---------- Lístek ---------- */
  const TODAY_LIMIT = 5, COL_LIMIT = 6, LANE_LIMIT = 8;
  const openNotes = new Map();          // id úkolu → rozbalen?
  const ui = { allToday: false, allBack: {}, allLane: {}, backView: store.get("stickies:backview", "lanes") === "cats" ? "cats" : "lanes" };
  let pendingFocus = null;

  const isOpenNote = (t, o) => t.status !== "done" && (openNotes.has(t.id) ? openNotes.get(t.id) : Boolean(o.now && t.steps.length));
  function openSteps(id) { openNotes.set(id, true); pendingFocus = "addstep:" + id; render(); }

  function stepsPanel(t) {
    const panel = h("div", { class: "steps-panel" });
    if (t.steps.length) {
      panel.append(h("ul", { class: "steps" }, t.steps.map((s) => h("li", { class: "step-li" },
        h("button", {
          type: "button", class: "step" + (s.done ? " is-done" : ""), "data-k": `step:${t.id}:${s.id}`, "aria-pressed": String(s.done),
          on: { click: (e) => { e.stopPropagation(); act.step(t.id, s.id); } },
        }, h("span", { class: "box" }, icon("tick")), h("span", { class: "st-text" }, s.text)),
        h("button", {
          type: "button", class: "step-x", "aria-label": `Odebrat krok: ${s.text}`, title: "Odebrat krok", "data-k": `stepx:${t.id}:${s.id}`,
          on: { click: (e) => { e.stopPropagation(); act.removeStep(t.id, s.id); } },
        }, icon("x"))))));
    } else {
      panel.append(h("p", { class: "steps-empty" }, "Rozděl úkol na malé kroky. Stačí ty první, každý na pár minut."));
    }
    const input = h("input", {
      type: "text", maxlength: "200", placeholder: t.steps.length ? "Další krok…" : "První krok…",
      "aria-label": "Nový krok", "data-k": "addstep:" + t.id, enterkeyhint: "done", autocomplete: "off",
    });
    panel.append(h("form", {
      class: "step-add",
      on: { submit: (e) => { e.preventDefault(); e.stopPropagation(); const v = input.value; input.value = ""; act.addStep(t.id, v); } },
    }, input, h("button", { class: "icon-btn", type: "submit", "aria-label": "Přidat krok" }, icon("plus"))));
    const links = h("div", { class: "step-links" });
    if (!t.steps.length) {
      links.append(h("button", { type: "button", class: "link-btn", "data-k": "tpl:" + t.id, on: { click: (e) => { e.stopPropagation(); act.template(t.id); } } }, "Vložit šablonu kroků"));
    } else {
      links.append(h("button", { type: "button", class: "link-btn", "data-k": "split:" + t.id, on: { click: (e) => { e.stopPropagation(); act.split(t.id); } } }, "Udělat z kroků samostatné úkoly"));
    }
    panel.append(links);
    return panel;
  }

  function noteEl(t, mode, o = {}) {
    const c = catById(t.category_id) || { color: "violet", name: "?" };
    const done = t.status === "done";
    const stepsDone = t.steps.filter((s) => s.done).length;
    const flag = !done && t.effort === "hard" && !t.steps.length;
    const open = isOpenNote(t, o);
    const fits = Boolean(o.fits);

    const el = h("article", {
      class: `note c-${c.color} is-${mode}${open ? " is-open" : ""}${fits ? " fits" : ""}${o.now ? " is-now" : ""}${t.effort === "hard" ? " is-hard" : ""}`,
      "data-id": t.id,
    });

    const check = h("button", {
      class: "check", type: "button", "data-k": "check:" + t.id,
      "aria-label": done ? `Vrátit mezi otevřené: ${t.text}` : `Hotovo: ${t.text}`,
      title: done ? "Vrátit zpět" : "Označit jako hotové",
      on: { click: (e) => { e.stopPropagation(); done ? act.reopen(t.id) : act.complete(t.id, e.currentTarget); } },
    }, icon(done ? "check-filled" : "circle"));

    const main = h("div", { class: "note-main" },
      h("div", { class: "note-title" }, o.now ? h("span", { class: "now-badge" }, "Teď") : null, h("p", { class: "note-text" }, t.text)));
    if (open) main.append(stepsPanel(t));

    const foot = h("div", { class: "note-foot" });
    if (!o.hideCat) foot.append(h("span", { class: "chip" }, c.name));
    if (t.routine_id) foot.append(h("span", { class: "chip chip-routine", title: "Úkol z rutiny" }, icon("repeat"), h("span", { class: "sr-only" }, "Z rutiny")));
    foot.append(h("span", { class: `eff eff-${t.effort}`, title: EFFORT_LABEL[t.effort] + " úkol" },
      h("i"), h("i"), h("i"), h("span", { class: "sr-only" }, EFFORT_LABEL[t.effort])));
    if (!done && (t.steps.length || !flag || open)) {
      foot.append(h("button", {
        type: "button", class: "pill pill-sm", "data-k": "tog:" + t.id, "aria-expanded": String(open),
        title: open ? "Sbalit kroky" : t.steps.length ? "Ukázat kroky" : "Rozepsat na kroky",
        on: { click: (e) => { e.stopPropagation(); if (open) { openNotes.set(t.id, false); render(); } else openSteps(t.id); } },
      }, t.steps.length ? `${stepsDone}/${t.steps.length} kroků` : "Rozepsat", icon("chevron")));
    } else if (done && t.steps.length) {
      foot.append(h("span", { class: "chip" }, `${stepsDone}/${t.steps.length} kroků`));
    }
    if (done && t.done_at) foot.append(h("span", { class: "time" }, isToday(t.done_at) ? fmtTime(t.done_at) : fmtDate(t.done_at)));
    if (fits) foot.append(h("span", { class: "chip chip-fit" }, "Sedí na dnes"));
    if (mode === "backlog" && o.lanePick) {
      const sel = h("select", {
        class: `lane-sel lane-${laneOf(t)}`, "aria-label": `Skupina lístku: ${t.text}`, title: "Hoří deadline, Priorita nebo Počká", "data-k": "lane:" + t.id,
        on: { click: (e) => e.stopPropagation(), change: (e) => { e.stopPropagation(); act.setLane(t.id, e.target.value); } },
      }, ...LANES.map((k) => h("option", { value: k }, LANE_LABEL[k])));
      sel.value = laneOf(t);
      foot.append(sel);
    }

    const tools = h("div", { class: "tools" });
    if (mode === "backlog") {
      tools.append(h("button", { class: "pill", type: "button", "data-k": "today:" + t.id, "aria-label": `Přesunout na dnes: ${t.text}`, on: { click: (e) => { e.stopPropagation(); act.toToday(t.id); } } }, "Na dnes", icon("arrow-right")));
    }
    if (mode === "today") {
      tools.append(iconBtn("play", "Soustředit se na tenhle úkol", () => openFocus(t.id), "focus:" + t.id));
      tools.append(iconBtn("undo", "Vrátit do zásobníku", () => act.toBacklog(t.id), "back:" + t.id));
    }
    if (!done) tools.append(iconBtn("edit", "Upravit", () => openEdit(t.id), "edit:" + t.id));
    tools.append(iconBtn("trash", "Smazat", () => act.remove(t.id), "del:" + t.id));
    foot.append(tools);
    main.append(foot);

    if (flag && !open) {
      main.append(h("button", { class: "flag", type: "button", "data-k": "flag:" + t.id, on: { click: (e) => { e.stopPropagation(); openSteps(t.id); } } },
        icon("sparkle"), h("span", null, "Náročný úkol: rozepiš ho na kroky")));
    }
    if (o.now && mode === "today") {
      main.append(h("button", { class: "btn-now", type: "button", "data-k": "start:" + t.id, on: { click: (e) => { e.stopPropagation(); openFocus(t.id); } } },
        icon("play"), "Začít soustředění"));
    }

    el.append(check, main);
    if (mode === "backlog") el.addEventListener("click", (e) => { if (!e.target.closest("button,input,select,form,a,.steps-panel")) act.toToday(t.id); });
    return el;
  }

  function fillList(box, tasks, mode, empty, o) {
    if (!tasks.length) { box.replaceChildren(empty); return; }
    box.replaceChildren(...tasks.map((t) => noteEl(t, mode, typeof o === "function" ? o(t) : o)));
  }

  const emptyEl = (title, text, extra) => h("div", { class: "empty" },
    h("strong", null, title), text ? h("p", null, text) : null, extra || null);

  const moreBtn = (key, shown, hidden, toggle) => h("button", { class: "more-btn", type: "button", "data-k": "more:" + key, "aria-expanded": String(shown), on: { click: toggle } },
    shown ? "Ukázat méně" : `Ukázat dalších ${hidden}`);

  /* ---------- Dnes ---------- */
  function renderTodayList(open) {
    const box = $("today-list");
    if (!open.length) {
      box.replaceChildren(emptyEl("Zatím nic na dnes", "Vyber úkol ze zásobníku, přidej nový, nebo ti pomůžu začít.",
        h("div", { class: "empty-actions" },
          h("button", { class: "btn btn-primary", type: "button", on: { click: pickForMe } }, icon("sparkle"), "Nevím, kde začít"),
          h("a", { class: "btn", href: "#/zasobnik" }, "Projít zásobník"))));
      return;
    }
    const shown = ui.allToday ? open : open.slice(0, TODAY_LIMIT);
    const els = shown.map((t, i) => noteEl(t, "today", { now: i === 0 }));
    if (open.length > TODAY_LIMIT) els.push(moreBtn("today", ui.allToday, open.length - TODAY_LIMIT, () => { ui.allToday = !ui.allToday; render(); }));
    box.replaceChildren(...els);
  }

  function renderToday() {
    const open = todayOpen(), done = doneToday();
    $("date").textContent = capitalize(new Date().toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" }));
    const total = open.length + done.length;
    const pct = total ? Math.round((done.length / total) * 100) : 0;
    $("ring-fg").style.strokeDashoffset = String(175.93 * (1 - pct / 100));
    $("ring-pct").textContent = total ? pct + " %" : "";
    $("progress-text").textContent = !total ? "Zatím nemáš nic naplánováno."
      : open.length === 0 ? "Všechno hotovo. Dobrá práce."
      : `Hotovo ${done.length} z ${total}.`;
    $("count-today").textContent = open.length;
    $("count-done").textContent = done.length;

    renderRoutineDue();
    renderTodayList(open);
    fillList($("done-list"), done, "done", emptyEl("Zatím nic hotového", "Co dokončíš, se objeví tady."), {});
    renderEnergy(open, done);
  }

  const liveDays = () => (state.days || []).filter((d) => !d.deleted);
  const dayRec = (date) => liveDays().find((d) => d.date === date) || null;
  const round5 = (v) => Math.round(v / 5) * 5;

  /** Statistika se počítá jen když se data změnila (cache podle počítadla změn). */
  let statsCache = { key: "", val: null };
  function stats() {
    const key = `${version}|${dayKey()}`;
    if (statsCache.key === key) return statsCache.val;
    const rows = liveDays().filter((d) => d.set).map((d) => ({ date: d.date, energy: d.energy, load: d.load }));
    const points = {}, tasks = {};
    for (const t of liveTasks()) {
      if (t.status !== "done" || !t.done_at) continue;
      const k = dayKey(new Date(t.done_at));
      points[k] = (points[k] || 0) + (Plan.CFG.cost[t.effort] || 2);
      tasks[k] = (tasks[k] || 0) + 1;
    }
    const anchors = liveDays().filter((d) => d.cycle_start).map((d) => d.date);
    const val = Stats.analyze(rows, { today: dayKey(), points, tasks, anchors });
    statsCache = { key, val };
    return val;
  }

  function dayValues() {
    const d = dayRec(dayKey());
    if (d && d.set) return { energy: d.energy, load: d.load, set: true };
    const st = stats();
    if (st.forecast.length) {                      // ještě nezadáno: předvyplním odhad podle dosavadních dní
      const f = st.forecast[0];
      return { energy: round5(f.energy.v), load: round5(f.load.v), set: false, predicted: true };
    }
    return { energy: 60, load: 40, set: false };
  }

  function computeEval() {
    const v = dayValues();
    const rec = Plan.recommend(v.energy, v.load);
    return { rec, ev: Plan.evaluate(rec, [...todayOpen(), ...doneToday()]) };
  }

  let energyOpen = null;           // null = výchozí: na mobilu sbaleno
  const energyIsOpen = () => (energyOpen === null ? false : energyOpen);

  const PRESETS = { energy: [[20, "Na dně"], [55, "Průměr"], [90, "Plná sil"]], load: [[15, "Volno"], [50, "Středně"], [85, "Nabitý den"]] };
  function setSlider(id, v) {
    const e = $(id);
    e.value = v;
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function buildPresets() {
    for (const [kind, id] of [["energy", "energy-range"], ["load", "load-range"]]) {
      $(kind + "-presets").replaceChildren(...PRESETS[kind].map(([v, label]) => h("button", {
        type: "button", class: "preset", "data-v": v, on: { click: () => setSlider(id, v) },
      }, label)));
    }
  }
  function markPresets(energy, load) {
    for (const [kind, val] of [["energy", energy], ["load", load]]) {
      qa(".preset", $(kind + "-presets")).forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.v === val)));
    }
  }

  function renderEnergy(open, done) {
    const v = dayValues();
    const er = $("energy-range"), lr = $("load-range");
    if (document.activeElement !== er) er.value = v.energy;
    if (document.activeElement !== lr) lr.value = v.load;
    $("energy-unset").textContent = v.set ? "uloženo do přehledu" : v.predicted ? "odhad podle tvých dat" : "výchozí odhad";
    paintEnergy(+er.value, +lr.value, open, done);
  }

  function paintEnergy(energy, load, open = todayOpen(), done = doneToday()) {
    const rec = Plan.recommend(energy, load);
    const ev = Plan.evaluate(rec, [...open, ...done]);

    $("energy-val").textContent = rec.energy + " %";
    $("load-val").textContent = rec.load + " %";
    er_style($("energy-range"), rec.energy); er_style($("load-range"), rec.load);
    markPresets(rec.energy, rec.load);
    const z = $("energy-zone");
    z.textContent = rec.zone.label;
    z.className = "zone zone-" + rec.zone.id;
    $("energy-zone-desc").textContent = rec.zone.desc;

    const out = $("energy-out");
    const chips = [];
    if (rec.hard) chips.push(["hard", `${rec.hard} ${plural(rec.hard, "náročný", "náročné", "náročných")}`]);
    if (rec.medium) chips.push(["medium", `${rec.medium} ${plural(rec.medium, "střední", "střední", "středních")}`]);
    if (rec.light) chips.push(["light", `${rec.light} ${plural(rec.light, "lehký", "lehké", "lehkých")}`]);

    const head = h("div", { class: "rec-head" },
      h("span", { class: "rec-label" }, "Doporučení na dnes"),
      rec.total
        ? h("div", { class: "rec-chips" }, chips.map(([k, t]) => h("span", { class: `rec-chip eff-${k}` },
            h("span", { class: `eff eff-${k}`, "aria-hidden": "true" }, h("i"), h("i"), h("i")), t)))
        : h("strong", { class: "rec-rest" }, "Dnes bez úkolů. Odpočinek se počítá."));

    const pct = rec.points ? Math.min(100, Math.round((ev.used / rec.points) * 100)) : (ev.used ? 100 : 0);
    const meter = h("div", { class: "meter" + (ev.over ? " is-over" : "") },
      h("div", { class: "meter-bar", role: "img", "aria-label": `Využito ${ev.used} z ${rec.points} bodů` }, h("span", { style: `width:${pct}%` })),
      h("span", { class: "meter-txt" }, `${ev.used} z ${rec.points} b`));

    const lines = [];
    const hardOver = ev.have.hard > rec.hardMax;
    if (ev.over > 0 || hardOver) {
      let t = ev.over > 0 ? `Máš naplánováno o ${ev.over} b víc, než dnes doporučuji.` : "";
      if (hardOver) t += (t ? " " : "") + (rec.hardMax ? `Náročných úkolů dnes ${rec.hardMax === 1 ? "stačí jeden" : "stačí dva"}.` : "Při téhle energii nechej náročné úkoly na jindy, nebo dělej jen jejich první krok.");
      lines.push(h("p", { class: "rec-status is-warn" }, icon("alert"), h("span", null, t + " Odlož, co není nutné.")));
    } else if (ev.need.length) {
      const cnt = {};
      ev.need.forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; });
      const words = ["hard", "medium", "light"].filter((k) => cnt[k]).map((k) =>
        `${cnt[k]} ${k === "hard" ? plural(cnt[k], "náročný", "náročné", "náročných") : k === "medium" ? plural(cnt[k], "střední", "střední", "středních") : plural(cnt[k], "lehký", "lehké", "lehkých")}`);
      lines.push(h("div", { class: "rec-status" }, icon("sparkle"), h("div", { class: "rec-fit" },
        h("span", null, `Ještě se vejde: ${words.join(", ")}.`),
        h("div", { class: "rec-fit-actions" },
          h("button", { type: "button", class: "btn btn-sm", on: { click: pickForMe } }, icon("sparkle"), "Nevím, kde začít"),
          h("a", { href: "#/zasobnik", class: "inline-link" }, "Projít zásobník")))));
    } else if (rec.total) {
      lines.push(h("p", { class: "rec-status is-ok" }, icon("tick"), h("span", null, "Plán na dnes sedí.")));
    }
    const hardNoSteps = open.filter((t) => t.effort === "hard" && !t.steps.length);
    if (hardNoSteps.length) {
      lines.push(h("p", { class: "rec-status" }, icon("sparkle"),
        h("span", null, `${hardNoSteps.length} ${plural(hardNoSteps.length, "náročný úkol nemá", "náročné úkoly nemají", "náročných úkolů nemá")} kroky. Rozepsaný úkol se začíná mnohem snáz.`)));
    }

    const tips = h("ul", { class: "tips" }, rec.tips.map((t) => h("li", null, t)));
    const how = h("details", { class: "how" },
      h("summary", null, "Jak to počítám"),
      h("p", null, `Lehký úkol má váhu ${Plan.CFG.cost.light} b, střední ${Plan.CFG.cost.medium} b, náročný ${Plan.CFG.cost.hard} b. Kapacita dne roste s energií a klesá s vytížením. Při nízké energii klesá rychleji než lineárně.`),
      h("p", null, "Je to rozumná pomůcka, ne měření. Opírá se o tři zásady: náročná práce patří na chvíle s nejvyšší energií, rozpracovaných priorit má být málo a plánuje se na zhruba 70 % možností. Pokud ti čísla nesedí, dají se doladit v souboru plan.js."));
    out.replaceChildren(head, meter, ...lines, tips, how);

    const brief = $("energy-brief");
    const isSet = dayValues().set;
    brief.replaceChildren(!isSet ? (dayValues().predicted ? `Podle tvých záznamů odhaduji energii kolem ${rec.energy} % a vytížení ${rec.load} %. Potvrď to nebo uprav.` : "Zadej energii a vytížení a dostaneš doporučení na dnešek.") : rec.total
      ? `Energie ${rec.energy} %, vytížení ${rec.load} %. Doporučuji: ${chips.map(([, t]) => t).join(", ")}.`
      : `Energie ${rec.energy} %, vytížení ${rec.load} %. Dnes bez úkolů, odpočívej.`);
    const isOpen = energyIsOpen();
    $("energy-panel").classList.toggle("is-collapsed", !isOpen);
    $("energy-body").hidden = !isOpen && isMobile();
    brief.hidden = isOpen || !isMobile();
    $("energy-toggle").setAttribute("aria-expanded", String(isOpen));
    $("energy-toggle").firstChild.textContent = isOpen ? "Skrýt" : isSet ? "Upravit" : "Zadat";
  }

  $("energy-toggle").addEventListener("click", () => { energyOpen = !energyIsOpen(); render(); });
  window.matchMedia("(max-width: 860px)").addEventListener("change", () => render());

  function er_style(range, v) { range.style.setProperty("--p", v + "%"); }

  /* ---------- Zásobník ---------- */
  function fitSet() {
    const { ev } = computeEval();
    return new Set(ev.over === 0 ? ev.need : []);
  }

  /* ---------- Nevím, kde začít (úkolová paralýza) ---------- */
  const help = { skip: new Set(), id: null };

  /** Pořadí návrhů: co už je na dnes, pak Hoří, Priorita, Počká; uvnitř od nejlehčího. */
  function starterQueue() {
    const effortRank = { light: 0, medium: 1, hard: 2 };
    const laneRank = { fire: 0, prio: 1, wait: 2 };
    return liveTasks().filter((t) => t.status !== "done")
      .sort((x, y) => (x.status === "today" ? 0 : 1) - (y.status === "today" ? 0 : 1)
        || laneRank[laneOf(x)] - laneRank[laneOf(y)]
        || effortRank[x.effort] - effortRank[y.effort]
        || (x.pos || 0) - (y.pos || 0));
  }

  function starterReason(t) {
    const parts = [];
    if (t.status === "today") parts.push("už máš na dnes");
    if (laneOf(t) === "fire") parts.push("hoří");
    else if (laneOf(t) === "prio") parts.push("je to priorita");
    parts.push(t.effort === "light" ? "je lehký" : t.effort === "medium" ? "zvládneš ho v jednom bloku" : "půjde po malých krocích");
    const txt = parts.join(", ");
    return txt.charAt(0).toUpperCase() + txt.slice(1) + ".";
  }

  function renderStarter() {
    const box = $("start-body");
    const queue = starterQueue();
    let t = queue.find((x) => !help.skip.has(x.id));
    if (!t && queue.length) { help.skip.clear(); t = queue[0]; }
    if (!t) { box.replaceChildren(h("p", { class: "muted" }, "Zásobník je prázdný. Přidej úkol a pak ti pomůžu začít.")); help.id = null; return; }
    help.id = t.id;
    const c = catById(t.category_id);
    const step = t.steps.find((x) => !x.done);
    box.replaceChildren(
      h("p", { class: "start-reason" }, starterReason(t)),
      h("h3", { class: "start-task" }, t.text),
      c ? h("p", { class: "muted start-cat" }, c.name) : null,
      h("div", { class: "start-first" },
        h("strong", null, "První malý krok"),
        h("p", null, step ? step.text : "Otevři to a udělej první malou věc. Stačí 5 minut, pak můžeš skončit.")));
  }

  function openStarter() {
    help.skip.clear();
    if (!starterQueue().length) { toast("Zásobník je prázdný. Přidej úkol a pak ti pomůžu začít."); return; }
    renderStarter();
    const d = $("start-dialog");
    if (!d.open) d.showModal();
    $("start-go").focus();
  }

  function startStarter() {
    const t = taskById(help.id);
    if (!t) return;
    if (t.status === "backlog") commit((s) => { const x = s.tasks.find((y) => y.id === t.id); x.status = "today"; x.pos = Date.now(); }, `Na dnes: ${t.text}`);
    $("start-dialog").close();
    openFocus(t.id);
    setFocusDur(5);
    startTimer();
  }

  $("start-go").addEventListener("click", startStarter);
  $("start-next").addEventListener("click", () => { if (help.id) help.skip.add(help.id); renderStarter(); });
  const pickForMe = openStarter;
  $("pick-me").addEventListener("click", openStarter);
  $("start-me").addEventListener("click", openStarter);

  function renderBackView() {
    const box = $("back-view");
    box.replaceChildren(...[["lanes", "Podle skupin"], ["cats", "Podle kategorií"]].map(([v, l]) => h("button", {
      type: "button", class: "seg-btn", "aria-pressed": String(ui.backView === v), "data-k": "bview:" + v,
      on: { click: () => { ui.backView = v; store.set("stickies:backview", v); render(); } },
    }, l)));
  }

  function renderBacklog() {
    const cats = liveCats();
    const total = liveTasks().filter((t) => t.status === "backlog").length;
    $("count-backlog").textContent = total;
    renderBackView();
    const grid = $("backlog-grid");
    if (!cats.length) {
      grid.replaceChildren(emptyEl("Zatím tu není žádná kategorie", "Kategorie jsou tvoje stránky v boční liště, třeba Práce, Studium nebo Domácnost.",
        h("button", { class: "btn btn-primary", type: "button", on: { click: () => openCatDialog() } }, "Vytvořit kategorii")));
      return;
    }
    const fit = fitSet();
    if (ui.backView === "cats") {
      grid.replaceChildren(...cats.map((c) => {
        const list = backlogOf(c.id);
        const all = Boolean(ui.allBack[c.id]);
        const shown = all ? list : list.slice(0, COL_LIMIT);
        const col = h("section", { class: `cat-col c-${c.color}` });
        col.append(h("div", { class: "cat-head" },
          h("span", { class: "dot" }),
          h("h3", null, h("a", { href: "#/kat/" + c.id }, c.name)),
          h("span", { class: "count" }, String(list.length)),
          iconBtn("plus", `Přidat úkol do kategorie ${c.name}`, () => openComposer(c.id), "addto:" + c.id)));
        const notes = h("div", { class: "notes" });
        fillList(notes, shown, "backlog", h("button", { class: "empty", type: "button", on: { click: () => openComposer(c.id) } },
          h("strong", null, "Prázdno"), h("p", null, "Přidej první úkol")), (t) => ({ hideCat: true, fits: fit.has(t.effort), lanePick: true }));
        if (list.length > COL_LIMIT) notes.append(moreBtn("b" + c.id, all, list.length - COL_LIMIT, () => { ui.allBack[c.id] = !all; render(); }));
        col.append(notes);
        return col;
      }));
      return;
    }
    const order = new Map(cats.map((c, i) => [c.id, i]));
    const back = liveTasks().filter((t) => t.status === "backlog" && order.has(t.category_id));
    grid.replaceChildren(...LANES.map((ln) => {
      const list = back.filter((t) => laneOf(t) === ln).sort((x, y) => {
        const dx = dueOf(x), dy = dueOf(y);
        if (dx !== dy) return !dx ? 1 : !dy ? -1 : dx < dy ? -1 : 1;      // nejdřív nejbližší termín, bez termínu až potom
        return order.get(x.category_id) - order.get(y.category_id) || byPos(x, y);
      });
      const all = Boolean(ui.allLane[ln]);
      const shown = all ? list : list.slice(0, LANE_LIMIT);
      const col = h("section", { class: `cat-col lane lane-${ln}` });
      col.append(
        h("div", { class: "cat-head" }, h("span", { class: "lane-dot" }), h("h3", null, LANE_LABEL[ln]), h("span", { class: "count" }, String(list.length))),
        h("p", { class: "lane-hint" }, LANE_HINT[ln]));
      const notes = h("div", { class: "notes" });
      fillList(notes, shown, "backlog", h("p", { class: "muted pad" }, "Tady zatím nic není."), (t) => ({ fits: fit.has(t.effort), lanePick: true }));
      if (list.length > LANE_LIMIT) notes.append(moreBtn("l" + ln, all, list.length - LANE_LIMIT, () => { ui.allLane[ln] = !all; render(); }));
      col.append(notes);
      return col;
    }));
  }

  /* ---------- Kategorie ---------- */
  function renderCat() {
    const c = catById(ROUTE.id);
    $("h-cat").textContent = c.name;
    $("cat-dot").className = `dot dot-lg c-${c.color}`;
    const today = todayOpen().filter((t) => t.category_id === c.id);
    const back = backlogOf(c.id);
    const arch = liveTasks().filter((t) => t.category_id === c.id && t.status === "done")
      .sort((a, b) => new Date(b.done_at) - new Date(a.done_at)).slice(0, 40);
    $("cat-today-n").textContent = today.length;
    $("cat-backlog-n").textContent = back.length;
    $("cat-archive-n").textContent = arch.length;
    fillList($("cat-today-list"), today, "today", emptyEl("Z téhle kategorie dnes nic", "Klepni na lístek v zásobníku a přesune se na dnes."), { hideCat: true });
    fillList($("cat-backlog-list"), back, "backlog",
      h("button", { class: "empty", type: "button", on: { click: () => openComposer(c.id) } },
        h("strong", null, "Zásobník je prázdný"), h("p", null, "Přidej první úkol do této kategorie")), { hideCat: true, lanePick: true });
    fillList($("cat-archive-list"), arch, "done", h("p", { class: "muted pad" }, "Zatím nic."), { hideCat: true });
    $("cat-archive").hidden = !arch.length;
  }

  /* ---------- Přidání úkolu ---------- */
  function buildSeg(box, name, value) {
    box.replaceChildren(...EFFORTS.map((k) => h("label", { class: `seg eff-${k}` },
      h("input", Object.assign({ type: "radio", name, value: k }, k === value ? { checked: true } : {})),
      h("span", null, h("span", { class: "eff", "aria-hidden": "true" }, h("i"), h("i"), h("i")), EFFORT_LABEL[k]))));
  }
  const segValue = (box) => { const r = box.querySelector("input:checked"); return r ? r.value : "medium"; };

  let compSig = "";
  function renderComposerOptions() {
    const cats = liveCats();
    const sig = cats.map((c) => c.id + c.name).join("|");
    if (sig === compSig) return;
    compSig = sig;
    const sel = $("add-cat"), cur = sel.value;
    sel.replaceChildren(...cats.map((c) => h("option", { value: c.id }, c.name)));
    if (cats.some((c) => c.id === cur)) sel.value = cur; else setComposerDefaults();
  }

  function setComposerDefaults() {
    const cats = liveCats();
    const sel = $("add-cat");
    let id = ROUTE.name === "kat" ? ROUTE.id : store.get(K.lastcat, "");
    if (!cats.some((c) => c.id === id)) id = cats[0] ? cats[0].id : "";
    sel.value = id;
    $("add-today").checked = ROUTE.name === "dnes";
  }

  function openComposer(catId) {
    if (catId) $("add-cat").value = catId;
    if (isMobile()) {
      document.body.classList.add("add-open");
      $("composer").removeAttribute("aria-hidden");
      setTimeout(() => $("add-text").focus(), 30);
    } else {
      $("composer").scrollIntoView({ block: "nearest" });
    }
    $("add-text").focus();
    setTimeout(() => { if (document.activeElement !== $("add-text")) $("add-text").focus(); }, 60);
  }
  function closeComposer() { document.body.classList.remove("add-open"); }

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("add-text").value.trim();
    if (!text) { $("add-text").focus(); return; }
    const cid = $("add-cat").value;
    if (!cid) { toast("Nejdřív vytvoř kategorii."); openCatDialog(); return; }
    const effort = segValue($("add-effort"));
    const today = $("add-today").checked;
    const id = uuid();
    store.set(K.lastcat, cid);
    commit((s) => {
      s.tasks.push({ id, category_id: cid, text, status: today ? "today" : "backlog", done_at: null, pos: Date.now(), effort, steps: [], updated_at: nowIso() });
    }, today ? "Přidáno na dnes." : "Přidáno do zásobníku.", effort === "hard"
      ? { action: { label: "Rozepsat", fn: () => openEdit(id, { steps: true }) }, ms: 8000 } : {});
    $("add-text").value = "";
    buildSeg($("add-effort"), "add-effort", "medium");
    $("add-text").focus();
  });

  $("fab").addEventListener("click", () => openComposer());
  $("scrim").addEventListener("click", closeComposer);
  $("composer-close").addEventListener("click", closeComposer);

  /* =====================================================================
     Boční lišta (na mobilu šuplík)
     ===================================================================== */
  function openSide() {
    document.body.classList.add("side-open");
    $("drawer-open").setAttribute("aria-expanded", "true");
    setTimeout(() => { const f = $("sidebar").querySelector("[aria-current], .nav-item"); if (f) f.focus(); }, 60);
  }
  function closeSide() {
    if (!document.body.classList.contains("side-open")) return;
    document.body.classList.remove("side-open");
    $("drawer-open").setAttribute("aria-expanded", "false");
  }
  $("drawer-open").addEventListener("click", openSide);
  $("side-close").addEventListener("click", () => { closeSide(); $("drawer-open").focus(); });
  $("scrim-side").addEventListener("click", closeSide);
  $("side-add-cat").addEventListener("click", () => openCatDialog());
  $("sidebar").addEventListener("click", (e) => { if (e.target.closest("a")) closeSide(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeComposer(); closeSide(); return; }
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "n" || e.key === "N") && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      openComposer();
    }
  });

  /* =====================================================================
     Dialogy
     ===================================================================== */
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { const d = e.target.closest("dialog"); if (d) d.close(); return; }
    if (e.target.tagName === "DIALOG") {                // klepnutí mimo okno
      const r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }
  });

  /* ---------- Úprava úkolu ---------- */
  let editId = null;

  function stepRow(step) {
    const row = h("li", { class: "step-row", "data-id": step.id, "data-done": step.done ? "1" : "0" },
      h("input", { type: "text", maxlength: "200", value: step.text, "aria-label": "Text kroku", placeholder: "Co konkrétně udělat?", enterkeyhint: "next" }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Odebrat krok", title: "Odebrat krok", on: { click: () => row.remove() } }, icon("x")));
    row.querySelector("input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addStep(row); }
    });
    return row;
  }
  function addStep(after, text = "") {
    const row = stepRow({ id: uuid(), text, done: false });
    if (after) after.after(row); else $("steps-list").append(row);
    row.querySelector("input").focus();
    return row;
  }
  function stepsHint(effort) {
    $("steps-hint").textContent = effort === "hard"
      ? "Náročné úkoly se dělají líp po krocích. První krok by měl zabrat do 25 minut."
      : "Kroky jsou volitelné. Hodí se, když si nejsi jistý/á, čím začít.";
    $("steps-hint").classList.toggle("is-hard", effort === "hard");
  }

  function openEdit(id, opts = {}) {
    const t = taskById(id);
    if (!t) return;
    editId = id;
    $("edit-text").value = t.text;
    $("edit-cat").replaceChildren(...liveCats().map((c) => h("option", { value: c.id }, c.name)));
    $("edit-cat").value = t.category_id;
    buildSeg($("edit-effort"), "edit-effort", t.effort);
    $("edit-lane").replaceChildren(...LANES.map((k) => h("option", { value: k }, LANE_LABEL[k])));
    $("edit-lane").value = laneOf(t);
    const lr = findStudyReq(t);
    $("edit-due-field").hidden = !lr;
    $("edit-due").required = Boolean(lr) && lr.st.taskMode !== "all";
    $("edit-due").value = lr ? lr.r.due || "" : "";
    $("edit-due-hint").textContent = !lr ? "" : lr.st.taskMode === "all"
      ? "Změna se propíše i do předmětu ve Studiu."
      : "Změna se propíše i do předmětu ve Studiu. Termín tu nejde smazat, lístky vznikají jen z podmínek s termínem. Smazat ho můžeš ve Studiu.";
    $("steps-list").replaceChildren(...t.steps.map(stepRow));
    stepsHint(t.effort);
    const dlg = $("edit-dialog");
    if (!dlg.open) dlg.showModal();
    if (opts.steps) {
      if (!t.steps.length) addStep(null); else $("steps-list").querySelector("input").focus();
    } else $("edit-text").focus();
  }

  $("edit-effort").addEventListener("change", () => stepsHint(segValue($("edit-effort"))));
  $("step-add").addEventListener("click", () => addStep(null));
  $("step-template").addEventListener("click", () => {
    qa(".step-row", $("steps-list")).forEach((r) => { if (!r.querySelector("input").value.trim()) r.remove(); });
    const have = qa("input", $("steps-list")).map((i) => i.value.trim());
    const rows = STEP_TEMPLATE.filter((s) => !have.includes(s)).map((s) => stepRow({ id: uuid(), text: s, done: false }));
    $("steps-list").append(...rows);
    if (rows[0]) rows[0].querySelector("input").focus();
  });

  $("edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("edit-text").value.trim();
    if (!text) { $("edit-text").focus(); return; }
    const steps = qa(".step-row", $("steps-list"))
      .map((r) => ({ id: r.dataset.id, text: r.querySelector("input").value.trim(), done: r.dataset.done === "1" }))
      .filter((s) => s.text);
    const cat = $("edit-cat").value, effort = segValue($("edit-effort")), lane = $("edit-lane").value;
    const dueField = !$("edit-due-field").hidden, due = $("edit-due").value;
    let dueChanged = false;
    commit((s) => {
      const t = s.tasks.find((x) => x.id === editId);
      if (!t) return;
      t.text = text; t.category_id = cat; t.effort = effort; t.steps = steps;
      if (LANES.includes(lane)) t.lane = lane;
      const lr = dueField ? findStudyReq(t, s) : null;
      if (lr && (lr.r.due || "") !== due) { lr.r.due = due; dueChanged = true; }
    }, null);
    if (dueChanged) toast("Termín je změněný i v předmětu.");
    $("edit-dialog").close();
  });
  $("edit-dialog").addEventListener("close", () => { editId = null; });

  /* ---------- Kategorie ---------- */
  let catEditId = null;

  function openCatDialog(id) {
    catEditId = id || null;
    const c = id ? catById(id) : null;
    $("cat-dlg-title").textContent = c ? "Upravit kategorii" : "Nová kategorie";
    $("cat-name").value = c ? c.name : "";
    $("cat-error").textContent = "";
    $("cat-delete").hidden = !c;
    const used = new Set(liveCats().map((x) => x.color));
    const pick = c ? c.color : COLORS.find((k) => !used.has(k)) || COLORS[liveCats().length % COLORS.length];
    $("swatches").replaceChildren(...COLORS.map((k) => h("label", { class: `swatch c-${k}`, title: COLOR_NAMES[k] },
      h("input", Object.assign({ type: "radio", name: "cat-color", value: k, "aria-label": COLOR_NAMES[k] }, k === pick ? { checked: true } : {})),
      h("span"))));
    closeSide();
    $("cat-dialog").showModal();
    $("cat-name").focus();
  }
  $("cat-edit").addEventListener("click", () => openCatDialog(ROUTE.id));

  $("cat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("cat-name").value.trim();
    if (!name) { $("cat-error").textContent = "Napiš název kategorie."; return; }
    if (liveCats().some((c) => c.id !== catEditId && c.name.toLowerCase() === name.toLowerCase())) {
      $("cat-error").textContent = "Kategorie s tímto názvem už existuje."; return;
    }
    const color = ($("swatches").querySelector("input:checked") || {}).value || "violet";
    let goto = null;
    commit((s) => {
      if (catEditId) {
        const c = s.categories.find((x) => x.id === catEditId);
        c.name = name; c.color = color;
      } else {
        const id = uuid();
        s.categories.push({ id, name, color, pos: Date.now(), updated_at: nowIso() });
        goto = id;
      }
    });
    $("cat-dialog").close();
    if (goto) location.hash = "#/kat/" + goto;
  });

  $("cat-delete").addEventListener("click", () => {
    const id = catEditId;
    const c = catById(id);
    if (!c) return;
    const n = liveTasks().filter((t) => t.category_id === id).length;
    commit((s) => {
      s.categories.find((x) => x.id === id).deleted = true;
      s.tasks.forEach((t) => { if (t.category_id === id && !t.deleted) t.deleted = true; });
      s.routines.forEach((r) => { if (r.category_id === id && !r.deleted) r.deleted = true; });
    }, n ? `Kategorie „${c.name}“ smazána i s ${n} ${plural(n, "úkolem", "úkoly", "úkoly")}.` : `Kategorie „${c.name}“ smazána.`);
    $("cat-dialog").close();
    if (ROUTE.name === "kat" && ROUTE.id === id) location.hash = "#/dnes";
  });

  /* ---------- Rutiny ---------- */
  const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayKey(d); };
  const daysBetween = (from, to) => Math.round((parseDay(to) - parseDay(from)) / 864e5);
  const liveRoutines = () => state.routines.filter((r) => !r.deleted && catById(r.category_id)).sort(byPos);
  const EVERY = [[0, "Ručně, když budu chtít"], [1, "Každý den"], [7, "Každý týden"], [14, "Každé 2 týdny"], [30, "Každý měsíc"], [90, "Každé 3 měsíce"]];
  const everyLabel = (n) => (EVERY.find((e) => e[0] === n) || [0, `Každých ${n} ${plural(n, "den", "dny", "dní")}`])[1];

  function nextDue(r) {
    if (!r.every_days || !r.items.length) return null;
    return r.last_added ? addDays(r.last_added, r.every_days) : dayKey();
  }
  function isDue(r) {
    const n = nextDue(r);
    return Boolean(n) && n <= dayKey() && !(r.snooze && r.snooze > dayKey());
  }
  const dueRoutines = () => liveRoutines().filter(isDue);

  function routineStatus(r) {
    if (!r.items.length) return "Zatím bez úkolů";
    if (isDue(r)) return r.last_added ? `Je na řadě (naposledy ${fmtDate(parseDay(r.last_added))})` : "Je na řadě, ještě nebyla přidána";
    const n = nextDue(r);
    if (n) {
      const d = daysBetween(dayKey(), n);
      if (d <= 0) return "Odloženo, připomenu to zítra";
      return `Příště za ${d} ${plural(d, "den", "dny", "dní")}`;
    }
    return r.last_added ? `Naposledy přidáno ${fmtDate(parseDay(r.last_added))}` : "Ještě nepřidáno";
  }

  /** Přidá do kategorie lístky z rutiny. Co už je v úkolech nesplněné, nepřidá podruhé. */
  function addRoutine(id) {
    const r = state.routines.find((x) => x.id === id && !x.deleted);
    if (!r) return;
    const cat = catById(r.category_id);
    if (!cat) { toast("Kategorie téhle rutiny už neexistuje."); return; }
    const have = new Set(liveTasks().filter((t) => t.routine_id === id && t.status !== "done").map((t) => t.routine_item));
    const todo = r.items.filter((i) => !have.has(i.id));
    const skipped = r.items.length - todo.length;
    const msg = todo.length
      ? `Rutina „${r.name}“: přidáno ${todo.length} ${plural(todo.length, "úkol", "úkoly", "úkolů")} do kategorie ${cat.name}.${skipped ? ` ${skipped} už v úkolech máš.` : ""}`
      : `Všechno z rutiny „${r.name}“ už v úkolech máš.`;
    commit((s) => {
      const t0 = Date.now();
      todo.forEach((i, k) => s.tasks.push({
        id: uuid(), category_id: r.category_id, text: i.text, status: "backlog", done_at: null, pos: t0 + k,
        effort: r.effort, steps: [], routine_id: id, routine_item: i.id, updated_at: nowIso(),
      }));
      const rr = s.routines.find((x) => x.id === id);
      rr.last_added = dayKey(); rr.snooze = null;
    }, msg, { action: { label: "Zobrazit", fn: () => { location.hash = "#/kat/" + r.category_id; } }, ms: 9000 });
  }

  function snoozeRoutine(id) {
    commit((s) => { s.routines.find((x) => x.id === id).snooze = addDays(dayKey(), 1); }, "Připomenu to zítra.");
  }

  function renderRoutineDue() {
    const box = $("routine-due");
    const due = dueRoutines();
    box.hidden = !due.length;
    if (!due.length) { box.replaceChildren(); return; }
    const rows = due.slice(0, 2).map((r) => {
      const c = catById(r.category_id);
      return h("div", { class: `due-row c-${c.color}` },
        h("span", { class: "due-ic", "aria-hidden": "true" }, icon("repeat")),
        h("div", { class: "due-txt" },
          h("b", null, `Rutina „${r.name}“ je na řadě`),
          h("span", null, `${r.items.length} ${plural(r.items.length, "úkol", "úkoly", "úkolů")} do kategorie ${c.name}`)),
        h("button", { type: "button", class: "btn btn-sm due-add", on: { click: () => addRoutine(r.id) } }, "Přidat do zásobníku"),
        h("button", { type: "button", class: "btn btn-sm btn-ghost due-later", on: { click: () => snoozeRoutine(r.id) } }, "Zítra"));
    });
    if (due.length > 2) rows.push(h("a", { class: "due-more", href: "#/rutiny" }, `Další rutiny na řadě: ${due.length - 2}`));
    box.replaceChildren(...rows);
  }

  const STARTER = {
    name: "Úklid bytu", every: 7, effort: "medium", cat: "Domácnost",
    items: ["Vysát podlahy", "Vytřít podlahy", "Utřít prach", "Vyčistit koupelnu a WC", "Vynést odpadky", "Vyměnit ložní prádlo", "Vyprat a pověsit prádlo"],
  };

  function routineCard(r) {
    const c = catById(r.category_id);
    const due = isDue(r);
    const shown = r.items.slice(0, 4);
    return h("article", { class: `routine c-${c.color}${due ? " is-due" : ""}`, "data-k": "routine:" + r.id },
      h("header", { class: "routine-head" },
        h("div", null,
          h("h3", null, r.name),
          h("p", { class: "routine-meta" }, `${c.name} · ${everyLabel(r.every_days)}`)),
        iconBtn("edit", "Upravit rutinu", () => openRoutineDialog(r.id), "routine-edit:" + r.id)),
      h("p", { class: "routine-status" }, due ? h("span", { class: "due-pill" }, "Na řadě") : null, routineStatus(r)),
      r.items.length
        ? h("ul", { class: "routine-items" }, ...shown.map((i) => h("li", null, i.text)),
            r.items.length > shown.length ? h("li", { class: "more" }, `a dalších ${r.items.length - shown.length}`) : null)
        : h("p", { class: "routine-empty" }, "Přidej do rutiny úkoly tlačítkem Upravit."),
      h("button", { type: "button", class: "btn routine-add", disabled: !r.items.length, on: { click: () => addRoutine(r.id) } },
        icon("plus"), "Přidat do úkolů"));
  }

  function renderRoutines() {
    const list = liveRoutines();
    $("routine-count").textContent = list.length;
    const box = $("routine-list");
    if (!list.length) {
      box.replaceChildren(h("div", { class: "empty routine-welcome" },
        h("strong", null, "Zatím tu nemáš žádnou rutinu"),
        h("p", null, "Rutina je seznam úkolů, které se ti opakují, třeba úklid bytu nebo měsíční administrativa. Jedním klepnutím je všechny přidáš do zvolené kategorie."),
        h("button", { type: "button", class: "btn btn-primary", on: { click: () => openRoutineDialog(null, STARTER) } }, "Vyzkoušet na úklidu bytu"),
        h("button", { type: "button", class: "btn", on: { click: () => openRoutineDialog() } }, "Vytvořit vlastní")));
      return;
    }
    box.replaceChildren(...list.map(routineCard));
  }

  let routineEditId = null;

  function openRoutineDialog(id, preset) {
    routineEditId = id || null;
    const r = id ? state.routines.find((x) => x.id === id && !x.deleted) : null;
    if (!liveCats().length) { toast("Nejdřív vytvoř kategorii."); openCatDialog(); return; }
    const p = r || preset || {};
    $("rt-title").textContent = r ? "Upravit rutinu" : "Nová rutina";
    $("rt-name").value = r ? r.name : p.name || "";
    const cats = liveCats();
    const preCat = r ? r.category_id : (cats.find((c) => c.name === p.cat) || cats.find((c) => c.id === store.get(K.lastcat, "")) || cats[0]).id;
    $("rt-cat").replaceChildren(...cats.map((c) => h("option", Object.assign({ value: c.id }, c.id === preCat ? { selected: true } : {}), c.name)));
    const every = r ? r.every_days : p.every != null ? p.every : 0;
    const opts = EVERY.some((e) => e[0] === every) ? EVERY : [...EVERY, [every, everyLabel(every)]];
    $("rt-every").replaceChildren(...opts.map(([v, l]) => h("option", Object.assign({ value: v }, v === every ? { selected: true } : {}), l)));
    buildSeg($("rt-effort"), "rt-effort", r ? r.effort : p.effort || "medium");
    $("rt-items").value = r ? r.items.map((i) => i.text).join("\n") : (p.items || []).join("\n");
    $("rt-error").textContent = "";
    $("rt-delete").hidden = !r;
    $("rt-addnow-wrap").hidden = Boolean(r);
    $("rt-addnow").checked = !r;
    closeSide();
    $("routine-dialog").showModal();
    (r ? $("rt-items") : $("rt-name")).focus();
  }

  $("routine-new").addEventListener("click", () => openRoutineDialog());

  $("routine-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("rt-name").value.trim();
    const lines = $("rt-items").value.split("\n").map((l) => l.trim().replace(/^([-•*]|\[ ?\])\s*/, "").trim()).filter(Boolean).slice(0, 40);
    if (!name) { $("rt-error").textContent = "Napiš název rutiny."; $("rt-name").focus(); return; }
    if (!lines.length) { $("rt-error").textContent = "Napiš aspoň jeden úkol, každý na nový řádek."; $("rt-items").focus(); return; }
    const category_id = $("rt-cat").value, every_days = Number($("rt-every").value) || 0, effort = segValue($("rt-effort"));
    const addNow = !routineEditId && $("rt-addnow").checked;
    const id = routineEditId || uuid();
    commit((s) => {
      const old = routineEditId ? s.routines.find((x) => x.id === routineEditId) : null;
      const pool = old ? [...old.items] : [];
      const items = lines.map((text) => {
        const k = pool.findIndex((i) => i.text === text);
        return k >= 0 ? pool.splice(k, 1)[0] : { id: uuid(), text: text.slice(0, 200) };
      });
      if (old) Object.assign(old, { name, category_id, every_days, effort, items });
      else s.routines.push({ id, name, category_id, every_days, effort, items, last_added: null, snooze: null, pos: Date.now(), updated_at: nowIso() });
    });
    $("routine-dialog").close();
    if (addNow) addRoutine(id);
    else toast(`Rutina „${name}“ uložena.`);
  });

  $("rt-delete").addEventListener("click", () => {
    const id = routineEditId, r = state.routines.find((x) => x.id === id);
    if (!r) return;
    commit((s) => { s.routines.find((x) => x.id === id).deleted = true; }, `Rutina „${r.name}“ smazána. Úkoly, které už z ní vznikly, zůstaly.`);
    $("routine-dialog").close();
  });

  /* ---------- Přehled: historie, statistiky, odhad ---------- */
  const svgEl = (tag, attrs, ...kids) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) e.setAttribute(k, v);
    e.append(...kids.flat().filter((x) => x != null));
    return e;
  };
  const fmtDM = (s) => { const d = parseDay(s); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
  const C_ENERGY = "#1fe0b8", C_LOAD = "#a99bff";
  const CONF = { none: "Zatím málo dat", low: "Orientačně, zatím málo dní", mid: "Předběžný odhad", high: "Odhad s nalezeným cyklem" };

  function lineChart(st) {
    const W = 680, H = 230, pl = 34, pr = 12, pt = 14, pb = 28, span = 36;
    const todayN = Stats.dn(dayKey()), n0 = todayN - 29;
    const x = (n) => pl + ((n - n0) / (span - 1)) * (W - pl - pr);
    const y = (v) => pt + (1 - v / 100) * (H - pt - pb);
    const recent = st.rows.filter((r) => Stats.dn(r.date) >= n0);
    const avg = (k) => (recent.length ? Math.round(recent.reduce((s, r) => s + r[k], 0) / recent.length) : 0);
    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
      "aria-label": `Graf energie a vytížení za posledních 30 dní a odhad na 7 dní. Zadáno ${recent.length} dní, průměrná energie ${avg("energy")} %, průměrné vytížení ${avg("load")} %.`,
    });
    for (const g of [0, 50, 100]) {
      svg.append(svgEl("line", { x1: pl, x2: W - pr, y1: y(g), y2: y(g), class: "ch-grid" }), svgEl("text", { x: pl - 6, y: y(g) + 4, class: "ch-t", "text-anchor": "end" }, String(g)));
    }
    svg.append(svgEl("rect", { x: x(todayN), y: pt, width: x(todayN + 6) - x(todayN) + 8, height: H - pt - pb, class: "ch-fc" }),
      svgEl("text", { x: x(todayN) + 6, y: pt + 12, class: "ch-t" }, "odhad"));
    for (let k = 0; k < span; k += 7) if (Math.abs(n0 + k - todayN) > 3) svg.append(svgEl("text", { x: x(n0 + k), y: H - 8, class: "ch-t", "text-anchor": "middle" }, fmtDM(Stats.ds(n0 + k))));
    svg.append(svgEl("text", { x: x(todayN), y: H - 8, class: "ch-t ch-today", "text-anchor": "middle" }, "dnes"));
    const byN = new Map(recent.map((r) => [Stats.dn(r.date), r]));
    for (const [key, color, shape] of [["load", C_LOAD, "sq"], ["energy", C_ENERGY, "ci"]]) {
      let seg = [];
      const flush = () => { if (seg.length > 1) svg.append(svgEl("polyline", { points: seg.map((p) => p.join(",")).join(" "), fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round" })); seg = []; };
      for (let n = n0; n <= todayN; n++) {
        const r = byN.get(n);
        if (!r) { flush(); continue; }
        seg.push([x(n).toFixed(1), y(r[key]).toFixed(1)]);
      }
      flush();
      for (const [n, r] of byN) {
        svg.append(shape === "ci" ? svgEl("circle", { cx: x(n), cy: y(r[key]), r: 3.6, fill: color })
          : svgEl("rect", { x: x(n) - 3.3, y: y(r[key]) - 3.3, width: 6.6, height: 6.6, fill: color }));
      }
      if (st.forecast.length) {
        svg.append(svgEl("polyline", { points: st.forecast.map((f, i) => `${x(todayN + i).toFixed(1)},${y(f[key].v).toFixed(1)}`).join(" "), fill: "none", stroke: color, "stroke-width": 2.5, "stroke-dasharray": "2 6", "stroke-linecap": "round" }));
      }
    }
    return svg;
  }

  function cycleChart(cy) {
    const W = 680, H = 150, pl = 12, pr = 12, pt = 14, pb = 24, L = cy.curve.length;
    const m = Math.max(10, ...cy.curve.map(Math.abs));
    const x = (i) => pl + (i / (L - 1)) * (W - pl - pr), y = (v) => pt + (1 - (v + m) / (2 * m)) * (H - pt - pb);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `Křivka tvého cyklu o délce ${L} dní. Dnes je ${cy.day}. den, energie je zde ${cy.level === "high" ? "nadprůměrná" : cy.level === "low" ? "podprůměrná" : "průměrná"}.` });
    svg.append(svgEl("line", { x1: pl, x2: W - pr, y1: y(0), y2: y(0), class: "ch-grid" }),
      svgEl("polyline", { points: cy.curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "), fill: "none", stroke: C_ENERGY, "stroke-width": 3, "stroke-linejoin": "round" }),
      svgEl("line", { x1: x(cy.phaseNow), x2: x(cy.phaseNow), y1: pt, y2: H - pb, class: "ch-now" }),
      svgEl("circle", { cx: x(cy.phaseNow), cy: y(cy.curve[cy.phaseNow]), r: 5, fill: "#fff", stroke: C_ENERGY, "stroke-width": 3 }),
      svgEl("text", { x: Math.min(W - 30, Math.max(30, x(cy.phaseNow))), y: H - 6, class: "ch-t ch-today", "text-anchor": "middle" }, "dnes"),
      svgEl("text", { x: pl, y: H - 6, class: "ch-t" }, "začátek"), svgEl("text", { x: W - pr, y: H - 6, class: "ch-t", "text-anchor": "end" }, `${L}. den`));
    return svg;
  }

  function statPanel(title, ...kids) {
    return h("section", { class: "panel stat-panel" }, h("header", { class: "panel-head" }, h("h2", null, title)), ...kids);
  }

  function renderStats() {
    const st = stats(), box = $("stats-body"), parts = [];
    const todayStr = dayKey();

    if (st.n < Stats.CFG.minRows) {
      parts.push(statPanel("Zatím sbírám data",
        h("p", { class: "muted" }, `Zadáno ${st.n} ze ${Stats.CFG.minRows} dní. Energii a vytížení zadáváš na stránce Dnes ve Stavu dne. Každý den se uloží sám. Po ${Stats.CFG.minRows} dnech ukážu první odhad, po 14 dnech týdenní rytmus a po několika týdnech případně i tvůj vlastní cyklus.`),
        h("div", { class: "meter" }, h("div", { class: "meter-bar", role: "img", "aria-label": `${st.n} ze ${Stats.CFG.minRows} dní` }, h("span", { style: `width:${Math.min(100, (st.n / Stats.CFG.minRows) * 100)}%` })), h("span", { class: "meter-txt" }, `${st.n} / ${Stats.CFG.minRows}`)),
        h("a", { class: "btn btn-primary", href: "#/dnes" }, "Zadat dnešek"),
        h("span", { class: "muted small" }, " Zapomněla jsi na některé dny? Použij Doplnit den nahoře.")));
    } else {
      // odhad
      const cards = st.forecast.map((f, i) => h("div", { class: "fc-card" + (i === 0 ? " is-today" : "") },
        h("b", null, i === 0 ? "Dnes" : f.label), h("span", { class: "fc-date" }, fmtDM(f.date)),
        ...[["Energie", f.energy, "e"], ["Vytížení", f.load, "l"]].map(([lbl, p, k]) => h("div", { class: "fc-m fc-" + k },
          h("div", { class: "fc-row" }, h("span", null, lbl), h("b", null, p.v + " %")),
          h("div", { class: "fc-bar", "aria-hidden": "true" }, h("span", { class: "fc-range", style: `left:${p.lo}%;width:${Math.max(2, p.hi - p.lo)}%` }), h("i", { style: `left:${p.v}%` })),
          h("small", null, `${p.lo}–${p.hi} %`)))));
      parts.push(statPanel("Odhad na dnes a dalších 6 dní",
        h("p", { class: "conf conf-" + st.confidence }, CONF[st.confidence]),
        h("div", { class: "fc-grid" }, cards),
        h("p", { class: "muted small" }, "Z tvých zadaných dnů. Světlý pruh je pravděpodobné rozmezí. Ve Stavu dne je podle odhadu předvyplněno, ale rozhoduješ vždy ty.")));
    }

    // graf
    if (st.n) {
      parts.push(statPanel("Posledních 30 dní",
        h("div", { class: "legend" }, h("span", null, h("i", { class: "lg lg-e" }), "Energie"), h("span", null, h("i", { class: "lg lg-l" }), "Vytížení"), st.forecast.length ? h("span", { class: "muted" }, "tečkovaně: odhad") : null),
        lineChart(st)));
    }

    // týdenní rytmus
    if (st.n >= Stats.CFG.weekdayRows) {
      parts.push(statPanel("Týdenní rytmus",
        h("p", { class: "muted small" }, "Průměr podle dne v týdnu."),
        h("div", { class: "wk" }, st.weekday.map((w) => h("div", { class: "wk-col" },
          h("div", { class: "wk-bars", role: "img", "aria-label": `${w.label}: energie ${w.energy ?? "?"} %, vytížení ${w.load ?? "?"} %, zadáno ${w.count} dní` },
            h("i", { class: "wk-e", style: `height:${w.energy ?? 0}%` }), h("i", { class: "wk-l", style: `height:${w.load ?? 0}%` })),
          h("b", null, w.label), h("small", null, w.energy == null ? "–" : w.energy + " %"))))));
    }

    // cyklus
    const cyBody = [];
    const marks = liveDays().filter((d) => d.cycle_start).map((d) => d.date).sort();
    if (st.cycle) {
      const cy = st.cycle, lvl = { high: "vyšší než obvykle", mid: "průměrná", low: "nižší než obvykle" }[cy.level];
      cyBody.push(h("p", null, cy.kind === "anchors"
        ? `Podle tebou označených začátků trvá tvůj cyklus zhruba ${cy.length} dní. Dnes je ${cy.day}. den a energie bývá v téhle části ${lvl}.`
        : `V tvých datech se energie opakuje zhruba po ${cy.length} dnech. Dnes jsi asi v části, kde je energie ${lvl}.`),
        h("p", { class: "muted" }, `Čekám to takhle: vyšší energie kolem ${fmtDM(cy.nextHigh)}, nižší kolem ${fmtDM(cy.nextLow)} (rozdíl mezi nejlepší a nejhorší částí je zhruba ${cy.amplitude} procentních bodů).`),
        cycleChart(cy));
    } else if (st.n < Stats.CFG.lagMinRows && marks.length < 2) {
      cyBody.push(h("p", { class: "muted" }, `Cyklus se dá hledat zhruba od ${Stats.CFG.lagMinRows} zadaných dní (asi 6 týdnů). Zatím máš ${st.n}. Nic nepřehaduji, dokud na to nemám dost dat.`));
    } else {
      cyBody.push(h("p", { class: "muted" }, "V datech zatím nevidím zřetelné opakování. To je v pořádku: buď žádný pravidelný cyklus není, nebo je potřeba víc dní. Odhad se opírá jen o týdenní rytmus a poslední dny."));
    }
    cyBody.push(h("div", { class: "cycle-tools" },
      h("button", { type: "button", class: "btn btn-sm", id: "cycle-mark", on: { click: toggleCycleToday } }, dayRec(todayStr) && dayRec(todayStr).cycle_start ? "Zrušit označení dneška" : "Dnes začíná nový cyklus"),
      h("span", { class: "muted small" }, marks.length ? `Označené začátky: ${marks.slice(-4).map(fmtDM).join(", ")}${marks.length > 4 ? "…" : ""}` : "Volitelné: když sleduješ nějaký svůj pravidelný cyklus, označ jeho začátek (stačí 2×) a odhad bude přesnější.")));
    cyBody.push(h("p", { class: "muted small" }, "Je to statistický odhad z tvých vlastních záznamů, ne měření a ne zdravotní pomůcka. Když ti nesedí, klidně ho ignoruj."));
    parts.push(statPanel("Tvůj cyklus (experimentální)", ...cyBody));

    // výkon podle energie
    parts.push(statPanel("Kolik zvládneš při jaké energii",
      st.bands.length
        ? h("div", { class: "bands" }, st.bands.map((b) => h("div", { class: "band" },
            h("b", null, b.label), h("span", null, `${b.avgTasks} ${plural(Math.round(b.avgTasks), "úkol", "úkoly", "úkolů")} denně, ${b.avgPoints} b`), h("small", null, `z ${b.days} dní`))))
        : h("p", { class: "muted" }, "Zatím nemám dost údajů. Potřebuji splněné úkoly (odškrtávej je v aplikaci) a aspoň 3 dny v každém pásmu energie."),
      h("p", { class: "muted small" }, "Body: lehký úkol 1, střední 2, náročný 4. Počítají se úkoly odškrtnuté v daný den. Pomůže to doladit, kolik si na dnešek plánovat.")));

    // historie
    const hist = liveDays().filter((d) => d.set).sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 14);
    if (hist.length) {
      parts.push(statPanel("Poslední záznamy",
        h("ul", { class: "hist" }, hist.map((d) => h("li", null,
          h("span", { class: "hist-d" }, `${Stats.WD[Stats.wdOf(Stats.dn(d.date))]} ${fmtDM(d.date)}`),
          h("span", null, `energie ${d.energy} %, vytížení ${d.load} %`), d.cycle_start ? h("span", { class: "chip" }, "začátek cyklu") : null,
          h("button", { type: "button", class: "btn btn-sm btn-ghost", on: { click: () => openDayDialog(d.date) } }, "Upravit"))))));
    }
    box.replaceChildren(...parts);
  }

  function toggleCycleToday() {
    const k = dayKey();
    commit((s) => {
      const cur = s.days.find((d) => d.date === k);
      if (cur) { if (cur.cycle_start) delete cur.cycle_start; else cur.cycle_start = true; delete cur.deleted; }
      else { const v = dayValues(); s.days.push({ id: k, date: k, energy: v.energy, load: v.load, set: false, cycle_start: true, updated_at: nowIso() }); }
    }, "Označeno. Odhad se přepočítá.");
  }

  let dayEditDate = null;
  function fillDayDialog(date) {
    dayEditDate = date;
    const r = dayRec(date);
    $("day-energy").value = r ? r.energy : 55;
    $("day-load").value = r ? r.load : 40;
    $("day-cycle").checked = Boolean(r && r.cycle_start);
    $("day-delete").hidden = !r;
    $("day-error").textContent = "";
    paintDaySliders();
  }
  function paintDaySliders() {
    for (const [id, out] of [["day-energy", "day-energy-v"], ["day-load", "day-load-v"]]) {
      $(out).textContent = $(id).value + " %"; er_style($(id), +$(id).value);
    }
  }
  function openDayDialog(date) {
    $("day-date").max = dayKey();
    $("day-date").value = date || dayKey();
    fillDayDialog($("day-date").value);
    closeSide();
    $("day-dialog").showModal();
    $("day-energy").focus();
  }
  $("day-add").addEventListener("click", () => openDayDialog());
  $("day-date").addEventListener("change", () => { if ($("day-date").value) fillDayDialog($("day-date").value); });
  $("day-energy").addEventListener("input", paintDaySliders);
  $("day-load").addEventListener("input", paintDaySliders);
  $("day-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = $("day-date").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dayKey()) { $("day-error").textContent = "Vyber den, který už nastal."; return; }
    const energy = +$("day-energy").value, load = +$("day-load").value, cyc = $("day-cycle").checked;
    commit((s) => {
      const cur = s.days.find((d) => d.date === date);
      if (cur) { cur.energy = energy; cur.load = load; cur.set = true; delete cur.deleted; if (cyc) cur.cycle_start = true; else delete cur.cycle_start; }
      else s.days.push(Object.assign({ id: date, date, energy, load, set: true, updated_at: nowIso() }, cyc ? { cycle_start: true } : {}));
    }, `Uloženo: ${fmtDM(date)}.`);
    $("day-dialog").close();
  });
  $("day-delete").addEventListener("click", () => {
    const date = dayEditDate;
    commit((s) => { const cur = s.days.find((d) => d.date === date); if (cur) cur.deleted = true; }, `Záznam ${fmtDM(date)} smazán.`);
    $("day-dialog").close();
  });

  /* ---------- Úložiště ---------- */
  function renderStoreStatus() {
    const box = $("st-status");
    if (!box) return;
    const connected = Boolean(gh);
    $("st-connected-block").hidden = !connected;
    $("st-logout").hidden = !USER;
    $("st-conn-note").textContent = "Odhlášení smaže z tohoto zařízení místní kopii dat. V cloudu zůstávají.";
    const [txt, cls] = SYNC[syncKind];
    box.className = "st-status " + cls;
    box.replaceChildren(h("span", { class: "dot-s" }),
      h("div", null,
        h("strong", null, connected ? txt : "Data jsou jen v tomto zařízení"),
        connected ? h("p", null, `Přihlášena jako ${(gh && gh.label) || ""}`) : h("p", null, "Přihlas se a úkoly budou na všech zařízeních."),
        syncDetail ? h("p", { class: "st-detail" }, syncDetail) : null));
  }

  function openStore() {
    renderStoreStatus();
    closeSide();
    $("store-dialog").showModal();
  }
  $("sync").addEventListener("click", openStore);
  $("sync-mini").addEventListener("click", openStore);

  $("store-form").addEventListener("submit", (e) => e.preventDefault());
  $("st-sync").addEventListener("click", () => { sync(); });

  $("st-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "stickies", v: 3, exported_at: nowIso(), ...state }, null, 1)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `stickies-zaloha-${dayKey()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  $("st-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || !Array.isArray(raw.tasks) || !Array.isArray(raw.categories)) throw new Error("bad");
      const incoming = normalize(raw);
      const before = liveTasks().length;
      state = merge(state, incoming);
      reconcileStudyLinks();
      version++; meta.dirty = true; persist(); render(); scheduleSave();
      $("store-dialog").close();
      toast(`Záloha načtena. Přibylo ${Math.max(0, liveTasks().length - before)} úkolů.`);
    } catch {
      $("st-error").textContent = "Tenhle soubor nevypadá jako záloha ze Stickies.";
    }
  });

  /* =====================================================================
     Stav dne (posuvníky)
     ===================================================================== */
  for (const id of ["energy-range", "load-range"]) {
    const el = $(id);
    el.addEventListener("input", () => paintEnergy(+$("energy-range").value, +$("load-range").value));
    el.addEventListener("change", () => {
      const energy = +$("energy-range").value, load = +$("load-range").value;
      commit((s) => {
        const k = dayKey(), cur = s.days.find((d) => d.date === k);
        if (cur) { cur.energy = energy; cur.load = load; cur.set = true; delete cur.deleted; }
        else s.days.push({ id: k, date: k, energy, load, set: true, updated_at: nowIso() });
      });
    });
  }

  /* =====================================================================
     Pohodlí a vzhled (nastavení tohoto zařízení)
     ===================================================================== */
  const FS_OPTIONS = [[1, "Normální"], [1.15, "Větší"], [1.3, "Největší"]];
  const prefs = Object.assign({ fs: 1, calm: false, still: false, sound: true }, store.get(K.pref, {}));
  const reduceMotion = () => prefs.still || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function applyPrefs() {
    const r = document.documentElement;
    r.style.setProperty("--fs", String(prefs.fs));
    r.dataset.calm = prefs.calm ? "1" : "0";
    r.dataset.still = prefs.still ? "1" : "0";
  }
  function savePrefs() { store.set(K.pref, prefs); applyPrefs(); syncStudyFrame(); }
  function buildPrefs() {
    $("pref-fs").replaceChildren(...FS_OPTIONS.map(([v, label]) => h("label", { class: "seg" },
      h("input", Object.assign({ type: "radio", name: "pref-fs", value: String(v) }, prefs.fs === v ? { checked: true } : {})),
      h("span", null, label))));
    $("pref-fs").addEventListener("change", (e) => { prefs.fs = +e.target.value; savePrefs(); });
    for (const [id, key] of [["pref-calm", "calm"], ["pref-still", "still"], ["pref-sound", "sound"]]) {
      $(id).checked = Boolean(prefs[key]);
      $(id).addEventListener("change", () => { prefs[key] = $(id).checked; savePrefs(); });
    }
  }
  $("open-prefs").addEventListener("click", () => { closeSide(); $("prefs-dialog").showModal(); });
  $("open-print").addEventListener("click", () => { closeSide(); $("print-dialog").showModal(); });
  $("print-go").addEventListener("click", () => { const d = $("print-done").checked, s = $("print-steps").checked; $("print-dialog").close(); printTasks(d, s); });

  /* =====================================================================
     Soustředění: jeden úkol, viditelný čas
     ===================================================================== */
  const FOCUS_DEFAULT = { light: 10, medium: 25, hard: 25 };
  const FOCUS_PRESETS = [5, 15, 25, 45];
  const CIRC = 628.32;
  const focus = { id: null, dur: 0, left: 0, endAt: 0, running: false, finished: false, kind: "work", timer: null, msg: "" };
  const fmtClock = (ms) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  let audio = null;

  function unlockAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch { /* bez zvuku */ }
  }
  function beep() {
    if (!prefs.sound || !audio) return;
    try {
      const t0 = audio.currentTime;
      [660, 880].forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = t0 + i * 0.28;
        o.frequency.value = f; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.start(t); o.stop(t + 0.28);
      });
    } catch { /* nic */ }
  }

  function pageTitle() {
    return ROUTE.name === "kat" && catById(ROUTE.id) ? `${catById(ROUTE.id).name} · Stickies` : ROUTE.name === "zasobnik" ? "Zásobník · Stickies" : ROUTE.name === "rutiny" ? "Rutiny · Stickies" : ROUTE.name === "prehled" ? "Přehled · Stickies" : "Dnes · Stickies";
  }
  function setTitle() { document.title = focus.running ? `⏱ ${fmtClock(focus.left)} · Stickies` : pageTitle(); }

  function updateClock() {
    $("focus-time").textContent = fmtClock(focus.left);
    $("focus-ring").style.strokeDashoffset = String(CIRC * (1 - (focus.dur ? focus.left / focus.dur : 0)));
    setTitle();
  }

  function renderFocus() {
    setTitle();
    const d = $("focus-dialog");
    if (!d.open) return;
    const t = taskById(focus.id);
    if (!t || t.status === "done") { d.close(); return; }
    const c = catById(t.category_id) || { color: "violet", name: "" };
    d.className = `focus c-${c.color}`;
    $("focus-title").textContent = t.text;
    $("focus-cat").textContent = c.name;
    $("focus-kind").textContent = focus.kind === "break" ? "Pauza" : "Soustředění";
    updateClock();

    $("focus-presets").replaceChildren(...FOCUS_PRESETS.map((m) => h("button", {
      type: "button", class: "preset", "aria-pressed": String(focus.kind === "work" && focus.dur === m * 60000),
      on: { click: () => setFocusDur(m) },
    }, `${m} min`)));

    const tog = $("focus-toggle");
    tog.hidden = focus.finished;
    tog.replaceChildren(icon(focus.running ? "pause" : "play"), focus.running ? "Pauza" : focus.left < focus.dur ? "Pokračovat" : "Začít");
    $("focus-more").hidden = !(focus.finished && focus.kind === "work");
    $("focus-break").hidden = !(focus.finished && focus.kind === "work");

    $("focus-msg").textContent = focus.finished ? "Čas vypršel. Co dál?"
      : focus.running ? (focus.kind === "break" ? "Odpočívej. Vstaň, napij se, protáhni se." : "Dělej jen tohle. Zbytek počká.")
      : focus.left < focus.dur ? "Pozastaveno."
      : focus.msg || "Stačí začít. Klidně jen na 5 minut.";

    $("focus-steps").replaceChildren(...t.steps.map((s) => h("li", { class: "step-li" },
      h("button", {
        type: "button", class: "step" + (s.done ? " is-done" : ""), "data-k": "fstep:" + s.id, "aria-pressed": String(s.done),
        on: { click: () => act.step(t.id, s.id) },
      }, h("span", { class: "box" }, icon("tick")), h("span", { class: "st-text" }, s.text)))));
  }

  function tick() {
    if (!focus.running) return;
    focus.left = Math.max(0, focus.endAt - Date.now());
    if (focus.left === 0) finishFocus(); else updateClock();
  }
  function startTimer() {
    unlockAudio();
    focus.running = true; focus.finished = false;
    focus.endAt = Date.now() + focus.left;
    clearInterval(focus.timer);
    focus.timer = setInterval(tick, 250);
    renderFocus();
  }
  function pauseTimer() { tick(); focus.running = false; clearInterval(focus.timer); renderFocus(); }
  function stopFocus() { clearInterval(focus.timer); focus.running = false; focus.finished = false; focus.id = null; setTitle(); }
  function setFocusDur(m) {
    focus.kind = "work"; focus.dur = m * 60000; focus.left = focus.dur; focus.finished = false;
    if (focus.running) focus.endAt = Date.now() + focus.left;
    renderFocus();
  }
  function finishFocus() {
    clearInterval(focus.timer);
    focus.running = false; focus.left = 0;
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    const t = taskById(focus.id);
    if (focus.kind === "break") {
      const mins = t ? FOCUS_DEFAULT[t.effort] : 25;
      Object.assign(focus, { kind: "work", dur: mins * 60000, left: mins * 60000, finished: false, msg: "Pauza skončila. Jdeš dál?" });
    } else focus.finished = true;
    if (!$("focus-dialog").open) {
      toast(focus.kind === "work" && !focus.finished ? "Pauza skončila." : `Čas vypršel: ${t ? t.text : ""}`,
        { action: t ? { label: "Otevřít", fn: () => openFocus(focus.id, true) } : null, ms: 20000 });
    }
    renderFocus();
  }

  function openFocus(id, keep) {
    const t = taskById(id);
    if (!t) return;
    if (!(keep && focus.id === id)) {
      clearInterval(focus.timer);
      Object.assign(focus, { id, kind: "work", dur: FOCUS_DEFAULT[t.effort] * 60000, running: false, finished: false, msg: "" });
      focus.left = focus.dur;
    }
    const d = $("focus-dialog");
    if (!d.open) d.showModal();
    renderFocus();
    $("focus-toggle").focus();
  }

  $("focus-toggle").addEventListener("click", () => (focus.running ? pauseTimer() : startTimer()));
  $("focus-more").addEventListener("click", () => { focus.kind = "work"; focus.dur = 10 * 60000; focus.left = focus.dur; startTimer(); });
  $("focus-break").addEventListener("click", () => { focus.kind = "break"; focus.dur = 5 * 60000; focus.left = focus.dur; startTimer(); });
  $("focus-close").addEventListener("click", () => $("focus-dialog").close());
  $("focus-dialog").addEventListener("close", () => {
    if (focus.running) toast("Časovač běží dál na pozadí.", { action: { label: "Otevřít", fn: () => openFocus(focus.id, true) } });
  });
  $("focus-done").addEventListener("click", () => {
    const id = focus.id;
    if (!id) return;
    const rect = $("focus-done").getBoundingClientRect();
    stopFocus();
    $("focus-dialog").close();
    act.complete(id, { getBoundingClientRect: () => rect });
  });

  /* =====================================================================
     Přihlášení (Supabase: e-mail + heslo)
     ===================================================================== */
  const Cloud = window.StickiesCloud;
  let loginMode = "in";

  const LOGIN_TXT = {
    in:    { title: "Přihlášení", submit: "Přihlásit se", alt: "Vytvořit účet", pass: "current-password" },
    up:    { title: "Nový účet", submit: "Vytvořit účet", alt: "Už mám účet", pass: "new-password" },
    reset: { title: "Nové heslo", submit: "Poslat odkaz e-mailem", alt: "Zpět na přihlášení", pass: "current-password" },
    newpw: { title: "Nastav nové heslo", submit: "Uložit heslo", alt: "", pass: "new-password" },
  };

  function setLoginMode(m) {
    loginMode = m;
    const t = LOGIN_TXT[m];
    $("login-title").textContent = t.title;
    $("login-submit").textContent = t.submit;
    $("login-mode-up").textContent = t.alt;
    $("login-mode-up").hidden = !t.alt;
    $("login-forgot").hidden = m !== "in";
    $("login-pass-wrap").hidden = m === "reset";
    $("login-email-wrap").hidden = m === "newpw";
    $("login-pass").autocomplete = t.pass;
    $("login-error").textContent = "";
    $("login-info").textContent = "";
  }

  function showLogin(msg) {
    $("app").hidden = true;
    $("login").hidden = false;
    if (loginMode === "newpw") setLoginMode("in");
    $("login-error").textContent = msg || "";
    $("login-info").textContent = "";
    (($("login-email").value ? $("login-pass") : $("login-email"))).focus();
  }

  function loginMsg(e) {
    const m = String((e && e.message) || "");
    if (/invalid login/i.test(m)) return "Špatný e-mail nebo heslo.";
    if (/not confirmed/i.test(m)) return "E-mail ještě není potvrzený. Otevři odkaz v potvrzovacím e-mailu.";
    if (/already registered|already been registered/i.test(m)) return "Na tenhle e-mail už účet existuje. Přihlas se.";
    if (/Database error|pozvání/i.test(m)) return "Pro tenhle e-mail není pozvánka. Napiš správci, ať ho přidá.";
    if (/rate limit|too many|security purposes/i.test(m)) return "Moc pokusů za sebou. Zkus to za chvíli.";
    if (/at least|weak|short/i.test(m)) return "Heslo musí mít aspoň 8 znaků.";
    if (e && e.status === 0) return "Server není dostupný. Zkontroluj připojení.";
    return m || "Přihlášení se nepovedlo. Zkus to prosím znovu.";
  }

  /** Starší verze (GitHub) držela místní kopii dat pod jménem. Převezmeme ji, ať se neztratí změny z offline zařízení. */
  function adoptLegacy(uid) {
    const old = store.get(K.session, null);
    const name = old && old.user;
    const target = `stickies:v3:u:${uid}:`;
    if (name && store.get(target + "data", null) == null) {
      const src = `stickies:v3:u:${name}:`;
      const d = store.get(src + "data", null);
      if (d) {
        store.set(target + "data", d);
        store.set(target + "seeded", true);
        const lc = store.get(src + "lastcat", null);
        if (lc != null) store.set(target + "lastcat", lc);
        store.set(target + "meta", { sha: null, dirty: true });
      }
    }
    if (old) store.del(K.session);   // starý GitHub token na tomhle zařízení už není potřeba
  }

  function enter() {
    const s = Cloud.session();
    adoptLegacy(s.user.id);
    start(s.user.id, s.user.email);
  }

  $("login-mode-up").addEventListener("click", () => setLoginMode(loginMode === "in" ? "up" : "in"));
  $("login-forgot").addEventListener("click", () => setLoginMode("reset"));

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("login-error"), info = $("login-info"), btn = $("login-submit");
    err.textContent = ""; info.textContent = "";
    const email = $("login-email").value.trim().toLowerCase();
    const pass = $("login-pass").value;
    if (loginMode !== "newpw" && !/^\S+@\S+\.\S+$/.test(email)) { err.textContent = "Napiš svůj e-mail."; $("login-email").focus(); return; }
    if (loginMode !== "reset" && !pass) { err.textContent = "Napiš heslo."; $("login-pass").focus(); return; }
    if ((loginMode === "up" || loginMode === "newpw") && pass.length < 8) { err.textContent = "Heslo musí mít aspoň 8 znaků."; $("login-pass").focus(); return; }
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Chvilku…";
    try {
      if (loginMode === "in") { await Cloud.signIn(email, pass); $("login-pass").value = ""; enter(); }
      else if (loginMode === "up") {
        const r = await Cloud.signUp(email, pass);
        $("login-pass").value = "";
        if (r.session) enter();
        else { setLoginMode("in"); info.textContent = "Poslali jsme ti potvrzovací e-mail. Otevři odkaz v něm a potom se přihlas."; }
      } else if (loginMode === "reset") {
        await Cloud.resetPassword(email);
        setLoginMode("in");
        info.textContent = "Pokud k tomu e-mailu existuje účet, přišel na něj odkaz pro nastavení hesla.";
      } else if (loginMode === "newpw") {
        await Cloud.setPassword(pass);
        $("login-pass").value = "";
        setLoginMode("in");
        enter();
      }
    } catch (ex) {
      err.textContent = loginMsg(ex);
    } finally {
      btn.disabled = false; btn.textContent = LOGIN_TXT[loginMode].submit;
    }
  });

  async function logout() {
    if (gh && meta.dirty) await sync();
    if (meta.dirty && !confirm("Některé změny se ještě neuložily do cloudu a po odhlášení se ztratí. Odhlásit se přesto?")) return;
    ["data", "meta", "seeded", "lastcat"].forEach((k) => store.del(`stickies:v3:u:${USER}:${k}`));
    store.del(K.session);
    await Cloud.signOut();
    location.reload();
  }
  $("side-logout").addEventListener("click", logout);
  $("st-logout").addEventListener("click", logout);

  /* =====================================================================
     Start
     ===================================================================== */
  let bound = false;

  function start(user, label) {
    setNamespace(user);
    loadLocal();
    if (user) gh = { label };
    $("login").hidden = true;
    $("app").hidden = false;
    $("side-logout").hidden = !user;
    $("side-logout-t").textContent = user ? `Odhlásit se (${label})` : "Odhlásit se";
    buildSeg($("add-effort"), "add-effort", "medium");
    buildPresets();
    if (needsSeed()) {
      state = { categories: [], tasks: [], routines: [], days: [], studies: [] };
      seedDefaults();
    }
    if (reconcileStudyLinks()) { version++; meta.dirty = true; persist(); }
    ROUTE = parseRoute();
    if (ROUTE.fix) { ROUTE = { name: "dnes" }; history.replaceState(null, "", "#/dnes"); }
    setComposerDefaults();
    setSync(gh ? (navigator.onLine ? (meta.dirty ? "pending" : "ok") : "offline") : "local");
    render();
    if (gh) sync();

    if (bound) return;
    bound = true;
    window.addEventListener("hashchange", () => applyRoute(false));
    window.addEventListener("online", () => { refresh(); });
    window.addEventListener("offline", () => { if (gh) setSync("offline"); });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); render(); tick(); } });
    setInterval(() => { if (gh && !document.hidden && !meta.dirty) sync(); }, POLL_MS);
    let lastDay = dayKey();
    setInterval(() => { if (dayKey() !== lastDay) { lastDay = dayKey(); render(); } }, 60000);

    const vv = window.visualViewport;
    if (vv) {
      const upd = () => document.documentElement.style.setProperty("--kb", Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px");
      vv.addEventListener("resize", upd);
      vv.addEventListener("scroll", upd);
    }

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* bez offline režimu to jde taky */ });
    }
  }

  function boot() {
    applyPrefs();
    buildPrefs();
    if (!Cloud) { start(null, null); return; }
    const link = Cloud.consumeHash();
    if (link && link.type === "recovery") { showLogin(); setLoginMode("newpw"); return; }
    if (link && link.error) { showLogin(link.error); return; }
    const sess = Cloud.session();
    if (sess && sess.user) { adoptLegacy(sess.user.id); start(sess.user.id, sess.user.email); }
    else showLogin();
  }

  boot();
})();
