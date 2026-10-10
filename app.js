'use strict';
/* =====================================================================
   BNK FACEIT — app.js
   Вся игровая логика (подбор, драфт, ELO, права) живёт на сервере в schema.sql.
   Здесь — интерфейс и вызовы RPC.
   ===================================================================== */

/* ───────────── Конфигурация ───────────── */
const SUPABASE_URL = 'https://ggjkivobmwwqgzkaaihx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnamtpdm9ibXd3cWd6a2FhaWh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NzQzODcsImV4cCI6MjEwNzE1MDM4N30.flfcDmjp9riwZe9N4xCqX9CzIo6D9x9SeeQB3YU7254';

/* Без почты и Supabase Auth: вход по нику и паролю через RPC, токен сессии хранится в localStorage
   и уходит на сервер в заголовке X-Client-Info (его читает public.uid() в schema.sql). */
const TG = window.Telegram && window.Telegram.WebApp;
const cloud = {
  ok: () => !!(TG && TG.CloudStorage && TG.isVersionAtLeast && TG.isVersionAtLeast('6.9')),
  get: key => new Promise(res => {
    if (!cloud.ok()) return res('');
    const t = setTimeout(() => res(''), 2000);
    try { TG.CloudStorage.getItem(key, (err, v) => { clearTimeout(t); res(err ? '' : (v || '')); }); } catch (e) { clearTimeout(t); res(''); }
  }),
  set: (key, val) => { try { if (cloud.ok()) { val ? TG.CloudStorage.setItem(key, val) : TG.CloudStorage.removeItem(key); } } catch (e) { /* ок */ } }
};
let SESSION = '';
try { SESSION = localStorage.getItem('bnk_session') || ''; } catch (e) { /* приватный режим */ }
// Токен дублируется в Telegram CloudStorage: если WebView очистит localStorage, вход сохранится
function saveSession(t) {
  SESSION = t || '';
  try { t ? localStorage.setItem('bnk_session', t) : localStorage.removeItem('bnk_session'); } catch (e) { /* ок */ }
  cloud.set('bnk_session', SESSION);
}
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: (url, opts = {}) => {
      const h = new Headers(opts.headers || {});
      if (SESSION) h.set('X-Client-Info', 'bnk/' + SESSION);
      return fetch(url, { ...opts, headers: h });
    }
  }
});

const CFG = { confirmSec: 30, draftSec: 30, lobbySec: 300, pollMs: 2500, framePrice: 25, bannerPrice: 50 };
const NICK_RE = /^[A-Za-z0-9А-Яа-яЁё_-]{3,20}$/;
const PUBLIC_COLS = 'id,username,elo,matches,wins,losses,win_streak,best_streak,kills,deaths,assists,rounds,stat_matches,likes,popularity,isadmin,avatar_url,avatar_frame,registered';
const PAGES = ['home', 'matches', 'match', 'matchview', 'support', 'profile', 'friends', 'top', 'wallet', 'shop'];
const SIDE_NAME = { blue: 'Спецназ', orange: 'Террористы' };
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
  chat: [], tick: 0, rank: null, stats: { searching: 0, in_match: 0, matches: 0 },
  history: [], adminTab: 'matches',
  channels: [], timers: {}, sup: newSup(), news: [], newsLoaded: false, seenAt: 0, newSince: 0,
  banners: {}, myBanners: { owned: [], active: '' }, bnMatch: null
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
  return S.maps.find(m => m.id.toLowerCase() === key || m.name.toLowerCase() === key) || { id: key || 'map', name: id || '—', img: '' };
}
function mapSrc(m) { return m.img || ('maps/' + m.id + '.jpg'); }
function mapFallback(m) {
  const name = String(m.name || m.id || '?').replace(/[^A-Za-z0-9А-Яа-я ]/g, '');
  let h = 0; for (const ch of String(m.id || name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},60%,34%)"/><stop offset="1" stop-color="hsl(${(h + 70) % 360},55%,16%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><path d="M0 140 L70 90 L120 120 L190 60 L260 110 L320 80 L320 180 L0 180Z" fill="rgba(0,0,0,.28)"/><text x="16" y="164" font-family="Arial" font-weight="700" font-size="26" fill="rgba(255,255,255,.85)">${name}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function mapThumb(m) {
  return `<img src="${esc(mapSrc(m))}" alt="${esc(m.name)}" loading="lazy" onerror="this.onerror=null;this.src='${mapFallback(m)}'">`;
}
function mapBg(m) { return `background-image:url('${esc(mapSrc(m))}'),url('${mapFallback(m)}')`; }

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

/* ───────────── Авторизация (ник + пароль, без почты) ───────────── */
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
    const r = await rpc('login_user', { p_nick: nick, p_password: pass });
    if (!r || r.error) return authMsg('loginMsg', 'error', (r && r.error) || 'Не удалось войти');
    saveSession(r.token);
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
  if (gid.length < 3 || gid.length > 30) return bad('ID Standoff: от 3 до 30 символов');
  if (p1.length < 8) return bad('Пароль — минимум 8 символов');
  if (p1 !== p2) return bad('Пароли не совпадают');
  const btn = $('registerBtn'); btn.disabled = true;
  authMsg('registerMsg', 'info', 'Создаём аккаунт…');
  try {
    const r = await rpc('register_user', { p_nick: nick, p_game_id: gid, p_password: p1 });
    saveSession(r.token);
    authMsg('registerMsg', 'success', 'Добро пожаловать, ' + nick + '!');
    await enterApp();
  } catch (err) { bad(errText(err)); }
  finally { btn.disabled = false; }
}

function showAuth(message) {
  stopLoops(); stopChat();
  S.me = null; S.match = null; S.party = null; S.invites = []; S.sup = newSup(); S.news = []; S.newsLoaded = false; S.banners = {}; S.myBanners = { owned: [], active: '' }; S.bnMatch = null;
  S.queue = { searching: false, since: null, count: 0, need: S.teamSize * 2 };
  $('app').hidden = true;
  $('auth').hidden = false;
  closeModal('confirmModal'); closeModal('settingsModal'); closeModal('notifModal');
  if (message) authMsg('loginMsg', 'error', message);
}

async function logout() {
  const ok = await dialog({ title: 'Выйти из аккаунта?', ok: 'Выйти', danger: true });
  if (!ok) return;
  try { await rpc('cancel_search'); } catch (e) { /* не критично */ }
  try { await rpc('logout'); } catch (e) { /* не критично */ }
  saveSession('');
  showAuth();
  toast('info', 'Вы вышли', '');
}

/* ───────────── Запуск ───────────── */
async function enterApp() {
  if (S.entering) return;
  S.entering = true;
  try {
    const me = await rpc('get_me');
    if (!me) { saveSession(''); return showAuth('Сессия истекла. Войдите снова.'); }
    S.me = me;
    initSeen();
    $('auth').hidden = true;
    $('app').hidden = false;
    await Promise.all([loadMaps(), loadSettings()]);
    renderBalance();
    await Promise.allSettled([loadFriends(), loadParty(), syncMatch(), loadStats(), loadHistory(), refreshMe(), loadNews(), loadMyBanners()]);
    if (!(S.match && S.match.status === 'active')) await syncQueue().catch(() => {});
    navigate(S.match && S.match.status === 'active' ? 'match' : 'home');
    startLoops();
  } finally { S.entering = false; }
}

function startLoops() {
  stopLoops();
  S.timers.poll = setInterval(pollTick, CFG.pollMs);
  S.timers.ui = setInterval(uiTick, 250);
  S.timers.stats = setInterval(() => { if (S.page === 'home' || S.page === 'matches') loadStats(); }, 8000);
}
function stopLoops() { Object.values(S.timers).forEach(clearInterval); S.timers = {}; }

async function pollTick() {
  if (!S.me || S.polling) return;
  S.polling = true;
  S.tick++;
  try {
    await syncMatch();
    if (!S.match) await syncQueue();
    else if (S.match.status === 'active') await pullChat();
    if (S.tick % 2 === 0) await loadParty().catch(() => {});
    if (S.tick % 4 === 0) await loadFriends().catch(() => {});
    if (S.tick % 8 === 0) await loadSettings().catch(() => {});
    if (S.tick % 4 === 2) await loadNews().catch(() => {});
  } catch (e) { /* сеть моргнула — повторим */ }
  finally { S.polling = false; }
}


/* ───────────── Данные ───────────── */
async function loadMaps() {
  const { data } = await sb.from('maps').select('*').eq('active', true).order('sort_order');
  S.maps = (data || []).filter(m => String(m.id).toLowerCase() !== 'zone' && String(m.name).toLowerCase() !== 'zone');
}
async function loadSettings() {
  const { data } = await sb.from('settings').select('*');
  (data || []).forEach(r => { if (r.key === 'team_size') S.teamSize = parseInt(r.value) || 3; });
  updateSearchUI();
}
async function refreshMe() {
  const me = await rpc('get_me');
  if (me) { S.me = me; renderBalance(); }
  try { S.rank = await rpc('my_rank'); } catch (e) { /* ок */ }
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
    S.stats = { searching: s.searching || 0, in_match: s.in_match || 0, matches: s.matches || 0 };
    setText('statSearching', S.stats.searching);
    setText('statInMatch', S.stats.in_match);
    setText('statMatches', S.stats.matches);
    updateSearchUI();
  } catch (e) { /* ок */ }
}
async function loadHistory() {
  const { data } = await sb.from('match_history')
    .select('id,map,result,elo_change,match_date,winner,score_a,score_b,kills,deaths,assists,match_number')
    .eq('user_id', S.me.id).order('match_date', { ascending: false }).limit(30);
  S.history = data || [];
  updateFriendBadges();
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
    b.classList.toggle('active', bp === page || (bp === 'matches' && page === 'match') || (bp === 'profile' && page === 'matchview'));
  });
  window.scrollTo({ top: 0 });
  if (page === 'home') loadStats();
  if (page === 'matches') { loadParty().catch(() => {}); loadStats(); refreshMe().then(updateSearchUI).catch(() => {}); updateSearchUI(); }
  if (page === 'match') renderMatch(true);
  if (page === 'profile') { renderProfile(); refreshMe().then(() => S.page === 'profile' && renderProfile()).catch(() => {}); loadHistory().catch(() => {}); }
  if (page === 'friends') loadFriends().catch(() => {});
  if (page === 'top') renderTop();
  if (page === 'wallet') renderBalance();
  if (page === 'shop') { renderShop(); loadMyBanners().then(() => { if (S.page === 'shop') renderShop(); }); }
  if (page === 'support') { renderSupport(); loadTickets().then(() => { if (S.page === 'support' && S.sup.view === 'home') renderSupport(); }); }
}

