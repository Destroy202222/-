# Vercel Python function (JPEG-карточки для бота):
#   /api/profile?id=<uuid>   профиль игрока
#   /api/profile?type=queue  поиск матча: сколько в очереди 2×2 / 5×5 и в матчах
#   /api/profile?type=top    топ-15 игроков
# Данные берёт из Supabase (функция profile_card), рисует Pillow. Бот шлёт эту ссылку в sendPhoto.
import io, os, re, json, time, base64, math, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://ggjkivobmwwqgzkaaihx.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnamtpdm9ibXd3cWd6a2FhaWh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NzQzODcsImV4cCI6MjEwNzE1MDM4N30.flfcDmjp9riwZe9N4xCqX9CzIo6D9x9SeeQB3YU7254')
ORIGIN = os.environ.get('SITE_ORIGIN', 'https://faceitsk.vercel.app')
UUID_RE = re.compile(r'^[0-9a-fA-F-]{36}$')

W = H = 1280
K = 2                                   # суперсэмплинг: рисуем в 2× и уменьшаем

# палитра сайта
BG = (7, 11, 28); SURF = (15, 22, 51); SURF2 = (21, 30, 66); LINE = (36, 50, 104)
TEXT = (243, 247, 255); MUTED = (159, 176, 214); DIM = (104, 121, 166)
ACC = (79, 140, 255); ACC2 = (236, 72, 153); HI = (143, 208, 255)
WIN = (61, 220, 151); LOSE = (255, 77, 109); GOLD = (245, 196, 81)
LEVELS = [(1, 0, 199), (2, 200, 249), (3, 250, 399), (4, 400, 599), (5, 600, 799),
          (6, 800, 999), (7, 1000, 1399), (8, 1400, 1699), (9, 1700, 1999), (10, 2000, 10 ** 9)]
LVL_COL = ['#9ca3af', '#a1a1d6', '#a78bfa', '#8b5cf6', '#7c6cf0', '#c084fc', '#e879f9', '#f472b6', '#fb7185', '#f5c451']


def hexc(s):
    s = s.lstrip('#'); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def level_of(elo):
    elo = max(0, int(elo or 0))
    for l in LEVELS:
        if elo <= l[2]: return l
    return LEVELS[-1]


# ───────────────────────── шрифты ─────────────────────────
FONT_DIR = '/tmp/skfonts'
_FONTS = {}
_LOCAL = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']


def _http(url, timeout=6, ua='Mozilla/4.0'):
    req = urllib.request.Request(url, headers={'User-Agent': ua})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def load_google_fonts():
    """Шрифты сайта (Unbounded + Manrope) с Google Fonts: со старым User-Agent отдаются обычные TTF."""
    os.makedirs(FONT_DIR, exist_ok=True)
    out = {}
    css = _http('https://fonts.googleapis.com/css2?family=Unbounded:wght@700&family=Manrope:wght@500;700;800&display=swap',
                ua='Mozilla/4.0')
    for blk in re.findall(r'@font-face\s*\{(.*?)\}', css.decode('utf8', 'ignore'), re.S):
        fam = re.search(r"font-family:\s*'?([^;']+)'?", blk); wt = re.search(r'font-weight:\s*(\d+)', blk)
        src = re.search(r'url\(([^)]+)\)', blk)
        if not (fam and wt and src): continue
        key = f"{fam.group(1).strip()}-{wt.group(1)}"
        path = os.path.join(FONT_DIR, key.replace(' ', '') + '.ttf')
        if not os.path.exists(path):
            with open(path, 'wb') as f: f.write(_http(src.group(1).strip('\'"'), timeout=8))
        out[key] = path
    return out


def font(kind, size):
    """kind: disp | bold | semi | reg ; size в «дизайн-единицах» (умножается на K)."""
    key = (kind, size)
    if key in _FONTS: return _FONTS[key]
    if '_paths' not in _FONTS:
        try: _FONTS['_paths'] = load_google_fonts()
        except Exception: _FONTS['_paths'] = {}
    p = _FONTS['_paths']
    want = {'disp': ['Unbounded-700'], 'bold': ['Manrope-800', 'Manrope-700'], 'semi': ['Manrope-700', 'Manrope-800'],
            'reg': ['Manrope-500', 'Manrope-700']}[kind]
    path = next((p[w] for w in want if w in p), None)
    if not path:
        path = next((x for x in (_LOCAL if kind != 'reg' else _LOCAL[::-1]) if os.path.exists(x)), None)
    try: f = ImageFont.truetype(path, int(size * K)) if path else ImageFont.load_default()
    except Exception: f = ImageFont.load_default()
    _FONTS[key] = f
    return f


