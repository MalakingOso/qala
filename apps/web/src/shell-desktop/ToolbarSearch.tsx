/* Toolbar search (DECISIONS U21): jump to a page, lift, exercise or session.
 * Ctrl or Cmd K focuses it; arrows and Enter pick a result. It only
 * navigates, it never changes data. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQala } from "../store/qalaStore.tsx";
import { sampleLifts } from "../store/sample.ts";
import { EXERCISE_SEED } from "./exerciseSeed.ts";
import { ALL_NAV } from "./nav.ts";
import { sessionHref } from "./sessions.ts";

interface Hit {
  key: string;
  label: string;
  hint: string;
  href: string;
}

const isMac = typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

export function ToolbarSearch() {
  const { sessions } = useQala();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const corpus = useMemo<Hit[]>(() => [
    ...ALL_NAV.map((n) => ({
      key: `nav-${n.id}`,
      label: n.label,
      hint: "page",
      href: `#/desktop/${n.id}`,
    })),
    ...sampleLifts.map((l) => ({
      key: `lift-${l.id}`,
      label: l.name,
      hint: "lift",
      href: `#/desktop/lifts/${l.id}`,
    })),
    ...EXERCISE_SEED.map((e) => ({
      key: `ex-${e.name}`,
      label: e.name,
      hint: `exercise · ${e.target}`,
      href: "#/desktop/exercises",
    })),
    ...sessions.map((s) => ({
      key: `s-${s.id}`,
      label: `${s.label} · ${s.date}`,
      hint: s.type,
      href: sessionHref(s),
    })),
  ], [sessions]);

  const hits = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = terms.length === 0
      ? corpus.filter((h) => h.hint === "page")
      : corpus.filter((h) => {
        const hay = `${h.label} ${h.hint}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    return pool.slice(0, 8);
  }, [q, corpus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(h: Hit | undefined) {
    if (!h) return;
    window.location.hash = h.href;
    setQ("");
    setOpen(false);
    input.current?.blur();
  }

  return (
    <div className="dx-search">
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="dx-search-list"
        aria-activedescendant={open && hits[active]
          ? `dx-hit-${hits[active].key}`
          : undefined}
        aria-label="Search lifts, runs, exercises"
        placeholder="Search lifts, runs, exercises"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(hits[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          }
        }}
      />
      <kbd aria-hidden="true">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      {open && hits.length > 0
        ? (
          <ul className="dx-search-list" id="dx-search-list" role="listbox">
            {hits.map((h, i) => (
              <li
                key={h.key}
                id={`dx-hit-${h.key}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "on" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(h);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{h.label}</span>
                <span className="dx-search-hint">{h.hint}</span>
              </li>
            ))}
          </ul>
        )
        : null}
    </div>
  );
}
