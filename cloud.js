/* Stickies: přihlášení a ukládání dat na Supabase (bez knihoven, jen fetch).
   Klíč níže je VEŘEJNÝ (publishable) a je určený do prohlížeče. Data chrání přihlášení
   a pravidla Row Level Security v databázi: každý uživatel vidí jen svůj řádek. */
(function () {
  "use strict";
  const CFG = {
    url: "https://gytlowxithgdyihzwzly.supabase.co",
    key: "sb_publishable__lHILjUkev0NoTYtCIr87g_9mY0KgEG",
  };
  const SK = "stickies:auth";
  const REDIRECT = location.origin + location.pathname;

  class CloudError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  let sess = readSess();
  let refreshing = null;

  function readSess() { try { return JSON.parse(localStorage.getItem(SK)); } catch { return null; } }
  function setSess(s) {
    sess = s;
    try { s ? localStorage.setItem(SK, JSON.stringify(s)) : localStorage.removeItem(SK); } catch { /* plné úložiště */ }
  }
  function normSess(j) {
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      user: j.user ? { id: j.user.id, email: j.user.email } : (sess && sess.user) || null,
    };
  }

  async function req(path, { method = "GET", body, token, headers = {} } = {}) {
    let res;
    try {
      res = await fetch(CFG.url + path, {
        method,
        cache: "no-store",
        headers: {
          apikey: CFG.key,
          Authorization: "Bearer " + (token || CFG.key),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new CloudError(0, "Server je nedostupný. Zkontroluj připojení.");
    }
    let json = null;
    try { json = await res.json(); } catch { /* prázdná odpověď */ }
    if (!res.ok) {
      const msg = (json && (json.msg || json.message || json.error_description || json.error)) || res.statusText;
      throw new CloudError(res.status, msg);
    }
    return json;
  }

  async function refresh() {
    if (!sess || !sess.refresh_token) throw new CloudError(401, "Přihlášení vypršelo.");
    if (!refreshing) {
      refreshing = req("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: sess.refresh_token } })
        .then((j) => { setSess(normSess(j)); })
        .catch((e) => {
          // Jen když server token výslovně odmítl. Výpadek sítě session nemaže.
          if (e.status === 400 || e.status === 401 || e.status === 403) { setSess(null); throw new CloudError(401, "Přihlášení vypršelo."); }
          throw e;
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function token() {
    if (!sess) throw new CloudError(401, "Nejsi přihlášena.");
    if (sess.expires_at - Math.floor(Date.now() / 1000) < 60) await refresh();
    return sess.access_token;
  }

  async function authed(path, opts = {}) {
    let t = await token();
    try {
      return await req(path, { ...opts, token: t });
    } catch (e) {
      if (e.status === 401) { await refresh(); return req(path, { ...opts, token: sess.access_token }); }
      throw e;
    }
  }

  /* ---------- přihlášení ---------- */
  async function signIn(email, password) {
    const j = await req("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
    setSess(normSess(j));
    return sess;
  }

  /** Vrací { confirm: true }, když je potřeba potvrdit e-mail. */
  async function signUp(email, password) {
    const j = await req("/auth/v1/signup?redirect_to=" + encodeURIComponent(REDIRECT), { method: "POST", body: { email, password } });
    if (j && j.access_token) { setSess(normSess(j)); return { session: sess }; }
    return { confirm: true };
  }

  async function resetPassword(email) {
    await req("/auth/v1/recover?redirect_to=" + encodeURIComponent(REDIRECT), { method: "POST", body: { email } });
  }

  async function setPassword(password) {
    await authed("/auth/v1/user", { method: "PUT", body: { password } });
  }

  async function signOut() {
    const t = sess && sess.access_token;
    setSess(null);
    if (t) { try { await req("/auth/v1/logout", { method: "POST", token: t }); } catch { /* odhlášeno aspoň lokálně */ } }
  }

  /** Odkaz z e-mailu (potvrzení, nové heslo) přijde jako #access_token=… */
  function consumeHash() {
    const h = location.hash.replace(/^#/, "");
    if (!/(^|&)access_token=/.test(h)) {
      const q = new URLSearchParams(h);
      if (q.get("error_description")) { history.replaceState(null, "", location.pathname + location.search + "#/dnes"); return { error: q.get("error_description").replace(/\+/g, " ") }; }
      return null;
    }
    const q = new URLSearchParams(h);
    const at = q.get("access_token");
    let uid = null, email = null;
    try {
      const p = JSON.parse(atob(at.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      uid = p.sub; email = p.email;
    } catch { /* neplatný token */ }
    if (!uid) return null;
    setSess({
      access_token: at,
      refresh_token: q.get("refresh_token"),
      expires_at: Number(q.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(q.get("expires_in") || 3600),
      user: { id: uid, email },
    });
    history.replaceState(null, "", location.pathname + location.search + "#/dnes");
    return { type: q.get("type") || "" };
  }

  /* ---------- data ---------- */
  async function getDoc() {
    const rows = await authed("/rest/v1/user_data?select=rev,data&limit=1");
    return rows && rows.length ? { rev: rows[0].rev, data: rows[0].data } : null;
  }

  /** expectedRev = null znamená, že řádek ještě neexistuje. Vrací { rev } nebo { conflict: true }. */
  async function putDoc(data, expectedRev) {
    const uid = sess.user.id;
    try {
      if (expectedRev == null) {
        const rows = await authed("/rest/v1/user_data", { method: "POST", body: { user_id: uid, data }, headers: { Prefer: "return=representation" } });
        return { rev: rows[0].rev };
      }
      const rows = await authed(`/rest/v1/user_data?user_id=eq.${uid}&rev=eq.${expectedRev}`, { method: "PATCH", body: { data }, headers: { Prefer: "return=representation" } });
      return rows && rows.length ? { rev: rows[0].rev } : { conflict: true };
    } catch (e) {
      if (e.status === 409) return { conflict: true };
      throw e;
    }
  }

  window.StickiesCloud = {
    CloudError, signIn, signUp, resetPassword, setPassword, signOut, consumeHash, getDoc, putDoc,
    session: () => sess,
  };
})();
