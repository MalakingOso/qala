// Generates the Qala mockup artboards (.dc.html) and canvas.json.
// Mockups only: sample data, no app code. Run: LUCIDE_JSON=<icons.json> node mockups/build.mjs
// Round 3 (2026-09-13): owner's Qala Test font for titles and big numbers (Faustina as the alternate),
// DM Mono everywhere else, plate calculator, graphical session summary, three Today directions.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "artboards");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const icons = JSON.parse(fs.readFileSync(process.env.LUCIDE_JSON, "utf8"));
const fontDir = path.join(here, "..", "assets", "fonts", "qala-test");
const b64 = (f) => fs.readFileSync(path.join(fontDir, f)).toString("base64");

// ---------- design system (PLAN.md section 9) ----------
const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&amp;family=Faustina:wght@500;700&amp;display=swap">`;
const FACES = `
@font-face { font-family: "Qala Test"; src: url(data:font/woff2;base64,${b64("QalaTestV2-Bold.woff2")}) format("woff2"); font-weight: 700; font-style: normal; }
@font-face { font-family: "Qala Test"; src: url(data:font/woff2;base64,${b64("QalaTest-Medium.woff2")}) format("woff2"); font-weight: 500; font-style: normal; }`;

const CSS = `${FACES}
body { margin: 0; background: #f5f5f7; }
a { color: #c2410c; text-decoration: none; } a:hover { color: #9a3412; }
.qala { --bg:#f5f5f7; --surface:#ffffff; --hover:#f1f3f9; --active:#e8ebf4; --recessed:#f1f3f9;
  --fg:#0f152a; --fg2:#4a5578; --muted:#64708b; --faint:#94a0b8;
  --border:rgba(15,21,42,.10); --border2:rgba(15,21,42,.22); --grid:#e3e6ee;
  --accent:#c2410c; --accent-subtle:rgba(194,65,12,.08); --on-accent:#ffffff;
  --route:#485cc7; --run:#485cc7; --progress:#0a8078; --progress-fill:#08a49c;
  --danger:#b91c1c; --success:#15803d; --note:#fff7e6; --note-border:rgba(180,110,0,.28); --note-ink:#8a5a00;
  --viz1:#c2410c; --viz2:#485cc7; --viz3:#08a49c; --gray-mark:#c9ced9; --low-zone:rgba(185,28,28,.34);
  --int1:#86b6ef; --int2:#5598e7; --int3:#2a78d6; --int4:#1c5cab; --int5:#104281;
  --bar:#9aa1ad; --bar-dark:#6b7280;
  --shadow-card:2px 4px 0 0 rgba(15,21,42,.10); --shadow-cta:2px 4px 0 0 #4a4a4a, 0 0 0 1px #c2410c;
  --map-land:#eceef3; --map-road:#ffffff; --map-minor:#f7f8fb; --map-park:#dcebe2; --map-water:#d3dff2;
  background: var(--bg); color: var(--fg); font-family: "DM Mono", ui-monospace, monospace; font-size: 14px; line-height: 1.5;
  -webkit-font-smoothing: antialiased; box-sizing: border-box; position: relative; overflow: hidden; }
.qala * { box-sizing: border-box; }
.qala.dark { --bg:#0b1020; --surface:#121a33; --hover:#18213f; --active:#1f2a4d; --recessed:#0f1529;
  --fg:#e8ecf6; --fg2:#aab4cc; --muted:#8a93ab; --faint:#5d6680; --border:rgba(232,236,246,.12); --border2:rgba(232,236,246,.24); --grid:#232c4a;
  --accent:#fb923c; --accent-subtle:rgba(251,146,60,.12); --on-accent:#0b1020;
  --route:#8e9cf0; --run:#8e9cf0; --progress:#2dd4bf; --progress-fill:#2dd4bf; --danger:#f87171; --success:#4ade80;
  --note:#2a2412; --note-border:rgba(251,191,36,.30); --note-ink:#fbbf24;
  --viz1:#e0652b; --viz2:#6f80e6; --viz3:#16a390; --gray-mark:#39425f; --low-zone:rgba(248,113,113,.40);
  --int1:#184f95; --int2:#256abf; --int3:#3987e5; --int4:#6da7ec; --int5:#9ec5f4;
  --bar:#6b7384; --bar-dark:#9aa1ad;
  --shadow-card:2px 4px 0 0 #2a3350; --shadow-cta:2px 4px 0 0 #3a4466, 0 0 0 1px #fb923c;
  --map-land:#10172c; --map-road:#1f2a4d; --map-minor:#172040; --map-park:#14302a; --map-water:#142348; }
.title, .ctitle, .fig { font-family: "Qala Test", "Faustina", Georgia, serif; font-weight: 700; letter-spacing: 0; color: var(--fg); margin: 0; }
.title { line-height: 1.1; text-wrap: balance; }
.ctitle { line-height: 1.25; }
.fig { line-height: 1; }
.tf-faustina .title, .tf-faustina .ctitle, .tf-faustina .fig { font-family: "Faustina", Georgia, serif; }
.tick { font-variant-numeric: lining-nums tabular-nums; }
.label { font-size: 11px; font-weight: 500; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
.ico { width: 24px; height: 24px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
`;

const icon = (name, size = 24, style = "") => {
  const inner = icons[name];
  if (!inner) throw new Error("missing icon " + name);
  const closed = inner.replace(/<(path|circle|rect|line|polyline|polygon|ellipse)([^>]*?)\s*\/>/g, "<$1$2></$1>");
  return `<svg class="ico" viewBox="0 0 24 24" style="width: ${size}px; height: ${size}px; ${style}">${closed}</svg>`;
};

const FONT_OPTIONS = ["Qala Test (yours)", "Faustina"];
const NAV_OPTIONS = ["A: Today Plan Body Progress Coach", "B: Plan Body Progress Coach"];
const script = (withNav) => {
  const props = {
    theme: { editor: "enum", options: ["light", "dark"], default: "light", section: "Look" },
    titleFont: { editor: "enum", options: FONT_OPTIONS, default: FONT_OPTIONS[0], section: "Look" },
  };
  if (withNav) props.nav = { editor: "enum", options: NAV_OPTIONS, default: NAV_OPTIONS[0], section: "Navigation" };
  return `<script data-dc-script data-props='${JSON.stringify(props)}'>
class Component extends DCLogic {
  renderVals() {
    const t = this.props.theme ?? 'light';
    const f = this.props.titleFont ?? '${FONT_OPTIONS[0]}';
    const nav = this.props.nav ?? '${NAV_OPTIONS[0]}';
    return { themeClass: t === 'dark' ? 'dark' : 'light', fontClass: f.indexOf('Faustina') === 0 ? 'tf-faustina' : 'tf-qala', navA: nav.indexOf('A') === 0, navB: nav.indexOf('B') === 0 };
  }
}
</script>`;
};

const boards = [];
function board(file, { w, h, title, page, x, y, nav = false }, body) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${FONTS}
  <style>${CSS}</style>
</helmet>
<div class="qala {{themeClass}} {{fontClass}}" style="width: ${w}px; height: ${h}px;">
${body}
</div>
</x-dc>
${script(nav)}
</body>
</html>
`;
  fs.writeFileSync(path.join(out, file), html);
  boards.push({ file, x, y, w, h, title, page });
}

// ---------- components (Beamer anatomy) ----------
const title = (text, size = 30, style = "") => `<h1 class="title" style="font-size: ${size}px; ${style}">${text}</h1>`;
const ctitle = (text, size = 17, style = "") => `<div class="ctitle" style="font-size: ${size}px; ${style}">${text}</div>`;
const fig = (text, size = 40, style = "", tick = false) => `<div class="fig${tick ? " tick" : ""}" style="font-size: ${size}px; ${style}">${text}</div>`;
const card = (inner, style = "") => `<div style="background: var(--surface); border: 2px solid var(--border); border-radius: 6px; padding: 16px; ${style}">${inner}</div>`;
const group = (label, inner, { right = "", bodyStyle = "", style = "" } = {}) =>
  `<div style="background: var(--surface); border: 2px solid var(--border); border-radius: 6px; overflow: hidden; ${style}">
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 9px 14px; background: var(--recessed); border-bottom: 2px solid var(--border);"><div class="label">${label}</div>${right}</div>
    <div style="padding: 14px; ${bodyStyle}">${inner}</div></div>`;
const cta = (text, style = "") =>
  `<div style="height: 52px; border-radius: 4px; background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-cta); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; font-weight: 500; ${style}">${text}</div>`;
const btn = (text, style = "") =>
  `<div style="min-height: 44px; padding: 0 14px; border-radius: 4px; border: 2px solid var(--border); background: var(--surface); color: var(--fg2); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 500; ${style}">${text}</div>`;
const chip = (text, style = "") =>
  `<div style="height: 28px; padding: 0 10px; border-radius: 4px; background: var(--active); color: var(--fg2); display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; ${style}">${text}</div>`;
const seg = (opts, selected, style = "") =>
  `<div style="display: grid; grid-template-columns: repeat(${opts.length}, minmax(0, 1fr)); border: 2px solid var(--border); border-radius: 6px; overflow: hidden; ${style}">${opts
    .map((o, i) => `<div style="height: 40px; display: flex; align-items: center; justify-content: center; font-size: 12px; ${i ? "border-left: 2px solid var(--border);" : ""} ${i === selected ? "background: var(--active); color: var(--fg); font-weight: 500;" : "background: var(--surface); color: var(--muted);"}">${o}</div>`)
    .join("")}</div>`;
const toggle = (on) =>
  `<div style="width: 46px; height: 28px; border-radius: 4px; border: 2px solid ${on ? "var(--accent)" : "var(--border2)"}; background: ${on ? "var(--accent)" : "var(--surface)"}; position: relative; flex: none;"><div style="position: absolute; top: 2px; ${on ? "right: 2px" : "left: 2px"}; width: 20px; height: 20px; border-radius: 2px; background: ${on ? "var(--on-accent)" : "var(--border2)"};"></div></div>`;
const iconBtn = (name, style = "") =>
  `<div style="width: 44px; height: 44px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--fg); ${style}">${icon(name, 22)}</div>`;
const topBar = (left, center, right) =>
  `<div style="height: 56px; padding: 0 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 2px solid var(--border); background: var(--surface);">${left}<div style="flex-grow: 1; text-align: center;">${center}</div>${right}</div>`;
const spacer = `<div style="width: 44px;"></div>`;

const TABS_A = [["Today", "sun"], ["Plan", "calendar-range"], ["Body", "activity"], ["Progress", "trending-up"], ["Coach", "message-square-text"]];
const TABS_B = TABS_A.slice(1);
const tabBar = (items, active) =>
  `<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 72px; background: var(--surface); border-top: 2px solid var(--border); display: grid; grid-template-columns: repeat(${items.length}, minmax(0, 1fr)); padding: 6px 4px 12px;">${items
    .map(([label, ic]) => {
      const on = label === active;
      return `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: ${on ? "var(--fg)" : "var(--muted)"};"><div style="width: 40px; height: 3px; border-radius: 2px; margin-bottom: 3px; background: ${on ? "var(--accent)" : "transparent"};"></div>${icon(ic, 22, on ? "stroke-width: 2.3;" : "")}<div style="font-size: 10px; font-weight: 500;">${label}</div></div>`;
    })
    .join("")}</div>`;
const nav = (activeA, activeB = activeA) =>
  `<sc-if value="{{ navA }}" hint-placeholder-val="{{ true }}">${tabBar(TABS_A, activeA)}</sc-if><sc-if value="{{ navB }}" hint-placeholder-val="{{ false }}">${tabBar(TABS_B, activeB)}</sc-if>`;

// ---------- plates (PLAN.md section 6.8) ----------
const PLATE = {
  55: { c: "#d64541", ink: "#ffffff", h: 1.0, w: 30 },
  45: { c: "#2f6bd1", ink: "#ffffff", h: 1.0, w: 28 },
  35: { c: "#e9b824", ink: "#0f152a", h: 1.0, w: 26 },
  25: { c: "#2f9c5a", ink: "#ffffff", h: 1.0, w: 24 },
  10: { c: "#eef0f4", ink: "#0f152a", h: 0.74, w: 20, stroke: true },
  5: { c: "#3b404c", ink: "#ffffff", h: 0.56, w: 17 },
  2.5: { c: "#b9bfca", ink: "#0f152a", h: 0.44, w: 15 },
};
const plateLabel = (p) => (p === 2.5 ? "2.5" : String(p));
// Barbell drawing for one side, heaviest innermost (next to the collar on the right).
function barbell(perSide, { w = 340, h = 150, bar = 45 } = {}) {
  const mid = h / 2, full = h - 22, collarX = w - 96, gap = 2;
  let x = collarX - 6;
  const plates = perSide.map((p) => {
    const d = PLATE[p]; const ph = full * d.h; x -= d.w;
    const rect = `<rect x="${x}" y="${mid - ph / 2}" width="${d.w}" height="${ph}" rx="3" style="fill: ${d.c}; ${d.stroke ? "stroke: #c3c8d2; stroke-width: 1.5;" : ""}"></rect>`;
    const txt = d.w >= 17 && ph >= 60
      ? `<text x="${x + d.w / 2}" y="${mid}" text-anchor="middle" dominant-baseline="central" transform="rotate(-90 ${x + d.w / 2} ${mid})" style="fill: ${d.ink}; font: 500 12px 'DM Mono', monospace;">${plateLabel(p)}</text>`
      : `<text x="${x + d.w / 2}" y="${mid + ph / 2 + 13}" text-anchor="middle" style="fill: var(--muted); font: 500 10px 'DM Mono', monospace;">${plateLabel(p)}</text>`;
    x -= gap;
    return rect + txt;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" style="display: block; width: 100%; max-width: ${w}px; height: auto;">
    <rect x="0" y="${mid - 5}" width="${collarX}" height="10" rx="3" style="fill: var(--bar);"></rect>
    <rect x="${collarX - 6}" y="${mid - 16}" width="10" height="32" rx="2" style="fill: var(--bar-dark);"></rect>
    <rect x="${collarX + 4}" y="${mid - 7}" width="${w - collarX - 4}" height="14" rx="3" style="fill: var(--bar);"></rect>
    <text x="${w - 8}" y="${mid - 14}" text-anchor="end" style="fill: var(--muted); font: 500 11px 'DM Mono', monospace;">${bar} lb bar</text>
    ${plates}
  </svg>`;
}
const plateChips = (perSide, size = 1) =>
  `<div style="display: inline-flex; align-items: center; gap: 3px;">${perSide.map((p) => { const d = PLATE[p]; return `<div style="min-width: ${Math.round((d.w - 2) * size)}px; height: ${Math.round((14 + 10 * d.h) * size)}px; padding: 0 3px; border-radius: 3px; background: ${d.c}; color: ${d.ink}; ${d.stroke ? "box-shadow: inset 0 0 0 1px #c3c8d2;" : ""} display: flex; align-items: center; justify-content: center; font-size: ${Math.round(11 * size)}px; font-weight: 500;">${plateLabel(p)}</div>`; }).join("")}</div>`;

function map(w, h, { markers = true, puck = false, faded = false } = {}) {
  const streets = [];
  for (let x = -20; x < w + 40; x += 58) streets.push(`<line x1="${x}" y1="0" x2="${x + 40}" y2="${h}" style="stroke: var(--map-minor); stroke-width: 7;"></line>`);
  for (let y = 20; y < h + 20; y += 52) streets.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y - 30}" style="stroke: var(--map-minor); stroke-width: 7;"></line>`);
  const r = `M ${w * 0.18} ${h * 0.8} L ${w * 0.18} ${h * 0.42} L ${w * 0.42} ${h * 0.36} L ${w * 0.46} ${h * 0.14} L ${w * 0.8} ${h * 0.2} L ${w * 0.74} ${h * 0.56} L ${w * 0.5} ${h * 0.62} L ${w * 0.18} ${h * 0.8}`;
  const marker = (x, y, t) => `<g transform="translate(${x} ${y})"><rect x="-13" y="-30" width="26" height="24" rx="4" style="fill: var(--fg);"></rect><path d="M -5 -6 L 0 0 L 5 -6 Z" style="fill: var(--fg);"></path><text x="0" y="-13" text-anchor="middle" style="fill: var(--bg); font: 500 13px 'DM Mono', monospace;">${t}</text></g>`;
  return `<svg viewBox="0 0 ${w} ${h}" style="display: block; width: ${w}px; height: ${h}px; background: var(--map-land);">
    <path d="M ${w * 0.06} ${h * 0.08} h ${w * 0.3} v ${h * 0.26} h -${w * 0.3} z" style="fill: var(--map-park);"></path>
    <path d="M ${w * 0.78} ${h} C ${w * 0.84} ${h * 0.7}, ${w} ${h * 0.66}, ${w + 5} ${h * 0.6} V ${h} Z" style="fill: var(--map-water);"></path>
    ${streets.join("")}
    <path d="M -10 ${h * 0.62} C ${w * 0.3} ${h * 0.55}, ${w * 0.55} ${h * 0.7}, ${w + 10} ${h * 0.48}" style="fill: none; stroke: var(--map-road); stroke-width: 14;"></path>
    <path d="M ${w * 0.7} -10 L ${w * 0.62} ${h + 10}" style="fill: none; stroke: var(--map-road); stroke-width: 12;"></path>
    <path d="${r}" style="fill: none; stroke: var(--route); stroke-width: 6; stroke-linejoin: round; stroke-linecap: round; opacity: ${faded ? 0.45 : 1};"></path>
    ${markers ? marker(w * 0.18, h * 0.48, "1") + marker(w * 0.62, h * 0.17, "2") + marker(w * 0.72, h * 0.58, "3") + `<circle cx="${w * 0.18}" cy="${h * 0.8}" r="8" style="fill: var(--progress-fill); stroke: var(--surface); stroke-width: 3;"></circle>` : ""}
    ${puck ? `<circle cx="${w * 0.46}" cy="${h * 0.5}" r="30" style="fill: var(--route); opacity: .16;"></circle><circle cx="${w * 0.46}" cy="${h * 0.5}" r="9" style="fill: var(--route); stroke: var(--surface); stroke-width: 4;"></circle>` : ""}
  </svg>`;
}

