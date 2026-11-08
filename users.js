// Seznam povolených uživatelů – upravuj ručně a pushni na GitHub.
//
// Jen uživatelské jméno:
//   { username: "magda" }
//
// Volitelně i heslo (ukládá se jen SHA-256 otisk, ne heslo samotné).
// Otisk vygeneruješ v konzoli prohlížeče (F12):
//   crypto.subtle.digest("SHA-256", new TextEncoder().encode("mojeHeslo"))
//     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("")))
// a vložíš jako passwordHash:
//   { username: "jana", passwordHash: "ab12…" }
//
// POZOR: jde o statickou stránku, takže je to jen "zámek na dveře", ne skutečné zabezpečení.
// Každý, kdo otevře zdrojový kód, uvidí seznam jmen a otisků.

window.USERS = [
  { username: "magda" },
  { username: "host" }
];
