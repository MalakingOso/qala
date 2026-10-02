/* Landing intro (U26): the Qk plate drops, slaps, kicks up dust and settles
 * with the Q upright; the "Qala." wordmark fades in over the floor above it
 * once the plate has settled. The clip is rendered on each theme's page
 * colour (assets/3d/build_intro.py, encode_intro.sh), so it has no visible
 * edge. Under reduced motion, or when autoplay is refused, the settled poster
 * stands in and the wordmark shows at once. */

import { useEffect, useRef, useState } from "react";
import meta from "./intro.json";
import lightMp4 from "./intro-light.mp4";
import lightWebm from "./intro-light.webm";
import lightPoster from "./intro-light.webp";
import darkMp4 from "./intro-dark.mp4";
import darkWebm from "./intro-dark.webm";
import darkPoster from "./intro-dark.webp";
import calLightMp4 from "./cal-light.mp4";
import calLightWebm from "./cal-light.webm";
import calDarkMp4 from "./cal-dark.mp4";
import calDarkWebm from "./cal-dark.webm";

const SOURCES = {
  light: {
    mp4: lightMp4,
    webm: lightWebm,
    poster: lightPoster,
    calMp4: calLightMp4,
    calWebm: calLightWebm,
  },
  dark: {
    mp4: darkMp4,
    webm: darkWebm,
    poster: darkPoster,
    calMp4: calDarkMp4,
    calWebm: calDarkWebm,
  },
} as const;

/** The page theme as applied to <html data-theme>, kept current; null until
 * the app has applied one (app.tsx does so in an effect after the first
 * render), so a saved dark theme never starts the light clip for a frame. */
function usePageTheme(): "light" | "dark" | null {
  const read = () => {
    const t = document.documentElement.dataset.theme;
    return t === "dark" ? "dark" : t === "light" ? "light" : null;
  };
  const [theme, setTheme] = useState<"light" | "dark" | null>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()));
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => mo.disconnect();
  }, []);
  return theme;
}

function useReducedMotion(): boolean {
  const mq = () => window.matchMedia("(prefers-reduced-motion: reduce)");
  const [reduced, setReduced] = useState(() => mq().matches);
  useEffect(() => {
    const m = mq();
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** The page colour, as rgb, from the --bg token. */
function pageRgb(): [number, number, number] | null {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(
    "--bg",
  )
    .trim();
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** How far the decoded clip's flat ground sits from the page colour. 8-bit
 * video cannot hold every colour exactly, and each browser's YUV to RGB
 * conversion rounds its own way (Chrome lands 2 levels off on the dark page),
 * so a 16 x 16 clip of the bare page colour, made by the same encode, is read
 * back and the difference is cancelled with a colour matrix on the intro.
 * The intro's own frames cannot be used: the airborne plate's soft shadow
 * darkens the whole floor at the start. Zero when anything looks off. */
function decodeOffset(v: HTMLVideoElement): [number, number, number] {
  try {
    const bg = pageRgb();
    if (!bg) return [0, 0, 0];
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return [0, 0, 0];
    g.drawImage(v, 4, 4, 8, 8, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      sum[0] += d[i];
      sum[1] += d[i + 1];
      sum[2] += d[i + 2];
    }
    const n = d.length / 4;
    const off = bg.map((t, k) => Math.round(t - sum[k] / n)) as [
      number,
      number,
      number,
    ];
    return off.every((x) => Math.abs(x) <= 4) ? off : [0, 0, 0];
  } catch {
    return [0, 0, 0];
  }
}

export function IntroHero() {
  const theme = usePageTheme();
  const reduced = useReducedMotion();
  const [settled, setSettled] = useState(false);
  const [refused, setRefused] = useState(false);
  const [offset, setOffset] = useState<[number, number, number]>([0, 0, 0]);
  const video = useRef<HTMLVideoElement>(null);
  const src = theme ? SOURCES[theme] : null;
  const isStatic = reduced || refused;
  const corrected = offset.some((x) => x !== 0);

  useEffect(() => {
    // the theme swap remounts the <video> (key below): start it over
    setSettled(false);
    setOffset([0, 0, 0]);
    const v = video.current;
    if (!v || isStatic) return;
    v.play().catch(() => setRefused(true));
  }, [theme, isStatic]);

  // the wordmark's slot is the band above the plate (intro.json): its text box
  // ends well clear of the plate's top edge, so the Q's tail never touches it
  const wordmarkTop = `${((meta.plate.top[1] - 0.08) * 100).toFixed(1)}%`;

  return (
    <figure
      className={`intro-hero${settled || isStatic ? " is-settled" : ""}${
        isStatic ? " is-static" : ""
      }`}
      aria-label="A red Qala bumper plate lands on the floor and settles"
    >
      {!src ? null : isStatic
        ? (
          <img
            className="intro-frame"
            src={src.poster}
            alt=""
            width={meta.size[0]}
            height={meta.size[1]}
          />
        )
        : (
          <video
            key={theme}
            ref={video}
            className="intro-frame"
            width={meta.size[0]}
            height={meta.size[1]}
            autoPlay
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden="true"
            style={corrected ? { filter: "url(#intro-decode-fix)" } : undefined}
            onTimeUpdate={(e) => {
              if (e.currentTarget.currentTime >= meta.settle_s - 0.1) {
                setSettled(true);
              }
            }}
            onEnded={() => setSettled(true)}
            onError={() => setRefused(true)}
          >
            <source src={src.webm} type="video/webm" />
            <source src={src.mp4} type="video/mp4" />
          </video>
        )}
      {!src || isStatic ? null : (
        <video
          key={`cal-${theme}`}
          className="intro-cal"
          width={64}
          height={64}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onLoadedData={(e) => setOffset(decodeOffset(e.currentTarget))}
        >
          <source src={src.calWebm} type="video/webm" />
          <source src={src.calMp4} type="video/mp4" />
        </video>
      )}
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        style={{ position: "absolute" }}
      >
        <filter id="intro-decode-fix" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values={`1 0 0 0 ${offset[0] / 255} 0 1 0 0 ${
              offset[1] / 255
            } 0 0 1 0 ${offset[2] / 255} 0 0 0 1 0`}
          />
        </filter>
      </svg>
      <span
        className="intro-wordmark title"
        style={{ top: wordmarkTop }}
        aria-hidden="true"
      >
        Qala<em>.</em>
      </span>
    </figure>
  );
}
