/* Uživatelé aplikace – tady to vyplňuješ ty (správce).
   1) STICKIES_REPO = soukromý datový repozitář ve tvaru "vlastnik/stickies-data"
   2) každý uživatel = jedno jméno (malými písmeny, bez diakritiky a mezer) + jeho token.
   Úkoly se uloží do data/<jmeno>.json.
   POZOR: tenhle soubor je na webu veřejný, token v něm je vidět. Viz README. */
window.STICKIES_REPO = "vlastnik/stickies-data";
window.STICKIES_USERS = {
  "madlenka": { token: "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" },
  "vasek":  { token: "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" },
};
