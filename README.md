# Stickies

Úkoly ve stylu sticky notes, navržené tak, aby se s nimi dobře pracovalo i při ADHD a dalších odlišnostech pozornosti. Kategorie jsou podstránky v boční liště, každý lístek má barvu své kategorie, každý úkol jde rozepsat na kroky, stránka **Dnes** doporučí podle energie a vytížení, kolik toho dnes zvládneš, a úkol můžeš dělat v režimu **Soustředění** s viditelným časovačem. Data každého uživatele jsou v **databázi Supabase** a chrání je přihlášení (e-mail + heslo) a pravidla Row Level Security.

Statický web bez build kroku. Funguje i jako aplikace na mobilu.

## 1. Nasazení na GitHub Pages
1. Soubory jsou v kořeni repozitáře. **Settings → Pages**: Source `Deploy from a branch`, větev `main`, složka `/ (root)`.
2. Web běží na `https://TVOJE-JMENO.github.io/stickies/`.

## 2. Backend: Supabase
Projekt `stickies` (region eu-central-1). Adresa a **veřejný** (publishable) klíč jsou na začátku `cloud.js`. Ten klíč je určený do prohlížeče a sám o sobě k datům nedává přístup.

Schéma (viz migrace v Supabase):
- `user_data`: jeden řádek na uživatele (`user_id`, `data` jsonb, `rev`, `updated_at`). `data` má stejný tvar jako dřív `data/<jmeno>.json`.
- `user_data_history`: snapshot po každém uložení, posledních 300 verzí na uživatele (náhrada za historii commitů).
- `allowed_emails`: seznam e-mailů, které si smí vytvořit účet. Z aplikace není čitelná ani zapisovatelná.

### Přidání nového uživatele
V SQL Editoru ve Supabase: `insert into public.allowed_emails (email) values ('jmeno@example.com');` (malými písmeny). Pak si ten člověk v aplikaci klikne na **Vytvořit účet**, potvrdí e-mail a nastaví heslo.

