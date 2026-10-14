'use strict';
/* =====================================================================
   Улучшенное распознавание скриншотов (K/D/A). Подключается после app.js и
   заменяет ocrRun из app.js. Ники ищутся прежним кодом (он работал), а цифры:
   1) колонки определяются по X-координатам цифр всех строк (а не «справа налево»);
   2) каждая строка с цифрами распознаётся ЕЩЁ РАЗ отдельно: увеличенная, только цифры, 2 варианта обработки;
   3) значение = то, что совпало в 2+ проходах; порядок колонок проверяется по счёту (≈ 2·У + П).
   Ничего не подставляется «наугад»: если не уверены — пусто или жёлтым.
   ===================================================================== */
(function () {
  const isNum = t => /^\d{1,3}$/.test(String(t || '').trim());
  /* Загрузка Tesseract.js (бесплатно, в браузере; без ключей и оплаты) */
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = () => res();
      s.onerror = () => rej(new Error('Не загрузилась библиотека распознавания'));
      document.head.appendChild(s);
    });
  }
  /* Похожесть ника на строку из скриншота, 0..1 (та же логика, что в app.js) */
  const ocrFindName = (name, text) => ocrNameScore(name, text);
  /* убираем клан-тег в начале строки: «[R7AY] truschka» → «truschka» (и варианты с (…) / {…}) */
  const cleanTag = t => String(t || '').replace(/^[^\p{L}\p{N}]*[\[\(\{][^\]\)\}]{0,10}[\]\)\}]?\s*/u, '');
  const cx = w => (w.bbox.x0 + w.bbox.x1) / 2, cyy = w => (w.bbox.y0 + w.bbox.y1) / 2;
  const consistent = (k, a, s) => k != null && a != null && s != null && s >= 2 * k + a - 1 && s <= 2 * k + a + 14;

  /* 1D-кластеризация X-центров цифр → колонки */
  function clusterCols(xs, minCount, gap) {
    xs = xs.slice().sort((p, q) => p - q);
    const groups = [];
    xs.forEach(x => { const g = groups[groups.length - 1]; if (g && x - g.max <= gap) { g.v.push(x); g.max = x; } else groups.push({ v: [x], min: x, max: x }); });
    return groups.filter(g => g.v.length >= minCount).map(g => ({ x: g.v.reduce((s, y) => s + y, 0) / g.v.length, min: g.min, max: g.max, n: g.v.length }));
  }

  /* Выбор ролей колонок: перебор, победитель — максимум строк, где счёт сходится; приоритет — порядок У П С Счёт [Пинг] */
  function pickRoles(rows, ncol) {
    const defStart = Math.max(0, ncol - 5);
    const def = [defStart, defStart + 1, defStart + 2, defStart + 3];
    let best = null;
    const idx = [...Array(ncol).keys()];
    const tryTuple = t => {
      const [ck, ca, cd, cs] = t; let ok = 0, filled = 0, kSum = 0;
      rows.forEach(r => { const k = r.v[ck], a = r.v[ca], d = r.v[cd], s = r.v[cs]; if (k != null && a != null && s != null) { filled++; if (consistent(k, a, s)) ok++; } if (k != null) kSum += k; });
      const prior = t.every((c, i) => c === def[i]) ? 3 : 0;
      const val = ok * 10 + prior - (filled < rows.length ? 0 : 0);
      if (!best || val > best.val) best = { t, val, ok };
    };
    if (ncol < 4) return null;
    idx.forEach(a => idx.forEach(b => { if (b === a) return; idx.forEach(c => { if (c === a || c === b) return; idx.forEach(d => { if (d === a || d === b || d === c) return; tryTuple([a, b, c, d]); }); }); }));
    return best;
  }

  const majority = arr => {
    const c = {}; arr.filter(x => x != null).forEach(x => { c[x] = (c[x] || 0) + 1; });
    let bv = null, bn = 0; Object.keys(c).forEach(k => { if (c[k] > bn) { bn = c[k]; bv = Number(k); } });
    return { v: bv, n: bn };
  };

  /* Строки по половине скриншота — как в app.js, но с bbox */
  function sideLinesFull(words, x0, x1) {
    const ws = words.filter(w => (w.text || '').trim() && cx(w) >= x0 && cx(w) < x1).sort((p, q) => cyy(p) - cyy(q));
    if (!ws.length) return [];
    const hs = ws.map(w => w.bbox.y1 - w.bbox.y0).sort((p, q) => p - q), tol = Math.max(6, hs[Math.floor(hs.length / 2)] * 0.6);
    const lines = [];
    ws.forEach(w => { const l = lines[lines.length - 1]; if (l && Math.abs(cyy(w) - l.y) <= tol) { l.w.push(w); l.y = (l.y * (l.w.length - 1) + cyy(w)) / l.w.length; } else lines.push({ y: cyy(w), w: [w] }); });
    lines.forEach(l => { l.w.sort((p, q) => cx(p) - cx(q)); l.text = l.w.map(w => w.text).join(' '); l.y0 = Math.min(...l.w.map(w => w.bbox.y0)); l.y1 = Math.max(...l.w.map(w => w.bbox.y1)); });
    return lines;
  }
  function nameEndX(line, name) {
    const n = ocrNorm(name); let end = null;
    line.w.forEach(w => { const wn = ocrNorm(w.text); if (wn.length >= 2 && !/^\d+$/.test(wn) && (n.includes(wn) || ocrLev(n, wn) <= Math.ceil(n.length * 0.3))) end = Math.max(end == null ? 0 : end, w.bbox.x1); });
    if (end == null) line.w.forEach(w => { if (/[a-zа-яё]/i.test(w.text)) end = Math.max(end == null ? 0 : end, w.bbox.x1); });
    return end == null ? 0 : end;
  }

  /* ───── работа с картинкой ───── */
  const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('картинка не открылась')); im.src = src; });
  function grayCanvas(src, sx, sy, sw, sh, scale, mode) {
    const c = document.createElement('canvas'); c.width = Math.max(8, Math.round(sw * scale)); c.height = Math.max(8, Math.round(sh * scale));
    const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data, n = c.width * c.height, gr = new Uint8Array(n);
    let sum = 0; for (let i = 0; i < n; i++) { const v = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000; gr[i] = v; sum += v; }
    const dark = sum / n < 128;                     // светлый текст на тёмном → инвертируем (Tesseract любит чёрное на белом)
    if (dark) for (let i = 0; i < n; i++) gr[i] = 255 - gr[i];
    let lo = 255, hi = 0; for (let i = 0; i < n; i++) { if (gr[i] < lo) lo = gr[i]; if (gr[i] > hi) hi = gr[i]; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) gr[i] = (gr[i] - lo) * 255 / span;   // растяжка контраста
    if (mode === 'bin') {                           // порог Оцу
      const h = new Array(256).fill(0); for (let i = 0; i < n; i++) h[gr[i] | 0]++;
      let tot = n, sB = 0, sAll = 0; for (let t = 0; t < 256; t++) sAll += t * h[t];
      let wB = 0, mx = -1, th = 128; for (let t = 0; t < 256; t++) { wB += h[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += t * h[t]; const mB = sB / wB, mF = (sAll - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > mx) { mx = v; th = t; } }
      for (let i = 0; i < n; i++) gr[i] = gr[i] > th ? 255 : 0;
    }
    for (let i = 0; i < n; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = gr[i]; d[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const pad = 24, o = document.createElement('canvas'); o.width = c.width + pad * 2; o.height = c.height + pad * 2;
    const og = o.getContext('2d'); og.fillStyle = '#fff'; og.fillRect(0, 0, o.width, o.height); og.drawImage(c, pad, pad);
    return { canvas: o, pad };
  }

  /* ───── анализ одного скриншота ───── */
  /* Ники: сравниваем два варианта разбиения (по половинам экрана и одной общей колонкой) и берём лучший */
  function scoreNames(m, words, midX, W) {
    /* каждое слово отдельно (не склеенная строка): Tesseract часто сливает соседние строки таблицы */
    const tok = (x0, x1) => words
      .filter(w => { const c = (w.bbox.x0 + w.bbox.x1) / 2; return c >= x0 && c < x1; })
      .map(w => ({ name: cleanTag(w.text) }))
      .filter(p => p.name.replace(/[^\p{L}\p{N}]/gu, '').length >= 4);
    const split = { sides: [ { players: tok(0, midX) }, { players: tok(midX, W + 1) } ] };
    const whole = { sides: [ { players: tok(0, W + 1) } ] };
    const a = ocrAnalyze(m, split), b = ocrAnalyze(m, whole);
    const na = a.players.filter(p => p.ok).length, nb = b.players.filter(p => p.ok).length;
    /* диагностика: для каждого игрока из базы — лучший балл среди слов скриншота */
    try {
      const toks = whole.sides[0].players.map(p => p.name);
      const rep = [...(m.blue || []), ...(m.orange || [])].map(pl => {
        const best = toks.reduce((mx, t) => Math.max(mx, ocrNameScore(pl.username, t)), 0);
        const bt = toks.find(t => ocrNameScore(pl.username, t) === best) || '-';
        return `${pl.username} → ${best.toFixed(2)} (${bt})`;
      });
      (window.__ocrLog = window.__ocrLog || []).push('слова: ' + toks.join(' | ') + '\nбаллы: ' + rep.join('; '));
    } catch (e) { /* диагностика не должна ломать распознавание */ }
    return nb > na ? { n: nb, an: b } : { n: na, an: a };
  }

  /* Строка статистики → {k, a, d, score, ping}. Порядок колонок: У (убийства) П (помощь) С (смерти) Счёт [Пинг]. Деньги отбрасываем. */
  function parseStats(tokens) {
    const nums = [];
    tokens.forEach(t => {
      const s = String(t || '').trim();
      if (/[$Ss]$/.test(s) || /^\d{4,}$/.test(s)) return;   // деньги (5600$, 5600S, 5600)
      if (/^\d{1,3}$/.test(s)) nums.push(Number(s));
    });
    if (nums.length < 4) return null;
    const [k, a, d, score] = nums;
    if (k > 60 || a > 60 || d > 60 || score > 60) return null;
    return { k, a, d, score, ping: nums.length > 4 ? nums[4] : null };
  }

  async function analyzeShot(m, src, wNames, wDigits) {
    const im = await loadImg(src), W = im.naturalWidth, H = im.naturalHeight;
    const midX = W / 2;
    /* несколько вариантов картинки для распознавания ников: мелкий текст плохо читается с одного прохода */
    const variants = [
      { mode: 'gray', s: Math.max(1, Math.min(3, 2200 / W)) },
      { mode: 'bin',  s: Math.max(1, Math.min(3, 2200 / W)) },
      { mode: 'gray', s: Math.max(1, Math.min(4, 3000 / W)) }
    ];
    let best = null;
    for (const v of variants) {
      const p = grayCanvas(im, 0, 0, W, H, v.s, v.mode);
      let r;
      try { r = await wNames.recognize(p.canvas); } catch (e) { continue; }
      const words = (r.data.words || []).filter(w => w && w.bbox).map(w => ({ text: w.text, bbox: {
        x0: (w.bbox.x0 - p.pad) / v.s, x1: (w.bbox.x1 - p.pad) / v.s,
        y0: (w.bbox.y0 - p.pad) / v.s, y1: (w.bbox.y1 - p.pad) / v.s } }));
      if (!words.length) continue;
      const cand = scoreNames(m, words, midX, W);
      const line = `[${v.mode} x${v.s.toFixed(2)}] слов: ${words.length}, ников: ${cand.n}\n${words.map(w => w.text).join(' | ')}`;
      console.log('OCR pass', line); (window.__ocrLog = window.__ocrLog || []).push(line);
      if (!best || cand.n > best.n || (cand.n === best.n && words.length > best.words.length)) best = { n: cand.n, an: cand.an, words };
    }
    if (!best) throw new Error('не удалось определить расположение текста');
    const words = best.words;
    const an = best.an;   // ники, победитель, счёт, карта — прежний код из app.js
    const mid = W / 2, sidesW = { L: [0, mid], R: [mid, W + 1] };
    const sideLines = { L: sideLinesFull(words, 0, mid), R: sideLinesFull(words, mid, W + 1) };
    const sideOfTeamFn = (() => {
      const variants = p => [p.username || '', (p.username || '').replace(/\[[^\]]*\]/g, '')];
      const sim = (p, t) => Math.max(...variants(p).map(n => ocrFindName(n, ocrNorm(cleanTag(t)))));
      const cnt = (arr, ls) => arr.filter(p => ls.some(l => sim(p, l.text) > 0)).length;
      const bl = cnt(m.blue, sideLines.L) + cnt(m.orange, sideLines.R), br = cnt(m.blue, sideLines.R) + cnt(m.orange, sideLines.L);
      const blueSide = bl >= br ? 'L' : 'R';
      return { sim, side: team => (team === 'blue') === (blueSide === 'L') ? 'L' : 'R' };
    })();

    for (const sideKey of ['L', 'R']) {
      const team = sideOfTeamFn.side('blue') === sideKey ? 'blue' : 'orange';
      const plist = an.players.filter(p => p.team === team && p.ok);
      const rows = [];
      plist.forEach(pl => {
        const player = (team === 'blue' ? m.blue : m.orange).find(x => String(x.id) === String(pl.id));
        let best = null, bs = 0;
        sideLines[sideKey].forEach(l => { const sc = sideOfTeamFn.sim(player, l.text); if (sc > bs) { bs = sc; best = l; } });
        if (!best) return;
        const ne = nameEndX(best, player.username);
        const nums = best.w.filter(w => isNum(w.text) && w.bbox.x0 >= ne - 2);
        rows.push({ pl, line: best, nums, y0: best.y0, y1: best.y1 });
      });
      if (rows.length < 1) continue;
      for (const r of rows) {
        const player = (team === 'blue' ? m.blue : m.orange).find(x => String(x.id) === String(r.pl.id));
        const x0 = Math.max(sidesW[sideKey][0], nameEndX(r.line, player ? player.username : '') + 2);
        const x1 = sidesW[sideKey][1];
        const hh = r.y1 - r.y0;
        const sy0 = Math.max(0, r.y0 - hh * 0.3), sh = Math.min(H - sy0, hh * 1.6);
        const sc = Math.max(2, Math.min(6, 90 / Math.max(10, hh)));
        const reads = [];
        for (const mode of ['bin', 'gray']) {
          try {
            const cv = grayCanvas(im, x0, sy0, x1 - x0, sh, sc, mode);
            const rr = await wDigits.recognize(cv.canvas);
            const toks = (rr.data.words || []).filter(w => w && w.bbox).sort((p, q) => p.bbox.x0 - q.bbox.x0).map(w => w.text);
            reads.push(parseStats(toks));
          } catch (e) { reads.push(null); }
        }
        const [r1, r2] = reads;
        const same = !!(r1 && r2 && r1.k === r2.k && r1.a === r2.a && r1.d === r2.d);
        const pick = same ? r1 : (r1 || r2 || null);
        r.pl.k = pick ? pick.k : null;
        r.pl.a = pick ? pick.a : null;
        r.pl.d = pick ? pick.d : null;
        r.pl.conf = !pick ? null : (same ? 'ok' : 'low');
      }
    }
    /* победитель: слово ПОБЕДА над командой; счёт: цифры рядом с ним по обе стороны от центра */
    try {
      const pob = words.find(w => /ПОБЕД/i.test(w.text));
      if (pob) {
        const px = (pob.bbox.x0 + pob.bbox.x1) / 2, py = (pob.bbox.y0 + pob.bbox.y1) / 2;
        const winSide = px < mid ? 'L' : 'R';
        const leftTeam = sideOfTeamFn.side('blue') === 'L' ? 'blue' : 'orange';
        const rightTeam = leftTeam === 'blue' ? 'orange' : 'blue';
        an.win = winSide === 'L' ? leftTeam : rightTeam;
        const near = words.filter(w => /^\d{1,2}$/.test(w.text.trim()) && Math.abs((w.bbox.y0 + w.bbox.y1) / 2 - py) < 30 * (H / 600));
        const lw = near.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 < mid).sort((a, b) => b.bbox.x1 - a.bbox.x1)[0];
        const rw = near.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 >= mid).sort((a, b) => a.bbox.x0 - b.bbox.x0)[0];
        const sL = lw ? Number(lw.text) : null, sR = rw ? Number(rw.text) : null;
        an.scBlue = leftTeam === 'blue' ? sL : sR;
        an.scOrange = leftTeam === 'blue' ? sR : sL;
      }
    } catch (e) { /* счёт и победитель — необязательны */ }
    return an;
  }

  /* ───── запуск (замена ocrRun из app.js) ───── */
  window.ocrRun = ocrRun = async function (id) {
    const m = (S.admMatchObj || {})[String(id)], shots = (S.admShotList || {})[String(id)] || [];
    const box = $('ocr-' + id); if (!m || !box) return;
    if (!shots.length) return toast('info', 'Нет скриншотов', '');
    box.innerHTML = '<div class="am-none"><i class="fas fa-spinner fa-spin"></i> Распознаём… (первый раз дольше — загружается модель)</div>';
    let wN = null, wD = null;
    try {
      await loadTesseract();
      wN = await Tesseract.createWorker('rus+eng');
      try { await wN.setParameters({ tessedit_pageseg_mode: '11' }); } catch (e) { /* ок */ }
      wD = await Tesseract.createWorker('eng');
      try { await wD.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789', classify_bln_numeric_mode: '1' }); } catch (e) { /* ок */ }
      S.ocrRes = S.ocrRes || {}; S.ocrRes[id] = [];
      window.__ocrLog = [];
      const out = [];
      for (const sh of shots) {
        const an = await analyzeShot(m, sh.image, wN, wD);
        S.ocrRes[id].push(an); out.push({ by: sh.username, an, idx: S.ocrRes[id].length - 1 });
      }
      box.innerHTML = out.map(o => {
        const a = o.an, nm = t => t === 'blue' ? 'Спецназ' : 'Террористы';
        const found = a.players.filter(p => p.ok).length, withStats = a.players.filter(p => p.k != null).length;
        const sc = a.scBlue != null && a.scOrange != null ? `${a.scBlue}:${a.scOrange}` : 'счёт не распознан';
        const w = a.win ? `Победа: <b>${nm(a.win)}</b>` : 'победитель не распознан';
        const rows = a.players.map(p => `<div class="ocr-pl ${p.ok ? '' : 'miss'}"><span class="ocr-n">${p.ok ? '<i class="fas fa-check"></i>' : '<i class="fas fa-xmark"></i>'} ${esc(p.name)}</span>
          <span class="ocr-kda ${p.conf || ''}">${p.k != null ? `<b>${p.k}</b> / <b>${p.d}</b> / <b>${p.a}</b>` : '—'}</span></div>${p.raw ? `<div class="ocr-note" style="margin:-4px 0 6px;text-align:right">видно: ${esc(p.raw)}</div>` : ''}`).join('');
        return `<div class="ocr-card"><div class="ocr-h">Скриншот от <b>${esc(o.by)}</b></div>
          <div class="ocr-row"><i class="fas fa-trophy"></i> ${w} · счёт ${sc}${a.map ? ' · ' + esc(a.map) : ''}</div>
          <div class="ocr-row"><i class="fas fa-users"></i> Ников: <b>${found}/${a.players.length}</b> · K/D/A: <b>${withStats}/${a.players.length}</b></div>
          <div class="ocr-th"><span>Игрок</span><span>K / D / A</span></div>${rows}
          <button class="btn btn-primary btn-sm btn-block" style="margin-top:10px" data-act="ocr-apply" data-id="${esc(id)}" data-idx="${o.idx}"><i class="fas fa-pen"></i> Подставить в форму</button></div>`;
      }).join('') + '<div class="ocr-note">Зелёные K/D/A — совпали в нескольких проходах и сходятся со счётом. Жёлтые — сомнительные, сверьте со скриншотом. Пусто — не распознано, ничего не подставляется наугад. «Видно» — сырые числа колонок строки. Зачёт делаете вы.</div>';
      box.insertAdjacentHTML('beforeend', '<details style="margin-top:10px"><summary style="font-size:12px;opacity:.7">Отладка распознавания</summary><pre style="white-space:pre-wrap;font-size:11px;max-height:240px;overflow:auto;background:#0a0f1e;padding:8px;border-radius:8px">' + esc('build: v7-rows\n\n' + (window.__ocrLog || []).join('\n\n') || 'лог пуст') + '</pre></details>');
    } catch (e) {
      box.innerHTML = `<div class="am-none">Не получилось: ${esc(errText(e))}</div>`;
    } finally { for (const w of [wN, wD]) if (w) { try { await w.terminate(); } catch (e) { /* ок */ } } }
  };

  window.__ocr2 = { clusterCols, pickRoles, majority, consistent };   // для тестов
})();