# ───────────────────────── данные и картинки ─────────────────────────
def fetch_card(uid, fn='profile_card', args=None):
    body = json.dumps(args if args is not None else {'p_id': uid}).encode()
    req = urllib.request.Request(SUPABASE_URL + '/rest/v1/rpc/' + fn, data=body, method='POST', headers={
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=6) as r:
        return json.loads(r.read().decode())


def get_image(src):
    if not src: return None
    try:
        if src.startswith('data:'):
            raw = base64.b64decode(src.split(',', 1)[1])
        else:
            if src.startswith('/'): src = ORIGIN + src
            elif not src.startswith('http'): src = ORIGIN + '/' + src.lstrip('/')
            raw = _http(src, timeout=4, ua='Mozilla/5.0')
        return Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception:
        return None


# ───────────────────────── рисование ─────────────────────────
class Cv:
    def __init__(self, w=W, h=H):
        self.w, self.h = w, h
        self.im = Image.new('RGB', (w * K, h * K), BG)
        self.d = ImageDraw.Draw(self.im)

    def b(self, box): return tuple(int(v * K) for v in box)

    def rr(self, box, r, fill=None, outline=None, width=1):
        self.d.rounded_rectangle(self.b(box), int(r * K), fill=fill, outline=outline, width=int(width * K))

    def text(self, xy, s, f, fill, anchor='la', spacing=0):
        x, y = xy
        if spacing:
            total = sum(self.d.textlength(c, font=f) for c in s) + spacing * K * (len(s) - 1)
            cx = x * K
            if anchor[0] == 'r': cx -= total
            elif anchor[0] == 'm': cx -= total / 2
            for c in s:
                self.d.text((cx, y * K), c, font=f, fill=fill, anchor='l' + anchor[1])
                cx += self.d.textlength(c, font=f) + spacing * K
        else:
            self.d.text((x * K, y * K), s, font=f, fill=fill, anchor=anchor)

    def tw(self, s, f): return self.d.textlength(s, font=f) / K

    def fit(self, s, kind, size, maxw, minsize=10):
        while size > minsize and self.tw(s, font(kind, size)) > maxw: size -= 1
        f = font(kind, size)
        if self.tw(s, f) > maxw:
            while len(s) > 1 and self.tw(s + '…', f) > maxw: s = s[:-1]
            s += '…'
        return s, f

    def paste_round(self, src, box, r, dim=0.0):
        x0, y0, x1, y1 = self.b(box); w, h = x1 - x0, y1 - y0
        sc = max(w / src.width, h / src.height)
        im = src.resize((max(1, int(src.width * sc + .5)), max(1, int(src.height * sc + .5))), Image.LANCZOS)
        l, t = (im.width - w) // 2, (im.height - h) // 2
        im = im.crop((l, t, l + w, t + h))
        if dim: im = Image.blend(im, Image.new('RGB', im.size, BG), dim)
        m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), int(r * K), fill=255)
        self.im.paste(im, (x0, y0), m)

    def grad_round(self, box, r, c1, c2, horizontal=True):
        x0, y0, x1, y1 = self.b(box); w, h = x1 - x0, y1 - y0
        g = Image.linear_gradient('L')
        g = g.rotate(90, expand=True) if horizontal else g
        g = g.transpose(Image.FLIP_LEFT_RIGHT) if horizontal else g
        g = g.resize((w, h))
        im = Image.composite(Image.new('RGB', (w, h), c2), Image.new('RGB', (w, h), c1), g)
        m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), int(r * K), fill=255)
        self.im.paste(im, (x0, y0), m)

    def glow(self, cx, cy, rad, color, alpha):
        s = 8; sz = (int(rad * 2 * K / s), int(rad * 2 * K / s))
        lay = Image.new('L', sz, 0)
        ImageDraw.Draw(lay).ellipse((sz[0] * .18, sz[1] * .18, sz[0] * .82, sz[1] * .82), fill=int(255 * alpha))
        lay = lay.filter(ImageFilter.GaussianBlur(sz[0] * .12)).resize((int(rad * 2 * K), int(rad * 2 * K)), Image.BICUBIC)
        self.im.paste(Image.new('RGB', lay.size, color), (int((cx - rad) * K), int((cy - rad) * K)), lay)

    def panel(self, box, r=30, fill=SURF):
        self.rr(box, r, fill=fill, outline=LINE, width=1.4)

    def head(self, x, y, label, size=15, color=TEXT, spacing=2.4):
        self.text((x, y), label, font('semi', size), color, spacing=spacing)

    def bar(self, x, y, w, frac, h=7, c1=ACC, c2=ACC2):
        self.rr((x, y, x + w, y + h), h / 2, fill=(30, 40, 88))
        fw = max(h, w * max(0, min(1, frac))) if frac > 0 else 0
        if fw: self.grad_round((x, y, x + fw, y + h), h / 2, c1, c2)

    def ring(self, cx, cy, r, frac, th=10, c1=ACC, c2=ACC2):
        box = [(cx - r) * K, (cy - r) * K, (cx + r) * K, (cy + r) * K]
        self.d.arc(box, 0, 360, fill=(30, 40, 88), width=int(th * K))
        if frac > 0:
            steps = max(2, int(frac * 90))
            for i in range(steps):
                a0 = -90 + 360 * frac * i / steps; a1 = -90 + 360 * frac * (i + 1) / steps + 0.6
                self.d.arc(box, a0, a1, fill=mix(c1, c2, i / max(1, steps - 1)), width=int(th * K))

    def pill(self, xy, s, f, fg, bg, outline=None, padx=12, h=26, anchor='l'):
        w = self.tw(s, f) + padx * 2
        x, y = xy
        if anchor == 'r': x -= w
        self.rr((x, y, x + w, y + h), h / 2, fill=bg, outline=outline, width=1)
        self.text((x + padx, y + h / 2), s, f, fg, anchor='lm')
        return w


