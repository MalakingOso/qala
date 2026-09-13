// GPX 1.1 exporter with Garmin TrackPointExtension (HR, cadence).
// No FIT: Garmin's SDK licence forbids source-disclosure licences (PLAN 8a).

import type { FilteredPoint } from "./types.ts";

export interface GpxOptions {
  name?: string;
  /** Epoch milliseconds of t = 0; point times are startTimeMs + t * 1000. */
  startTimeMs: number;
  points: FilteredPoint[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtCoord(v: number): string {
  return v.toFixed(7);
}

/** Serialise a run to a GPX 1.1 string. */
export function exportRunGpx(opts: GpxOptions): string {
  const name = esc(opts.name ?? "Qala run");
  const startIso = new Date(opts.startTimeMs).toISOString();
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="Qala" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">`,
    `  <metadata><name>${name}</name><time>${startIso}</time></metadata>`,
    `  <trk><name>${name}</name><type>running</type><trkseg>`,
  ];
  for (const p of opts.points) {
    const time = new Date(opts.startTimeMs + p.t * 1000).toISOString();
    lines.push(
      `    <trkpt lat="${fmtCoord(p.lat)}" lon="${fmtCoord(p.lon)}">` +
        (p.ele !== undefined ? `<ele>${p.ele.toFixed(1)}</ele>` : "") +
        `<time>${time}</time>` +
        (p.hr !== undefined || p.cad !== undefined
          ? `<extensions><gpxtpx:TrackPointExtension>` +
            (p.hr !== undefined
              ? `<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>`
              : "") +
            (p.cad !== undefined
              ? `<gpxtpx:cad>${Math.round(p.cad)}</gpxtpx:cad>`
              : "") +
            `</gpxtpx:TrackPointExtension></extensions>`
          : "") +
        `</trkpt>`,
    );
  }
  lines.push(`  </trkseg></trk>`, `</gpx>`);
  return lines.join("\n");
}
