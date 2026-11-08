# Stickies

Úkoly ve stylu sticky notes, navržené tak, aby se s nimi dobře pracovalo i při ADHD a dalších odlišnostech pozornosti. Kategorie jsou podstránky v boční liště, každý lístek má barvu své kategorie, každý úkol jde rozepsat na kroky, stránka **Dnes** doporučí podle energie a vytížení, kolik toho dnes zvládneš, a úkol můžeš dělat v režimu **Soustředění** s viditelným časovačem. Data každého uživatele jsou v **jednom souboru v soukromém repozitáři na GitHubu**.

Statický web bez build kroku. Funguje i jako aplikace na mobilu.

## 1. Nasazení na GitHub Pages
1. Založ repozitář (např. `stickies`) a nahraj do něj obsah téhle složky (soubory musí být v kořeni).
2. **Settings → Pages**: Source `Deploy from a branch`, větev `main`, složka `/ (root)`.
3. Za minutu je web na `https://TVOJE-JMENO.github.io/stickies/`.

Tenhle repozitář je veřejný. **Nejsou v něm žádná čitelná data ani tokeny.**

## 2. Datový repozitář a token (jednou)
1. Založ **soukromý** repozitář, např. `stickies-data` (Private, zaškrtni „Add a README file“).
2. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - *Repository access*: Only select repositories → jen `stickies-data`.
   - *Repository permissions → Contents*: **Read and write**. Nic dalšího.
   - Nastav platnost (např. 1 rok) a token zkopíruj.

## 3. Přidání uživatele (jméno + heslo, token se odemkne sám)
1. Otevři `https://…/pridat-uzivatele.html` (nebo ji otevři lokálně).
2. Zadej jméno, **dlouhé heslo** (aspoň 4 slova), `vlastnik/stickies-data` a token. Stránka vytvoří jeden řádek. Všechno se počítá jen v tvém prohlížeči.
3. Vlož řádek do `users.js` mezi složené závorky a nahraj změnu na GitHub Pages.
4. Uživateli předej jméno a heslo. Token nikdy.

Uživatel se přihlásí jménem a heslem a hned vidí svoje úkoly na jakémkoli zařízení. Nic nenastavuje. Každý má svůj soubor `data/<jméno>.json`. Dokud je `users.js` prázdný, aplikace běží bez přihlášení jen v zařízení a ručně se dá připojit repozitář (pro vyzkoušení).

### Bezpečnost, upřímně
- `users.js` je na webu veřejný. Token je v něm **zašifrovaný heslem uživatele** (PBKDF2 600 000 kol + AES-256-GCM). Slabé heslo se dá prolomit zkoušením offline, proto dlouhá fráze. Stránka na krátké heslo upozorní.
- Všichni uživatelé sdílejí **jeden token k jednomu repozitáři**. Kdo se přihlásí, technicky získá přístup i k cizím souborům. Oddělení uživatelů je organizační, ne bezpečnostní. Pro opravdu citlivá data použij pro každého zvlášť repozitář a token (v `pridat-uzivatele.html` zadáš jiný repozitář).
- Přihlášený token je uložený v prohlížeči zařízení. **Odhlásit se** ho z zařízení smaže spolu s místní kopií dat. Token jde kdykoli zrušit na GitHubu.
- Aplikace odmítne **veřejný** datový repozitář.
- Změna hesla = vytvořit nový řádek a nahradit ho v `users.js`. Pokud token přestane platit, aplikace ukáže „Token nefunguje“ a poradí požádat správce.

### Jak ukládání funguje
- Změny se po 1,5 s uloží jako jeden commit. Historie commitů je záloha.
- Zařízení si změny stahují při návratu do aplikace a každých 45 s.
- Souběžné změny se sloučí po jednotlivých úkolech (vyhrává novější změna). Offline se pracuje normálně a odešle se po připojení.
- Smazané položky se v souboru drží 60 dní, aby se smazání přeneslo i na dlouho offline zařízení.
- V nabídce úložiště je záloha a načtení zálohy.

## 4. Jak se s tím pracuje
- **Dnes**: dnešní priority (nahoře karta **Teď**), hotovo dnes a **Stav dne**.
- **Zásobník**: všechny kategorie vedle sebe, **Vyber za mě**, v každé kategorii nejvýš 6 lístků a tlačítko pro zbytek.
- **Kategorie** v boční liště (na mobilu tlačítko *Kategorie*): vlastní stránka. Klávesa **N** otevře přidání úkolu.
- **Lístky jsou barevné podle kategorie**, i ty hotové (tlumeněji, s barevným pruhem).
- **Rozepsat / rozbalit**: každý úkol má tlačítko *Rozepsat*. Kroky se píšou rovnou na lístku (Enter = další krok), odškrtávají se a jdou sbalit. *Vložit šablonu kroků* dá čtyři startovní kroky. *Udělat z kroků samostatné úkoly* rozdělí úkol na nezávislé lehké úkoly (jde vrátit tlačítkem Zpět).

### Stav dne a doporučení
Zadáš energii a vytížení dne (rychle přes předvolby nebo posuvníkem). Aplikace spočítá kapacitu v bodech (lehký 1, střední 2, náročný 4) a řekne, kolik úkolů a jakých dnes dává smysl, co se ještě vejde a kdy je plán přeplněný. V zásobníku označí lístky, které se k dnešku hodí. Je to pomůcka, ne diagnóza. Konstanty se dají upravit v `plan.js` (`CFG`).

## 5. Co v aplikaci pomáhá s ADHD (a proč)
| Potíž | Co aplikace dělá |
|---|---|
| Přehlcení množstvím úkolů | Dnes max. 5 lístků najednou, v kategoriích 6, zbytek za tlačítkem. Doporučený počet podle energie. Jeden sloupec, shora dolů. |
| Nevím, čím začít | Karta **Teď** s velkým *Začít soustředění*. **Vyber za mě** vybere vhodný úkol za tebe. |
| Těžko se rozjedu | Úkol jde rozepsat na malé kroky. První krok má zabrat pár minut. Režim soustředění nabízí „stačí 5 minut“. |
| Slepota k času | Soustředění s kruhovým odpočtem, časem v záložce prohlížeče a pípnutím na konci (jde vypnout). Po konci „Ještě 10 min“ nebo „Pauza 5 min“. |
| Rozhodovací paralýza | Rychlé předvolby energie a vytížení. Výchozí kategorie a náročnost se pamatují. |
| Myšlenky zapsat hned | Přidání úkolu zůstane otevřené, můžeš zapsat víc věcí za sebou. Kurzor zůstává ve vstupu. |
| Vina a stud | Žádné červené „po termínu“. Nehotové úkoly se přenášejí beze slova. Hlášky jsou laskavé. Smazání a většina akcí jde vrátit. |
| Dopamin | Odškrtnutí má drobnou oslavu (konfety) a kruh dokončení. Jde vypnout. |
| Smyslová citlivost | **Pohodlí a vzhled**: větší text, klidnější barvy, bez animací (respektuje i nastavení systému). |
| Ztracená rozepsaná věc | Rozepsaný text kroku se při synchronizaci nesmaže. |

Co aplikace **neumí**: připomínky a upozornění, když máš zavřené okno. To by vyžadovalo server.

## Soubory
| Soubor | K čemu |
|---|---|
| `index.html`, `style.css`, `app.js` | Aplikace |
| `plan.js` | Výpočet doporučení |
| `vault.js`, `users.js` | Šifrování tokenu a seznam uživatelů |
| `pridat-uzivatele.html` | Nástroj pro správce |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline režim a instalace na mobil |
