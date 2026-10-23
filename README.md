# 🍿 Filmavond – Tinder voor films

Kiezen welke film je met vrienden kijkt, zonder eindeloos discussiëren.

1. **Maak een sessie** – kies genres en/of losse films (of zoek eender welke film op IMDb) en hoeveel films er moeten overblijven (bv. 3).
2. **Deel de link** – via WhatsApp, de deelknop van je gsm of een QR-code.
3. **Iedereen swipet** – rechts = zin in ❤️, links = liever niet ✕, omhoog = superlike ⭐. Elke kaart heeft een poster en een link naar IMDb.
4. **Bekijk de uitslag** – films waar iedereen ja op zei staan bovenaan. Te veel matches of een gelijkstand? Start met één knop een **finale-ronde** met enkel die films.

Werkt in elke mobiele browser, geen app of account nodig. Pure HTML/CSS/JS zonder build-stap, dus perfect voor GitHub Pages.

## Online zetten met GitHub Pages

1. Zet de bestanden op de `main`-branch (merge deze branch).
2. Ga in je repo naar **Settings → Pages**.
3. Bij **Source** kies je *Deploy from a branch*, branch `main`, map `/ (root)` → **Save**.
4. Na een minuutje staat de site op `https://<jouw-gebruikersnaam>.github.io/film-avond-/`.

## Hoe komen de stemmen bij elkaar?

GitHub Pages kan zelf niets opslaan, daarom zijn er twee modi:

### Standaard: stemlinks (geen setup nodig)
- De hele sessie zit in de link zelf.
- Na het swipen krijgt elke vriend een knop **“Stuur mijn stemmen”** (of via WhatsApp). Die stuurt een stemlink naar jou.
- Open die stemlinks op het toestel waarop je de sessie maakte (liefst in dezelfde browser) → de uitslag wordt automatisch bijgewerkt. Je kunt stemlinks ook plakken via **“Stemlink plakken”** op de uitslagpagina.

### Optioneel: live modus met Firebase (gratis)
Dan komen de stemmen automatisch binnen en kan iedereen de uitslag live volgen. De links worden ook korter.

1. Ga naar <https://console.firebase.google.com> → **Project toevoegen**.
2. **Build → Realtime Database → Create database** (kies bv. regio `europe-west1`), start in *locked mode*.
3. Tab **Rules**, plak dit en klik **Publish**:
   ```json
   {
     "rules": {
       "sessions": {
         "$id": { ".read": true, ".write": true }
       }
     }
   }
   ```
4. Kopieer de database-URL (bv. `https://mijn-filmavond-default-rtdb.europe-west1.firebasedatabase.app`) en zet ze in `config.js`:
   ```js
   firebaseUrl: 'https://mijn-filmavond-default-rtdb.europe-west1.firebasedatabase.app',
   ```
5. Commit & push – klaar.

> Iedereen met een sessielink kan in die sessie stemmen; zet er dus geen gevoelige info in.

## Films & posters
- Een lijst van ±190 bekende films per genre staat in `movies.js` – voeg gerust je eigen favorieten toe (`[IMDb-id zonder "tt", titel, jaar, "genres"]`).
- Posters, acteurs en de IMDb-link worden in de browser opgehaald via de publieke zoekfunctie van IMDb en lokaal bewaard. Lukt dat niet, dan toont de kaart een gekleurde poster met de titel.

## Lokaal testen
```bash
python3 -m http.server 8000
# open http://localhost:8000
```