function setNavMatch(mode) { // 'idle' | 'searching' | 'match'
  $('navPlay').classList.toggle('live', mode !== 'idle');
  setText('navPlayLabel', mode === 'match' ? 'Матч' : mode === 'searching' ? 'Поиск' : 'Играть');
}

/* Уведомления */
function initSeen() {
  let v = 0;
  try { v = parseInt(localStorage.getItem('bnk_seen_' + S.me.id)) || 0; } catch (e) { /* ок */ }
  if (!v) { v = Date.now(); saveSeen(v); }
  S.seenAt = v; S.newSince = v;
}
function saveSeen(v) { try { localStorage.setItem('bnk_seen_' + S.me.id, String(v)); } catch (e) { /* ок */ } }
function feedItems() {
  const news = S.news.map(n => ({ kind: 'news', ts: toMs(n.created_at), n }));
  const res = S.history.slice(0, 15).map(h => ({ kind: 'result', ts: toMs(h.match_date), h }));
  return [...news, ...res].sort((a, b) => b.ts - a.ts).slice(0, 25);
}
const unreadFeed = () => feedItems().filter(i => i.ts > S.seenAt).length;

async function loadNews() {
  try {
    const list = (await rpc('get_news')) || [];
    const known = new Set(S.news.map(n => n.id));
    const first = !S.newsLoaded;
    S.news = list; S.newsLoaded = true;
    if (!first) {
      const fresh = list.find(n => !known.has(n.id) && toMs(n.created_at) > S.seenAt);
      if (fresh) toast('info', 'Новости проекта', fresh.title);
    }
    updateFriendBadges();
  } catch (e) { /* таблица новостей ещё не создана */ }
}
function openNotifs() {
  S.newSince = S.seenAt;
  S.seenAt = Date.now() + S.offset; saveSeen(S.seenAt);
  renderNotifs(); openModal('notifModal'); updateFriendBadges();
}

function renderNotifs() {
  const box = $('notifBody'); if (!box) return;
  const act = (icon, name, text, yes, no) => `<div class="nt"><div class="nt-ico"><i class="fas ${icon}"></i></div>
    <div class="nt-main"><b>${esc(name)}</b><span>${text}</span></div>${yes}${no}</div>`;
  const todo = [
    ...S.invites.map(i => {
      const f = S.users[i.from_id];
      return act('fa-user-group', f ? f.username : 'Игрок', 'зовёт вас в пати',
        `<button class="btn btn-ok btn-sm" data-act="party-accept" data-id="${i.id}">Принять</button>`,
        `<button class="btn btn-ghost btn-sm" data-act="party-decline" data-id="${i.id}" aria-label="Отклонить"><i class="fas fa-times"></i></button>`);
    }),
    ...S.requests.map(u => act('fa-user-plus', u.username, 'хочет дружить',
      `<button class="btn btn-ok btn-sm" data-act="friend-accept" data-id="${u.id}">Принять</button>`,
      `<button class="btn btn-ghost btn-sm" data-act="friend-decline" data-id="${u.id}" aria-label="Отклонить"><i class="fas fa-times"></i></button>`))
  ];
  const feed = feedItems().map(it => {
    const isNew = it.ts > S.newSince ? ' new' : '';
    const when = `${fmtDay(new Date(it.ts).toISOString())}, ${fmtTime(new Date(it.ts).toISOString())}`;
    if (it.kind === 'news') {
      return `<div class="nt${isNew}"><div class="nt-ico gold"><i class="fas fa-bullhorn"></i></div>
        <div class="nt-main"><b>${esc(it.n.title)}</b><span class="nt-body">${esc(it.n.text)}</span><em>Новости проекта · ${when}</em></div></div>`;
    }
    const h = it.h, win = h.result === 'win', d = h.elo_change || 0;
    const kda = h.kills != null ? `${h.kills}/${h.deaths}/${h.assists} · ` : '';
    return `<div class="nt link${isNew}" data-act="match-details" data-id="${h.id}"><div class="nt-ico ${win ? 'win' : 'lose'}"><i class="fas ${win ? 'fa-trophy' : 'fa-xmark'}"></i></div>
      <div class="nt-main"><b>${win ? 'Победа' : 'Поражение'} · ${esc(h.map || '—')}</b>
        <span>${h.score_a != null ? h.score_a + ':' + h.score_b + ' · ' : ''}${kda}<strong class="${d >= 0 ? 'p' : 'n'}">${d >= 0 ? '+' : ''}${d} ELO</strong></span><em>Результат матча · ${when}</em></div>
      <i class="fas fa-chevron-right nt-go"></i></div>`;
  });
  let html = '';
  if (todo.length) html += `<div class="nt-sec">Требуют ответа</div>${todo.join('')}`;
  if (feed.length) html += `${todo.length ? '<div class="nt-sec">Лента</div>' : ''}${feed.join('')}`;
  box.innerHTML = html || '<div class="empty"><i class="fas fa-bell-slash"></i>Уведомлений нет</div>';
}

/* ───────────── Очередь и поиск ───────────── */
async function syncQueue() {
  const st = await rpc('queue_state');
  if (!st) { saveSession(''); showAuth('Сессия истекла. Войдите снова.'); return; }
  const was = S.queue.searching;
  S.queue = { searching: !!st.searching, since: toMs(st.since), count: st.count || 0, need: st.need || S.teamSize * 2 };
  S.teamSize = Math.max(1, Math.round(S.queue.need / 2));
  if (st.now) S.offset = toMs(st.now) - Date.now();
  updateSearchUI();
  if (was && !S.queue.searching) await syncMatch(); // очередь сменилась матчем
}

function updateSearchUI() {
  if (!S.me || !$('lgElo')) return;
  const q = S.queue, u = S.me, L = levelOf(u.elo), col = lvlColor(L.lvl);
  const circ = 2 * Math.PI * 35;
  const ring = $('lgRing');
  ring.style.strokeDasharray = circ.toFixed(1);
  ring.style.strokeDashoffset = (circ * (1 - levelProgress(u.elo))).toFixed(1);
  ring.style.stroke = col;
  $('lgHex').style.setProperty('--c', col);
  setText('lgLvl', L.lvl);
  setText('lgElo', u.elo);
  $('lgBar').style.width = (levelProgress(u.elo) * 100).toFixed(1) + '%';
  setText('lgRange', L.max === Infinity ? u.elo + ' / ∞' : u.elo + ' / ' + (L.max + 1));
  setText('lgNext', L.max === Infinity ? 'макс. уровень' : (L.max + 1 - u.elo) + ' до уровня');
  const st = profileStats(u);
  setText('lgRank', '#' + (S.rank || '—'));
  setText('lgWr', (u.matches ? Math.round(u.wins / u.matches * 100) : 0) + '%');
  setText('lgKd', st.kd === null ? '—' : st.kd.toFixed(2));
  setText('searchTitle', S.teamSize + '×' + S.teamSize);
  setText('lgInGame', S.stats.in_match);
  setText('lgSearching', q.searching ? Math.max(q.count, 1) : q.count);
  setText('lgSeason', S.stats.matches);
  if (!q.searching) setText('lgWait', '—');
  $('btnCancel').hidden = !q.searching;
  const start = $('btnSearch');
  start.hidden = q.searching;
  const wait = S.party && S.party.leader !== S.me.id;
  start.disabled = !!wait;
  start.innerHTML = wait ? 'Поиск запускает лидер пати' : '<i class="fas fa-search"></i> Найти матч';
  setText('searchHint', q.searching
    ? `Ищем ${S.teamSize * 2} игроков. Не закрывайте приложение — подтверждение придёт сюда.`
    : '');
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
  if (m && m.blue && m.orange) {
    const ids = [...m.blue, ...m.orange].map(p => p.id);
    const fresh = m.id !== S.bnMatch;
    S.bnMatch = m.id;
    await loadBanners(ids, fresh);
  }
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
  $('matchTop').hidden = false;
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
  setText('confirmSub', 'Ваша сторона: ' + SIDE_NAME[mySide(m)]);
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
  const sig = JSON.stringify([m.id, ds, m.my_report, m.draft_finished_at, S.me.isadmin, [...m.blue, ...m.orange].map(p => S.banners[p.id] || '')]);
  if (!force && sig === S.sig) return;
  S.sig = sig;
  setText('mNum', 'Матч #' + (m.match_number || '—'));
  setText('mSub', S.teamSize + '×' + S.teamSize + ' · рейтинг');
  const st = $('mStatus');
  st.textContent = ds.complete ? 'Идёт игра' : 'Бан карт';
  st.className = 'pill' + (ds.complete ? ' live' : '');
  $('matchBody').innerHTML = ds.complete ? lobbyHtml(m, ds) : draftHtml(m, ds);
  $('matchTop').hidden = !ds.complete;
  $('chatPanel').hidden = !ds.complete;
  renderChat();
  $('adminMatchBar').innerHTML = (S.me.isadmin && ds.complete)
    ? `<div class="admin-bar">
        <button class="btn btn-sm btn-ghost" data-act="adm-open"><i class="fas fa-clipboard-check"></i> Результат и K/D/A</button>
        <button class="btn btn-sm btn-danger" data-act="adm-cancel" data-id="${m.id}" aria-label="Отменить матч"><i class="fas fa-times"></i></button></div>`
    : '';
}

