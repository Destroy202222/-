'use strict';
/* =====================================================================
   Aliance Faceit — app.js (исправленная версия)
   ===================================================================== */

/* ───────────── Конфигурация ───────────── */
const SUPABASE_URL = 'https://tgjltbpmuczfkikvmmde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnamx0YnBtdWN6Zmtpa3ZtbWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzA5ODQsImV4cCI6MjEwNDQ0Njk4NH0.TlCYgYwefoypDdsU-6-0TkSqDM7S8XgB6PBlbeEGm6I';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const CFG = { confirmSec: 30, draftSec: 30, lobbySec: 300, pollMs: 2500, framePrice: 25 };
const NICK_RE = /^[A-Za-z0-9А-Яа-яЁё_-]{3,20}$/;
const PUBLIC_COLS = 'id,username,elo,matches,wins,losses,win_streak,best_streak,likes,popularity,isadmin,avatar_url,avatar_frame,registered';
const PAGES = ['home', 'matches', 'match', 'profile', 'friends', 'top', 'wallet', 'shop'];
const PARTY_COLORS = ['#f5c451', '#3ddc97', '#38bdf8', '#fb923c'];
const FRAMES = [
  { id: 'frame_bronze', name: 'Бронзовая' }, { id: 'frame_silver', name: 'Серебряная' },
  { id: 'frame_gold', name: 'Золотая' },     { id: 'frame_neon', name: 'Неон' },
  { id: 'frame_fire', name: 'Огонь' },       { id: 'frame_diamond', name: 'Алмаз' }
];
const LEVELS = [
  { lvl: 1, min: 0, max: 199 },    { lvl: 2, min: 200, max: 249 },  { lvl: 3, min: 250, max: 399 },
  { lvl: 4, min: 400, max: 599 },  { lvl: 5, min: 600, max: 799 },  { lvl: 6, min: 800, max: 999 },
  { lvl: 7, min: 1000, max: 1399 },{ lvl: 8, min: 1400, max: 1699 },{ lvl: 9, min: 1700, max: 1999 },
  { lvl: 10, min: 2000, max: Infinity }
];
const LEVEL_COLORS = ['#9ca3af', '#a1a1d6', '#a78bfa', '#8b5cf6', '#7c6cf0', '#c084fc', '#e879f9', '#f472b6', '#fb7185', '#f5c451'];

/* ───────────── Состояние ───────────── */
const S = {
  me: null, maps: [], teamSize: 3, page: 'home',
  friends: [], requests: [], sent: [], tab: 'friends', fq: '', fresults: [], fToken: 0,
  party: null, invites: [], users: {},
  queue: { searching: false, since: null, count: 0, need: 6 },
  match: null, offset: 0, sig: '', polling: false, entering: false,
  chat: [], chatCh: null,
  history: [], adminTab: 'matches',
  channels: [], timers: {}
};

/* ───────────── Утилиты ───────────── */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
const pad = n => String(n).padStart(2, '0');
const mmss = s => Math.floor(s / 60) + ':' + pad(s % 60);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const errText = e => (e && e.message) || String(e);
const nowMs = () => Date.now() + S.offset;
const toMs = v => (v ? new Date(v).getTime() : 0);
const fmtDay = iso => { const d = new Date(iso); return d.getDate() + ' ' + ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getMonth()]; };
const fmtTime = iso => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw error;
  return data;
}

function levelOf(elo) {
  elo = Math.max(0, parseInt(elo) || 0);
  return LEVELS.find(l => elo <= l.max) || LEVELS[LEVELS.length - 1];
}
function levelProgress(elo) {
  const L = levelOf(elo);
  if (L.max === Infinity) return 1;
  return Math.min(1, Math.max(0, ((parseInt(elo) || 0) - L.min) / (L.max - L.min + 1)));
}
const lvlColor = l => LEVEL_COLORS[l - 1];
const lvlChip = elo => { const l = levelOf(elo).lvl; return `<span class="lvl" style="--c:${lvlColor(l)}">${l}</span>`; };

function avatarHtml(u, size = 44) {
  u = u || {};
  const name = u.username || '?';
  const inner = u.avatar_url
    ? `<img src="${esc(u.avatar_url)}" alt="" loading="lazy">`
    : `<span class="av-letter">${esc(name.charAt(0).toUpperCase())}</span>`;
  return `<span class="av ${esc(u.avatar_frame || '')}" style="--s:${size}px"><span class="av-in">${inner}</span></span>`;
}

function mapById(id) {
  const key = String(id || '').toLowerCase();
  return S.maps.find(m => m.id.toLowerCase() === key || m.name.toLowerCase() === key) || { id, name: id || '—', emoji: '🗺️', img: '' };
}
function mapThumb(m) {
  return m.img ? `<img src="${esc(m.img)}" alt="" onerror="this.remove()">` : esc(m.emoji || '🗺️');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t);
    t.select(); document.execCommand('copy'); t.remove();
  }
  toast('success', 'Скопировано', text);
}

/* ───────────── Уведомления и диалоги ───────────── */
let toastTimer;
function toast(type, title, text = '') {
  const t = $('toast'); if (!t) return;
  $('toastTitle').className = 'toast-title ' + type;
  $('toastTitle').textContent = title;
  $('toastText').textContent = text;
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 3800);
}

function openModal(id) { const el = $(id); el.classList.add('active'); el.setAttribute('aria-hidden', 'false'); }
function closeModal(id) { const el = $(id); el.classList.remove('active'); el.setAttribute('aria-hidden', 'true'); }

function dialog({ title, text = '', input = null, ok = 'Да', danger = false }) {
  return new Promise(resolve => {
    $('dialogTitle').textContent = title;
    $('dialogText').textContent = text;
    $('dialogText').hidden = !text;
    const inp = $('dialogInput');
    inp.hidden = input === null;
    if (input !== null) inp.value = input;
    const okb = $('dialogOk');
    okb.textContent = ok;
    okb.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    $('dialog').classList.add('active');
    const done = v => {
      $('dialog').classList.remove('active');
      okb.onclick = null; $('dialogCancel').onclick = null;
      resolve(v);
    };
    okb.onclick = () => done(input === null ? true : inp.value);
    $('dialogCancel').onclick = () => done(input === null ? false : null);
    if (input !== null) setTimeout(() => inp.focus(), 60);
  });
}

async function run(fn, d, el) {
  if (el && el.dataset.busy) return;
  try {
    if (el) el.dataset.busy = '1';
    await fn(d || {}, el);
  } catch (e) {
    toast('error', 'Ошибка', errText(e));
  } finally {
    if (el) delete el.dataset.busy;
  }
}

/* ───────────── Авторизация ───────────── */
/**
 * Генерирует email для Supabase Auth на основе ника.
 * Исправлено: домен alliance (с двумя L), добавлен фолбэк для crypto.subtle.
 */
async function nickEmail(nick) {
  const clean = nick.trim().toLowerCase();
  
  // Фолбэк: если crypto.subtle недоступен (например, старый WebView), используем простой хеш
  if (!(window.crypto && crypto.subtle)) {
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = (hash << 5) - hash + clean.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0').repeat(4).slice(0, 32);
    return 'u' + hex + '@alliance-faceit.app';
  }
  
  try {
    const bytes = new TextEncoder().encode(clean);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(hash)].map(b => pad(b.toString(16))).join('');
    return 'u' + hex.slice(0, 32) + '@alliance-faceit.app';
  } catch (e) {
    // Если crypto.subtle упал — используем простой хеш
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = (hash << 5) - hash + clean.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0').repeat(4).slice(0, 32);
    return 'u' + hex + '@alliance-faceit.app';
  }
}

function authMsg(id, type, text) { const el = $(id); el.className = 'auth-msg ' + type; el.textContent = text; }
function switchAuthTab(tab) {
  const login = tab === 'login';
  $('tabLogin').classList.toggle('active', login);
  $('tabRegister').classList.toggle('active', !login);
  $('loginForm').hidden = !login;
  $('registerForm').hidden = login;
}

async function doLogin(e) {
  e.preventDefault();
  const nick = $('loginNick').value.trim(), pass = $('loginPass').value;
  if (!nick || !pass) return authMsg('loginMsg', 'error', 'Введите ник и пароль');
  const btn = $('loginBtn'); btn.disabled = true;
  authMsg('loginMsg', 'info', 'Входим…');
  try {
    const email = await nickEmail(nick);
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) return authMsg('loginMsg', 'error', 'Неверный ник или пароль');
    authMsg('loginMsg', 'success', 'Готово');
    await enterApp();
  } catch (err) { authMsg('loginMsg', 'error', errText(err)); }
  finally { btn.disabled = false; }
}