# ───────── иконки достижений (простые векторные) ─────────
def icon(cv, kind, cx, cy, col):
    d = cv.d; u = K; c = (cx * u, cy * u); lw = int(2.6 * u)
    P = lambda pts: [(cx * u + x * u, cy * u + y * u) for x, y in pts]
    if kind == 'flag':
        d.line(P([(-8, -11), (-8, 12)]), fill=col, width=lw)
        for i in range(3):
            for j in range(2):
                if (i + j) % 2 == 0: d.rectangle([P([(-8 + i * 6, -11 + j * 6)])[0], P([(-2 + i * 6, -5 + j * 6)])[0]], fill=col)
    elif kind == 'cube':
        d.polygon(P([(0, -12), (11, -6), (11, 6), (0, 12), (-11, 6), (-11, -6)]), outline=col, width=lw)
        d.line(P([(-11, -6), (0, 0), (11, -6)]), fill=col, width=lw); d.line(P([(0, 0), (0, 12)]), fill=col, width=lw)
    elif kind == 'trophy':
        d.polygon(P([(-8, -11), (8, -11), (7, 0), (0, 5), (-7, 0)]), outline=col, width=lw)
        d.line(P([(0, 5), (0, 10)]), fill=col, width=lw); d.line(P([(-6, 11), (6, 11)]), fill=col, width=lw)
        d.arc([(cx - 14) * u, (cy - 10) * u, (cx - 6) * u, (cy - 1) * u], 90, 270, fill=col, width=int(2 * u))
        d.arc([(cx + 6) * u, (cy - 10) * u, (cx + 14) * u, (cy - 1) * u], -90, 90, fill=col, width=int(2 * u))
    elif kind == 'crown':
        d.polygon(P([(-12, 8), (-12, -7), (-5, 0), (0, -10), (5, 0), (12, -7), (12, 8)]), outline=col, width=lw)
    elif kind == 'fire':
        d.polygon(P([(0, -13), (9, -2), (9, 5), (4, 12), (-4, 12), (-9, 5), (-8, -3), (-3, -1)]), outline=col, width=lw)
    elif kind == 'bolt':
        d.polygon(P([(3, -13), (-8, 2), (-1, 2), (-3, 13), (8, -3), (1, -3)]), outline=col, width=lw)
    elif kind == 'shield':
        d.polygon(P([(0, -12), (11, -8), (10, 3), (0, 12), (-10, 3), (-11, -8)]), outline=col, width=lw)
        d.line(P([(-4, 0), (-1, 4), (5, -4)]), fill=col, width=lw)
    elif kind == 'target':
        d.ellipse([(cx - 10) * u, (cy - 10) * u, (cx + 10) * u, (cy + 10) * u], outline=col, width=lw)
        d.ellipse([(cx - 3) * u, (cy - 3) * u, (cx + 3) * u, (cy + 3) * u], fill=col)
        for a, b in (((0, -14), (0, -6)), ((0, 14), (0, 6)), ((-14, 0), (-6, 0)), ((14, 0), (6, 0))): d.line(P([a, b]), fill=col, width=int(2 * u))
    elif kind == 'group':
        d.ellipse([(cx - 9) * u, (cy - 10) * u, (cx - 1) * u, (cy - 2) * u], outline=col, width=lw)
        d.ellipse([(cx + 2) * u, (cy - 7) * u, (cx + 9) * u, (cy) * u], outline=col, width=lw)
        d.arc([(cx - 14) * u, (cy + 1) * u, (cx + 4) * u, (cy + 19) * u], 180, 360, fill=col, width=lw)
        d.arc([(cx + 1) * u, (cy + 3) * u, (cx + 15) * u, (cy + 17) * u], 200, 360, fill=col, width=lw)
    elif kind == 'medal':
        d.ellipse([(cx - 8) * u, (cy - 2) * u, (cx + 8) * u, (cy + 14) * u], outline=col, width=lw)
        d.line(P([(-6, -3), (-3, -13)]), fill=col, width=lw); d.line(P([(6, -3), (3, -13)]), fill=col, width=lw)
        d.line(P([(-3, 6), (0, 3), (3, 6), (0, 10), (-3, 6)]), fill=col, width=int(1.6 * u))
    elif kind == 'bars':
        for i, hh in enumerate((6, 11, 16)):
            d.rectangle([(cx - 9 + i * 7) * u, (cy + 8 - hh) * u, (cx - 5 + i * 7) * u, (cy + 8) * u], fill=col)
    elif kind == 'line':
        d.line(P([(-11, 7), (-4, -1), (2, 3), (11, -8)]), fill=col, width=lw)


ACH = [('flag', 'Первый матч'), ('cube', '10 матчей'), ('trophy', 'Первая победа'), ('crown', '10 побед'),
       ('fire', 'Серия из 3'), ('bolt', 'Серия из 5'), ('shield', '5 уровень'), ('target', 'K/D от 1.5'),
       ('group', 'Есть друзья'), ('medal', '10 уровень')]


def fmt_dt(iso):
    try:
        dt = datetime.fromisoformat(str(iso).replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=3)))
        return dt.strftime('%d.%m.%Y · %H:%M')
    except Exception:
        return ''