function plHtml(p, isCap, dotColor) {
  return `<div class="pl${bnCls(S.banners[p.id])}" data-act="player" data-id="${esc(p.id)}">${avatarHtml(p, 32)}
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
  return `<div class="teams">${side(m.blue, 'blue', 'Спецназ', 'fa-shield-halved')}${side(m.orange, 'orange', 'Террористы', 'fa-fire')}</div>`;
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
    <div class="maps">${list}</div>`;
}

function lobbyHtml(m, ds) {
  const mp = mapById(ds.final);
  const host = m.blue[0] || {};
  const bg = `style="${mapBg(mp)}"`;
  const side = mySide(m);
  const other = side === 'blue' ? 'orange' : 'blue';
  const rep = m.my_report ? `<p>Ваш ответ: победил ${m.my_report === 'blue' ? 'спецназ' : 'террористы'}</p>` : '<p>Матч сыгран? Отметьте, кто победил — это поможет админу.</p>';
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
        <button class="btn btn-ok" data-act="report" data-side="${side}">Победила моя сторона</button>
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
    setText('lgWait', mmss(Math.max(0, Math.floor((now - S.queue.since) / 1000))));
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
}
function stopChat() { S.chat = []; }
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
const qual = (v, hi, mid) => (v === null ? '—' : v >= hi ? 'Высокий' : v >= mid ? 'Средний' : 'Низкий');
function profileStats(u) {
  const sm = u.stat_matches || 0;
  return {
    kd: u.deaths > 0 ? u.kills / u.deaths : (u.kills > 0 ? u.kills : null),
    avg: sm ? u.kills / sm : null,
    ast: sm ? u.assists / sm : null,
    kpr: u.rounds > 0 ? u.kills / u.rounds : null,
    sm
  };
}
const fx = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));

function achievements(u) {
  const st = profileStats(u), L = levelOf(u.elo).lvl;
  return [
    ['fa-flag-checkered', 'Первый матч', u.matches >= 1], ['fa-cube', '10 матчей', u.matches >= 10],
    ['fa-trophy', 'Первая победа', u.wins >= 1], ['fa-crown', '10 побед', u.wins >= 10],
    ['fa-fire', 'Серия из 3 побед', u.best_streak >= 3], ['fa-bolt', 'Серия из 5 побед', u.best_streak >= 5],
    ['fa-shield-halved', '5 уровень', L >= 5], ['fa-crosshairs', 'K/D от 1.5', st.kd !== null && st.kd >= 1.5 && st.sm >= 3],
    ['fa-user-group', 'Есть друзья', S.friends.length >= 1], ['fa-medal', '10 уровень', L >= 10]
  ];
}

