/* Night-panel colours for the canvas chart (uPlot). The SVG charts read the
 * same values from the --wash-* and --chart-night-* custom properties in
 * surfaces.css; a canvas needs concrete strings. The night panel is the same
 * dark in both themes, so nothing here follows the theme. */

export const NIGHT = {
  line: "#ffffff",
  teal: "#2dd4bf",
  fadeTop: "rgba(45, 212, 191, 0.26)",
  fadeBottom: "rgba(45, 212, 191, 0)",
  baseline: "rgba(255, 255, 255, 0.20)",
  axis: "rgba(255, 255, 255, 0.72)",
  ember: "#e0652b",
  ring: "#ffffff",
};
