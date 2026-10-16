/* ══════════════════════════════════════════════════════════════════════
   UPGRADER v7 — берёт баланс напрямую через RPC get_me
   Никак не зависит от window.S и app.js
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  console.log('[UPGRADER] v7 загружен');

  var MULTS = [
    { mult: 1.5, chance: 0.65, label: 'x1.5' },
    { mult: 2,   chance: 0.48, label: 'x2'   },
    { mult: 5,   chance: 0.20, label: 'x5'   }
  ];
  var SEED = [1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0];
  var SEGS = SEED.length;
  var SEG_ANGLE = 2 * Math.PI / SEGS;
  var U = {
    mult: 2, stake: 100, spinning: false,
    feed: [], feedTimer: null, wheelAngle: 0,
    open: false, gold: 0
  };

  /* ─── CSS ─── */
  if (!document.getElementById('upgStyle')) {
    var l = document.createElement('link');
    l.id = 'upgStyle'; l.rel = 'stylesheet'; l.href = 'upgrade.css';
    document.head.appendChild(l);
  }

  /* ─── Обёртка RPC: использует глобальный sb из app.js, либо свой fetch ─── */
  var SB_URL = 'https://ggjkivobmwwqgzkaaihx.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnamtpdm9ibXd3cWd6a2FhaWh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NzQzODcsImV4cCI6MjEwNzE1MDM4N30.flfcDmjp9riwZe9N4xCqX9CzIo6D9x9SeeQB3YU7254';

  function getSession() {
    /* Токен хранится в localStorage под ключом bnk_session (так делает app.js) */
    try { return localStorage.getItem('bnk_session') || ''; } catch (e) { return ''; }
  }

  function callRpc(name, args) {
    var token = getSession();
    return fetch(SB_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'X-Client-Info': 'bnk/' + token,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('RPC ' + name + ': ' + t.slice(0, 120)); });
      return r.json();
    });
  }

  /* ─── Полноэкранный оверлей ─── */
  function ensureOverlay() {
    var ov = document.getElementById('upgOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'upgOverlay';
    ov.innerHTML =
      '<div class="upg-overlay-bar">' +
        '<button class="upg-overlay-back" data-upg-act="close" aria-label="Назад"><i class="fas fa-chevron-left"></i></button>' +
        '<span>UPGRADER</span>' +
        '<span style="width:40px"></span>' +
      '</div>' +
      '<div class="upg-overlay-scroll"><div id="upgBody"></div></div>';
    document.body.appendChild(ov);
    return ov;
  }

  function openOverlay() {
    if (U.open) return;
    U.open = true;
    var ov = ensureOverlay();
    ov.classList.add('show');
    document.body.style.overflow = 'hidden';
    var sm = document.getElementById('settingsModal');
    if (sm) { sm.classList.remove('active'); sm.setAttribute('aria-hidden', 'true'); }
    console.log('[UPGRADER] открыт');
    /* Сразу рисуем скелет с загрузкой, потом грузим баланс */
    renderPage();
    loadGold();
  }

  function closeOverlay() {
    U.open = false;
    var ov = document.getElementById('upgOverlay');
    if (ov) ov.classList.remove('show');
    document.body.style.overflow = '';
  }

  function loadGold() {
    callRpc('get_me')
      .then(function (me) {
        U.gold = (me && me.gold) || 0;
        if (U.stake > U.gold) U.stake = Math.max(10, U.gold);
        renderPage();
      })
      .catch(function (e) {
        console.warn('[UPGRADER] не получили баланс', e);
        /* Всё равно рисуем — с 0, чтобы кнопка не висела вечно */
        U.gold = 0;
        renderPage();
      });
  }

  /* ─── Карточка в настройках ─── */
  function ensureSettingsCard() {
    var sheet = document.querySelector('#settingsModal .sheet');
    if (!sheet || sheet.querySelector('.settings-upg')) return !!sheet;
    var card = document.createElement('div');
    card.className = 'settings-upg';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML =
      '<div class="ico"><i class="fas fa-arrow-trend-up"></i></div>' +
      '<div class="main"><b>UPGRADER</b><span>Прокрути голду — умножь её в 1.5, 2 или 5 раз</span></div>' +
      '<i class="fas fa-chevron-right"></i>';
    var wallet = sheet.querySelector('[data-page="wallet"]');
    if (wallet) wallet.insertAdjacentElement('afterend', card);
    else sheet.insertBefore(card, sheet.children[1] || null);
    return true;
  }

  /* ─── Клики ─── */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    if (t.closest('.settings-upg')) { e.preventDefault(); e.stopPropagation(); return openOverlay(); }
    if (t.closest('[data-upg-act="close"]')) { e.preventDefault(); e.stopPropagation(); return closeOverlay(); }

    var m = t.closest('[data-upg-act="mult"]');
    if (m) {
      if (U.spinning) return;
      var mv = parseFloat(m.dataset.mult);
      if (MULTS.some(function (x) { return x.mult === mv; })) { U.mult = mv; renderPage(); }
      return;
    }
    var q = t.closest('[data-upg-act="quick"]');
    if (q) {
      if (U.spinning) return;
      var val = q.dataset.value, v;
      if (val === 'max') v = U.gold;
      else if (val === 'half') v = Math.floor(U.gold / 2);
      else v = parseInt(val, 10) || 0;
      U.stake = Math.max(10, Math.min(U.gold, v));
      renderPage();
      return;
    }
    if (t.closest('[data-upg-act="spin"]')) { e.preventDefault(); e.stopPropagation(); spin(); return; }
  }, true);

  /* ─── Отрисовка ─── */
  function renderPage() {
    var box = document.getElementById('upgBody');
    if (!box) return;
    var gold = U.gold;
    var cfg = MULTS.filter(function (x) { return x.mult === U.mult; })[0] || MULTS[1];
    var maxStake = Math.max(10, gold);
    if (U.stake > maxStake) U.stake = maxStake;
    var payout = Math.floor(U.stake * U.mult);

    box.innerHTML =
      '<div class="upg-card">' +
        '<div class="upg-mults">' +
          MULTS.map(function (m) {
            return '<div class="upg-mult ' + (m.mult === U.mult ? 'on' : '') + '" data-upg-act="mult" data-mult="' + m.mult + '">' +
              '<b>' + m.label + '</b><span>×' + m.mult + '</span>' +
              '<span class="chance">' + Math.round(m.chance * 100) + '% шанс</span></div>';
          }).join('') +
        '</div>' +
        '<div class="upg-wheel-wrap">' +
          '<div class="upg-pointer"></div>' +
          '<div class="upg-wheel" id="upgWheel">' + wheelSvg() + '</div>' +
          '<div class="upg-result" id="upgResult"><div class="upg-result-in"></div></div>' +
        '</div>' +
        '<div class="upg-stake">' +
          '<div class="upg-stake-row"><label>Ставка</label><div class="val" id="upgStakeVal">' + U.stake + '<small>G</small></div></div>' +
          '<input class="upg-slider" type="range" id="upgSlider" min="10" max="' + maxStake + '" step="10" value="' + Math.min(U.stake, maxStake) + '">' +
          '<div class="upg-quick">' +
            '<button type="button" data-upg-act="quick" data-value="100">100</button>' +
            '<button type="button" data-upg-act="quick" data-value="500">500</button>' +
            '<button type="button" data-upg-act="quick" data-value="1000">1000</button>' +
            '<button type="button" data-upg-act="quick" data-value="half">½</button>' +
            '<button type="button" data-upg-act="quick" data-value="max">Всё</button>' +
          '</div>' +
        '</div>' +
        '<button class="upg-spin" id="upgSpin" type="button" data-upg-act="spin"' + (gold < 10 ? ' disabled' : '') + '>' +
          '<i class="fas fa-arrow-trend-up"></i> КРУТИТЬ · выигрыш ' + payout + ' G' +
        '</button>' +
        '<div class="upg-hint">Выигрыш: <b>' + payout + ' G</b> · Шанс: <b>' + Math.round(cfg.chance * 100) + '%</b><br>Баланс: <b>' + gold + ' G</b> · минимальная ставка 10 G</div>' +
      '</div>' +
      '<div class="panel" style="margin:0 0 24px"><div class="upg-feed-title"><span>Лента выигрышей</span><b>LIVE</b></div>' +
      '<div class="upg-feed" id="upgFeed">' + feedHtml() + '</div></div>';

    var slider = document.getElementById('upgSlider');
    if (slider) slider.addEventListener('input', function (e) {
      if (U.spinning) return;
      U.stake = Math.max(10, parseInt(e.target.value, 10) || 10);
      var valEl = document.getElementById('upgStakeVal');
      if (valEl) valEl.innerHTML = U.stake + '<small>G</small>';
      var btn = document.getElementById('upgSpin');
      if (btn) btn.innerHTML = '<i class="fas fa-arrow-trend-up"></i> КРУТИТЬ · выигрыш ' + Math.floor(U.stake * U.mult) + ' G';
    });
    var rotor = document.getElementById('upgRotor');
    if (rotor && U.wheelAngle) rotor.setAttribute('transform', 'rotate(' + (U.wheelAngle * 180 / Math.PI).toFixed(2) + ' 100 100)');
    if (!U.feed.length) loadFeed();
    if (!U.feedTimer) U.feedTimer = setInterval(function () { if (U.open) loadFeed(); }, 15000);
  }

  function wheelSvg() {
    var cx = 100, cy = 100, r = 92;
    var palette = ['#0f1633', '#172046', '#1a1440', '#222d5c'];
    var paths = '', labels = '';
    for (var i = 0; i < SEGS; i++) {
      var a0 = i * SEG_ANGLE - Math.PI / 2 - SEG_ANGLE / 2, a1 = a0 + SEG_ANGLE;
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      var val = SEED[i], isWin = val > 0, fill;
      if (isWin) fill = val === 5 ? 'url(#gGold)' : val === 2 ? 'url(#gGreen)' : 'url(#gBlue)';
      else fill = palette[i % palette.length];
      paths += '<path class="seg" d="M' + cx + ',' + cy + ' L' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + r + ',' + r + ' 0 0 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z" fill="' + fill + '"/>';
      var am = (a0 + a1) / 2;
      var lx = cx + (r - 26) * Math.cos(am), ly = cy + (r - 26) * Math.sin(am);
      var txt = isWin ? ('x' + val) : '—';
      labels += '<text class="seg-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" fill="' + (isWin ? '#0d1128' : 'rgba(200,220,255,.4)') + '" transform="rotate(' + (am * 180 / Math.PI + 90).toFixed(1) + ' ' + lx.toFixed(1) + ' ' + ly.toFixed(1) + ')">' + txt + '</text>';
    }
    return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#f5c451"/></linearGradient>' +
      '<linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8bf5c6"/><stop offset="1" stop-color="#3ddc97"/></linearGradient>' +
      '<linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#4f8cff"/></linearGradient>' +
      '<radialGradient id="hub" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#a16207"/></radialGradient>' +
      '</defs><g id="upgRotor">' + paths + labels + '</g>' +
      '<circle cx="100" cy="100" r="20" fill="url(#hub)" stroke="#7a4a05" stroke-width="2"/>' +
      '<circle cx="100" cy="100" r="10" fill="#0d1128" stroke="#7a4a05" stroke-width="1.5"/></svg>';
  }

  function pickTargetSeg(win, mult) {
    var pool = [];
    for (var i = 0; i < SEGS; i++) {
      var v = SEED[i];
      if (win && v === mult) pool.push(i);
      if (!win && v === 0) pool.push(i);
    }
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : 0;
  }
  function segCenterAngle(i) { return -i * SEG_ANGLE; }

  function spin() {
    if (U.spinning) return;
    if (U.gold < U.stake) { alert('Недостаточно голды'); return; }
    U.spinning = true;
    var btn = document.getElementById('upgSpin'), res = document.getElementById('upgResult');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Крутим…'; }
    if (res) { res.classList.remove('show', 'lose-in'); var ri = res.querySelector('.upg-result-in'); if (ri) ri.textContent = ''; }
    callRpc('upgrade_spin', { p_stake: U.stake, p_mult: U.mult })
      .then(function (r) {
        if (!r) throw new Error('Пустой ответ');
        doSpinAnimation(!!r.win, Number(r.mult) || U.mult, r);
      })
      .catch(function (e) {
        U.spinning = false;
        if (btn) { btn.disabled = false; btn.classList.remove('spinning'); btn.innerHTML = '<i class="fas fa-arrow-trend-up"></i> КРУТИТЬ · выигрыш ' + Math.floor(U.stake * U.mult) + ' G'; }
        alert('Ошибка: ' + ((e && e.message) || e));
      });
  }

  function doSpinAnimation(win, mult, result) {
    var rotor = document.getElementById('upgRotor');
    if (!rotor) { finishSpin(win, mult, result); return; }
    var cur = U.wheelAngle % (Math.PI * 2);
    var target = segCenterAngle(pickTargetSeg(win, mult));
    var loops = 4;
    var jitter = (Math.random() - 0.5) * SEG_ANGLE * 0.6;
    var diff = target + loops * 2 * Math.PI - cur;
    while (diff < 3.5 * 2 * Math.PI) diff += 2 * Math.PI;
    var startAngle = U.wheelAngle, endAngle = startAngle + diff + jitter;
    var duration = 4200, start = performance.now();
    var ease = function (t) {
      var b = 1 - Math.pow(1 - t, 3);
      var bait = t > 0.88 ? Math.sin((t - 0.88) / 0.12 * Math.PI) * 0.012 : 0;
      return Math.min(1, b + bait);
    };
    function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      var a = startAngle + diff * ease(t) + jitter * Math.min(1, t * 1.2);
      U.wheelAngle = a;
      rotor.setAttribute('transform', 'rotate(' + (a * 180 / Math.PI).toFixed(2) + ' 100 100)');
      if (t < 1) requestAnimationFrame(frame);
      else { U.wheelAngle = endAngle; rotor.setAttribute('transform', 'rotate(' + (endAngle * 180 / Math.PI).toFixed(2) + ' 100 100)'); finishSpin(win, mult, result); }
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(win, mult, result) {
    U.spinning = false;
    var btn = document.getElementById('upgSpin'), resBox = document.getElementById('upgResult');
    var resIn = resBox ? resBox.querySelector('.upg-result-in') : null;
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    if (win) {
      var amount = (result && result.payout) || Math.floor(U.stake * mult);
      if (resIn) resIn.textContent = '+' + amount + ' G · x' + mult;
      if (resBox) { resBox.classList.remove('lose-in'); resBox.classList.add('show'); }
    } else {
      if (resIn) resIn.textContent = '−' + U.stake + ' G';
      if (resBox) { resBox.classList.add('lose-in', 'show'); }
    }
    /* Баланс пришёл в ответе */
    if (result && result.gold != null) U.gold = result.gold;
    setTimeout(function () {
      if (resBox) resBox.classList.remove('show');
      renderPage();
    }, 2200);
  }

  function loadFeed() {
    callRpc('upgrade_feed', { p_limit: 15 })
      .then(function (rows) { U.feed = rows || []; var b = document.getElementById('upgFeed'); if (b) b.innerHTML = feedHtml(); })
      .catch(function () { var b = document.getElementById('upgFeed'); if (b && !U.feed.length) b.innerHTML = '<div class="upg-feed-empty">Лента пока пуста</div>'; });
  }

  function feedHtml() {
    if (!U.feed.length) return '<div class="upg-feed-empty">Лента пока пуста — сыграйте первый спин</div>';
    return U.feed.map(function (r) {
      var win = !!r.win, pay = win ? ('+' + (r.payout || 0) + ' G') : ('−' + (r.stake || 0) + ' G');
      var name = String(r.username || 'игрок').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
      return '<div class="upg-feed-item ' + (win ? 'win' : 'lose') + '"><span class="who">' + name + '</span><span class="mult">x' + r.mult + '</span><span class="meta">' + r.stake + ' G</span><span class="pay">' + pay + '</span></div>';
    }).join('');
  }

  /* ─── Автозапуск ─── */
  var cardWait = setInterval(function () { if (ensureSettingsCard()) clearInterval(cardWait); }, 300);
  try { new MutationObserver(function () { ensureSettingsCard(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* ok */ }
  ensureSettingsCard();
  console.log('[UPGRADER] v7 установлен');
})();
