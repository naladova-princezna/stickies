// Přezdívky pro přihlášení (volitelné).
// Klíč = uživatelské jméno malými písmeny, hodnota = e-mail účtu založeného v Supabase.
// Do přihlášení jde zadat i přímo e-mail.
//
// Skutečný seznam povolených uživatelů drží Supabase (Authentication → Users).
// Tenhle soubor jen převádí jméno na e-mail, takže ho neposkytuje žádnou ochranu.
// Pokud je repozitář veřejný, e-maily tu uvidí každý. Klidně použij adresu určenou jen pro tuto aplikaci.

window.USERS = {
  "magda": "magda@example.com"
};