### Jednorázové nastavení v Supabase (Authentication)
- **URL Configuration → Site URL**: adresa webu (https://naladova-princezna.github.io/stickies/). Bez toho míří odkazy z e-mailů jinam.
- **Sign In / Providers → Email**: ponech zapnuté potvrzování e-mailu. Registraci hlídá `allowed_emails`.
- Pro víc než pár e-mailů za hodinu si nastav vlastní SMTP (výchozí odesílání je silně omezené).

### Bezpečnost
- Každý uživatel vidí a mění jen svůj řádek (RLS: `user_id = auth.uid()`). Ostatní účty, anonymní přístup i klient při mazání dokumentu odmítá databáze.
- `rev` a `updated_at` nastavuje databáze, klient je podvrhnout nemůže.
- V repozitáři už nejsou žádné tokeny.
- Heslo drží Supabase Auth (hash), aplikace ho nikam neukládá.

### Jak ukládání funguje
- Změny se po 1,5 s uloží jako jeden zápis. Zápis je podmíněný číslem verze (`rev`), takže se nic nepřepíše naslepo.
- Zařízení si změny stahují při návratu do aplikace a každých 45 s.
- Souběžné změny se sloučí po jednotlivých úkolech (vyhrává novější změna). Offline se pracuje normálně a odešle se po připojení.
- Smazané položky se v datech drží 60 dní, aby se smazání přeneslo i na dlouho offline zařízení.
- V nabídce **Účet a záloha** je ruční záloha a načtení zálohy.
- Místní kopie dat ze starší verze (GitHub) se při prvním přihlášení na zařízení převezme a sloučí, takže se neztratí ani změny udělané offline.

## 4. Jak se s tím pracuje
- **Dnes**: dnešní priority (nahoře karta **Teď**), hotovo dnes a **Stav dne**.
- **Zásobník**: lístky jsou ve třech skupinách **Hoří deadline**, **Priorita** a **Počká**. Skupinu měníš výběrem přímo na lístku nebo v *Upravit úkol*. Nová skupina je vždy Počká. Uvnitř skupiny jsou nahoře lístky s nejbližším termínem, pak podle kategorie. Přepínač nahoře vrátí původní pohled po kategoriích. Je tu i **Vyber za mě** a v každé skupině nejvýš 8 lístků a tlačítko pro zbytek.
- **Rutiny**: opakující se seznamy úkolů (viz níže).
- **Vytisknout úkoly** (tlačítko ve spodu postranního panelu): vytiskne úkoly ze všech kategorií po kategoriích. Volitelně s kroky a s hotovými úkoly. V okně tisku jde zvolit uložení do PDF.
- **Přehled**: historie energie a vytížení, statistiky a odhad (viz níže).
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

### Přehled: historie energie, statistiky a odhad
Každý den, kdy zadáš **Stav dne** (energie a vytížení), se uloží do tvých dat jako jeden záznam. Chybějící den můžeš doplnit tlačítkem *Doplnit den* na stránce **Přehled**, špatný záznam upravit nebo smazat.

Co Přehled ukazuje:
- **Odhad na dnes a dalších 6 dní** (energie i vytížení s pravděpodobným rozmezím). Od 7 zadaných dnů. Ve Stavu dne je podle odhadu předvyplněno, dokud dnešek nezadáš. Rozhoduješ vždy ty.
- **Posledních 30 dní** v grafu a odhad tečkovaně.
- **Týdenní rytmus** (průměr podle dne v týdnu), od 14 dní.
- **Tvůj cyklus (experimentální)**: když se v datech zřetelně opakuje vzorec po 18–45 dnech, aplikace ho najde, ukáže, v které části právě jsi, a kdy čekat vyšší a nižší energii. Hledá se až od 35 zadaných dní. Volitelně můžeš označit začátek svého pravidelného cyklu (stačí 2×), odhad je pak přesnější.
- **Kolik zvládneš při jaké energii**: průměr splněných úkolů a bodů v pásmech nízké, střední a vysoké energie (od prvního splněného úkolu v aplikaci).

Jak odhad vzniká (kód je v `stats.js`, testy na umělých datech ověřují, že cyklus najde a že v šumu nebo při pomalém trendu cyklus nevymýšlí):
1. odečte se průměr a vliv dne v týdnu (zmenšený, když je dat málo),
2. ze zbytku se hledá opakování nebo se použijí tvoje označené začátky,
3. zbytky se složí podle pozice v cyklu a vyhladí,
4. odhad = průměr + den v týdnu + cyklus (zmenšený podle jistoty) + doznívající vliv posledních dní.

**Je to statistika z tvých vlastních záznamů, ne měření a ne zdravotní pomůcka.** Čím víc dní zadáš, tím lepší odhad. Nepravidelný život (nemoc, cestování, zkouškové) odhad zhorší. Když ti nesedí, ignoruj ho.

### Studium
Stránka **Studium** je studijní pomocník navržený tak, aby ses neztratila v povinnostech. Více studií vedle sebe (bakalářské, navazující, jiné).
- **Přehled** ukazuje nahoře jedinou věc, která je teď na řadě (**Hotovo**, **Soustředit se** ve Stickies, **Posunout termín**). Pod ní je na řadě pár dalších věcí, týdenní pás s termíny a výukou, postup ke státnicím (kredity, průměr), kolik věcí jsi splnila za 7 dní a předměty tohoto semestru. Nový uživatel dostane krátkého průvodce nastavením.
- **Termíny**: rychlé přidání jednou řádkou (text, předmět, termín jedním klepnutím, Enter), skupiny Dnes, Tento týden, Čeká na dořešení (klidná barva, žádná červená), Později, Bez termínu a Splněné. Každá skupina ukazuje jen pár položek, zbytek je za tlačítkem. Každá akce jde vrátit tlačítkem **Zpět**.
- **Předměty**: kompaktní seznam, který se po klepnutí rozbalí na podmínky. Filtr semestru a statutu, **Vložit víc najednou** (jeden předmět na řádek, zkratka a kredity jsou volitelné). Splněné předměty jsou sbalené.
- **Zápisy** z přednášek a cvičení, **Práce** (závěrečná práce, viz níže).

#### Práce: týdenní sprint na psaní
Sekce **Práce** (diplomová, bakalářská, disertační) je nástroj na to, aby se práce dala napsat v řádu dnů. Logika je v `diplomka.js` (bez DOM, jde spustit v Node), vykreslení v `studium.js`.
- **Harmonogram**: práce rozdělená do fází s daty a úkoly (tvorba, schůzka, testování, psaní, odeslání). Tlačítko **Nastavit plán na 4 týdny** spočítá fáze od dneška (zbytek týdne, pak tři týdny po sobě), nastaví sprint na fázi Psaní a ukazuje, která fáze právě běží a za kolik dní se odesílá vedoucí. U kapitol jde zapnout **Lze psát dřív** (nezávisí na modelech ani testování) a aplikace spočítá, kolik stran denně ušetříš ve fázi Psaní.
- **Sprint**: zadáš první a poslední den. Poslední den (od 4 dnů délky) je rezerva na revizi a odevzdání. Plán se pokaždé spočítá znovu z toho, co zbývá napsat, a rozloží se do zbývajících psacích dnů. Zameškaný den se nehromadí jako dluh, jen se mírně zvedne denní dávka. Dny jde označit jako **Volno**.
- **Dnes napsat**: jedna dávka stran a v které kapitole. Dávka v plánu se po zápisu stran snižuje, po překročení je dnešek hotový a zbytek se přerozdělí. Tempo nad 8 stran denně je označené jako náročné, nad 12 jako příliš vysoké (obě hranice jsou odhad, ne měření, konstanty `HARD` a `OVER` v `diplomka.js`). Žádné červené hlášky.
- **Zapsat stránky** přičte strany ke kapitole i do deníku psaní a jde vrátit tlačítkem Zpět.
- **Nevím, kde začít**: navrhne jeden malý krok (další nehotový oddíl rozpracované kapitoly). Bez časovače.
- **Kapitoly s oddíly**: každá má plánovaný rozsah, napsané strany, stav, poznámku a odškrtávací oddíly. **Vložit osnovu** nabídne obecné šablony (návrhová a ověřovací práce, teoretická práce) nebo vlastní text: kapitola na řádek, oddíly odsazené nebo s pomlčkou, rozsah na konci řádku třeba `(12)`. Šablony jsou obecné, uprav je podle své práce.
- **Parkoviště**: když při psaní chybí zdroj nebo obrázek, zapíšeš to a píšeš dál. Zaparkované věci jdou přiřadit ke kapitole.
- **Výstupy**: **Kostra do LaTeXu** (`\chapter`, `\section`, štítky, poznámky a parkoviště jako komentáře), **Brief pro Clauda** (osnova, stav, parkoviště a poslední konzultace jako text do chatu, u kapitoly zaměřený na ni) a **Vytisknout plán**.
- **Před odevzdáním**: obecný kontrolní seznam, který si upravíš podle pokynů své katedry.
- Nová pole jsou součástí `thesis` ve studiu (`sprint`, `log`, `parking`, `checklist`, u kapitol `target`, `note`, `sections`), starší data se při načtení doplní.
- Každý uživatel má **vlastní studia**, jsou součástí jeho souboru `data/<jméno>.json` (klíč `studies`) a synchronizují se stejně jako úkoly. Nový uživatel začíná s prázdnou stránkou a tlačítkem **Přidat studium**.
- **Tisk předmětů**: na stránce **Předměty** tlačítko *Vytisknout* vytiskne všechny předměty po semestrech: kód, název, kredity, statut, způsob ukončení a výsledek s datem. V okně tisku jde zvolit uložení do PDF.
- **Záloha a import**: *Nastavení a záloha* stáhne nebo zkopíruje všechna studia, a načte je zpět (i z jiného profilu).
- **Úkoly ze studia**: u studia (Upravit údaje o studiu) vybereš seznam, tedy kategorii Stickies. Podmínky předmětů a úkoly závěrečné práce se tam objeví jako lístky (výchozí jsou jen ty s termínem, jde zvolit všechny nesplněné). Odškrtnutí platí na obou místech. Termín lístku z předmětu jde změnit i ve Stickies (*Upravit úkol*, pole *Termín z předmětu*), propíše se do předmětu ve Studiu. Termín tam nejde smazat, protože lístky vznikají jen z podmínek s termínem (u režimu „všechny nesplněné“ ano). Změna názvu nebo termínu ve Studiu přepíše lístek, úpravy lístku se nevracejí, smazaný lístek se znovu nevytvoří. Splněný předmět a smazaná podmínka uklidí nesplněné lístky.
- Studium se zobrazuje v rámečku (`studium.html`, `studium.js`, `studium.css`). Slučuje se po studiích: při souběžné úpravě stejného studia na dvou zařízeních vyhrává novější uložení.
- Pozor: **známky a kredity jsou v datovém repozitáři** stejně jako úkoly. Platí vše z části o bezpečnosti výše.

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
| `plan.js` | Výpočet doporučení na dnes |
| `stats.js` | Statistiky a odhad energie |
| `studium.html`, `studium.js`, `studium.css` | Stránka Studium (studia, předměty, deadliny, zápisy, závěrečná práce) |
| `diplomka.js` | Logika sekce Práce: plán sprintu, osnova, zápis stran, LaTeX a brief |
| `cloud.js` | Přihlášení a ukládání dat na Supabase |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline režim a instalace na mobil |


