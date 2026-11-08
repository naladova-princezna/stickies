# Stickies

Úkoly ve stylu sticky notes, navržené tak, aby se s nimi dobře pracovalo i při ADHD a dalších odlišnostech pozornosti. Kategorie jsou podstránky v boční liště, každý lístek má barvu své kategorie, každý úkol jde rozepsat na kroky, stránka **Dnes** doporučí podle energie a vytížení, kolik toho dnes zvládneš, a úkol můžeš dělat v režimu **Soustředění** s viditelným časovačem. Data každého uživatele jsou v **jednom souboru v jednom datovém repozitáři na GitHubu**. Přihlášení je jen jménem.

Statický web bez build kroku. Funguje i jako aplikace na mobilu.

## 1. Nasazení na GitHub Pages
1. Založ repozitář (např. `stickies`) a nahraj do něj obsah téhle složky (soubory musí být v kořeni).
2. **Settings → Pages**: Source `Deploy from a branch`, větev `main`, složka `/ (root)`.
3. Za minutu je web na `https://TVOJE-JMENO.github.io/stickies/`.

Tenhle repozitář je veřejný. Data v něm nejsou, ale `users.js` obsahuje tokeny (viz bezpečnost níže).

## 2. Datový repozitář a token (jednou)
1. Založ **soukromý** repozitář, např. `stickies-data` (Private, zaškrtni „Add a README file“).
2. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - *Repository access*: Only select repositories → jen `stickies-data`.
   - *Repository permissions → Contents*: **Read and write**. Nic dalšího.
   - Nastav platnost (např. 1 rok) a token zkopíruj.

## 3. Kam zapsat uživatele: soubor `users.js`
Na GitHubu otevři `users.js` v repozitáři s aplikací → tužka (Edit) a vyplň:

```js
window.STICKIES_REPO = "vlastnik/stickies-data";   // tvůj soukromý datový repozitář
window.STICKIES_USERS = {
  "magda": { token: ["github_pat_11ABCDE", "zbytek tokenu"] },
  "petr":  { token: ["github_pat_11KLMNO", "zbytek tokenu"] },
};
```
Pak *Commit changes*. Za minutu je to na webu.

**Token musí být rozdělený na dvě části** (uvozovky, čárka mezi nimi, rozdělit lze kdekoli uprostřed). GitHub totiž prohledává veřejné repozitáře a celý token v nich okamžitě sám zneplatní. Rozdělený token nepozná. Aplikace obě části před použitím spojí.

- Jméno piš malými písmeny, bez mezer a diakritiky. Při přihlášení na velikosti písmen nezáleží.
- Uživatel otevře stránku, napíše jen své jméno a vidí své úkoly. Žádné heslo ani nastavování.
- Každý má svůj soubor `data/<jméno>.json` (vytvoří se sám).
- Můžeš dát všem stejný token, nebo každému vlastní.
- Dokud v `users.js` nejsou žádní uživatelé, aplikace běží bez přihlášení jen v zařízení.

### Bezpečnost, upřímně
- **Rozdělení tokenu zabrání jen automatickému zneplatnění od GitHubu, ne čtení. `users.js` je veřejný, takže token v něm je vidět každému, kdo ten soubor otevře.** Kdo ho najde, může číst a měnit data v datovém repozitáři. Datový repozitář tím pádem není soukromý.
- Škodu to omezuje fine-grained token jen na jeden datový repozitář a jen s právem Contents. Nikdo se přes něj nedostane k tvým jiným repozitářům. Může ale úkoly přečíst nebo smazat. Historie commitů umožní data obnovit.
- Nedávej do aplikace nic, co nesmí vidět cizí člověk. Adresu webu nikde nezveřejňuj.
- Kdyby se token zneužil, na GitHubu ho zruš a vytvoř nový.
- Aplikace odmítne **veřejný** datový repozitář.
- Zvlášť pro citlivější lidi můžeš udělat zvlášť repozitář i token a v jejich řádku uvést `repo: "vlastnik/jiny-repozitar"`.
- Pokud někdy budeš chtít opravdové zabezpečení, je potřeba heslo (v1–v4 ho měly) nebo vlastní server.

### Jak ukládání funguje
- Změny se po 1,5 s uloží jako jeden commit. Historie commitů je záloha.
- Zařízení si změny stahují při návratu do aplikace a každých 45 s.
- Souběžné změny se sloučí po jednotlivých úkolech (vyhrává novější změna). Offline se pracuje normálně a odešle se po připojení.
- Smazané položky se v souboru drží 60 dní, aby se smazání přeneslo i na dlouho offline zařízení.
- V nabídce úložiště je záloha a načtení zálohy.

## 4. Jak se s tím pracuje
- **Dnes**: dnešní priority (nahoře karta **Teď**), hotovo dnes a **Stav dne**.
- **Zásobník**: všechny kategorie vedle sebe, **Vyber za mě**, v každé kategorii nejvýš 6 lístků a tlačítko pro zbytek.
- **Rutiny**: opakující se seznamy úkolů (viz níže).
- **Kategorie** v boční liště (na mobilu tlačítko *Kategorie*): vlastní stránka. Klávesa **N** otevře přidání úkolu.
- **Lístky jsou barevné podle kategorie**, i ty hotové (tlumeněji, s barevným pruhem).
- **Rozepsat / rozbalit**: každý úkol má tlačítko *Rozepsat*. Kroky se píšou rovnou na lístku (Enter = další krok), odškrtávají se a jdou sbalit. *Vložit šablonu kroků* dá čtyři startovní kroky. *Udělat z kroků samostatné úkoly* rozdělí úkol na nezávislé lehké úkoly (jde vrátit tlačítkem Zpět).

### Stav dne a doporučení
Zadáš energii a vytížení dne (rychle přes předvolby nebo posuvníkem). Aplikace spočítá kapacitu v bodech (lehký 1, střední 2, náročný 4) a řekne, kolik úkolů a jakých dnes dává smysl, co se ještě vejde a kdy je plán přeplněný. V zásobníku označí lístky, které se k dnešku hodí. Je to pomůcka, ne diagnóza. Konstanty se dají upravit v `plan.js` (`CFG`).

### Rutiny
Stránka **Rutiny** v menu je pro seznamy úkolů, které se ti čas od času opakují (třeba úklid bytu).
- **Nová rutina**: název, kategorie, jak často ti to má aplikace připomenout (ručně, týdně, po 2 týdnech, měsíčně…) a úkoly, každý na nový řádek. U prvního použití je tlačítko s hotovým příkladem *Úklid bytu*.
- **Přidat do úkolů** vloží všechny úkoly rutiny jako lístky do zvolené kategorie (do zásobníku). Co už z rutiny máš nehotové, se nepřidá podruhé.
- Když je rutina na řadě, nabídne ti to stránka **Dnes** (*Přidat do zásobníku* nebo *Zítra*). Nic se samo nepřidá, aby tě aplikace nezahltila.
- Rutiny jsou součástí dat uživatele a synchronizují se stejně jako úkoly. Smazání rutiny nesmaže úkoly, které z ní už vznikly. Smazání kategorie smaže i její rutiny.

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
| `users.js` | Seznam uživatelů a tokenů (vyplňuje správce) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline režim a instalace na mobil |