async function doRegister(e) {
  e.preventDefault();
  const nick = $('regNick').value.trim(), gid = $('regGameId').value.trim();
  const p1 = $('regPass').value, p2 = $('regPass2').value;
  const bad = t => authMsg('registerMsg', 'error', t);
  if (!NICK_RE.test(nick)) return bad('Ник: 3–20 символов — буквы, цифры, _ и -');
  if (gid.length < 3 || gid.length > 30) return bad('ID StandRise: от 3 до 30 символов');
  if (p1.length < 8) return bad('Пароль — минимум 8 символов');
  if (p1 !== p2) return bad('Пароли не совпадают');
  const btn = $('registerBtn'); btn.disabled = true;
  authMsg('registerMsg', 'info', 'Создаём аккаунт…');
  try {
    const free = await rpc('username_available', { p_nick: nick });
    if (!free) return bad('Этот ник уже занят');
    
    const email = await nickEmail(nick);
    const { data, error } = await sb.auth.signUp({
      email,
      password: p1,
      options: { data: { username: nick, game_id: gid } }
    });
    
    if (error) {
      // Разбираем типичные ошибки Supabase
      const msg = error.message || '';
      if (/already registered|already exists/i.test(msg)) return bad('Этот ник уже занят');
      if (/email signups are disabled/i.test(msg)) {
        return bad('Регистрация через email отключена. Включите Email provider в Supabase.');
      }
      if (/signups not allowed/i.test(msg)) {
        return bad('Регистрация в проекте запрещена. Включите "Allow new users to sign up".');
      }
      if (/password/i.test(msg)) return bad('Пароль слишком простой или короткий');
      return bad('Не удалось создать аккаунт: ' + msg);
    }
    
    if (!data.session) {
      return authMsg('registerMsg', 'info',
        'Аккаунт создан, но вход не выполнен. Выключите «Confirm email» в Supabase (Authentication → Sign In / Providers → Email).');
    }
    
    authMsg('registerMsg', 'success', 'Добро пожаловать, ' + nick + '!');
    await enterApp();
  } catch (err) { bad(errText(err)); }
  finally { btn.disabled = false; }
}

function showAuth(message) {
  stopLoops(); unsubscribeRealtime(); stopChat();
  S.me = null; S.match = null; S.party = null; S.invites = [];
  S.queue = { searching: false, since: null, count: 0, need: S.teamSize * 2 };
  $('app').hidden = true;
  $('auth').hidden = false;
  closeModal('confirmModal');
  if (message) authMsg('loginMsg', 'error', message);
}

async function logout() {
  const ok = await dialog({ title: 'Выйти из аккаунта?', ok: 'Выйти', danger: true });
  if (!ok) return;
  try { await rpc('cancel_search'); } catch (e) { /* не критично */ }
  await sb.auth.signOut();
  showAuth();
  toast('info', 'Вы вышли', '');
}

/* ───────────── Запуск ───────────── */
async function enterApp() {
  if (S.entering) return;
  S.entering = true;
  try {
    const me = await rpc('get_me');
    if (!me) { await sb.auth.signOut(); return showAuth('Профиль не найден. Зарегистрируйтесь заново.'); }
    if (me.banned) { await sb.auth.signOut(); return showAuth('Аккаунт заблокирован'); }
    S.me = me;
    $('auth').hidden = true;
    $('app').hidden = false;
    await Promise.all([loadMaps(), loadSettings()]);
    renderBalance();
    subscribeRealtime();
    await Promise.allSettled([loadFriends(), loadParty(), syncMatch(), loadStats(), loadHistory()]);
    if (!(S.match && S.match.status === 'active')) await syncQueue().catch(() => {});
    navigate(S.match && S.match.status === 'active' ? 'match' : 'home');
    startLoops();
  } finally { S.entering = false; }
}

function startLoops() {
  stopLoops();
  S.timers.poll = setInterval(pollTick, CFG.pollMs);
  S.timers.ui = setInterval(uiTick, 250);
  S.timers.stats = setInterval(() => { if (S.page === 'home') loadStats(); }, 10000);
}
function stopLoops() { Object.values(S.timers).forEach(clearInterval); S.timers = {}; }

async function pollTick() {
  if (!S.me || S.polling) return;
  S.polling = true;
  try {
    await syncMatch();
    if (!S.match) await syncQueue();
    else if (S.match.status === 'active') await pullChat();
  } catch (e) { /* сеть моргнула — повторим */ }
  finally { S.polling = false; }
}

function subscribeRealtime() {
  unsubscribeRealtime();
  const ch = sb.channel('app-' + S.me.id);
  const on = (table, fn) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, fn);
  const dMatch = debounce(() => syncMatch().catch(() => {}), 150);
  const dFriends = debounce(() => loadFriends().catch(() => {}), 250);
  const dParty = debounce(() => loadParty().catch(() => {}), 250);
  on('active_matches', dMatch);
  on('friends', dFriends); on('friend_requests', dFriends);
  on('party_members', dParty); on('party_invites', dParty);
  on('settings', () => loadSettings().catch(() => {}));
  ch.subscribe();
  S.channels.push(ch);
}
function unsubscribeRealtime() { S.channels.forEach(c => { try { sb.removeChannel(c); } catch (e) { /* ок */ } }); S.channels = []; }

/* ───────────── Данные ───────────── */
async function loadMaps() {
  const { data } = await sb.from('maps').select('*').eq('active', true).order('sort_order');
  S.maps = data || [];
}
async function loadSettings() {
  const { data } = await sb.from('settings').select('*');
  (data || []).forEach(r => { if (r.key === 'team_size') S.teamSize = parseInt(r.value) || 3; });
  updateSearchUI();
}
async function refreshMe() {
  const me = await rpc('get_me');
  if (me) { S.me = me; renderBalance(); }
}
async function fetchUsers(ids, force) {
  const need = [...new Set(ids)].filter(id => force || !S.users[id]);
  if (need.length) {
    const { data } = await sb.from('users').select(PUBLIC_COLS).in('id', need);
    (data || []).forEach(u => { S.users[u.id] = u; });
  }
  return ids.map(id => S.users[id]).filter(Boolean);
}
async function loadStats() {
  try {
    const s = await rpc('get_stats');
    setText('statSearching', s.searching || 0);
    setText('statInMatch', s.in_match || 0);
    setText('statMatches', s.matches || 0);
  } catch (e) { /* ок */ }
}
async function loadHistory() {
  const { data } = await sb.from('match_history')
    .select('id,map,result,elo_change,match_date,winner,score_a,score_b')
    .eq('user_id', S.me.id).order('match_date', { ascending: false }).limit(30);
  S.history = data || [];
  if (S.page === 'profile') renderProfile();
}
function renderBalance() {
  const v = (S.me.balance || 0) + ' ₽';
  $('headBalance').innerHTML = `<i class="fas fa-coins"></i>${v}`;
  setText('walletBalance', v);
}

/* ───────────── Навигация ───────────── */
function navigate(page) {
  const inMatch = S.match && S.match.status === 'active';
  if (page === 'matches' && inMatch) page = 'match';
  if (page === 'match' && !inMatch) page = 'matches';
  S.page = page;
  PAGES.forEach(p => $('page-' + p).classList.toggle('active', p === page));
  document.querySelectorAll('#nav button').forEach(b => {
    const bp = b.dataset.page;
    b.classList.toggle('active', bp === page || (bp === 'matches' && page === 'match'));
  });
  window.scrollTo({ top: 0 });
  if (page === 'home') loadStats();
  if (page === 'matches') { loadParty().catch(() => {}); updateSearchUI(); }
  if (page === 'match') renderMatch(true);
  if (page === 'profile') { renderProfile(); refreshMe().then(() => S.page === 'profile' && renderProfile()).catch(() => {}); loadHistory().catch(() => {}); }
  if (page === 'friends') loadFriends().catch(() => {});
  if (page === 'top') renderTop();
  if (page === 'wallet') renderBalance();
  if (page === 'shop') renderShop();
}

function setNavMatch(mode) { // 'idle' | 'searching' | 'match'
  const btn = $('navPlay');
  btn.classList.toggle('live', mode !== 'idle');
  $('navPlayIcon').className = 'fas ' + (mode === 'match' ? 'fa-gamepad' : mode === 'searching' ? 'fa-magnifying-glass' : 'fa-play');
  setText('navPlayLabel', mode === 'match' ? 'Матч' : mode === 'searching' ? 'Поиск' : 'Играть');
}

/* ───────────── Очередь и поиск ───────────── */
async function syncQueue() {
  const st = await rpc('queue_state');
  if (!st) return;
  const was = S.queue.searching;
  S.queue = { searching: !!st.searching, since: toMs(st.since), count: st.count || 0, need: st.need || S.teamSize * 2 };
  S.teamSize = Math.max(1, Math.round(S.queue.need / 2));
  if (st.now) S.offset = toMs(st.now) - Date.now();
  updateSearchUI();
  if (was && !S.queue.searching) await syncMatch(); // очередь сменилась матчем
}

