# Stickies – úkoly ve stylu sticky notes

Webová aplikace pro GitHub Pages. Úkoly se synchronizují mezi zařízeními, aplikaci lze nainstalovat na mobil jako normální appku a funguje i offline.

## Co v balíčku je

| Soubor | K čemu |
|---|---|
| `index.html`, `style.css`, `app.js` | aplikace |
| `config.js` | adresa a klíč tvého Supabase projektu |
| `users.js` | přezdívky pro přihlášení (volitelné) |
| `supabase-setup.sql` | databáze a pravidla přístupu |
| `sw.js`, `manifest.webmanifest`, `icons/` | instalace na mobil, offline provoz |
| `vendor/supabase.js` | knihovna pro synchronizaci (oficiální, MIT, uložená lokálně) |

Bez vyplněného `config.js` aplikace funguje v **lokálním režimu**: bez přihlášení, úkoly jen v tomhle prohlížeči. Hodí se na vyzkoušení.

## Nastavení synchronizace (cca 10 minut, zdarma)

GitHub Pages umí jen statické soubory, takže potřebuješ databázi. Použil jsem Supabase, jeho bezplatný tarif na osobní použití stačí.

1. Na [supabase.com](https://supabase.com) založ účet a **New project**. Region zvol nejbližší (Frankfurt).
2. **SQL Editor → New query**, vlož obsah `supabase-setup.sql`, klikni **Run**.
3. **Authentication → Sign In / Providers → Email**: zapni *Email provider*, vypni **Confirm email** a vypni **Allow new users to sign up**. Registrace pak zůstane zavřená a účty zakládáš jen ty.
4. **Authentication → Users → Add user → Create new user**: zadej e-mail a heslo, zaškrtni *Auto Confirm User*. Takhle založ každého uživatele.
5. **Project Settings → API**: zkopíruj *Project URL* a klíč **anon / publishable** do `config.js`.
   Klíč `service_role` nikdy nevkládej.
6. Volitelně v `users.js` přiřaď uživatelská jména k e-mailům. Pak se lze přihlásit jménem místo e-mailu.

## Nasazení na GitHub Pages

1. Nahraj celou složku do repozitáře (soubory v kořeni).
2. **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
3. Za minutu běží na `https://<uživatel>.github.io/<repozitář>/`.

## Instalace na mobil

- **iPhone (Safari):** Sdílet → *Přidat na plochu*.
- **Android (Chrome):** menu ⋮ → *Nainstalovat aplikaci*.

## Jak to funguje a kde jsou hranice

- **Zabezpečení:** skutečné přihlášení zajišťuje Supabase (hesla, relace). Data chrání pravidla RLS v databázi, takže uživatel vidí jen své řádky, i kdyby upravil kód stránky. Anon klíč v `config.js` je veřejný záměrně, bez přihlášení k datům nepustí.
- **Sloučení změn:** při souběžné úpravě stejného úkolu na dvou zařízeních vyhraje poslední uložená změna. Pro osobní seznam to stačí, pro týmovou práci na jednom úkolu ne.
- **Offline:** změny se ukládají do fronty a odešlou se po obnovení připojení. Stav vidíš v pilulce vpravo nahoře.
- **Po odhlášení** se lokální kopie dat v daném zařízení smaže.
- **Nová verze aplikace:** při změně souborů zvyš `VERSION` v `sw.js`, ať si je mobily stáhnou.
- Pořadí lístečků se řídí časem přidání. Přetahování zatím není.

## Zkratky (počítač)

`N` – nový úkol · `Esc` – zavřít panel
