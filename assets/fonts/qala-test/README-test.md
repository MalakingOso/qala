# Qala Test v1 (test family, NOT for the app)

Renamed fork of Faustina (OFL, no reserved name) for trying a
Scala/Quadraat intersection at Qala title sizes. Nothing here is wired
into the app.

## Files

- QalaTest-Medium.ttf / .woff2 (static 500)
- QalaTest-Bold.ttf / .woff2 (static 700)
- OFL.txt (Faustina license, applies to this fork)
- work/ : sources, build_v1.py, check_v1.py, reference statics

## v1 changes vs Faustina

- Renamed family to "Qala Test" (Medium/Bold).
- Lowercase a-z plus composites built on them (170 glyphs) narrowed
  halfway toward Alegreya: x0.987 at 500, x0.970 at 700.
- Caps, figures, spacing, and serif cuts untouched. Roman only, no italic.
- GPOS kerning left unscaled (off by a unit or two on narrowed pairs).

## View

Open /tmp/qala-type-specimen.html (section D). Needs the qala-font/
folder next to it, plus internet for the Google Fonts rows.

## v2 (detail round 1, Bold only)

- QalaTestV2-Bold.ttf / .woff2.
- 9 corner points moved y-only on n (5), l (3), a (1): serif wedges
  unified from 10-12deg to ~15deg. Advances, bearings, stems untouched.
- H kept as the unchanged reference; all other glyphs still v1 shapes.
- work/detail_round1.py applies the cuts; work/overlay-round1.png shows them.

## Next dials

More glyphs, full narrowing, x-height, Medium cuts, variable vs statics.