function updateSearchUI() {
  if (!S.me) return;
  const q = S.queue, need = q.need || S.teamSize * 2;
  setText('searchTitle', S.teamSize + '×' + S.teamSize + ' · рейтинг');
  setText('searchNeed', need);
  setText('searchCount', q.count);
  $('searchSlots').innerHTML = Array.from({ length: need }, (_, i) =>
    `<span class="slot ${i < q.count ? 'on' : ''}"><i class="fas fa-user"></i></span>`).join('');
  $('searchPulse').classList.toggle('on', q.searching);
  $('searchTimer').hidden = !q.searching;
  $('btnCancel').hidden = !q.searching;
  const start = $('btnSearch');
  start.hidden = q.searching;
  const wait = S.party && S.party.leader !== S.me.id;
  start.disabled = !!wait;
  start.innerHTML = wait ? 'Поиск запускает лидер пати' : '<i class="fas fa-search"></i> Начать поиск';
  if (!S.match) setNavMatch(q.searching ? 'searching' : 'idle');
}

async function startSearch() {
  if (S.match) return navigate('match');
  await rpc('start_search');
  await syncQueue();
  toast('info', 'Поиск начат', 'Ищем игроков…');
}
async function cancelSearch() {
  await rpc('cancel_search');
  await syncQueue();
  toast('info', 'Поиск отменён', '');
}

/* ───────────── Пати ───────────── */
async function loadParty() {
  const me = S.me.id;
  const [pm, inv] = await Promise.all([
    sb.from('party_members').select('party_id,user_id'),
    sb.from('party_invites').select('id,party_id,from_id,created_at').eq('to_id', me).eq('status', 'pending')
  ]);
  const members = pm.data || [];
  if (members.length) {
    const pid = members[0].party_id;
    const { data: p } = await sb.from('parties').select('id,leader_id').eq('id', pid).maybeSingle();
    const ids = members.map(m => m.user_id);
    await fetchUsers(ids, true);
    S.party = { id: pid, leader: p ? p.leader_id : null, members: ids };
  } else S.party = null;
  S.invites = (inv.data || []).filter(i => Date.now() - toMs(i.created_at) < 10 * 60 * 1000);
  if (S.invites.length) await fetchUsers(S.invites.map(i => i.from_id));
  renderParty();
  updateSearchUI();
  updateFriendBadges();
}

function renderParty() {
  const el = $('partyPanel'); if (!el || !S.me) return;
  const p = S.party;
  let html = S.invites.map(inv => {
    const f = S.users[inv.from_id];
    return `<div class="invite"><div class="txt"><b>${esc(f ? f.username : 'Игрок')}</b> зовёт вас в пати</div>
      <button class="btn btn-ok btn-sm" data-act="party-accept" data-id="${inv.id}">Принять</button>
      <button class="btn btn-ghost btn-sm" data-act="party-decline" data-id="${inv.id}" aria-label="Отклонить"><i class="fas fa-times"></i></button></div>`;
  }).join('');
  html += `<div class="panel-head"><h3>Пати</h3><span class="aside">${p ? p.members.length : 0} из ${S.teamSize}</span></div>`;
  if (!p) {
    html += `<div class="empty" style="padding:10px 0 4px"><i class="fas fa-user-group"></i>Вы играете один. Пригласите друга — вы окажетесь в одной команде.</div>
      <button class="btn btn-ghost btn-block" data-act="nav" data-page="friends"><i class="fas fa-user-plus"></i> Выбрать друга</button>`;
  } else {
    const iLead = p.leader === S.me.id;
    html += '<div class="rows">' + p.members.map(id => {
      const u = S.users[id] || { username: 'Игрок' };
      return `<div class="row">${avatarHtml(u, 38)}
        <div class="row-main"><div class="row-title">${esc(u.username)} ${id === p.leader ? '<i class="fas fa-crown" style="color:var(--gold);font-size:12px"></i>' : ''}</div>
        <div class="row-sub">ELO ${u.elo ?? '—'}</div></div>
        ${iLead && id !== S.me.id ? `<button class="btn btn-danger btn-sm" data-act="party-kick" data-id="${id}">Убрать</button>` : ''}</div>`;
    }).join('') + '</div>';
    html += `<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="party-leave">${iLead ? 'Распустить пати' : 'Выйти из пати'}</button>`;
  }
  el.innerHTML = html;
}

/* ───────────── Матч: синхронизация ───────────── */
const mySide = m => (m.blue.some(p => p.id === S.me.id) ? 'blue' : 'orange');

async function syncMatch() {
  if (!S.me) return;
  const m = await rpc('my_match');
  if (m && m.server_now) S.offset = toMs(m.server_now) - Date.now();
  applyMatch(m);
}

function applyMatch(m) {
  const prev = S.match;
  if (!m) {
    S.match = null;
    if (prev) matchEnded(prev);
    return;
  }
  S.match = m;
  if (S.queue.searching) { S.queue.searching = false; updateSearchUI(); }
  if (m.status === 'pending') {
    if (!prev || prev.id !== m.id) { openModal('confirmModal'); try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) { /* ок */ } }
    setNavMatch('match');
    renderConfirm();
    return;
  }
  closeModal('confirmModal');
  setNavMatch('match');
  const fresh = !prev || prev.id !== m.id || prev.status !== 'active';
  if (fresh) {
    S.sig = '';
    startChat(m.id);
    if (prev && prev.status === 'pending') toast('success', 'Матч начался', 'Сначала баним карты');
    if (S.page !== 'match') navigate('match');
  }
  renderMatch();
}

function matchEnded(prev) {
  closeModal('confirmModal');
  stopChat();
  S.sig = '';
  $('chatPanel').hidden = true;
  setNavMatch('idle');
  if (prev.status === 'pending') {
    toast('info', 'Матч отменён', 'Не все игроки подтвердили участие');
  } else {
    toast('success', 'Матч завершён', 'Рейтинг обновлён');
    refreshMe().catch(() => {});
    loadHistory().catch(() => {});
  }
  syncQueue().catch(() => {});
  if (S.page === 'match') navigate(prev.status === 'pending' ? 'matches' : 'profile');
}

/* Подтверждение */
function renderConfirm() {
  const m = S.match; if (!m || m.status !== 'pending') return;
  const players = [...m.blue, ...m.orange];
  const conf = new Set(m.confirmed || []);
  $('confirmSlots').innerHTML = players.map(p => {
    const on = conf.has(p.id);
    return `<span class="slot ${on ? 'on' : ''} ${p.id === S.me.id ? 'me' : ''}" title="${esc(p.username)}"><i class="fas ${on ? 'fa-check' : 'fa-user'}"></i></span>`;
  }).join('');
  setText('confirmDone', conf.size);
  setText('confirmTotal', players.length);
  setText('confirmSub', 'Вы в команде ' + (mySide(m) === 'blue' ? 'A' : 'B'));
  const btn = $('confirmBtn');
  if (conf.has(S.me.id)) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Вы готовы — ждём остальных';
  } else {
    btn.disabled = false;
    btn.textContent = 'Подтвердить';
  }
}
async function confirmMatch() {
  if (!S.match || S.match.status !== 'pending') return;
  S.match.confirmed = [...new Set([...(S.match.confirmed || []), S.me.id])];
  renderConfirm();
  await rpc('confirm_match', { p_match: S.match.id });
  await syncMatch();
}

/* ───────────── Матч: отрисовка ───────────── */
function renderMatch(force) {
  const m = S.match;
  if (!m || m.status !== 'active') return;
  const ds = m.draft_state || {};
  const sig = JSON.stringify([m.id, ds, m.my_report, m.draft_finished_at, S.me.isadmin]);
  if (!force && sig === S.sig) return;
  S.sig = sig;
  setText('mNum', 'Матч #' + (m.match_number || '—'));
  setText('mSub', S.teamSize + '×' + S.teamSize + ' · рейтинг');
  const st = $('mStatus');
  st.textContent = ds.complete ? 'Идёт игра' : 'Бан карт';
  st.className = 'pill' + (ds.complete ? ' live' : '');
  $('matchBody').innerHTML = ds.complete ? lobbyHtml(m, ds) : draftHtml(m, ds);
  $('chatPanel').hidden = false;
  renderChat();
  $('adminMatchBar').innerHTML = S.me.isadmin
    ? `<div class="admin-bar">
        <button class="btn btn-sm btn-ghost" data-act="adm-finish" data-id="${m.id}" data-side="blue">🏆 Команда A</button>
        <button class="btn btn-sm btn-ghost" data-act="adm-finish" data-id="${m.id}" data-side="orange">🏆 Команда B</button>
        <button class="btn btn-sm btn-danger" data-act="adm-cancel" data-id="${m.id}" aria-label="Отменить матч"><i class="fas fa-times"></i></button></div>`
    : '';
}

function plHtml(p, isCap, dotColor) {
  return `<div class="pl" data-act="player" data-id="${esc(p.id)}">${avatarHtml(p, 32)}
    <div class="body"><div class="nm">${esc(p.username)}${dotColor ? `<span class="pdot" style="background:${dotColor}" title="Одна пати"></span>` : ''}</div>
    <div class="meta">${isCap ? '<i class="fas fa-crown crown"></i> капитан · ' : ''}ELO ${p.elo ?? 300}</div></div>${lvlChip(p.elo)}</div>`;
}
function teamsHtml(m) {
  const count = {};
  [...m.blue, ...m.orange].forEach(p => { if (p.party_id) count[p.party_id] = (count[p.party_id] || 0) + 1; });
  const color = {}; let ci = 0;
  const dot = pid => {
    if (!pid || count[pid] < 2) return null;
    if (!color[pid]) color[pid] = PARTY_COLORS[ci++ % PARTY_COLORS.length];
    return color[pid];
  };
  const side = (list, cls, label, icon) => `<div class="team ${cls}"><div class="team-head"><i class="fas ${icon}"></i>${label}</div>
    ${list.map((p, i) => plHtml(p, i === 0, dot(p.party_id))).join('')}</div>`;
  return `<div class="teams">${side(m.blue, 'blue', 'Команда A', 'fa-shield-halved')}${side(m.orange, 'orange', 'Команда B', 'fa-fire')}</div>`;
}

