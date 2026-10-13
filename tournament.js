'use strict';
/* =====================================================================
   Турнир кланов. Подключается после app.js (использует его S, ACTIONS, rpc, dialog, toast...).
   Серверная часть — tournament.sql.
   ===================================================================== */
(function () {
  if (typeof S === 'undefined' || !document.getElementById('page-tournament')) return;

  S.tour = null; S.trSig = ''; S.trSeed = []; S.trSeedFor = null;
  if (!PAGES.includes('tournament')) PAGES.push('tournament');

  const T = () => (S.tour && S.tour.t) || null;
  const ents = () => (S.tour && S.tour.entries) || [];
  const accepted = () => ents().filter(e => e.status === 'accepted');
  const entById = id => ents().find(e => String(e.id) === String(id));
  const isAdm = () => !!(S.me && S.me.isadmin);
  const fmtN = n => Number(n || 0).toLocaleString('ru-RU');
  const fmtT = n => n + '×' + n;
  const STATUS = { registration: ['Набор команд', 'ok'], live: ['Идёт турнир', 'live'], finished: ['Завершён', ''] };

  /* ───── загрузка ───── */
  async function loadTour() {
    if (!S.me) { S.tour = null; paintCard(); return; }
    try {
      const r = await rpc('tournament_state');
      S.tour = r || { t: null, entries: [], mine: null };
    } catch (e) {
      if (!S.tour) S.tour = { t: null, entries: [], mine: null };
    }
    paintCard();
    if (S.page === 'tournament') {
      const sig = JSON.stringify(S.tour) + '|' + isAdm();
      if (sig !== S.trSig) renderPage();
    }
  }

  /* ───── карточка на главной ───── */
  function cardHtml() {
    if (!S.me || !S.tour) return '';
    const t = T();
    if (!t) {
      return isAdm()
        ? `<div class="tr-card tr-create" data-act="tr-create-open"><span class="tr-ico"><i class="fas fa-plus"></i></span>
            <div class="tr-main"><small>Только для админа</small><b>Создать турнир кланов</b></div><i class="fas fa-chevron-right"></i></div>`
        : '';
    }
    const st = STATUS[t.status] || STATUS.registration;
    const champ = t.status === 'finished' && t.champion ? entById(t.champion) : null;
    return `<div class="tr-card" data-act="tr-open"><span class="tr-ico"><i class="fas fa-trophy"></i></span>
      <div class="tr-main"><small>Турнир кланов</small><b>${esc(t.name)}</b>
        <div class="tr-chips">
          <span class="tr-chip"><i class="fas fa-coins"></i> ${fmtN(t.prize)} голды</span>
          <span class="tr-chip">${fmtT(t.team_size)}</span>
          <span class="tr-chip"><i class="fas fa-shield-halved"></i> ${accepted().length}/${t.slots}</span>
          <span class="tr-chip ${st[1]}">${st[0]}</span>
          ${champ ? `<span class="tr-chip ok"><i class="fas fa-crown"></i> [${esc(champ.tag)}]</span>` : ''}
        </div></div><i class="fas fa-chevron-right"></i></div>`;
  }
  function paintCard() {
    const el = document.getElementById('tourSlot'); if (!el) return;
    const h = cardHtml();
    if (el._h !== h) { el._h = h; el.innerHTML = h; }
  }

  /* ───── страница турнира ───── */
  function roundName(matches) {
    return matches === 1 ? 'Финал' : matches === 2 ? 'Полуфинал' : matches === 4 ? 'Четвертьфинал' : '1/' + matches + ' финала';
  }

  function teamRow(id, m, ri, mi, canPick) {
    const e = id != null ? entById(id) : null;
    if (!e) return `<div class="br-t tbd"><span class="cl-av ph" style="--s:26px">?</span><span class="br-n">Ожидается</span></div>`;
    const decided = m.w != null, isW = decided && String(m.w) === String(id);
    const click = canPick && m.a != null && m.b != null && !decided;
    return `<div class="br-t ${isW ? 'win' : ''} ${decided && !isW ? 'lose' : ''}" ${click ? `data-act="tr-win" data-r="${ri}" data-m="${mi}" data-w="${e.id}"` : ''}>
      ${clanAvHtml(e, 26)}<span class="br-n"><em class="cl-tag">[${esc(e.tag)}]</em> ${esc(e.name)}</span>${isW ? '<i class="fas fa-crown br-crown"></i>' : ''}</div>`;
  }
  function matchHtml(m, ri, mi, adm) {
    return `<div class="br-m ${m.w != null ? 'done' : ''}">${teamRow(m.a, m, ri, mi, adm)}${teamRow(m.b, m, ri, mi, adm)}
      ${adm && m.w != null ? `<button class="br-undo" data-act="tr-clear" data-r="${ri}" data-m="${mi}"><i class="fas fa-rotate-left"></i> Сбросить результат</button>` : ''}</div>`;
  }
  function bracketHtml(t) {
    const rounds = (t.bracket && t.bracket.rounds) || [];
    if (!rounds.length) return '';
    const adm = isAdm() && t.status === 'live';
    const cols = rounds.map((rd, ri) => {
      const last = ri === rounds.length - 1;
      const slot = h => `<div class="br-slot ${last ? 'last' : ''}">${h}</div>`;
      let body = '';
      if (last) body = slot(matchHtml(rd[0], ri, 0, adm));
      else for (let i = 0; i < rd.length; i += 2) body += `<div class="br-pair">${slot(matchHtml(rd[i], ri, i, adm))}${slot(matchHtml(rd[i + 1], ri, i + 1, adm))}</div>`;
      return `<div class="br-col"><div class="br-h">${roundName(rd.length)}</div><div class="br-body">${body}</div></div>`;
    }).join('');
    return `${adm ? '<p class="br-hint">Нажмите на клан в матче, чтобы назначить его победителем</p>' : ''}
      <div class="br-scroll"><div class="br-wrap" style="--h:${rounds[0].length * 104}px">${cols}</div></div>`;
  }

  function applyHtml(t) {
    if (t.status !== 'registration') return '';
    const mine = S.tour.mine;
    let inner;
    if (!mine) {
      inner = '<p class="tr-note">У вас нет клана. Создайте клан в профиле — лидер клана сможет подать заявку на турнир.</p>';
    } else if (!mine.owner) {
      inner = `<p class="tr-note">Ваш клан${mine.tag ? ' [' + esc(mine.tag) + ']' : ''} может участвовать. Заявку подаёт лидер клана.</p>
        ${mine.entry === 'accepted' ? '<div class="tr-state ok"><i class="fas fa-circle-check"></i> Ваш клан принят в турнир</div>'
          : mine.entry === 'pending' ? '<div class="tr-state"><i class="fas fa-hourglass-half"></i> Заявка отправлена, ждём решения админа</div>' : ''}`;
    } else if (mine.entry === 'accepted') {
      inner = `<div class="tr-state ok"><i class="fas fa-circle-check"></i> Ваш клан принят в турнир</div>
        <button class="btn btn-ghost btn-block" data-act="tr-withdraw">Отозвать участие</button>`;
    } else if (mine.entry === 'pending') {
      inner = `<div class="tr-state"><i class="fas fa-hourglass-half"></i> Заявка отправлена, ждём решения админа</div>
        <button class="btn btn-ghost btn-block" data-act="tr-withdraw">Отозвать заявку</button>`;
    } else {
      const few = mine.members < t.team_size;
      inner = `${mine.entry === 'rejected' ? '<div class="tr-state bad"><i class="fas fa-circle-xmark"></i> Прошлая заявка отклонена</div>' : ''}
        <p class="tr-note">Формат ${fmtT(t.team_size)}: в клане нужно минимум ${t.team_size} ${t.team_size === 1 ? 'игрок' : 'игроков'}${few ? ` (сейчас ${mine.members})` : ''}.</p>
        <button class="btn btn-primary btn-block" data-act="tr-apply" ${few ? 'disabled' : ''}><i class="fas fa-paper-plane"></i> Подать заявку</button>`;
    }
    return `<div class="panel"><div class="panel-head"><h3><i class="fas fa-shield-halved"></i> Участие</h3></div>${inner}</div>`;
  }

  function seedHtml(t) {
    const acc = accepted();
    if (S.trSeedFor !== t.id || S.trSeed.length !== t.slots) { S.trSeedFor = t.id; S.trSeed = new Array(t.slots).fill(''); }
    const seed = S.trSeed, used = new Set(seed.filter(Boolean).map(String));
    const sel = k => `<select class="text-input tr-sel" data-i="${k}"><option value="">— выбрать клан —</option>${
      acc.filter(e => !used.has(String(e.id)) || String(seed[k]) === String(e.id))
        .map(e => `<option value="${e.id}" ${String(seed[k]) === String(e.id) ? 'selected' : ''}>[${esc(e.tag)}] ${esc(e.name)}</option>`).join('')}</select>`;
    let rows = '';
    for (let i = 0; i < t.slots / 2; i++) rows += `<div class="sd-m"><b>Матч ${i + 1}</b>${sel(2 * i)}<span class="vs">VS</span>${sel(2 * i + 1)}</div>`;
    const full = seed.every(Boolean);
    return `<div class="panel"><div class="panel-head"><h3><i class="fas fa-sitemap"></i> Сетка</h3><span class="aside">кто с кем играет</span></div>
      ${rows}
      <div class="tr-btns"><button class="btn btn-ghost" data-act="tr-shuffle"><i class="fas fa-shuffle"></i> Случайно</button>
      <button class="btn btn-primary" data-act="tr-seed-save" ${full ? '' : 'disabled'}><i class="fas fa-check"></i> Запустить турнир</button></div></div>`;
  }

  function adminHtml(t) {
    if (!isAdm()) return '';
    const pend = ents().filter(e => e.status === 'pending');
    let h = '';
    if (t.status === 'registration') {
      h += `<div class="panel"><div class="panel-head"><h3><i class="fas fa-inbox"></i> Заявки</h3><span class="aside">${pend.length}</span></div>
        ${pend.length ? '<div class="rows">' + pend.map(e => `<div class="row" style="flex-wrap:wrap">
          ${clanAvHtml(e, 40)}<div class="row-main"><div class="row-title"><em class="cl-tag">[${esc(e.tag)}]</em> ${esc(e.name)}</div></div>
          <div class="row-actions"><button class="btn btn-ok btn-sm" data-act="tr-entry" data-id="${e.id}" data-st="accepted">Принять</button>
          <button class="btn btn-danger btn-sm" data-act="tr-entry" data-id="${e.id}" data-st="rejected">Отклонить</button></div></div>`).join('') + '</div>'
          : '<div class="empty" style="padding:14px">Новых заявок нет</div>'}</div>`;
      if (accepted().length === t.slots) h += seedHtml(t);
      else h += `<div class="tr-state"><i class="fas fa-circle-info"></i> Сетку можно составить, когда наберётся ${t.slots} команд (сейчас ${accepted().length})</div>`;
    }
    h += `<div class="panel"><div class="panel-head"><h3><i class="fas fa-user-shield"></i> Управление</h3></div><div class="tr-btns">
      ${t.status !== 'registration' ? '<button class="btn btn-ghost" data-act="tr-unseed"><i class="fas fa-rotate-left"></i> Сбросить сетку</button>' : ''}
      <button class="btn btn-danger" data-act="tr-delete"><i class="fas fa-trash"></i> Удалить турнир</button></div></div>`;
    return h;
  }

  function renderPage() {
    const box = document.getElementById('tourBody'); if (!box) return;
    S.trSig = JSON.stringify(S.tour) + '|' + isAdm();
    const t = T();
    const back = '<button class="btn btn-ghost btn-sm cl-back" data-act="nav" data-page="home"><i class="fas fa-arrow-left"></i> Назад</button>';
    if (!t) { box.innerHTML = back + '<div class="empty"><i class="fas fa-trophy"></i>Турнира пока нет</div>'; return; }
    const st = STATUS[t.status] || STATUS.registration;
    const champ = t.status === 'finished' && t.champion ? entById(t.champion) : null;
    const teams = accepted();
    box.innerHTML = `${back}
      <div class="tr-hero"><span class="tr-ico"><i class="fas fa-trophy"></i></span><h2>${esc(t.name)}</h2>
        <div class="tr-chips"><span class="tr-chip ${st[1]}">${st[0]}</span></div>
        <div class="tr-tiles">
          <div><span>Призовой фонд</span><b class="gold">${fmtN(t.prize)}</b></div>
          <div><span>Формат</span><b>${fmtT(t.team_size)}</b></div>
          <div><span>Команды</span><b>${teams.length}/${t.slots}</b></div></div></div>
      ${champ ? `<div class="tr-champ"><i class="fas fa-crown"></i>${clanAvHtml(champ, 54)}<div class="cc"><small>Победитель турнира</small><b>[${esc(champ.tag)}] ${esc(champ.name)}</b></div></div>` : ''}
      ${t.status !== 'registration' ? bracketHtml(t) : ''}
      ${applyHtml(t)}
      <div class="panel"><div class="panel-head"><h3><i class="fas fa-users"></i> Участники</h3><span class="aside">${teams.length}/${t.slots}</span></div>
        ${teams.length ? '<div class="rows">' + teams.map((e, i) => `<div class="row"><div class="top-rank">#${i + 1}</div>${clanAvHtml(e, 38)}
          <div class="row-main"><div class="row-title"><em class="cl-tag">[${esc(e.tag)}]</em> ${esc(e.name)}</div></div></div>`).join('') + '</div>'
          : '<div class="empty" style="padding:16px">Пока никто не принят</div>'}</div>
      ${adminHtml(t)}`;
  }

  /* ───── навигация ───── */
  const _nav = navigate;
  navigate = function (page) {
    _nav(page);
    if (page === 'tournament') { renderPage(); loadTour(); }
    if (page === 'home') paintCard();
  };

  /* ───── действия ───── */
  const reload = async () => { S.trSig = ''; await loadTour(); if (S.page === 'tournament') renderPage(); };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  Object.assign(ACTIONS, {
    'tr-open': () => navigate('tournament'),
    'tr-create-open': () => { if (isAdm()) openModal('tourModal'); },
    'tr-create': async () => {
      const name = document.getElementById('trName').value.trim();
      const slots = parseInt(document.getElementById('trSlots').value, 10);
      const size = parseInt(document.getElementById('trSize').value, 10);
      const prize = parseInt(document.getElementById('trPrize').value, 10);
      if (!Number.isFinite(prize) || prize < 0) return toast('error', 'Укажите призовой фонд', 'Число голды, например 100000');
      await rpc('admin_create_tournament', { p_name: name, p_slots: slots, p_team_size: size, p_prize: prize });
      closeModal('tourModal');
      toast('success', 'Турнир создан', 'Теперь его видят все игроки');
      await reload();
      navigate('tournament');
    },
    'tr-apply': async () => { await rpc('tournament_apply'); toast('success', 'Заявка отправлена', 'Ждём решения админа'); await reload(); },
    'tr-withdraw': async () => {
      const ok = await dialog({ title: 'Отозвать заявку?', text: 'Клан выйдет из списка участников турнира.', ok: 'Отозвать', danger: true });
      if (!ok) return;
      await rpc('tournament_withdraw'); await reload();
    },
    'tr-entry': async d => {
      await rpc('admin_tournament_entry', { p_entry: Number(d.id), p_status: d.st });
      toast('success', d.st === 'accepted' ? 'Клан принят' : 'Заявка отклонена', '');
      await reload();
    },
    'tr-shuffle': () => {
      const t = T(); if (!t) return;
      S.trSeed = shuffle(accepted().map(e => String(e.id)));
      renderPage();
    },
    'tr-seed-save': async () => {
      const t = T(); if (!t) return;
      if (!S.trSeed.length || !S.trSeed.every(Boolean)) return toast('error', 'Заполните все места', '');
      const ok = await dialog({ title: 'Запустить турнир?', text: 'Сетка будет составлена. Позже её можно сбросить.', ok: 'Запустить' });
      if (!ok) return;
      await rpc('admin_tournament_seed', { p_id: t.id, p_order: S.trSeed.map(Number) });
      toast('success', 'Сетка составлена', 'Турнир начался');
      await reload();
    },
    'tr-win': async d => {
      const t = T(); const e = entById(d.w); if (!t || !e) return;
      const ok = await dialog({ title: `Победитель: [${e.tag}] ${e.name}?`, text: 'Клан пройдёт в следующий раунд.', ok: 'Подтвердить' });
      if (!ok) return;
      await rpc('admin_tournament_winner', { p_id: t.id, p_round: Number(d.r), p_match: Number(d.m), p_winner: Number(d.w) });
      await reload();
    },
    'tr-clear': async d => {
      const t = T(); if (!t) return;
      const ok = await dialog({ title: 'Сбросить результат матча?', ok: 'Сбросить', danger: true });
      if (!ok) return;
      await rpc('admin_tournament_clear_winner', { p_id: t.id, p_round: Number(d.r), p_match: Number(d.m) });
      await reload();
    },
    'tr-unseed': async () => {
      const t = T(); if (!t) return;
      const ok = await dialog({ title: 'Сбросить сетку?', text: 'Все результаты матчей пропадут, турнир вернётся к набору команд.', ok: 'Сбросить', danger: true });
      if (!ok) return;
      await rpc('admin_tournament_unseed', { p_id: t.id }); S.trSeed = []; await reload();
    },
    'tr-delete': async () => {
      const t = T(); if (!t) return;
      const ok = await dialog({ title: 'Удалить турнир?', text: 'Турнир, заявки и сетка будут удалены. Игроки перестанут его видеть.', ok: 'Удалить', danger: true });
      if (!ok) return;
      await rpc('admin_tournament_delete', { p_id: t.id });
      S.tour = { t: null, entries: [], mine: null };
      toast('info', 'Турнир удалён', '');
      paintCard(); navigate('home');
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.classList && el.classList.contains('tr-sel')) { S.trSeed[+el.dataset.i] = el.value; renderPage(); }
  });
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'tourModal') closeModal('tourModal');
  });

  /* ───── опрос ───── */
  setInterval(() => { if (!document.hidden) loadTour(); }, 5000);
  setTimeout(loadTour, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadTour(); });
})();
