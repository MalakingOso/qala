# Visual refinement

Working review, 2026-09-13. This records the visual directions considered,
implementation decisions, and remaining recommendations. `DESIGN.md` remains
the reference for the product's interaction and chart rules.

## Direction

Three approaches fit Qala:

| Approach | What changes | Tradeoff |
| --- | --- | --- |
| Quiet editorial | More whitespace, clear serif headings, subdued framing, one dominant action, charts treated as figures in a training journal. | Long technical screens still need compact tables. |
| Compact instrument panel | Tight grids, small labels, lots of metrics above the fold, a persistent navigation column. | Useful on desktop, but carries the current density problem onto the phone. |
| High-contrast training cards | Strong outlines, large offset shadows, accent blocks around the next exercise. | Easy to scan mid-set, but exhausting when every chart and control gets the same treatment. |

Recommendation: use the quiet editorial direction as the foundation, a full-height
navigation column on desktop, and the stronger treatment for the current workout
action. Keep Qala Test, DM Mono, the ember action color, and the existing chart
palettes. Hierarchy and spacing need the work.

The owner's follow-up explicitly permits changing the original visual rules and
chart implementation to get a smoother, professional result. This pass therefore
replaces heavy 2px component frames and hard offset shadows with 1px borders,
6/10/12px radii, and soft, low-opacity shadows. The interface should feel like a
finished application rather than a collection of review mockups.

## Initial audit

- Cards, inner cards, stat tiles, and chart wrappers all compete with each other.
  Today puts a full chart card inside half of an already narrow hero card.
- Desktop uses a small floating navigation box and little distinction between
  page headings, card headings, and annotations. The landing page is constrained
  to the phone's width even on a large screen.
- Most controls have 44-52px targets, but the forms still inherit browser input
  styling. Several rows and tables lack narrow-screen containment.
- Chart headings and their ember "Table" links compete with primary actions.
  A broad chart text rule overrides the intended Qala typeface for the readiness
  number. A chart-fix commit landed during this audit and already corrected the
  readiness arc origin and introduced pixel-sized weekly-load and ring drawings;
  this pass builds on that work.
- The Today heading mixes date, block, and week into one string. Top-set weight,
  recommendation, readiness, and duration don't have a clear reading order.
- The landing page's "How it decides" hash collides with the app's hash router.
- The dark theme inherits a light-theme button hover color, and focus and
  reduced-motion treatments need to be consistent across shared controls.

## Implementation plan

1. Establish a consistent spacing scale, quieter internal dividers, larger page
   headings, and theme-aware form controls. Keep outer surfaces structured and
   reserve subtle shadows for the hero and primary action.
2. Give desktop a proper branded sidebar, generous content gutters, a restrained
   header, and responsive navigation. Group headline statistics into one strip.
3. Give the landing page a wide editorial layout with an actual training preview,
   concise feature descriptions, and working entry points to both shells.
4. Recompose Today and Plan for the phone. Separate metadata from titles, give
   the top set its own typographic emphasis, and remove nested chart borders.
5. Refine the readiness drawing and make chart/table headers calm, aligned, and
   usable at narrow widths. Contain wide tables instead of widening the page.
6. Inspect desktop and phone routes in a browser, including dark mode, narrow
   widths, chart/table toggles, navigation, and form controls. Run the web build
   and existing tests.

## Implemented

- Desktop has a full-height sidebar, a workspace toolbar, larger page headings,
  a wider responsive content area, one aligned statistics strip, and in-place
  Settings. Narrow windows use an explicit navigation toggle.
- Cards have softer corners and lighter frames. Nested chart borders are removed,
  supporting controls are neutral, and form controls share light/dark styling.
- Today separates date/block metadata, the day title, the top set, and its reason.
  The workout action appears before the charts. Readiness and weekly load are
  available in an expandable section, at the full stage-card width.
- Plan uses an open day strip with a clear selected underline. Coach has a
  constrained composer above the safe-area-aware tab bar.
- The landing page uses a wide two-column composition with a real weekly-load
  chart. Its section link scrolls without interfering with hash routing.
- Trend charts are drawn at their measured width. Monotone interpolation passes
  through the recorded samples without introducing peaks between observations.
  Sample markers and tested 1RM diamonds remain visible. Hover, focus, and touch
  expose the original values.
- Muscle bars have fixed-size labels, reserved gutters, rounded data ends, and
  consistent row heights. Time and intensity labels live in wrapping HTML
  legends instead of being squeezed beneath individual bar segments.
- Dense uPlot charts resize with the workspace, use monotone curves, respond to
  theme changes, and remount after chart/table toggles. Missing samples remain
  gaps.
- Run detail gives pace, heart rate, and elevation their own scales, with
  synchronized time cursors and zoom. Lift details pair volume targets and
  calibration in a desktop grid.
- SVG sizing uses a small ResizeObserver-backed component. This keeps plots in
  normal flow, avoids the absolute clipping wrappers found during screenshot
  inspection, and handles charts revealed inside Today's disclosure.
- Chart/table controls have quieter styling and descriptive accessible names.
  Wide tables scroll inside their container.
- Route changes return to the top of the new screen, rather than carrying a
  scrolled Settings position into the next page.

## Verification

The existing test suite passes: 222 tests. The web production build and lint of
the changed TypeScript files pass.

Chromium checks cover 68 route/width combinations: desktop at 1440, 1024, and
390px, and the phone shell at 390 and 320px. The final sweep found no horizontal
page overflow, overlapping SVG labels, clipped chart text, or browser exceptions
in those combinations. Initial findings were fixed: weekday axis labels needed
more bottom space, and the workout RPE row needed to wrap at 320px.

Interaction checks also cover chart/table toggles, canvas remounts, live resize,
theme changes, focused trend tooltips, run cursor synchronization and drag zoom,
the narrow desktop menu, Today's expanded charts, Plan day/detail tabs, Coach's
composer, and the landing-page section link. Screenshots were inspected for the
desktop overview, lifts, run details, editor, landing page, Today, Plan, and
Coach, including dark-mode lifts, run charts, and the editor. Device testing
remains a separate step.

## Recommendations for the next UI pass

1. Add real date-range controls and previous-period comparisons to the desktop
   workspace when its data queries support them. Avoid decorative filters that
   leave the plotted data unchanged.
2. Move fixture-backed display values onto the same data source as the selected
   session or Plan day. For example, the existing Plan detail cards currently
   reuse the active workout's exercises across lifting days. Visual polish
   makes that inconsistency more noticeable.
3. Give new-user, empty, loading, and offline states the same hierarchy as the
   populated screens. One clear next action should replace an empty dashboard.
4. Validate the phone flow on the actual device, including the open keyboard,
   large system text, outdoor visibility, and run controls during a recording.
5. Keep smooth interpolation limited to a drawing choice. The observed values,
   missing-data gaps, and table views should continue to show the original data.