function renderProfile() {
  const u = S.me; if (!u) return;
  const body = $('profileBody'); if (!body) return;
  const L = levelOf(u.elo), prog = levelProgress(u.elo), col = lvlColor(L.lvl);
  const st = profileStats(u);
  const wr = u.matches ? Math.round(u.wins / u.matches * 100) : 0;
  const toNext = L.max === Infinity ? 'Максимальный уровень' : `До уровня ${L.lvl + 1}: ${L.max + 1 - u.elo} ELO`;
  const ringLen = 2 * Math.PI * 34, kdFill = st.kd === null ? 0 : Math.min(1, st.kd / 3);
  const recent = S.history.slice(0, 8);
  const wlWins = recent.filter(h => h.result === 'win').length;
  const rows = S.history.slice(0, 10).map(h => {
    const win = h.result === 'win', d = h.elo_change || 0, mp = mapById(h.map);
    const kda = h.kills != null ? `${h.kills}/${h.deaths}/${h.assists}` : '';
    return `<div class="hist ${win ? 'win' : 'lose'}" data-act="match-details" data-id="${h.id}">
      <div class="map-thumb" style="width:52px;height:52px">${mapThumb(mp)}</div>
      <div class="main"><div class="t">${esc(h.map || '—')} · ${win ? 'Победа' : 'Поражение'}</div>
        <div class="s">${fmtDay(h.match_date)} · ${fmtTime(h.match_date)}${h.score_a != null ? ` · ${h.score_a}:${h.score_b}` : ''}</div></div>
      <div class="right">${kda ? `<div class="kda">${kda}</div>` : ''}<div class="elo ${d >= 0 ? 'p' : 'n'}">${d >= 0 ? '+' : ''}${d} ELO</div></div></div>`;
  }).join('') || '<div class="empty"><i class="fas fa-gamepad"></i>Матчей пока нет</div>';
  const today = new Date();

  body.innerHTML = `
    <div class="pf-banner${bnCls(S.banners[u.id])}">
      <div class="logo">BNK<span>FACEIT</span></div>
      <div class="pf-top">${avatarHtml(u, 84)}
        <div class="pf-id"><div class="no">#${S.rank || '—'}</div>
          <div class="name">${esc(u.username)}${u.isadmin ? ' <i class="fas fa-crown" style="color:var(--gold);font-size:15px"></i>' : ''}</div>
          <div class="gid">ID: ${esc(u.game_id || '—')}</div></div></div>
      <div class="chips"><span class="chip">LVL ${L.lvl}</span>${u.isadmin ? '<span class="chip pr"><i class="fas fa-crown"></i> ADMIN</span>' : ''}<span class="chip">${u.elo} ELO</span></div>
      <div class="dt">${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3><i class="fas fa-chart-simple"></i> Статистика</h3><span class="pill-soft">${toNext}</span></div>
      <div class="kd-card">
        <div class="ring-kd"><svg viewBox="0 0 80 80"><circle class="t" cx="40" cy="40" r="34"/><circle class="b" cx="40" cy="40" r="34" stroke-dasharray="${ringLen.toFixed(1)}" stroke-dashoffset="${(ringLen * (1 - kdFill)).toFixed(1)}"/></svg><b>${fx(st.kd)}</b></div>
        <div><div class="k">Kill / Deaths</div><div class="v">K = ${u.kills} &nbsp; D = ${u.deaths}</div></div>
      </div>
      <div class="lvl-card">
        <div class="main"><div class="lbl">LEVEL</div>
          <div class="rng"><small>${L.min}</small><b>${u.elo}</b><small>${L.max === Infinity ? '∞' : L.max + 1}</small></div>
          <div class="bar"><i style="width:${(prog * 100).toFixed(1)}%"></i></div></div>
        <div class="hex" style="--c:${col}"><span>${L.lvl}</span></div>
      </div>
      <div class="tiles">
        <div class="tile"><div class="k">WINRATE</div><div class="v">${wr}%</div><div class="bar"><i style="width:${wr}%"></i></div><div class="q">${u.matches ? qual(wr, 55, 45) : '—'}</div></div>
        <div class="tile"><div class="k">K/D</div><div class="v">${fx(st.kd)}</div><div class="bar"><i style="width:${st.kd === null ? 0 : Math.min(100, st.kd / 2 * 100)}%"></i></div><div class="q">${qual(st.kd, 1.2, 0.9)}</div></div>
        <div class="tile"><div class="k">AVG</div><div class="v">${fx(st.avg, 1)}</div><div class="bar"><i style="width:${st.avg === null ? 0 : Math.min(100, st.avg / 25 * 100)}%"></i></div><div class="q">${qual(st.avg, 15, 10)}</div></div>
        <div class="tile"><div class="k">KPR</div><div class="v">${fx(st.kpr)}</div><div class="bar"><i style="width:${st.kpr === null ? 0 : Math.min(100, st.kpr / 1.2 * 100)}%"></i></div><div class="q">${qual(st.kpr, 0.75, 0.55)}</div></div>
      </div>
      <div class="pf-foot"><span>Ассисты <b>${fx(st.ast, 1)}</b>/матч</span><span>по ${st.sm} матч.</span></div>
    </div>

    <div class="panel">
      <div class="stat-grid">
        <div class="stat"><div class="k">Игр</div><div class="v">${u.matches}</div></div>
        <div class="stat"><div class="k">Победы</div><div class="v g">${u.wins}</div></div>
        <div class="stat"><div class="k">Поражения</div><div class="v r">${u.losses}</div></div></div>
      <div class="stat-grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px">
        <div class="stat"><div class="k">Лучшая серия</div><div class="v">${u.best_streak}</div></div>
        <div class="stat"><div class="k">Оценок</div><div class="v">${u.likes}</div></div>
        <div class="stat"><div class="k">Популярность</div><div class="v">${u.popularity}</div></div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3><i class="fas fa-chart-line"></i> Динамика ELO</h3><span class="pill-soft" id="chartDelta">—</span></div>
      <div class="chart-top"><div><span class="big num" id="chartElo">${u.elo}</span></div><div class="date" id="chartDate"></div></div>
      <div class="chart" id="eloChart"></div>
      <div class="chart-mm"><span>мин <b id="chartMin">—</b></span><span>макс <b id="chartMax">—</b></span></div>
      <div class="dots" id="chartDots"></div>
    </div>

    <div class="panel"><div class="panel-head"><h3>Последние матчи</h3><span class="pill-soft">${recent.length ? Math.round(wlWins / recent.length * 100) + '% W' : '—'}</span></div>
      <div class="wl">${recent.map(h => `<i class="${h.result === 'win' ? 'w' : 'l'}">${h.result === 'win' ? 'W' : 'L'}</i>`).join('')}</div>
      ${u.win_streak > 0 ? `<div class="series">Серия: <b>${u.win_streak} ${u.win_streak === 1 ? 'победа' : 'побед'} подряд</b></div>` : ''}
      ${rows}</div>
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
  const W = box.clientWidth || 320, H = 120, padX = 8, padT = 10, padB = 10;
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  const xs = pts.map((_, i) => padX + (W - 2 * padX) * (i / (pts.length - 1)));
  const ys = pts.map(v => padT + (H - padT - padB) * (1 - (v - min) / range));
  const line = xs.map((x, i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ');
  const area = `${line} L${xs[xs.length - 1].toFixed(1)} ${H - padB} L${xs[0].toFixed(1)} ${H - padB} Z`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs><linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f472b6" stop-opacity=".45"/><stop offset="1" stop-color="#f472b6" stop-opacity="0"/></linearGradient></defs>
    <path class="area" fill="url(#eloGrad)" d="${area}"/><path class="line" style="stroke:#f9a8d4;filter:drop-shadow(0 0 6px rgba(244,114,182,.6))" d="${line}"/>
    <line class="cursor" id="cLine" x1="0" x2="0" y1="0" y2="${H - padB}"/><circle class="dot" id="cDot" r="5" cx="0" cy="0" style="stroke:#f9a8d4"/></svg>`;
  const delta = $('chartDelta');
  delta.textContent = (total >= 0 ? '+' : '') + total + ' за ' + rows.length + ' матч.';
  setText('chartMin', min); setText('chartMax', max);
  $('chartDots').innerHTML = rows.slice(-10).map((r, i) => `<i class="${r.result === 'win' ? 'w' : 'l'}">${i + 1}</i>`).join('');
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
  closeModal('notifModal');
  navigate('matchview');
  const body = $('matchViewBody');
  body.innerHTML = '<div class="empty">Загрузка…</div>';
  const { data: h } = await sb.from('match_history').select('*').eq('id', d.id).maybeSingle();
  if (!h) { body.innerHTML = '<div class="empty">Матч не найден</div>'; return; }
  const win = h.result === 'win', delta = h.elo_change || 0, mp = mapById(h.map);
  const blue = h.team_blue || [], orange = h.team_orange || [];
  const all = [...blue, ...orange];
  await loadBanners(all.map(p => p.id));
  const hasStats = all.some(p => p.kills != null);
  const best = hasStats ? all.reduce((a, b) => ((b.kills || 0) > ((a && a.kills) || 0) ? b : a), null) : null;
  const kdOf = p => (p.kills == null ? '—' : ((p.deaths > 0 ? p.kills / p.deaths : p.kills)).toFixed(2));
  const team = (list, cls, label, icon, isWin) => {
    const sorted = hasStats ? list.slice().sort((a, b) => (b.kills || 0) - (a.kills || 0)) : list;
    const tk = list.reduce((n, p) => n + (p.kills || 0), 0);
    const td = list.reduce((n, p) => n + (p.deaths || 0), 0);
    const ta = list.reduce((n, p) => n + (p.assists || 0), 0);
    const rows = sorted.map(p => {
      const c = p.elo_change, me = p.id === S.me.id, mvp = best && best.id === p.id && (p.kills || 0) > 0;
      return `<div class="mv-pl${bnCls(S.banners[p.id])} ${me ? 'me' : ''}" data-act="player" data-id="${esc(p.id)}">
        <div class="mv-top">${avatarHtml(p, 36)}
          <div class="mv-nm"><div class="n">${esc(p.username)}${mvp ? ' <i class="fas fa-star mv-star" title="Лучший по киллам"></i>' : ''}${me ? ' <span class="mv-you">вы</span>' : ''}</div>
            <div class="s">ELO ${p.elo ?? 300}</div></div>
          ${c != null ? `<div class="mv-elo ${c >= 0 ? 'p' : 'n'}">${c >= 0 ? '+' : ''}${c}</div>` : ''}${lvlChip(p.elo)}</div>
        ${hasStats ? `<div class="mv-stats">
          <div><b>${p.kills ?? 0}</b><span>Убийств</span></div>
          <div><b>${p.deaths ?? 0}</b><span>Смертей</span></div>
          <div><b>${p.assists ?? 0}</b><span>Ассистов</span></div>
          <div><b>${kdOf(p)}</b><span>K/D</span></div></div>` : ''}</div>`;
    }).join('') || '<div class="empty" style="padding:12px">Пусто</div>';
    return `<div class="team ${cls} mv-team ${isWin ? 'win' : ''}">
      <div class="team-head"><i class="fas ${icon}"></i>${label}${isWin ? ' <span class="mv-trophy">🏆 победа</span>' : ''}
        ${hasStats ? `<span class="mv-sum">${tk} / ${td} / ${ta}</span>` : ''}</div>${rows}</div>`;
  };
  const mine = blue.some(p => p.id === S.me.id) ? 'blue' : (orange.some(p => p.id === S.me.id) ? 'orange' : null);
  $('matchViewBody').innerHTML = `
    <div class="match-top">
      <button class="icon-btn" data-act="nav" data-page="profile" aria-label="Назад"><i class="fas fa-chevron-left"></i></button>
      <div class="ttl"><b>Матч${h.match_number ? ' #' + h.match_number : ''}</b><span>${fmtDay(h.match_date)}, ${fmtTime(h.match_date)} · рейтинг</span></div>
      <span class="pill ${win ? '' : 'live'}">${win ? 'Победа' : 'Поражение'}</span>
    </div>
    <div class="lobby-hero"><div class="bg" style="${mapBg(mp)}"></div><div class="in">
      <div class="cap">Сыгранная карта</div><div class="map">${esc(mp.name)}</div>
      <div class="host mv-host">
        ${h.score_a != null ? `<div class="mv-score"><span class="${h.winner === 'blue' ? 'w' : ''}">${h.score_a}</span><i>:</i><span class="${h.winner === 'orange' ? 'w' : ''}">${h.score_b}</span></div>` : '<div class="meta"><div class="lbl">Счёт</div><div class="val">не указан</div></div>'}
        <div class="gid"><div class="lbl">Ваше ELO</div><div class="val" style="color:${delta >= 0 ? 'var(--win)' : '#ff8fa3'}">${delta >= 0 ? '+' : ''}${delta}</div></div>
      </div></div></div>
    ${team(blue, 'blue', 'Спецназ', 'fa-shield-halved', h.winner === 'blue')}
    ${team(orange, 'orange', 'Террористы', 'fa-fire', h.winner === 'orange')}
    ${hasStats ? '' : '<div class="panel"><div class="empty" style="padding:6px">Подробная статистика по этому матчу не вводилась админом</div></div>'}
    <button class="btn btn-ghost btn-block" data-act="sup-from-match" data-id="${h.id}"><i class="fas fa-headset"></i> Сообщить о проблеме с матчем</button>`;
  window.scrollTo({ top: 0 });
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
      <div class="stat"><div class="k">K/D</div><div class="v">${fx(profileStats(u).kd)}</div></div>
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
  const total = n + unreadFeed();
  const hb = $('hdBadge'); hb.hidden = total === 0; hb.textContent = total > 9 ? '9+' : total;
  if ($('notifModal').classList.contains('active')) renderNotifs();
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
  await loadBanners(data.map(u => u.id), true);
  box.innerHTML = '<div class="rows">' + data.map((u, i) => {
    const wr = u.matches ? Math.round(u.wins / u.matches * 100) : 0;
    const n = i + 1;
    return `<div class="row link${bnCls(S.banners[u.id])} ${u.id === S.me.id ? 'me' : ''}" data-act="player" data-id="${u.id}">
      <div class="top-rank ${n <= 3 ? 'r' + n : ''}">#${n}</div>${avatarHtml(u, 40)}
      <div class="row-main"><div class="row-title">${esc(u.username)} ${u.isadmin ? '👑' : ''}</div><div class="row-sub">${u.matches} матчей · ${wr}%</div></div>
      ${lvlChip(u.elo)}<div class="top-elo">${u.elo}<small>ELO</small></div></div>`;
  }).join('') + '</div>';
}

/* ───────────── Баннеры профиля (оригинальные аниме-арты, нарисованы кодом) ───────────── */
/* Свои баннеры: положите картинки banners/bn_sakura.jpg, bn_neon.jpg, bn_stars.jpg, bn_sunset.jpg, bn_magic.jpg, bn_sky.jpg
   рядом с index.html. Если файла нет, показывается нарисованный кодом баннер. */
