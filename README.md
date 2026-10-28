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
         "$id": {
           ".read": true,
           "meta": {
             ".write": "!data.exists()",
             ".validate": "newData.hasChildren(['i', 'f', 't'])",
             "v": { ".validate": "newData.isNumber()" },
             "i": { ".validate": "newData.isString() && newData.val().length <= 20" },
             "n": { ".validate": "newData.isString() && newData.val().length <= 100" },
             "h": { ".validate": "newData.isString() && newData.val().length <= 60" },
             "t": { ".validate": "newData.isNumber()" },
             "p": { ".validate": "newData.isNumber()" },
             "l": { ".validate": "newData.isNumber()" },
             "f": {
               ".validate": "newData.hasChildren()",
               "$n": {
                 ".validate": "$n.length <= 2 && ((newData.isString() && newData.val().length <= 12) || newData.hasChildren(['0', '1']))",
                 "0": { ".validate": "newData.isString() && newData.val().length <= 12" },
                 "1": { ".validate": "newData.isString() && newData.val().length <= 200" },
                 "2": { ".validate": "newData.isNumber()" },
                 "$x": { ".validate": "$x === '0' || $x === '1' || $x === '2'" }
               }
             },
             "$other": { ".validate": false }
           },
           "votes": {
             "$k": {
               ".write": true,
               ".validate": "$k.length <= 60 && newData.hasChildren(['name', 'v']) && newData.child('name').isString() && newData.child('name').val().length <= 40 && newData.child('v').isString() && newData.child('v').val().length <= 100 && newData.child('v').val().matches(/^[012]+$/)",
               "k": { ".validate": "newData.isString() && newData.val().length <= 60" },
               "at": { ".validate": "newData.isNumber()" },
               "name": { ".validate": true },
               "v": { ".validate": true },
               "$other": { ".validate": false }
             }
           }
         }
       }
     }
   }
   ```
   Zo kan een sessie na het aanmaken niet meer gewijzigd worden, kan niemand de lijst met alle sessies opvragen en worden enkel geldige stemmen aanvaard.
4. Kopieer de database-URL (bv. `https://mijn-filmavond-default-rtdb.europe-west1.firebasedatabase.app`) en zet ze in `config.js`:
   ```js
   firebaseUrl: 'https://mijn-filmavond-default-rtdb.europe-west1.firebasedatabase.app',
   ```
5. Commit & push – klaar.

> De database-URL staat in `config.js` en is dus publiek: iedereen met een sessielink kan in die sessie stemmen of stemmen verwijderen. Zet er geen gevoelige info in.

## Films & posters
- Een lijst van ±190 bekende films per genre staat in `movies.js` – voeg gerust je eigen favorieten toe (`[IMDb-id zonder "tt", titel, jaar, "genres"]`).
- De QR-code wordt gemaakt met [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, © Kazuhiko Arase), meegeleverd in `vendor/`.
- Posters, acteurs en de IMDb-link worden in de browser opgehaald via de publieke zoekfunctie van IMDb en lokaal bewaard. Lukt dat niet, dan toont de kaart een gekleurde poster met de titel.

## Lokaal testen
```bash
python3 -m http.server 8000
# open http://localhost:8000
```
