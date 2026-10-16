/* ══════════════════════════════════════════════════════════════════════
   UPGRADER v8 — выбор процента, движется стрелка, колесо стоит
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  console.log('[UPGRADER] v8 загружен');

  var U = {
    stake: 10,
    chance: 50,      // 1..85
    spinning: false,
    angle: 0,        // угол стрелки в градусах (0 = верх)
    feed: [],
    feedTimer: null,
    gold: 0,
    open: false
  };

  var MIN_CHANCE = 1;
  var MAX_CHANCE = 85;
  var MIN_STAKE  = 10;

  /* ─── CSS ─── */
  if (!document.getElementById('upgStyle')) {
    var l = document.createElement('link');
    l.id = 'upgStyle'; l.rel = 'stylesheet'; l.href = 'upgrade.css';
    document.head.appendChild(l);
  }

  /* ─── RPC ─── */
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
      if (!r.ok) return r.text().then(function (t) { throw new Error('RPC ' + name + ': ' + t.slice(0, 120)); });
      return r.json();
    });
  }

  /* ─── Оверлей ─── */
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

  /* ─── Потенциальный выигрыш ─── */
  function payout() {
    /* payout = stake * 100 / chance, округляем вниз */
    return Math.max(1, Math.floor(U.stake * 100 / U.chance));
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
      '<div class="main"><b>UPGRADER</b><span>Выбери шанс и ставку — выигрыш по формуле</span></div>' +
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

  /* Слайдеры ставки и шанса */
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
      /* перерисовываем только заливку колеса и текст */
      updateWheelFill();
      updateLabels();
    }
  }, true);

  /* ─── Только текстовые лейблы (без перерисовки DOM) ─── */
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

  /* ─── Сектор заливки на колесе ─── */
  function updateWheelFill() {
    var arc = document.getElementById('upgWinArc');
    if (!arc) return;
    var cx = 100, cy = 100, r = 88;
    var startA = -Math.PI / 2;                        // верх
    var endA = startA + (U.chance / 100) * Math.PI * 2;
    var x0 = cx + r * Math.cos(startA), y0 = cy + r * Math.sin(startA);
    var x1 = cx + r * Math.cos(endA),   y1 = cy + r * Math.sin(endA);
    var largeArc = U.chance >= 50 ? 1 : 0;
    /* Путь: от центра к началу сектора, дуга, обратно к центру */
    var d = 'M' + cx + ',' + cy + ' L' + x0.toFixed(2) + ',' + y0.toFixed(2) +
            ' A' + r + ',' + r + ' 0 ' + largeArc + ' 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z';
    arc.setAttribute('d', d);
  }

  /* ─── Рендер страницы ─── */
  function renderPage() {
    var box = document.getElementById('upgBody');
    if (!box) return;
    var gold = U.gold;
    var maxStake = Math.max(MIN_STAKE, gold);
    if (U.stake > maxStake) U.stake = maxStake;

    box.innerHTML =
      '<div class="upg-card">' +

        /* Колесо со стрелкой */
        '<div class="upg-wheel-wrap">' +
          '<div class="upg-wheel" id="upgWheel">' +
            '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
              '<defs>' +
                '<radialGradient id="hubG" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#a16207"/></radialGradient>' +
              '</defs>' +
              /* фон круга */
              '<circle cx="100" cy="100" r="88" fill="#0f1633" stroke="rgba(255,255,255,.12)" stroke-width="2"/>' +
              /* сектор выигрыша */
              '<path id="upgWinArc" fill="#3ddc97" d="M100,100 L100,12 A88,88 0 1 1 100,12 Z" opacity=".85"/>' +
              /* оставшийся сектор — проигрыш */
              '<circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,77,109,.28)" stroke-width="2"/>' +
              /* hub */
              '<circle cx="100" cy="100" r="18" fill="url(#hubG)" stroke="#7a4a05" stroke-width="2"/>' +
              '<circle cx="100" cy="100" r="8" fill="#0d1128" stroke="#7a4a05" stroke-width="1.5"/>' +
            '</svg>' +
          '</div>' +
          /* стрелка вращается вокруг центра */
          '<div class="upg-arrow" id="upgArrow">' +
            '<svg viewBox="0 0 40 200" xmlns="http://www.w3.org/2000/svg">' +
              '<polygon points="20,10 32,40 26,40 26,190 14,190 14,40 8,40" fill="#f5c451" stroke="#7a4a05" stroke-width="1.5"/>' +
            '</svg>' +
          '</div>' +
          /* маркер-иголка сверху */
          '<div class="upg-marker"></div>' +
        '</div>' +

        /* Процент */
        '<div class="upg-row">' +
          '<label>Шанс победы</label>' +
          '<div class="val" id="upgChanceVal">' + U.chance + '%</div>' +
        '</div>' +
        '<input type="range" class="upg-slider upg-slider-green" min="' + MIN_CHANCE + '" max="' + MAX_CHANCE + '" step="1" value="' + U.chance + '" data-upg-act="chance-slider">' +
        '<div class="upg-marks"><span>1%</span><span>85%</span></div>' +

        /* Ставка */
        '<div class="upg-row" style="margin-top:16px">' +
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

        /* Информация */
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

    /* Начальная позиция стрелки */
    var arrow = document.getElementById('upgArrow');
    if (arrow) arrow.style.transform = 'rotate(' + U.angle + 'deg)';

    /* Заливка колеса */
    updateWheelFill();

    if (!U.feed.length) loadFeed();
    if (!U.feedTimer) U.feedTimer = setInterval(function () { if (U.open) loadFeed(); }, 15000);
  }

  /* ─── Спин ─── */
  function spin() {
    if (U.spinning) return;
    if (U.gold < U.stake) { alert('Недостаточно голды'); return; }
    U.spinning = true;
    var btn = document.getElementById('upgSpin');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Крутим…'; }

    /* Спрашиваем сервер, но сразу запускаем анимацию — она доведёт до правильного сектора */
    callRpc('upgrade_spin', { p_stake: U.stake, p_chance: U.chance })
      .then(function (r) {
        if (!r) throw new Error('Пустой ответ');
        doSpin(!!r.win, r);
      })
      .catch(function (e) {
        U.spinning = false;
        if (btn) { btn.disabled = false; btn.classList.remove('spinning'); btn.innerHTML = '<i class="fas fa-play"></i> КРУТИТЬ · выигрыш ' + payout() + ' G'; }
        alert('Ошибка: ' + ((e && e.message) || e));
      });
  }

  /* Как выглядит колесо:
     - сектор победы от 12 часов по часовой стрелке до U.chance% круга
     - сектор проигрыша — остаток
     Целевой угол для стрелки:
     - если победа → случайный угол в [0..chance% * 360)
     - если проигрыш → случайный угол в [chance% * 360 .. 360)
     Угол 0 = верх, по часовой. */
  function doSpin(win, result) {
    var arrow = document.getElementById('upgArrow');
    if (!arrow) { finishSpin(win, result); return; }

    var chanceAngle = (U.chance / 100) * 360;
    /* где должна встать стрелка */
    var targetDeg;
    if (win) targetDeg = Math.random() * (chanceAngle - 4) + 2;
    else     targetDeg = chanceAngle + 2 + Math.random() * (360 - chanceAngle - 4);
    if (targetDeg < 0) targetDeg = 0;
    if (targetDeg > 359) targetDeg = 359;

    /* текущий угол */
    var start = U.angle;
    /* куда крутим: минимум 4 полных оборота + до цели */
    var loops = 4 + Math.floor(Math.random() * 2);
    var total = start + loops * 360 + ((targetDeg - (start % 360)) + 360) % 360;
    var end = total;
    /* лёгкое «байтит» в конце — стрелка замедляется и слегка откатывает назад */
    var overshoot = end + 6 + Math.random() * 6;
    var backOff = end - 1 - Math.random() * 3;

    var duration = 4200;
    var startTime = performance.now();

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function frame(now) {
      var t = Math.min(1, (now - startTime) / duration);
      var eased = easeOutCubic(t);
      var a;
      /* сначала к overshoot, потом слегка назад к target — эффект «байтинга» */
      if (eased < 0.93) {
        a = start + (overshoot - start) * (eased / 0.93);
      } else {
        var t2 = (eased - 0.93) / 0.07;
        a = overshoot + (backOff - overshoot) * t2;
      }
      U.angle = a % 360;
      arrow.style.transform = 'rotate(' + a + 'deg)';
      if (t < 1) requestAnimationFrame(frame);
      else {
        U.angle = end % 360;
        arrow.style.transform = 'rotate(' + end + 'deg)';
        finishSpin(win, result);
      }
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(win, result) {
    U.spinning = false;
    var btn = document.getElementById('upgSpin');
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    if (result && result.gold != null) U.gold = result.gold;

    /* Вспышка результата на весь оверлей */
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

    /* Перерисовываем страницу с новым балансом */
    setTimeout(function () {
      if (U.open) {
        renderPage();
        /* Возвращаем стрелку в то же положение, чтобы визуально не прыгала */
        var arrow = document.getElementById('upgArrow');
        if (arrow) arrow.style.transform = 'rotate(' + U.angle + 'deg)';
      }
    }, 1700);
  }

  /* ─── Лента ─── */
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

  /* ─── Автозапуск ─── */
  var cardWait = setInterval(function () { if (ensureSettingsCard()) clearInterval(cardWait); }, 300);
  try { new MutationObserver(function () { ensureSettingsCard(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* ok */ }
  ensureSettingsCard();
  console.log('[UPGRADER] v8 установлен');
})();