function draftHtml(m, ds) {
  const banned = ds.banned || [];
  const turnSide = (ds.turn || 0) === 0 ? 'blue' : 'orange';
  const cap = (turnSide === 'blue' ? m.blue : m.orange)[0];
  const mine = cap && cap.id === S.me.id;
  const myTeam = mySide(m);
  const sub = mine ? 'Нажмите на карту, чтобы забанить' : (turnSide === myTeam ? 'Ваша команда делает выбор' : 'Выбирает команда соперника');
  const list = S.maps.length ? S.maps.map(mp => {
    const isBan = banned.includes(mp.id);
    const clickable = mine && !isBan;
    return `<div class="map-row ${isBan ? 'banned' : ''} ${clickable ? 'clickable' : ''}" ${clickable ? `data-act="ban" data-map="${esc(mp.id)}"` : ''}>
      <div class="map-thumb">${mapThumb(mp)}</div>
      <div class="grow"><div class="map-name">${esc(mp.name)}</div><div class="map-sub">${isBan ? 'Забанена' : 'В пуле'}</div></div>
      ${clickable ? '<span class="ban-btn">Бан</span>' : ''}</div>`;
  }).join('') : '<div class="empty">Карты не загружены. Проверьте таблицу maps.</div>';
  return `<div class="draft-head"><h2>Бан карт</h2><span>осталось ${S.maps.length - banned.length} из ${S.maps.length}</span></div>
    <div class="turn ${mine ? 'mine' : ''}"><div class="ico"><i class="fas fa-crosshairs"></i></div>
      <div class="txt"><b>${mine ? 'Ваш ход' : 'Банит ' + esc(cap ? cap.username : 'капитан')}</b><span>${sub}</span></div>
      <div class="turn-time" id="turnTime">0:30</div></div>
    <div class="maps">${list}</div>
    <div style="height:14px"></div>${teamsHtml(m)}`;
}

function lobbyHtml(m, ds) {
  const mp = mapById(ds.final);
  const host = m.blue[0] || {};
  const bg = mp.img ? `style="background-image:url('${esc(mp.img)}')"` : '';
  const side = mySide(m);
  const other = side === 'blue' ? 'orange' : 'blue';
  const rep = m.my_report ? `<p>Ваш ответ: победила команда ${m.my_report === 'blue' ? 'A' : 'B'}</p>` : '<p>Матч сыгран? Отметьте, кто победил — это поможет админу.</p>';
  return `<div class="lobby-hero"><div class="bg" ${bg}></div><div class="in">
      <div class="cap">Карта выбрана</div><div class="map">${esc(mp.name)}</div>
      <div class="host">${avatarHtml(host, 40)}
        <div class="meta"><div class="lbl">Хост лобби</div><div class="val">${esc(host.username || '—')}</div></div>
        <div class="gid"><div class="lbl">Standoff 2 ID</div><div class="val">${esc(host.game_id || '—')}</div></div>
        <button class="icon-btn" data-act="copy-host" aria-label="Скопировать ID хоста"><i class="fas fa-copy"></i></button>
      </div></div></div>
    <div class="timer-box"><div class="ico"><i class="fas fa-hourglass-half"></i></div>
      <div class="txt"><b id="lobbyLabel">Заход в лобби</b>Хост собирает игру. Результат можно отправить после таймера.</div>
      <div class="t" id="lobbyTime">5:00</div></div>
    ${teamsHtml(m)}
    <div class="panel report" id="reportBox" hidden>${rep}
      <div class="btns">
        <button class="btn btn-ok" data-act="report" data-side="${side}">Победила моя команда</button>
        <button class="btn btn-danger" data-act="report" data-side="${other}">Победил соперник</button></div></div>`;
}

async function banMap(d) {
  if (!S.match) return;
  await rpc('ban_map', { p_match: S.match.id, p_map: d.map });
  await syncMatch();
}
async function reportResult(d) {
  if (!S.match) return;
  await rpc('report_result', { p_match: S.match.id, p_winner: d.side });
  toast('success', 'Ответ отправлен', '');
  await syncMatch();
}

/* Таймеры интерфейса */
function uiTick() {
  if (!S.me) return;
  const now = nowMs();
  if (S.queue.searching && S.queue.since) {
    setText('searchTimer', mmss(Math.max(0, Math.floor((now - S.queue.since) / 1000))));
  }
  const m = S.match;
  if (!m) return;
  if (m.status === 'pending') {
    const left = Math.max(0, Math.ceil((toMs(m.created_at) + CFG.confirmSec * 1000 - now) / 1000));
    setText('confirmTimer', left);
    $('confirmBar').style.strokeDashoffset = String(477.5 * (1 - left / CFG.confirmSec));
    $('confirmTimer').style.color = left <= 5 ? 'var(--live)' : '';
    return;
  }
  const ds = m.draft_state || {};
  if (!ds.complete && ds.turn_started_at) {
    const left = Math.max(0, Math.ceil((toMs(ds.turn_started_at) + CFG.draftSec * 1000 - now) / 1000));
    setText('turnTime', mmss(left));
  } else if (ds.complete && m.draft_finished_at) {
    const left = Math.max(0, Math.ceil((toMs(m.draft_finished_at) + CFG.lobbySec * 1000 - now) / 1000));
    setText('lobbyTime', mmss(left));
    setText('lobbyLabel', left > 0 ? 'Заход в лобби' : 'Время на заход вышло');
    const rb = $('reportBox'); if (rb) rb.hidden = left > 0;
  }
}