const BANNER_IDS = ['bn_sakura', 'bn_neon', 'bn_stars', 'bn_sunset', 'bn_magic', 'bn_sky'];
function rng(seed) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
const svgWrap = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
const f1 = n => n.toFixed(1);
const BANNER_ART = {
  bn_sakura() {
    const r = rng(7); let bl = '', pe = '';
    [[40, 56], [96, 66], [150, 46], [205, 80], [262, 70], [320, 48], [120, 36], [236, 56], [14, 34], [176, 62], [290, 92]].forEach(([x, y]) => {
      for (let i = 0; i < 7; i++) bl += `<circle cx="${f1(x + r() * 38 - 19)}" cy="${f1(y + r() * 30 - 15)}" r="${f1(4.5 + r() * 6)}" fill="${['#ffc9e2', '#ff9ccb', '#ffe6f1'][i % 3]}" opacity="${(.7 + r() * .3).toFixed(2)}"/>`;
    });
    for (let i = 0; i < 30; i++) {
      const x = r() * 600, y = 40 + r() * 170;
      pe += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="3.2" ry="1.7" fill="#ffd3e6" opacity="${(.35 + r() * .5).toFixed(2)}" transform="rotate(${Math.round(r() * 180)} ${f1(x)} ${f1(y)})"/>`;
    }
    return svgWrap(
      '<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d1f6e"/><stop offset=".5" stop-color="#c85fae"/><stop offset="1" stop-color="#ffc7a2"/></linearGradient><radialGradient id="m"><stop offset="0" stop-color="#fff6e0" stop-opacity=".9"/><stop offset="1" stop-color="#fff6e0" stop-opacity="0"/></radialGradient>',
      `<rect width="600" height="220" fill="url(#a)"/><circle cx="450" cy="92" r="84" fill="url(#m)"/><circle cx="450" cy="92" r="34" fill="#fff4dc"/>
       <path d="M0 168C90 138 150 162 230 150S390 128 460 150 560 140 600 134V220H0Z" fill="#5a3a8e" opacity=".85"/>
       <path d="M0 192C100 166 190 188 290 174S480 166 600 182V220H0Z" fill="#26164f"/>
       <path d="M-10 36C60 56 120 40 190 80S300 74 340 40" stroke="#3a1c40" stroke-width="5" fill="none" stroke-linecap="round"/>
       <path d="M110 58C130 70 150 64 170 90" stroke="#3a1c40" stroke-width="3" fill="none"/>${bl}${pe}`);
  },
  bn_neon() {
    const r = rng(21); let b = '', w = '', rain = '', x = -10;
    while (x < 610) {
      const bw = 26 + r() * 40, bh = 55 + r() * 105, y = 220 - bh;
      b += `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(bw)}" height="${Math.round(bh)}" fill="#0a0822"/>`;
      for (let wy = y + 8; wy < 210; wy += 12) for (let wx = x + 5; wx < x + bw - 7; wx += 9)
        if (r() < .3) w += `<rect x="${Math.round(wx)}" y="${Math.round(wy)}" width="4" height="6" fill="${r() < .5 ? '#ffd86b' : '#6fe7ff'}" opacity=".85"/>`;
      x += bw + 2;
    }
    for (let i = 0; i < 40; i++) { const rx = r() * 600, ry = r() * 200; rain += `<line x1="${Math.round(rx)}" y1="${Math.round(ry)}" x2="${Math.round(rx - 6)}" y2="${Math.round(ry + 22)}"/>`; }
    return svgWrap(
      '<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0830"/><stop offset=".55" stop-color="#3a1a78"/><stop offset="1" stop-color="#ff4d9a"/></linearGradient><radialGradient id="m"><stop offset="0" stop-color="#ff7ac8" stop-opacity=".8"/><stop offset="1" stop-color="#ff7ac8" stop-opacity="0"/></radialGradient><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
      `<rect width="600" height="220" fill="url(#a)"/><circle cx="470" cy="62" r="70" fill="url(#m)"/><circle cx="470" cy="62" r="30" fill="#ffd0ec"/>${b}${w}
       <g filter="url(#g)" stroke-width="3" fill="none" stroke-linecap="round"><path d="M300 96h52" stroke="#00e5ff"/><path d="M96 70v44h26" stroke="#ff3d8b"/><rect x="396" y="112" width="40" height="16" stroke="#b388ff"/></g>
       <g stroke="rgba(190,220,255,.28)" stroke-width="1">${rain}</g>`);
  },
  bn_stars() {
    const r = rng(33); let st = '';
    for (let i = 0; i < 110; i++) st += `<circle cx="${Math.round(r() * 600)}" cy="${Math.round(r() * 150)}" r="${f1(.4 + r() * 1.3)}" fill="#fff" opacity="${(.3 + r() * .7).toFixed(2)}"/>`;
    return svgWrap(
      '<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#040824"/><stop offset=".6" stop-color="#1a2c78"/><stop offset="1" stop-color="#7a5bc0"/></linearGradient><radialGradient id="m"><stop offset="0" stop-color="#fff6d6" stop-opacity=".6"/><stop offset="1" stop-color="#fff6d6" stop-opacity="0"/></radialGradient><linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient><filter id="bl"><feGaussianBlur stdDeviation="14"/></filter><mask id="c" maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="220"><rect width="600" height="220" fill="#fff"/><circle cx="458" cy="48" r="25" fill="#000"/></mask>',
      `<rect width="600" height="220" fill="url(#a)"/>
       <g filter="url(#bl)"><ellipse cx="200" cy="120" rx="170" ry="26" fill="#3de0b0" opacity=".28"/><ellipse cx="380" cy="100" rx="150" ry="20" fill="#9b6bff" opacity=".28"/></g>
       ${st}<circle cx="446" cy="56" r="64" fill="url(#m)"/><circle cx="446" cy="56" r="28" fill="#fff6d6" mask="url(#c)"/>
       <g stroke="url(#t)" stroke-width="2" stroke-linecap="round"><line x1="250" y1="28" x2="330" y2="58"/><line x1="130" y1="70" x2="190" y2="92"/></g>
       <path d="M0 200L70 140 110 168 180 108 250 176 320 130 400 182 470 120 540 170 600 140V220H0Z" fill="#0b1140"/>
       <path d="M180 108l-12 14 12-4 10 6zM470 120l-11 13 11-4 9 6z" fill="#cfd8ff" opacity=".7"/>
       <path d="M0 220V192C80 172 160 202 260 188S460 178 600 198V220Z" fill="#060a28"/>`);
  },
  bn_sunset() {
    const r = rng(5); let cl = '', rf = '';
    for (let i = 0; i < 7; i++) cl += `<ellipse cx="${Math.round(r() * 600)}" cy="${Math.round(30 + r() * 70)}" rx="${Math.round(50 + r() * 70)}" ry="${Math.round(5 + r() * 6)}" fill="#ffb3a0" opacity="${(.3 + r() * .35).toFixed(2)}"/>`;
    for (let i = 0; i < 8; i++) rf += `<rect x="${Math.round(360 - (60 - i * 6) / 2 * 2 / 2 - (46 - i * 4))}" y="${156 + i * 8}" width="${Math.round((46 - i * 4) * 2)}" height="3" fill="#ffe3b0" opacity="${(.7 - i * .07).toFixed(2)}"/>`;
    const torii = '<rect x="-26" y="88" width="7" height="62"/><rect x="19" y="88" width="7" height="62"/><path d="M-42 84Q0 94 42 84L40 93Q0 103-40 93Z"/><rect x="-30" y="104" width="60" height="5"/><rect x="-3" y="94" width="6" height="12"/>';
    return svgWrap(
      '<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1055"/><stop offset=".45" stop-color="#d4418e"/><stop offset=".8" stop-color="#ff9a56"/><stop offset="1" stop-color="#ffd29b"/></linearGradient><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8325e"/><stop offset="1" stop-color="#2a1050"/></linearGradient><radialGradient id="m"><stop offset="0" stop-color="#fff2c6" stop-opacity=".85"/><stop offset="1" stop-color="#fff2c6" stop-opacity="0"/></radialGradient>',
      `<rect width="600" height="150" fill="url(#a)"/><circle cx="360" cy="136" r="96" fill="url(#m)"/><circle cx="360" cy="136" r="46" fill="#fff2c6"/>${cl}
       <path d="M0 150L60 118 120 142 200 108 270 146 560 132 600 150Z" fill="#6b2d74" opacity=".75"/>
       <rect y="150" width="600" height="70" fill="url(#w)"/>${rf}
       <g fill="#1b0c33" transform="translate(480 0)">${torii}</g>
       <g fill="#1b0c33" opacity=".3" transform="translate(480 300) scale(1 -1)">${torii}</g>`);
  },
  bn_magic() {
    const r = rng(9), cx = 450, cy = 110; let tk = '', pt = '';
    const pol = (a, rad) => `${f1(cx + rad * Math.cos(a))},${f1(cy + rad * Math.sin(a))}`;
    const tri = off => [0, 1, 2].map(i => pol(off + i * 2 * Math.PI / 3, 58)).join(' ');
    for (let i = 0; i < 36; i++) { const a = i * Math.PI / 18; tk += `<line x1="${f1(cx + 88 * Math.cos(a))}" y1="${f1(cy + 88 * Math.sin(a))}" x2="${f1(cx + 96 * Math.cos(a))}" y2="${f1(cy + 96 * Math.sin(a))}"/>`; }
    for (let i = 0; i < 42; i++) pt += `<circle cx="${Math.round(r() * 600)}" cy="${Math.round(r() * 220)}" r="${f1(.8 + r() * 1.8)}" fill="${r() < .5 ? '#8fd0ff' : '#ff8ad0'}" opacity="${(.3 + r() * .6).toFixed(2)}"/>`;
    return svgWrap(
      '<radialGradient id="a" cx=".75" cy=".5" r=".8"><stop offset="0" stop-color="#3b1a8a"/><stop offset=".6" stop-color="#0d0638"/><stop offset="1" stop-color="#04031a"/></radialGradient><radialGradient id="p" cx=".1" cy=".95" r=".6"><stop offset="0" stop-color="#ec4899" stop-opacity=".45"/><stop offset="1" stop-color="#ec4899" stop-opacity="0"/></radialGradient><filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
      `<rect width="600" height="220" fill="url(#a)"/><rect width="600" height="220" fill="url(#p)"/>
       <g opacity=".22" fill="#8fd0ff"><polygon points="${cx - 10},0 ${cx + 10},0 ${cx + 60},220 ${cx - 60},220"/></g>${pt}
       <g filter="url(#g)" fill="none" stroke-linejoin="round"><circle cx="${cx}" cy="${cy}" r="88" stroke="#8fd0ff" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="74" stroke="#ec4899" stroke-width="1.4" stroke-dasharray="4 6"/><circle cx="${cx}" cy="${cy}" r="58" stroke="#8fd0ff" stroke-width="1.2"/>
       <polygon points="${tri(-Math.PI / 2)}" stroke="#ff8ad0" stroke-width="1.6"/><polygon points="${tri(Math.PI / 2)}" stroke="#8fd0ff" stroke-width="1.6"/>
       <circle cx="${cx}" cy="${cy}" r="14" stroke="#fff" stroke-width="1.4"/><g stroke="#8fd0ff" stroke-width="1.4">${tk}</g></g>`);
  },
  bn_sky() {
    const cs = [[0, 0, 26], [28, -8, 32], [62, 0, 26], [90, 6, 20], [-26, 8, 20]].map(([x, y, rad]) => `<circle cx="${x}" cy="${y}" r="${rad}"/>`).join('');
    const cloud = (x, y, k) => `<g transform="translate(${x} ${y}) scale(${k})"><g fill="#b9d6ff" transform="translate(0 7)">${cs}</g><g fill="#fff">${cs}</g></g>`;
    let rays = '';
    for (let i = 0; i < 14; i++) { const a = i * Math.PI / 7; rays += `<line x1="${f1(520 + 40 * Math.cos(a))}" y1="${f1(30 + 40 * Math.sin(a))}" x2="${f1(520 + 120 * Math.cos(a))}" y2="${f1(30 + 120 * Math.sin(a))}"/>`; }
    return svgWrap(
      '<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a80ff"/><stop offset=".6" stop-color="#6fb8ff"/><stop offset="1" stop-color="#cdeaff"/></linearGradient><radialGradient id="m"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
      `<rect width="600" height="220" fill="url(#a)"/><circle cx="520" cy="30" r="110" fill="url(#m)"/><g stroke="#fff" stroke-width="2" opacity=".25">${rays}</g><circle cx="520" cy="30" r="22" fill="#fff"/>
       ${cloud(250, 78, .8)}${cloud(60, 64, .6)}${cloud(120, 176, 1.8)}${cloud(340, 192, 2.2)}${cloud(540, 168, 1.6)}
       <g fill="none" stroke="#1d2f66" stroke-width="1.6" stroke-linecap="round"><path d="M180 40q6-6 12 0q6-6 12 0"/><path d="M210 58q5-5 10 0q5-5 10 0"/><path d="M420 90q4-4 8 0q4-4 8 0"/></g>`);
  }
};
const bnCls = id => (id && BANNER_ART[id] ? ' bn bn-' + id : '');
function injectBannerStyles() {
  const css = BANNER_IDS.map(id => {
    const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(BANNER_ART[id]());
    return `.bn-${id}{background-image:linear-gradient(90deg,rgba(7,11,28,.76),rgba(7,11,28,.2)),url("banners/${id}.jpg"),url("${uri}")!important;background-size:cover!important;background-position:center!important}`;
  }).join('\n');
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}
async function loadBanners(ids, force) {
  const need = [...new Set(ids)].filter(id => force || !(id in S.banners));
  if (!need.length) return;
  try {
    const map = (await rpc('banners_for', { p_ids: need })) || {};
    need.forEach(id => { S.banners[id] = map[id] || ''; });
  } catch (e) { need.forEach(id => { S.banners[id] = ''; }); /* баннеры ещё не подключены на сервере */ }
}
async function loadMyBanners() {
  try {
    const r = await rpc('my_banners');
    S.myBanners = { owned: (r && r.owned) || [], active: (r && r.active) || '' };
    S.banners[S.me.id] = S.myBanners.active;
  } catch (e) { /* баннеры ещё не подключены на сервере */ }
}
function bannersPanelHtml(u) {
  const owned = S.myBanners.owned, active = S.myBanners.active;
  return `<div class="panel"><div class="panel-head"><h3>Баннеры</h3><span class="aside">${CFG.bannerPrice} ₽ за баннер</span></div>
    <div class="banners">${BANNER_IDS.map(id => {
      const isOwned = owned.includes(id), isActive = active === id;
      const btn = isActive ? '<button class="btn btn-ghost btn-sm" data-act="banner-use" data-id="">Снять</button>'
        : isOwned ? `<button class="btn btn-ghost btn-sm" data-act="banner-use" data-id="${id}">Надеть</button>`
        : `<button class="btn btn-primary btn-sm" data-act="banner-buy" data-id="${id}">Купить</button>`;
      return `<div class="bn-card ${isActive ? 'active' : isOwned ? 'owned' : ''}"><div class="bn-prev bn bn-${id}">${avatarHtml(u, 34)}<b>${esc(u.username)}</b></div>
        <div class="bn-foot"><span class="pr">${isOwned ? 'Куплен' : CFG.bannerPrice + ' ₽'}</span>${btn}</div></div>`;
    }).join('')}</div></div>`;
}
async function buyBanner(d) {
  const ok = await dialog({ title: 'Купить баннер?', text: CFG.bannerPrice + ' ₽ спишется с баланса.', ok: 'Купить' });
  if (!ok) return;
  await rpc('buy_banner', { p_banner: d.id });
  await refreshMe(); await loadMyBanners();
  toast('success', 'Куплено', 'Баннер надет');
  renderShop();
}
async function useBanner(d) {
  await rpc('use_banner', { p_banner: d.id || '' });
  await loadMyBanners();
  renderShop();
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
          <div class="row-sub">JPG, PNG или WEBP</div>
          ${u.avatar_url ? '<button class="btn btn-danger btn-sm btn-block" data-act="avatar-remove"><i class="fas fa-trash"></i> Удалить</button>' : ''}</div></div></div>
    <div class="panel"><div class="panel-head"><h3>Рамки</h3><span class="aside">${CFG.framePrice} ₽ за рамку</span></div>
      <div class="frames">${FRAMES.map(f => {
        const isOwned = owned.includes(f.id), isActive = active === f.id;
        const btn = isActive ? `<button class="btn btn-ghost btn-sm btn-block" data-act="frame-use" data-id="">Снять</button>`
          : isOwned ? `<button class="btn btn-ghost btn-sm btn-block" data-act="frame-use" data-id="${f.id}">Надеть</button>`
          : `<button class="btn btn-primary btn-sm btn-block" data-act="frame-buy" data-id="${f.id}">Купить</button>`;
        return `<div class="frame ${isActive ? 'active' : isOwned ? 'owned' : ''}">${avatarHtml({ username: u.username, avatar_url: u.avatar_url, avatar_frame: f.id }, 60)}
          <div class="nm">${f.name}</div><div class="pr">${isOwned ? 'Куплена' : CFG.framePrice + ' ₽'}</div>${btn}</div>`;
      }).join('')}</div></div>
    ${bannersPanelHtml(u)}`;
}

function resizeToDataUrl(file, size = 128) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const side = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать картинку')); };
    img.src = url;
  });
}
async function uploadAvatar(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('error', 'Неверный формат', 'Нужен JPG, PNG или WEBP');
  if (file.size > 8 * 1024 * 1024) return toast('error', 'Файл слишком большой', 'Максимум 8 МБ');
  toast('info', 'Загружаем…', '');
  const dataUrl = await resizeToDataUrl(file);
  await rpc('set_avatar', { p_url: dataUrl });
  S.me.avatar_url = dataUrl;
  toast('success', 'Аватар обновлён', '');
  renderShop();
}
async function removeAvatar() {
  const ok = await dialog({ title: 'Удалить аватар?', ok: 'Удалить', danger: true });
  if (!ok) return;
  await rpc('set_avatar', { p_url: '' });
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

/* ───────────── Поддержка ───────────── */
const SUPPORT_CATS = [
  { id: 'player', icon: 'fa-user-slash', title: 'Жалоба на игрока', sub: 'Читы, оскорбления, слив матча', color: '#ff4d6d', needTarget: true },
  { id: 'result', icon: 'fa-flag-checkered', title: 'Неверный результат', sub: 'Победу или поражение засчитали не так', color: '#f5c451', needMatch: true },
  { id: 'map', icon: 'fa-map-location-dot', title: 'Неверная карта', sub: 'Карта или сторона записаны неправильно', color: '#38bdf8', needMatch: true },
  { id: 'stats', icon: 'fa-chart-simple', title: 'Ошибка в статистике', sub: 'K/D/A или ELO посчитаны неверно', color: '#a78bfa', needMatch: true },
  { id: 'wallet', icon: 'fa-wallet', title: 'Кошелёк и промокоды', sub: 'Баланс, рамки, промокод не работает', color: '#3ddc97' },
  { id: 'bug', icon: 'fa-bug', title: 'Ошибка в приложении', sub: 'Что-то не работает или зависает', color: '#fb923c' },
  { id: 'other', icon: 'fa-circle-question', title: 'Другое', sub: 'Любой другой вопрос к администрации', color: '#8fd0ff' }
];
const SUPPORT_HINTS = {
  player: 'Что именно сделал игрок? Опишите нарушение и момент в матче.',
  result: 'Кто на самом деле победил и почему результат неверный?',
  map: 'Какая карта была выбрана и какая записана в матче?',
  stats: 'Что посчитано неверно: убийства, смерти, ассисты или ELO?',
  wallet: 'Что случилось с балансом, рамкой или промокодом?',
  bug: 'Что вы делали и что пошло не так? На каком экране?',
  other: 'Опишите ваш вопрос.'
};
const TICKET_ST = { open: ['Открыто', 'info'], progress: ['В работе', 'warn'], resolved: ['Решено', 'ok'], rejected: ['Отклонено', ''] };
const catOf = id => SUPPORT_CATS.find(c => c.id === id) || SUPPORT_CATS[SUPPORT_CATS.length - 1];

function newSup() {
  return { view: 'home', cat: null, target: null, match: null, matchFull: null, text: '', q: '', results: [], tickets: [], err: '' };
}

async function loadTickets() {
  try { S.sup.tickets = (await rpc('my_tickets')) || []; S.sup.err = ''; }
  catch (e) { S.sup.tickets = []; S.sup.err = errText(e); }
}

async function ensureMatchFull() {
  const sp = S.sup;
  if (!sp.match || sp.matchFull) return;
  const id = sp.match.id;
  const { data } = await sb.from('match_history').select('id,team_blue,team_orange').eq('id', id).maybeSingle();
  if (sp.match && String(sp.match.id) === String(id)) { sp.matchFull = data || null; if (S.page === 'support' && sp.view === 'form') renderSupport(); }
}
const supMatchPlayers = () => {
  const f = S.sup.matchFull;
  return f ? [...(f.team_blue || []), ...(f.team_orange || [])].filter(p => p.id !== S.me.id) : [];
};

function supValid() {
  const sp = S.sup, c = catOf(sp.cat), t = sp.text.trim();
  if (t.length < 10 || t.length > 500) return false;
  if (c.needTarget && !sp.target) return false;
  if (c.needMatch && !sp.match) return false;
  return true;
}
function updateSupportSubmit() {
  const b = $('supSubmit'); if (b) b.disabled = !supValid();
  setText('supCount', S.sup.text.length + ' / 500');
}

function supportHomeHtml() {
  const sp = S.sup;
  const cards = SUPPORT_CATS.map(c => `<button class="sp-card" type="button" style="--c:${c.color}" data-act="sup-pick" data-id="${c.id}">
    <span class="sp-ico"><i class="fas ${c.icon}"></i></span><span class="sp-t">${c.title}</span><span class="sp-s">${c.sub}</span></button>`).join('');
  const tickets = sp.tickets.map(tk => {
    const c = catOf(tk.category), st = TICKET_ST[tk.status] || TICKET_ST.open;
    return `<div class="tk" style="--c:${c.color}">
      <div class="tk-top"><span class="sp-ico sm"><i class="fas ${c.icon}"></i></span>
        <div class="tk-main"><b>${c.title}</b><span>${fmtDay(tk.created_at)}, ${fmtTime(tk.created_at)}${tk.match_number ? ' · матч #' + tk.match_number : ''}${tk.target_name ? ' · на ' + esc(tk.target_name) : ''}</span></div>
        <span class="badge ${st[1]}">${st[0]}</span></div>
      <div class="tk-text">${esc(tk.text)}</div>
      ${tk.admin_reply ? `<div class="tk-reply"><i class="fas fa-headset"></i><div><b>Ответ поддержки</b><span>${esc(tk.admin_reply)}</span></div></div>` : ''}</div>`;
  }).join('');
  const body = sp.err
    ? `<div class="empty"><i class="fas fa-triangle-exclamation"></i>Не удалось загрузить обращения.<br><span style="font-size:12px">${esc(sp.err)}</span></div>`
    : (tickets || '<div class="empty"><i class="fas fa-inbox"></i>Обращений пока нет</div>');
  return `<div class="sp-hero"><div class="sp-hero-ico"><i class="fas fa-headset"></i></div>
      <div><h2>Центр поддержки</h2><p>Выберите, с чем нужна помощь. Администрация рассмотрит обращение, ответ появится здесь.</p></div></div>
    <h3 class="lg-label">С чем нужна помощь</h3>
    <div class="sp-grid">${cards}</div>
    <div class="panel" style="margin-top:18px"><div class="panel-head"><h3>Мои обращения</h3><span class="aside">${sp.tickets.length}</span></div>${body}</div>`;
}

function supResultsHtml() {
  const list = S.sup.results;
  if (!S.sup.q.trim()) return '';
  if (!list.length) return '<div class="empty" style="padding:12px">Никого не нашли</div>';
  return '<div class="rows">' + list.map(u => `<div class="row link" data-act="sup-target" data-id="${esc(u.id)}">${avatarHtml(u, 34)}
    <div class="row-main"><div class="row-title">${esc(u.username)}</div><div class="row-sub">ELO ${u.elo ?? '—'}</div></div></div>`).join('') + '</div>';
}

function supportFormHtml() {
  const sp = S.sup, c = catOf(sp.cat);
  let h = `<div class="sp-back"><button class="icon-btn" type="button" data-act="sup-back" aria-label="Назад"><i class="fas fa-chevron-left"></i></button>
    <div class="sp-cat" style="--c:${c.color}"><span class="sp-ico sm"><i class="fas ${c.icon}"></i></span><div><b>${c.title}</b><span>${c.sub}</span></div></div></div>`;

  if (c.needTarget) {
    let inner;
    if (sp.target) {
      inner = `<div class="sp-sel">${avatarHtml(sp.target, 40)}<div class="row-main"><div class="row-title">${esc(sp.target.username)}</div>
        <div class="row-sub">ELO ${sp.target.elo ?? '—'}</div></div><button class="btn btn-ghost btn-sm" type="button" data-act="sup-target-clear">Сменить</button></div>`;
    } else {
      const mp = supMatchPlayers();
      inner = `${mp.length ? `<div class="sp-quick"><span>Игроки из выбранного матча</span><div class="sp-chips">${mp.map(p => `<button class="sp-chip" type="button" data-act="sup-target" data-id="${esc(p.id)}">${avatarHtml(p, 22)}${esc(p.username)}</button>`).join('')}</div></div>` : ''}
        <input class="text-input" id="supSearch" type="search" autocomplete="off" placeholder="Найти игрока по нику" value="${esc(sp.q)}">
        <div id="supResults">${supResultsHtml()}</div>`;
    }
    h += `<div class="panel"><div class="panel-head"><h3><i class="fas fa-user"></i> На кого жалоба</h3><span class="aside">обязательно</span></div>${inner}</div>`;
  }

  if (c.needMatch || c.needTarget) {
    const rows = S.history.slice(0, 10).map(m => {
      const on = sp.match && String(sp.match.id) === String(m.id), win = m.result === 'win';
      return `<div class="sp-m ${on ? 'on' : ''}" data-act="sup-match" data-id="${m.id}">
        <div class="map-thumb" style="width:52px;height:40px">${mapThumb(mapById(m.map))}</div>
        <div class="main"><b>${esc(m.map || '—')} · ${win ? 'Победа' : 'Поражение'}</b><span>${fmtDay(m.match_date)}, ${fmtTime(m.match_date)}${m.match_number ? ' · #' + m.match_number : ''}${m.score_a != null ? ' · ' + m.score_a + ':' + m.score_b : ''}</span></div>
        <i class="fas ${on ? 'fa-circle-check' : 'fa-circle'}"></i></div>`;
    }).join('');
    h += `<div class="panel"><div class="panel-head"><h3><i class="fas fa-gamepad"></i> Матч</h3><span class="aside">${c.needMatch ? 'обязательно' : 'по желанию'}</span></div>
      ${rows || '<div class="empty" style="padding:14px"><i class="fas fa-gamepad"></i>Сыгранных матчей пока нет</div>'}</div>`;
  }

  h += `<div class="panel"><div class="panel-head"><h3><i class="fas fa-pen"></i> Описание</h3><span class="aside" id="supCount">${sp.text.length} / 500</span></div>
    <textarea class="text-input sp-ta" id="supText" maxlength="500" placeholder="${esc(SUPPORT_HINTS[c.id])}">${esc(sp.text)}</textarea>
    <p class="hint" style="text-align:left;margin-top:8px">Минимум 10 символов. Опишите всё по делу — так ответят быстрее.</p></div>
    <button class="btn btn-primary btn-xl" type="button" id="supSubmit" data-act="sup-submit" ${supValid() ? '' : 'disabled'}><i class="fas fa-paper-plane"></i> Отправить обращение</button>`;
  return h;
}

function renderSupport() {
  const box = $('supportBody'); if (!box || !S.me) return;
  box.innerHTML = S.sup.view === 'form' ? supportFormHtml() : supportHomeHtml();
}

async function supSearch(q) {
  const sp = S.sup;
  sp.q = q;
  const clean = q.replace(/[%_\\,()]/g, '').trim();
  if (!clean) { sp.results = []; const r = $('supResults'); if (r) r.innerHTML = ''; return; }
  const { data } = await sb.from('users').select(PUBLIC_COLS).ilike('username', '%' + clean + '%').neq('id', S.me.id).limit(8);
  if (sp.q !== q) return;
  sp.results = data || [];
  const r = $('supResults'); if (r) r.innerHTML = supResultsHtml();
}
const supSearchDeb = debounce(q => run(() => supSearch(q)), 300);

async function submitTicket() {
  const sp = S.sup;
  if (!supValid()) return;
  await rpc('create_ticket', {
    p_category: sp.cat, p_text: sp.text.trim(),
    p_target: sp.target ? sp.target.id : null,
    p_match_ref: sp.match ? String(sp.match.id) : null,
    p_match_number: sp.match && sp.match.match_number ? sp.match.match_number : null
  });
  S.sup = newSup();
  toast('success', 'Обращение отправлено', 'Ответ появится в «Моих обращениях»');
  await loadTickets();
  renderSupport();
  window.scrollTo({ top: 0 });
}

/* ───────────── Админка ───────────── */
function renderAdmin() {
  const box = $('adminPanel'); if (!box) return;
  if (!S.me || !S.me.isadmin) { box.innerHTML = ''; return; }
  const tabs = [['matches', 'Матчи'], ['players', 'Игроки'], ['queue', 'Очередь'], ['promos', 'Промокоды'], ['admins', 'Админы'], ['news', 'Новости'], ['tickets', 'Обращения'], ['settings', 'Формат']];
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
        const statRow = p => `<div class="adm-pl" data-pid="${esc(p.id)}"><span>${esc(p.username)}</span>
          <input class="text-input k" type="number" min="0" inputmode="numeric" aria-label="K ${esc(p.username)}"><input class="text-input d" type="number" min="0" inputmode="numeric" aria-label="D ${esc(p.username)}"><input class="text-input a" type="number" min="0" inputmode="numeric" aria-label="A ${esc(p.username)}"></div>`;
        const team = (arr, title) => `<h5 style="margin:8px 0 4px">${title}</h5>${arr.map(statRow).join('')}`;
        const rp = m.reports || { blue: 0, orange: 0 };
        return `<div class="adm-card" data-card="${m.id}">
          <div class="hdr"><b>#${m.match_number}</b><span class="badge ${m.status === 'pending' ? 'warn' : 'info'}">${m.status === 'pending' ? 'Ждёт подтверждения' : 'Идёт'}</span></div>
          ${m.status === 'active' ? `<div class="adm-pl head"><span>Игрок</span><span>K</span><span>D</span><span>A</span></div>${team(m.blue, 'Спецназ')}${team(m.orange, 'Террористы')}` : `<div class="row-sub">${m.blue.map(p => esc(p.username)).join(', ')} · ${m.orange.map(p => esc(p.username)).join(', ')}</div>`}
          ${m.status === 'active' ? `<div class="row-sub" style="margin-bottom:8px">Ответы игроков: спецназ — <b>${rp.blue}</b>, террористы — <b>${rp.orange}</b></div>
          <div class="adm-score"><input class="text-input sa" type="number" min="0" placeholder="0" aria-label="Счёт спецназа"><span class="muted">:</span><input class="text-input sb" type="number" min="0" placeholder="0" aria-label="Счёт террористов"></div>
          <div class="adm-btns"><button class="btn btn-sm btn-ghost" data-act="adm-finish" data-id="${m.id}" data-side="blue">🏆 Спецназ</button>
            <button class="btn btn-sm btn-ghost" data-act="adm-finish" data-id="${m.id}" data-side="orange">🏆 Террористы</button></div>` : ''}
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
  } else if (tab === 'news') {
    const list = (await rpc('get_news')) || [];
    body.innerHTML = `<div class="stack" style="margin-bottom:14px">
      <input class="text-input" id="admNewsTitle" maxlength="60" placeholder="Заголовок">
      <textarea class="text-input sp-ta" id="admNewsText" maxlength="500" placeholder="Текст новости. Придёт всем игрокам в уведомления"></textarea>
      <button class="btn btn-primary" data-act="adm-news-post"><i class="fas fa-bullhorn"></i> Опубликовать всем</button></div>` +
      (list.length ? '<div class="rows">' + list.map(n => `<div class="row"><div class="row-main"><div class="row-title">${esc(n.title)}</div>
        <div class="row-sub">${fmtDay(n.created_at)}, ${fmtTime(n.created_at)}</div></div>
        <button class="icon-btn" data-act="adm-news-del" data-id="${n.id}" aria-label="Удалить"><i class="fas fa-trash"></i></button></div>`).join('') + '</div>'
        : '<div class="empty">Новостей пока нет</div>');
  } else if (tab === 'tickets') {
    const all = !!S.admTkAll;
    const list = await rpc('admin_tickets', { p_status: all ? 'all' : 'active' });
    body.innerHTML = `<button class="btn btn-ghost btn-sm" data-act="adm-tk-filter" style="margin-bottom:10px">${all ? 'Только активные' : 'Показать все'}</button>` +
      (list.length ? list.map(t => {
        const c = catOf(t.category), st = TICKET_ST[t.status] || TICKET_ST.open;
        return `<div class="adm-card"><div class="hdr"><b>#${t.id} · ${c.title}</b><span class="badge ${st[1]}">${st[0]}</span></div>
          <div class="row-sub">${esc(t.username || '—')}${t.target_name ? ' → ' + esc(t.target_name) : ''}${t.match_number ? ' · матч #' + t.match_number : ''} · ${fmtDay(t.created_at)} ${fmtTime(t.created_at)}</div>
          <div style="margin:8px 0;font-size:13px;word-break:break-word">${esc(t.text)}</div>
          ${t.admin_reply ? `<div class="row-sub" style="margin-bottom:8px">Ответ: ${esc(t.admin_reply)}</div>` : ''}
          <div class="adm-btns" style="grid-template-columns:repeat(3,1fr)">
            <button class="btn btn-sm btn-ghost" data-act="adm-tk" data-id="${t.id}" data-st="progress">В работу</button>
            <button class="btn btn-sm btn-ok" data-act="adm-tk" data-id="${t.id}" data-st="resolved">Решено</button>
            <button class="btn btn-sm btn-danger" data-act="adm-tk" data-id="${t.id}" data-st="rejected">Отклонить</button></div></div>`;
      }).join('') : '<div class="empty">Обращений нет</div>');
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
  const ok = await dialog({ title: `Засчитать победу: ${d.side === 'blue' ? 'спецназ' : 'террористы'}?`, text: 'ELO игроков изменится сразу.', ok: 'Засчитать' });
  if (!ok) return;
  const card = document.querySelector(`[data-card="${d.id}"]`);
  const num = sel => { const v = card && card.querySelector(sel) ? card.querySelector(sel).value : ''; const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const stats = {};
  if (card) card.querySelectorAll('[data-pid]').forEach(r => {
    const g = c => { const n = parseInt(r.querySelector(c).value, 10); return Number.isFinite(n) ? n : null; };
    const k = g('.k'), dd = g('.d'), a = g('.a');
    if (k !== null || dd !== null || a !== null) stats[r.dataset.pid] = { k: k || 0, d: dd || 0, a: a || 0 };
  });
  await rpc('admin_finish_match', { p_match: d.id, p_winner: d.side, p_score_a: num('.sa'), p_score_b: num('.sb'), p_stats: stats });
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
  nav: d => { closeModal('settingsModal'); closeModal('notifModal'); navigate(d.page); },
  settings: () => openModal('settingsModal'),
  notifs: openNotifs,
  support: () => { closeModal('settingsModal'); closeModal('notifModal'); navigate('support'); },
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
  'banner-buy': buyBanner,
  'banner-use': useBanner,
  'frame-buy': buyFrame,
  'frame-use': useFrame,
  'sup-pick': async d => { const sp = S.sup; sp.cat = d.id; sp.view = 'form'; sp.target = null; sp.q = ''; sp.results = []; renderSupport(); window.scrollTo({ top: 0 }); ensureMatchFull(); },
  'sup-back': () => { S.sup.view = 'home'; renderSupport(); window.scrollTo({ top: 0 }); },
  'sup-target': d => {
    const u = S.sup.results.concat(supMatchPlayers()).find(x => String(x.id) === String(d.id));
    if (u) { S.sup.target = u; renderSupport(); }
  },
  'sup-target-clear': () => { S.sup.target = null; S.sup.q = ''; S.sup.results = []; renderSupport(); },
  'sup-match': async d => {
    const sp = S.sup;
    if (sp.match && String(sp.match.id) === String(d.id)) { sp.match = null; sp.matchFull = null; return renderSupport(); }
    sp.match = S.history.find(x => String(x.id) === String(d.id)) || null; sp.matchFull = null;
    renderSupport(); await ensureMatchFull();
  },
  'sup-submit': submitTicket,
  'sup-from-match': d => {
    S.sup = newSup();
    S.sup.match = S.history.find(x => String(x.id) === String(d.id)) || null;
    navigate('support');
    ensureMatchFull();
  },
  'adm-tk-filter': () => { S.admTkAll = !S.admTkAll; loadAdminTab(); },
  'adm-tk': async d => {
    let reply = null;
    if (d.st !== 'progress') {
      reply = await dialog({ title: d.st === 'resolved' ? 'Закрыть обращение' : 'Отклонить обращение', text: 'Ответ игроку (необязательно)', input: '', ok: 'Готово' });
      if (reply === null) return;
    }
    await rpc('admin_update_ticket', { p_id: Number(d.id), p_status: d.st, p_reply: (reply || '').trim() || null });
    toast('success', 'Обновлено', '');
    await loadAdminTab();
  },
  'adm-news-post': async () => {
    const t = $('admNewsTitle').value.trim(), x = $('admNewsText').value.trim();
    if (!t || !x) return toast('error', 'Заполните заголовок и текст', '');
    await rpc('admin_post_news', { p_title: t, p_text: x });
    toast('success', 'Новость опубликована', 'Придёт всем игрокам');
    await loadNews(); await loadAdminTab();
  },
  'adm-news-del': async d => {
    const ok = await dialog({ title: 'Удалить новость?', ok: 'Удалить', danger: true });
    if (!ok) return;
    await rpc('admin_delete_news', { p_id: Number(d.id) });
    await loadNews(); await loadAdminTab();
  },
  'adm-tab': d => { S.adminTab = d.tab; renderAdmin(); },
  'adm-refresh': () => loadAdminTab(),
  'adm-open': () => { S.adminTab = 'matches'; navigate('profile'); setTimeout(() => $('adminPanel') && $('adminPanel').scrollIntoView({ behavior: 'smooth' }), 150); },
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
function blockZoom() {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault(); });
}

