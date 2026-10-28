# Interaktivt linjekart for T-bane og trikk i Oslo

Et uavhengig konseptprosjekt inspirert av [m.dk](https://m.dk/en/) (Københavns Metro): ett interaktivt linjekart for
T-banen (linje 1–5) og trikken (12, 13, 15, 17, 18, 19), med kort per stopp og egne stoppesider som viser sanntidsavganger,
avvik, reiseplanlegger, severdigheter med gangavstand, tilgjengelighet, bytte til buss/tog/båt, nabostopp og bysykkel/sparkesykkel.
Bokmål og engelsk. Bygget etter Ruters designsystem (TID-font, farger, WCAG 2.1 AA).

Ikke en offisiell tjeneste fra Ruter eller Sporveien.

## Kom i gang

Krever Node 24 (portabel installasjon i `%LOCALAPPDATA%\Programs\nodejs` på denne maskinen).

```bash
npm install
npm run pipeline        # henter data fra Entur/OSM/Wikipedia → data/ (første gang ~5 min, deretter cache)
npm run layout:build    # bygger skjematisk kart fra content/layout/anchors.json → content/layout/oslo.json
npm run dev             # http://localhost:3000/nb/
npm run build           # statisk eksport til out/ (kjører layout-validering først)
```

Dev-serveren i Claude Code startes fra `.claude/launch.json` (port 3100).

## Datakilder

| Kilde | Bruk | Lisens |
|---|---|---|
| Entur Journey Planner v3 (`api.entur.io/journey-planner/v3/graphql`) | linjer, stoppsekvenser, geometri, reisetid, sanntidsavganger, avvik, reiseplanlegger, gangruter | NLOD |
| Entur Stoppestedsregister (`api.entur.io/stop-places/v1/read`) | tilgjengelighet per stoppested/plattform | NLOD |
| Entur Geocoder v3 | søk etter reisemål i reiseplanleggeren (param `q`) | NLOD |
| Entur Mobility v2 | bysykler og sparkesykler i sanntid | NLOD |
| OpenStreetMap via Overpass | severdigheter (én bbox-spørring for Oslo) | ODbL |
| Wikipedia / Wikidata | beskrivelse, bilde og engelsk navn på severdigheter | CC BY-SA |

Alle Entur-kall sender `ET-Client-Name` (fra `NEXT_PUBLIC_ET_CLIENT_NAME` i `.env.local`). Entur tillater CORS, så sanntid
hentes direkte fra nettleseren uten egen backend.

**Entur er kilde til sannhet for nettverket.** Stoppsekvenser bygges fra journey patterns som faktisk har avganger på åtte
sample-datoer de neste tre månedene (mønstre med under 5 % av hovedmønsterets avganger regnes som unntakskjøringer).
De vedlagte PDF-kartene (T-bane 2016, trikk 2025-12) er kun brukt som visuell referanse for det skjematiske kartet.
Per september 2026 betyr det for eksempel at linje 13 snur på Thune (Lilleakerbanen betjenes ikke i rutedataene).

## Struktur

```
scripts/pipeline/        datapipeline (Node 24 kjører .ts direkte)
  run.ts                 orkestrator: npm run pipeline [-- --step N | --from N] [--force]
  steps/01-lines         11 linjer + aktive serviceJourneys på sample-datoer
  steps/02-stations      sammenslåing til stasjoner (forelder-StopPlace), slugs, sekvenser, hub-minutter, geometri
  steps/03-accessibility NSR-tilgjengelighet (+ content/accessibility-overrides.json)
  steps/04-transfers     bytte til andre linjer innen 300 m
  steps/05-pois          severdigheter fra OSM, scoring, Wikipedia/Wikidata-berikelse, content/poi-overrides/<slug>.json
  steps/06-walk          gangtid/-avstand med Entur (≤ 1200 m)
  steps/08-emit          data/stations/<slug>.json + public/data/geometry.geojson
scripts/layout/
  build-from-anchors.ts  anchors.json → oslo.json (interpolerer stopp mellom ankre, auto-etiketter)
  validate.ts            layout ↔ Entur-data (feiler bygget ved avvik)
  render-preview.ts      SVG/PNG-forhåndsvisning uten nettleser (.cache/preview/)
  seed-from-geo.ts       alternativt utgangspunkt rett fra geografi
content/
  layout/anchors.json    håndlagte ankre, knekk og etikettoverstyringer – rediger denne for å endre kartet
  layout/oslo.json       generert layout som appen bruker
  i18n/{nb,en}.json      UI-tekster
  pois/landmarks.json    kuraterte landemerker (kobles til OSM eller Wikipedia)
  pois/osm-exclude.json  OSM-elementer som aldri skal vises (deler av større attraksjoner, dubletter, støy)
  poi-overrides/         kuraterte overstyringer per stopp (add/remove/patch/pin)
data/                    genererte data (committes, så bygget er offline)
src/app/[lang]/          /nb/ og /en/: kart, /stopp/<slug>/, /stopp/, /linje/<kode>/, /linje/
src/app/(root)/          / (språkvalg) og /dev/layout-editor (kun med NEXT_PUBLIC_LAYOUT_EDITOR=1)
src/components/map       SchematicMap (SVG, pan/zoom, lag), GeoMap (MapLibre), LayerToggles, StationSearch
src/components/live      DeparturesBoard/StatusBanner (StationLive), TripPlanner, MobilityWidget, LineStatusPanel
src/components/station   StationCard, PoiList (glidebryter 200–1200 m), StationMiniMap
```

## Severdigheter: slik kurateres de

Steg 05 kombinerer tre kilder og tre nivåer:

1. **Kuraterte landemerker** (`content/pois/landmarks.json`, ~90 stk.) – det som alltid skal vises når det er innen
   1200 m gange: Operahuset, Munch, Akershus festning, Holmenkollbakken, Frognerparken, Teknisk museum osv. Hvert
   landemerke kobles til et OSM-element (`osm`/`osmName`) eller får koordinater fra Wikipedia; `access` overstyrer
   gangmålet (f.eks. arenainngangen i Holmenkollen), `priority` 1–3 vekter rekkefølgen.
2. **OSM-kandidater** i tre nivåer: A = museer, attraksjoner, gallerier, teatre, utsiktspunkt, stadioner; B = parker,
   naturreservater og innsjøer med utstrekning; C = kirker og gudshus. Statuer, minnesmerker, universiteter, kinoer,
   hoteller og små plasser filtreres bort. Nivå B/C krever Wikipedia-omtale, og kirker vises bare når stoppet har få
   andre severdigheter. Deler av større attraksjoner og dubletter fjernes via `content/pois/osm-exclude.json`.
3. **Gangmål** = nærmeste kant av området (avgrensningsboks) eller `access`-punktet, aldri midtpunktet av en stor park.
   Gangtid beregnes med Entur; alt over 1200 m forkastes.

Rangering per stopp: poeng minus 1 per 100 m gange, slik at et nært lokalt mål slår et fjernere hovedlandemerke.
Maks 16 per stopp; glidebryteren i grensesnittet filtrerer videre (200–1200 m, standard 1200).

Per-stopp-justeringer legges i `content/poi-overrides/<slug>.json` (`remove`, `add`, `patch`, `pin`).

## Redigere det skjematiske kartet

1. Juster ankre og knekkpunkt i `content/layout/anchors.json` (koordinater før `offset`). Stasjoner uten anker fordeles
   jevnt langs den oktilineære banen mellom nærmeste ankre i linjens stoppsekvens.
2. `npm run layout:build && npm run layout:validate`
3. `node scripts/layout/render-preview.ts --labels all` og åpne `.cache/preview/preview.png`.

Alternativt: åpne `/dev/layout-editor` i dev-serveren, dra noder og knekkpunkt, «Kopier JSON» og lim inn i
`content/layout/oslo.json`. Merk at `layout:build` skriver over denne filen.

## Hosting

Statisk eksport (`out/`). Sett `NEXT_PUBLIC_BASE_PATH=/repo-navn` for GitHub Pages; tom for Vercel/Netlify/rotdomene.

### GitHub Pages

Prosjektet ligger i Playground-monorepoet, så det publiseres til et eget GitHub-repo via `scripts/publish-github.sh`:

1. Opprett et tomt, offentlig repo på GitHub (f.eks. `oslo-linjekart`) og slå på Pages med kilde **GitHub Actions**
   (Settings → Pages → Build and deployment → Source).
2. Sørg for at git kan pushe til GitHub fra denne maskinen (`gh auth login`, eller la Git Credential Manager logge
   deg inn ved første push).
3. Commit endringene i Playground-repoet, og kjør:

   ```bash
   scripts/publish-github.sh https://github.com/<bruker>/oslo-linjekart.git
   ```

   Skriptet eksporterer siste committede versjon av mappen (uten PDF-ene og `.claude/`, jf. `.gitattributes`) til
   `.publish/` med egen historikk og pusher til `main`. Workflowen i `.github/workflows/pages.yml` bygger med
   `NEXT_PUBLIC_BASE_PATH=/<repo-navn>` og deployer `out/`. Nettstedet havner på
   `https://<bruker>.github.io/oslo-linjekart/`.

Rene `<a>`-lenker (SVG-nodene i kartet) må bruke `withBase()` fra `src/lib/i18n.ts`; `next/link` legger på
basePath selv.