/* ───────────── Чат матча ───────────── */
async function startChat(matchId) {
  stopChat();
  S.chat = [];
  const { data } = await sb.from('match_messages').select('*').eq('match_id', matchId).order('created_at').limit(200);
  S.chat = data || [];
  renderChat();
  S.chatCh = sb.channel('chat-' + matchId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_messages', filter: 'match_id=eq.' + matchId }, p => addChat(p.new))
    .subscribe();
}
function stopChat() {
  if (S.chatCh) { try { sb.removeChannel(S.chatCh); } catch (e) { /* ок */ } S.chatCh = null; }
  S.chat = [];
}
function addChat(msg) {
  if (!msg || S.chat.some(x => x.id === msg.id)) return;
  S.chat.push(msg);
  S.chat.sort((a, b) => toMs(a.created_at) - toMs(b.created_at));
  renderChat();
}
async function pullChat() {
  if (!S.match) return;
  const last = S.chat.length ? S.chat[S.chat.length - 1].created_at : null;
  let q = sb.from('match_messages').select('*').eq('match_id', S.match.id).order('created_at');
  if (last) q = q.gt('created_at', last);
  const { data } = await q.limit(100);
  (data || []).forEach(addChat);
}
function renderChat() {
  const body = $('chatBody'); if (!body) return;
  if (!S.chat.length) { body.innerHTML = '<div class="chat-empty">Сообщений пока нет</div>'; return; }
  const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  body.innerHTML = S.chat.map(m => `<div class="msg ${m.user_id === S.me.id ? 'me' : ''}">${avatarHtml(m, 28)}
    <div><div class="who">${esc(m.username)}</div><div class="txt">${esc(m.text)}</div></div></div>`).join('');
  if (stick) body.scrollTop = body.scrollHeight;
}
async function sendChat(e) {
  e.preventDefault();
  if (!S.match) return;
  const inp = $('chatInput');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  const { data, error } = await sb.from('match_messages')
    .insert({ match_id: S.match.id, user_id: S.me.id, text }).select().single();
  if (error) { inp.value = text; return toast('error', 'Не отправлено', errText(error)); }
  addChat(data);
  inp.focus();
}

/* ───────────── Профиль ───────────── */
function renderProfile() {
  const u = S.me; if (!u) return;
  const body = $('profileBody'); if (!body) return;
  const L = levelOf(u.elo), prog = levelProgress(u.elo), col = lvlColor(L.lvl);
  const wr = u.matches ? Math.round(u.wins / u.matches * 100) : 0;
  const toNext = L.max === Infinity ? '<b>Максимальный</b> уровень' : `<b>${L.max + 1 - u.elo}</b> ELO до ${L.lvl + 1} уровня`;
  const ladder = LEVELS.map(l => `<i class="${l.lvl <= L.lvl ? 'on' : ''} ${l.lvl === L.lvl ? 'cur' : ''}"></i>`).join('');
  const hist = S.history.slice(0, 10).map(h => {
    const win = h.result === 'win', d = h.elo_change || 0, mp = mapById(h.map);
    return `<div class="hist ${win ? 'win' : 'lose'}" data-act="match-details" data-id="${h.id}">
      <div class="map-thumb" style="width:46px;height:46px">${mapThumb(mp)}</div>
      <div class="main"><div class="t">${win ? 'Победа' : 'Поражение'} · ${esc(h.map || '—')}</div>
        <div class="s">${fmtDay(h.match_date)}${h.score_a != null ? ` · ${h.score_a}:${h.score_b}` : ''}</div></div>
      <div class="right"><div class="elo ${d >= 0 ? 'p' : 'n'}">${d >= 0 ? '+' : ''}${d}</div><div class="time">${fmtTime(h.match_date)}</div></div></div>`;
  }).join('') || '<div class="empty"><i class="fas fa-gamepad"></i>Матчей пока нет</div>';

  body.innerHTML = `
    <div class="panel">
      <div class="me-hero">${avatarHtml(u, 72)}<div><div class="name">${esc(u.username)} ${u.isadmin ? '<i class="fas fa-crown" style="color:var(--gold);font-size:15px"></i>' : ''}</div>
        <div class="gid">ID StandRise: <b>${esc(u.game_id || '—')}</b></div></div></div>
      <div class="rank">
        <div class="badge-lvl" style="--c:${col}"><div class="n">${L.lvl}</div><div class="l">LVL</div></div>
        <div class="main"><div class="elo">${u.elo}<small>ELO</small></div>
          <div class="ladder">${ladder}</div>
          <div class="bar"><i style="width:${(prog * 100).toFixed(1)}%"></i></div>
          <div class="sub">${toNext}</div></div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Статистика</h3></div>
      <div class="stat-grid">
        <div class="stat"><div class="k">Победы</div><div class="v g">${u.wins}</div></div>
        <div class="stat"><div class="k">Поражения</div><div class="v r">${u.losses}</div></div>
        <div class="stat"><div class="k">Винрейт</div><div class="v">${wr}%</div></div>
        <div class="stat"><div class="k">Матчей</div><div class="v">${u.matches}</div></div>
        <div class="stat"><div class="k">Серия побед</div><div class="v">${u.win_streak}</div></div>
        <div class="stat"><div class="k">Лучшая серия</div><div class="v">${u.best_streak}</div></div>
      </div>
      <div class="stat-grid" style="grid-template-columns:1fr 1fr;margin-top:10px">
        <div class="stat"><div class="k">👍 Оценок</div><div class="v">${u.likes}</div></div>
        <div class="stat"><div class="k">🔥 Популярность</div><div class="v">${u.popularity}</div></div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>История рейтинга</h3></div>
      <div class="chart-top"><div><span class="big num" id="chartElo">${u.elo}</span><span class="d up" id="chartDelta" hidden></span></div><div class="date" id="chartDate"></div></div>
      <div class="chart" id="eloChart"></div>
      <div class="chart-foot"><span id="chartStart"></span><span id="chartEnd"></span></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Последние матчи</h3><span class="aside">${S.history.length ? 'последние ' + Math.min(10, S.history.length) : ''}</span></div>${hist}</div>
    <button class="btn btn-ghost btn-block" data-act="logout"><i class="fas fa-sign-out-alt"></i> Выйти</button>`;
  renderEloChart();
  renderAdmin();
}

function renderEloChart() {
  const box = $('eloChart'); if (!box) return;
  const rows = S.history.slice().reverse();
  if (!rows.length) {
    box.innerHTML = '<div class="empty" style="padding:30px 0">Сыграйте матч — здесь появится график</div>';
    return;
  }
  const deltas = rows.map(r => r.elo_change || 0);
  const total = deltas.reduce((a, b) => a + b, 0);
  let acc = S.me.elo - total;
  const pts = [acc]; deltas.forEach(d => { acc += d; pts.push(acc); });
  const dates = [rows[0].match_date, ...rows.map(r => r.match_date)];
  const W = box.clientWidth || 320, H = 120, padX = 8, padT = 10, padB = 14;
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  const xs = pts.map((_, i) => padX + (W - 2 * padX) * (i / (pts.length - 1)));
  const ys = pts.map(v => padT + (H - padT - padB) * (1 - (v - min) / range));
  const line = xs.map((x, i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ');
  const area = `${line} L${xs[xs.length - 1].toFixed(1)} ${H - padB} L${xs[0].toFixed(1)} ${H - padB} Z`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs><linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ddc97" stop-opacity=".45"/><stop offset="1" stop-color="#3ddc97" stop-opacity="0"/></linearGradient></defs>
    <path class="area" fill="url(#eloGrad)" d="${area}"/><path class="line" d="${line}"/>
    <line class="cursor" id="cLine" x1="0" x2="0" y1="0" y2="${H - padB}"/><circle class="dot" id="cDot" r="5" cx="0" cy="0"/></svg>`;
  const delta = $('chartDelta');
  delta.hidden = false;
  delta.textContent = (total >= 0 ? '+' : '') + total;
  delta.className = 'd ' + (total >= 0 ? 'up' : 'down');
  setText('chartStart', fmtDay(dates[0]));
  setText('chartEnd', fmtDay(dates[dates.length - 1]));
  const put = i => {
    $('cLine').setAttribute('x1', xs[i]); $('cLine').setAttribute('x2', xs[i]);
    $('cDot').setAttribute('cx', xs[i]); $('cDot').setAttribute('cy', ys[i]);
    setText('chartElo', pts[i]); setText('chartDate', fmtDay(dates[i]));
  };
  put(pts.length - 1);
  const pick = ev => {
    const r = box.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (W / r.width);
    let best = 0, bd = Infinity;
    xs.forEach((px, i) => { const d = Math.abs(px - x); if (d < bd) { bd = d; best = i; } });
    put(best);
  };
  box.onpointermove = pick; box.onpointerdown = pick;
}

async function openMatchDetails(d) {
  openModal('matchModal');
  const body = $('matchModalBody');
  body.innerHTML = '<div class="empty">Загрузка…</div>';
  const { data: h } = await sb.from('match_history').select('*').eq('id', d.id).maybeSingle();
  if (!h) { body.innerHTML = '<div class="empty">Матч не найден</div>'; return; }
  const win = h.result === 'win', delta = h.elo_change || 0, mp = mapById(h.map);
  const team = (list, cls, label, isWin) => `<div class="md-team ${cls} ${isWin ? 'win' : ''}"><h4>${label}</h4>
    ${(list || []).map(p => { const c = p.elo_change; return `<div class="md-pl" data-act="player" data-id="${esc(p.id)}">${avatarHtml(p, 30)}<div class="nm">${esc(p.username)}</div>
      <div class="e">ELO ${p.elo ?? 300} ${c != null ? `<b class="${c >= 0 ? 'p' : 'n'}">${c >= 0 ? '+' : ''}${c}</b>` : ''}</div></div>`; }).join('') || '<div class="empty" style="padding:8px">Пусто</div>'}</div>`;
  body.innerHTML = `<div class="md-head"><h3>${win ? '🏆 Победа' : 'Поражение'}</h3>
    <p>${fmtDay(h.match_date)}, ${fmtTime(h.match_date)} · ${esc(mp.name)}${h.match_number ? ' · матч #' + h.match_number : ''}</p></div>
    ${h.score_a != null ? `<div class="md-score"><span class="${h.winner === 'blue' ? 'w' : ''}">${h.score_a}</span><span class="sep">:</span><span class="${h.winner === 'orange' ? 'w' : ''}">${h.score_b}</span></div>`
      : `<div class="md-score" style="font-size:18px">Ваше ELO&nbsp;<span class="${delta >= 0 ? 'w' : ''}" style="${delta < 0 ? 'color:#ff8fa3' : ''}">${delta >= 0 ? '+' : ''}${delta}</span></div>`}
    ${team(h.team_blue, 'blue', 'Команда A', h.winner === 'blue')}${team(h.team_orange, 'orange', 'Команда B', h.winner === 'orange')}`;
}

async function openPlayer(d) {
  openModal('profileModal');
  const body = $('profileModalBody');
  body.innerHTML = '<div class="empty">Загрузка…</div>';
  const [u] = await fetchUsers([d.id], true);
  if (!u) { body.innerHTML = '<div class="empty">Игрок не найден</div>'; return; }
  const isMe = u.id === S.me.id, isFriend = S.friends.some(f => f.id === u.id);
  const wr = u.matches ? Math.round(u.wins / u.matches * 100) : 0;
  let actions = '';
  if (!isMe) {
    actions = `<div style="display:flex;gap:8px;margin-top:14px">
      ${isFriend ? `<button class="btn btn-danger" style="flex:1" data-act="friend-remove" data-id="${u.id}">Убрать из друзей</button>`
        : `<button class="btn btn-primary" style="flex:1" data-act="friend-add" data-id="${u.id}">Добавить в друзья</button>`}
      <button class="btn btn-ghost" data-act="like" data-id="${u.id}" aria-label="Оценить игрока">👍</button></div>`;
  }
  body.innerHTML = `<div class="pf-modal-top">${avatarHtml(u, 72)}<div><div class="nm">${esc(u.username)} ${u.isadmin ? '👑' : ''}</div>
    <div class="sub">${lvlChip(u.elo)} &nbsp;ELO ${u.elo} · в игре с ${fmtDay(u.registered)}</div></div></div>
    <div class="stat-grid">
      <div class="stat"><div class="k">Матчей</div><div class="v">${u.matches}</div></div>
      <div class="stat"><div class="k">Победы</div><div class="v g">${u.wins}</div></div>
      <div class="stat"><div class="k">Поражения</div><div class="v r">${u.losses}</div></div>
      <div class="stat"><div class="k">Винрейт</div><div class="v">${wr}%</div></div>
      <div class="stat"><div class="k">Оценок</div><div class="v">${u.likes}</div></div>
      <div class="stat"><div class="k">Лучшая серия</div><div class="v">${u.best_streak}</div></div></div>${actions}`;
}

/* ───────────── Друзья ───────────── */
async function loadFriends() {
  const me = S.me.id;
  const [f, rin, rout] = await Promise.all([
    sb.from('friends').select('friend_id').eq('user_id', me),
    sb.from('friend_requests').select('from_user_id').eq('to_user_id', me).eq('status', 'pending'),
    sb.from('friend_requests').select('to_user_id').eq('from_user_id', me).eq('status', 'pending')
  ]);
  const fids = (f.data || []).map(x => x.friend_id);
  const rids = (rin.data || []).map(x => x.from_user_id);
  const sids = (rout.data || []).map(x => x.to_user_id);
  await fetchUsers([...fids, ...rids, ...sids], true);
  const pick = ids => ids.map(i => S.users[i]).filter(Boolean);
  S.friends = pick(fids); S.requests = pick(rids); S.sent = pick(sids);
  renderFriends();
  updateFriendBadges();
}
function updateFriendBadges() {
  const n = S.requests.length + S.invites.length;
  const dot = $('navFriendDot'); dot.hidden = n === 0; dot.textContent = n;
  const rb = $('reqBadge'); rb.hidden = S.requests.length === 0; rb.textContent = S.requests.length;
}
function friendRowHtml(u) {
  const isF = S.friends.some(x => x.id === u.id);
  const inc = S.requests.some(x => x.id === u.id);
  const out = S.sent.some(x => x.id === u.id);
  const inParty = S.party && S.party.members.includes(u.id);
  const canInvite = isF && !inParty && (!S.party || S.party.leader === S.me.id) && !S.queue.searching;
  let badge, acts = '';
  if (isF) {
    badge = '<span class="badge ok">Друг</span>';
    acts = (canInvite ? `<button class="btn btn-primary btn-sm" data-act="party-invite" data-id="${u.id}"><i class="fas fa-user-plus"></i> В пати</button>` : '')
         + (inParty ? '<span class="badge warn">В вашей пати</span>' : '')
         + `<button class="btn btn-ghost btn-sm" data-act="friend-remove" data-id="${u.id}">Удалить</button>`;
  } else if (inc) {
    badge = '<span class="badge warn">Хочет дружить</span>';
    acts = `<button class="btn btn-ok btn-sm" data-act="friend-accept" data-id="${u.id}">Принять</button>
            <button class="btn btn-ghost btn-sm" data-act="friend-decline" data-id="${u.id}">Отклонить</button>`;
  } else if (out) {
    badge = '<span class="badge info">Заявка отправлена</span>';
    acts = `<button class="btn btn-ghost btn-sm" data-act="friend-cancel" data-id="${u.id}">Отменить</button>`;
  } else {
    badge = '';
    acts = `<button class="btn btn-primary btn-sm" data-act="friend-add" data-id="${u.id}"><i class="fas fa-user-plus"></i> Добавить</button>`;
  }
  return `<div class="row" style="flex-wrap:wrap">
    <div class="row link" style="flex:1;min-width:0;border:none;padding:0" data-act="player" data-id="${u.id}">${avatarHtml(u, 44)}
      <div class="row-main"><div class="row-title">${esc(u.username)} ${u.isadmin ? '👑' : ''}</div><div class="row-sub">ELO ${u.elo}</div></div>${badge}</div>
    <div class="row-actions" style="width:100%">${acts}</div></div>`;
}
function renderFriends() {
  const box = $('friendsList'); if (!box) return;
  setText('friendsCount', S.friends.length + ' ' + (S.friends.length === 1 ? 'друг' : 'друзей'));
  $('tabFriends').classList.toggle('active', S.tab === 'friends');
  $('tabRequests').classList.toggle('active', S.tab === 'requests');
  const q = S.fq.trim();
  let list, emptyText;
  if (q) { list = S.fresults; emptyText = 'Никого не нашли'; }
  else if (S.tab === 'friends') { list = S.friends; emptyText = 'Друзей пока нет. Найдите игрока по нику выше.'; }
  else { list = S.requests; emptyText = 'Новых заявок нет'; }
  box.innerHTML = list.length
    ? '<div class="rows">' + list.map(friendRowHtml).join('') + '</div>'
    : `<div class="empty"><i class="fas fa-user-friends"></i>${emptyText}</div>`;
}
async function searchPlayers(q) {
  const token = ++S.fToken;
  const clean = q.replace(/[%_\\,()]/g, '');
  if (!clean) { S.fresults = []; return renderFriends(); }
  const { data } = await sb.from('users').select(PUBLIC_COLS).ilike('username', '%' + clean + '%').neq('id', S.me.id).limit(20);
  if (token !== S.fToken) return;
  S.fresults = data || [];
  (data || []).forEach(u => { S.users[u.id] = u; });
  renderFriends();
}
async function friendOp(fn, args, okText) {
  await rpc(fn, args);
  if (okText) toast('success', okText, '');
  await loadFriends();
  if (S.fq.trim()) renderFriends();
}

/* ───────────── Топ ───────────── */
async function renderTop() {
  const box = $('topList');
  const [{ data, error }, rank] = await Promise.all([
    sb.from('users').select(PUBLIC_COLS).order('elo', { ascending: false }).limit(100),
    rpc('my_rank').catch(() => null)
  ]);
  if (error) { box.innerHTML = `<div class="empty">Не удалось загрузить: ${esc(error.message)}</div>`; return; }
  setText('myRank', '#' + (rank || '—'));
  if (!data.length) { box.innerHTML = '<div class="empty">Игроков пока нет</div>'; return; }
  box.innerHTML = '<div class="rows">' + data.map((u, i) => {
    const wr = u.matches ? Math.round(u.wins / u.matches * 100) : 0;
    const n = i + 1;
    return `<div class="row link ${u.id === S.me.id ? 'me' : ''}" data-act="player" data-id="${u.id}">
      <div class="top-rank ${n <= 3 ? 'r' + n : ''}">#${n}</div>${avatarHtml(u, 40)}
      <div class="row-main"><div class="row-title">${esc(u.username)} ${u.isadmin ? '👑' : ''}</div><div class="row-sub">${u.matches} матчей · ${wr}%</div></div>
      ${lvlChip(u.elo)}<div class="top-elo">${u.elo}<small>ELO</small></div></div>`;
  }).join('') + '</div>';
}

/* ───────────── Кошелёк и магазин ───────────── */
async function applyPromo(e) {
  e.preventDefault();
  const inp = $('promoInput'), code = inp.value.trim();
  if (!code) return toast('error', 'Введите промокод', '');
  try {
    S.me.balance = await rpc('redeem_promo', { p_code: code });
    renderBalance();
    inp.value = '';
    toast('success', 'Промокод применён', 'Баланс: ' + S.me.balance + ' ₽');
  } catch (err) { toast('error', 'Ошибка', errText(err)); }
}

function renderShop() {
  const u = S.me; if (!u) return;
  const owned = u.owned_frames || [], active = u.avatar_frame || '';
  $('shopBody').innerHTML = `
    <div class="panel"><div class="panel-head"><h3>Ваш аватар</h3></div>
      <div class="shop-me">${avatarHtml(u, 84)}
        <div class="upload"><label class="btn btn-ghost btn-block" for="avatarFile"><i class="fas fa-upload"></i> Загрузить</label>
          <input type="file" id="avatarFile" accept="image/jpeg,image/png,image/webp">
          <div class="row-sub">JPG, PNG или WEBP, до 2 МБ</div>
          ${u.avatar_url ? '<button class="btn btn-danger btn-sm btn-block" data-act="avatar-remove"><i class="fas fa-trash"></i> Удалить</button>' : ''}</div></div></div>
    <div class="panel"><div class="panel-head"><h3>Рамки</h3><span class="aside">${CFG.framePrice} ₽ за рамку</span></div>
      <div class="frames">${FRAMES.map(f => {
        const isOwned = owned.includes(f.id), isActive = active === f.id;
        const btn = isActive ? `<button class="btn btn-ghost btn-sm btn-block" data-act="frame-use" data-id="">Снять</button>`
          : isOwned ? `<button class="btn btn-ghost btn-sm btn-block" data-act="frame-use" data-id="${f.id}">Надеть</button>`
          : `<button class="btn btn-primary btn-sm btn-block" data-act="frame-buy" data-id="${f.id}">Купить</button>`;
        return `<div class="frame ${isActive ? 'active' : isOwned ? 'owned' : ''}">${avatarHtml({ username: u.username, avatar_url: u.avatar_url, avatar_frame: f.id }, 60)}
          <div class="nm">${f.name}</div><div class="pr">${isOwned ? 'Куплена' : CFG.framePrice + ' ₽'}</div>${btn}</div>`;
      }).join('')}</div></div>`;
}

async function uploadAvatar(file) {
  if (!file) return;
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!ext) return toast('error', 'Неверный формат', 'Нужен JPG, PNG или WEBP');
  if (file.size > 2 * 1024 * 1024) return toast('error', 'Файл слишком большой', 'Максимум 2 МБ');
  toast('info', 'Загружаем…', '');
  const path = `${S.me.id}/${Date.now()}.${ext}`;
  const up = await sb.storage.from('avatars').upload(path, file, { cacheControl: '3600', upsert: false });
  if (up.error) throw up.error;
  const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  const { error } = await sb.from('users').update({ avatar_url: url }).eq('id', S.me.id);
  if (error) throw error;
  const old = (S.me.avatar_url || '').split('/avatars/')[1];
  if (old) sb.storage.from('avatars').remove([old]).catch(() => {});
  S.me.avatar_url = url;
  toast('success', 'Аватар обновлён', '');
  renderShop();
}
async function removeAvatar() {
  const ok = await dialog({ title: 'Удалить аватар?', ok: 'Удалить', danger: true });
  if (!ok) return;
  const { error } = await sb.from('users').update({ avatar_url: '' }).eq('id', S.me.id);
  if (error) throw error;
  const old = (S.me.avatar_url || '').split('/avatars/')[1];
  if (old) sb.storage.from('avatars').remove([old]).catch(() => {});
  S.me.avatar_url = '';
  renderShop();
}
async function buyFrame(d) {
  const f = FRAMES.find(x => x.id === d.id);
  const ok = await dialog({ title: `Купить рамку «${f.name}»?`, text: CFG.framePrice + ' ₽ спишется с баланса.', ok: 'Купить' });
  if (!ok) return;
  await rpc('buy_frame', { p_frame: d.id });
  await refreshMe();
  toast('success', 'Куплено', 'Рамка надета');
  renderShop();
}
async function useFrame(d) {
  await rpc('use_frame', { p_frame: d.id || '' });
  await refreshMe();
  renderShop();
}

/* ───────────── Админка ───────────── */
function renderAdmin() {
  const box = $('adminPanel'); if (!box) return;
  if (!S.me || !S.me.isadmin) { box.innerHTML = ''; return; }
  const tabs = [['matches', 'Матчи'], ['players', 'Игроки'], ['queue', 'Очередь'], ['promos', 'Промокоды'], ['admins', 'Админы'], ['settings', 'Формат']];
  box.innerHTML = `<div class="panel" style="margin-top:14px"><div class="panel-head"><h3><i class="fas fa-user-shield"></i> Админ-панель</h3></div>
    <div class="adm-tabs">${tabs.map(([k, v]) => `<button class="${S.adminTab === k ? 'on' : ''}" data-act="adm-tab" data-tab="${k}">${v}</button>`).join('')}</div>
    <div id="admBody"><div class="empty">Загрузка…</div></div></div>`;
  loadAdminTab().catch(e => { const b = $('admBody'); if (b) b.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; });
}

async function loadAdminTab() {
  const body = $('admBody'); if (!body) return;
  const tab = S.adminTab;
  if (tab === 'matches') {
    const list = await rpc('admin_matches');
    body.innerHTML = `<button class="btn btn-ghost btn-sm" data-act="adm-refresh" style="margin-bottom:10px"><i class="fas fa-rotate"></i> Обновить</button>` +
      (list.length ? list.map(m => {
        const team = (arr, cls, title) => `<div class="${cls}"><h5>${title}</h5>${arr.map((p, i) => `<div>${i === 0 ? '👑 ' : ''}${esc(p.username)}</div>`).join('')}</div>`;
        const rp = m.reports || { blue: 0, orange: 0 };
        return `<div class="adm-card" data-card="${m.id}">
          <div class="hdr"><b>#${m.match_number}</b><span class="badge ${m.status === 'pending' ? 'warn' : 'info'}">${m.status === 'pending' ? 'Ждёт подтверждения' : 'Идёт'}</span></div>
          <div class="adm-teams">${team(m.blue, 'blue', 'Команда A')}${team(m.orange, 'orange', 'Команда B')}</div>
          ${m.status === 'active' ? `<div class="row-sub" style="margin-bottom:8px">Ответы игроков: A — <b>${rp.blue}</b>, B — <b>${rp.orange}</b></div>
          <div class="adm-score"><input class="text-input sa" type="number" min="0" placeholder="0" aria-label="Счёт A"><span class="muted">:</span><input class="text-input sb" type="number" min="0" placeholder="0" aria-label="Счёт B"></div>
          <div class="adm-btns"><button class="btn btn-sm btn-ghost" data-act="adm-finish" data-id="${m.id}" data-side="blue">🏆 Победа A</button>
            <button class="btn btn-sm btn-ghost" data-act="adm-finish" data-id="${m.id}" data-side="orange">🏆 Победа B</button></div>` : ''}
          <button class="btn btn-sm btn-danger btn-block" data-act="adm-cancel" data-id="${m.id}">Отменить матч</button></div>`;
      }).join('') : '<div class="empty">Активных матчей нет</div>');
  } else if (tab === 'players') {
    body.innerHTML = `<input class="text-input" id="admSearch" placeholder="Поиск по нику" style="margin-bottom:10px"><div id="admPlayers"></div>`;
    $('admSearch').addEventListener('input', debounce(() => fillAdminPlayers(), 350));
    await fillAdminPlayers();
  } else if (tab === 'queue') {
    const { data } = await sb.from('queue').select('*').order('created_at');
    body.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>В очереди: ${(data || []).length}</b>
      <button class="btn btn-sm btn-danger" data-act="adm-clear-queue">Очистить</button></div>` +
      ((data || []).length ? '<div class="rows">' + data.map(p => `<div class="row"><div class="row-main"><div class="row-title">${esc(p.username)}</div></div><b>${p.elo}</b></div>`).join('') + '</div>' : '<div class="empty">Очередь пуста</div>');
  } else if (tab === 'promos') {
    const list = await rpc('admin_promos');
    body.innerHTML = `<div class="stack" style="margin-bottom:12px">
      <input class="text-input" id="admPromoCode" placeholder="КОД" maxlength="20" style="text-transform:uppercase">
      <div class="adm-row" style="margin:0"><input class="text-input" id="admPromoAmount" type="number" min="1" placeholder="Сумма ₽"><input class="text-input" id="admPromoUses" type="number" min="1" value="1" placeholder="Активаций"></div>
      <button class="btn btn-primary" data-act="adm-promo-create">Создать</button></div>` +
      (list.length ? '<div class="rows">' + list.map(p => `<div class="row"><div class="row-main"><div class="row-title">${esc(p.code)} — ${p.amount} ₽</div><div class="row-sub">${p.used_count}/${p.max_uses} активаций</div></div>
        <button class="icon-btn" data-act="adm-promo-del" data-id="${p.id}" aria-label="Удалить"><i class="fas fa-trash"></i></button></div>`).join('') + '</div>' : '<div class="empty">Промокодов нет</div>');
  } else if (tab === 'admins') {
    const { data } = await sb.from('users').select('id,username').eq('isadmin', true);
    body.innerHTML = `<div class="adm-row" style="margin:0 0 12px"><input class="text-input" id="admNewAdmin" placeholder="Ник игрока"><button class="btn btn-primary" data-act="adm-add-admin">Добавить</button></div>` +
      '<div class="rows">' + (data || []).map(a => `<div class="row"><div class="row-main"><div class="row-title">${esc(a.username)} 👑</div></div>
        <button class="btn btn-ghost btn-sm" data-act="adm-set-admin" data-id="${a.id}" data-value="0">Снять</button></div>`).join('') + '</div>';
  } else if (tab === 'settings') {
    body.innerHTML = `<div class="stack"><label class="row-sub" for="admSize">Формат матча (очередь сбросится)</label>
      <select class="text-input" id="admSize">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${S.teamSize === n ? 'selected' : ''}>${n} на ${n}</option>`).join('')}</select>
      <button class="btn btn-primary" data-act="adm-save-size">Сохранить</button></div>`;
  }
}

async function fillAdminPlayers() {
  const box = $('admPlayers'); if (!box) return;
  const q = ($('admSearch') || { value: '' }).value.trim();
  const list = await rpc('admin_players', { p_q: q });
  box.innerHTML = list.length ? list.map(p => `<div class="adm-card"><div class="hdr"><b>${esc(p.username)} ${p.isadmin ? '👑' : ''} ${p.banned ? '🚫' : ''}</b><span class="num">${p.elo}</span></div>
    <div class="row-sub">Игровой ID: ${esc(p.game_id)} · баланс ${p.balance} ₽</div>
    <div class="adm-row"><button class="btn btn-sm btn-ghost" data-act="adm-rating" data-id="${p.id}" data-nick="${esc(p.username)}" data-elo="${p.elo}">ELO</button>
      <button class="btn btn-sm ${p.banned ? 'btn-ok' : 'btn-danger'}" data-act="adm-ban" data-id="${p.id}" data-value="${p.banned ? 0 : 1}">${p.banned ? 'Разбанить' : 'Бан'}</button>
      <button class="btn btn-sm btn-ghost" data-act="adm-set-admin" data-id="${p.id}" data-value="${p.isadmin ? 0 : 1}">${p.isadmin ? 'Снять админа' : 'Сделать админом'}</button></div></div>`).join('')
    : '<div class="empty">Никого не нашли</div>';
}

async function admFinish(d) {
  const ok = await dialog({ title: `Засчитать победу команды ${d.side === 'blue' ? 'A' : 'B'}?`, text: 'ELO игроков изменится сразу.', ok: 'Засчитать' });
  if (!ok) return;
  const card = document.querySelector(`[data-card="${d.id}"]`);
  const num = sel => { const v = card && card.querySelector(sel) ? card.querySelector(sel).value : ''; const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  await rpc('admin_finish_match', { p_match: d.id, p_winner: d.side, p_score_a: num('.sa'), p_score_b: num('.sb') });
  toast('success', 'Матч засчитан', '');
  await syncMatch();
  if ($('admBody')) loadAdminTab().catch(() => {});
}
async function admCancel(d) {
  const ok = await dialog({ title: 'Отменить матч?', text: 'Матч закроется у всех игроков без изменения рейтинга.', ok: 'Отменить', danger: true });
  if (!ok) return;
  await rpc('admin_cancel_match', { p_match: d.id });
  toast('info', 'Матч отменён', '');
  await syncMatch();
  if ($('admBody')) loadAdminTab().catch(() => {});
}

/* ───────────── Действия (делегирование кликов) ───────────── */
const ACTIONS = {
  nav: d => navigate(d.page),
  close: d => closeModal(d.target),
  'auth-tab': d => switchAuthTab(d.tab),
  logout,
  'search-start': startSearch,
  'search-cancel': cancelSearch,
  confirm: confirmMatch,
  ban: banMap,
  report: reportResult,
  'copy-match': () => S.match && copyText(String(S.match.match_number || S.match.id)),
  'copy-host': () => { const h = S.match && S.match.blue[0]; if (h && h.game_id) copyText(h.game_id); },
  player: openPlayer,
  'match-details': openMatchDetails,
  like: async d => { await rpc('like_player', { p_target: d.id }); toast('success', 'Оценка засчитана', ''); openPlayer(d); },
  'friends-tab': d => { S.tab = d.tab; renderFriends(); },
  'friend-add': d => friendOp('send_friend_request', { p_to: d.id }, 'Заявка отправлена').then(() => $('profileModal').classList.contains('active') && openPlayer(d)),
  'friend-accept': d => friendOp('accept_friend_request', { p_from: d.id }, 'Друг добавлен'),
  'friend-decline': d => friendOp('decline_friend_request', { p_from: d.id }),
  'friend-cancel': d => friendOp('cancel_friend_request', { p_to: d.id }),
  'friend-remove': async d => {
    const ok = await dialog({ title: 'Удалить из друзей?', ok: 'Удалить', danger: true });
    if (!ok) return;
    await friendOp('remove_friend', { p_friend: d.id }, 'Удалён из друзей');
    if ($('profileModal').classList.contains('active')) closeModal('profileModal');
    await loadParty();
  },
  'party-invite': async d => { await rpc('party_invite', { p_friend: d.id }); toast('success', 'Приглашение отправлено', ''); await loadParty(); renderFriends(); },
  'party-accept': async d => { await rpc('party_accept', { p_invite: d.id }); toast('success', 'Вы в пати', ''); await loadParty(); },
  'party-decline': async d => { await rpc('party_decline', { p_invite: d.id }); await loadParty(); },
  'party-leave': async () => { await rpc('party_leave'); await loadParty(); await syncQueue(); },
  'party-kick': async d => { await rpc('party_kick', { p_user: d.id }); await loadParty(); },
  'avatar-remove': removeAvatar,
  'frame-buy': buyFrame,
  'frame-use': useFrame,
  'adm-tab': d => { S.adminTab = d.tab; renderAdmin(); },
  'adm-refresh': () => loadAdminTab(),
  'adm-finish': admFinish,
  'adm-cancel': admCancel,
  'adm-rating': async d => {
    const v = await dialog({ title: 'Рейтинг ' + d.nick, input: d.elo, ok: 'Сохранить' });
    if (v === null) return;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return toast('error', 'Введите число', '');
    await rpc('admin_set_rating', { p_user: d.id, p_elo: n });
    toast('success', 'Рейтинг обновлён', d.nick + ': ' + n);
    await fillAdminPlayers();
  },
  'adm-ban': async d => {
    const ban = d.value === '1';
    const ok = await dialog({ title: ban ? 'Заблокировать игрока?' : 'Разблокировать игрока?', ok: ban ? 'Заблокировать' : 'Разблокировать', danger: ban });
    if (!ok) return;
    await rpc('admin_set_banned', { p_user: d.id, p_banned: ban });
    await fillAdminPlayers();
  },
  'adm-set-admin': async d => {
    const val = d.value === '1';
    const ok = await dialog({ title: val ? 'Сделать админом?' : 'Снять права админа?', ok: 'Да' });
    if (!ok) return;
    await rpc('admin_set_admin', { p_user: d.id, p_value: val });
    await loadAdminTab();
  },
  'adm-clear-queue': async () => {
    const ok = await dialog({ title: 'Очистить очередь?', ok: 'Очистить', danger: true });
    if (!ok) return;
    await rpc('admin_clear_queue'); await loadAdminTab();
  },
  'adm-promo-create': async () => {
    await rpc('admin_create_promo', {
      p_code: $('admPromoCode').value, p_amount: parseInt($('admPromoAmount').value, 10) || 0, p_uses: parseInt($('admPromoUses').value, 10) || 1
    });
    toast('success', 'Промокод создан', ''); await loadAdminTab();
  },
  'adm-promo-del': async d => { await rpc('admin_delete_promo', { p_id: d.id }); await loadAdminTab(); },
  'adm-add-admin': async () => {
    await rpc('admin_add_admin', { p_nick: $('admNewAdmin').value });
    toast('success', 'Админ добавлен', ''); await loadAdminTab();
  },
  'adm-save-size': async () => {
    const n = parseInt($('admSize').value, 10);
    const ok = await dialog({ title: `Переключить формат на ${n}×${n}?`, text: 'Очередь поиска будет очищена.', ok: 'Переключить' });
    if (!ok) return;
    await rpc('admin_set_team_size', { p_size: n });
    S.teamSize = n; updateSearchUI();
    toast('success', 'Формат обновлён', n + '×' + n);
  }
};

/* ───────────── Инициализация ───────────── */
function bindEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (el) {
      const fn = ACTIONS[el.dataset.act];
      if (fn) run(fn, el.dataset, el);
      return;
    }
    if (e.target.classList && e.target.classList.contains('overlay') && ['profileModal', 'matchModal'].includes(e.target.id)) closeModal(e.target.id);
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'avatarFile') run(() => uploadAvatar(e.target.files[0]));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal('profileModal'); closeModal('matchModal'); }
  });
  $('loginForm').addEventListener('submit', doLogin);
  $('registerForm').addEventListener('submit', doRegister);
  $('chatForm').addEventListener('submit', e => run(() => sendChat(e)));
  $('promoForm').addEventListener('submit', applyPromo);
  $('headBalance').setAttribute('data-act', 'nav');
  $('headBalance').setAttribute('data-page', 'wallet');
  $('headBalance').setAttribute('role', 'button');
  $('headBalance').setAttribute('tabindex', '0');
  $('friendSearch').addEventListener('input', debounce(e => {
    S.fq = e.target.value;
    if (S.fq.trim()) run(() => searchPlayers(S.fq)); else { S.fresults = []; renderFriends(); }
  }, 300));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) pollTick(); });
  window.addEventListener('online', () => { if (S.me) pollTick(); });
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && S.me) showAuth('Сессия истекла. Войдите снова.'); });
}

async function init() {
  try {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      tg.ready(); if (tg.expand) tg.expand();
      try { tg.setHeaderColor('#0c0916'); tg.setBackgroundColor('#0c0916'); } catch (e) { /* старые версии */ }
    }
  } catch (e) { /* ок */ }
  bindEvents();
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await enterApp();
    else showAuth();
  } catch (e) {
    console.error('init', e);
    showAuth();
  } finally {
    const s = $('splash');
    if (s) { s.classList.add('hide'); setTimeout(() => s.remove(), 500); }
  }
}

init();
