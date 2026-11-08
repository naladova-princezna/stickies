(() => {
  "use strict";

  const COLORS = ["pink", "orange", "blue", "yellow", "green"];
  const DEFAULT_CATEGORIES = ["Práce", "Studium", "Domácnost", "Osobní"];
  const SESSION_KEY = "sticky-user";

  const $ = (id) => document.getElementById(id);
  const todayKey = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD

  let user = null;
  let state = { categories: [], tasks: [] };
  let editingId = null;

  /* ---------- Úložiště (per uživatel, v prohlížeči) ---------- */
  const storageKey = () => `sticky-data:${user.toLowerCase()}`;

  function load() {
    try {
      const raw = localStorage.getItem(storageKey());
      state = raw ? JSON.parse(raw) : null;
    } catch { state = null; }
    if (!state || !Array.isArray(state.tasks)) {
      state = { categories: [...DEFAULT_CATEGORIES], tasks: [] };
    }
  }
  function save() {
    localStorage.setItem(storageKey(), JSON.stringify(state));
  }

  /* ---------- Přihlášení ---------- */
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const findUser = (name) =>
    (window.USERS || []).find((u) => u.username.toLowerCase() === name.trim().toLowerCase());

  $("login-username").addEventListener("input", () => {
    const u = findUser($("login-username").value);
    $("login-password-wrap").classList.toggle("hidden", !(u && u.passwordHash));
  });

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("login-error");
    err.textContent = "";
    const u = findUser($("login-username").value);
    if (!u) { err.textContent = "Takový uživatel neexistuje."; return; }
    if (u.passwordHash) {
      const hash = await sha256($("login-password").value);
      if (hash !== u.passwordHash.toLowerCase()) { err.textContent = "Nesprávné heslo."; return; }
    }
    sessionStorage.setItem(SESSION_KEY, u.username);
    startApp(u.username);
  });

  $("logout-btn").addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  });

  function startApp(name) {
    user = name;
    load();
    $("login-view").classList.add("hidden");
    $("app-view").classList.remove("hidden");
    $("user-name").textContent = name;
    render();
  }

  /* ---------- Akce nad úkoly ---------- */
  const byId = (id) => state.tasks.find((t) => t.id === id);

  function addTask(text, category) {
    state.tasks.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      text, category, status: "backlog", doneAt: null,
    });
    save(); render();
  }
  function moveToToday(id) { const t = byId(id); if (t) { t.status = "today"; save(); render(); } }
  function moveToBacklog(id) { const t = byId(id); if (t) { t.status = "backlog"; save(); render(); } }
  function markDone(id) {
    const t = byId(id);
    if (t) { t.status = "done"; t.doneAt = todayKey(); save(); render(); }
  }
  function reopen(id) {
    const t = byId(id);
    if (t) { t.status = "today"; t.doneAt = null; save(); render(); }
  }
  function removeTask(id) {
    const t = byId(id);
    if (t && confirm(`Opravdu smazat úkol „${t.text}“?`)) {
      state.tasks = state.tasks.filter((x) => x.id !== id);
      save(); render();
    }
  }

  /* ---------- Vykreslení ---------- */
  const colorFor = (cat) => COLORS[Math.max(0, state.categories.indexOf(cat)) % COLORS.length];

  function btn(label, title, handler) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => { e.stopPropagation(); handler(); });
    return b;
  }

  function noteEl(task, mode) {
    const el = document.createElement("div");
    el.className = `note ${colorFor(task.category)}`;

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = task.text;
    el.append(text);

    if (mode !== "backlog") {
      const cat = document.createElement("div");
      cat.className = "cat";
      cat.textContent = task.category;
      el.append(cat);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    if (mode === "done") {
      el.classList.add("done");
      actions.append(btn("↩", "Vrátit do priorit", () => reopen(task.id)));
    } else {
      actions.append(btn("✓", "Hotovo", () => markDone(task.id)));
      if (mode === "today") actions.append(btn("↩", "Vrátit do kategorie", () => moveToBacklog(task.id)));
    }
    actions.append(
      btn("✎", "Upravit", () => openEdit(task.id)),
      btn("✕", "Smazat", () => removeTask(task.id))
    );
    el.append(actions);

    if (mode === "backlog") {
      el.classList.add("clickable");
      el.title = "Kliknutím přesunout do dnešních priorit";
      el.addEventListener("click", () => moveToToday(task.id));
    }
    return el;
  }

  function fill(container, items, mode, emptyText) {
    container.replaceChildren();
    if (!items.length) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = emptyText;
      container.append(p);
      return;
    }
    items.forEach((t) => container.append(noteEl(t, mode)));
  }

  function fillSelect(sel, selected) {
    sel.replaceChildren();
    state.categories.forEach((c) => {
      const o = document.createElement("option");
      o.value = o.textContent = c;
      sel.append(o);
    });
    if (selected && state.categories.includes(selected)) sel.value = selected;
  }

  function render() {
    const today = todayKey();
    fill($("today-list"), state.tasks.filter((t) => t.status === "today"), "today", "Zatím nic. Vyber úkol z kategorií níže.");
    fill($("done-list"), state.tasks.filter((t) => t.status === "done" && t.doneAt === today), "done", "Dnes ještě nic hotového.");

    const prev = $("add-category").value;
    fillSelect($("add-category"), prev);

    const wrap = $("categories");
    wrap.replaceChildren();
    state.categories.forEach((cat) => {
      const box = document.createElement("div");
      box.className = "category";

      const head = document.createElement("div");
      head.className = "category-head";
      const h = document.createElement("h3");
      h.textContent = cat;
      head.append(h);
      head.append(btn("🗑", "Smazat kategorii", () => removeCategory(cat)));
      box.append(head);

      const list = document.createElement("div");
      list.className = "notes";
      fill(list, state.tasks.filter((t) => t.status === "backlog" && t.category === cat), "backlog", "Prázdné");
      box.append(list);
      wrap.append(box);
    });
  }

  /* ---------- Kategorie ---------- */
  $("add-category-btn").addEventListener("click", () => {
    const name = (prompt("Název nové kategorie:") || "").trim();
    if (!name) return;
    if (state.categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      alert("Taková kategorie už existuje."); return;
    }
    state.categories.push(name);
    save(); render();
  });

  function removeCategory(cat) {
    const count = state.tasks.filter((t) => t.category === cat).length;
    const msg = count
      ? `Kategorie „${cat}“ obsahuje ${count} úkolů. Smazat kategorii i s úkoly?`
      : `Smazat kategorii „${cat}“?`;
    if (!confirm(msg)) return;
    state.categories = state.categories.filter((c) => c !== cat);
    state.tasks = state.tasks.filter((t) => t.category !== cat);
    save(); render();
  }

  /* ---------- Přidání a úprava ---------- */
  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("add-text").value.trim();
    if (!text || !state.categories.length) return;
    addTask(text, $("add-category").value);
    $("add-text").value = "";
    $("add-text").focus();
  });

  function openEdit(id) {
    const t = byId(id);
    if (!t) return;
    editingId = id;
    $("edit-text").value = t.text;
    fillSelect($("edit-category"), t.category);
    $("edit-dialog").showModal();
  }
  $("edit-cancel").addEventListener("click", () => $("edit-dialog").close());
  $("edit-form").addEventListener("submit", () => {
    const t = byId(editingId);
    const text = $("edit-text").value.trim();
    if (t && text) {
      t.text = text;
      t.category = $("edit-category").value;
      save(); render();
    }
  });

  /* ---------- Start ---------- */
  const remembered = sessionStorage.getItem(SESSION_KEY);
  if (remembered && findUser(remembered)) {
    startApp(remembered);
  } else {
    $("login-view").classList.remove("hidden");
  }
})();