function bindEvents() {
  blockZoom();
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (el) {
      const fn = ACTIONS[el.dataset.act];
      if (fn) run(fn, el.dataset, el);
      return;
    }
    if (e.target.classList && e.target.classList.contains('overlay') && ['profileModal', 'matchModal', 'settingsModal', 'notifModal'].includes(e.target.id)) closeModal(e.target.id);
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'supText') { S.sup.text = e.target.value; updateSupportSubmit(); }
    else if (e.target.id === 'supSearch') { S.sup.q = e.target.value; supSearchDeb(e.target.value); }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'avatarFile') run(() => uploadAvatar(e.target.files[0]));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { ['profileModal', 'matchModal', 'settingsModal', 'notifModal'].forEach(closeModal); }
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
}

async function init() {
  try {
    const tg = TG;
    if (tg) {
      tg.ready(); if (tg.expand) tg.expand();
      try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) { /* старые версии */ }
      try { tg.setHeaderColor('#0c0916'); tg.setBackgroundColor('#0c0916'); } catch (e) { /* старые версии */ }
    }
  } catch (e) { /* ок */ }
  injectBannerStyles();
  bindEvents();
  try {
    if (!SESSION) {
      const saved = await cloud.get('bnk_session');
      if (/^[0-9a-f-]{36}$/.test(saved)) { SESSION = saved; try { localStorage.setItem('bnk_session', saved); } catch (e) { /* ок */ } }
    }
    if (SESSION) await enterApp();
    else showAuth();
  } catch (e) {
    console.error('init', e);
    showAuth('Нет связи с сервером. Откройте приложение ещё раз — вход сохранён.');
  } finally {
    const s = $('splash');
    if (s) { s.classList.add('hide'); setTimeout(() => s.remove(), 500); }
  }
}

init();
