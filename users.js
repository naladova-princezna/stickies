/* Uživatelé aplikace – tady to vyplňuješ ty (správce).
   1) STICKIES_REPO = soukromý datový repozitář ve tvaru "vlastnik/stickies-data"
   2) každý uživatel = jedno jméno (malými písmeny, bez diakritiky a mezer) + jeho token
      ROZDĚLENÝ NA DVĚ ČÁSTI (GitHub by jinak token v tomhle veřejném souboru sám zneplatnil).
      Rozděl ho kdekoli uprostřed, např. po prvních 15 znacích.
   Úkoly se uloží do data/<jmeno>.json. */
window.STICKIES_REPO = "vlastnik/stickies-data";
window.STICKIES_USERS = {
  "madlenka": { token: ["github_pat_11BT75", "4DI0DbfGCjByMbwz_igTwlQWM8oQf6vBNlh3dM4i23tymXA9loP9ltnoaR8Q4OBXN3XDoU3HBvhE"] },
  "vasek":  { token: ["github_pat_11BT75", "4DI0gzq5L2jZyjUQ_aTJFzDKmr7AN3AVIdZMxdVk96vOg5IuBq2954X7PVXTP6KC22MQc1PFc8Mm"] },
};
