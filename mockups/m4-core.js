/* M4 option mockups: shared helpers. Needs m4-icons.js first.
 * Icons (Lucide, DESIGN.md section 4), strip and menu markup, the notch seam
 * painter from today-rail-full.html, scale and toggle taps, the theme switch.
 * Mockups only, not app code. */
(function () {
  var I = window.M4_ICONS || {};
  var NS = 'http://www.w3.org/2000/svg';

  function svg(name) {
    return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>';
  }
  function ic(name, size) {
    return '<span class="ic" style="' + (size ? 'font-size:' + size + 'px' : '') + '">' + svg(name) + '</span>';
  }

  /* strip dots: status is done | now | todo | soft | skip, sel is the previewed index */
  function strip(dots, sel) {
    return '<div class="strip" role="button" tabindex="0" aria-label="Day stages. Activate to open the menu.">' +
      dots.map(function (s, i) { return '<i class="' + s + (i === sel ? ' sel' : '') + '"></i>'; }).join('') + '</div>';
  }

  /* menu rows: [{label, time, status}] */
  function menu(o) {
    var rows = o.rows.map(function (r, i) {
      var mark = r.status === 'done' ? ic('check') : (r.status === 'skip' ? '' : (i + 1));
      return '<li class="' + r.status + (i === o.sel ? ' sel' : '') + '"><button class="rb" type="button">' +
        '<span class="nd">' + mark + '</span><span class="tx"><b>' + r.label + '</b><span>' + r.time + '</span></span></button></li>';
    }).join('');
    return '<div class="scrim"></div><aside class="menu" aria-label="Day stages">' +
      '<div class="mhead"><h3>' + o.title + '</h3><button class="x" type="button" aria-label="Close">' + ic('x') + '</button></div>' +
      '<ol class="mrows">' + rows + '</ol>' +
      '<button class="back" type="button">Back to now</button></aside>';
  }

  function tabbar(active) {
    var tabs = [['Today', 'sun'], ['Plan', 'calendar-range'], ['Body', 'activity'], ['Progress', 'trending-up'], ['Coach', 'message-square-text']];
    return '<nav class="tabbar" aria-label="Primary">' + tabs.map(function (t) {
      return '<a href="#" class="' + (t[0] === active ? 'on' : '') + '">' + ic(t[1]) + t[0] + '</a>';
    }).join('') + '</nav>';
  }

  /* notch seam: same geometry as today-rail-full.html (8px of whitespace round
   * the strip, inner radius min(8, h/2 - 1)), measured against the band so it
   * stays right when a frame has a tab bar or a pinned head. The stroke uses
   * the card's own border colour (M3 decision), not the prototype's darker one. */
  function seam(band) {
    var st = band.querySelector('.strip');
    if (!st) return;
    var s = band.querySelector('.seamfield');
    if (!s) {
      s = document.createElementNS(NS, 'svg');
      s.setAttribute('class', 'seamfield');
      s.setAttribute('aria-hidden', 'true');
      var f = document.createElementNS(NS, 'path'); f.setAttribute('class', 'sf');
      var l = document.createElementNS(NS, 'path'); l.setAttribute('class', 'sl');
      s.appendChild(f); s.appendChild(l);
      band.insertBefore(s, st);
    }
    var br = band.getBoundingClientRect();
    s.setAttribute('viewBox', '0 0 ' + br.width.toFixed(1) + ' ' + br.height.toFixed(1));
    var sr = st.getBoundingClientRect();
    var y0 = sr.top - br.top - 8, y1 = sr.bottom - br.top + 8;
    var fill = '', line = '';
    band.querySelectorAll('.pcard').forEach(function (card) {
      var r = card.getBoundingClientRect();
      var top = Math.max(y0, r.top - br.top), bot = Math.min(y1, r.bottom - br.top);
      var h = bot - top;
      if (h < 10) return;
      var cr = Math.min(8, h / 2 - 1), cx = 36 - cr;
      var t = top.toFixed(1), b = bot.toFixed(1);
      fill += 'M10,' + t + ' H' + cx.toFixed(1) + ' Q36,' + t + ' 36,' + (top + cr).toFixed(1) + ' L36,' + (bot - cr).toFixed(1) + ' Q36,' + b + ' ' + cx.toFixed(1) + ',' + b + ' H10 Z ';
      line += 'M13,' + t + ' H' + cx.toFixed(1) + ' Q36,' + t + ' 36,' + (top + cr).toFixed(1) + ' L36,' + (bot - cr).toFixed(1) + ' Q36,' + b + ' ' + cx.toFixed(1) + ',' + b + ' H13 ';
    });
    s.children[0].setAttribute('d', fill);
    s.children[1].setAttribute('d', line);
  }
  var seamQueued = false;
  function seamAll() {
    document.querySelectorAll('.band').forEach(seam);
  }
  function queueSeam() {
    if (seamQueued) return;
    seamQueued = true;
    requestAnimationFrame(function () { seamQueued = false; seamAll(); });
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.ic[data-i]').forEach(function (el) {
      if (!el.firstChild) el.innerHTML = svg(el.getAttribute('data-i'));
    });
    (root || document).querySelectorAll('nav.tabbar[data-active]').forEach(function (el) {
      var t = document.createElement('div');
      t.innerHTML = tabbar(el.getAttribute('data-active'));
      el.replaceWith(t.firstChild);
    });
    queueSeam();
  }

  function mount(el, html) {
    el.innerHTML = html;
    hydrate(el);
    el.querySelectorAll('.pscroll').forEach(function (p) { p.addEventListener('scroll', queueSeam, { passive: true }); });
  }

  /* taps: scale cells and chips pick one, toggles flip */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    var cell = e.target.closest('.scale button');
    if (cell && !cell.closest('[data-static],[data-multi]')) {
      var scale = cell.parentNode;
      scale.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === cell); b.setAttribute('aria-checked', b === cell ? 'true' : 'false'); });
      scale.dispatchEvent(new CustomEvent('m4pick', { bubbles: true, detail: { value: cell.dataset.v, cell: cell } }));
      return;
    }
    var chip = e.target.closest('.chips[data-single] .chip');
    if (chip) {
      chip.parentNode.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === chip); });
      chip.parentNode.dispatchEvent(new CustomEvent('m4pick', { bubbles: true, detail: { value: chip.dataset.v, cell: chip } }));
      return;
    }
    var tg = e.target.closest('.tgl');
    if (tg && !tg.disabled) {
      tg.setAttribute('aria-checked', tg.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      tg.dispatchEvent(new CustomEvent('m4tgl', { bubbles: true, detail: { on: tg.getAttribute('aria-checked') === 'true' } }));
    }
  });

  /* theme switch: Auto follows the system, the others set data-theme */
  function themebar() {
    document.querySelectorAll('[data-themebar]').forEach(function (host) {
      host.className = 'themebar';
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', 'Page theme');
      host.innerHTML = ['auto', 'light', 'dark'].map(function (m) {
        return '<button type="button" data-m="' + m + '" aria-pressed="' + (m === 'auto') + '">' + m[0].toUpperCase() + m.slice(1) + '</button>';
      }).join('');
      host.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var m = b.dataset.m;
        if (m === 'auto') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', m);
        host.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        queueSeam();
      });
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
  }

  window.M4 = { svg: svg, ic: ic, strip: strip, menu: menu, tabbar: tabbar, seam: seam, seamAll: seamAll, hydrate: hydrate, mount: mount, ready: ready };

  ready(function () {
    themebar();
    hydrate();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueSeam);
    window.addEventListener('resize', queueSeam);
    window.addEventListener('load', queueSeam);
  });
})();
