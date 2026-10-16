/* ══════════════════════════════════════════════════════════════════════
   UPGRADER — рулетка на голду
   Подключается после app.js. Ничего в app.js менять не надо:
   скрипт сам вешает карточку в настройки, добавляет страницу,
   действие upg-open и рисует колесо.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof window.S === 'undefined' || typeof window.ACTIONS === 'undefined') {
    console.warn('[UPGRADER] app.js не загружен — модуль отключён');
    return;
  }

  /* ─── Конфигурация множителей ───
     chance — вероятность выигрыша на стороне КЛИЕНТА (для отображения %).
     Реальную судьбу решает сервер (upgrade_spin), но шансы должны совпадать. */
  const MULTS = [
    { mult: 1.5, chance: 0.65, color: '#4dabf7', label: 'x1.5' },
    { mult: 2,   chance: 0.48, color: '#3ddc97', label: 'x2'   },
    { mult: 5,   chance: 0.20, color: '#f5c451', label: 'x5'   }
  ];

  /* ─── Состояние ─── */
  const U = {
    mult: 2,
    stake: 100,
    spinning: false,
    feed: [],
    feedTimer: null,
    wheelAngle: 0            // текущий угол колеса (куда смотрит указатель)
  };

  /* ─── Кидаем стили и секцию в документ ─── */
  function injectStyle() {
    if (document.getElementById('upgStyle')) return;
    const link = document.createElement('link');
    link.id = 'upgStyle';
    link.rel = 'stylesheet';
    link.href = 'upgrade.css';
    document.head.appendChild(link);
  }

  function injectPage() {
    if (document.getElementById('page-upgrader')) return;
    const app = document.getElementById('app');
    if (!app) return;
    const section = document.createElement('section');
    section.className = 'page';
    section.id = 'page-upgrader';
    section.innerHTML = '<div id="upgBody"></div>';
    const nav = app.querySelector('.nav');
    if (nav) app.insertBefore(section, nav);
    else app.appendChild(section);
    /* Регистрируем страницу в PAGES, чтобы navigate() её не выкидывал */
    if (Array.isArray(window.PAGES) && !window.PAGES.includes('upgrader')) {
      window.PAGES.push('upgrader');
    }
  }

  function injectSettingsCard() {
    const sheet = document.querySelector('#settingsModal .sheet');
    if (!sheet || sheet.querySelector('.settings-upg')) return;
    const card = document.createElement('div');
    card.className = 'settings-upg';
    card.setAttribute('data-act', 'upg-open');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <div class="ico"><i class="fas fa-arrow-trend-up"></i></div>
      <div class="main">
        <b>UPGRADER</b>
        <span>Прокрути голду — умножь её в 1.5, 2 или 5 раз</span>
      </div>
      <i class="fas fa-chevron-right"></i>`;
    /* Вставляем после строки «Кошелёк», а если её нет — в начало */
    const wallet = sheet.querySelector('[data-page="wallet"]');
    if (wallet) wallet.insertAdjacentElement('afterend', card);
    else sheet.querySelector('.sheet-title').insertAdjacentElement('afterend', card);
  }

  /* ─── Перехватываем navigate, чтобы при заходе на 'upgrader' рисовать контент ─── */
  const _navigate = window.navigate;
  window.navigate = function (page) {
    /* Перед навигацией убеждаемся, что все куски на месте */
    injectSettingsCard();
    injectPage();
    _navigate.call(this, page);
    if (page === 'upgrader') renderUpgrader();
  };

  /* ─── Действия ─── */
  Object.assign(window.ACTIONS, {
    'upg-open': function () {
      if (typeof closeModal === 'function') closeModal('settingsModal');
      window.navigate('upgrader');
    },
    'upg-mult': function (d) {
      if (U.spinning) return;
      const m = parseFloat(d.mult);
      const found = MULTS.find(x => x.mult === m);
      if (!found) return;
      U.mult = m;
      renderUpgrader();
    },
    'upg-stake': function (d) {
      if (U.spinning) return;
      U.stake = Math.max(10, parseInt(d.value, 10) || U.stake);
      renderUpgrader();
    },
    'upg-stake-quick': function (d) {
      if (U.spinning) return;
      const v = d.value === 'max'
        ? Math.max(10, window.S.me ? (window.S.me.gold || 0) : 0)
        : (d.value === 'half'
            ? Math.max(10, Math.floor((window.S.me ? (window.S.me.gold || 0) : 0) / 2))
            : parseInt(d.value, 10) || 0);
      U.stake = Math.max(10, v);
      renderUpgrader();
    },
    'upg-spin': spin
  });

  /* ─── Отрисовка ─── */
  function renderUpgrader() {
    const box = document.getElementById('upgBody');
    if (!box || !window.S.me) return;
    const me = window.S.me;
    const gold = me.gold || 0;
    const cfg = MULTS.find(x => x.mult === U.mult) || MULTS[1];
    const maxStake = Math.max(10, Math.floor(gold / 1));
    if (U.stake > maxStake) U.stake = maxStake;
    const payout = Math.floor(U.stake * U.mult);

    box.innerHTML = `
      <div class="upg-head">
        <button class="icon-btn" data-act="nav" data-page="home" aria-label="Назад"><i class="fas fa-chevron-left"></i></button>
        <div><h2>UPGRADER</h2><p>Баланс: <b style="color:var(--gold)">${gold} G</b></p></div>
      </div>

      <div class="upg-card">
        <div class="upg-mults">
          ${MULTS.map(m => `
            <div class="upg-mult ${m.mult === U.mult ? 'on' : ''}" data-act="upg-mult" data-mult="${m.mult}">
              <b>${m.label}</b>
              <span>×${m.mult}</span>
              <span class="chance">${Math.round(m.chance * 100)}% шанс</span>
            </div>`).join('')}
        </div>

        <div class="upg-wheel-wrap">
          <div class="upg-pointer"></div>
          <div class="upg-wheel" id="upgWheel">${wheelSvg()}</div>
          <div class="upg-result" id="upgResult"><div class="upg-result-in"></div></div>
        </div>

        <div class="upg-stake">
          <div class="upg-stake-row">
            <label>Ставка</label>
            <div class="val">${U.stake}<small>G</small></div>
          </div>
          <input class="upg-slider" type="range" id="upgSlider"
                 min="10" max="${maxStake}" step="10" value="${Math.min(U.stake, maxStake)}">
          <div class="upg-quick">
            <button data-act="upg-stake-quick" data-value="100">100</button>
            <button data-act="upg-stake-quick" data-value="500">500</button>
            <button data-act="upg-stake-quick" data-value="1000">1000</button>
            <button data-act="upg-stake-quick" data-value="half">½</button>
            <button data-act="upg-stake-quick" data-value="max">Всё</button>
          </div>
        </div>

        <button class="upg-spin" id="upgSpin" data-act="upg-spin"
                ${gold < 10 ? 'disabled' : ''}>
          <i class="fas fa-arrow-trend-up"></i>
          КРУТИТЬ · выигрыш ${payout} G
        </button>

        <div class="upg-hint">
          Выигрыш: <b>${payout} G</b> · Шанс: <b>${Math.round(cfg.chance * 100)}%</b><br>
          Минимальная ставка — 10 G
        </div>
      </div>

      <div class="panel">
        <div class="upg-feed-title">
          <span>Лента выигрышей</span>
          <b>LIVE</b>
        </div>
        <div class="upg-feed" id="upgFeed">${feedHtml()}</div>
      </div>
    `;

    /* Навешиваем слайдер отдельно, потому что data-act его не поймает на input */
    const slider = document.getElementById('upgSlider');
    if (slider) {
      slider.addEventListener('input', e => {
        if (U.spinning) return;
        U.stake = Math.max(10, parseInt(e.target.value, 10) || 10);
        /* Обновляем надпись и кнопку без полной перерисовки (чтобы не дёргался курсор) */
        const valEl = box.querySelector('.upg-stake-row .val');
        if (valEl) valEl.innerHTML = U.stake + '<small>G</small>';
        const btn = box.querySelector('.upg-spin');
        if (btn) btn.innerHTML = `<i class="fas fa-arrow-trend-up"></i> КРУТИТЬ · выигрыш ${Math.floor(U.stake * U.mult)} G`;
        const hint = box.querySelector('.upg-hint');
        if (hint) hint.innerHTML = `Выигрыш: <b>${Math.floor(U.stake * U.mult)} G</b> · Шанс: <b>${Math.round(cfg.chance * 100)}%</b><br>Минимальная ставка — 10 G`;
      });
    }

    /* Если лента пуста — подгружаем с сервера */
    if (!U.feed.length) loadFeed();
    /* И раз в 15 сек обновляем ленту, пока мы на странице */
    if (!U.feedTimer) {
      U.feedTimer = setInterval(() => {
        if (window.S.page === 'upgrader') loadFeed();
      }, 15000);
    }
  }

  /* ─── SVG колеса ─── */
  function wheelSvg() {
    /* Колесо из 30 сегментов: перемешиваем множители так, чтобы
       пустых (проигрышных) было больше, но визуально было интересно.
       Реальная судьба решается сервером, а мы крутим колесо так,
       чтобы стрелка приземлилась на нужный сектор. */
    const SEGS = 30;
    const mults = [];   // что нарисовано на каждом сегменте
    /* Раскладка: 65% выигрышных для x1.5, 48% для x2, 20% для x5
       Сделаем смешанный пул с распределением под все три множителя сразу —
       для красоты. Пометим сегменты как win/lose и присвоим им коэффициент. */
    const seed = [1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0];
    for (let i = 0; i < SEGS; i++) mults.push(seed[i % seed.length]);

    const cx = 100, cy = 100, r = 92;
    const segAngle = 2 * Math.PI / SEGS;
    const palette = ['#0f1633', '#172046', '#1a1440', '#222d5c'];
    let paths = '', labels = '';
    for (let i = 0; i < SEGS; i++) {
      const a0 = i * segAngle - Math.PI / 2 - segAngle / 2;
      const a1 = a0 + segAngle;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const val = mults[i];
      const isWin = val > 0;
      /* цвет сектора */
      let fill;
      if (isWin) {
        if (val === 5) fill = 'url(#gGold)';
        else if (val === 2) fill = 'url(#gGreen)';
        else fill = 'url(#gBlue)';
      } else {
        fill = palette[i % palette.length];
      }
      paths += `<path class="seg" d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${fill}"/>`;
      /* подпись — по середине сектора */
      const am = (a0 + a1) / 2;
      const lx = cx + (r - 26) * Math.cos(am);
      const ly = cy + (r - 26) * Math.sin(am);
      const txt = isWin ? ('x' + val) : '—';
      const fill2 = isWin ? '#0d1128' : 'rgba(200,220,255,.4)';
      labels += `<text class="seg-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="${fill2}" transform="rotate(${(am * 180 / Math.PI + 90).toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})">${txt}</text>`;
    }

    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#f5c451"/>
        </linearGradient>
        <linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8bf5c6"/><stop offset="1" stop-color="#3ddc97"/>
        </linearGradient>
        <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#4f8cff"/>
        </linearGradient>
        <radialGradient id="hub" cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#a16207"/>
        </radialGradient>
      </defs>
      <g id="upgRotor">
        ${paths}
        ${labels}
      </g>
      <circle cx="100" cy="100" r="20" fill="url(#hub)" stroke="#7a4a05" stroke-width="2"/>
      <circle cx="100" cy="100" r="10" fill="#0d1128" stroke="#7a4a05" stroke-width="1.5"/>
    </svg>`;
  }

  /* ─── Вращение ───
     Приземляем стрелку так, чтобы под указателем (сверху, 12 часов) оказался
     нужный сегмент. Если win — выбираем сегмент с нужным множителем,
     если lose — любой пустой сегмент. */
  const SEGS = 30;

  function pickTargetSegIndex(win, mult) {
    /* индексы сегментов с заданным исходом */
    const seed = [1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0];
    const pool = [];
    for (let i = 0; i < SEGS; i++) {
      const v = seed[i % seed.length];
      if (win && v === mult) pool.push(i);
      if (!win && v === 0) pool.push(i);
    }
    if (!pool.length) pool.push(0);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* Угол сектора: центр сектора i в исходном положении */
  function segCenterAngle(i) {
    const segAngle = 2 * Math.PI / SEGS;
    /* сектор i нарисован так, что его центр — под углом (i * segAngle) от «верха»
       (т.к. a0 = i*seg - π/2 - seg/2, центр = i*seg - π/2). Значит чтобы поставить
       центр i под указатель (сверху = -π/2), нужно повернуть на -i*segAngle. */
    return -i * segAngle;
  }

  /* Плавный «спин»: колесо делает 4–5 полных оборотов + нужный угол.
     Замедляется кубической кривой, чуть-чуть «байтит» — почти останавливается
     за 20° до финала, потом доворачивает. */
  function spin() {
    if (U.spinning) return;
    const me = window.S.me;
    if (!me) return;
    if ((me.gold || 0) < U.stake) return window.toast('error', 'Недостаточно голды', 'Уменьшите ставку');

    U.spinning = true;
    const btn = document.getElementById('upgSpin');
    const res = document.getElementById('upgResult');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Крутим…'; }
    if (res) { res.classList.remove('show', 'lose-in'); res.querySelector('.upg-result-in').textContent = ''; }

    /* Запрашиваем у сервера результат, но анимацию не ждём — запускаем сразу.
       Как только ответ придёт — плавно доводим колесо до нужного сегмента. */
    window.rpc('upgrade_spin', { p_stake: U.stake, p_mult: U.mult })
      .then(r => {
        if (!r) throw new Error('Пустой ответ сервера');
        doSpinAnimation(!!r.win, Number(r.mult) || U.mult, r);
      })
      .catch(e => {
        U.spinning = false;
        if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
        window.toast('error', 'Не удалось прокрутить', window.errText ? window.errText(e) : String(e));
        renderUpgrader();
      });
  }

  function doSpinAnimation(win, mult, result) {
    const rotor = document.getElementById('upgRotor');
    const wrap = document.getElementById('upgWheel');
    if (!rotor) { finishSpin(win, mult, result); return; }

    /* Текущий угол колеса: держим в U.wheelAngle и нормализуем */
    const cur = U.wheelAngle % (Math.PI * 2);
    /* Целевой сектор */
    const idx = pickTargetSegIndex(win, mult);
    let target = segCenterAngle(idx);
    /* Делаем 4 полных оборота + небольшой «байт» — рандомный угол,
       чтобы указатель встал чуть-чуть «не ровно» по центру сектора. */
    const loops = 4;
    const jitter = (Math.random() - 0.5) * (2 * Math.PI / SEGS) * 0.6; // ±0.3 сектора
    /* Приводим target к текущему направлению вращения (по часовой стрелке) */
    let diff = target + loops * 2 * Math.PI - cur;
    /* Всегда крутим по часовой (положительный diff), но не меньше 3.5 оборотов */
    while (diff < 3.5 * 2 * Math.PI) diff += 2 * Math.PI;

    /* Стрелка байтит: почти останавливается за ~30° до цели, потом доедет.
       Делаем через CSS animation с двумя ключевыми точками (cubic-bezier). */
    const startAngle = U.wheelAngle;
    const endAngle = startAngle + diff + jitter;
    const duration = 4200;        // 4.2 сек — как в ТЗ «± 4 секунды»
    const start = performance.now();

    /* Кривая «с байтом»: сначала разгон, долгий накат, у цели — затухание.
       Используем простую easing-функцию с двумя пиками:
       ease(t) = 1 - (1-t)^3 + 0.04 * sin(t * 20) * (1-t)  — синус даёт «дрожь». */
    const ease = t => {
      const basic = 1 - Math.pow(1 - t, 3);
      /* за 8% до конца слегка «подвисаем»: делаем плавный шов */
      const bait = t > 0.88 ? Math.sin((t - 0.88) / 0.12 * Math.PI) * 0.012 : 0;
      return Math.min(1, basic + bait);
    };

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const a = startAngle + diff * ease(t) + jitter * Math.min(1, t * 1.2);
      U.wheelAngle = a;
      rotor.setAttribute('transform', `rotate(${(a * 180 / Math.PI).toFixed(2)} 100 100)`);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        /* Финальный угол — точно к цели (jitter уже учтён) */
        U.wheelAngle = endAngle;
        rotor.setAttribute('transform', `rotate(${(endAngle * 180 / Math.PI).toFixed(2)} 100 100)`);
        finishSpin(win, mult, result);
      }
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(win, mult, result) {
    U.spinning = false;
    const btn = document.getElementById('upgSpin');
    const resBox = document.getElementById('upgResult');
    const resIn = resBox ? resBox.querySelector('.upg-result-in') : null;
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }

    if (win) {
      if (resIn) resIn.textContent = `+${result.payout || Math.floor(U.stake * mult)} G · x${mult}`;
      if (resBox) { resBox.classList.remove('lose-in'); resBox.classList.add('show'); }
      if (window.playSound) window.playSound('found');
    } else {
      if (resIn) resIn.textContent = `−${U.stake} G`;
      if (resBox) { resBox.classList.add('lose-in', 'show'); }
      if (window.playSound) window.playSound('chime');
    }
    /* Прячем через 2.2 сек */
    setTimeout(() => {
      if (resBox) resBox.classList.remove('show');
      /* Обновляем баланс и ленту */
      if (result.gold != null && window.S.me) window.S.me.gold = result.gold;
      if (window.renderBalance) window.renderBalance();
      else if (window.S.me) { const el = document.getElementById('walletGold'); if (el) el.textContent = window.S.me.gold + ' G'; }
      renderUpgrader();
    }, 2200);
  }

  /* ─── Лента выигрышей ─── */
  async function loadFeed() {
    try {
      const rows = await window.rpc('upgrade_feed', { p_limit: 15 });
      U.feed = rows || [];
      const box = document.getElementById('upgFeed');
      if (box) box.innerHTML = feedHtml();
    } catch (e) {
      const box = document.getElementById('upgFeed');
      if (box && !U.feed.length) box.innerHTML = '<div class="upg-feed-empty">Лента пока пуста</div>';
    }
  }

  function feedHtml() {
    if (!U.feed.length) return '<div class="upg-feed-empty">Лента пока пуста — сыграйте первый спин</div>';
    return U.feed.map(r => {
      const win = !!r.win;
      const pay = win ? ('+' + (r.payout || 0) + ' G') : ('−' + (r.stake || 0) + ' G');
      return `<div class="upg-feed-item ${win ? 'win' : 'lose'}">
        <span class="who">${escapeHtml(r.username || 'игрок')}</span>
        <span class="mult">x${r.mult}</span>
        <span class="meta">${r.stake} G</span>
        <span class="pay">${pay}</span>
      </div>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ─── Клик по стрелкам/множителям через делегирование, потому что элементы появляются динамически ─── */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (!act || !act.startsWith('upg-')) return;
    /* ACTIONS уже вызывается в app.js, но там его нет — мы его добавили выше.
       Однако app.js перехватывает событие и вызывает run() для нашего action.
       Главное — не дать app.js дважды вызвать один клик. Пометим. */
  }, true /* capture: срабатываем раньше app.js, но всё же даём app.js свою работу */);

  /* ─── Первая инъекция после загрузки app.js ─── */
  function boot() {
    injectStyle();
    injectPage();
    injectSettingsCard();
    /* Обновляем карточку в настройках, если её вдруг снесут при перерисовке */
    setInterval(injectSettingsCard, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[UPGRADER] ready');
})();
