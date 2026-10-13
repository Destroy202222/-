'use strict';
/* =====================================================================
   Личные сообщения 1 на 1. Подключается после app.js. Серверная часть — chat.sql.
   Диалоги с админом подсвечиваются золотом и значком АДМИН.
   ===================================================================== */
(function () {
  if (typeof S === 'undefined') return;
  const C = { view: 'list', peer: null, last: 0, threads: [], unread: 0, busy: false, q: '', qt: 0 };
  let fab, panel, box;

  const timeFmt = s => { try { return new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  const badge = u => u && u.isadmin ? '<span class="ch-badge"><i class="fas fa-crown"></i> АДМИН</span>' : '';
  const logged = () => !!(S.me && S.me.id);

  function build() {
    fab = document.createElement('button');
    fab.className = 'ch-fab'; fab.hidden = true; fab.setAttribute('aria-label', 'Сообщения');
    fab.innerHTML = '<i class="fas fa-comment-dots"></i><span class="dot" hidden>0</span>';
    document.body.appendChild(fab);
    panel = document.createElement('div');
    panel.className = 'ch-panel'; panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '<div class="ch-box" id="chBox"></div>';
    document.body.appendChild(panel);
    box = panel.querySelector('#chBox');
    fab.addEventListener('click', () => open());
    panel.addEventListener('click', onClick);
    panel.addEventListener('input', e => { if (e.target.id === 'chQ') { clearTimeout(C.qt); C.q = e.target.value; C.qt = setTimeout(doSearch, 300); } });
    panel.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'chText') { e.preventDefault(); send(); } });
  }

  function paintDot() {
    const d = fab.querySelector('.dot');
    d.hidden = !C.unread; d.textContent = C.unread > 99 ? '99+' : C.unread;
  }
  async function pollUnread() {
    if (!logged()) { fab.hidden = true; return; }
    fab.hidden = panel.classList.contains('active');
    try { C.unread = Number(await rpc('dm_unread')) || 0; paintDot(); } catch (e) { /* таблицы может ещё не быть */ }
  }

  function open() {
    if (!logged()) return;
    panel.classList.add('active'); panel.setAttribute('aria-hidden', 'false'); fab.hidden = true;
    C.view = 'list'; C.peer = null; renderList(); loadList();
  }
  function close() { panel.classList.remove('active'); panel.setAttribute('aria-hidden', 'true'); C.peer = null; pollUnread(); }

  /* ───── список диалогов ───── */
  function headHtml(title, back) {
    return `<div class="ch-head">${back ? '<button class="ch-ib" data-ch="back" aria-label="Назад"><i class="fas fa-chevron-left"></i></button>' : ''}
      <h3>${title}</h3>${C.view === 'list' ? '<button class="ch-ib" data-ch="new" aria-label="Новое сообщение"><i class="fas fa-pen"></i></button>' : ''}
      <button class="ch-ib" data-ch="close" aria-label="Закрыть"><i class="fas fa-times"></i></button></div>`;
  }
  function rowHtml(u, sub, unread) {
    return `<button class="ch-row ${u.isadmin ? 'adm' : ''}" data-ch="peer" data-id="${esc(u.id)}">
      ${avatarHtml(u, 42)}<span class="ch-in"><b><span class="nm">${esc(u.username)}</span>${badge(u)}</b><small>${sub}</small></span>
      ${unread ? `<span class="ch-un">${unread}</span>` : ''}</button>`;
  }
  function renderList() {
    const rows = C.threads.map(t => rowHtml(t, (t.last_mine ? 'Вы: ' : '') + esc(t.last_body), Number(t.unread))).join('');
    box.innerHTML = headHtml('Сообщения', false) + `<div class="ch-body" id="chList">${rows ||
      '<div class="ch-empty"><i class="fas fa-comments" style="font-size:32px;opacity:.4"></i><br><br>Пока нет переписок.<br>Нажми ✎ сверху и найди игрока по нику.</div>'}</div>`;
  }
  async function loadList() {
    try {
      const r = await rpc('dm_threads');
      const sig = JSON.stringify(r);
      if (sig !== C.listSig) { C.listSig = sig; C.threads = r || []; if (C.view === 'list') renderList(); }
      C.unread = C.threads.reduce((a, t) => a + Number(t.unread || 0), 0); paintDot();
    } catch (e) { if (C.view === 'list' && !C.threads.length) box.querySelector('#chList').innerHTML = '<div class="ch-empty">Чат ещё не настроен: выполни chat.sql в Supabase.</div>'; }
  }

  /* ───── новый диалог ───── */
  function renderNew() {
    C.view = 'new';
    box.innerHTML = headHtml('Найти игрока', true) + `<div class="ch-body"><input class="text-input ch-search" id="chQ" type="text" placeholder="Ник игрока (от 2 букв)" autocomplete="off" value="${esc(C.q)}"><div id="chRes"></div></div>`;
    const q = box.querySelector('#chQ'); if (q) q.focus();
    if (C.q.length >= 2) doSearch();
  }
  async function doSearch() {
    const res = box.querySelector('#chRes'); if (!res) return;
    if (C.q.trim().length < 2) { res.innerHTML = ''; return; }
    try {
      const r = await rpc('dm_search', { p_q: C.q.trim() });
      res.innerHTML = r.length ? r.map(u => rowHtml(u, u.isadmin ? 'Администратор' : 'Написать', 0)).join('') : '<div class="ch-empty">Никого не найдено</div>';
    } catch (e) { res.innerHTML = '<div class="ch-empty">Ошибка поиска</div>'; }
  }

  /* ───── переписка ───── */
  function msgHtml(m) {
    const adm = !m.mine && C.peer && C.peer.isadmin;
    return `<div class="ch-m ${m.mine ? 'me' : 'he'} ${adm ? 'adm' : ''}" data-id="${m.id}">${esc(m.body)}<time>${timeFmt(m.at)}</time></div>`;
  }
  async function openPeer(id) {
    C.view = 'thread'; C.last = 0; C.peer = { id, username: '…', isadmin: false };
    box.innerHTML = headHtml('…', true) + '<div class="ch-body" id="chScroll"><div class="ch-msgs" id="chMsgs"></div></div>' +
      '<div class="ch-send"><input class="text-input" id="chText" type="text" maxlength="500" placeholder="Сообщение…" autocomplete="off"><button data-ch="send" aria-label="Отправить"><i class="fas fa-paper-plane"></i></button></div>';
    await loadThread(true);
  }
  async function loadThread(first) {
    if (C.view !== 'thread' || !C.peer || C.busy) return;
    C.busy = true; const id = C.peer.id;
    try {
      const r = await rpc('dm_messages_get', { p_peer: id, p_after: C.last });
      if (C.view !== 'thread' || !C.peer || C.peer.id !== id) return;
      if (r.peer) {
        C.peer = r.peer;
        const h = box.querySelector('.ch-head h3');
        if (h) h.innerHTML = `${avatarHtml(r.peer, 30)}<span class="nm" style="overflow:hidden;text-overflow:ellipsis">${esc(r.peer.username)}</span>${badge(r.peer)}`;
      }
      const list = r.messages || [], wrap = box.querySelector('#chMsgs'), sc = box.querySelector('#chScroll');
      if (wrap && list.length) {
        const stick = first || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
        wrap.insertAdjacentHTML('beforeend', list.map(msgHtml).join(''));
        C.last = list[list.length - 1].id;
        if (stick) sc.scrollTop = sc.scrollHeight;
      } else if (wrap && first) wrap.innerHTML = '<div class="ch-empty">Напиши первое сообщение</div>';
      if (first && list.length === 0) C.empty = true;
    } catch (e) { /* ignore */ } finally { C.busy = false; }
  }
  async function send() {
    const inp = box.querySelector('#chText'); if (!inp || !C.peer) return;
    const body = inp.value.trim(); if (!body) return;
    inp.value = '';
    try {
      await rpc('dm_send', { p_to: C.peer.id, p_body: body });
      const wrap = box.querySelector('#chMsgs'); if (wrap && C.empty) { wrap.innerHTML = ''; C.empty = false; }
      await loadThread(true);
    } catch (e) {
      inp.value = body;
      toast('error', 'Не отправлено', /too_fast/.test(e.message || '') ? 'Слишком часто, подожди пару секунд' : 'Попробуй ещё раз');
    }
  }

  function onClick(e) {
    if (e.target === panel) return close();
    const b = e.target.closest('[data-ch]'); if (!b) return;
    const a = b.dataset.ch;
    if (a === 'close') close();
    else if (a === 'new') { C.q = ''; renderNew(); }
    else if (a === 'back') { C.view = 'list'; C.peer = null; renderList(); loadList(); }
    else if (a === 'peer') openPeer(b.dataset.id);
    else if (a === 'send') send();
  }

  /* ───── запуск ───── */
  build();
  setInterval(() => {
    if (!panel.classList.contains('active')) return;
    if (C.view === 'thread') loadThread(false); else if (C.view === 'list') loadList();
  }, 3000);
  setInterval(() => { if (!panel.classList.contains('active')) pollUnread(); }, 8000);
  setInterval(() => { if (!logged() && panel.classList.contains('active')) close(); fab.hidden = !logged() || panel.classList.contains('active'); }, 1000);
  pollUnread();
})();
