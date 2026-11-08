# Stickies

Úkoly ve stylu sticky notes. Kategorie jsou podstránky v boční liště, stránka **Dnes** ti podle energie a vytížení doporučí, kolik úkolů a jakých dnes zvládneš, a náročné úkoly pomůže rozepsat na kroky. Data se ukládají do **soukromého repozitáře na GitHubu**, takže jsou na všech tvých zařízeních. Funguje jako aplikace na mobilu (PWA).

Je to statický web bez build kroku: `index.html`, `style.css`, `plan.js`, `app.js`, `sw.js`.

## 1. Nasazení na GitHub Pages

1. Založ repozitář (např. `stickies`) a nahraj do něj obsah téhle složky (soubory musí být v kořeni).
2. **Settings → Pages → Build and deployment**: Source `Deploy from a branch`, větev `main`, složka `/ (root)`.
3. Za minutu je web na `https://TVOJE-JMENO.github.io/stickies/`.

Tenhle repozitář může být veřejný, **nejsou v něm žádná tvoje data ani hesla**.

## 2. Úložiště pro data (jednou, pak na každém zařízení)

Data jsou jeden JSON soubor v **jiném, soukromém** repozitáři.

1. Na GitHubu založ nový repozitář, např. `stickies-data`, nastav **Private** a zaškrtni „Add a README file“.
2. **Settings (tvůj účet) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - *Repository access*: **Only select repositories** → vyber jen `stickies-data`.
   - *Permissions → Repository permissions → Contents*: **Read and write**. Nic dalšího.
   - Nastav rozumnou platnost (např. 1 rok). Token zkopíruj, GitHub ho ukáže jen jednou.
3. V aplikaci klepni na stav úložiště (vlevo dole, na mobilu vpravo nahoře), zadej `vlastnik/stickies-data` a token, **Připojit**.
4. Na dalším zařízení udělej totéž. Výchozí kategorie se nezdvojí, nové zařízení si vezme to, co už v repozitáři je.

Aplikace odmítne připojit **veřejný** repozitář, aby se data omylem neprozradila.

### Jak ukládání funguje
- Změny se po chvíli (1,5 s) uloží jako jeden commit souboru `stickies-data.json`. Historie commitů je zároveň záloha.
- Zařízení si změny stahují při návratu do aplikace a každých 45 s.
- Pokud dvě zařízení změní soubor současně, aplikace oba stavy **sloučí po jednotlivých úkolech** (vyhrává novější změna daného úkolu) a zápis zopakuje. Nic se neztratí, pokud jste neupravovali tentýž úkol.
- Offline pracuješ normálně, změny se odešlou, jakmile se připojíš.
- Smazané položky se v souboru drží 60 dní jako „náhrobky“, aby se smazání přeneslo i na zařízení, které bylo dlouho offline.
- V nabídce úložiště je **Stáhnout zálohu** a **Načíst zálohu** (sloučí se s existujícími daty).

### Bezpečnost, upřímně
- Token je uložený v prohlížeči na každém zařízení (localStorage). Kdo má přístup k tvému odemčenému zařízení, může ho přečíst. Proto má mít jen právo k jednomu repozitáři a dá se kdykoli zrušit (GitHub → Settings → Developer settings). Při ztrátě zařízení token zruš.
- Žádné jiné přihlášení aplikace nemá. Kdo nemá token, data nepřečte, protože jsou v soukromém repozitáři.
- Tohle **není** vícenásobné přihlášení pro více lidí. Je to jedno úložiště pro jednoho uživatele na více zařízeních.

## 3. Jak se s tím pracuje

- **Dnes**: vlevo dnešní priority a hotovo dnes, vpravo **Stav dne**.
- **Zásobník**: všechny kategorie vedle sebe. Klepnutí na lístek ho přesune na dnes.
- **Kategorie** (boční lišta, na mobilu tlačítko *Kategorie*): vlastní stránka s dnešními úkoly, zásobníkem a archivem splněného. Přidání, úprava a smazání kategorie je v liště a v záhlaví stránky.
- Každý úkol: ✓ hotovo, ✎ úprava, 🗑 smazání (s tlačítkem Zpět). Klávesa **N** otevře přidání úkolu.
- Náročnost úkolu: **Lehký / Střední / Náročný**.

### Stav dne a doporučení
Zadáš **energii** (0–100 %) a **vytížení dne** (kolik dne už zabírají pevné závazky: schůzky, výuka, cestování, povinnosti). Aplikace spočítá kapacitu v bodech (lehký 1 b, střední 2 b, náročný 4 b) a řekne, kolik úkolů a jakých dnes dává smysl. Porovná to s tím, co máš naplánované:
- **„Ještě se vejde: …“** a v zásobníku se čárkovaně orámují lístky, které se k tomu hodí (*Sedí na dnes*).
- **Přeplánováno** → upozornění a výzva, co odložit.
- **Náročný úkol bez kroků** má na lístku výzvu *Rozepiš ho na kroky*. V úpravě je tlačítko **Vložit šablonu**. Kroky se odškrtávají přímo na lístku.

Je to **pomůcka, ne diagnostika**. Opírá se o běžné zásady plánování: energie je omezený zdroj, náročná práce patří na chvíle s nejvyšší energií, rozpracovaných priorit má být málo (max. 5, při plném dni 3), velký úkol je snazší začít po krocích a plánuje se zhruba na 70 % kapacity. Když ti čísla nesedí, uprav konstanty nahoře v `plan.js` (`CFG`): váhy úkolů, maximální kapacitu, od kolika % energie se doporučují náročné úkoly apod.

## Soubory
| Soubor | K čemu |
|---|---|
| `index.html`, `style.css` | Rozhraní |
| `app.js` | Aplikace, trasy, ukládání a synchronizace |
| `plan.js` | Výpočet doporučení (bez závislostí, jde testovat v Node) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline režim a instalace na mobil |

## Instalace na mobil
Otevři web v Chrome (Android) nebo Safari (iPhone) → *Přidat na plochu*.
