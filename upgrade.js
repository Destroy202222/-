 /* ══════════════════════════════════════════════════════════════════════
   UPGRADER v11 — короткая стрелка + плавное замедление + no-x-scroll
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  console.log('[UPGRADER] v11 загружен');

  var U = {
    stake: 10, chance: 50, spinning: false, angle: 0,
    feed: [], feedTimer: null, gold: 0, open: false, lastResult: null
  };
  var MIN_CHANCE = 1, MAX_CHANCE = 85, MIN_STAKE = 10;

  /* ─── Запрет горизонтального скролла страницы ─── */
  (function blockXScroll() {
    if (document.getElementById('upgNoXScroll')) return;
    var s = document.createElement('style');
    s.id = 'upgNoXScroll';
    s.textContent = 'html,body{overflow-x:hidden !important;max-width:100vw !important}';
    document.head.appendChild(s);
    /* touch: если свайп строго горизонтальный — гасим */
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      this._x0 = e.touches[0].clientX;
      this._y0 = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 1 || this._x0 == null) return;
      var dx = Math.abs(e.touches[0].clientX - this._x0);
      var dy = Math.abs(e.touches[0].clientY - this._y0);
      if (dx > dy && dx > 12) e.preventDefault();
    }, { passive: false });
  })();

  if (!document.getElementById('upgStyle')) {
    var l = document.createElement('link');
    l.id = 'upgStyle'; l.rel = 'stylesheet'; l.href = 'upgrade.css';
    document.head.appendChild(l);
  }

  var SB_URL = 'https://ggjkivobmwwqgzkaaihx.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnamtpdm9ibXd3cWd6a2FhaWh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NzQzODcsImV4cCI6MjEwNzE1MDM4N30.flfcDmjp9riwZe9N4xCqX9CzIo6D9x9SeeQB3YU7254';
  function getSession() { try { return localStorage.getItem('bnk_session') || ''; } catch (e) { return ''; } }
  function callRpc(name, args) {
    var token = getSession();
    return fetch(SB_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'X-Client-Info': 'bnk/' + token
      },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('RPC ' + name + ': ' + t.slice(0, 140)); });
      return r.json();
    });
  }

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
    document.body.style.overflowX = 'hidden';
    var sm = document.getElementById('settingsModal');
    if (sm) { sm.classList.remove('active'); sm.setAttribute('aria-hidden', 'true'); }
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
        if (U.stake > U.gold) U.stake = Math.max(MIN_STAKE, U.gold);
        renderPage();
      })
      .catch(function () { U.gold = U.gold || 0; renderPage(); });
  }

  function payout() { return Math.max(1, Math.floor(U.stake * 100 / U.chance)); }

  function ensureSettingsCard() {
    var sheet = document.querySelector('#settingsModal .sheet');
    if (!sheet || sheet.querySelector('.settings-upg')) return !!sheet;
    var card = document.createElement('div');
    card.className = 'settings-upg';
    card.setAttribute('role', 'button');
    card.innerHTML =
      '<div class="ico"><i class="fas fa-arrow-trend-up"></i></div>' +
      '<div class="main"><b>UPGRADER</b><span>Выбери шанс и ставку — выигрыш по формуле</span></div>' +
      '<i class="fas fa-chevron-right"></i>';
    var wallet = sheet.querySelector('[data-page="wallet"]');
    if (wallet) wallet.insertAdjacentElement('afterend', card);
    else sheet.insertBefore(card, sheet.children[1] || null);
    return true;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.settings-upg')) { e.preventDefault(); e.stopPropagation(); return openOverlay(); }
    if (t.closest('[data-upg-act="close"]')) { e.preventDefault(); e.stopPropagation(); return closeOverlay(); }
    var q = t.closest('[data-upg-act="stake-quick"]');
    if (q) {
      if (U.spinning) return;
      var val = q.dataset.value, v;
      if (val === 'max') v = U.gold;
      else if (val === 'half') v = Math.floor(U.gold / 2);
      else v = parseInt(val, 10) || 0;
      U.stake = Math.max(MIN_STAKE, Math.min(U.gold, v));
      renderPage();
      return;
    }
    if (t.closest('[data-upg-act="spin"]')) { e.preventDefault(); e.stopPropagation(); spin(); return; }
  }, true);

  document.addEventListener('input', function (e) {
    if (!e.target || !e.target.dataset) return;
    if (e.target.dataset.upgAct === 'stake-slider') {
      if (U.spinning) return;
      U.stake = Math.max(MIN_STAKE, parseInt(e.target.value, 10) || MIN_STAKE);
      updateLabels();
    }
    if (e.target.dataset.upgAct === 'chance-slider') {
      if (U.spinning) return;
      U.chance = Math.max(MIN_CHANCE, Math.min(MAX_CHANCE, parseInt(e.target.value, 10) || MIN_CHANCE));
      updateWheel();
      updateLabels();
    }
  }, true);

  function updateLabels() {
    var sv = document.getElementById('upgStakeVal');
    if (sv) sv.innerHTML = U.stake + '<small>G</small>';
    var cv = document.getElementById('upgChanceVal');
    if (cv) cv.textContent = U.chance + '%';
    var pay = document.getElementById('upgPayout');
    if (pay) pay.textContent = payout() + ' G';
    var btn = document.getElementById('upgSpin');
    if (btn) btn.innerHTML = '<i class="fas fa-play"></i> КРУТИТЬ · выигрыш ' + payout() + ' G';
  }

  function updateWheel() {
    var arc = document.getElementById('upgWinArc');
    if (arc) {
      var cx = 100, cy = 100, r = 78;
      var chanceAngle = U.chance * 3.6;
      var half = chanceAngle / 2;
      var startA = (180 - half) * Math.PI / 180 - Math.PI / 2;
      var endA   = (180 + half) * Math.PI / 180 - Math.PI / 2;
      var x0 = cx + r * Math.cos(startA), y0 = cy + r * Math.sin(startA);
      var x1 = cx + r * Math.cos(endA),   y1 = cy + r * Math.sin(endA);
      var largeArc = chanceAngle > 180 ? 1 : 0;
      var d = 'M' + cx + ',' + cy + ' L' + x0.toFixed(2) + ',' + y0.toFixed(2) +
              ' A' + r + ',' + r + ' 0 ' + largeArc + ' 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z';
      arc.setAttribute('d', d);
    }
    var txt = document.getElementById('upgCenterTxt');
    if (txt) {
      if (U.spinning) { txt.textContent = 'Крутим…'; txt.className = 'upg-center-txt'; }
      else if (U.lastResult === 'win') { txt.textContent = 'ПОБЕДА'; txt.className = 'upg-center-txt win'; }
      else if (U.lastResult === 'lose') { txt.textContent = 'ПРОИГРЫШ'; txt.className = 'upg-center-txt lose'; }
      else { txt.textContent = U.chance + '%'; txt.className = 'upg-center-txt'; }
    }
  }

  function renderPage() {
    var box = document.getElementById('upgBody');
    if (!box) return;
    var gold = U.gold;
    var maxStake = Math.max(MIN_STAKE, gold);
    if (U.stake > maxStake) U.stake = maxStake;

    box.innerHTML =
      '<div class="upg-card">' +
        '<div class="upg-wheel-wrap">' +
          '<div class="upg-marker" id="upgMarker"></div>' +
          '<div class="upg-wheel" id="upgWheel">' +
            '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
              '<defs><linearGradient id="ringGrad" x1="0" y1="1" x2="0" y2="0">' +
                '<stop offset="0" stop-color="#ff4d6d"/>' +
                '<stop offset="0.5" stop-color="#f5c451"/>' +
                '<stop offset="1" stop-color="#3ddc97"/>' +
              '</linearGradient></defs>' +
              '<circle cx="100" cy="100" r="92" fill="none" stroke="#1a1440" stroke-width="6"/>' +
              '<circle cx="100" cy="100" r="92" fill="none" stroke="url(#ringGrad)" stroke-width="3" opacity=".85"/>' +
              '<circle cx="100" cy="100" r="78" fill="#0f1633" stroke="rgba(255,255,255,.08)" stroke-width="1"/>' +
              '<path id="upgWinArc" fill="#2a8a5e" d="M100,100 L100,22 A78,78 0 1 1 100,22 Z" opacity=".9"/>' +
              '<circle cx="100" cy="100" r="26" fill="rgba(7,11,28,.6)" stroke="rgba(255,255,255,.08)" stroke-width="1"/>' +
            '</svg>' +
            '<div class="upg-center-txt" id="upgCenterTxt">' + U.chance + '%</div>' +
          '</div>' +
        '</div>' +

        '<div class="upg-pct-labels">' +
          '<span class="pct-top">100%</span>' +
          '<span class="pct-left">50%</span>' +
          '<span class="pct-right">50%</span>' +
          '<span class="pct-bottom">0%</span>' +
        '</div>' +

        '<div class="upg-row" style="margin-top:14px">' +
          '<label>Шанс победы</label>' +
          '<div class="val" id="upgChanceVal">' + U.chance + '%</div>' +
        '</div>' +
        '<input type="range" class="upg-slider upg-slider-green" min="' + MIN_CHANCE + '" max="' + MAX_CHANCE + '" step="1" value="' + U.chance + '" data-upg-act="chance-slider">' +

        '<div class="upg-row" style="margin-top:14px">' +
          '<label>Ставка</label>' +
          '<div class="val" id="upgStakeVal">' + U.stake + '<small>G</small></div>' +
        '</div>' +
        '<input type="range" class="upg-slider" min="' + MIN_STAKE + '" max="' + maxStake + '" step="10" value="' + Math.min(U.stake, maxStake) + '" data-upg-act="stake-slider">' +
        '<div class="upg-quick">' +
          '<button type="button" data-upg-act="stake-quick" data-value="10">10</button>' +
          '<button type="button" data-upg-act="stake-quick" data-value="100">100</button>' +
          '<button type="button" data-upg-act="stake-quick" data-value="500">500</button>' +
          '<button type="button" data-upg-act="stake-quick" data-value="half">½</button>' +
          '<button type="button" data-upg-act="stake-quick" data-value="max">Всё</button>' +
        '</div>' +

        '<div class="upg-info">' +
          '<div><span>Выигрыш при победе</span><b id="upgPayout">' + payout() + ' G</b></div>' +
          '<div><span>Баланс</span><b>' + gold + ' G</b></div>' +
        '</div>' +

        '<button class="upg-spin" id="upgSpin" type="button" data-upg-act="spin"' + (gold < MIN_STAKE ? ' disabled' : '') + '>' +
          '<i class="fas fa-play"></i> КРУТИТЬ · выигрыш ' + payout() + ' G' +
        '</button>' +
      '</div>' +

      '<div class="panel" style="margin:14px 0 0"><div class="upg-feed-title"><span>Последние спины</span></div>' +
      '<div class="upg-feed" id="upgFeed">' + feedHtml() + '</div></div>';

    setMarkerAngle(U.angle);
    updateWheel();
    if (!U.feed.length) loadFeed();
    if (!U.feedTimer) U.feedTimer = setInterval(function () { if (U.open) loadFeed(); }, 15000);
  }

  function setMarkerAngle(deg) {
    var m = document.getElementById('upgMarker');
    if (!m) return;
    m.style.transform = 'rotate(' + deg + 'deg)';
  }

  function spin() {
    if (U.spinning) return;
    if (U.gold < U.stake) { alert('Недостаточно голды'); return; }
    U.spinning = true;
    U.lastResult = null;
    updateWheel();
    var btn = document.getElementById('upgSpin');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Крутим…'; }

    callRpc('upgrade_spin', { p_stake: U.stake, p_chance: U.chance })
      .then(function (r) { if (!r) throw new Error('Пустой ответ'); doSpin(!!r.win, r); })
      .catch(function (e) {
        U.spinning = false; U.lastResult = null; updateWheel();
        if (btn) { btn.disabled = false; btn.classList.remove('spinning'); btn.innerHTML = '<i class="fas fa-play"></i> КРУТИТЬ · выигрыш ' + payout() + ' G'; }
        alert('Ошибка: ' + ((e && e.message) || e));
      });
  }

  /* Плавное замедление — easeOutQuint, длится 6 секунд,
     стрелка долго катится на последних 30% и мягко останавливается. */
  function doSpin(win, result) {
    var chanceAngle = U.chance * 3.6;
    var half = chanceAngle / 2;

    var targetDeg;
    if (win) {
      var lo = 180 - half + 3, hi = 180 + half - 3;
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      targetDeg = lo + Math.random() * (hi - lo);
    } else {
      var top1 = 180 - half, bot = 180 + half;
      var span1 = Math.max(0, top1), span2 = Math.max(0, 360 - bot);
      var total = span1 + span2, r = Math.random() * total;
      targetDeg = r < span1 ? r : bot + (r - span1);
    }

    var start = U.angle;
    var loops = 5 + Math.floor(Math.random() * 3);      // 5-7 полных оборотов
    var baseTarget = ((targetDeg - (start % 360)) + 360) % 360;
    var end = start + loops * 360 + baseTarget;
    var overshoot = end + 10;                             // «байтит» на +10°
    var backOff = end + 1 + Math.random() * 1.5;

    var duration = 6000;                                  // 6 секунд — долгое плавное замедление
    var startTime = performance.now();

    /* easeOutQuint — очень плавно тормозит в конце */
    function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }

    function frame(now) {
      var t = Math.min(1, (now - startTime) / duration);
      var eased = easeOutQuint(t);
      var a;
      if (eased < 0.96) {
        a = start + (overshoot - start) * (eased / 0.96);
      } else {
        var t2 = (eased - 0.96) / 0.04;
        a = overshoot + (backOff - overshoot) * t2;
      }
      U.angle = a % 360;
      setMarkerAngle(a);
      if (t < 1) requestAnimationFrame(frame);
      else {
        U.angle = backOff % 360;
        setMarkerAngle(backOff);
        finishSpin(win, result);
      }
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(win, result) {
    U.spinning = false;
    U.lastResult = win ? 'win' : 'lose';
    var btn = document.getElementById('upgSpin');
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    if (result && result.gold != null) U.gold = result.gold;
    updateWheel();

    var flash = document.createElement('div');
    flash.className = 'upg-flash ' + (win ? 'win' : 'lose');
    flash.innerHTML =
      '<div class="upg-flash-in">' +
        '<div class="upg-flash-ico"><i class="fas ' + (win ? 'fa-trophy' : 'fa-xmark') + '"></i></div>' +
        '<div class="upg-flash-t">' + (win ? 'ПОБЕДА' : 'ПРОИГРЫШ') + '</div>' +
        '<div class="upg-flash-s">' + (win ? ('+' + ((result && result.payout) || payout()) + ' G') : ('−' + U.stake + ' G')) + '</div>' +
      '</div>';
    var ov = document.getElementById('upgOverlay');
    if (ov) ov.appendChild(flash);
    setTimeout(function () { flash.classList.add('out'); }, 1300);
    setTimeout(function () { flash.remove(); }, 1700);

    setTimeout(function () {
      if (U.open) {
        U.lastResult = null; updateWheel(); renderPage();
      }
    }, 2600);
  }

  function loadFeed() {
    callRpc('upgrade_feed', { p_limit: 15 })
      .then(function (rows) { U.feed = rows || []; var b = document.getElementById('upgFeed'); if (b) b.innerHTML = feedHtml(); })
      .catch(function () { var b = document.getElementById('upgFeed'); if (b && !U.feed.length) b.innerHTML = '<div class="upg-feed-empty">Пока ничего нет</div>'; });
  }
  function feedHtml() {
    if (!U.feed.length) return '<div class="upg-feed-empty">Пока ничего нет — крутите первым</div>';
    return U.feed.map(function (r) {
      var win = !!r.win;
      var pay = win ? ('+' + (r.payout || 0) + ' G') : ('−' + (r.stake || 0) + ' G');
      var name = String(r.username || 'игрок').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
      var chance = r.chance != null ? (Math.round(r.chance) + '%') : '—';
      return '<div class="upg-feed-item ' + (win ? 'win' : 'lose') + '"><span class="who">' + name + '</span>' +
        '<span class="mult">' + chance + '</span><span class="meta">' + r.stake + ' G</span><span class="pay">' + pay + '</span></div>';
    }).join('');
  }

  var cardWait = setInterval(function () { if (ensureSettingsCard()) clearInterval(cardWait); }, 300);
  try { new MutationObserver(function () { ensureSettingsCard(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* ok */ }
  ensureSettingsCard();
  console.log('[UPGRADER] v11 установлен');
})();
