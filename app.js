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
    K.data = p + "data"; K.meta = p + "meta"; K.gh = p + "gh"; K.seeded = p + "seeded"; K.lastcat = p + "lastcat";
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
      steps: (Array.isArray(t.steps) ? t.steps : [])
        .filter((s) => s && String(s.text || "").trim())
        .map((s) => ({ id: String(s.id || uuid()), text: String(s.text).slice(0, 200), done: Boolean(s.done) })),
      updated_at: t.updated_at || EPOCH,
    };
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

  function nDay(d) {
    if (!d || !d.date) return null;
    const c = (v, def) => (Number.isFinite(+v) ? Math.max(0, Math.min(100, +v)) : def);
    return { date: String(d.date), energy: c(d.energy, 60), load: c(d.load, 40), set: Boolean(d.set), updated_at: d.updated_at || EPOCH };
  }

  function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const cats = (Array.isArray(r.categories) ? r.categories : []).filter((x) => x && x.id).map(nCat);
    const tasks = (Array.isArray(r.tasks) ? r.tasks : []).filter((x) => x && x.id).map(nTask);
    const routines = (Array.isArray(r.routines) ? r.routines : []).filter((x) => x && x.id).map(nRoutine);
    return { categories: cats, tasks, routines, day: nDay(r.day) };
  }

  const canon = (s) => stable({
    c: [...s.categories].sort((a, b) => (a.id < b.id ? -1 : 1)),
    t: [...s.tasks].sort((a, b) => (a.id < b.id ? -1 : 1)),
    r: [...(s.routines || [])].sort((a, b) => (a.id < b.id ? -1 : 1)),
    d: s.day || null,
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
    return { categories: cats.filter(fresh), tasks: tasks.filter(fresh), routines: routines.filter(fresh), day: pickNewer(a.day, b.day) || null };
  }

  /** Změněným záznamům nastaví updated_at. */
  function touch(prev, next) {
    const now = nowIso();
    const strip = (o) => { const c = { ...o }; delete c.updated_at; return stable(c); };
    for (const key of ["categories", "tasks", "routines"]) {
      const pm = new Map((prev[key] || []).map((x) => [x.id, strip(x)]));
      for (const x of next[key] || []) if (pm.get(x.id) !== strip(x)) x.updated_at = now;
    }
    if (next.day && (!prev.day || strip(prev.day) !== strip(next.day))) next.day.updated_at = now;
  }

  /* =====================================================================
     Stav, uložení
     ===================================================================== */
  let state = { categories: [], tasks: [], routines: [], day: null };
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
    if (!USER) {
      gh = store.get(K.gh, null);
      if (gh && !(gh.repo && gh.token)) gh = null;
    }
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
     Úložiště: soubor v soukromém GitHub repozitáři (Contents API)
     ===================================================================== */
  const SYNC = {
    local:   ["Jen v tomto zařízení", "warn", "Lokálně"],
    pending: ["Čeká na uložení", "busy", "Ukládání"],
    saving:  ["Ukládám…", "busy", "Ukládám"],
    ok:      ["Uloženo na GitHubu", "ok", "Uloženo"],
    offline: ["Offline · uloží se později", "warn", "Offline"],
    error:   ["Chyba · zkouším znovu", "bad", "Chyba"],
    auth:    ["Token nefunguje", "bad", "Token"],
    public:  ["Repozitář je veřejný", "bad", "Veřejný!"],
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

  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64dec(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  class GhError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function ghReq(method, path, body) {
    const res = await fetch("https://api.github.com" + path, {
      method,
      cache: "no-cache",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + gh.token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* prázdná odpověď */ }
    if (!res.ok) throw new GhError(res.status, (json && json.message) || res.statusText);
    return json;
  }

  const filePath = () => `/repos/${gh.repo}/contents/${gh.path.split("/").map(encodeURIComponent).join("/")}`;
  const branchQ = () => (gh.branch ? `?ref=${encodeURIComponent(gh.branch)}` : "");

  async function ghGetFile() {
    try {
      const j = await ghReq("GET", filePath() + branchQ());
      if (Array.isArray(j) || !j.sha) throw new Error("Cesta k souboru míří na složku.");
      if (j.encoding !== "base64" || typeof j.content !== "string" || (!j.content && j.size > 0)) {
        throw new Error("Soubor s daty je příliš velký pro Contents API.");
      }
      let data;
      try { data = JSON.parse(b64dec(j.content)); } catch { throw new Error("Soubor v repozitáři není platný JSON. Nepřepisuji ho."); }
      return { sha: j.sha, data: normalize(data) };
    } catch (e) {
      if (e instanceof GhError && e.status === 404) return null;
      throw e;
    }
  }

  async function ghPutFile(snapshot, sha) {
    const payload = JSON.stringify({ app: "stickies", v: 3, saved_at: nowIso(), ...snapshot }, null, 1);
    const body = { message: "Stickies: " + new Date().toISOString().replace("T", " ").slice(0, 16), content: b64enc(payload) };
    if (sha) body.sha = sha;
    if (gh.branch) body.branch = gh.branch;
    try {
      const j = await ghReq("PUT", filePath(), body);
      return { sha: j.content.sha };
    } catch (e) {
      if (e instanceof GhError && (e.status === 409 || e.status === 422)) return { conflict: true };
      throw e;
    }
  }

  async function ghRepoInfo() {
    return ghReq("GET", `/repos/${gh.repo}`);
  }

  let saveTimer = null, retryTimer = null, syncing = false, again = false, repoChecked = false;

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
      if (!repoChecked) {
        const info = await ghRepoInfo();
        if (info.private === false) { setSync("public", "Data by byla veřejně čitelná. Použij soukromý repozitář."); return; }
        repoChecked = true;
      }
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
        const merged = remote ? merge(state, remote.data) : state;
        if (canon(merged) !== canon(state)) { state = merged; version++; persist(); render(); }
        const snapVer = version;
        const same = remote && canon(merged) === canon(remote.data);
        if (same) {
          meta.sha = remote.sha;
          if (snapVer === version) meta.dirty = false;
          settled = true;
        } else {
          const res = await ghPutFile({ categories: merged.categories, tasks: merged.tasks, routines: merged.routines || [], day: merged.day }, remote ? remote.sha : null);
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
      if (err instanceof GhError && err.status === 401) setSync("auth", USER ? "Token přestal platit. Odhlas se a přihlas znovu, případně požádej správce o nový záznam." : "GitHub odmítl token. Je platný a má právo Contents: Read and write?");
      else if (err instanceof GhError && err.status === 403 && /rate limit/i.test(err.message)) { setSync("error", "Překročen limit požadavků GitHubu."); retryTimer = setTimeout(sync, 120000); }
      else if (err instanceof GhError && err.status === 403) setSync("auth", "Token nemá právo zapisovat do tohoto repozitáře.");
      else if (err instanceof GhError && err.status === 404) setSync("error", "Repozitář nebo větev nenalezena (nebo k nim token nemá přístup).");
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

  /* ---------- Připojení / odpojení ---------- */
  const isPristine = () => {
    if (liveTasks().length) return false;
    return liveCats().every((c) => DEFAULT_CATS.some(([n, col]) => n === c.name && col === c.color));
  };

  async function connect(cfg) {
    const prev = gh;
    gh = cfg;
    try {
      const info = await ghRepoInfo();
      if (info.private === false) throw new Error("Tenhle repozitář je veřejný. Data by si mohl přečíst kdokoli. Vytvoř soukromý.");
      const remote = await ghGetFile();
      if (remote && isPristine()) {
        // nové zařízení: neduplikovat výchozí kategorie, které už jinde existují
        state = { categories: [], tasks: [], routines: [], day: null };
      }
      store.set(K.gh, cfg);
      store.set(K.seeded, true);
      meta = { sha: null, dirty: true };
      repoChecked = true;
      persist();
      render();
      sync();
    } catch (e) {
      gh = prev;
      throw e;
    }
  }

  function disconnect() {
    gh = null;
    store.del(K.gh);
    meta = { sha: null, dirty: false };
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    persist();
    setSync("local");
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
     Routing
     ===================================================================== */
  let ROUTE = { name: "dnes" };

  function parseRoute() {
    const m = (location.hash || "").match(/^#\/(dnes|zasobnik|rutiny|kat)(?:\/([\w-]+))?$/);
    if (!m) return { name: "dnes" };
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
    if (ROUTE.name === "dnes") renderToday();
    else if (ROUTE.name === "zasobnik") renderBacklog();
    else if (ROUTE.name === "rutiny") renderRoutines();
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
  const TODAY_LIMIT = 5, COL_LIMIT = 6;
  const openNotes = new Map();          // id úkolu → rozbalen?
  const ui = { allToday: false, allBack: {} };
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
    if (mode === "backlog") el.addEventListener("click", (e) => { if (!e.target.closest("button,input,form,a,.steps-panel")) act.toToday(t.id); });
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
      box.replaceChildren(emptyEl("Zatím nic na dnes", "Vyber úkol ze zásobníku, přidej nový, nebo nech vybrat mě.",
        h("div", { class: "empty-actions" },
          h("button", { class: "btn btn-primary", type: "button", on: { click: pickForMe } }, icon("shuffle"), "Vyber za mě"),
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

  function dayValues() {
    const d = state.day;
    if (d && d.date === dayKey()) return { energy: d.energy, load: d.load, set: d.set };
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
    $("energy-unset").hidden = v.set;
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
          h("button", { type: "button", class: "btn btn-sm", on: { click: pickForMe } }, icon("shuffle"), "Vyber za mě"),
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
    brief.replaceChildren(!isSet ? "Zadej energii a vytížení a dostaneš doporučení na dnešek." : rec.total
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

  /** Rozhodovat se je náročné: vybere úkol, který se k dnešku hodí. */
  function pickForMe() {
    const back = liveTasks().filter((t) => t.status === "backlog");
    if (!back.length) { toast("Zásobník je prázdný. Přidej úkol a pak ti pomůžu vybrat."); return; }
    const fit = fitSet();
    let pool = back.filter((t) => fit.has(t.effort));
    if (!pool.length) pool = back.filter((t) => t.effort === "light");
    if (!pool.length) pool = back;
    const t = pool[Math.floor(Math.random() * pool.length)];
    commit((s) => { const x = s.tasks.find((y) => y.id === t.id); x.status = "today"; x.pos = Date.now(); }, `Vybráno na dnes: ${t.text}`);
  }
  $("pick-me").addEventListener("click", pickForMe);

  function renderBacklog() {
    const cats = liveCats();
    const total = liveTasks().filter((t) => t.status === "backlog").length;
    $("count-backlog").textContent = total;
    const fit = fitSet();
    const grid = $("backlog-grid");
    if (!cats.length) {
      grid.replaceChildren(emptyEl("Zatím tu není žádná kategorie", "Kategorie jsou tvoje stránky v boční liště, třeba Práce, Studium nebo Domácnost.",
        h("button", { class: "btn btn-primary", type: "button", on: { click: () => openCatDialog() } }, "Vytvořit kategorii")));
      return;
    }
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
        h("strong", null, "Prázdno"), h("p", null, "Přidej první úkol")), (t) => ({ hideCat: true, fits: fit.has(t.effort) }));
      if (list.length > COL_LIMIT) notes.append(moreBtn("b" + c.id, all, list.length - COL_LIMIT, () => { ui.allBack[c.id] = !all; render(); }));
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
        h("strong", null, "Zásobník je prázdný"), h("p", null, "Přidej první úkol do této kategorie")), { hideCat: true });
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
    const cat = $("edit-cat").value, effort = segValue($("edit-effort"));
    commit((s) => {
      const t = s.tasks.find((x) => x.id === editId);
      if (!t) return;
      t.text = text; t.category_id = cat; t.effort = effort; t.steps = steps;
    });
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

  /* ---------- Úložiště ---------- */
  function renderStoreStatus() {
    const box = $("st-status");
    if (!box) return;
    const connected = Boolean(gh);
    $("st-form-block").hidden = connected;
    $("st-connected-block").hidden = !connected;
    $("st-disconnect").hidden = Boolean(USER);
    $("st-logout").hidden = !USER;
    $("st-conn-note").textContent = USER
      ? "Odhlášení smaže z tohoto zařízení token i místní kopii dat. Na GitHubu zůstávají."
      : "Odpojení smaže z tohoto zařízení token. Data v repozitáři i lokální kopie zůstávají.";
    const [txt, cls] = SYNC[syncKind];
    box.className = "st-status " + cls;
    box.replaceChildren(h("span", { class: "dot-s" }),
      h("div", null,
        h("strong", null, connected ? txt : "Data jsou jen v tomto zařízení"),
        connected ? h("p", null, USER ? `Přihlášena jako ${USER} · ${gh.path}` : `${gh.repo} · ${gh.path}`)
          : h("p", null, "Připoj soukromý repozitář na GitHubu a úkoly budou na všech zařízeních."),
        syncDetail ? h("p", { class: "st-detail" }, syncDetail) : null));
  }

  function openStore() {
    renderStoreStatus();
    $("st-error").textContent = "";
    $("st-token").value = "";
    if (!gh && !$("st-repo").value) $("st-repo").value = store.get("stickies:v3:lastrepo", "");
    closeSide();
    $("store-dialog").showModal();
  }
  $("sync").addEventListener("click", openStore);
  $("sync-mini").addEventListener("click", openStore);

  $("store-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (gh) return;
    const err = $("st-error"), btn = $("st-connect");
    err.textContent = "";
    const repo = $("st-repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
    const token = $("st-token").value.trim();
    const path = ($("st-path").value.trim() || "stickies-data.json").replace(/^\/+/, "");
    const branch = $("st-branch").value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { err.textContent = "Zadej repozitář ve tvaru vlastník/název, třeba magda/stickies-data."; $("st-repo").focus(); return; }
    if (!token) { err.textContent = "Vlož přístupový token."; $("st-token").focus(); return; }
    btn.disabled = true; btn.textContent = "Připojuji…";
    try {
      await connect({ repo, token, path, branch });
      store.set("stickies:v3:lastrepo", repo);
      $("st-token").value = "";
      renderStoreStatus();
      toast("Připojeno. Data se ukládají na GitHub.");
    } catch (ex) {
      err.textContent = ex instanceof GhError
        ? ex.status === 401 ? "GitHub token odmítl. Zkontroluj, že je celý a nevypršel."
        : ex.status === 404 ? "Repozitář jsem nenašel, nebo k němu token nemá přístup. Token musí mít vybraný právě tenhle repozitář."
        : ex.status === 403 ? "Token nemá potřebná práva. Potřebuje Contents: Read and write."
        : `GitHub odpověděl chybou ${ex.status}: ${ex.message}`
        : (ex.message || "Připojení se nepovedlo.");
      if (!navigator.onLine) err.textContent = "Jsi offline. Připoj se k internetu a zkus to znovu.";
    } finally {
      btn.disabled = false; btn.textContent = "Připojit";
    }
  });

  $("st-sync").addEventListener("click", () => { repoChecked = false; sync(); });
  $("st-disconnect").addEventListener("click", () => {
    disconnect();
    renderStoreStatus();
    toast("Zařízení odpojeno. Úkoly tu zůstaly.");
  });

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
      commit((s) => { s.day = { date: dayKey(), energy, load, set: true, updated_at: nowIso() }; });
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
  function savePrefs() { store.set(K.pref, prefs); applyPrefs(); }
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
    return ROUTE.name === "kat" && catById(ROUTE.id) ? `${catById(ROUTE.id).name} · Stickies` : ROUTE.name === "zasobnik" ? "Zásobník · Stickies" : ROUTE.name === "rutiny" ? "Rutiny · Stickies" : "Dnes · Stickies";
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
     Přihlášení (jen jméno, token je v users.js)
     ===================================================================== */
  const usersMap = () => window.STICKIES_USERS || {};

  function showLogin(msg) {
    $("app").hidden = true;
    $("login").hidden = false;
    $("login-error").textContent = msg || "";
    $("login-user").focus();
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("login-error"), btn = $("login-submit");
    err.textContent = "";
    const name = $("login-user").value.trim().toLowerCase();
    if (!name) { err.textContent = "Napiš své jméno."; return; }
    btn.disabled = true; btn.textContent = "Otevírám…";
    try {
      const entry = usersMap()[name];
      const tok = entry ? (Array.isArray(entry.token) ? entry.token.join("") : entry.token) : "";
      const cfg = tok ? { repo: entry.repo || window.STICKIES_REPO, token: String(tok).trim(), path: entry.path } : null;
      if (!cfg || !cfg.repo) { err.textContent = "Takové jméno neznám. Zkontroluj, jak ho píšeš, nebo se zeptej správce."; return; }
      store.set(K.session, { user: name, cfg });
      start(name, cfg);
    } catch {
      err.textContent = "Přihlášení se nepovedlo. Zkus to prosím znovu.";
    } finally {
      btn.disabled = false; btn.textContent = "Otevřít moje úkoly";
    }
  });

  async function logout() {
    if (gh && meta.dirty) await sync();
    if (meta.dirty && !confirm("Některé změny se ještě neuložily na GitHub a po odhlášení se ztratí. Odhlásit se přesto?")) return;
    ["data", "meta", "seeded", "lastcat", "gh"].forEach((k) => store.del(`stickies:v3:u:${USER}:${k}`));
    store.del(K.session);
    location.reload();
  }
  $("side-logout").addEventListener("click", logout);
  $("st-logout").addEventListener("click", logout);

  /* =====================================================================
     Start
     ===================================================================== */
  let bound = false;

  function start(user, cfg) {
    setNamespace(user);
    loadLocal();
    if (user) gh = { repo: cfg.repo, token: cfg.token, path: cfg.path || `data/${user}.json`, branch: cfg.branch || "" };
    $("login").hidden = true;
    $("app").hidden = false;
    $("side-logout").hidden = !user;
    $("side-logout-t").textContent = user ? `Odhlásit se (${user})` : "Odhlásit se";
    buildSeg($("add-effort"), "add-effort", "medium");
    buildPresets();
    if (needsSeed()) {
      state = { categories: [], tasks: [], routines: [], day: null };
      seedDefaults();
    }
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
    const users = usersMap();
    if (Object.keys(users).length) {
      const s = store.get(K.session, null);
      if (s && users[s.user] && s.cfg && s.cfg.repo && s.cfg.token) start(s.user, s.cfg);
      else showLogin();
    } else {
      start(null, null);
    }
  }

  boot();
})();
