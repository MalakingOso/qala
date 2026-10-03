/* Shared sample data + SVG renderers for the load-zoom transition artifacts.
 * Mockups only: Block 2, six weeks Mon-Sun, week 3 is Sep 7-13 2026,
 * today is Sun Sep 13 (Lower A). Hand-built SVG, no app code. */
(function () {
  "use strict";
  var KIND = ["lift", "run", "lift", "rest", "lift", "run", "lift"];
  var BASE = [620, 300, 540, 0, 700, 260, 750];
  var MULT = [0.8, 0.9, 1.0, 1.05, 1.1, 0.45];
  var MON = ["24", "31", "7", "14", "21", "28"];
  var TODAY = 20;
  var W = 358;
  var DAY = [
    { n: "Back Squat", r: "3 × 4 · 245", l: 470, d: 0.66 },
    { n: "Easy run", r: "3.0 mi · 6 pm", l: 280, d: 0 },
  ];

  var weeks = MULT.map(function (m, w) {
    return {
      id: "W" + (w + 1), deload: w === 5,
      days: BASE.map(function (b, d) {
        var abs = w * 7 + d;
        var load = Math.round(b * m * (1 + 0.08 * Math.sin(abs * 12.9898)) / 5) * 5;
        return { load: load, done: abs < TODAY ? 1 : abs === TODAY ? 0.55 : 0, abs: abs };
      }),
    };
  });
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  var allDays = weeks.reduce(function (a, w) { return a.concat(w.days); }, []);
  var dayMax = Math.max.apply(null, allDays.map(function (d) { return d.load; }));
  var weekLoad = weeks.map(function (w) { return sum(w.days.map(function (d) { return d.load; })); });
  var weekDone = weeks.map(function (w) { return sum(w.days.map(function (d) { return d.load * d.done; })); });
  var weekMax = Math.max.apply(null, weekLoad);
  function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  var INK = "#0f152a", MUT = "#64708b", TEAL = "#08a49c", TEALD = "#0a8078",
    EMBER = "#c2410c", WASH = "rgba(194,65,12,.08)", PAST = "rgba(15,21,42,.05)",
    GRAY = "#c9ced9", HAIR = "rgba(15,21,42,.14)";

  function bar(x, y, w, h, fillH, state, dashed) {
    if (state === "rest") {
      var rw = Math.max(Math.min(w, 14), 4);
      return '<rect class="bar" x="' + (x + w / 2 - rw / 2).toFixed(1) + '" y="' + (y + h - 4).toFixed(1) +
        '" width="' + rw.toFixed(1) + '" height="4" rx="2" fill="' + GRAY + '"/>';
    }
    var stroke = state === "today" ? EMBER : state === "later" ? TEALD : TEAL;
    var s = '<rect class="bar" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) +
      '" height="' + Math.max(h, 2).toFixed(1) + '" rx="2" fill="none" stroke="' + stroke + '" stroke-width="' +
      (w < 8 ? 1.2 : 2) + '"' + (dashed ? ' stroke-dasharray="3 2"' : "") + "/>";
    if (fillH > 0.5) {
      s += '<rect class="bar" x="' + (x + 2).toFixed(1) + '" y="' + (y + h - fillH + 1).toFixed(1) +
        '" width="' + Math.max(w - 4, 1).toFixed(1) + '" height="' + Math.max(fillH - 2, 1).toFixed(1) +
        '" fill="' + TEAL + '"/>';
    }
    return s;
  }
  function lab(x, y, text, cls) {
    return '<text class="lbl ' + (cls || "") + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
      '" text-anchor="middle">' + text + "</text>";
  }
  function baseLine(base) {
    return '<line x1="0" y1="' + (base + 0.5) + '" x2="' + W + '" y2="' + (base + 0.5) + '" stroke="' + HAIR + '"/>';
  }
  function stateOf(abs, load) {
    if (load === 0) return "rest";
    if (abs === TODAY) return "today";
    if (abs > TODAY) return "later";
    return allDays[abs].done >= 1 ? "done" : "part";
  }

  function dayView(o) {
    var plotH = o.plotH || 84, base = plotH;
    var s = "", cx;
    DAY.forEach(function (sess, i) {
      cx = W * (i === 0 ? 0.28 : 0.72);
      var h = Math.max((sess.l / dayMax) * plotH, 2);
      s += bar(cx - 23, base - h, 46, h, h * sess.d, "today", false);
      s += lab(cx, base + 17, sess.n, "n") + lab(cx, base + 30, sess.r, "");
    });
    s += baseLine(base);
    return { svg: s, h: plotH + 34 };
  }

  function weekView(o) {
    var plotH = o.plotH || 120, base = plotH, L = ["M", "T", "W", "T", "F", "S", "S"];
    var slot = W / 7, bw = Math.min(24, slot - 10), s = "";
    var tx = 6 * slot;
    s += '<rect x="' + tx.toFixed(1) + '" y="0" width="' + slot.toFixed(1) + '" height="' + plotH + '" fill="' + WASH + '"/>';
    weeks[2].days.forEach(function (d, i) {
      var h = Math.max((d.load / dayMax) * plotH, 2);
      s += bar(i * slot + (slot - bw) / 2, base - h, bw, h, h * d.done, stateOf(d.abs, d.load), false);
      s += lab(i * slot + slot / 2, base + 18, L[i], d.abs === TODAY ? "e" : d.abs < TODAY ? "b" : "");
    });
    s += baseLine(base);
    return { svg: s, h: plotH + 26 };
  }

  function ribbonView(o) {
    var plotH = o.plotH || 120, rulerH = 20, base = rulerH + plotH;
    var sel = [weeks[1], weeks[2], weeks[3]], n = 21, slot = W / n, bw = 13, s = "";
    var tidx = TODAY - 7;
    s += '<rect x="0" y="' + rulerH + '" width="' + (tidx * slot).toFixed(1) + '" height="' + plotH + '" fill="' + PAST + '"/>';
    s += '<rect x="' + (tidx * slot).toFixed(1) + '" y="' + rulerH + '" width="' + slot.toFixed(1) +
      '" height="' + plotH + '" fill="' + WASH + '"/>';
    ["W2", "W3", "W4"].forEach(function (t, i) {
      s += lab(i * 7 * slot + 3.5 * slot, 13, t, i === 1 ? "b" : "");
    });
    sel.forEach(function (wk, wi) {
      wk.days.forEach(function (d, i) {
        var idx = wi * 7 + i, h = Math.max((d.load / dayMax) * plotH, 2);
        s += bar(idx * slot + (slot - bw) / 2, base - h, bw, h, h * d.done,
          stateOf(d.abs, d.load), d.abs > TODAY);
      });
      s += lab(wi * 7 * slot + 0.5 * slot, base + 18, MON[wi + 1], "");
    });
    s += lab((tidx + 0.5) * slot, base + 18, "13", "e");
    s += baseLine(base);
    return { svg: s, h: rulerH + plotH + 26 };
  }

  function denseView(o) {
    var plotH = o.plotH || 120, rulerH = 20, base = rulerH + plotH;
    var n = 42, slot = W / n, bw = 6.4, s = "";
    s += '<rect x="0" y="' + rulerH + '" width="' + (TODAY * slot).toFixed(1) + '" height="' + plotH + '" fill="' + PAST + '"/>';
    s += '<rect x="' + (TODAY * slot).toFixed(1) + '" y="' + rulerH + '" width="' + slot.toFixed(1) +
      '" height="' + plotH + '" fill="' + WASH + '"/>';
    weeks.forEach(function (wk, w) {
      var t = wk.deload ? "W6·D" : wk.id;
      s += lab(w * 7 * slot + 3.5 * slot, 13, t, w === 2 ? "b s" : "s");
    });
    allDays.forEach(function (d, i) {
      var h = Math.max((d.load / dayMax) * plotH, 2);
      s += bar(i * slot + (slot - bw) / 2, base - h, bw, h, h * d.done,
        stateOf(d.abs, d.load), d.abs > TODAY);
    });
    s += lab(22, base + 18, "Aug 24", "s") + lab(W - 20, base + 18, "Oct 4", "s");
    s += lab((TODAY + 0.5) * slot, base + 18, "13", "e");
    s += baseLine(base);
    return { svg: s, h: rulerH + plotH + 26 };
  }

  function weeksView(o) {
    var plotH = o.plotH || 120, base = plotH;
    var slot = W / 6, bw = 24, s = "";
    s += '<rect x="' + (2 * slot).toFixed(1) + '" y="0" width="' + slot.toFixed(1) + '" height="' + plotH + '" fill="' + WASH + '"/>';
    weeks.forEach(function (wk, w) {
      var h = Math.max((weekLoad[w] / weekMax) * plotH, 2);
      var st = w === 2 ? "today" : w < 2 ? "done" : "later";
      s += bar(w * slot + (slot - bw) / 2, base - h, bw, h,
        h * (weekDone[w] / weekLoad[w]), st, w > 2);
      s += lab(w * slot + slot / 2, base + 18, wk.deload ? "6·D" : String(w + 1), w === 2 ? "e" : "b");
    });
    s += baseLine(base);
    return { svg: s, h: plotH + 26 };
  }

  function render(view, o) {
    o = o || {};
    if (view === "day") return dayView(o);
    if (view === "week") return weekView(o);
    if (view === "ribbon") return ribbonView(o);
    if (view === "dense") return denseView(o);
    return weeksView(o);
  }

  function caption(view) {
    if (view === "day") {
      return { fig: fmt(DAY[0].l * DAY[0].d), of: fmt(DAY[0].l + DAY[1].l), line: "Today · Lower A · 2 sessions" };
    }
    if (view === "week") {
      var logged = weeks[2].days.filter(function (d) { return d.done >= 1; }).length;
      return { fig: fmt(weekDone[2]), of: fmt(weekLoad[2]), line: "Week 3 · " + logged + " of 7 logged" };
    }
    if (view === "ribbon") {
      var rd = weekDone[1] + weekDone[2] + weekDone[3], rl = weekLoad[1] + weekLoad[2] + weekLoad[3];
      return { fig: fmt(rd), of: fmt(rl), line: "W2–W4 · week 3 in focus" };
    }
    var bd = weekDone.reduce(function (a, b) { return a + b; }, 0);
    var bl = weekLoad.reduce(function (a, b) { return a + b; }, 0);
    if (view === "weeks") return { fig: fmt(bd), of: fmt(bl), line: "Block 2 · 6 weeks · week scale" };
    return { fig: fmt(bd), of: fmt(bl), line: "Block 2 · week 3 of 6" };
  }

  var ICONS = {
    day: '<circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    week: '<rect x="4" y="5.5" width="16" height="13" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
    ribbon: '<path d="M5.5 19.5v-8M12 19.5V4.5M18.5 19.5v-11"/>',
    dense: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  };
  ICONS.weeks = ICONS.dense;
  function icon(view) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[view] + "</svg>";
  }

  function setCap(figEl, lineEl, view) {
    var c = caption(view);
    figEl.innerHTML = c.fig + " <small>of " + c.of + "</small>";
    lineEl.textContent = c.line;
  }
  function mark(root, i) {
    var btns = root.querySelectorAll("button");
    for (var k = 0; k < btns.length; k++) btns[k].classList.toggle("on", k === i);
  }
  function bindSteps(root, cb) {
    var btns = root.querySelectorAll("button");
    for (var k = 0; k < btns.length; k++) {
      (function (i) { btns[i].onclick = function () { cb(i); }; })(k);
    }
  }

  window.LZ = {
    render: render, caption: caption, icon: icon, setCap: setCap,
    mark: mark, bindSteps: bindSteps, W: W,
    RM: typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
})();