// ---------- sample day (consistent across screens) ----------
// Strength block 2, week 3. Sunday Lower A. Squat 3 x 4 @ 245 lb, reference 1RM 280, quads sore 4.
const EXERCISES = [
  { name: "Back Squat", sets: 3, done: 2, rx: "3 × 4 · 245 lb", note: true },
  { name: "Romanian Deadlift", sets: 4, done: 0, rx: "4 × 8 · 205 lb", tag: "+1 set" },
  { name: "Walking Lunge", sets: 3, done: 0, rx: "3 × 10 · 40 lb" },
  { name: "Lying Leg Curl", sets: 3, done: 0, rx: "3 × 12 · 90 lb" },
  { name: "Standing Calf Raise", sets: 4, done: 0, rx: "4 × 12 · 135 lb" },
  { name: "Hanging Leg Raise", sets: 3, done: 0, rx: "3 × 12" },
];
const progressBar = (current) =>
  `<div style="display: grid; grid-template-columns: repeat(${EXERCISES.length}, minmax(0, 1fr)); gap: 4px; padding: 10px 16px 0;">${EXERCISES.map(
    (e, i) => `<div style="height: 8px; border-radius: 2px; background: var(--active); overflow: hidden; ${i === current ? "outline: 2px solid var(--fg); outline-offset: 1px;" : ""}"><div style="width: ${(e.done / e.sets) * 100}%; height: 8px; background: var(--accent);"></div></div>`
  ).join("")}</div>`;
const workoutTop = `${topBar(iconBtn("chevron-down"), `<div style="font-size: 14px; font-weight: 500;">Lower A <span class="tick" style="color: var(--muted); margin-left: 6px;">24:10</span></div>`, `<div style="padding: 0 10px; font-size: 13px; font-weight: 500; color: var(--accent);">Finish</div>`)}${progressBar(0)}`;

const W = 390;
const col = (i) => i * 470;
const rowA = 0, rowB = 2020, rowC = 4520;

// ================= PHONE: lifting flow =================

board("TodayRound2.dc.html", { w: W, h: 1080, title: "Today (round 2 layout)", page: "today-options", x: 1410, y: 0, nav: true }, `
<div style="padding: 14px 18px 96px; display: flex; flex-direction: column; gap: 14px;">
  <div style="display: flex; align-items: center; justify-content: space-between;"><div class="label">Sunday, Sep 13</div><div style="display: flex; gap: 4px;">${iconBtn("history")}${iconBtn("settings")}</div></div>
  ${title("Lower A, then an easy 3 mi")}
  <p style="margin: -4px 0 0; color: var(--fg2);">Squat holds at 245 lb. Your quads were still sore from Thursday, so the warm-up spends longer on them.</p>
  ${group("Readiness", `<div style="display: flex; align-items: center; gap: 16px;">${fig("72", 40)}<div style="flex-grow: 1; font-size: 12px; color: var(--fg2);">Recovery 6 · quads 4 · slept 6 h<br><span style="color: var(--muted);">Checked in 6:52 am</span></div>${icon("chevron-right", 20, "color: var(--muted);")}</div>`)}
  ${group("Today", [["flame", "Warm-up", "15 min · bike, roller, Theragun, ramp", "var(--accent)"], ["dumbbell", "Lower A", "55 min · squat 3 × 4 at 245 lb", "var(--fg)"], ["sport-shoe", "Easy run", "3.0 mi · after 6 pm", "var(--run)"]]
    .map(([ic, t, s, c], i) => `<div style="display: flex; align-items: center; gap: 12px; min-height: 60px; ${i ? "border-top: 2px solid var(--border);" : ""}"><div style="width: 40px; height: 40px; border-radius: 4px; background: var(--recessed); color: ${c}; display: flex; align-items: center; justify-content: center;">${icon(ic, 20)}</div><div style="flex-grow: 1; min-width: 0;">${ctitle(t, 17)}<div style="font-size: 12px; color: var(--muted);">${s}</div></div>${icon("chevron-right", 18, "color: var(--muted);")}</div>`).join("") +
    `<div style="margin-top: 12px;">${cta(`${icon("play", 18)} Start warm-up`)}</div>`, { bodyStyle: "padding: 4px 14px 14px;" })}
  ${card(`<div style="display: flex; gap: 12px; align-items: flex-start;">${icon("message-square-text", 20, "margin-top: 2px;")}<div style="flex-grow: 1;"><div style="font-size: 13px;">Four hard sessions this week. Tomorrow works well as a rest day.</div><div style="display: flex; gap: 8px; margin-top: 10px;">${btn("Ask coach", "min-height: 36px;")}${btn("Why?", "min-height: 36px; border-color: transparent;")}</div></div></div>`, "padding: 14px;")}
  ${group("This week", `<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;">${[["3/4", "lifts"], ["2/3", "runs"], ["11.4", "miles"], ["1,840", "load"]].map(([v, k]) => `<div>${fig(v, 24)}<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">${k}</div></div>`).join("")}</div>`)}
