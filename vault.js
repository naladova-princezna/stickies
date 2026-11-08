/* Trezor pro přístupové údaje.
   Token k datovému repozitáři se do veřejného users.js nikdy nedává otevřeně.
   Zašifruje se heslem uživatele (PBKDF2-SHA256 + AES-256-GCM). Po zadání jména
   a hesla se token odemkne přímo v prohlížeči. Heslo nikam neodchází. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Vault = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const g = typeof globalThis !== "undefined" ? globalThis : self;
  const wc = g.crypto && g.crypto.subtle ? g.crypto : require("node:crypto").webcrypto;
  const ITER = 600000;

  const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt, iter) {
    const base = await wc.subtle.importKey("raw", new TextEncoder().encode(String(password).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return wc.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  /** Zašifruje objekt (např. {repo, token, path}) heslem. */
  async function seal(payload, password, iter = ITER) {
    const salt = wc.getRandomValues(new Uint8Array(16));
    const iv = wc.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, iter);
    const ct = await wc.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    return { v: 1, it: iter, s: toB64(salt), iv: toB64(iv), c: toB64(new Uint8Array(ct)) };
  }

  /** Odemkne záznam. Při špatném hesle vrátí null. */
  async function open(entry, password) {
    try {
      if (!entry || entry.v !== 1) return null;
      const key = await deriveKey(password, fromB64(entry.s), entry.it);
      const pt = await wc.subtle.decrypt({ name: "AES-GCM", iv: fromB64(entry.iv) }, key, fromB64(entry.c));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch { return null; }
  }

  return { seal, open, ITER };
});
