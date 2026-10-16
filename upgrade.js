/* ══════════════════════════════════════════════════════════════════════
   UPGRADER v4 — фикс пустой страницы
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  console.log('[UPGRADER] v4 загружен');

  var MULTS = [
    { mult: 1.5, chance: 0.65, label: 'x1.5' },
    { mult: 2,   chance: 0.48, label: 'x2'   },
    { mult: 5,   chance: 0.20, label: 'x5'   }
  ];
  var SEED = [1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0];
  var SEGS = SEED.length;
  var SEG_ANGLE = 2 * Math.PI / SEGS;
  var U = { mult: 2, stake: 100, spinning: false, feed: [], feedTimer: null, wheelAngle: 0 };

  function ensureStyle() {
    if (document.getElementById('upgStyle')) return;
    var link = document.createElement('link');
    link.id = 'upgStyle';
    link.rel = 'stylesheet';
    link.href = 'upgrade.css';
    document.head.appendChild(link);
  }

  function ensurePage() {
    if (document.getElementById('page-upgrader')) return true;
    var app = document.getElementById('app');
    if (!app) return false;
    var section = document.createElement('section');
    section.className = 'page';
    section.id = 'page-upgrader';
    section.innerHTML = '<div id="upgBody"></div>';
    var nav = app.querySelector('.nav');
    if (nav) app.insertBefore(section, nav);
    else app.appendChild(section);
    if (Array.isArray(window.PAGES) && window.PAGES.indexOf('upgrader') === -1) {
      window.PAGES.push('upgrader');
    }
    return true;
  }

  function ensureSettingsCard() {
    var sheet = document.querySelector('#settingsModal .sheet');
    if (!sheet) return false;
    if (sheet.querySelector('.settings-upg')) return true;
    var card = document.createElement('div');
    card.className = 'settings-upg';
    card.setAttribute('data-act', 'upg-open');
    card.setAttribute('role', 'button');
    card.innerHTML =
      '<div class="ico"><i class="fas fa-arrow-trend-up"></i></div>' +
      '<div class="main">' +
        '<b>UPGRADER</b>' +
        '<span>Прокрути голду — умножь её в 1.5, 2 или 5 раз</span>' +
      '</div>' +
      '<i class="fas fa-chevron-right"></i>';
    var wallet = sheet.querySelector('[data-page="wallet"]');
    if (wallet) wallet.insertAdjacentElement('afterend', card);
    else sheet.insertBefore(card, sheet.children[1] || null);
    return true;
  }

  /* ─── Открыть страницу UPGRADER ─── */
  function openUpgrader() {
    console.log('[UPGRADER] открываем');
    /* Закрываем настройки */
    var sm = document.getElementById('settingsModal');
    if (sm) { sm.classList.remove('active'); sm.setAttribute('aria-hidden', 'true'); }
    /* Скрываем ВСЕ страницы, показываем upgrader */
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var up = document.getElementById('page-upgrader');
    if (up) up.classList.add('active');
    if (window.S) window.S.page = 'upgrader';
    document.querySelectorAll('#nav button').forEach(function (b) { b.classList.remove('active'); });
    window.scrollTo({ top: 0 });
    /* Рендерим сразу, если S.me готов, иначе ждём */
    if (window.S && window.S.me) {
      renderPage();
    } else {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if ((window.S && window.S.me) || tries > 40) {
          clearInterval(iv);
          renderPage();
        }
      }, 100);
    }
  }

  /* ─── Уходим на главную/профиль ─── */
  function goBack() {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var home = document.getElementById('page-profile');
    if (!home) home = document.getElementById('page-home');
    if (home) home.classList.add('active');
    if (window.S) window.S.page = 'profile';
    document.querySelectorAll('#nav button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.page === 'profile');
    });
    window.scrollTo({ top: 0 });
  }

  /* ─── Один общий обработчик кликов ─── */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var open = t.closest('[data-act="upg-open"]');
    if (open) { e.preventDefault(); e.stopPropagation(); openUpgrader(); return; }
    var back = t.closest('[data-act="upg-back"]');
    if (back) { e.preventDefault(); e.stopPropagation(); goBack(); return; }
    var mult = t.closest('[data-act="upg-mult"]');
    if (mult) {
      if (U.spinning) return;
      var m = parseFloat(mult.dataset.mult);
      if (MULTS.some(function (x) { return x.mult === m; })) { U.mult = m; renderPage(); }
      return;
    }
    var quick = t.closest('[data-act="upg-stake-quick"]');
    if (quick) {
      if (U.spinning) return;
      var gold = (window.S && window.S.me && window.S.me.gold) || 0;
      var val = quick.dataset.value;
      var v;
      if (val === 'max') v = gold;
      else if (val === 'half') v = Math.floor(gold / 2);
      else v = parseInt(val, 10) || 0;
      U.stake = Math.max(10, Math.min(gold, v));
      renderPage();
      return;
    }
    var spinBtn = t.closest('[data-act="upg-spin"]');
    if (spinBtn) { e.preventDefault(); spin(); return; }
  }, true);

  /* ─── Отрисовка ─── */
  function renderPage() {
    var box = document.getElementById('upgBody');
    if (!box) { console.warn('[UPGRADER] нет #upgBody'); return; }
    if (!window.S || !window.S.me) { console.warn('[UPGRADER] S.me не готов'); return; }
    var me = window.S.me;
    var gold = me.gold || 0;
    var cfg = MULTS.filter(function (x) { return x.mult === U.mult; })[0] || MULTS[1];
    var maxStake = Math.max(10, gold);
    if (U.stake > maxStake) U.stake = maxStake;
    var payout = Math.floor(U.stake * U.mult);

    box.innerHTML =
      '<div class="upg-head">' +
        '<button class="icon-btn" data-act="upg-back" aria-label="Назад"><i class="fas fa-chevron-left"></i></button>' +
        '<div><h2>UPGRADER</h2><p>Баланс: <b style="color:var(--gold)">' + gold + ' G</b></p></div>' +
      '</div>' +
      '<div class="upg-card">' +
        '<div class="upg-mults">' +
          MULTS.map(function (m) {
            return '<div class="upg-mult ' + (m.mult === U.mult ? 'on' : '') + '" data-act="upg-mult" data-mult="' + m.mult + '">' +
              '<b>' + m.label + '</b>' +
              '<span>×' + m.mult + '</span>' +
              '<span class="chance">' + Math.round(m.chance * 100) + '% шанс</span>' +
              '</div>';
          }).join('') +
        '</div>' +
        '<div class="upg-wheel-wrap">' +
          '<div class="upg-pointer"></div>' +
          '<div class="upg-wheel" id="upgWheel">' + wheelSvg() + '</div>' +
          '<div class="upg-result" id="upgResult"><div class="upg-result-in"></div></div>' +
        '</div>' +
        '<div class="upg-stake">' +
          '<div class="upg-stake-row">' +
            '<label>Ставка</label>' +
            '<div class="val" id="upgStakeVal">' + U.stake + '<small>G</small></div>' +
          '</div>' +
          '<input class="upg-slider" type="range" id="upgSlider" min="10" max="' + maxStake + '" step="10" value="' + Math.min(U.stake, maxStake) + '">' +
          '<div class="upg-quick">' +
            '<button type="button" data-act="upg-stake-quick" data-value="100">100</button>' +
            '<button type="button" data-act="upg-stake-quick" data-value="500">500</button>' +
            '<button type="button" data-act="upg-stake-quick" data-value="1000">1000</button>' +
            '<button type="button" data-act="upg-stake-quick" data-value="half">½</button>' +
            '<button type="button" data-act="upg-stake-quick" data-value="max">Всё</button>' +
          '</div>' +
        '</div>' +
        '<button class="upg-spin" id="upgSpin" type="button" data-act="upg-spin"' + (gold < 10 ? ' disabled' : '') + '>' +
          '<i class="fas fa-arrow-trend-up"></i> КРУТИТЬ · выигрыш ' + payout + ' G' +
        '</button>' +
        '<div class="upg-hint" id="upgHint">Выигрыш: <b>' + payout + ' G</b> · Шанс: <b>' + Math.round(cfg.chance * 100) + '%</b><br>Минимальная ставка — 10 G</div>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="upg-feed-title"><span>Лента выигрышей</span><b>LIVE</b></div>' +
        '<div class="upg-feed" id="upgFeed">' + feedHtml() + '</div>' +
      '</div>';

    var slider = document.getElementById('upgSlider');
    if (slider) {
      slider.addEventListener('input', function (e) {
        if (U.spinning) return;
        U.stake = Math.max(10, parseInt(e.target.value, 10) || 10);
        var valEl = document.getElementById('upgStakeVal');
        if (valEl) valEl.innerHTML = U.stake + '<small>G</small>';
        var btn = document.getElementById('upgSpin');
        if (btn) btn.innerHTML = '<i class="fas fa-arrow-trend-up"></i> КРУТИТЬ · выигрыш ' + Math.floor(U.stake * U.mult) + ' G';
        var hint = document.getElementById('upgHint');
        if (hint) hint.innerHTML = 'Выигрыш: <b>' + Math.floor(U.stake * U.mult) + ' G</b> · Шанс: <b>' + Math.round(cfg.chance * 100) + '%</b><br>Минимальная ставка — 10 G';
      });
    }
    var rotor = document.getElementById('upgRotor');
    if (rotor && U.wheelAngle) {
      rotor.setAttribute('transform', 'rotate(' + (U.wheelAngle * 180 / Math.PI).toFixed(2) + ' 100 100)');
    }
    if (!U.feed.length) loadFeed();
    if (!U.feedTimer) {
      U.feedTimer = setInterval(function () {
        if (window.S && window.S.page === 'upgrader') loadFeed();
      }, 15000);
    }
    console.log('[UPGRADER] страница отрисована');
  }

  function wheelSvg() {
    var cx = 100, cy = 100, r = 92;
    var palette = ['#0f1633', '#172046', '#1a1440', '#222d5c'];
    var paths = '', labels = '';
    for (var i = 0; i < SEGS; i++) {
      var a0 = i * SEG_ANGLE - Math.PI / 2 - SEG_ANGLE / 2;
      var a1 = a0 + SEG_ANGLE;
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      var val = SEED[i];
      var isWin = val > 0;
      var fill;
      if (isWin) {
        if (val === 5) fill = 'url(#gGold)';
        else if (val === 2) fill = 'url(#gGreen)';
        else fill = 'url(#gBlue)';
      } else fill = palette[i % palette.length];
      paths += '<path class="seg" d="M' + cx + ',' + cy + ' L' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + r + ',' + r + ' 0 0 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z" fill="' + fill + '"/>';
      var am = (a0 + a1) / 2;
      var lx = cx + (r - 26) * Math.cos(am);
      var ly = cy + (r - 26) * Math.sin(am);
      var txt = isWin ? ('x' + val) : '—';
      var fill2 = isWin ? '#0d1128' : 'rgba(200,220,255,.4)';
      labels += '<text class="seg-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" fill="' + fill2 + '" transform="rotate(' + (am * 180 / Math.PI + 90).toFixed(1) + ' ' + lx.toFixed(1) + ' ' + ly.toFixed(1) + ')">' + txt + '</text>';
    }
    return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
        '<linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#f5c451"/></linearGradient>' +
        '<linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8bf5c6"/><stop offset="1" stop-color="#3ddc97"/></linearGradient>' +
        '<linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#4f8cff"/></linearGradient>' +
        '<radialGradient id="hub" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#a16207"/></radialGradient>' +
      '</defs>' +
      '<g id="upgRotor">' + paths + labels + '</g>' +
      '<circle cx="100" cy="100" r="20" fill="url(#hub)" stroke="#7a4a05" stroke-width="2"/>' +
      '<circle cx="100" cy="100" r="10" fill="#0d1128" stroke="#7a4a05" stroke-width="1.5"/>' +
      '</svg>';
  }

  function pickTargetSeg(win, mult) {
    var pool = [];
    for (var i = 0; i < SEGS; i++) {
      var v = SEED[i];
      if (win && v === mult) pool.push(i);
      if (!win && v === 0) pool.push(i);
    }
    if (!pool.length) pool.push(0);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function segCenterAngle(i) { return -i * SEG_ANGLE; }

  function spin() {
    if (U.spinning) return;
    var me = window.S && window.S.me;
    if (!me) return;
    if ((me.gold || 0) < U.stake) {
      if (window.toast) window.toast('error', 'Недостаточно голды', 'Уменьшите ставку');
      return;
    }
    U.spinning = true;
    var btn = document.getElementById('upgSpin');
    var res = document.getElementById('upgResult');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Крутим…'; }
    if (res) {
      res.classList.remove('show', 'lose-in');
      var ri = res.querySelector('.upg-result-in');
      if (ri) ri.textContent = '';
    }
    window.rpc('upgrade_spin', { p_stake: U.stake, p_mult: U.mult })
      .then(function (r) {
        if (!r) throw new Error('Пустой ответ сервера');
        doSpinAnimation(!!r.win, Number(r.mult) || U.mult, r);
      })
      .catch(function (e) {
        U.spinning = false;
        if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
        if (window.toast) window.toast('error', 'Не удалось прокрутить', (e && e.message) || String(e));
        renderPage();
      });
  }

  function doSpinAnimation(win, mult, result) {
    var rotor = document.getElementById('upgRotor');
    if (!rotor) { finishSpin(win, mult, result); return; }
    var cur = U.wheelAngle % (Math.PI * 2);
    var idx = pickTargetSeg(win, mult);
    var target = segCenterAngle(idx);
    var loops = 4;
    var jitter = (Math.random() - 0.5) * SEG_ANGLE * 0.6;
    var diff = target + loops * 2 * Math.PI - cur;
    while (diff < 3.5 * 2 * Math.PI) diff += 2 * Math.PI;
    var startAngle = U.wheelAngle;
    var endAngle = startAngle + diff + jitter;
    var duration = 4200;
    var start = performance.now();
    var ease = function (t) {
      var basic = 1 - Math.pow(1 - t, 3);
      var bait = t > 0.88 ? Math.sin((t - 0.88) / 0.12 * Math.PI) * 0.012 : 0;
      return Math.min(1, basic + bait);
    };
    function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      var a = startAngle + diff * ease(t) + jitter * Math.min(1, t * 1.2);
      U.wheelAngle = a;
      rotor.setAttribute('transform', 'rotate(' + (a * 180 / Math.PI).toFixed(2) + ' 100 100)');
      if (t < 1) requestAnimationFrame(frame);
      else {
        U.wheelAngle = endAngle;
        rotor.setAttribute('transform', 'rotate(' + (endAngle * 180 / Math.PI).toFixed(2) + ' 100 100)');
        finishSpin(win, mult, result);
      }
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(win, mult, result) {
    U.spinning = false;
    var btn = document.getElementById('upgSpin');
    var resBox = document.getElementById('upgResult');
    var resIn = resBox ? resBox.querySelector('.upg-result-in') : null;
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    if (win) {
      var amount = (result && result.payout) || Math.floor(U.stake * mult);
      if (resIn) resIn.textContent = '+' + amount + ' G · x' + mult;
      if (resBox) { resBox.classList.remove('lose-in'); resBox.classList.add('show'); }
      if (window.playSound) window.playSound('found');
    } else {
      if (resIn) resIn.textContent = '−' + U.stake + ' G';
      if (resBox) { resBox.classList.add('lose-in', 'show'); }
      if (window.playSound) window.playSound('chime');
    }
    setTimeout(function () {
      if (resBox) resBox.classList.remove('show');
      if (result && result.gold != null && window.S && window.S.me) window.S.me.gold = result.gold;
      if (window.renderBalance) window.renderBalance();
      renderPage();
    }, 2200);
  }

  function loadFeed() {
    if (!window.rpc) return;
    window.rpc('upgrade_feed', { p_limit: 15 })
      .then(function (rows) {
        U.feed = rows || [];
        var box = document.getElementById('upgFeed');
        if (box) box.innerHTML = feedHtml();
      })
      .catch(function () {
        var box = document.getElementById('upgFeed');
        if (box && !U.feed.length) box.innerHTML = '<div class="upg-feed-empty">Лента пока пуста</div>';
      });
  }

  function feedHtml() {
    if (!U.feed.length) return '<div class="upg-feed-empty">Лента пока пуста — сыграйте первый спин</div>';
    return U.feed.map(function (r) {
      var win = !!r.win;
      var pay = win ? ('+' + (r.payout || 0) + ' G') : ('−' + (r.stake || 0) + ' G');
      var name = String(r.username || 'игрок').replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
      return '<div class="upg-feed-item ' + (win ? 'win' : 'lose') + '">' +
        '<span class="who">' + name + '</span>' +
        '<span class="mult">x' + r.mult + '</span>' +
        '<span class="meta">' + r.stake + ' G</span>' +
        '<span class="pay">' + pay + '</span>' +
        '</div>';
    }).join('');
  }

  /* ─── Автозапуск ─── */
  ensureStyle();
  var appWait = setInterval(function () { if (ensurePage()) clearInterval(appWait); }, 300);
  var cardWait = setInterval(function () { if (ensureSettingsCard()) clearInterval(cardWait); }, 300);
  try {
    new MutationObserver(function () { ensureSettingsCard(); }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* ок */ }
  ensurePage();
  ensureSettingsCard();
  console.log('[UPGRADER] v4 установлен');
})();