</div>
${nav("Today", "Plan")}
`);

board("Plan.dc.html", { w: W, h: 1080, title: "Plan (week and day)", page: "phone", x: col(1), y: rowA, nav: true }, `
<div style="background: var(--surface); border-bottom: 2px solid var(--border); padding: 12px 8px 0;">
  <div class="label" style="text-align: center;">Strength block 2 · DUP</div>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 2px;">${iconBtn("chevron-left")}${title("Week 3 of 6", 26, "text-align: center;")}${iconBtn("chevron-right")}</div>
  <div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; padding: 6px 30px 12px;">${[1, 1, 2, 0, 0, 3].map((s) => `<div style="height: 4px; border-radius: 2px; background: ${s === 1 ? "var(--fg2)" : s === 2 ? "var(--accent)" : s === 3 ? "var(--border2)" : "var(--active)"};"></div>`).join("")}</div>
  <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));">
    ${[["Mon", "7", "dumbbell"], ["Tue", "8", "sport-shoe"], ["Wed", "9", "dumbbell"], ["Thu", "10", "sport-shoe"], ["Fri", "11", "dumbbell"], ["Sat", "12", "bed"], ["Sun", "13", "dumbbell"]]
      .map(([d, n, ic], i) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0 10px; border-bottom: 3px solid ${i === 6 ? "var(--accent)" : "transparent"}; color: ${i === 6 ? "var(--fg)" : "var(--muted)"};"><div style="font-size: 10px;">${d}</div><div style="font-size: 14px; font-weight: 500; color: ${i === 6 ? "var(--fg)" : "var(--fg2)"};">${n}</div><div style="color: ${ic === "sport-shoe" ? "var(--run)" : ic === "bed" ? "var(--faint)" : i < 6 ? "var(--progress)" : "var(--accent)"};">${icon(ic, 16)}</div></div>`).join("")}
  </div>
</div>
<div style="padding: 16px 18px 96px; display: flex; flex-direction: column; gap: 14px;">
  <div>${ctitle("Sunday · Lower A", 22)}<div style="font-size: 12px; color: var(--muted); margin-top: 2px;">6 exercises · ~55 min + 15 min warm-up</div></div>
  ${cta(`${icon("play", 18)} Start workout`)}
  ${seg(["Overview", "Details"], 0)}
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
    ${EXERCISES.map((e) => `<div style="background: var(--surface); border: 2px solid var(--border); border-radius: 6px; padding: 12px; min-height: 96px; display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; justify-content: space-between; gap: 6px;">${ctitle(e.name, 16)}${e.note ? icon("sticky-note", 16, "color: var(--note-ink); margin-top: 2px;") : ""}</div><div style="font-size: 11px; color: var(--fg2);">${e.rx}</div>${e.tag ? `<div style="margin-top: auto;">${chip(e.tag, "height: 22px; font-size: 11px; display: inline-flex;")}</div>` : ""}</div>`).join("")}
  </div>
</div>
${nav("Plan")}
`);

board("CheckIn.dc.html", { w: W, h: 1110, title: "Check-in", page: "phone", x: col(2), y: rowA }, `
${topBar(iconBtn("chevron-left"), `<div style="font-size: 14px; font-weight: 500;">Check-in</div>`, `<div style="width: 44px; text-align: center; font-size: 12px; color: var(--muted);">1/2</div>`)}
<div style="padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 14px;">
  ${title("How are you walking in?", 30)}
  ${group("Recovery", `<div style="display: flex; justify-content: space-between; align-items: center;"><div style="font-size: 13px; color: var(--fg2);">How recovered do you feel?</div>${fig("6", 40)}</div>
    <div style="display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 3px; margin-top: 12px;">${Array.from({ length: 11 }, (_, i) => `<div style="height: 36px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 12px; ${i === 6 ? "background: var(--fg); color: var(--bg);" : "background: var(--recessed); color: var(--fg2);"}">${i}</div>`).join("")}</div>
    <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); margin-top: 6px;"><span>0-2 worse</span><span>3-7 normal</span><span>8-10 better</span></div>`)}
  ${group("Soreness in today's muscles", `<div style="display: flex; flex-direction: column; gap: 12px;">${[["Quads", "last hit Thursday", 3], ["Glutes", "last hit Thursday", 1], ["Hamstrings", "last hit Thursday", 1], ["Lower back", "last hit Friday", 0]]
      .map(([m, sub, sel]) => `<div><div style="display: flex; justify-content: space-between; align-items: baseline;"><div style="font-size: 14px; font-weight: 500;">${m}</div><div style="font-size: 11px; color: var(--muted);">${sub}</div></div><div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 6px;">${[1, 2, 3, 4].map((n, i) => `<div style="height: 44px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 14px; ${i === sel ? (n === 4 ? "background: var(--accent); color: var(--on-accent); border: 2px solid var(--accent);" : "background: var(--fg); color: var(--bg); border: 2px solid var(--fg);") : "background: var(--surface); color: var(--fg2); border: 2px solid var(--border);"}">${n}</div>`).join("")}</div></div>`).join("")}</div>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; margin-top: 12px; padding-top: 10px; border-top: 2px solid var(--border); font-size: 11px; color: var(--muted);"><div>1 never got sore</div><div>2 healed well before</div><div>3 healed just in time</div><div>4 still sore now</div></div>`)}
  ${group("Anything else?", `<div style="min-height: 60px; padding: 10px 12px; border-radius: 4px; border: 2px solid var(--border2); background: var(--bg); font-size: 13px;">Slept about 6 hours. Left knee a little cranky.</div><div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;">${chip(`${icon("clock", 14)} Sleep 6 h ${icon("x", 12)}`)}${chip(`${icon("triangle-alert", 14, "color: var(--accent);")} Left knee: watch ${icon("x", 12)}`)}</div><div style="font-size: 11px; color: var(--muted); margin-top: 8px;">Read by the coach. Remove anything it got wrong.</div>`)}
  ${cta("Continue to warm-up")}
</div>
`);

const RAMP = [["100", "5", "0:45", "", [25, 2.5]], ["125", "5", "0:45", "extra step: quads sore", [35, 5]], ["145", "3", "1:00", "", [45, 5]], ["185", "2", "1:30", "", [45, 25]], ["215", "1", "2:00", "", [45, 35, 5]]];
board("WarmUp.dc.html", { w: W, h: 1340, title: "Warm-up (plates per step)", page: "phone", x: col(3), y: rowA }, `
${topBar(iconBtn("chevron-left"), `<div style="font-size: 14px; font-weight: 500;">Warm-up <span style="color: var(--muted);">~15 min</span></div>`, `<div style="padding: 0 10px; font-size: 13px; color: var(--muted);">Skip</div>`)}
<div style="padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 14px;">
  ${title("Warm up for heavy squats", 30)}
  <p style="margin: -4px 0 0; color: var(--fg2); font-size: 13px;">Built from today's lifts, your check-in, and what you own: bike, foam roller, Theragun.</p>
  ${group("1 · General · 10 min", `<div style="display: flex; align-items: center; gap: 12px;"><div style="width: 44px; height: 44px; border-radius: 4px; background: var(--recessed); display: flex; align-items: center; justify-content: center;">${icon("bike", 22)}</div><div style="flex-grow: 1;">${ctitle("Easy bike", 17)}<div style="font-size: 11px; color: var(--muted);">Conversational, ~60% of max heart rate</div></div>${fig("10:00", 26, "", true)}</div><div style="font-size: 11px; color: var(--muted); margin-top: 10px;">10 minutes because your top squat set is 88% of your 1RM. On lighter days it's 5 and optional.</div>`, { right: btn(`${icon("play", 14)} Start`, "min-height: 30px; padding: 0 10px; font-size: 12px;") })}
  ${group("2 · Soft tissue · 4.5 min", [["cylinder", "Foam roller", "Quads", "2:00", "Sore (4): 2 min, no Theragun"], ["cylinder", "Foam roller", "Glutes", "1:30", ""], ["vibrate", "Theragun", "Hamstrings", "1:00", "You prefer the Theragun where allowed"]]
    .map(([ic, tool, m, t, why], i) => `<div style="display: flex; align-items: center; gap: 12px; min-height: 56px; ${i ? "border-top: 2px solid var(--border);" : ""}">${icon(ic, 20, "color: var(--fg2);")}<div style="flex-grow: 1;"><div style="font-size: 14px; font-weight: 500;">${m} <span style="font-weight: 400; color: var(--muted);">· ${tool}</span></div>${why ? `<div style="font-size: 11px; color: var(--muted);">${why}</div>` : ""}</div><div class="tick" style="font-size: 14px;">${t}</div>${icon("circle-check", 20, i === 0 ? "color: var(--progress);" : "color: var(--border2);")}</div>`).join(""), { bodyStyle: "padding: 4px 14px;" })}
  ${group("3 · Mobility · 1 min", `<div style="display: flex; flex-direction: column; gap: 6px; font-size: 13px;"><div style="display: flex; justify-content: space-between;"><span>Bodyweight squats</span><span style="color: var(--fg2);">× 10</span></div><div style="display: flex; justify-content: space-between;"><span>Front-to-back leg swings</span><span style="color: var(--fg2);">× 10 each</span></div></div>`)}
  ${group("4 · Ramp sets · Back Squat", `<div class="label" style="display: grid; grid-template-columns: 22px 64px 38px minmax(0, 1fr) 44px; gap: 6px;"><div>#</div><div>Load</div><div>Reps</div><div>Per side</div><div>Rest</div></div>
    ${RAMP.map(([l, r, rest, why, plates], i) => `<div style="display: grid; grid-template-columns: 22px 64px 38px minmax(0, 1fr) 44px; gap: 6px; align-items: center; min-height: 46px; border-top: 2px solid var(--border);"><div style="color: var(--muted);">${i + 1}</div><div><span style="font-size: 14px;">${l}</span>${why ? `<div style="font-size: 9px; color: var(--accent); line-height: 1.2;">${why}</div>` : ""}</div><div>× ${r}</div><div>${plateChips(plates, 0.9)}</div><div class="tick" style="color: var(--fg2);">${rest}</div></div>`).join("")}
    <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; margin-top: 8px; padding-top: 10px; border-top: 2px solid var(--fg); font-size: 13px;"><span style="font-weight: 500;">Work sets 3 × 4 · 245</span>${plateChips([45, 45, 10], 0.9)}</div>`)}
  <div style="font-size: 11px; color: var(--muted);">Soft-tissue times and the extra ramp step are coach-practice rules, not tested ones. Plates per side on a 45 lb bar.</div>
  ${cta("Start workout")}
</div>
`);

board("Workout.dc.html", { w: W, h: 900, title: "Workout: one exercise (note, plates)", page: "phone", x: col(4), y: rowA }, `
${workoutTop}
<div style="padding: 10px 18px 24px; display: flex; flex-direction: column; gap: 12px;">
  <div class="label">Exercise 1 of 6 · Set 3 of 3</div>
  <div style="background: var(--note); border: 2px solid var(--note-border); border-radius: 6px; padding: 12px 14px; display: flex; gap: 10px;">${icon("sticky-note", 20, "color: var(--note-ink); margin-top: 1px;")}<div style="flex-grow: 1;"><div class="label" style="color: var(--note-ink);">Your note · Sep 6</div><div style="font-size: 13px; margin-top: 2px;">Left knee pinchy below parallel. Narrower stance helped.</div><div style="display: flex; gap: 14px; margin-top: 8px; font-size: 12px; font-weight: 500; color: var(--fg2);"><span>Got it</span><span>${icon("pin", 12)} Pin</span><span style="color: var(--muted); font-weight: 400;">Resolved</span></div></div></div>
  <div>${title("Back Squat", 32)}<div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Last time 240 × 4 @ 8 · target RPE 8</div></div>
  ${card(`<div style="display: grid; grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr); align-items: center;"><div style="text-align: center;">${fig("245", 64)}<div class="label" style="margin-top: 6px;">Pounds</div></div><div style="text-align: center; color: var(--muted);">${icon("x", 20)}</div><div style="text-align: center;">${fig("4", 64)}<div class="label" style="margin-top: 6px;">Reps</div></div></div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 8px 10px; border-radius: 4px; background: var(--recessed);"><div style="display: flex; align-items: center; gap: 8px;"><span class="label">Per side</span>${plateChips([45, 45, 10])}</div><div style="display: flex; align-items: center; color: var(--fg2);">${icon("calculator", 18)}</div></div>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 12px;">${[0, 1].map(() => `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;">${btn(icon("minus", 20))}${btn(icon("plus", 20))}</div>`).join("")}</div>
    <div class="label" style="margin-top: 14px;">RPE</div>
    <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-top: 6px;">${["7", "7.5", "8", "8.5", "9", "9.5", "10"].map((v) => `<div style="height: 40px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 12px; ${v === "8" ? "background: var(--fg); color: var(--bg);" : "background: var(--recessed); color: var(--fg2);"}">${v}</div>`).join("")}</div>`, "padding: 16px 14px;")}
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr); gap: 6px;">
    ${[["info", "Info"], ["arrow-left-right", "Swap"], ["sticky-note", "Note"]].map(([ic, t]) => `<div style="height: 60px; border-radius: 4px; border: 2px solid var(--border); background: var(--surface); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--fg2);">${icon(ic, 20)}<div style="font-size: 10px;">${t}</div></div>`).join("")}
    <div style="height: 60px; border-radius: 4px; background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-cta); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">${icon("check", 22)}<div style="font-size: 10px;">Log set</div></div>
  </div>
  ${card(`<div style="display: flex; align-items: center; gap: 10px; min-height: 36px;">${icon("hourglass", 18, "color: var(--progress);")}<div class="label" style="width: 44px;">Rest</div><div style="flex-grow: 1; font-size: 13px;">Auto after you log</div><div class="tick" style="color: var(--fg2);">~3:00</div></div><div style="display: flex; align-items: center; gap: 10px; min-height: 40px; border-top: 2px solid var(--border);">${icon("chevron-right", 18, "color: var(--muted);")}<div class="label" style="width: 44px;">Next</div><div style="flex-grow: 1; font-size: 13px;">Romanian Deadlift</div><div style="color: var(--fg2);">205 × 8</div></div>`, "padding: 4px 14px;")}
  <div style="display: flex; justify-content: space-between; align-items: center;">${btn(`${icon("layout-grid", 18)} All exercises`)}<div style="font-size: 11px; color: var(--muted);">Swipe for next exercise</div></div>
</div>
`);

board("WorkoutRest.dc.html", { w: W, h: 1000, title: "Workout: rest with plates", page: "phone", x: col(5), y: rowA }, `
${workoutTop}
<div style="padding: 14px 18px 24px; display: flex; flex-direction: column; gap: 14px;">
  <div class="label">Back Squat · set 2 logged: 245 × 4 @ 9</div>
  <div style="text-align: center; padding: 4px 0 0;"><div class="label">Rest</div>${fig("2:41", 104, "margin-top: 8px;", true)}${fig("of 3:45", 22, "margin-top: 10px; color: var(--muted); font-weight: 500;", true)}</div>
  <div style="height: 8px; border-radius: 2px; background: var(--active);"><div style="width: 28%; height: 8px; border-radius: 2px; background: var(--progress-fill);"></div></div>
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;">${btn("Ready early")}${btn("+30 s")}</div>
  ${group("Set 3 · load 245 lb", `<div style="font-size: 13px; margin-bottom: 6px;"><span style="font-weight: 500;">Same as last set.</span> <span style="color: var(--muted);">Per side on a 45 lb bar:</span></div>${barbell([45, 45, 10])}<div style="display: flex; gap: 14px; justify-content: center; font-size: 12px; color: var(--fg2); margin-top: 4px;"><span>45 × 2</span><span>10 × 1</span><span style="color: var(--muted);">each side</span></div>`, { right: icon("calculator", 16, "color: var(--muted);") })}
  ${group("Why 3:45", [["Base, main lift, strength day", "3:00"], ["Your usual pace", "-0:15"], ["Last set RPE 9, target 8", "+0:30"], ["Quads rated 4 at check-in", "+0:30"]].map(([k, v], i) => `<div style="display: flex; justify-content: space-between; min-height: 34px; align-items: center; font-size: 13px; ${i ? "border-top: 2px solid var(--border);" : ""}"><span style="color: var(--fg2);">${k}</span><span class="tick">${v}</span></div>`).join(""), { bodyStyle: "padding: 4px 14px;" })}
  ${card(`<div style="display: flex; align-items: center; gap: 10px;">${icon("arrow-left-right", 18, "color: var(--fg2);")}<div style="flex-grow: 1; font-size: 12px;"><span style="font-weight: 500;">After squats:</span> RDL 205. Take off 45 and 10, add 35 each side.</div>${plateChips([45, 35], 0.85)}</div>`, "padding: 10px 14px;")}
</div>
`);

board("WorkoutAll.dc.html", { w: W, h: 844, title: "Workout: zoomed out", page: "phone", x: col(6), y: rowA }, `
${workoutTop}
<div style="padding: 14px 18px 24px; display: flex; flex-direction: column; gap: 14px;">
  <div style="display: flex; justify-content: space-between; align-items: center;">${title("All exercises", 26)}${btn(`${icon("chevron-down", 16)} Back to set`, "min-height: 36px;")}</div>
  ${card(`<div style="display: flex; align-items: center; gap: 10px;">${icon("circle-check", 20, "color: var(--progress);")}<div style="flex-grow: 1; font-size: 13px;">Warm-up done · 14 min</div></div>`, "padding: 10px 14px;")}
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
    ${EXERCISES.map((e, i) => `<div style="background: var(--surface); border: 2px solid ${i === 0 ? "var(--accent)" : "var(--border)"}; border-radius: 6px; padding: 12px; min-height: 118px; display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; justify-content: space-between; gap: 6px;"><div style="font-size: 11px; color: var(--muted);">${i + 1}</div>${e.note ? icon("sticky-note", 15, "color: var(--note-ink);") : ""}</div>${ctitle(e.name, 16)}<div style="font-size: 11px; color: var(--fg2);">${e.rx}</div><div style="display: flex; gap: 4px; margin-top: auto;">${Array.from({ length: e.sets }, (_, s) => `<div style="width: 18px; height: 8px; border-radius: 2px; background: ${s < e.done ? "var(--accent)" : "var(--active)"};"></div>`).join("")}</div></div>`).join("")}
  </div>
  <div style="font-size: 11px; color: var(--muted); text-align: center;">Tap any exercise to jump to it. Out of order is fine; history keeps the order you did.</div>
</div>
`);

// ---- Session complete: graphical summary (PLAN.md section 8) ----
const timeSeg = [["Warm-up", 14, "--viz1"], ["Lifting", 27, "--viz2"], ["Rest", 17, "--viz3"]];
const totalMin = timeSeg.reduce((a, s) => a + s[1], 0);
const muscleVol = [["Quads", 6, 3], ["Hamstrings", 3, 7], ["Glutes", 4, 5], ["Calves", 4, 4], ["Abs", 2, 3]];
const e1rm = [280, 282, 281, 285, 287, 286, 290, 294];
const zones = [["<70%", 24, "--int1"], ["70-80", 18, "--int2"], ["80-85", 10, "--int3"], ["85-90", 12, "--int4"], ["90+", 2, "--int5"]];
function stackedBar(segs, w = 354, h = 22) {
  const total = segs.reduce((a, s) => a + s[1], 0); const gap = 2; const usable = w - gap * (segs.length - 1);
  let x = 0;
  return `<svg viewBox="0 0 ${w} ${h}" style="display: block; width: 100%; height: ${h}px;">${segs.map(([, v, c], i) => { const sw = (v / total) * usable; const r = `<rect x="${x}" y="0" width="${sw}" height="${h}" rx="${i === 0 || i === segs.length - 1 ? 4 : 0}" style="fill: var(${c});"></rect>`; x += sw + gap; return r; }).join("")}</svg>`;
}
const legend = (segs, unit) => `<div style="display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 12px;">${segs.map(([l, v, c]) => `<span style="display: inline-flex; align-items: center; gap: 6px;"><span style="width: 10px; height: 10px; border-radius: 2px; background: var(${c});"></span><span style="color: var(--fg2);">${l}</span><span>${v}${unit}</span></span>`).join("")}</div>`;
function muscleBars() {
  const W2 = 230, scale = W2 / 24, rowH = 30, x0 = 96;
  return `<svg viewBox="0 0 354 ${muscleVol.length * rowH + 22}" style="display: block; width: 100%;">
    <line x1="${x0 + 10 * scale}" y1="0" x2="${x0 + 10 * scale}" y2="${muscleVol.length * rowH}" style="stroke: var(--grid); stroke-width: 1;"></line>
    <line x1="${x0 + 20 * scale}" y1="0" x2="${x0 + 20 * scale}" y2="${muscleVol.length * rowH}" style="stroke: var(--grid); stroke-width: 1;"></line>
    <text x="${x0 + 10 * scale}" y="${muscleVol.length * rowH + 14}" text-anchor="middle" style="fill: var(--muted); font: 400 10px 'DM Mono', monospace;">10</text>
    <text x="${x0 + 20 * scale}" y="${muscleVol.length * rowH + 14}" text-anchor="middle" style="fill: var(--muted); font: 400 10px 'DM Mono', monospace;">20 sets</text>
    ${muscleVol.map(([m, before, today], i) => { const y = i * rowH + 7; const w1 = before * scale, w2 = today * scale; return `<text x="0" y="${y + 12}" style="fill: var(--fg); font: 400 12px 'DM Mono', monospace;">${m}</text><rect x="${x0}" y="${y}" width="${w1}" height="16" style="fill: var(--gray-mark);"></rect><rect x="${x0 + w1 + 2}" y="${y}" width="${w2 - 2}" height="16" rx="3" style="fill: var(--accent);"></rect><text x="${x0 + w1 + w2 + 6}" y="${y + 12}" style="fill: var(--fg); font: 500 11px 'DM Mono', monospace;">${before + today}</text>`; }).join("")}
  </svg>`;
}
function e1rmLine() {
  const w = 354, h = 130, padL = 30, padB = 20, min = 276, max = 298;
  const px = (i) => padL + (i * (w - padL - 30)) / (e1rm.length - 1), py = (v) => (h - padB) - ((v - min) / (max - min)) * (h - padB - 10);
  const pts = e1rm.map((v, i) => `${i ? "L" : "M"} ${px(i)} ${py(v)}`).join(" ");
  const last = e1rm.length - 1;
  return `<svg viewBox="0 0 ${w} ${h}" style="display: block; width: 100%;">
    ${[280, 290].map((t) => `<line x1="${padL}" y1="${py(t)}" x2="${w}" y2="${py(t)}" style="stroke: var(--grid); stroke-width: 1;"></line><text x="0" y="${py(t) + 4}" style="fill: var(--muted); font: 400 10px 'DM Mono', monospace;">${t}</text>`).join("")}
    <path d="${pts}" style="fill: none; stroke: var(--fg2); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round;"></path>
    ${e1rm.slice(0, last).map((v, i) => `<circle cx="${px(i)}" cy="${py(v)}" r="4" style="fill: var(--fg2); stroke: var(--surface); stroke-width: 2;"></circle>`).join("")}
    <circle cx="${px(last)}" cy="${py(e1rm[last])}" r="6" style="fill: var(--accent); stroke: var(--surface); stroke-width: 2;"></circle>
    <text x="${px(last) - 10}" y="${py(e1rm[last]) - 10}" text-anchor="end" style="fill: var(--fg); font: 500 12px 'DM Mono', monospace;">294 today</text>
    <text x="${padL}" y="${h - 4}" style="fill: var(--muted); font: 400 10px 'DM Mono', monospace;">Aug 9</text>
    <text x="${w - 30}" y="${h - 4}" text-anchor="end" style="fill: var(--muted); font: 400 10px 'DM Mono', monospace;">Sep 13</text>
  </svg>`;
}
board("SessionEnd.dc.html", { w: W, h: 1870, title: "Session complete (charts)", page: "phone", x: col(7), y: rowA }, `
${topBar(spacer, `<div style="font-size: 14px; font-weight: 500;">Session complete</div>`, iconBtn("ellipsis-vertical"))}
<div style="padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 14px;">
  ${title("Lower A, done", 32)}
  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
    ${[["Duration", "58", "min", "+4 min vs Sep 6", "var(--muted)"], ["Volume", "20,420", "lb", "+6% vs Sep 6", "var(--success)"], ["Hard sets", "20", "", "+1 (RDL)", "var(--muted)"], ["PRs", "1", "", "RDL 4 × 8 at 205", "var(--success)"]]
      .map(([k, v, u, d, c]) => card(`<div class="label">${k}</div><div style="display: flex; align-items: baseline; gap: 4px; margin-top: 8px;">${fig(v, 34)}<span style="font-size: 12px; color: var(--muted);">${u}</span></div><div style="font-size: 11px; color: ${c}; margin-top: 6px;">${d}</div>`, "padding: 12px;")).join("")}
  </div>
  ${group("Where the time went", `${stackedBar(timeSeg)}${legend(timeSeg, " min")}`, { right: `<span style="font-size: 11px; color: var(--muted);">${totalMin} min</span>` })}
  ${group("Sets by muscle this week", `${muscleBars()}<div style="display: flex; gap: 14px; font-size: 11px; color: var(--fg2); margin-top: 6px;"><span style="display: inline-flex; align-items: center; gap: 6px;"><span style="width: 10px; height: 10px; background: var(--gray-mark);"></span>earlier this week</span><span style="display: inline-flex; align-items: center; gap: 6px;"><span style="width: 10px; height: 10px; border-radius: 2px; background: var(--accent);"></span>today</span></div>`, { right: `<span style="font-size: 11px; color: var(--muted);">target 10-20</span>` })}
  ${group("Squat e1RM · 8 sessions", e1rmLine(), { right: `<span style="font-size: 11px; color: var(--success);">+14 lb</span>` })}
  ${group("Reps by intensity · week 3", `<div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px;">${fig("14", 30)}<span style="font-size: 12px; color: var(--fg2);">reps at 85%+ · block target 14</span></div>${stackedBar(zones)}${legend(zones, "")}`)}
  ${group("Exercises", [["Back Squat", "2,940 lb", "+2%"], ["Romanian Deadlift", "6,560 lb", "+33%"], ["Walking Lunge", "1,200 lb", "0%"], ["Lying Leg Curl", "3,240 lb", "+3%"], ["Standing Calf Raise", "6,480 lb", "0%"]]
    .map(([n, v, d], i) => `<div style="display: flex; align-items: center; gap: 10px; min-height: 42px; ${i ? "border-top: 2px solid var(--border);" : ""}"><div style="flex-grow: 1; font-size: 13px;">${n}</div><div style="font-size: 12px; color: var(--fg2);">${v}</div>${chip(d, `height: 22px; font-size: 11px; ${d.startsWith("+") ? "color: var(--success);" : ""}`)}</div>`).join(""), { bodyStyle: "padding: 2px 14px;" })}
  ${group("Two quick questions", `<div style="font-size: 13px;">How did hamstrings perform?</div><div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin-top: 8px;">${["Beat", "Hit", "Struggled", "Missed"].map((t, i) => `<div style="height: 44px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 11px; ${i === 1 ? "background: var(--fg); color: var(--bg);" : "background: var(--recessed); color: var(--fg2);"}">${t}</div>`).join("")}</div>
    <div style="font-size: 13px; margin-top: 14px;">How hard was the whole session?</div><div style="display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 3px; margin-top: 8px;">${Array.from({ length: 11 }, (_, i) => `<div style="height: 40px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 12px; ${i === 8 ? "background: var(--fg); color: var(--bg);" : "background: var(--recessed); color: var(--fg2);"}">${i}</div>`).join("")}</div>`)}
  ${card(`<div style="display: flex; align-items: center; gap: 12px;">${icon("sport-shoe", 22, "color: var(--run);")}<div style="flex-grow: 1;">${ctitle("Easy run later today", 16)}<div style="font-size: 11px; color: var(--muted);">3.0 mi · best after 6 pm</div></div>${btn("Start now", "min-height: 36px;")}</div>`, "padding: 12px 14px;")}
  ${cta("Finish")}
</div>
`);

// ================= PHONE: body, progress, coach, plates, settings =================

const muscleRows = [["Quads", 0.62, 0.16, "ready Tue"], ["Glutes", 0.4, 0.08, "ready Mon"], ["Calves", 0.12, 0.26, "ready Mon"], ["Hamstrings", 0.22, 0.06, "ready"], ["Lower back", 0.18, 0, "ready"], ["Chest", 0.14, 0, "ready"], ["Back", 0.2, 0, "ready"], ["Shoulders", 0.1, 0, "ready"]];
board("Body.dc.html", { w: W, h: 1260, title: "Body (recovery)", page: "phone", x: col(0), y: rowB, nav: true }, `
<div style="padding: 14px 18px 96px; display: flex; flex-direction: column; gap: 14px;">
  <div class="label">Recovery</div>
  ${title("Legs are still recovering", 30)}
  ${group("Readiness · last 7 days", `<div style="display: flex; align-items: flex-end; gap: 14px;">${fig("72", 40)}<div style="font-size: 12px; color: var(--muted); padding-bottom: 4px;">4-week average 76</div></div><svg viewBox="0 0 330 60" style="display: block; width: 100%; height: 60px; margin-top: 10px;"><line x1="0" y1="22" x2="330" y2="22" style="stroke: var(--grid);"></line><path d="M0 30 L 55 18 L 110 26 L 165 14 L 220 34 L 275 40 L 330 30" style="fill: none; stroke: var(--fg); stroke-width: 2;"></path>${[0, 55, 110, 165, 220, 275, 330].map((x, i) => `<circle cx="${x}" cy="${[30, 18, 26, 14, 34, 40, 30][i]}" r="4" style="fill: var(--fg); stroke: var(--surface); stroke-width: 2;"></circle>`).join("")}</svg>`)}
  <div style="height: 170px; border: 2px dashed var(--border2); border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 30px; color: var(--muted); font-size: 11px; text-align: center;"><div>${icon("person-standing", 64, "stroke-width: 1.2;")}<div>front</div></div><div>${icon("person-standing", 64, "stroke-width: 1.2;")}<div>back</div></div><div style="max-width: 110px;">Muscle map from liftosaur's front and back drawings</div></div>
  ${group("Fatigue by muscle", `<div style="display: flex; gap: 14px; font-size: 11px; color: var(--muted); margin-bottom: 8px;"><span style="display: flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 10px; border-radius: 2px; background: var(--fg);"></span>lifting</span><span style="display: flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 10px; border-radius: 2px; background: var(--run);"></span>running</span></div>
    ${muscleRows.map(([m, l, r, s]) => `<div style="display: grid; grid-template-columns: 88px minmax(0, 1fr) 70px; gap: 10px; align-items: center; min-height: 32px; font-size: 13px;"><span>${m}</span><div style="display: flex; gap: 2px; height: 10px; border-radius: 2px; background: var(--active); overflow: hidden;"><div style="width: ${l * 100}%; background: var(--fg);"></div><div style="width: ${r * 100}%; background: var(--run);"></div></div><span style="font-size: 11px; color: ${s === "ready" ? "var(--progress)" : "var(--fg2)"}; text-align: right;">${s}</span></div>`).join("")}`)}
  ${group("Deloads", `<div style="font-size: 13px;">None due. Planned deload in week 6. Quads get a lighter session if they rate 4 again on Wednesday.</div>`)}
  ${group("Recovery tools", `<div style="display: flex; gap: 8px; flex-wrap: wrap;">${chip(`${icon("cylinder", 14)} Foam roller`)}${chip(`${icon("vibrate", 14)} Theragun`)}${chip(`${icon("bike", 14)} Bike`)}${chip(`${icon("plus", 14)} Add`, "background: transparent; border: 2px solid var(--border);")}</div>`)}
</div>
${nav("Body")}
`);

const squatPts = [262, 265, 263, 268, 270, 269, 274, 277, 276, 281, 284, 283, 288, 290, 289, 294];
const spx = (i) => 20 + i * 20, spy = (v) => 150 - (v - 255) * 3;
board("Progress.dc.html", { w: W, h: 1200, title: "Progress", page: "phone", x: col(1), y: rowB, nav: true }, `
<div style="padding: 14px 18px 96px; display: flex; flex-direction: column; gap: 14px;">
  <div class="label">Strength block 2 · week 3 of 6</div>
  ${title("Squat is up 4% this block", 30)}
  ${group("Squat 1RM", `<div style="display: flex; justify-content: space-between; align-items: flex-end;"><div style="display: flex; align-items: baseline; gap: 4px;">${fig("294", 40)}<span style="font-size: 12px; color: var(--muted);">lb</span></div><div style="font-size: 12px; color: var(--success);">+12 lb since Aug 24</div></div>
    <svg viewBox="0 0 350 165" style="display: block; width: 100%; height: 165px; margin-top: 8px;"><line x1="0" y1="150" x2="350" y2="150" style="stroke: var(--grid);"></line>${squatPts.map((v, i) => `<circle cx="${spx(i)}" cy="${spy(v - (i % 3) * 2)}" r="4" style="fill: var(--gray-mark); stroke: var(--surface); stroke-width: 2;"></circle>`).join("")}<path d="${squatPts.map((v, i) => `${i ? "L" : "M"} ${spx(i)} ${spy(v)}`).join(" ")}" style="fill: none; stroke: var(--fg); stroke-width: 2;"></path><path d="M ${spx(9)} ${spy(285) - 8} l 8 8 l -8 8 l -8 -8 z" style="fill: var(--accent);"></path></svg>
    <div style="display: flex; gap: 14px; font-size: 11px; color: var(--muted);"><span>● daily best</span><span>— estimate</span><span>◆ tested</span></div>`)}
  ${group("Reps at 85%+ this week", ["Squat 9 14", "Bench 12 14", "Deadlift 5 10"].map((s) => { const [l, v, t] = s.split(" "); return `<div style="margin-top: 6px;"><div style="display: flex; justify-content: space-between; font-size: 13px;"><span>${l}</span><span style="color: var(--fg2);">${v} / ${t}</span></div><div style="position: relative; height: 10px; border-radius: 2px; background: var(--active); margin-top: 4px;"><div style="width: ${(v / 16) * 100}%; height: 10px; border-radius: 2px; background: var(--fg);"></div><div style="position: absolute; left: ${(t / 16) * 100}%; top: -3px; width: 2px; height: 16px; background: var(--accent);"></div></div></div>`; }).join(""))}
  ${group("Running", `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;"><div>${fig("41.2", 30)}<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">VDOT, +0.8 in 6 weeks</div></div><div>${fig("11.4", 30)}<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">miles this week</div></div></div>`)}
  ${group("Recent", [["dumbbell", "Lower A", "Sun", "20,420 lb"], ["sport-shoe", "Tempo run", "Thu", "4.10 mi"], ["dumbbell", "Upper B", "Fri", "9,820 lb"]].map(([ic, t, d, v], i) => `<div style="display: flex; align-items: center; gap: 12px; min-height: 48px; ${i ? "border-top: 2px solid var(--border);" : ""}">${icon(ic, 18, `color: ${ic === "sport-shoe" ? "var(--run)" : "var(--fg2)"};`)}<div style="flex-grow: 1; font-size: 13px; font-weight: 500;">${t} <span style="font-weight: 400; color: var(--muted);">· ${d}</span></div><span style="font-size: 12px;">${v}</span></div>`).join(""), { bodyStyle: "padding: 4px 14px;", right: `<span style="font-size: 11px; color: var(--accent);">All history</span>` })}
</div>
${nav("Progress")}
`);

board("Coach.dc.html", { w: W, h: 1000, title: "Coach (Gemma)", page: "phone", x: col(2), y: rowB, nav: true }, `
${topBar(spacer, `<div style="font-size: 14px; font-weight: 500;">Coach</div>`, `<div style="display: flex; align-items: center; gap: 6px; padding-right: 8px; font-size: 11px; color: var(--muted);"><div style="width: 8px; height: 8px; border-radius: 2px; background: var(--success);"></div>callisto</div>`)}
<div style="padding: 14px 16px 200px; display: flex; flex-direction: column; gap: 12px;">
  <div style="display: flex; gap: 6px; flex-wrap: wrap;">${chip(`${icon("dumbbell", 14)} Today: Lower A`)}${chip("Quads 4 · recovery 6")}</div>
  <div style="align-self: flex-end; max-width: 80%; padding: 10px 12px; border-radius: 6px; background: var(--fg); color: var(--bg); font-size: 13px;">Knee's cranky. Should I still squat heavy?</div>
  <div class="label">Coach</div>
  <div style="font-size: 14px; margin-top: -6px;">Keep squats in, a bit lighter. Your knee note and quads at 4 point the same way, and the engine already held your load.</div>
  ${group("Suggested change", `<div style="display: grid; grid-template-columns: 70px minmax(0, 1fr) minmax(0, 1fr); gap: 8px; font-size: 13px; align-items: center;"><div></div><div class="label">Engine</div><div class="label" style="color: var(--accent);">Coach</div><div style="color: var(--fg2);">Weight</div><div style="color: var(--fg2);">245 lb</div><div>235 lb</div><div style="color: var(--fg2);">Per side</div><div>${plateChips([45, 45, 10], 0.75)}</div><div>${plateChips([45, 45, 5], 0.75)}</div></div><div style="font-size: 11px; color: var(--muted); margin-top: 8px;">The coach can only move weight -10% to +2.5% and sets -2 to +1. Both numbers stay visible.</div><div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px;">${cta("Use coach", "height: 44px; font-size: 13px;")}${btn("Keep engine")}</div>`)}
  ${group("Remember this?", `<div style="font-size: 13px;">Left knee gets cranky in weeks with more than 14 squat sets.</div><div style="font-size: 11px; color: var(--muted); margin-top: 2px;">From today's check-in and your Sep 6 squat note</div><div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px;">${btn("Remember")}${btn("Not now", "border-color: transparent;")}</div>`)}
</div>
<div style="position: absolute; left: 0; right: 0; bottom: 72px; padding: 10px 16px 12px; background: var(--bg); border-top: 2px solid var(--border); display: flex; gap: 8px; align-items: center;"><div style="flex-grow: 1; height: 46px; border-radius: 4px; border: 2px solid var(--border2); background: var(--surface); display: flex; align-items: center; padding: 0 14px; font-size: 13px; color: var(--muted);">Ask about today's plan</div><div style="width: 46px; height: 46px; border-radius: 4px; background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-cta); display: flex; align-items: center; justify-content: center;">${icon("chevron-right", 22)}</div></div>
${nav("Coach")}
`);

board("PlateCalc.dc.html", { w: W, h: 960, title: "Plate calculator", page: "phone", x: col(3), y: rowB }, `
${topBar(iconBtn("chevron-left"), `<div style="font-size: 14px; font-weight: 500;">Plate calculator</div>`, iconBtn("settings"))}
<div style="padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 14px;">
  ${card(`<div class="label">Target weight</div><div style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px;">${btn(icon("minus", 20), "width: 52px;")}<div style="display: flex; align-items: baseline; gap: 6px;">${fig("245", 56)}<span style="font-size: 13px; color: var(--muted);">lb</span></div>${btn(icon("plus", 20), "width: 52px;")}</div>`, "padding: 14px;")}
  ${seg(["45 lb bar", "35 lb bar", "Trap bar", "Other"], 0)}
  ${group("Put these on each side", `${barbell([45, 45, 10], { w: 340, h: 170 })}`)}
  ${group("Summary", `<div style="display: flex; align-items: flex-end; gap: 16px;">${[["Bar", "45"], [45, "× 2"], [10, "× 1"]].map(([p, n]) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 6px;">${p === "Bar" ? `<div style="width: 44px; height: 12px; border-radius: 3px; background: var(--bar);"></div>` : plateChips([p], 1.5)}<div style="font-size: 12px; color: var(--fg2);">${n}</div></div>`).join("")}<div style="margin-left: auto; text-align: right; font-size: 11px; color: var(--muted);">45 + 2 × 100<br>= 245 lb</div></div>`)}
  ${group("My plates (pairs)", `<div style="display: flex; flex-wrap: wrap; gap: 10px;">${[[45, "4"], [35, "1"], [25, "2"], [10, "2"], [5, "2"], [2.5, "2"]].map(([p, n]) => `<div style="display: flex; align-items: center; gap: 6px;">${plateChips([p], 1.1)}<span style="font-size: 11px; color: var(--muted);">× ${n}</span></div>`).join("")}</div><div style="font-size: 11px; color: var(--muted); margin-top: 10px;">Sample inventory. Colors follow standard bumper plates; change any color to match yours.</div>`, { right: `<span style="font-size: 11px; color: var(--accent);">Edit</span>` })}
</div>
`);

const row = (label, right, sub = "", first = false) => `<div style="display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 0; ${first ? "" : "border-top: 2px solid var(--border);"}"><div style="flex-grow: 1;"><div style="font-size: 14px;">${label}</div>${sub ? `<div style="font-size: 11px; color: var(--muted);">${sub}</div>` : ""}</div>${right}</div>`;
const val = (v) => `<div style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--fg2); white-space: nowrap;"><span>${v}</span>${icon("chevron-right", 16, "color: var(--muted);")}</div>`;
const sgroup = (label, rows) => group(label, rows.map((r, i) => row(r[0], r[1], r[2] || "", i === 0)).join(""), { bodyStyle: "padding: 2px 14px;" });
board("Settings.dc.html", { w: W, h: 2300, title: "Settings", page: "phone", x: col(4), y: rowB }, `
${topBar(iconBtn("chevron-left"), `<div style="font-size: 14px; font-weight: 500;">Settings</div>`, spacer)}
<div style="padding: 14px 16px 30px; display: flex; flex-direction: column; gap: 12px;">
  ${sgroup("Units", [["Weight", seg(["lb", "kg"], 0, "width: 110px;")], ["Distance", seg(["mi", "km"], 0, "width: 110px;")]])}
  ${sgroup("Bars and plates", [["Default bar", val("45 lb")], ["Plates", plateChips([45, 35, 25, 10, 5, 2.5], 0.8)], ["Plate colors", val("Standard bumper")], ["Collars", val("0 lb")]])}
  ${sgroup("Equipment you own", [["Foam roller", toggle(true)], ["Theragun (percussion)", toggle(true)], ["Bike", toggle(true)], ["Rower", toggle(false)], ["Treadmill", toggle(false)]])}
  ${sgroup("Warm-up", [["Build a warm-up before lifting", toggle(true)], ["Soft tissue with your tools", toggle(true)], ["Prefer Theragun where allowed", toggle(true), "Never on sore muscles or before your heaviest sets"], ["Time for warm-up", val("15 min")]])}
  ${sgroup("Rest timer", [["Set rest automatically", toggle(true), "From your last set, your check-in and the lift"], ["Learn from my taps", toggle(true), "Ready early and +30 s adjust your pace"], ["Show plates for the next set", toggle(true)], ["Alert", val("Vibrate + sound")]])}
  ${sgroup("Check-ins", [["Soreness before lifting", toggle(true)], ["Effort after sessions", toggle(true)], ["Daily sleep and stress", toggle(false)]])}
  ${sgroup("Running", [["Audio cues", val("Every 0.5 mi")], ["Auto-pause", toggle(true)], ["Heart-rate strap", val("Not paired")], ["Offline map area", val("[Your region]")]])}
  ${sgroup("Coach", [["Status", `<span style="font-size: 12px; color: var(--success);">online</span>`, "Gemma 4 E4B on callisto"], ["Let coach adjust within limits", toggle(true)], ["Coach memory", val("12 facts")]])}
  ${sgroup("Appearance", [["Theme", seg(["Light", "Dark", "Auto"], 0, "width: 180px;")], ["Title font", val("Qala Test")]])}
</div>
`);

// ================= PHONE: running =================

board("RunStart.dc.html", { w: W, h: 844, title: "Run: start", page: "phone", x: col(0), y: rowC }, `
${topBar(iconBtn("chevron-left"), `<div style="font-size: 14px; font-weight: 500;">Easy run</div>`, iconBtn("volume-2"))}
<div>${map(W, 470, { markers: false, puck: true, faded: true })}</div>
<div style="position: absolute; left: 16px; top: 482px;">${chip(`${icon("signal-high", 14, "color: var(--progress);")} GPS strong`, "background: var(--surface); border: 2px solid var(--border);")}</div>
<div style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">
  ${group("Planned today", `<div style="display: flex; justify-content: space-between; align-items: center;"><div>${ctitle("3.0 mi easy", 18)}<div style="font-size: 11px; color: var(--muted);">10:45-11:30 /mi · start slow, no warm-up needed</div></div>${icon("chevron-right", 18, "color: var(--muted);")}</div>`)}
  ${cta(`${icon("play", 18)} Start run`, "height: 56px; font-size: 16px;")}
</div>
`);

const runControls = `<div style="position: absolute; left: 0; right: 0; bottom: 34px; display: flex; justify-content: space-around; align-items: center;">${iconBtn("route", "width: 56px; height: 56px; border: 2px solid var(--border);")}<div style="width: 84px; height: 84px; border-radius: 6px; background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-cta); display: flex; align-items: center; justify-content: center;">${icon("pause", 36)}</div>${iconBtn("settings", "width: 56px; height: 56px; border: 2px solid var(--border);")}</div>`;
board("LiveRun.dc.html", { w: W, h: 844, title: "Run: live", page: "phone", x: col(1), y: rowC }, `
<div style="height: 56px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between;">${chip(`${icon("signal-high", 14, "color: var(--progress);")} GPS`, "background: transparent;")}<div class="label">Easy run</div>${iconBtn("volume-2")}</div>
<div style="text-align: center; padding: 18px 0 20px;">${fig("24:18", 84, "", true)}<div class="label" style="margin-top: 10px;">Time</div></div>
<div style="text-align: center; padding: 22px 0; border-top: 2px solid var(--border);">${fig("2.28", 150, "", true)}<div class="label" style="margin-top: 12px;">Miles</div></div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 2px solid var(--border);"><div style="text-align: center; padding: 22px 0;">${fig("10:39", 50, "", true)}<div class="label" style="margin-top: 10px;">Current pace</div></div><div style="text-align: center; padding: 22px 0; border-left: 2px solid var(--border);">${fig("10:40", 50, "", true)}<div class="label" style="margin-top: 10px;">Avg pace</div></div></div>
${runControls}
`);

board("GuidedRun.dc.html", { w: W, h: 844, title: "Run: guided surges", page: "phone", x: col(2), y: rowC }, `
<div style="height: 56px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between;">${chip(`${icon("signal-high", 14, "color: var(--progress);")} GPS`, "background: transparent;")}<div class="label">Surges · 3 of 6</div>${iconBtn("volume-2")}</div>
<div style="padding: 0 20px; text-align: center;">${title("Surge", 40, "color: var(--accent);")}${fig("0:42", 116, "margin-top: 8px;", true)}<div class="label" style="margin-top: 8px;">Left in this step</div></div>
<div style="padding: 24px 20px 0;"><div style="position: relative; height: 62px;"><div style="position: absolute; left: 0; right: 0; top: 24px; height: 14px; border-radius: 2px; background: var(--active);"></div><div style="position: absolute; left: 38%; width: 26%; top: 24px; height: 14px; background: var(--progress-fill);"></div><div style="position: absolute; left: 38%; width: 26%; top: 0; text-align: center; font-size: 11px; color: var(--progress);">8:30-9:00</div><div style="position: absolute; left: calc(72% - 2px); top: 16px; width: 4px; height: 30px; background: var(--route);"></div><div style="position: absolute; left: calc(72% - 30px); top: 48px; width: 60px; text-align: center; font-size: 11px; color: var(--route);">9:12</div></div>
<div style="display: flex; justify-content: center; margin-top: 10px;">${chip(`${icon("zap", 16)} Speed up a little`, "height: 36px; font-size: 13px; color: var(--accent); background: var(--accent-subtle);")}</div></div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 20px; border-top: 2px solid var(--border); border-bottom: 2px solid var(--border);"><div style="padding: 14px 0; text-align: center;">${fig("1.84", 36, "", true)}<div class="label" style="margin-top: 6px;">Miles</div></div><div style="padding: 14px 0; text-align: center; border-left: 2px solid var(--border);">${fig("19:06", 36, "", true)}<div class="label" style="margin-top: 6px;">Time</div></div></div>
${runControls}
`);

board("RunSummary.dc.html", { w: W, h: 960, title: "Run: summary", page: "phone", x: col(3), y: rowC }, `
${topBar(iconBtn("chevron-left"), `<div style="font-size: 14px; font-weight: 500;">Easy run <span style="color: var(--muted);">6:12 pm</span></div>`, iconBtn("ellipsis-vertical"))}
<div>${map(W, 250)}</div>
<div style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">
  ${title("3.02 mi, easy and steady", 28)}
  ${group("Summary", `<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 8px;">${[["3.02", "miles"], ["32:41", "time"], ["10:50", "avg pace"], ["118", "elev ft"], ["142", "avg HR"], ["34", "load"]].map(([v, k]) => `<div>${fig(v, 26)}<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">${k}</div></div>`).join("")}</div>`)}
  ${group("Splits", `<div class="label" style="display: grid; grid-template-columns: 34px repeat(3, minmax(0, 1fr)) 60px; gap: 6px;"><div>Mi</div><div>Pace</div><div>Grade adj</div><div>Elev</div><div></div></div>${[["1", "10:58", "10:41", "+42", 78], ["2", "10:44", "10:49", "-8", 92], ["3", "10:47", "10:44", "+12", 88]].map(([m, p, g, e, b]) => `<div class="tick" style="display: grid; grid-template-columns: 34px repeat(3, minmax(0, 1fr)) 60px; gap: 6px; align-items: center; min-height: 38px; border-top: 2px solid var(--border); font-size: 13px;"><div style="color: var(--muted);">${m}</div><div>${p}</div><div style="color: var(--fg2);">${g}</div><div style="color: var(--fg2);">${e}</div><div style="height: 8px; border-radius: 2px; background: var(--active);"><div style="width: ${b}%; height: 8px; border-radius: 2px; background: var(--route);"></div></div></div>`).join("")}`)}
  ${card(`<div style="display: flex; gap: 10px;">${icon("activity", 18, "color: var(--progress); margin-top: 2px;")}<div style="font-size: 13px;">Light leg load. Tomorrow's squat is unaffected, and running fitness ticked up.</div></div>`, "padding: 12px 14px;")}
  ${cta("Save run")}
</div>
`);

// ================= TODAY (owner's pick, round 4) =================
// Hero card with this week's load (today outlined and named), a readiness ring out of 100 with average and
// low markers, a big Start button, and a timeline rail on the left that flicks between the day's stages.
const READY = { value: 72, avg: 76, low: 64 };
function readinessRing({ value, avg, low }, size = 88) {
  const c = 52, r = 42, sw = 9, C = 2 * Math.PI * r;
  const pt = (p, rad) => { const a = ((-90 + 3.6 * p) * Math.PI) / 180; return [c + rad * Math.cos(a), c + rad * Math.sin(a)]; };
  const tick = (p, color) => { const [x1, y1] = pt(p, r - sw / 2 - 3); const [x2, y2] = pt(p, r + sw / 2 + 5); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" style="stroke: ${color}; stroke-width: 3; stroke-linecap: round;"></line>`; };
  const arc = (p, color, width, cap) => `<circle cx="${c}" cy="${c}" r="${r}" style="fill: none; stroke: ${color}; stroke-width: ${width}; stroke-linecap: ${cap}; stroke-dasharray: ${((C * p) / 100).toFixed(1)} ${C.toFixed(1)}; transform: rotate(-90deg); transform-origin: ${c}px ${c}px;"></circle>`;
  return `<svg viewBox="0 0 104 104" style="width: ${size}px; height: ${size}px; display: block; overflow: visible;">
    <circle cx="${c}" cy="${c}" r="${r}" style="fill: none; stroke: var(--active); stroke-width: ${sw};"></circle>
    ${arc(low, "var(--low-zone)", sw, "butt")}
    ${arc(value, value < low ? "var(--danger)" : "var(--progress-fill)", sw - 5, "round")}
    ${tick(low, "var(--danger)")}${tick(avg, "var(--fg)")}
    <text x="${c}" y="${c + 8}" text-anchor="middle" class="fig" style="fill: var(--fg); font-size: 30px;">${value}</text>
    <text x="${c}" y="${c + 23}" text-anchor="middle" style="fill: var(--muted); font: 400 9px 'DM Mono', monospace;">of 100</text>
  </svg>`;
}
const ringLegend = ({ avg, low }) => `<div style="display: flex; flex-direction: column; gap: 3px; font-size: 10px; color: var(--muted); margin-top: 6px;"><span style="display: flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 3px; border-radius: 2px; background: var(--fg);"></span>your avg ${avg}</span><span style="display: flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 3px; border-radius: 2px; background: var(--danger);"></span>low under ${low}</span></div>`;

const WEEK = [["M", 320, 0], ["T", 0, 160], ["W", 300, 0], ["T", 60, 220], ["F", 280, 0], ["S", 0, 0], ["S", 340, 110]];
function weekChart({ todayLabel, liftDone = false, runDone = false, w = 274, h = 160 }) {
  const top = 34, base = h - 24, scale = (base - top) / 470, colW = w / 7, barW = 18;
  const cols = WEEK.map(([d, l, r], i) => {
    const today = i === 6, x = i * colW + (colW - barW) / 2, lh = l * scale, rh = r * scale;
    const liftPlanned = today && !liftDone, runPlanned = today && !runDone;
    return `${today ? `<rect x="${(i * colW + 1).toFixed(1)}" y="${top - 12}" width="${(colW - 2).toFixed(1)}" height="${base - top + 30}" rx="4" style="fill: var(--accent-subtle); stroke: var(--accent); stroke-width: 2;"></rect>` : ""}
      ${lh ? `<rect x="${(x + (liftPlanned ? 1 : 0)).toFixed(1)}" y="${(base - lh).toFixed(1)}" width="${barW - (liftPlanned ? 2 : 0)}" height="${(lh - (liftPlanned ? 1 : 0)).toFixed(1)}" style="${liftPlanned ? "fill: none; stroke: var(--fg); stroke-width: 2;" : "fill: var(--fg);"}"></rect>` : ""}
      ${rh ? `<rect x="${(x + (runPlanned ? 1 : 0)).toFixed(1)}" y="${(base - lh - rh - (lh ? 2 : 0)).toFixed(1)}" width="${barW - (runPlanned ? 2 : 0)}" height="${rh.toFixed(1)}" rx="3" style="${runPlanned ? "fill: none; stroke: var(--run); stroke-width: 2;" : "fill: var(--run);"}"></rect>` : ""}
      <text x="${(i * colW + colW / 2).toFixed(1)}" y="${h - 7}" text-anchor="middle" style="fill: ${today ? "var(--accent)" : "var(--muted)"}; font: ${today ? 500 : 400} 10px 'DM Mono', monospace;">${today ? "Sun" : d}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" style="display: block; width: 100%; overflow: visible;">
    <text x="${w - 2}" y="12" text-anchor="end" style="fill: var(--accent); font: 500 11px 'DM Mono', monospace;">${todayLabel}</text>
    <line x1="${(w - colW / 2).toFixed(1)}" y1="16" x2="${(w - colW / 2).toFixed(1)}" y2="${top - 12}" style="stroke: var(--accent); stroke-width: 2;"></line>
    <line x1="0" y1="${base}" x2="${w}" y2="${base}" style="stroke: var(--grid); stroke-width: 1;"></line>
    ${cols}
  </svg>`;
}
const weekLegend = `<div style="display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 10px; color: var(--fg2); margin-top: 6px;"><span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 10px; background: var(--fg);"></span>lifting</span><span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 10px; border-radius: 2px; background: var(--run);"></span>running</span><span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 10px; height: 10px; border: 2px solid var(--fg2);"></span>still planned</span></div>`;

const STAGES = [["6:52", "circle-check", "Check-in"], ["7:00", "flame", "Warm-up"], ["7:15", "dumbbell", "Lift"], ["8:15", "hourglass", "Recover"], ["6 pm", "sport-shoe", "Run"], ["10:30", "moon", "Wind down"]];
function rail(current) {
  return `<div style="position: absolute; left: 0; top: 60px; bottom: 72px; width: 70px; display: flex; flex-direction: column; align-items: center; padding: 4px 0 8px;">
    <div style="color: var(--faint); transform: rotate(180deg);">${icon("chevron-down", 18)}</div>
    <div style="position: relative; flex-grow: 1; width: 100%; display: flex; flex-direction: column; justify-content: space-around;">
      <div style="position: absolute; left: 34px; top: 24px; bottom: 24px; width: 2px; background: var(--border2);"></div>
      ${STAGES.map(([t, ic, label], i) => {
        const done = i < current, now = i === current;
        return `<div style="position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;">
          <div style="width: ${now ? 42 : 30}px; height: ${now ? 42 : 30}px; border-radius: 6px; display: flex; align-items: center; justify-content: center; ${done ? "background: var(--progress-fill); color: #ffffff;" : now ? "background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-cta);" : "background: var(--bg); border: 2px solid var(--border2); color: var(--fg2);"}">${icon(done ? "check" : ic, now ? 20 : 15)}</div>
          <div style="font-size: 9px; line-height: 1.2; text-align: center; color: ${now ? "var(--fg)" : "var(--muted)"}; font-weight: ${now ? 500 : 400}; background: var(--bg); padding: 1px 3px;">${label}<br>${t}</div>
        </div>`;
      }).join("")}
    </div>
    <div style="color: var(--faint);">${icon("chevron-down", 18)}</div>
  </div>`;
}
const todayHeader = (label) => `<div style="height: 60px; padding: 0 12px 0 18px; display: flex; align-items: center; justify-content: space-between;"><div class="label">${label}</div><div style="display: flex; gap: 2px;">${iconBtn("history")}${iconBtn("settings")}</div></div>`;
const stageCol = (inner) => `<div style="position: absolute; left: 70px; right: 14px; top: 60px; bottom: 72px; display: flex; flex-direction: column; gap: 12px; padding-top: 4px;">${inner}</div>`;
const heroCard = (inner) => `<div style="background: var(--surface); border: 2px solid var(--border); border-radius: 6px; padding: 14px; box-shadow: var(--shadow-card); display: flex; flex-direction: column; gap: 12px;">${inner}</div>`;
const bigCta = (text) => cta(text, "height: 64px; font-size: 17px;");
const sectionLabel = (t, right = "") => `<div style="display: flex; justify-content: space-between; align-items: baseline;"><div class="label">${t}</div>${right}</div>`;

board("Main.dc.html", { w: W, h: 1000, title: "Today · morning", page: "today", x: 0, y: 0, nav: true }, `
${todayHeader("Sunday, Sep 13 · Week 3 of 6")}
${rail(1)}
${stageCol(`
  ${heroCard(`
    <div class="label" style="color: var(--accent);">Now · warm-up, then lift</div>
    ${title("Lower A · Squat day", 28)}
    <div style="display: flex; gap: 10px; align-items: flex-start; justify-content: space-between;">
      <div style="font-size: 12px; color: var(--fg2); line-height: 1.55; padding-top: 4px;">Squat 3 × 4 at 245<br>Quads 4 · slept 6 h<br><span style="color: var(--muted);">A little under your average, so squat holds.</span></div>
      <div style="display: flex; flex-direction: column; align-items: center; flex: none;">${readinessRing(READY)}${ringLegend(READY)}</div>
    </div>
    <div style="border-top: 2px solid var(--border); padding-top: 10px;">${sectionLabel("This week's load", `<span style="font-size: 10px; color: var(--muted); white-space: nowrap;">1,340 / 1,790</span>`)}${weekChart({ todayLabel: "Lower A · Squat day" })}${weekLegend}</div>
    <div style="display: flex; gap: 2px; height: 24px; border-radius: 4px; overflow: hidden; font-size: 10px;"><div style="flex-grow: 15; background: var(--viz1); color: #ffffff; display: flex; align-items: center; padding-left: 6px;">warm-up 15</div><div style="flex-grow: 55; background: var(--viz2); color: #ffffff; display: flex; align-items: center; padding-left: 6px;">Lower A 55 min</div></div>
    ${bigCta(`${icon("play", 22)} Start warm-up`)}
  `)}
  ${card(`<div style="display: flex; align-items: center; gap: 10px;">${icon("sport-shoe", 20, "color: var(--run);")}<div style="flex-grow: 1;"><div class="label">Then</div>${ctitle("Easy run · 3.0 mi · 6 pm", 15)}</div>${icon("chevron-right", 18, "color: var(--muted);")}</div>`, "padding: 10px 12px;")}
`)}
${nav("Today", "Plan")}
`);

board("TodayAfterLift.dc.html", { w: W, h: 1000, title: "Today · after the lift", page: "today", x: 470, y: 0, nav: true }, `
${todayHeader("Sunday, Sep 13 · 8:20 am")}
${rail(3)}
${stageCol(`
  ${heroCard(`
    <div class="label" style="color: var(--accent);">Now · recover</div>
    ${title("Lift done", 30)}
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;">${[["58", "min"], ["20,420", "lb · +6%"], ["1", "PR · RDL"]].map(([v, k]) => `<div>${fig(v, 26)}<div style="font-size: 10px; color: var(--muted); margin-top: 4px;">${k}</div></div>`).join("")}</div>
    <div style="border-top: 2px solid var(--border); padding-top: 10px;">${sectionLabel("This week's load", `<span style="font-size: 10px; color: var(--muted); white-space: nowrap;">1,680 / 1,790</span>`)}${weekChart({ todayLabel: "Lower A done · run at 6 pm", liftDone: true })}${weekLegend}</div>
    <div style="display: flex; gap: 10px; align-items: flex-start; font-size: 12px; color: var(--fg2);">${icon("activity", 18, "color: var(--progress); margin-top: 1px;")}<span>Quads took most of today's load and recover by Tuesday. Eat well and walk; tonight's run stays easy.</span></div>
    ${bigCta(`${icon("list-checks", 22)} See session`)}
    ${btn(`${icon("sport-shoe", 16)} Run earlier instead`, "min-height: 40px;")}
  `)}
  ${card(`<div style="display: flex; align-items: center; gap: 10px;">${icon("sport-shoe", 20, "color: var(--run);")}<div style="flex-grow: 1;"><div class="label">Next · in 9 h 40 m</div>${ctitle("Easy run · 3.0 mi · 6 pm", 15)}</div>${icon("chevron-right", 18, "color: var(--muted);")}</div>`, "padding: 10px 12px;")}
`)}
${nav("Today", "Plan")}
`);

board("TodayEvening.dc.html", { w: W, h: 1000, title: "Today · evening", page: "today", x: 940, y: 0, nav: true }, `
${todayHeader("Sunday, Sep 13 · 9:40 pm")}
${rail(5)}
${stageCol(`
  ${heroCard(`
    <div class="label" style="color: var(--accent);">Now · wind down</div>
    ${title("Day complete", 30)}
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;">${[["58", "min lift"], ["3.02", "mi run"], ["450", "load today"]].map(([v, k]) => `<div>${fig(v, 26)}<div style="font-size: 10px; color: var(--muted); margin-top: 4px;">${k}</div></div>`).join("")}</div>
    <div style="border-top: 2px solid var(--border); padding-top: 10px;">${sectionLabel("This week's load", `<span style="font-size: 10px; color: var(--muted);">1,790 of 1,790</span>`)}${weekChart({ todayLabel: "Lower A + easy run", liftDone: true, runDone: true })}${weekLegend}</div>
    <div style="display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 4px; background: var(--recessed);">${icon("bed", 22, "color: var(--fg2);")}<div style="flex-grow: 1;"><div class="label">Tomorrow</div>${ctitle("Monday · rest day", 16)}<div style="font-size: 11px; color: var(--muted);">Bench on Tuesday</div></div></div>
    <div style="display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 4px; background: var(--recessed);">${icon("moon", 22, "color: var(--fg2);")}<div style="flex-grow: 1;"><div class="label">Sleep</div>${ctitle("Lights out by 10:30", 16)}<div style="font-size: 11px; color: var(--muted);">8 h gives Tuesday's bench its best shot</div></div></div>
    ${bigCta(`${icon("list-checks", 22)} See day summary`)}
  `)}
`)}
${nav("Today", "Plan")}
`);

// ================= TODAY DIRECTIONS (round 3 options, kept for reference) =================

const TD = (i) => i * 470;
board("TodayA.dc.html", { w: W, h: 1000, title: "Today A · Hero session", page: "today-options", x: TD(0), y: 0, nav: true }, `
<div style="padding: 14px 18px 96px; display: flex; flex-direction: column; gap: 14px;">
  <div style="display: flex; align-items: center; justify-content: space-between;"><div class="label">Sunday · Week 3 of 6</div><div style="display: flex; gap: 4px;">${iconBtn("history")}${iconBtn("settings")}</div></div>
  ${title("Squat day", 44)}
  <div style="background: var(--surface); border: 2px solid var(--border); border-radius: 6px; overflow: hidden; box-shadow: var(--shadow-card);">
    <div style="padding: 16px 16px 8px; display: flex; justify-content: space-between; align-items: flex-start;">
      <div><div class="label">Top sets</div><div style="display: flex; align-items: baseline; gap: 8px; margin-top: 6px;">${fig("245", 56)}<span style="font-size: 14px; color: var(--muted);">× 4 × 3</span></div><div style="font-size: 12px; color: var(--fg2); margin-top: 4px;">Held from last week · quads still sore</div></div>
      <div style="text-align: center;"><svg viewBox="0 0 64 64" style="width: 64px; height: 64px;"><circle cx="32" cy="32" r="26" style="fill: none; stroke: var(--active); stroke-width: 6;"></circle><circle cx="32" cy="32" r="26" style="fill: none; stroke: var(--progress-fill); stroke-width: 6; stroke-dasharray: 117.6 163.4; transform: rotate(-90deg); transform-origin: 32px 32px;"></circle><text x="32" y="38" text-anchor="middle" class="fig" style="fill: var(--fg); font-size: 20px;">72</text></svg><div style="font-size: 10px; color: var(--muted);">ready</div></div>
    </div>
    <div style="padding: 0 16px;">${barbell([45, 45, 10], { w: 340, h: 120 })}</div>
    <div style="padding: 10px 16px 16px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; gap: 2px; height: 26px; border-radius: 4px; overflow: hidden; font-size: 10px;"><div style="flex-grow: 15; background: var(--viz1); color: #fff; display: flex; align-items: center; padding-left: 6px;">warm-up 15</div><div style="flex-grow: 55; background: var(--viz2); color: #fff; display: flex; align-items: center; padding-left: 6px;">Lower A 55 min</div></div>
      ${cta(`${icon("play", 18)} Start warm-up`)}
    </div>
  </div>
  ${card(`<div style="display: flex; align-items: center; gap: 12px;">${icon("sport-shoe", 22, "color: var(--run);")}<div style="flex-grow: 1;">${ctitle("Easy run · 3.0 mi", 16)}<div style="font-size: 11px; color: var(--muted);">after 6 pm, 6 h after squats</div></div>${icon("chevron-right", 18, "color: var(--muted);")}</div>`, "padding: 12px 14px;")}
  ${card(`<div style="display: flex; gap: 10px; align-items: flex-start;">${icon("message-square-text", 18, "margin-top: 2px;")}<div style="font-size: 13px;">Four hard sessions this week. Tomorrow works well as a rest day.</div></div>`, "padding: 12px 14px;")}
</div>
${nav("Today", "Plan")}
`);

const timeline = [["6:52", "circle-check", "Checked in", "Recovery 6 · quads 4 · readiness 72", "done"], ["7:00", "flame", "Warm-up", "Bike 10 · roller + Theragun · ramp to 215", "now"], ["7:15", "dumbbell", "Lower A", "Squat 3 × 4 at 245 · 6 exercises · 55 min", "next"], ["12:00", "hourglass", "Recovery window", "Eat well · legs recover before the run", "later"], ["6:00 pm", "sport-shoe", "Easy run", "3.0 mi at 10:45-11:30", "later"], ["10:30 pm", "moon", "Sleep target", "8 h helps Tuesday's bench", "later"]];
board("TodayB.dc.html", { w: W, h: 1000, title: "Today B · Day timeline", page: "today-options", x: TD(1), y: 0, nav: true }, `
<div style="padding: 14px 18px 96px; display: flex; flex-direction: column; gap: 12px;">
  <div style="display: flex; align-items: center; justify-content: space-between;"><div class="label">Week 3 of 6</div><div style="display: flex; gap: 4px;">${iconBtn("history")}${iconBtn("settings")}</div></div>
  ${title("Sunday, Sep 13", 36)}
  <div style="position: relative; padding-left: 70px;">
    <div style="position: absolute; left: 83px; top: 8px; bottom: 8px; width: 2px; background: var(--border2);"></div>
    ${timeline.map(([t, ic, h, s, st]) => `<div style="position: relative; display: flex; gap: 14px; padding: 10px 0;">
      <div style="position: absolute; left: -70px; top: 16px; width: 58px; text-align: right; font-size: 11px; color: ${st === "now" ? "var(--accent)" : "var(--muted)"};">${t}</div>
      <div style="position: relative; z-index: 1; width: 28px; height: 28px; border-radius: 4px; flex: none; display: flex; align-items: center; justify-content: center; ${st === "done" ? "background: var(--progress-fill); color: #fff;" : st === "now" ? "background: var(--accent); color: var(--on-accent);" : "background: var(--surface); border: 2px solid var(--border2); color: var(--fg2);"}">${icon(ic, 16)}</div>
      <div style="flex-grow: 1; ${st === "now" ? "background: var(--surface); border: 2px solid var(--accent); border-radius: 6px; padding: 10px 12px; margin-top: -4px;" : ""}">${ctitle(h, st === "now" ? 20 : 16, st === "done" ? "color: var(--muted);" : "")}<div style="font-size: 11px; color: var(--muted); margin-top: 2px;">${s}</div>${st === "now" ? `<div style="margin-top: 10px;">${cta(`${icon("play", 16)} Start warm-up`, "height: 44px; font-size: 13px;")}</div>` : ""}</div>
    </div>`).join("")}
  </div>
</div>
${nav("Today", "Plan")}
`);

const weekLoad = [["M", 320, 0], ["T", 0, 160], ["W", 300, 0], ["T", 60, 220], ["F", 280, 0], ["S", 0, 0], ["S", 340, 110]];
board("TodayC.dc.html", { w: W, h: 1000, title: "Today C · Body and week", page: "today-options", x: TD(2), y: 0, nav: true }, `
<div style="padding: 14px 18px 96px; display: flex; flex-direction: column; gap: 14px;">
  <div style="display: flex; align-items: center; justify-content: space-between;"><div class="label">Sunday, Sep 13</div><div style="display: flex; gap: 4px;">${iconBtn("history")}${iconBtn("settings")}</div></div>
  <div style="display: flex; align-items: flex-end; justify-content: space-between;"><div>${title("Good morning", 34)}<div style="font-size: 12px; color: var(--fg2); margin-top: 4px;">Legs are the limiter today</div></div><div style="text-align: right;">${fig("72", 52)}<div style="font-size: 10px; color: var(--muted);">readiness · avg 76</div></div></div>
  ${group("What's still loaded", [["Quads", 0.78, "ready Tue"], ["Glutes", 0.48, "ready Mon"], ["Calves", 0.38, "ready Mon"]].map(([m, v, s]) => `<div style="display: grid; grid-template-columns: 70px minmax(0, 1fr) 72px; gap: 10px; align-items: center; min-height: 30px; font-size: 13px;"><span>${m}</span><div style="height: 10px; border-radius: 2px; background: var(--active);"><div style="width: ${v * 100}%; height: 10px; border-radius: 2px; background: var(--fg);"></div></div><span style="font-size: 11px; color: var(--fg2); text-align: right;">${s}</span></div>`).join("") + `<div style="font-size: 11px; color: var(--muted); margin-top: 6px;">Everything else is ready.</div>`)}
  ${group("This week's load", `<svg viewBox="0 0 354 120" style="display: block; width: 100%;"><line x1="0" y1="100" x2="354" y2="100" style="stroke: var(--grid);"></line>${weekLoad.map(([d, l, r], i) => { const x = 10 + i * 49, s = 0.2; const lh = l * s, rh = r * s; const planned = i === 6; return `${lh ? `<rect x="${x}" y="${100 - lh}" width="24" height="${lh}" style="fill: ${planned ? "none" : "var(--fg)"}; ${planned ? "stroke: var(--fg); stroke-width: 2;" : ""}"></rect>` : ""}${rh ? `<rect x="${x}" y="${100 - lh - rh - (lh ? 2 : 0)}" width="24" height="${rh}" rx="3" style="fill: ${planned ? "none" : "var(--run)"}; ${planned ? "stroke: var(--run); stroke-width: 2;" : ""}"></rect>` : ""}<text x="${x + 12}" y="116" text-anchor="middle" style="fill: ${planned ? "var(--fg)" : "var(--muted)"}; font: 500 10px 'DM Mono', monospace;">${d}</text>`; }).join("")}</svg><div style="display: flex; gap: 14px; font-size: 11px; color: var(--fg2); margin-top: 4px;"><span style="display: inline-flex; align-items: center; gap: 6px;"><span style="width: 10px; height: 10px; background: var(--fg);"></span>lifting</span><span style="display: inline-flex; align-items: center; gap: 6px;"><span style="width: 10px; height: 10px; border-radius: 2px; background: var(--run);"></span>running</span><span style="color: var(--muted);">outline = today</span></div>`)}
  ${group("Block", `<div style="display: flex; align-items: center; gap: 12px;"><div style="flex-grow: 1; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 3px;">${[1, 1, 2, 0, 0, 3].map((s) => `<div style="height: 10px; border-radius: 2px; background: ${s === 1 ? "var(--fg2)" : s === 2 ? "var(--accent)" : s === 3 ? "var(--border2)" : "var(--active)"};"></div>`).join("")}</div><span style="font-size: 12px;">week 3 of 6</span></div><div style="font-size: 12px; color: var(--fg2); margin-top: 8px;">Squat 294 est. · 300 is in reach by week 5</div>`)}
  ${card(`<div>${ctitle("Lower A · 245 × 4 × 3", 17)}<div style="font-size: 11px; color: var(--muted);">warm-up 15 · lift 55 · easy run 3 mi at 6 pm</div></div><div style="margin-top: 10px;">${cta(`${icon("play", 16)} Start warm-up`, "height: 46px; font-size: 14px;")}</div>`, "padding: 14px;")}
</div>
${nav("Today", "Plan")}
`);

// ================= DESKTOP =================

const sidebar = (active) => `<div style="position: absolute; left: 0; top: 0; bottom: 0; width: 232px; background: var(--surface); border-right: 2px solid var(--border); padding: 18px 12px; display: flex; flex-direction: column; gap: 2px;">
  <div style="display: flex; align-items: center; gap: 10px; padding: 0 8px 18px;"><div style="width: 36px; height: 36px; border-radius: 6px; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center;">${icon("dumbbell", 20)}</div>${title("Qala", 28)}</div>
  ${[["Today", "sun"], ["Plan", "calendar-range"], ["Programs", "list-checks"], ["Run plans", "route"], ["Exercises", "dumbbell"], ["Body", "activity"], ["Progress", "trending-up"], ["Coach", "message-square-text"], ["Settings", "settings"]].map(([t, ic]) => `<div style="height: 40px; padding: 0 10px; border-radius: 4px; display: flex; align-items: center; gap: 12px; font-size: 13px; ${t === active ? "background: var(--active); color: var(--fg); font-weight: 500;" : "color: var(--fg2);"}">${icon(ic, 18)}${t}</div>`).join("")}
  <div style="margin-top: auto; padding: 10px; font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 8px;"><div style="width: 8px; height: 8px; border-radius: 2px; background: var(--success);"></div>synced · coach online</div>
</div>`;
const codeLines = [["c", "# Week 3"], ["h", "## Day 1: Hypertrophy"], ["x", "Squat / 4x7 / 77% / 150s / progress: custom() {~"], ["x", "  if (recWeightPct < 0) { weights *= 1 + recWeightPct / 100 }"], ["x", "~}"], ["x", "Bench Press / 4x7 / 77% / 120s"], ["b", ""], ["h", "## Day 2: Power"], ["x", "Squat / 5x1 / 85% / 180s"], ["x", "Bench Press / 5x1 / 85% / 180s"], ["b", ""], ["h", "## Day 3: Strength"], ["e", "Pause Squat Tempo / 3x3 / 88% / 240s"], ["x", "Bench Press / 3x3 / 88% / 240s"], ["x", "Deadlift / 3x3 / 88% / 240s"]];
const hl = (s) => s.replace(/(\d+(\.\d+)?%|\d+x\d+|\d+s|RPE \d+)/g, `<span style="color: var(--accent);">$1</span>`).replace(/\b(progress|custom|if|weights|recWeightPct)\b/g, `<span style="color: var(--route);">$1</span>`);
board("DesktopEditor.dc.html", { w: 1440, h: 900, title: "Desktop: program editor", page: "desktop", x: 1560, y: 0 }, `
${sidebar("Programs")}
<div style="position: absolute; left: 232px; right: 0; top: 0; height: 68px; padding: 0 24px; border-bottom: 2px solid var(--border); background: var(--surface); display: flex; align-items: center; gap: 14px;"><div style="flex-grow: 1;">${title("Strength block 2", 24)}<div style="font-size: 11px; color: var(--muted);">DUP · 5 weeks + deload · 4 days · reference 1RMs set Aug 24</div></div>${chip("saved · synced")}${btn(`${icon("zap", 16)} Generate next block`)}</div>
<div style="position: absolute; left: 232px; top: 68px; bottom: 0; width: 640px; border-right: 2px solid var(--border); background: var(--surface);">
  <div style="height: 42px; padding: 0 18px; display: flex; align-items: center; gap: 18px; border-bottom: 2px solid var(--border); font-size: 12px;"><span style="font-weight: 500;">program.liftoscript</span><span style="color: var(--muted);">Run plan</span><span style="color: var(--muted);">Warm-up rules</span></div>
  <div style="padding: 12px 0; font-size: 13px; line-height: 26px;">${codeLines.map(([k, s], i) => `<div style="display: grid; grid-template-columns: 50px minmax(0, 1fr); ${k === "e" ? "background: rgba(185,28,28,.07);" : ""}"><div style="text-align: right; padding-right: 14px; color: var(--faint);">${i + 1}</div><div style="white-space: pre; color: ${k === "c" ? "var(--muted)" : "var(--fg)"}; font-weight: ${k === "h" ? 500 : 400}; ${k === "e" ? "text-decoration: underline wavy var(--danger); text-underline-offset: 5px;" : ""}">${k === "x" || k === "e" ? hl(s) : s}</div></div>`).join("")}</div>
  <div style="position: absolute; left: 18px; right: 18px; bottom: 16px; padding: 10px 12px; border-radius: 4px; border: 2px solid var(--danger); background: var(--surface); display: flex; gap: 10px; align-items: center; font-size: 12px;">${icon("triangle-alert", 18, "color: var(--danger);")}<span>Line 13: unknown exercise "Pause Squat Tempo". Did you mean <b>Pause Squat</b>?</span></div>
</div>
<div style="position: absolute; left: 872px; right: 0; top: 68px; bottom: 0; padding: 18px 22px; display: flex; flex-direction: column; gap: 12px;">
  ${seg(["W1", "W2", "W3", "W4", "W5", "Deload"], 2)}
  ${[["Day 1 · Hypertrophy", [["Squat", "4 × 7", "215 lb"], ["Bench Press", "4 × 7", "170 lb"]]], ["Day 2 · Power", [["Squat", "5 × 1", "240 lb"], ["Bench Press", "5 × 1", "185 lb"]]], ["Day 3 · Strength", [["Pause Squat", "3 × 3", "245 lb"], ["Bench Press", "3 × 3", "195 lb"], ["Deadlift", "3 × 3", "310 lb"]]]].map(([d, rows]) => group(d, rows.map(([n, s, w]) => `<div style="display: grid; grid-template-columns: minmax(0, 1fr) 70px 70px; font-size: 13px; min-height: 28px; align-items: center;"><span>${n}</span><span style="color: var(--fg2);">${s}</span><span style="text-align: right;">${w}</span></div>`).join(""), { bodyStyle: "padding: 8px 14px;" })).join("")}
  ${group("Week 3 totals", `<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;">${[["14", "reps at 85%+"], ["10-12", "sets per muscle"], ["3 h 20 m", "incl. warm-ups"]].map(([v, k]) => `<div>${fig(v, 24)}<div style="font-size: 11px; color: var(--muted);">${k}</div></div>`).join("")}</div>`)}
</div>
`);

board("DesktopCoach.dc.html", { w: 1440, h: 900, title: "Desktop: coach memory", page: "desktop", x: 1560, y: 1040 }, `
${sidebar("Coach")}
<div style="position: absolute; left: 232px; right: 0; top: 0; bottom: 0; padding: 26px 30px; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 22px;">
  <div style="display: flex; flex-direction: column; gap: 12px;">${title("What the coach knows about you", 32)}<p style="margin: 0; color: var(--fg2);">Every fact is dated and sourced. Nothing the coach proposes is used until you accept it.</p>
    ${group("Memory", [["Pending", "gemma", "Sep 13", "Left knee gets cranky in weeks with more than 14 squat sets."], ["Accepted", "note", "Sep 6", "Narrower squat stance eases the left knee."], ["Accepted", "user", "Sep 2", "Trains at 6:30 am on weekdays; runs after work."], ["Accepted", "engine", "Aug 30", "Quads usually clear soreness in about 2.4 days."], ["Accepted", "engine", "Aug 28", "Starts the next squat set about 15 s before the timer."], ["Rejected", "gemma", "Aug 14", "Dislikes running in the rain."]]
      .map(([st, src, d, t], i) => `<div style="display: grid; grid-template-columns: 58px 62px minmax(0, 1fr) auto; gap: 12px; align-items: center; min-height: 58px; ${i ? "border-top: 2px solid var(--border);" : ""}"><span style="font-size: 11px; color: var(--muted);">${d}</span>${chip(src, "height: 24px; font-size: 11px; justify-content: center;")}<span style="font-size: 13px; color: ${st === "Rejected" ? "var(--muted)" : "var(--fg)"}; ${st === "Rejected" ? "text-decoration: line-through;" : ""}">${t}</span>${st === "Pending" ? `<div style="display: flex; gap: 6px;">${btn("Accept", "min-height: 34px;")}${btn("Reject", "min-height: 34px; border-color: transparent;")}</div>` : `<span style="font-size: 11px; color: var(--muted);">${st.toLowerCase()}</span>`}</div>`).join(""), { bodyStyle: "padding: 2px 16px;" })}</div>
  <div style="display: flex; flex-direction: column; gap: 12px;">
    ${group("Profile the coach reads", [["Squat", "p0 262 · k1 0.91 · θ 4.0 (prior, 18/20)"], ["Running", "VDOT 41.2 · CS 3.42 m/s"], ["Recovery", "quads 2.4 d · chest 1.9 d"], ["Rest pace", "strength main ×0.92"], ["Adherence", "92% of sessions, 6 wk"]].map(([k, v]) => `<div style="display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 10px; font-size: 12px; min-height: 28px;"><span style="color: var(--muted);">${k}</span><span>${v}</span></div>`).join(""))}
    ${group("Coach log", [["06:52", "check-in note", "sleep 6 h, left knee: watch", "kept"], ["07:41", "adjustment", "squat -4%", "used"], ["07:44", "explanation", "why squat held", "shown"], ["18:03", "adjustment", "+6%, out of limits, clamped", "discarded"]].map(([t, k, o, a], i) => `<div style="display: grid; grid-template-columns: 46px 96px minmax(0, 1fr) 64px; gap: 8px; align-items: center; min-height: 40px; font-size: 11px; ${i ? "border-top: 2px solid var(--border);" : ""}"><span style="color: var(--muted);">${t}</span><span style="color: var(--fg2);">${k}</span><span>${o}</span><span style="color: ${a === "discarded" ? "var(--danger)" : "var(--muted)"}; text-align: right;">${a}</span></div>`).join(""), { bodyStyle: "padding: 2px 14px;" })}
  </div>
</div>
`);

board("Landing.dc.html", { w: 1440, h: 2170, title: "Landing page", page: "desktop", x: 0, y: 0 }, `
<div style="height: 76px; padding: 0 72px; display: flex; align-items: center; gap: 32px; border-bottom: 2px solid var(--border); background: var(--surface);"><div style="display: flex; align-items: center; gap: 10px; flex-grow: 1;"><div style="width: 36px; height: 36px; border-radius: 6px; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center;">${icon("dumbbell", 20)}</div>${title("Qala", 30)}</div>${["How it decides", "Plans", "Running", "Coach"].map((t) => `<div style="font-size: 13px; color: var(--fg2);">${t}</div>`).join("")}${cta("Open Qala", "height: 44px; padding: 0 22px; font-size: 14px;")}</div>
<div style="padding: 84px 72px 72px; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 56px; align-items: center;">
  <div style="display: flex; flex-direction: column; gap: 22px;"><div class="label">Self-hosted training for lifting and running</div>${title("Lift and run from one plan.", 76)}<p style="margin: 0; font-size: 17px; line-height: 1.6; color: var(--fg2); max-width: 580px;">Qala warms you up, tells you what plates to load, times your rest from how the last set went, and records your runs. One fatigue model decides tomorrow. It runs on your own machine and syncs to your phone.</p><div style="display: flex; gap: 12px;">${cta("Open Qala", "padding: 0 28px;")}${btn("How it decides", "min-height: 52px; padding: 0 20px;")}</div><div style="font-size: 12px; color: var(--muted);">Sign-in is your Tailscale identity. No accounts, no cloud.</div></div>
  <div style="display: flex; flex-direction: column; gap: 16px;">
    ${group("Rest · set 3 of 3", `<div style="display: flex; align-items: center; gap: 20px;"><div>${fig("2:41", 72, "", true)}<div style="font-size: 12px; color: var(--muted); margin-top: 6px;">of 3:45 · +0:30 last set RPE 9</div></div><div style="flex-grow: 1;">${barbell([45, 45, 10], { w: 300, h: 120 })}</div></div>`, { style: "box-shadow: var(--shadow-card);" })}
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;">${group("Session", `${fig("20,420", 34)}<div style="font-size: 11px; color: var(--muted); margin: 4px 0 10px;">lb · +6%</div>${stackedBar(timeSeg, 260, 16)}`, { style: "box-shadow: var(--shadow-card);" })}${group("Easy run", `${fig("24:18", 34, "", true)}<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">2.28 mi · 10:40 /mi</div>`, { style: "box-shadow: var(--shadow-card);" })}</div>
  </div>
</div>
<div style="padding: 72px; background: var(--surface); border-top: 2px solid var(--border); border-bottom: 2px solid var(--border);"><div class="label">How it decides</div>${title("Runs and sets land in the same legs.", 52, "margin-top: 12px; max-width: 900px;")}
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin-top: 36px;">${[["flame", "Warm-ups fit the day", "Longer on sore muscles, ramp sets from your working weight, your own foam roller and Theragun."], ["hourglass", "Rest that adapts", "A hard last set, sore quads or a late set add time. Your taps teach it your pace."], ["calculator", "Plates, done for you", "Per side, color-coded, with what to change for the next set."], ["sport-shoe", "Runs count", "A hard run the night before squats lowers tomorrow's target, and says why."]].map(([ic, t, b]) => card(`<div style="width: 44px; height: 44px; border-radius: 4px; background: var(--recessed); display: flex; align-items: center; justify-content: center;">${icon(ic, 22)}</div>${ctitle(t, 22, "margin-top: 16px;")}<p style="margin: 8px 0 0; font-size: 13px; color: var(--fg2);">${b}</p>`, "padding: 22px; background: var(--bg);")).join("")}</div></div>
<div style="padding: 80px 72px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 56px; align-items: center;"><div><div class="label">Plans</div>${title("Your program is a text file you can read.", 52, "margin-top: 12px;")}<p style="margin: 18px 0 0; font-size: 16px; color: var(--fg2);">Write it on the desktop or generate a block from your goal. The phone shows one week, one day and one exercise at a time.</p></div>${card(`<div style="font-size: 14px; line-height: 28px; white-space: pre;">${[`<span style="color: var(--muted);"># Week 3</span>`, `## Day 3: Strength`, hl("Squat / 3x4 / 88% / 180s"), hl("Bench Press / 3x3 / 88% / 180s"), hl("Deadlift / 1x3 / 90% / 240s"), hl("Pull Up / 3x8 / RPE 8")].join("\n")}</div>`, "padding: 26px 30px;")}</div>
<div style="padding: 80px 72px; background: var(--surface); border-top: 2px solid var(--border); border-bottom: 2px solid var(--border); display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 56px; align-items: center;"><div style="border-radius: 6px; overflow: hidden; border: 2px solid var(--border);">${map(640, 340)}</div><div><div class="label">Running</div>${title("Then it records the run.", 52, "margin-top: 12px;")}<p style="margin: 18px 0 0; font-size: 16px; color: var(--fg2);">GPS with the screen locked, splits, audio cues and guided intervals. Run plans are scheduled around your heavy days.</p></div></div>
<div style="padding: 36px 72px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--muted);">${title("Qala", 26)}<div>Free software under AGPL-3.0. Program language and exercise data from liftosaur. Title font: Qala Test, an OFL fork of Faustina.</div></div>
`);

// ================= FOUNDATIONS =================

board("Foundations.dc.html", { w: 1320, h: 910, title: "Type, plates, charts, color", page: "foundations", x: 0, y: 0 }, `
<div style="padding: 44px 52px; display: flex; flex-direction: column; gap: 22px;">
  <div>${title("Qala foundations", 40)}<p style="margin: 6px 0 0; color: var(--fg2);">Titles and big numbers in Qala Test (the owner's font). Everything else in DM Mono. Beamer's tokens with an ember accent.</p></div>
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;">
    ${card(`<div class="label">Qala Test V2 Bold · titles</div>${title("Week 3 of 6", 40, "margin-top: 10px;")}${ctitle("Back Squat", 20, "margin-top: 8px;")}<div style="font-size: 11px; color: var(--muted); margin-top: 10px;">OFL fork of Faustina: narrower lowercase, unified serifs on n, l, a</div>`)}
    ${card(`<div class="label">Big numbers</div><div style="display: flex; gap: 24px; align-items: flex-end; margin-top: 10px;"><div>${fig("20,420", 44)}<div style="font-size: 10px; color: var(--muted); margin-top: 6px;">static · proportional</div></div><div>${fig("2:41", 44, "", true)}<div style="font-size: 10px; color: var(--muted); margin-top: 6px;">ticking · tabular</div></div></div>`)}
    ${card(`<div class="label">DM Mono · everything else</div><div style="font-size: 14px; margin-top: 12px; line-height: 1.6;">Squat holds at 245 lb.<br>Rest 3:45 · RPE 8 · 4 × 12</div><div style="font-size: 11px; color: var(--muted); margin-top: 10px;">Body, labels, tables, controls</div>`)}
  </div>
  <div style="display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px;">
    ${group("Plates · per side", `${barbell([45, 35, 25, 10, 5, 2.5], { w: 440, h: 150 })}<div style="display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;">${[55, 45, 35, 25, 10, 5, 2.5].map((p) => `<div style="display: flex; align-items: center; gap: 6px;">${plateChips([p], 1.1)}<span style="font-size: 10px; color: var(--muted);">${{ 55: "red", 45: "blue", 35: "yellow", 25: "green", 10: "white", 5: "charcoal", 2.5: "silver" }[p]}</span></div>`).join("")}</div><div style="font-size: 11px; color: var(--muted); margin-top: 8px;">55/45/35/25 follow the IWF colors that lb bumpers mirror; 10, 5, 2.5 have no standard. Every plate shows its number.</div>`)}
    ${group("Chart colors (validated)", `<div style="font-size: 12px; margin-bottom: 8px;">Time split · categorical</div>${stackedBar(timeSeg, 400, 18)}${legend(timeSeg, "")}<div style="font-size: 12px; margin: 16px 0 8px;">Intensity · one-hue ordinal ramp</div>${stackedBar(zones, 400, 18)}${legend(zones, "")}`)}
  </div>
  ${group("Icons · Lucide", `<div style="display: grid; grid-template-columns: repeat(15, minmax(0, 1fr)); gap: 12px;">${["sun", "calendar-range", "activity", "trending-up", "message-square-text", "flame", "hourglass", "calculator", "sticky-note", "layout-grid", "arrow-left-right", "cylinder", "vibrate", "bike", "dumbbell", "sport-shoe", "play", "pause", "settings", "pin", "bed", "moon", "route", "timer", "zap", "info", "check", "chevron-down", "history", "circle-check"].map((n) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">${icon(n, 24)}<div style="font-size: 9px; color: var(--muted); text-align: center;">${n}</div></div>`).join("")}</div>`)}
</div>
`);

// ---------- canvas.json ----------
const canvas = {
  pages: [
    { id: "phone", name: "Phone" },
    { id: "today", name: "Today (your pick)" },
    { id: "today-options", name: "Today options (round 3)" },
    { id: "desktop", name: "Desktop and web" },
    { id: "foundations", name: "Foundations" },
  ],
  artboards: boards.map(({ file, x, y, w, h, title, page }) => ({ file, x, y, w, h, title, page })),
  annotations: [
    { id: "overview", page: "phone", x: -330, y: -40, w: 260, text: "Round 3: your Qala Test font for titles and big numbers (switch to Faustina above any screen), DM Mono everywhere else, plate calculator, graphical session summary.\n\nAll numbers are sample data." },
    { id: "lift-flow", page: "phone", x: -330, y: 400, w: 260, text: "Lifting: Plan > Check-in > Warm-up (plates per ramp step) > one exercise (plate shorthand under the weight) > rest (full plate drawing for the next set) > all exercises > session complete (charts)." },
    { id: "row-b", page: "phone", x: -330, y: rowB, w: 260, text: "Body, Progress, Coach, the standalone plate calculator, Settings (bars and plates, equipment, warm-up, rest timer)." },
    { id: "run-flow", page: "phone", x: -330, y: rowC, w: 260, text: "Running starts from Today or a Plan day." },
    { id: "today-pick", page: "today", x: 0, y: -210, w: 1330, text: "Today, built from your pick: the hero card now shows this week's load with today outlined and named, a readiness ring out of 100 with your average (dark tick) and the low line (red tick and tinted zone), and a bigger Start button.\n\nThe rail on the left is the day's timeline. Flick it up or down to move between stages; the card follows the day. Three states shown: morning, after the lift, evening." },
    { id: "today-note", page: "today-options", x: 0, y: -170, w: 1330, text: "Round 3, kept for reference. Three directions for Today. A: one hero card for the day's main lift with the loaded bar, readiness and one Start button (my pick). B: the day as a timeline with a now marker. C: recovery and the week first, today's session at the bottom. Pick one or mix parts." },
  ],
  launch: { view: "canvas", page: "today" },
};
fs.writeFileSync(path.join(out, "canvas.json"), JSON.stringify(canvas, null, 2));
console.log("wrote", boards.length, "artboards");
