(() => {
  "use strict";

  /* =====================================================================
     Konfigurace
     ===================================================================== */
  const CFG = window.STICKIES_CONFIG || {};
  const REMOTE = Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);

  const COLORS = ["violet", "teal", "pink", "amber", "blue", "lime"];
  const COLOR_NAMES = { violet: "Fialová", teal: "Tyrkysová", pink: "Růžová", amber: "Oranžová", blue: "Modrá", lime: "Zelená" };
  const DEFAULT_CATS = [["Práce", "violet"], ["Studium", "teal"], ["Domácnost", "amber"], ["Osobní", "pink"]];
  const CAT_KEYS = ["name", "color", "pos"];
  const TASK_KEYS = ["category_id", "text", "status", "done_at", "pos"];
  const NS = "http://www.w3.org/2000/svg";

  /* =====================================================================
     Pomocné funkce
     ===================================================================== */
  const $ = (id) => document.getElementById(id);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const byPos = (a, b) => a.pos - b.pos;
  const nowIso = () => new Date().toISOString();
  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const x = [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }

  function isToday(iso) {
    if (!iso) return false;
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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

  function iconBtn(name, label, fn) {
    return h("button", {
      class: "icon-btn", type: "button", "aria-label": label, title: label,
      on: { click: (e) => { e.stopPropagation(); fn(); } },
    }, icon(name));
  }

  /* =====================================================================
     Stav, uložení a fronta změn
     ===================================================================== */
  let sb = null;
  let channel = null;
  let ctx = { mode: "local", uid: "local", email: "" };
  let state = { categories: [], tasks: [] };
  let outbox = {};                        // klíč "task:<id>" / "cat:<id>" → poslední operace
  const ui = { view: "today", filter: "all" };

  const K = {
    cache: () => `stickies:v2:${ctx.uid}:cache`,
    outbox: () => `stickies:v2:${ctx.uid}:outbox`,
    seeded: () => `stickies:v2:${ctx.uid}:seeded`,
    lastcat: () => `stickies:v2:${ctx.uid}:lastcat`,
    last: "stickies:v2:last-user",
  };

  const catById = (id) => state.categories.find((c) => c.id === id);
  const taskById = (id) => state.tasks.find((t) => t.id === id);
  const todayTasks = () => state.tasks.filter((t) => t.status === "today").sort(byPos);
  const doneTasks = () => state.tasks.filter((t) => t.status === "done" && isToday(t.done_at))
    .sort((a, b) => new Date(b.done_at) - new Date(a.done_at));
  const backlogTasks = (cid) => state.tasks.filter((t) => t.status === "backlog" && t.category_id === cid).sort(byPos);

  const catRow = (c) => ({ id: c.id, name: c.name, color: c.color, pos: c.pos, updated_at: c.updated_at });
  const taskRow = (t) => ({ id: t.id, category_id: t.category_id, text: t.text, status: t.status, done_at: t.done_at, pos: t.pos, updated_at: t.updated_at });

  function persist() {
    store.set(K.cache(), state);
    if (ctx.mode === "remote") store.set(K.outbox(), outbox);
  }

  function loadCache() {
    const s = store.get(K.cache(), null);
    state = s && Array.isArray(s.tasks) && Array.isArray(s.categories) ? s : { categories: [], tasks: [] };
    outbox = ctx.mode === "remote" ? store.get(K.outbox(), {}) : {};
  }

  /* Úplně nový uživatel dostane výchozí kategorie (jen jednou). */
  const needsSeed = () => !state.categories.length && !state.tasks.length && !Object.keys(outbox).length && !store.get(K.seeded(), false);
  function seedDefaults() {
    store.set(K.seeded(), true);
    commit((s) => {
      const t0 = Date.now();
      DEFAULT_CATS.forEach(([name, color], i) => s.categories.push({ id: uuid(), name, color, pos: t0 + i, updated_at: nowIso() }));
    });
  }

  /* Porovná dva stavy, označí změněné záznamy a zařadí je do fronty k odeslání. */
  function queueDiff(a, b) {
    const now = nowIso();
    const sig = (o, keys) => JSON.stringify(keys.map((k) => o[k]));
    const remote = ctx.mode === "remote";

    const diffList = (la, lb, keys, kind) => {
      const ma = new Map(la.map((x) => [x.id, x]));
      const seen = new Set();
      for (const x of lb) {
        seen.add(x.id);
        const o = ma.get(x.id);
        if (!o || sig(o, keys) !== sig(x, keys)) {
          x.updated_at = now;
          if (remote) outbox[`${kind}:${x.id}`] = { t: kind, k: "up", row: kind === "cat" ? catRow(x) : taskRow(x) };
        }
      }
      for (const o of la) {
        if (!seen.has(o.id) && remote) outbox[`${kind}:${o.id}`] = { t: kind, k: "del", id: o.id };
      }
    };
    diffList(a.categories, b.categories, CAT_KEYS, "cat");
    diffList(a.tasks, b.tasks, TASK_KEYS, "task");
  }

  /* Jediné místo, kudy procházejí změny dat. Nabídne „Zpět“. */
  function commit(mutate, msg, ms) {
    const before = clone(state);
    mutate(state);
    queueDiff(before, state);
    persist();
    render();
    flush();
    if (msg) {
      toast(msg, () => {
        const cur = state;
        state = clone(before);
        queueDiff(cur, state);
        persist();
        render();
        flush();
      }, ms);
    }
  }

  /* =====================================================================
     Synchronizace (Supabase)
     ===================================================================== */
  const SYNC = {
    local: ["Jen v tomto zařízení", "warn"],
    saving: ["Ukládám…", "busy"],
    ok: ["Synchronizováno", "ok"],
    offline: ["Offline", "warn"],
    error: ["Chyba spojení · zkouším znovu", "bad"],
  };
  function setSync(kind) {
    const [txt, cls] = SYNC[kind];
    const pending = Object.keys(outbox).length;
    $("sync").className = "sync " + cls;
    $("sync-text").textContent = kind === "offline" && pending ? `Offline · ${pending} čeká na odeslání` : txt;
  }

  let flushing = false, dirty = false, retryTimer = null;

  async function flush() {
    if (ctx.mode !== "remote") return;
    if (flushing) { dirty = true; return; }
    if (!Object.keys(outbox).length) { setSync(navigator.onLine ? "ok" : "offline"); return; }
    if (!navigator.onLine) { setSync("offline"); return; }

    flushing = true;
    setSync("saving");
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) { showLogin("Přihlášení vypršelo. Přihlas se prosím znovu."); return; }

      for (let guard = 0; guard < 20; guard++) {
        const ops = Object.values(outbox);
        if (!ops.length) break;
        const pick = (t, k) => ops.filter((o) => o.t === t && o.k === k);
        const finish = (list) => {
          for (const o of list) {
            const key = `${o.t}:${o.row ? o.row.id : o.id}`;
            if (outbox[key] === o) delete outbox[key];
          }
          store.set(K.outbox(), outbox);
        };
        // Pořadí kvůli cizím klíčům: kategorie → úkoly → mazání úkolů → mazání kategorií
        let l = pick("cat", "up");
        if (l.length) { const { error } = await sb.from("categories").upsert(l.map((o) => o.row)); if (error) throw error; finish(l); }
        l = pick("task", "up");
        if (l.length) { const { error } = await sb.from("tasks").upsert(l.map((o) => o.row)); if (error) throw error; finish(l); }
        l = pick("task", "del");
        if (l.length) { const { error } = await sb.from("tasks").delete().in("id", l.map((o) => o.id)); if (error) throw error; finish(l); }
        l = pick("cat", "del");
        if (l.length) { const { error } = await sb.from("categories").delete().in("id", l.map((o) => o.id)); if (error) throw error; finish(l); }
      }
      setSync("ok");
    } catch (err) {
      console.warn("[sync]", err);
      setSync(navigator.onLine ? "error" : "offline");
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, 15000);
    } finally {
      flushing = false;
      if (dirty) { dirty = false; flush(); }
    }
  }

  /* Stáhne stav ze serveru a přes něj položí ještě neodeslané lokální změny. */
  async function pull() {
    if (ctx.mode !== "remote" || !navigator.onLine) return;
    try {
      const [c, t] = await Promise.all([
        sb.from("categories").select("id,name,color,pos,updated_at").order("pos"),
        sb.from("tasks").select("id,category_id,text,status,done_at,pos,updated_at").order("pos"),
      ]);
      if (c.error) throw c.error;
      if (t.error) throw t.error;

      const cats = new Map(c.data.map((x) => [x.id, x]));
      const tasks = new Map(t.data.map((x) => [x.id, x]));
      for (const op of Object.values(outbox)) {
        const m = op.t === "cat" ? cats : tasks;
        if (op.k === "up") m.set(op.row.id, { ...op.row });
        else m.delete(op.id);
      }
      state = { categories: [...cats.values()].sort(byPos), tasks: [...tasks.values()].sort(byPos) };

      if (needsSeed()) {
        seedDefaults();
      } else {
        if (state.categories.length) store.set(K.seeded(), true);
        persist();
        render();
      }
      if (!Object.keys(outbox).length) setSync("ok");
    } catch (err) {
      console.warn("[pull]", err);
      setSync(navigator.onLine ? "error" : "offline");
    }
  }

  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("stickies-" + ctx.uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (p) => onRemote("task", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, (p) => onRemote("cat", p))
      .subscribe();
  }

  function onRemote(kind, p) {
    const id = (p.new && p.new.id) || (p.old && p.old.id);
    if (!id || outbox[`${kind}:${id}`]) return;           // lokální neodeslaná změna má přednost
    const list = kind === "cat" ? state.categories : state.tasks;
    if (p.eventType === "DELETE") {
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return;
      list.splice(i, 1);
      if (kind === "cat") state.tasks = state.tasks.filter((t) => t.category_id !== id);
    } else {
      const row = kind === "cat" ? catRow(p.new) : taskRow(p.new);
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) {
        if (Date.parse(row.updated_at) < Date.parse(list[i].updated_at)) return;
        list[i] = row;
      } else list.push(row);
    }
    list.sort(byPos);
    persist();
    render();
  }

  let lastRefresh = 0;
  function refresh() {
    if (ctx.mode !== "remote" || document.hidden) return;
    if (Date.now() - lastRefresh < 4000) return;
    lastRefresh = Date.now();
    flush().then(pull);
  }

  /* =====================================================================
     Přihlášení
     ===================================================================== */
  function showLogin(msg) {
    $("app").hidden = true;
    $("login").hidden = false;
    $("login-error").textContent = msg || "";
    $("login-id").focus();
  }

  function showApp() {
    $("login").hidden = true;
    $("app").hidden = false;
    const remote = ctx.mode === "remote";
    $("local-note").hidden = remote || sessionStorage.getItem("stickies:hide-local") === "1";
    $("user-wrap").hidden = !remote;
    if (remote) {
      const name = userLabel();
      $("user-btn").textContent = name.charAt(0);
      $("user-label").textContent = ctx.email || name;
    }
    setView(sessionStorage.getItem("stickies:view") || "today");
    setSync(remote ? (navigator.onLine ? "ok" : "offline") : "local");
    render();
  }

  function userLabel() {
    const users = window.USERS || {};
    const hit = Object.keys(users).find((k) => String(users[k]).toLowerCase() === String(ctx.email).toLowerCase());
    return hit || String(ctx.email || "?").split("@")[0] || "?";
  }

  async function startRemote(user) {
    ctx = { mode: "remote", uid: user.id, email: user.email || "" };
    store.set(K.last, { uid: ctx.uid, email: ctx.email });
    loadCache();
    showApp();
    subscribe();
    await flush();
    await pull();
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("login-error");
    err.textContent = "";
    const id = $("login-id").value.trim();
    const pw = $("login-pw").value;
    if (!id || !pw) { err.textContent = "Vyplň jméno i heslo."; return; }
    const email = id.includes("@") ? id : (window.USERS || {})[id.toLowerCase()];
    if (!email) { err.textContent = "Takové uživatelské jméno neznám."; return; }

    const btn = $("login-submit");
    btn.disabled = true;
    btn.textContent = "Přihlašuji…";
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) {
        err.textContent = /fetch|network/i.test(error.message) ? "Nelze se připojit. Zkontroluj internet." : "Nesprávné jméno nebo heslo.";
        return;
      }
      $("login-pw").value = "";
      await startRemote(data.user);
    } catch {
      err.textContent = "Nelze se připojit. Zkontroluj internet.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Přihlásit se";
    }
  });

  $("pw-toggle").addEventListener("click", () => {
    const pw = $("login-pw"), show = pw.type === "password";
    pw.type = show ? "text" : "password";
    $("pw-toggle").setAttribute("aria-pressed", String(show));
    $("pw-toggle").setAttribute("aria-label", show ? "Skrýt heslo" : "Zobrazit heslo");
    $("pw-toggle").replaceChildren(icon(show ? "eye-off" : "eye"));
  });

  async function logout() {
    await flush();
    if (Object.keys(outbox).length && !confirm("Některé změny se ještě neodeslaly a po odhlášení se ztratí. Odhlásit se přesto?")) return;
    const uid = ctx.uid;
    try { await sb.auth.signOut(); } catch { /* i offline chceme smazat lokální data */ }
    ["cache", "outbox", "seeded", "lastcat"].forEach((k) => store.del(`stickies:v2:${uid}:${k}`));
    store.del(K.last);
    location.reload();
  }

  /* =====================================================================
     Akce nad úkoly
     ===================================================================== */
  const act = {
    toToday: (id) => commit((s) => { const t = s.tasks.find((x) => x.id === id); t.status = "today"; t.done_at = null; t.pos = Date.now(); }, "Přesunuto do dnešních priorit"),
    toBacklog: (id) => commit((s) => { const t = s.tasks.find((x) => x.id === id); t.status = "backlog"; t.done_at = null; t.pos = Date.now(); }, "Vráceno do zásobníku"),
    done: (id) => commit((s) => { const t = s.tasks.find((x) => x.id === id); t.status = "done"; t.done_at = nowIso(); }, "Úkol splněn"),
    reopen: (id) => commit((s) => { const t = s.tasks.find((x) => x.id === id); t.status = "today"; t.done_at = null; t.pos = Date.now(); }, "Vráceno do priorit"),
    remove: (id) => commit((s) => { s.tasks = s.tasks.filter((x) => x.id !== id); }, "Úkol smazán"),
  };

  /* =====================================================================
     Vykreslení
     ===================================================================== */
  function noteEl(t, mode) {
    const cat = catById(t.category_id);
    const el = h("article", { class: `note c-${cat ? cat.color : "violet"} is-${mode}`, "data-id": t.id });

    const check = h("button", {
      class: "check", type: "button",
      "aria-label": (mode === "done" ? "Znovu otevřít: " : "Označit jako hotové: ") + t.text,
      title: mode === "done" ? "Znovu otevřít" : "Hotovo",
      on: { click: (e) => { e.stopPropagation(); (mode === "done" ? act.reopen : act.done)(t.id); } },
    }, icon(mode === "done" ? "check-filled" : "circle"));

    const foot = h("div", { class: "note-foot" });
    if (mode === "backlog") {
      foot.append(h("button", {
        class: "pill", type: "button", "aria-label": "Přesunout na dnes: " + t.text,
        on: { click: (e) => { e.stopPropagation(); act.toToday(t.id); } },
      }, "Na dnes", icon("arrow-right")));
    } else {
      foot.append(h("span", { class: "chip" }, cat ? cat.name : "Bez kategorie"));
      if (mode === "done" && t.done_at) foot.append(h("span", { class: "time" }, fmtTime(t.done_at)));
    }

    const tools = h("div", { class: "tools" });
    if (mode === "today") tools.append(iconBtn("undo", "Vrátit do zásobníku", () => act.toBacklog(t.id)));
    tools.append(iconBtn("edit", "Upravit úkol", () => openEdit(t.id)), iconBtn("trash", "Smazat úkol", () => act.remove(t.id)));
    foot.append(tools);

    el.append(check, h("div", { class: "note-main" }, h("p", { class: "note-text" }, t.text), foot));
    if (mode === "backlog") el.addEventListener("click", () => act.toToday(t.id));
    return el;
  }

  function emptyEl({ title, text, bubble = "sparkle", action }) {
    return h("div", { class: "empty" },
      h("span", { class: "bubble" }, icon(bubble)),
      h("strong", {}, title),
      text ? h("p", {}, text) : null,
      action ? h("button", { class: "btn", type: "button", on: { click: action.fn } }, action.label) : null);
  }

  function fillList(container, items, mode, empty) {
    container.replaceChildren();
    if (!items.length) { container.append(emptyEl(empty)); return; }
    items.forEach((t) => container.append(noteEl(t, mode)));
  }

  function goToBacklog() {
    if (isMobile()) setView("tasks");
    else $("backlog").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderHero() {
    const open = todayTasks().length, done = doneTasks().length, total = open + done;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $("date").textContent = capitalize(new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long" }).format(new Date()));
    $("progress-text").textContent = total ? `${done} z ${total} splněno` : "Zatím žádné priority";
    $("ring-pct").textContent = total ? pct + "%" : "–";
    $("ring-fg").style.strokeDashoffset = String(175.93 * (1 - pct / 100));
  }

  function renderLists() {
    const open = todayTasks(), done = doneTasks();
    const noCats = !state.categories.length;
    const allDone = !open.length && done.length;

    fillList($("today-list"), open, "today", allDone
      ? { title: "Všechno splněno", text: "Dnešní priority jsou hotové. Vezmi si další ze zásobníku, nebo si odpočiň.", bubble: "sparkle", action: { label: "Vybrat další úkol", fn: goToBacklog } }
      : { title: "Dnes zatím žádné priority", text: noCats ? "Začni vytvořením první kategorie." : "Vyber si ze zásobníku to, co chceš dnes stihnout.", bubble: "today",
          action: noCats ? { label: "Nová kategorie", fn: () => openCat(null) } : { label: "Vybrat ze zásobníku", fn: goToBacklog } });

    fillList($("done-list"), done, "done",
      { title: "Zatím nic splněno", text: "Splněné úkoly se tu objeví hned po odškrtnutí.", bubble: "tick" });

    $("count-today").textContent = String(open.length);
    $("count-done").textContent = String(done.length);
  }

  function setFilter(f) {
    ui.filter = f;
    renderBacklog();
    const b = $("chips").querySelector('[aria-pressed="true"]');
    if (b) b.focus();
  }

  function chipBtn(label, count, color, pressed, fn) {
    return h("button", {
      class: "chip-btn" + (color ? ` c-${color}` : ""), type: "button", "aria-pressed": String(pressed), on: { click: fn },
    }, color ? h("span", { class: "dot" }) : null, label, h("span", { class: "n" }, String(count)));
  }

  function renderBacklog() {
    if (ui.filter !== "all" && !catById(ui.filter)) ui.filter = "all";

    const total = state.tasks.filter((t) => t.status === "backlog").length;
    $("count-backlog").textContent = String(total);

    const chips = $("chips");
    chips.replaceChildren(chipBtn("Vše", total, null, ui.filter === "all", () => setFilter("all")));
    for (const c of state.categories) {
      const n = state.tasks.filter((t) => t.status === "backlog" && t.category_id === c.id).length;
      chips.append(chipBtn(c.name, n, c.color, ui.filter === c.id, () => setFilter(c.id)));
    }
    chips.append(h("button", { class: "chip-btn add", type: "button", on: { click: () => openCat(null) } }, icon("plus"), "Kategorie"));

    const wrap = $("categories");
    wrap.replaceChildren();
    if (!state.categories.length) {
      wrap.className = "cat-grid single";
      wrap.append(emptyEl({ title: "Zatím žádné kategorie", text: "Kategorie třídí úkoly do barevných skupin, třeba Práce nebo Domácnost.", bubble: "list", action: { label: "Vytvořit kategorii", fn: () => openCat(null) } }));
      return;
    }

    const cats = ui.filter === "all" ? state.categories : state.categories.filter((c) => c.id === ui.filter);
    wrap.className = "cat-grid" + (cats.length === 1 ? " single" : "");
    for (const c of cats) {
      const items = backlogTasks(c.id);
      const list = h("div", { class: "notes" });
      if (items.length) items.forEach((t) => list.append(noteEl(t, "backlog")));
      else list.append(h("button", { class: "empty", type: "button", on: { click: () => openComposer(c.id) } },
        h("strong", {}, "Prázdno"), h("p", {}, `Přidat úkol do „${c.name}“`)));

      wrap.append(h("section", { class: `cat-col c-${c.color}`, "aria-label": c.name },
        h("div", { class: "cat-head" },
          h("span", { class: "dot" }), h("h3", {}, c.name), h("span", { class: "count" }, String(items.length)),
          iconBtn("plus", `Přidat úkol do „${c.name}“`, () => openComposer(c.id)),
          iconBtn("edit", `Upravit kategorii „${c.name}“`, () => openCat(c.id))),
        list));
    }
  }

  function fillCats(sel, selected) {
    sel.replaceChildren(...state.categories.map((c) => h("option", { value: c.id }, c.name)));
    if (selected && state.categories.some((c) => c.id === selected)) sel.value = selected;
  }

  function renderSelects() {
    const sel = $("add-cat");
    const sig = state.categories.map((c) => c.id + c.name).join("|");
    if (sel.dataset.sig === sig) return;
    const cur = sel.value || store.get(K.lastcat(), null);
    sel.dataset.sig = sig;
    fillCats(sel, cur);
  }

  function renderBadges() {
    const open = todayTasks().length;
    const back = state.tasks.filter((t) => t.status === "backlog").length;
    const a = $("tab-today-n"), b = $("tab-tasks-n");
    a.textContent = String(open); a.hidden = !open;
    b.textContent = String(back); b.hidden = !back;
  }

  function render() {
    const active = document.activeElement;
    const wasNote = active && active.closest && active.closest(".note");
    const zone = wasNote && active.closest("[data-zone]");
    const zoneId = zone ? zone.dataset.zone : null;

    renderHero();
    renderLists();
    renderBacklog();
    renderSelects();
    renderBadges();

    // Po odškrtnutí zmizí prvek s fokusem – vrátíme ho do stejné sekce, ať klávesnice neztratí místo.
    if (wasNote && !document.contains(active)) {
      const next = zoneId && document.querySelector(`[data-zone="${zoneId}"] .note button`);
      (next || $("main")).focus();
    }
  }

  /* =====================================================================
     Zobrazení (mobil), toast, nabídka
     ===================================================================== */
  function setView(v) {
    ui.view = v;
    sessionStorage.setItem("stickies:view", v);
    $("app").dataset.view = v;
    document.querySelectorAll(".tab").forEach((t) => {
      if (t.dataset.view === v) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));

  let toastTimer = null;
  function toast(msg, undo, ms = 6000) {
    $("toast-msg").textContent = msg;
    const b = $("toast-undo");
    b.hidden = !undo;
    b.onclick = undo ? () => { hideToast(); undo(); } : null;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { $("toast").classList.remove("show"); }

  function closeMenu() { $("user-menu").hidden = true; $("user-btn").setAttribute("aria-expanded", "false"); }
  $("user-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $("user-menu").hidden;
    $("user-menu").hidden = !open;
    $("user-btn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".user")) closeMenu(); });
  $("logout").addEventListener("click", logout);
  $("local-dismiss").addEventListener("click", () => { sessionStorage.setItem("stickies:hide-local", "1"); $("local-note").hidden = true; });

  /* =====================================================================
     Přidání úkolu
     ===================================================================== */
  function openComposer(catId) {
    if (isMobile()) {
      document.body.classList.add("add-open");
      $("add-today").checked = ui.view === "today";
    }
    if (catId) $("add-cat").value = catId;
    $("add-text").focus();
    setTimeout(() => $("add-text").focus(), 60);   // pojistka pro iOS, kde se panel ještě vysouvá
  }
  function closeComposer() { document.body.classList.remove("add-open"); }

  $("fab").addEventListener("click", () => openComposer());
  $("scrim").addEventListener("click", closeComposer);
  $("composer-close").addEventListener("click", closeComposer);

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("add-text");
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (!state.categories.length) { closeComposer(); openCat(null); toast("Nejdřív vytvoř kategorii."); return; }

    const cid = $("add-cat").value;
    const today = $("add-today").checked;
    const cat = catById(cid);
    store.set(K.lastcat(), cid);
    commit((s) => {
      s.tasks.push({ id: uuid(), category_id: cid, text, status: today ? "today" : "backlog", done_at: null, pos: Date.now(), updated_at: nowIso() });
    }, today ? "Přidáno do dnešních priorit" : `Přidáno do „${cat.name}“`);
    input.value = "";
    if (isMobile()) closeComposer(); else input.focus();
  });

  if (window.visualViewport) {
    const fit = () => {
      const vv = window.visualViewport;
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      $("composer").style.bottom = gap ? gap + "px" : "";
    };
    window.visualViewport.addEventListener("resize", fit);
    window.visualViewport.addEventListener("scroll", fit);
  }

  /* =====================================================================
     Dialogy: úprava úkolu a kategorie
     ===================================================================== */
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
  });

  let editingId = null;
  function openEdit(id) {
    const t = taskById(id);
    if (!t) return;
    editingId = id;
    $("edit-text").value = t.text;
    fillCats($("edit-cat"), t.category_id);
    $("edit-dialog").showModal();
    $("edit-text").focus();
  }
  $("edit-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("edit-form").requestSubmit(); }
  });
  $("edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("edit-text").value.trim();
    if (!text) { $("edit-text").focus(); return; }
    const cid = $("edit-cat").value;
    commit((s) => { const t = s.tasks.find((x) => x.id === editingId); if (t) { t.text = text; t.category_id = cid; } });
    $("edit-dialog").close();
  });

  let editingCat = null;
  const swatches = $("swatches");
  COLORS.forEach((c) => swatches.append(h("label", { class: `swatch c-${c}`, title: COLOR_NAMES[c] },
    h("input", { type: "radio", name: "cat-color", value: c, "aria-label": COLOR_NAMES[c] }), h("span"))));

  function openCat(id) {
    editingCat = id;
    const c = id ? catById(id) : null;
    $("cat-title").textContent = c ? "Upravit kategorii" : "Nová kategorie";
    $("cat-name").value = c ? c.name : "";
    $("cat-error").textContent = "";
    $("cat-delete").hidden = !c;
    const color = c ? c.color : COLORS[state.categories.length % COLORS.length];
    swatches.querySelector(`input[value="${color}"]`).checked = true;
    $("cat-dialog").showModal();
    $("cat-name").focus();
  }

  $("cat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("cat-name").value.trim();
    const color = (swatches.querySelector("input:checked") || {}).value || "violet";
    if (!name) { $("cat-name").focus(); return; }
    if (state.categories.some((c) => c.id !== editingCat && c.name.toLowerCase() === name.toLowerCase())) {
      $("cat-error").textContent = "Kategorie s tímto názvem už existuje.";
      return;
    }
    if (editingCat) {
      commit((s) => { const c = s.categories.find((x) => x.id === editingCat); if (c) { c.name = name; c.color = color; } });
    } else {
      const id = uuid();
      commit((s) => { s.categories.push({ id, name, color, pos: Date.now(), updated_at: nowIso() }); });
      store.set(K.lastcat(), id);
      $("add-cat").value = id;
    }
    $("cat-dialog").close();
  });

  $("cat-delete").addEventListener("click", () => {
    const c = catById(editingCat);
    if (!c) return;
    const n = state.tasks.filter((t) => t.category_id === c.id).length;
    $("cat-dialog").close();
    commit((s) => {
      s.categories = s.categories.filter((x) => x.id !== c.id);
      s.tasks = s.tasks.filter((x) => x.category_id !== c.id);
    }, n ? `Kategorie „${c.name}“ smazána i s ${n} úkoly` : `Kategorie „${c.name}“ smazána`, 10000);
  });

  /* =====================================================================
     Klávesy, události prohlížeče
     ===================================================================== */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeComposer(); closeMenu(); return; }
    const t = e.target;
    const typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector("dialog[open]") && !$("app").hidden) {
      e.preventDefault();
      openComposer();
    }
  });

  document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (!$("app").hidden) render(); refresh(); } });
  window.addEventListener("online", () => { lastRefresh = 0; refresh(); });
  window.addEventListener("offline", () => setSync("offline"));
  setInterval(() => { if (!document.hidden && !$("app").hidden) { render(); if (ctx.mode === "remote") pull(); } }, 60000);

  /* =====================================================================
     Start
     ===================================================================== */
  async function boot() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    if (!REMOTE) {
      ctx = { mode: "local", uid: "local", email: "" };
      loadCache();
      if (needsSeed()) seedDefaults();
      showApp();
      return;
    }

    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });

    let session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch { /* offline */ }

    if (session) { await startRemote(session.user); return; }

    // Bez internetu a s vypršelým tokenem pustíme uživatele aspoň k uloženým datům.
    const last = store.get(K.last, null);
    if (last && !navigator.onLine) {
      ctx = { mode: "remote", uid: last.uid, email: last.email };
      loadCache();
      showApp();
      setSync("offline");
      return;
    }
    showLogin();
  }

  boot();
})();
