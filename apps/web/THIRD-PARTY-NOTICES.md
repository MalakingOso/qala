# Third-party notices (web shells)

Font binaries and OFL texts ship in `public/fonts/` (copied at scaffold
time; checksums in DESIGN.md 3.2):

- Qala Test (Bold V2 + Medium): the owner's face, an OFL 1.1 fork of
  Faustina with no Reserved Font Name. See `public/fonts/QalaTest-OFL.txt`.
- Faustina (variable wght fallback): OFL 1.1, google/fonts.
  See `public/fonts/Faustina-OFL.txt`.
- DM Mono (Regular + Medium): OFL 1.1, google/fonts, copied from Beamer.
  See `public/fonts/DMMono-OFL.txt`.

Runtime libraries (see `package.json` for versions):

- `lucide-react` (ISC) for all icons. Running uses `sport-shoe`.
- `@visx/*` (MIT) for every in-app chart.
- `uPlot` (MIT) for dense or zoomable time series.
- `codemirror` + `@codemirror/*` (MIT) for the desktop program editor.
- `react`, `react-dom` (MIT).

Map tiles at runtime come from self-hosted Protomaps PMTiles rendered with
MapLibre GL JS; elevation from Copernicus GLO-30 on the server. No Google,
no OSM public tile servers.