# ───────────────────────── сама карточка ─────────────────────────
def render(card, imgs):
    u = card['u']; hist = card.get('hist') or []; maps = card.get('maps') or []
    elo = int(u.get('elo') or 0); matches = u.get('matches') or 0; wins = u.get('wins') or 0
    kills, deaths = u.get('kills') or 0, u.get('deaths') or 0; sm = u.get('stat_matches') or 0
    lvl, lmin, lmax = level_of(elo); lcol = hexc(LVL_COL[lvl - 1])
    kd = kills / deaths if deaths > 0 else (float(kills) if kills > 0 else None)
    avg = kills / sm if sm else None; ast = (u.get('assists') or 0) / sm if sm else None
    kpr = kills / u['rounds'] if (u.get('rounds') or 0) > 0 else None
    wr = round(wins / matches * 100) if matches else 0
    fx = lambda v, dgt=2: '—' if v is None else f'{v:.{dgt}f}'
    qual = lambda v, hi, mid: '—' if v is None else ('Высокий' if v >= hi else 'Средний' if v >= mid else 'Низкий')

    cv = Cv()
    cv.glow(180, 120, 520, (24, 44, 120), .75); cv.glow(1150, 1150, 560, (96, 24, 76), .55); cv.glow(1180, 120, 300, (60, 30, 110), .5)

    # ── баннер ──
    bx = (22, 22, 1258, 268)
    cv.grad_round(bx, 40, (17, 28, 76), (58, 24, 84))
    if imgs.get('banner') is not None:
        cv.paste_round(imgs['banner'], bx, 40, dim=.35)
    else:
        cv.glow(980, 150, 300, (70, 40, 140), .55); cv.glow(300, 200, 240, (40, 80, 180), .4)
    cv.rr(bx, 40, outline=LINE, width=1.4)
    # лого и дата
    cv.text((1226, 52), 'STANDKNIFE', font('disp', 17), TEXT, anchor='ra', spacing=3)
    cv.text((1226, 78), 'F A C E I T', font('semi', 13), HI, anchor='ra', spacing=4)
    cv.text((1226, 244), card.get('today', ''), font('semi', 15), MUTED, anchor='rs')
    # аватар
    ax, ay, ar = 142, 145, 66
    cv.d.ellipse([(ax - ar - 5) * K, (ay - ar - 5) * K, (ax + ar + 5) * K, (ay + ar + 5) * K], fill=lcol)
    cv.d.ellipse([(ax - ar - 1) * K, (ay - ar - 1) * K, (ax + ar + 1) * K, (ay + ar + 1) * K], fill=BG)
    if imgs.get('avatar') is not None:
        a = imgs['avatar']; s = int(ar * 2 * K); sc = max(s / a.width, s / a.height)
        a = a.resize((int(a.width * sc + .5), int(a.height * sc + .5)), Image.LANCZOS)
        l, t = (a.width - s) // 2, (a.height - s) // 2; a = a.crop((l, t, l + s, t + s))
        m = Image.new('L', (s, s), 0); ImageDraw.Draw(m).ellipse((0, 0, s - 1, s - 1), fill=255)
        cv.im.paste(a, (int((ax - ar) * K), int((ay - ar) * K)), m)
    else:
        cv.d.ellipse([(ax - ar) * K, (ay - ar) * K, (ax + ar) * K, (ay + ar) * K], fill=(38, 54, 120))
        cv.text((ax, ay + 2), (u.get('username') or '?')[:1].upper(), font('disp', 54), TEXT, anchor='mm')
    # имя и чипы
    tx = 250
    rank = card.get('rank')
    cv.text((tx, 78), f'МЕСТО  #{rank}' if rank else 'БЕЗ МЕСТА', font('semi', 16), MUTED, spacing=3)
    nm, nf = cv.fit((u.get('username') or '—').upper(), 'disp', 42, 760, 22)
    cv.text((tx, 104), nm, nf, TEXT)
    cv.text((tx, 158), 'ID: ' + (u.get('game_id') or '—'), font('semi', 18), MUTED)
    x = tx; cy = 192
    x += cv.pill((x, cy), f'LVL {lvl}', font('disp', 13), TEXT, (24, 32, 76), outline=lcol, padx=14, h=32) + 10
    x += cv.pill((x, cy), f'{elo} ELO', font('disp', 13), HI, (24, 32, 76), outline=ACC, padx=14, h=32) + 10
    if u.get('isadmin'):
        x += cv.pill((x, cy), '♛ ADMIN', font('disp', 13), (40, 20, 10), GOLD, padx=14, h=32) + 10
    if u.get('verified_kind'):
        x += cv.pill((x, cy), 'ПРОВЕРЕН', font('disp', 13), (6, 40, 28), WIN, padx=14, h=32) + 10

    # ── панель «Статистика» ──
    cv.panel((22, 283, 842, 722))
    icon(cv, 'bars', 47, 316, ACC2); cv.head(66, 307, 'СТАТИСТИКА', 18)
    to_next = 'Максимальный уровень' if lmax >= 10 ** 8 else f'До уровня {lvl + 1}: {lmax + 1 - elo} ELO'
    cv.pill((824, 299), to_next, font('semi', 14), MUTED, SURF2, outline=LINE, padx=14, h=34, anchor='r')
    # K/D
    cv.rr((40, 345, 424, 522), 26, fill=SURF2)
    cv.ring(118, 433, 54, 0 if kd is None else min(1, kd / 3), th=11)
    cv.text((118, 433), fx(kd), font('disp', 22), TEXT, anchor='mm')
    cv.text((198, 400), 'Kill / Deaths', font('semi', 17), MUTED)
    kt, kf = cv.fit(f'K = {kills}   D = {deaths}', 'bold', 25, 210, 14)
    cv.text((198, 440), kt, kf, TEXT)
    # уровень
    cv.rr((440, 345, 824, 522), 26, fill=SURF2)
    cv.text((466, 377), 'LEVEL', font('semi', 14), MUTED, spacing=3)
    cv.text((466, 428), str(elo), font('disp', 34), TEXT, anchor='ls')
    cv.text((466, 456), str(lmin), font('semi', 14), DIM)
    cv.text((640, 456), '∞' if lmax >= 10 ** 8 else str(lmax + 1), font('semi', 14), DIM, anchor='ra')
    prog = 1 if lmax >= 10 ** 8 else max(0, min(1, (elo - lmin) / (lmax - lmin + 1)))
    cv.bar(466, 474, 174, prog, h=9)
    hx, hy, hr = 726, 434, 62
    hexpts = [((hx + hr * math.cos(math.radians(60 * i - 90))) * K, (hy + hr * math.sin(math.radians(60 * i - 90))) * K) for i in range(6)]
    cv.d.polygon(hexpts, fill=mix(lcol, BG, .78), outline=lcol, width=int(4 * K))
    inner = [((hx + (hr - 14) * math.cos(math.radians(60 * i - 90))) * K, (hy + (hr - 14) * math.sin(math.radians(60 * i - 90))) * K) for i in range(6)]
    cv.d.polygon(inner, outline=mix(lcol, BG, .5), width=int(2 * K))
    cv.text((hx, hy + 2), str(lvl), font('disp', 44), lcol, anchor='mm')
    # плитки
    tiles = [('WINRATE', f'{wr}%', wr / 100, qual(wr, 55, 45) if matches else '—'),
             ('K/D', fx(kd), 0 if kd is None else min(1, kd / 2), qual(kd, 1.2, .9)),
             ('AVG', fx(avg, 1), 0 if avg is None else min(1, avg / 25), qual(avg, 15, 10)),
             ('KPR', fx(kpr), 0 if kpr is None else min(1, kpr / 1.2), qual(kpr, .75, .55))]
    tw = (784 - 36) / 4
    for i, (lab, val, fr, q) in enumerate(tiles):
        x0 = 40 + i * (tw + 12)
        cv.rr((x0, 537, x0 + tw, 668), 22, fill=SURF2)
        cv.text((x0 + 18, 552), lab, font('semi', 13), MUTED, spacing=2.4)
        cv.text((x0 + 18, 598), val, font('disp', 32), TEXT, anchor='ls')
        cv.bar(x0 + 18, 612, tw - 36, fr, h=7)
        cv.text((x0 + 18, 632), q, font('bold', 15), ACC2)
    cv.text((42, 700), f'Лучшая серия  {u.get("best_streak") or 0}', font('semi', 15), MUTED)
    cv.text((432, 700), f'Ассисты  {fx(ast, 1)}/матч', font('semi', 15), MUTED, anchor='ma')
    cv.text((824, 700), f'по {sm} матч.', font('semi', 15), MUTED, anchor='ra')

    # ── правая колонка ──
    cv.panel((860, 283, 1258, 448))
    cells = [('ИГР', str(matches), TEXT), ('ПОБЕД', str(wins), WIN), ('ПОРАЖЕНИЙ', str(u.get('losses') or 0), LOSE), ('ОЦЕНОК', str(u.get('likes') or 0), HI)]
    for i, (lab, val, col) in enumerate(cells):
        cx0 = 884 + (i % 2) * 190; cy0 = 308 + (i // 2) * 70
        cv.text((cx0, cy0), lab, font('semi', 13), MUTED, spacing=2.4)
        cv.text((cx0, cy0 + 24), val, font('disp', 28), col)
    cv.rr((860, 466, 1258, 535), 34, fill=SURF, outline=ACC, width=2)
    cv.text((884, 500), 'Твоё место в рейтинге', font('bold', 18), TEXT, anchor='lm')
    cv.text((1234, 500), f'#{rank}' if rank else '—', font('disp', 24), ACC2, anchor='rm')

    # достижения
    friends = card.get('friends') or 0
    st_ok = kd is not None and kd >= 1.5 and sm >= 3
    flags = [matches >= 1, matches >= 10, wins >= 1, wins >= 10, (u.get('best_streak') or 0) >= 3, (u.get('best_streak') or 0) >= 5,
             lvl >= 5, st_ok, friends >= 1, lvl >= 10]
    cv.panel((860, 551, 1258, 742))
    cv.head(884, 574, 'ДОСТИЖЕНИЯ', 15, spacing=3)
    cv.pill((1234, 566), f'{sum(flags)}/10', font('bold', 14), MUTED, SURF2, outline=LINE, padx=12, h=30, anchor='r')
    for i, ok in enumerate(flags):
        gx = 884 + (i % 5) * 71; gy = 614 + (i // 5) * 62
        cv.rr((gx, gy, gx + 56, gy + 56), 18, fill=(30, 34, 84) if ok else (17, 24, 56), outline=ACC2 if ok else LINE, width=1.6 if ok else 1)
        icon(cv, ACH[i][0], gx + 28, gy + 28, ACC2 if ok else (60, 74, 120))

    # ── ELO-график ──
    cv.panel((22, 737, 422, 1222))
    icon(cv, 'line', 48, 769, ACC2); cv.head(68, 760, 'ДИНАМИКА ELO', 17)
    series = [elo]
    for h in hist[:16]: series.insert(0, series[0] - int(h.get('elo_change') or 0))
    if len(series) >= 2:
        delta = series[-1] - series[0]
        cv.text((44, 836), str(elo), font('disp', 40), TEXT, anchor='ls')
        cv.pill((398, 806), f'{delta:+d}', font('bold', 15), WIN if delta >= 0 else LOSE, SURF2, outline=LINE, padx=14, h=32, anchor='r')
        cx0, cx1, cy0, cy1 = 54, 392, 880, 1130
        lo, hi = min(series), max(series); span = max(1, hi - lo); lo -= span * .15; hi += span * .15
        for g in range(4):
            gy = cy0 + (cy1 - cy0) * g / 3
            cv.d.line([(cx0 * K, gy * K), (cx1 * K, gy * K)], fill=(26, 36, 80), width=K)
        pts = [(cx0 + (cx1 - cx0) * i / (len(series) - 1), cy1 - (v - lo) / (hi - lo) * (cy1 - cy0)) for i, v in enumerate(series)]
        poly = [(x * K, y * K) for x, y in pts] + [(cx1 * K, cy1 * K), (cx0 * K, cy1 * K)]
        cv.d.polygon(poly, fill=mix(SURF, ACC, .22))
        cv.d.line([(x * K, y * K) for x, y in pts], fill=ACC, width=int(3.4 * K), joint='curve')
        for i, (x, y) in enumerate(pts):
            last = i == len(pts) - 1
            r = 6 if last else 3.6
            cv.d.ellipse([(x - r) * K, (y - r) * K, (x + r) * K, (y + r) * K], fill=ACC2 if last else HI)
        cv.text((54, 1152), f'мин  {min(series)}', font('semi', 15), MUTED)
        cv.text((392, 1152), f'макс  {max(series)}', font('semi', 15), MUTED, anchor='ra')
        n = len(series) - 1
        cv.text((222, 1192), f'последние {n} матч.', font('semi', 14), DIM, anchor='ma')
    else:
        cv.text((222, 980), 'График появится после', font('bold', 18), MUTED, anchor='mm')
        cv.text((222, 1008), 'первых матчей', font('bold', 18), MUTED, anchor='mm')

    # ── карты ──
    cv.panel((440, 737, 842, 1222))
    cv.head(466, 762, 'СТАТИСТИКА ПО КАРТАМ', 15, MUTED, spacing=3)
    if not maps:
        cv.text((641, 980), 'Матчей на картах пока нет', font('bold', 17), MUTED, anchor='mm')
    for i, m in enumerate(maps[:4]):
        x0 = 458 + (i % 2) * 192; y0 = 796 + (i // 2) * 210
        cv.rr((x0, y0, x0 + 184, y0 + 200), 24, fill=SURF2, outline=LINE, width=1)
        t, tf = cv.fit(str(m.get('map') or '—'), 'bold', 19, 150, 13)
        cv.text((x0 + 16, y0 + 16), t, tf, TEXT)
        w_, l_ = m.get('w') or 0, m.get('l') or 0
        wl = font('bold', 15); wtxt = f'W {w_}'
        cv.text((x0 + 16, y0 + 46), wtxt, wl, WIN); cv.text((x0 + 16 + cv.tw(wtxt, wl) + 12, y0 + 46), f'L {l_}', wl, LOSE)
        mk, md = m.get('k') or 0, m.get('d') or 0
        mkd = (mk / md) if md > 0 else (float(mk) if mk else None)
        cv.text((x0 + 16, y0 + 72), f'K/D {fx(mkd)}', font('semi', 14), MUTED)
        pct = round(w_ * 100 / max(1, w_ + l_))
        cv.text((x0 + 168, y0 + 72), f'{pct}%', font('bold', 14), ACC2, anchor='ra')
        pic = imgs.get(f'map{i}')
        box = (x0 + 1, y0 + 100, x0 + 183, y0 + 199)
        if pic is not None:
            cv.paste_round(pic, box, 22, dim=.18)
            cv.rr((x0, y0, x0 + 184, y0 + 200), 24, outline=LINE, width=1)
        else:
            cv.grad_round(box, 22, (25, 40, 100), (60, 28, 90), horizontal=False)

    # ── последние матчи ──
    cv.panel((860, 758, 1258, 1222))
    cv.head(884, 782, 'ПОСЛЕДНИЕ МАТЧИ', 15, MUTED, spacing=3)
    rec = hist[:6]
    if rec:
        pw = round(sum(1 for h in rec if h.get('result') == 'win') * 100 / len(rec))
        cv.pill((1234, 776), f'{pw}% W', font('bold', 14), MUTED, SURF2, outline=LINE, padx=12, h=30, anchor='r')
    for i, h in enumerate(rec):
        w_ = h.get('result') == 'win'; x0 = 884 + i * 58
        cv.rr((x0, 828, x0 + 50, 878), 16, fill=mix(SURF2, WIN if w_ else LOSE, .22), outline=mix(LINE, WIN if w_ else LOSE, .5), width=1.2)
        cv.text((x0 + 25, 853), 'W' if w_ else 'L', font('disp', 17), WIN if w_ else LOSE, anchor='mm')
    ws = u.get('win_streak') or 0
    if ws > 0:
        cv.text((884, 902), ('Серия: 1 победа' if ws == 1 else f'Серия: {ws} побед подряд'), font('bold', 16), TEXT)
    if not rec:
        cv.text((1059, 1000), 'Матчей пока нет', font('bold', 18), MUTED, anchor='mm')
    for i, h in enumerate(hist[:3]):
        w_ = h.get('result') == 'win'; y0 = 934 + i * 94
        cv.rr((878, y0, 1240, y0 + 84), 22, fill=SURF2, outline=LINE, width=1)
        cv.grad_round((892, y0 + 16, 936, y0 + 60), 14, ACC2 if w_ else (130, 40, 70), (150, 40, 130) if w_ else (80, 30, 60), horizontal=False)
        cv.text((914, y0 + 38), 'W' if w_ else 'L', font('disp', 16), TEXT, anchor='mm')
        t, tf = cv.fit(f'{h.get("map") or "—"} · {"Победа" if w_ else "Поражение"}', 'bold', 17, 160, 12)
        cv.text((950, y0 + 16), t, tf, TEXT)
        sub = fmt_dt(h.get('match_date')) + (f' · {h["score_a"]}:{h["score_b"]}' if h.get('score_a') is not None else '')
        s2, f2 = cv.fit(sub, 'semi', 13, 160, 10)
        cv.text((950, y0 + 48), s2, f2, MUTED)
        d_ = int(h.get('elo_change') or 0)
        if h.get('kills') is not None:
            cv.text((1224, y0 + 20), f'{h["kills"]}/{h.get("deaths") or 0}/{h.get("assists") or 0}', font('disp', 16), TEXT, anchor='ra')
        cv.text((1224, y0 + 52), f'{d_:+d} ELO' if d_ else '0 ELO', font('bold', 15), WIN if d_ > 0 else (LOSE if d_ < 0 else MUTED), anchor='ra')

    cv.text((640, 1250), '@skfaceitbot', font('semi', 16), MUTED, anchor='mm', spacing=1.5)
    return cv.im.resize((W, H), Image.LANCZOS)



def fetch_rpc(name, args=None):
    body = json.dumps(args or {}).encode()
    req = urllib.request.Request(SUPABASE_URL + '/rest/v1/rpc/' + name, data=body, method='POST', headers={
        'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=6) as r:
        return json.loads(r.read().decode())


def avatar_at(cv, img, cx, cy, r, ring, letter='?', ring_w=4):
    cv.d.ellipse([(cx - r - ring_w) * K, (cy - r - ring_w) * K, (cx + r + ring_w) * K, (cy + r + ring_w) * K], fill=ring)
    cv.d.ellipse([(cx - r - 1) * K, (cy - r - 1) * K, (cx + r + 1) * K, (cy + r + 1) * K], fill=BG)
    if img is not None:
        sz = int(r * 2 * K); sc = max(sz / img.width, sz / img.height)
        a = img.resize((int(img.width * sc + .5), int(img.height * sc + .5)), Image.LANCZOS)
        l, t = (a.width - sz) // 2, (a.height - sz) // 2; a = a.crop((l, t, l + sz, t + sz))
        m = Image.new('L', (sz, sz), 0); ImageDraw.Draw(m).ellipse((0, 0, sz - 1, sz - 1), fill=255)
        cv.im.paste(a, (int((cx - r) * K), int((cy - r) * K)), m)
    else:
        cv.d.ellipse([(cx - r) * K, (cy - r) * K, (cx + r) * K, (cy + r) * K], fill=(38, 54, 120))
        cv.text((cx, cy + 1), (letter or '?')[:1].upper(), font('disp', int(r * .9)), TEXT, anchor='mm')


def header(cv, title, sub, now_txt):
    cv.panel((22, 22, cv.w - 22, 150), r=34)
    cv.glow(1000, 80, 260, (70, 40, 140), .45); 
    cv.panel((22, 22, cv.w - 22, 150), r=34)
    cv.text((56, 62), 'STANDKNIFE', font('disp', 15), TEXT, spacing=3)
    cv.text((56, 86), 'F A C E I T', font('semi', 12), HI, spacing=4)
    cv.text((cv.w // 2, 86), title, font('disp', 38), TEXT, anchor='mm')
    cv.text((cv.w // 2, 122), sub, font('semi', 15), MUTED, anchor='mm', spacing=1.5)
    cv.text((cv.w - 56, 62), now_txt, font('bold', 16), MUTED, anchor='ra')
    cv.d.ellipse([(cv.w - 68) * K, (92) * K, (cv.w - 56) * K, (104) * K], fill=WIN)
    cv.text((cv.w - 78, 98), 'LIVE', font('disp', 12), WIN, anchor='rm', spacing=2)


def render_queue(q):
    h = 880
    cv = Cv(W, h)
    cv.glow(160, 180, 480, (24, 44, 120), .7); cv.glow(1150, 760, 520, (96, 24, 76), .5)
    now = datetime.now(timezone(timedelta(hours=3)))
    header(cv, 'ПОИСК МАТЧА', 'ОЧЕРЕДА ОБЩАЯ С САЙТОМ', now.strftime('%H:%M:%S МСК'))
    modes = [(2, int(q.get('q2') or 0), int(q.get('m2') or 0), 22), (5, int(q.get('q5') or 0), int(q.get('m5') or 0), 648)]
    for n, cnt, mm, x0 in modes:
        need = n * 2; box = (x0, 170, x0 + 610, 620)
        cv.panel(box, r=34)
        cv.text((x0 + 36, 214), f'{n} × {n}', font('disp', 46), TEXT, anchor='lm')
        cv.pill((x0 + 574, 196), 'В ОЧЕРЕДИ', font('disp', 12), HI, SURF2, outline=LINE, padx=14, h=36, anchor='r')
        cx, cy = x0 + 305, 390
        cv.ring(cx, cy, 108, min(1, cnt / need), th=18)
        cv.text((cx, cy - 20), str(cnt), font('disp', 70), TEXT, anchor='mm')
        cv.text((cx, cy + 40), f'из {need} игроков', font('semi', 16), MUTED, anchor='mm')
        left = need - cnt
        msg = 'Матч собирается!' if left <= 0 else (f'Не хватает {left} {"игрока" if 1 < left < 5 or left == 1 else "игроков"}' if left > 0 else '')
        cv.rr((x0 + 36, 540, x0 + 574, 596), 28, fill=SURF2, outline=LINE, width=1)
        cv.text((x0 + 305, 568), msg, font('bold', 20), WIN if left <= 0 else TEXT, anchor='mm')
    # матчи
    cv.panel((22, 640, W - 22, 836), r=34)
    cv.head(56, 668, 'СЕЙЧАС В МАТЧАХ', 16, MUTED, spacing=3)
    tot_m = int(q.get('m2') or 0) + int(q.get('m5') or 0); pin = int(q.get('p_in') or 0)
    cells = [('МАТЧЕЙ', str(tot_m), ACC2), ('ИГРОКОВ В ИГРЕ', str(pin), HI), ('МАТЧЕЙ 2×2', str(int(q.get('m2') or 0)), TEXT), ('МАТЧЕЙ 5×5', str(int(q.get('m5') or 0)), TEXT)]
    cw = (W - 44 - 72) / 4
    for i, (lab, val, col) in enumerate(cells):
        x0 = 36 + i * (cw + 12) + 12
        cv.rr((x0, 704, x0 + cw - 12, 818), 24, fill=SURF2, outline=LINE, width=1)
        cv.text((x0 + 22, 724), lab, font('semi', 13), MUTED, spacing=2.4)
        cv.text((x0 + 22, 790), val, font('disp', 40), col, anchor='ls')
    cv.text((640, 858), '@skfaceitbot', font('semi', 16), MUTED, anchor='mm', spacing=1.5)
    return cv.im.resize((W, h), Image.LANCZOS)


def render_top(rows, imgs):
    h = 1250
    cv = Cv(W, h)
    cv.glow(160, 200, 500, (24, 44, 120), .7); cv.glow(1150, 1000, 520, (96, 24, 76), .5); cv.glow(640, 330, 380, (80, 50, 20), .3)
    now = datetime.now(timezone(timedelta(hours=3)))
    header(cv, 'ТОП ИГРОКОВ', f'ЛУЧШИЕ {len(rows)} ПО ELO', now.strftime('%d.%m.%Y'))
    medals = [GOLD, (200, 210, 230), (205, 127, 80)]

    def person(i, x0, y0, w, hh, r_av, big):
        p = rows[i]; col = medals[i]; elo = int(p.get('elo') or 0)
        cv.rr((x0, y0, x0 + w, y0 + hh), 32, fill=SURF, outline=mix(LINE, col, .55), width=2)
        cv.glow(x0 + w / 2, y0 + 60, 150, mix(BG, col, .5), .35)
        cv.rr((x0, y0, x0 + w, y0 + hh), 32, outline=mix(LINE, col, .55), width=2)
        ay = y0 + 28 + r_av
        avatar_at(cv, imgs.get(i), x0 + w / 2, ay, r_av, col, p.get('username'), 5)
        # номер места
        bx, by = x0 + w / 2, ay + r_av + 4
        cv.d.ellipse([(bx - 22) * K, (by - 22) * K, (bx + 22) * K, (by + 22) * K], fill=col)
        cv.text((bx, by + 1), str(i + 1), font('disp', 22), (20, 20, 30), anchor='mm')
        t, tf = cv.fit(str(p.get('username') or '—'), 'disp', 24 if big else 20, w - 40, 12)
        cv.text((x0 + w / 2, by + 52), t, tf, TEXT, anchor='mm')
        cv.text((x0 + w / 2, by + 100), str(elo), font('disp', 44 if big else 36), col, anchor='mm')
        cv.text((x0 + w / 2, by + 136), 'ELO', font('semi', 14), MUTED, anchor='mm', spacing=3)
        m = int(p.get('matches') or 0); wr = round((p.get('wins') or 0) * 100 / m) if m else 0
        cv.text((x0 + w / 2, by + 164), f'{m} матч. · {wr}% побед', font('semi', 15), MUTED, anchor='mm')

    if len(rows) > 1: person(1, 22, 232, 398, 360, 56, False)
    if len(rows) > 0: person(0, 440, 170, 400, 422, 68, True)
    if len(rows) > 2: person(2, 860, 232, 398, 360, 56, False)

    rest = rows[3:15]
    for j, p in enumerate(rest):
        col_i, row_i = j // 6, j % 6
        x0 = 22 + col_i * 628; y0 = 616 + row_i * 94; rank = j + 4
        cv.rr((x0, y0, x0 + 610, y0 + 84), 26, fill=SURF2, outline=LINE, width=1)
        cv.text((x0 + 38, y0 + 42), str(rank), font('disp', 20), MUTED, anchor='mm')
        lvl = level_of(int(p.get('elo') or 0))[0]
        avatar_at(cv, imgs.get(rank - 1), x0 + 100, y0 + 42, 26, hexc(LVL_COL[lvl - 1]), p.get('username'), 3)
        t, tf = cv.fit(str(p.get('username') or '—'), 'bold', 21, 280, 12)
        cv.text((x0 + 148, y0 + 24), t, tf, TEXT)
        m = int(p.get('matches') or 0); w_ = int(p.get('wins') or 0); l_ = int(p.get('losses') or 0)
        wr = round(w_ * 100 / m) if m else 0
        cv.text((x0 + 148, y0 + 54), f'W {w_}  L {l_}  ·  {wr}%', font('semi', 14), MUTED)
        cv.text((x0 + 586, y0 + 30), str(int(p.get('elo') or 0)), font('disp', 24), HI, anchor='ra')
        cv.text((x0 + 586, y0 + 58), f'LVL {lvl}', font('bold', 14), hexc(LVL_COL[lvl - 1]), anchor='ra')
    if not rows:
        cv.text((640, 600), 'Пока нет игроков', font('bold', 22), MUTED, anchor='mm')
    cv.text((640, 1222), '@skfaceitbot', font('semi', 16), MUTED, anchor='mm', spacing=1.5)
    return cv.im.resize((W, h), Image.LANCZOS)


def build_queue():
    return render_queue(fetch_rpc('queue_card') or {})


def build_top():
    rows = fetch_rpc('top_card', {'p_limit': 15}) or []
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(get_image, [r.get('avatar_url') for r in rows]))
    return render_top(rows, {i: im for i, im in enumerate(res)})



def build(uid):
    card = fetch_card(uid)
    if not card: return None
    msk = datetime.now(timezone(timedelta(hours=3)))
    card['today'] = msk.strftime('%d.%m.%Y')
    u = card['u']; maps = card.get('maps') or []
    jobs = {'avatar': u.get('avatar_url'), 'banner': card.get('banner')}
    for i, m in enumerate(maps[:4]):
        jobs[f'map{i}'] = m.get('img') or (f"/maps/{m['mid']}.jpg" if m.get('mid') else None)
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = dict(zip(jobs.keys(), ex.map(get_image, jobs.values())))
    return render(card, res)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        uid = (q.get('id') or [''])[0]
        try:
            kind = (q.get('type') or [''])[0]
            if kind == 'queue': im = build_queue()
            elif kind == 'top': im = build_top()
            else:
                if not UUID_RE.match(uid): raise ValueError('bad id')
                im = build(uid)
            if im is None: raise LookupError('not found')
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=90, optimize=False)
            body = buf.getvalue(); code = 200; ctype = 'image/jpeg'
        except ValueError:
            body = b'bad id'; code = 400; ctype = 'text/plain'
        except LookupError:
            body = b'not found'; code = 404; ctype = 'text/plain'
        except Exception as e:
            body = ('error: %s' % e).encode(); code = 500; ctype = 'text/plain'
        self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(body)
