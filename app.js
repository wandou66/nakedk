/* 裸K复盘工作台 · 前端 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const chart = klinecharts.init('chart', { styles: 'dark', locale: 'zh-CN' });
  window.__chart = chart;
  const S = {
    id: null, src: 'binance-perp', symbol: null, coin: '', label: '', tf: '15m',
    bars: [], prec: 4, scale: 'linear', theme: 'dark', unit: 'U',
    trades: [], watchlist: { groups: [] }, drawings: [], tool: null, selectedId: null,
    note: '', noteTimer: null, openGroups: {},
    ui: { left: false, right: false, focus: false },
    replay: { active: false, bars: [], idx: 0, startIdx: 0, pos: null, closed: [], orders: [], playing: false, timer: null, capital: 10000, hasPrev: true, hasMore: true, loading: false },
  };

  /* ------------------------------ 基础工具 ------------------------------ */

  function toast(msg, err) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), err ? 4200 : 2200);
  }
  let busyN = 0;
  function busy(on) {
    busyN = Math.max(0, busyN + (on ? 1 : -1));
    $('loading').classList.toggle('hidden', busyN === 0);
  }
  async function api(path, opts) {
    if (window.NK_API) return window.NK_API(path, opts);
    const res = await fetch(path, opts);
    const txt = await res.text();
    let data;
    try { data = txt ? JSON.parse(txt) : {}; } catch (_) { throw new Error('返回异常: ' + txt.slice(0, 100)); }
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }
  const uid = () => Math.random().toString(36).slice(2, 10);
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

  function closeDrawers() {
    document.body.classList.remove('mobile-left-open', 'mobile-right-open');
    $('backdrop').classList.add('hidden');
  }

  function toggleDrawer(side) {
    const openClass = side === 'left' ? 'mobile-left-open' : 'mobile-right-open';
    const other = side === 'left' ? 'mobile-right-open' : 'mobile-left-open';
    const willOpen = !document.body.classList.contains(openClass);
    document.body.classList.remove(other);
    document.body.classList.toggle(openClass, willOpen);
    $('backdrop').classList.toggle('hidden', !willOpen);
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtPx = (v) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(S.prec));
  const fmtNum = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 2 : d));
  const fmtTime = (ts) => new Date(ts).toLocaleString('zh-CN', { timeZone: 'UTC', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const tsToInput = (ts) => new Date(ts).toISOString().slice(0, 19);
  const inputToTs = (s) => (s ? new Date(s + 'Z').getTime() : null);

  function precision(p) {
    if (p >= 10000) return 1;
    if (p >= 1000) return 2;
    if (p >= 100) return 2;
    if (p >= 10) return 3;
    if (p >= 1) return 4;
    if (p >= 0.01) return 5;
    if (p >= 0.0001) return 6;
    return 8;
  }

  /* ------------------------------ 坐标 / 主题 --------------------------- */

  const SCALES = { linear: 'normal', log: 'log', pct: 'percentage' };

  function transformBar(b) { return b; }
  function transformBars(list) { return list; }
  function toChartPoints(points) { return points || []; }
  function fromChartPoints(points) { return points || []; }

  function chartStyles(theme) {
    if (theme === 'dark') {
      return {
        grid: { show: false, horizontal: { color: '#000', size: 1, style: 'solid' }, vertical: { color: '#000', size: 1, style: 'solid' } },
        candle: {
          bar: { upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888' },
          priceMark: { last: { upColor: '#26a69a', downColor: '#ef5350' }, high: { color: '#6b7280' }, low: { color: '#6b7280' } },
          tooltip: { rect: { color: 'rgba(0,0,0,.92)', borderColor: '#222' }, text: { color: '#d1d4dc', size: 12 } },
        },
        xAxis: { tickText: { color: '#6b7280' }, axisLine: { color: '#1a1a1a' } },
        yAxis: { tickText: { color: '#6b7280' }, axisLine: { color: '#1a1a1a' } },
        crosshair: {
          horizontal: { line: { color: '#4b5563' }, text: { backgroundColor: '#1f2937' } },
          vertical: { line: { color: '#4b5563' }, text: { backgroundColor: '#1f2937' } },
        },
      };
    }
    return {
      grid: { show: true, horizontal: { color: '#eceff3' }, vertical: { color: '#eceff3' } },
      candle: {
        bar: { upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888' },
        priceMark: { last: { upColor: '#26a69a', downColor: '#ef5350' }, high: { color: '#9aa0a6' }, low: { color: '#9aa0a6' } },
        tooltip: { rect: { color: 'rgba(255,255,255,.96)', borderColor: '#e5e7eb' }, text: { color: '#1f2328', size: 12 } },
      },
      xAxis: { tickText: { color: '#6b7280' }, axisLine: { color: '#e5e7eb' } },
      yAxis: { tickText: { color: '#6b7280' }, axisLine: { color: '#e5e7eb' } },
      crosshair: {
        horizontal: { line: { color: '#9ca3af' }, text: { backgroundColor: '#f3f4f6' } },
        vertical: { line: { color: '#9ca3af' }, text: { backgroundColor: '#f3f4f6' } },
      },
    };
  }

  function applyTheme(theme) {
    S.theme = theme || S.theme;
    document.body.dataset.theme = S.theme;
    chart.setStyles(chartStyles(S.theme));
    $('btnTheme').textContent = S.theme === 'dark' ? '☀' : '☾';
    try { localStorage.setItem('nk.theme', S.theme); } catch (_) { /* 忽略 */ }
  }

  /* ------------------------------ 图表初始化 ---------------------------- */

  chart.setCustomApi({});

  function applyYAxisType() {
    chart.setStyles({ yAxis: { type: SCALES[S.scale] || 'normal' } });
  }

  /* ------------------------------ 自定义图形 ---------------------------- */

  function arrowTemplate(name, dir) {
    return {
      name,
      totalStep: 2,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures({ coordinates, overlay }) {
        const p = coordinates[0];
        if (!p || p.x == null) return [];
        const st = (overlay.styles && overlay.styles.polygon) || {};
        const color = st.color || (dir > 0 ? '#2962ff' : '#f23645');
        const baseY = p.y + dir * 20;
        const tailY = baseY + dir * 12;
        return [
          { type: 'line', attrs: { coordinates: [{ x: p.x, y: baseY }, { x: p.x, y: tailY }] }, styles: { color, size: 1.5 } },
          { type: 'polygon', attrs: { coordinates: [{ x: p.x, y: p.y }, { x: p.x - 5.5, y: baseY }, { x: p.x + 5.5, y: baseY }] }, styles: { color } },
        ];
      },
    };
  }

  const textNoteTemplate = {
    name: 'textNote',
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures({ coordinates, overlay, bounding }) {
      const p = coordinates[0];
      if (!p || p.x == null) return [];
      const raw = String(overlay.extendData == null ? '' : overlay.extendData);
      if (!raw) return [];
      const lines = raw.split('\n').slice(0, 6);
      const size = 12;
      const lineH = 17;
      const w = Math.min(bounding.width - 10, Math.max(...lines.map((l) => l.length)) * size * 0.92 + 16);
      const h = lines.length * lineH + 8;
      let bx = p.x + 26;
      let by = p.y - h - 18;
      if (bx + w > bounding.width - 4) bx = Math.max(2, p.x - w - 26);
      if (by < 2) by = p.y + 18;
      const st = (overlay.styles && overlay.styles.text) || {};
      const color = st.color || '#e6edf3';
      const figures = [
        { type: 'line', attrs: { coordinates: [{ x: p.x, y: p.y }, { x: bx + (bx > p.x ? 0 : w), y: by + h / 2 }] }, styles: { color: '#5d6573', size: 1, style: 'dashed' } },
      ];
      lines.forEach((ln, i) => {
        figures.push({
          type: 'text',
          attrs: { x: bx + 8, y: by + 6 + i * lineH + lineH / 2, text: ln, align: 'left', baseline: 'middle' },
          styles: {
            color, size, family: 'Microsoft YaHei, sans-serif',
            backgroundColor: 'rgba(19,23,34,.92)',
            paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
          },
        });
      });
      return figures;
    },
  };

  const rectTemplate = {
    name: 'rectangle',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures({ coordinates, overlay }) {
      const a = coordinates[0];
      const b = coordinates[1];
      if (!a || !b) return [];
      const st = (overlay.styles && (overlay.styles.line || overlay.styles.rect)) || {};
      const color = st.borderColor || st.color || '#2962ff';
      const corners = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
      const figures = [];
      for (let i = 0; i < 4; i++) {
        figures.push({ type: 'line', attrs: { coordinates: [corners[i], corners[(i + 1) % 4]] }, styles: { color, size: 1 } });
      }
      return figures;
    },
  };

  klinecharts.registerOverlay(arrowTemplate('arrowUp', 1));
  klinecharts.registerOverlay(arrowTemplate('arrowDown', -1));
  klinecharts.registerOverlay(textNoteTemplate);
  klinecharts.registerOverlay(rectTemplate);
  klinecharts.registerOverlay({
    name: 'closeTag',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures({ coordinates, overlay }) {
      const p = coordinates[0];
      if (!p || p.x == null) return [];
      const st = (overlay.styles && overlay.styles.line) || {};
      const color = st.color || '#f0b000';
      return [
        { type: 'line', attrs: { coordinates: [{ x: p.x - 14, y: p.y }, { x: p.x + 14, y: p.y }] }, styles: { color, size: 2 } },
        { type: 'line', attrs: { coordinates: [{ x: p.x, y: p.y - 5 }, { x: p.x, y: p.y + 5 }] }, styles: { color, size: 1.5 } },
      ];
    },
  });

  klinecharts.registerOverlay({
    name: 'closeMark',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures({ coordinates, overlay }) {
      const p = coordinates[0];
      if (!p || p.x == null) return [];
      const st = (overlay.styles && overlay.styles.line) || {};
      const color = st.color || '#f0b000';
      const s = 5;
      return [
        { type: 'line', attrs: { coordinates: [{ x: p.x - s, y: p.y - s }, { x: p.x + s, y: p.y + s }] }, styles: { color, size: 1.6 } },
        { type: 'line', attrs: { coordinates: [{ x: p.x - s, y: p.y + s }, { x: p.x + s, y: p.y - s }] }, styles: { color, size: 1.6 } },
      ];
    },
  });

  /* ------------------------------ 品种搜索 ------------------------------ */

  let searchTimer = null, searchItems = [], searchIdx = -1;

  function bindSearch() {
    const inp = $('q');
    const box = $('results');

    inp.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const kw = inp.value.trim();
      if (!kw) { box.classList.add('hidden'); return; }
      searchTimer = setTimeout(async () => {
        try {
          const j = await api('/api/catalog?q=' + encodeURIComponent(kw));
          searchItems = j.items || [];
          searchIdx = -1;
          renderResults();
        } catch (e) { toast('搜索失败: ' + e.message, true); }
      }, 200);
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { searchIdx = Math.min(searchItems.length - 1, searchIdx + 1); renderResults(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { searchIdx = Math.max(0, searchIdx - 1); renderResults(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        const pick = searchItems[searchIdx] || searchItems[0];
        if (pick) { selectSymbol(pick); inp.value = ''; box.classList.add('hidden'); }
        e.preventDefault();
      } else if (e.key === 'Escape') box.classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && e.target !== inp) box.classList.add('hidden');
    });

    function renderResults() {
      if (!searchItems.length) { box.innerHTML = '<div class="ddcoin">没有匹配</div>'; box.classList.remove('hidden'); return; }
      const byCoin = new Map();
      searchItems.forEach((it) => {
        if (!byCoin.has(it.coin)) byCoin.set(it.coin, []);
        byCoin.get(it.coin).push(it);
      });
      box.innerHTML = '';
      let i = 0;
      byCoin.forEach((list, coin) => {
        const h = document.createElement('div');
        h.className = 'ddcoin';
        h.textContent = coin;
        box.appendChild(h);
        list.forEach((it) => {
          const d = document.createElement('div');
          d.className = 'dditem' + (i === searchIdx ? ' active' : '');
          d.innerHTML = '<span class="nm">' + esc(it.coin) + '</span><span class="tag">' + esc(it.label.replace(it.coin, '').trim()) + '</span>';
          d.onclick = () => { selectSymbol(it); inp.value = ''; box.classList.add('hidden'); };
          box.appendChild(d);
          i++;
        });
      });
      box.classList.remove('hidden');
    }
  }

  function selectSymbol(it) {
    if (S.replay.active) abortReplay();
    closeDrawers();
    S.id = it.id; S.src = it.src; S.symbol = it.symbol; S.coin = it.coin; S.label = it.label;
    $('curName').textContent = it.coin;
    $('curMeta').textContent = it.label.replace(it.coin, '').trim() + ' · ' + it.symbol;
    renderWatchlist();
    loadAll();
  }

  /* ------------------------------ 行情加载 ------------------------------ */

  async function loadAll() {
    if (!S.symbol) return;
    const wasReplay = S.replay.active;
    const keepTs = wasReplay && S.replay.bars[S.replay.idx] ? S.replay.bars[S.replay.idx].timestamp : null;
    busy(true);
    try {
      if (wasReplay && keepTs) {
        await loadReplayWindow(keepTs);
        const st = S.replay;
        if (st.bars.length) {
          S.prec = precision(st.bars[st.idx].close);
          chart.setPriceVolumePrecision(S.prec, 0);
        }
        applySlice();
        renderReplayInfo();
        renderPos();
        await Promise.all([loadDrawings(), loadTrades(), loadNote(), loadSession()]);
        return;
      }

      const j = await api('/api/kline?src=' + encodeURIComponent(S.src) + '&symbol=' + encodeURIComponent(S.symbol) + '&tf=' + encodeURIComponent(S.tf));
      S.bars = j.bars || [];
      if (!S.bars.length) throw new Error('没有 K 线数据');
      S.prec = precision(S.bars[S.bars.length - 1].close);
      chart.setPriceVolumePrecision(S.prec, 0);
      chart.applyNewData(transformBars(S.bars));
      chart.scrollToRealTime(0);
      chart.setBarSpace(7);

      await Promise.all([loadDrawings(), loadTrades(), loadNote(), loadSession()]);
    } catch (e) {
      toast(e.message, true);
    } finally {
      busy(false);
    }
  }

  /* ------------------------------ 绘图 ------------------------------ */

  const TOOLS = [
    { k: 'arrowUp', label: '↑', title: '向上箭头' },
    { k: 'arrowDown', label: '↓', title: '向下箭头' },
    { k: 'textNote', label: 'T', title: '文字标注（带引线）' },
    { k: 'segment', label: '╱', title: '线段' },
    { k: 'horizontalStraightLine', label: '─', title: '水平线' },
    { k: 'verticalStraightLine', label: '│', title: '垂直线' },
    { k: 'rectangle', label: '▭', title: '矩形' },
    { k: 'priceChannelLine', label: '▱', title: '箱体/通道' },
    { k: 'rayLine', label: '⟋', title: '射线' },
    { k: 'priceLine', label: '⌗', title: '价格线' },
    { k: 'fibonacciLine', label: 'φ', title: '斐波那契' },
  ];

  const TOOL_STYLES = {
    arrowUp: { polygon: { color: '#2962ff' }, line: { color: '#2962ff', size: 1.5 } },
    arrowDown: { polygon: { color: '#f23645' }, line: { color: '#f23645', size: 1.5 } },
    textNote: { text: { color: '#e6edf3', size: 12 }, line: { color: '#5d6573', size: 1, style: 'dashed' } },
    rectangle: { line: { color: '#2962ff', size: 1 } },
    segment: { line: { color: '#f0b90b', size: 1.5 } },
    rayLine: { line: { color: '#f0b90b', size: 1.5 } },
    horizontalStraightLine: { line: { color: '#2962ff', size: 1 } },
    verticalStraightLine: { line: { color: '#787b86', size: 1, style: 'dashed' } },
    priceChannelLine: { line: { color: '#26a69a', size: 1 } },
    priceLine: { line: { color: '#f23645', size: 1, style: 'dashed' } },
    fibonacciLine: { line: { color: '#9c6ade', size: 1 }, text: { color: '#c7b3ff', size: 11 } },
  };

  function buildRail() {
    const rail = $('drawbar');
    rail.innerHTML = '';
    TOOLS.forEach((t) => {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.title = t.title || t.k;
      b.dataset.tool = t.k;
      b.onclick = () => toggleTool(t.k);
      rail.appendChild(b);
    });
    const sep = document.createElement('div'); sep.className = 'rsep'; rail.appendChild(sep);
    const del = document.createElement('button');
    del.textContent = '✕'; del.title = '删除所选标注（Delete）'; del.onclick = removeSelected;
    rail.appendChild(del);
    const clr = document.createElement('button');
    clr.textContent = '⌫'; clr.title = '清空本图标注'; clr.onclick = clearDrawings;
    rail.appendChild(clr);
  }

  function toggleTool(name) {
    if (S.tool === name) { S.tool = null; paintToolbar(); return; }
    S.tool = name;
    paintToolbar();
    startDraw(name);
  }
  function paintToolbar() {
    document.querySelectorAll('#drawbar button[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
  }
  function startDraw(name) {
    chart.createOverlay({
      name,
      styles: TOOL_STYLES[name],
      onDrawEnd: (ev) => {
        const ov = ev.overlay;
        S.selectedId = ov.id;
        if (ov.name === 'textNote') {
          const txt = prompt('标注内容（可多行，用 \\n 换行）：', '');
          if (txt) chart.overrideOverlay({ id: ov.id, extendData: txt });
        }
        S.drawings.push(ov);
        saveDrawings();
        if (S.tool) setTimeout(() => { if (S.tool === name) startDraw(name); }, 30);
      },
      onSelected: (ev) => { S.selectedId = ev.overlay.id; },
      onDeselected: () => { S.selectedId = null; },
    });
  }

  function serialize(o) {
    return {
      id: o.id, name: o.name, points: fromChartPoints(o.points), styles: o.styles,
      lock: o.lock, visible: o.visible, zLevel: o.zLevel, extendData: o.extendData, mode: o.mode,
    };
  }

  const drawKey = () => [S.src, S.symbol, S.tf].join('|');

  let drawTimer = null;
  function saveDrawings() {
    clearTimeout(drawTimer);
    drawTimer = setTimeout(async () => {
      if (!S.symbol) return;
      try {
        await api('/api/drawings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: drawKey(),
            meta: { src: S.src, symbol: S.symbol, coin: S.coin, label: S.label, tf: S.tf },
            items: S.drawings.map(serialize),
          }),
        });
        renderDrawList();
      } catch (e) { toast('标注保存失败: ' + e.message, true); }
    }, 350);
  }

  async function loadDrawings() {
    for (const d of S.drawings) { try { if (d.id) chart.removeOverlay({ id: d.id }); } catch (_) { /* 忽略 */ } }
    S.drawings = [];
    try {
      const j = await api('/api/drawings?key=' + encodeURIComponent(drawKey()));
      const saved = (j.items || []).filter((x) => x && x.name && x.points && x.points.length);
      if (saved.length) {
        const ids = chart.createOverlay(saved.map((d) => ({
          ...d,
          id: undefined,
          points: toChartPoints(d.points),
          onSelected: (ev) => { S.selectedId = ev.overlay.id; },
          onDeselected: () => { S.selectedId = null; },
        })));
        (ids || []).forEach((id) => { if (id) S.drawings.push(chart.getOverlayById(id) || { id }); });
      }
      renderDrawList();
    } catch (e) { toast('标注加载失败: ' + e.message, true); }
  }

  function removeSelected() {
    if (!S.selectedId) return toast('先在图上点选一个标注，再按 Delete');
    chart.removeOverlay({ id: S.selectedId });
    S.drawings = S.drawings.filter((d) => d.id !== S.selectedId);
    S.selectedId = null;
    saveDrawings();
  }

  function clearDrawings() {
    if (!confirm('清空这张图的全部标注？')) return;
    S.drawings.forEach((d) => { try { chart.removeOverlay({ id: d.id }); } catch (_) { /* 忽略 */ } });
    S.drawings = [];
    saveDrawings();
  }

  function renderDrawList() {
    const el = $('drawList');
    if (el) el.textContent = '图上标注：' + S.drawings.length + ' 个（自动保存）';
  }

  /* ------------------------------ 自选分组 ------------------------------ */

  async function loadWatchlist() {
    try {
      const j = await api('/api/watchlist');
      S.watchlist.groups = j.groups || [];
      if (!S.watchlist.groups.length) S.watchlist.groups = [{ id: 'main', name: '主看', items: [] }];
    } catch (_) {
      S.watchlist.groups = [{ id: 'main', name: '主看', items: [] }];
    }
    renderWatchlist();
  }

  let wlTimer = null;
  function saveWatchlist() {
    clearTimeout(wlTimer);
    wlTimer = setTimeout(async () => {
      try {
        await api('/api/watchlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groups: S.watchlist.groups }),
        });
      } catch (e) { toast('自选保存失败: ' + e.message, true); }
    }, 300);
  }

  function renderWatchlist() {
    const box = $('groups');
    box.innerHTML = '';
    S.watchlist.groups.forEach((g) => {
      const gi = document.createElement('div');
      gi.className = 'group';

      const head = document.createElement('div');
      head.className = 'grouphead';
      const open = S.openGroups[g.id] !== false;
      head.innerHTML = '<span class="arw">' + (open ? '▾' : '▸') + '</span><span>' + esc(g.name) + '</span>' +
        '<span class="cnt">' + g.items.length + '</span><span class="del" title="删除分组">✕</span>';
      head.onclick = (e) => {
        if (e.target.classList.contains('del')) {
          if (!confirm('删除分组「' + g.name + '」？')) return;
          S.watchlist.groups = S.watchlist.groups.filter((x) => x.id !== g.id);
          saveWatchlist(); renderWatchlist(); return;
        }
        S.openGroups[g.id] = !open;
        renderWatchlist();
      };
      head.ondragover = (e) => e.preventDefault();
      head.ondrop = (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id) moveToGroup(id, g.id);
      };
      gi.appendChild(head);

      const list = document.createElement('div');
      if (open) {
        g.items.forEach((it) => {
          const row = document.createElement('div');
          row.className = 'gitem' + (S.id === it.id ? ' active' : '');
          row.draggable = true;
          row.innerHTML = '<span class="coin">' + esc(it.coin) + '</span><span class="mk">' + (it.mkt === 'perp' ? '永续' : '现货') + '</span><span class="x" title="移除">✕</span>';
          row.onclick = (e) => {
            if (row._lp) { row._lp = false; return; }
            if (e.target.classList.contains('x')) {
              g.items = g.items.filter((x) => x.id !== it.id);
              saveWatchlist(); renderWatchlist(); return;
            }
            selectSymbol(it);
          };
          // 手机：长按直接移除（没有悬停）
          let lpTimer = null;
          row.addEventListener('touchstart', () => {
            clearTimeout(lpTimer);
            lpTimer = setTimeout(() => {
              row._lp = true;
              g.items = g.items.filter((x) => x.id !== it.id);
              saveWatchlist(); renderWatchlist();
              toast('已移除 ' + it.coin);
            }, 650);
          }, { passive: true });
          ['touchend', 'touchmove', 'touchcancel'].forEach((ev) =>
            row.addEventListener(ev, () => { clearTimeout(lpTimer); }, { passive: true })
          );
          row.ondragstart = (e) => e.dataTransfer.setData('text/plain', it.id);
          list.appendChild(row);
        });
      }
      gi.appendChild(list);
      box.appendChild(gi);
    });
  }

  function moveToGroup(id, gid) {
    let found = null;
    S.watchlist.groups.forEach((g) => {
      g.items = g.items.filter((x) => { if (x.id === id) { found = x; return false; } return true; });
    });
    if (!found) return;
    const g = S.watchlist.groups.find((x) => x.id === gid);
    if (g && !g.items.some((x) => x.id === id)) g.items.push(found);
    saveWatchlist(); renderWatchlist();
  }

  function addToGroup(item, gid) {
    const g = S.watchlist.groups.find((x) => x.id === gid);
    if (!g) return;
    if (g.items.some((x) => x.id === item.id)) return toast('已经在这个分组里了');
    g.items.push({ id: item.id, src: item.src, symbol: item.symbol, coin: item.coin, mkt: item.mkt, label: item.label });
    saveWatchlist(); renderWatchlist();
    toast('已加入「' + g.name + '」');
  }

  function applyUI() {
    document.body.classList.toggle('left-hidden', !!S.ui.left);
    document.body.classList.toggle('right-hidden', !!S.ui.right);
    document.body.classList.toggle('focus-mode', !!S.ui.focus);

    const fb = $('floatbar');
    fb.classList.toggle('hidden', !S.ui.focus);
    if (S.ui.focus) {
      fb.style.bottom = S.replay.active ? '68px' : '10px';
      fb.innerHTML = '<button class="focus-exit" id="fbExitFocus">退出专注</button>';
      const exit = $('fbExitFocus');
      if (exit) exit.onclick = () => toggleFocus();
    }
    setTimeout(() => chart.resize(), 20);
  }

  function saveUI() {
    try {
      localStorage.setItem('nk.ui', JSON.stringify({ left: S.ui.left, right: S.ui.right }));
    } catch (_) { /* 忽略 */ }
  }

  function toggleFocus() {
    S.ui.focus = !S.ui.focus;
    if (S.ui.focus) {
      // 专注模式：把左上角的 OHLC 图例也藏起来，只留 K 线
      chart.setStyles({
        candle: {
          tooltip: {
            rect: { color: 'transparent', borderColor: 'transparent' },
            text: { color: 'transparent' },
          },
        },
      });
    } else {
      applyTheme(S.theme);
    }
    applyUI();
  }

  function bindUI() {
    $('btnFav').onclick = () => {
      if (isMobile()) { toggleDrawer('left'); return; }
      if (S.ui.focus) toggleFocus();
      S.ui.left = !S.ui.left;
      saveUI(); applyUI();
    };
    $('btnPanel').onclick = () => {
      if (isMobile()) { toggleDrawer('right'); return; }
      if (S.ui.focus) toggleFocus();
      S.ui.right = !S.ui.right;
      saveUI(); applyUI();
    };
    $('backdrop').onclick = closeDrawers;

    // 双击图表空白处 → 专注看 K；再双击或 Esc 退出
    $('chart').addEventListener('dblclick', (e) => {
      if (S.tool) return;
      e.preventDefault();
      toggleFocus();
    }, true);

    // 手机：双击（两次轻点）同样进入/退出专注
    let lastTap = 0, lastX = 0, lastY = 0;
    $('chart').addEventListener('touchend', (e) => {
      if (S.tool || !e.changedTouches || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const now = Date.now();
      if (now - lastTap < 320 && Math.abs(t.clientX - lastX) < 32 && Math.abs(t.clientY - lastY) < 32) {
        lastTap = 0;
        toggleFocus();
      } else {
        lastTap = now; lastX = t.clientX; lastY = t.clientY;
      }
    }, { passive: true });
  }

  function bindStar() {
    $('btnStar').onclick = () => {
      if (!S.symbol) return toast('先选一个品种', true);
      const item = { id: S.id, src: S.src, symbol: S.symbol, coin: S.coin, mkt: S.src.includes('perp') ? 'perp' : 'spot', label: S.label };
      const groups = S.watchlist.groups;
      openModal(
        '<h3>加入自选</h3><div class="presetrow">' + groups.map((g) => '<button data-g="' + g.id + '">' + esc(g.name) + '</button>').join('') + '</div>'
      );
      document.querySelectorAll('#modalBox button[data-g]').forEach((b) => {
        b.onclick = () => { addToGroup(item, b.dataset.g); closeModal(); };
      });
    };
    $('btnNewGroup').onclick = () => {
      const name = prompt('分组名称：', '新分组');
      if (!name) return;
      S.watchlist.groups.push({ id: uid(), name, items: [] });
      saveWatchlist(); renderWatchlist();
    };
  }

  /* ------------------------------ 交易与复盘 ---------------------------- */

  const tradeKey = () => [S.src, S.symbol].join('|');
  const TAGS = ['做对了', '做错了', '待改进', '计划内', '冲动'];

  function pnlOf(t) {
    if (t.exitPrice == null) return null;
    const dir = t.side === 'short' ? -1 : 1;
    return (t.exitPrice - t.entryPrice) * t.qty * dir - (Number(t.fee) || 0);
  }

  function renderTradeStats() {
    const done = S.trades.filter((t) => pnlOf(t) != null);
    const total = done.reduce((s, t) => s + pnlOf(t), 0);
    const wins = done.filter((t) => pnlOf(t) > 0).length;
    $('tradeStats').innerHTML =
      '<div class="stat"><div class="k">已平仓盈亏</div><div class="v ' + (total >= 0 ? 'pos' : 'neg') + '">' + (total >= 0 ? '+' : '') + fmtNum(total) + '</div></div>' +
      '<div class="stat"><div class="k">胜率 / 笔数</div><div class="v">' + (done.length ? Math.round((wins / done.length) * 100) : 0) + '% · ' + done.length + '</div></div>';
  }

  function renderTrades() {
    renderTradeStats();
    const box = $('tradeList');
    box.innerHTML = '';
    if (!S.trades.length) {
      box.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:6px 2px">还没有记录。回放开平仓会自动记进来，也可以手工补。</div>';
      return;
    }
    [...S.trades].sort((a, b) => b.entryTime - a.entryTime).forEach((t) => {
      const pnl = pnlOf(t);
      const el = document.createElement('div');
      el.className = 'titem ' + t.side;
      const tags = (t.tags || []).map((x) => '<span class="tag">' + esc(x) + '</span>').join('');
      el.innerHTML =
        '<div class="t1"><span class="tag">' + (t.side === 'long' ? '多' : '空') + '</span>' + tags +
        '<span>' + fmtPx(t.entryPrice) + ' → ' + (t.exitPrice != null ? fmtPx(t.exitPrice) : '持仓中') + ' × ' + t.qty + '</span>' +
        (pnl != null ? '<span class="pnl ' + (pnl >= 0 ? 'pos' : 'neg') + '">' + (pnl >= 0 ? '+' : '') + fmtNum(pnl) + '</span>' : '') + '</div>' +
        '<div class="t2">' + fmtTime(t.entryTime) + (t.exitTime ? ' → ' + fmtTime(t.exitTime) : '') + (t.lev ? ' · ' + t.lev + 'x' : '') + (t.sessionId ? ' · 回放' : '') + '</div>' +
        '<div class="acts2"><button class="mini" data-act="review">复盘</button><button class="mini" data-act="del">删除</button></div>' +
        '<div class="reviewbox hidden"></div>';

      const box2 = el.querySelector('.reviewbox');
      el.querySelector('[data-act="del"]').onclick = () => {
        S.trades = S.trades.filter((x) => x.id !== t.id);
        persistTrades(); renderTrades();
      };
      el.querySelector('[data-act="review"]').onclick = () => {
        if (!box2.classList.contains('hidden')) { box2.classList.add('hidden'); return; }
        box2.classList.remove('hidden');
        box2.innerHTML =
          '<div class="tagbtns">' + TAGS.map((tag) => '<button data-tag="' + tag + '" class="' + ((t.tags || []).includes(tag) ? 'on' : '') + '">' + tag + '</button>').join('') + '</div>' +
          '<textarea placeholder="这笔做得怎么样？哪里对、哪里错、下次怎么改…">' + esc(t.review || '') + '</textarea>';
        box2.querySelectorAll('button[data-tag]').forEach((b) => {
          b.onclick = () => {
            t.tags = t.tags || [];
            const i = t.tags.indexOf(b.dataset.tag);
            if (i >= 0) t.tags.splice(i, 1); else t.tags.push(b.dataset.tag);
            b.classList.toggle('on');
            persistTrades();
          };
        });
        box2.querySelector('textarea').onchange = (e) => { t.review = e.target.value; persistTrades(); };
      };
      box.appendChild(el);
    });
  }

  let tradeTimer = null;
  function persistTrades() {
    renderTradeStats();
    clearTimeout(tradeTimer);
    tradeTimer = setTimeout(async () => {
      try {
        await api('/api/trades', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: tradeKey(), meta: { src: S.src, symbol: S.symbol, coin: S.coin, tf: '' }, items: S.trades }),
        });
      } catch (e) { toast('交易保存失败: ' + e.message, true); }
    }, 300);
  }

  async function loadTrades() {
    S.trades = [];
    if (!S.symbol) { renderTrades(); return; }
    try {
      const j = await api('/api/trades?key=' + encodeURIComponent(tradeKey()));
      S.trades = j.items || [];
    } catch (e) { toast('交易读取失败: ' + e.message, true); }
    renderTrades();
  }

  function bindTradeForm() {
    $('btnAddTrade').onclick = () => {
      $('tradeForm').classList.remove('hidden');
      const last = S.bars[S.bars.length - 1];
      $('tIn').value = tsToInput(Date.now());
      if (last) $('tInPx').value = last.close;
    };
    $('btnCancelTrade').onclick = () => $('tradeForm').classList.add('hidden');
    $('tradeForm').onsubmit = (e) => {
      e.preventDefault();
      const t = {
        id: uid(), side: $('tSide').value, qty: Number($('tQty').value),
        entryTime: inputToTs($('tIn').value), entryPrice: Number($('tInPx').value),
        exitTime: inputToTs($('tOut').value), exitPrice: $('tOutPx').value === '' ? null : Number($('tOutPx').value),
        lev: Number($('tLev').value) || null, fee: Number($('tFee').value) || 0,
        note: $('tNote').value.trim(), tags: [], review: '',
      };
      if (!t.entryTime || !t.entryPrice || !t.qty) return toast('时间 / 价格 / 数量必填', true);
      S.trades.push(t);
      persistTrades(); renderTrades();
      $('tradeForm').classList.add('hidden');
    };
    $('btnImport').onclick = openImport;
    $('btnExportMd').onclick = exportMarkdown;
  }

  function openImport() {
    openModal(
      '<h3>导入交割单</h3>' +
      '<p class="hint">粘贴 CSV 或从 Excel 直接复制。需要能识别：时间、方向、价格、数量，会自动配对开平仓。</p>' +
      '<input type="file" id="csvFile" accept=".csv,.txt">' +
      '<textarea id="csvText" placeholder="成交时间,操作,成交均价,成交数量,手续费&#10;2026-01-05 09:35:00,买入,12.34,1000,5"></textarea>' +
      '<div class="presetrow"><button id="csvGo" class="primary">导入</button><button id="csvCancel">取消</button></div>'
    );
    $('csvFile').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { $('csvText').value = r.result; };
      r.readAsText(f, 'utf-8');
    };
    $('csvCancel').onclick = closeModal;
    $('csvGo').onclick = () => {
      try {
        const fills = parseFills($('csvText').value);
        if (!fills.length) throw new Error('没有解析到有效成交行');
        const trades = pairFills(fills);
        S.trades = S.trades.concat(trades);
        persistTrades(); renderTrades(); closeModal();
        toast('导入 ' + fills.length + ' 笔成交，配成 ' + trades.length + ' 笔交易');
      } catch (e) { toast(e.message, true); }
    };
  }

  function parseFills(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const delim = ['\t', ',', ';', '|'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
    const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));
    const norm = (s) => String(s).replace(/\s|（|）|\(|\)/g, '').toLowerCase();
    const findCol = (headers, keys) => headers.findIndex((h) => keys.some((k) => norm(h).includes(k)));
    let hi = -1;
    for (let i = 0; i < rows.length; i++) {
      if (findCol(rows[i], ['时间', 'time', '日期']) >= 0 && findCol(rows[i], ['价格', 'price', '成交价']) >= 0) { hi = i; break; }
    }
    if (hi < 0) throw new Error('没找到表头（至少需要时间和价格两列）');
    const headers = rows[hi];
    const ci = {
      time: findCol(headers, ['成交时间', '时间', '日期', 'time', 'date']),
      price: findCol(headers, ['成交均价', '成交价', '价格', 'price']),
      qty: findCol(headers, ['成交数量', '数量', '成交量', 'qty', 'volume']),
      side: findCol(headers, ['操作', '买卖', '方向', 'side', 'type']),
      fee: findCol(headers, ['手续费', '佣金', 'fee']),
    };
    if (ci.time < 0 || ci.price < 0 || ci.qty < 0 || ci.side < 0) throw new Error('缺少必要列：时间/价格/数量/方向');
    const fills = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 3) continue;
      const sideRaw = String(r[ci.side] || '');
      const side = /买|buy/i.test(sideRaw) ? 1 : /卖|sell/i.test(sideRaw) ? -1 : 0;
      if (!side) continue;
      const price = parseFloat(String(r[ci.price]).replace(/[^\d.\-]/g, ''));
      const qty = Math.abs(parseFloat(String(r[ci.qty]).replace(/[^\d.\-]/g, '')));
      const ts = parseTime(String(r[ci.time]));
      if (!isFinite(price) || !isFinite(qty) || !isFinite(ts)) continue;
      fills.push({ ts, side, price, qty, fee: ci.fee >= 0 ? Math.abs(parseFloat(r[ci.fee]) || 0) : 0 });
    }
    fills.sort((a, b) => a.ts - b.ts);
    return fills;
  }

  function parseTime(s) {
    const t = s.trim().replace(/\//g, '-');
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const d = /^(\d{8})(\d{6})?$/.exec(t);
    if (d) return Date.UTC(+d[1].slice(0, 4), +d[1].slice(4, 6) - 1, +d[1].slice(6, 8), d[2] ? +d[2].slice(0, 2) : 0, d[2] ? +d[2].slice(2, 4) : 0);
    return NaN;
  }

  function pairFills(fills) {
    const out = [];
    let open = null;
    for (const f of fills) {
      const side = f.side > 0 ? 'long' : 'short';
      if (!open) {
        open = { id: uid(), side, entryTime: f.ts, entryPrice: f.price, qty: f.qty, fee: f.fee, exitTime: null, exitPrice: null, tags: [], review: '' };
      } else if (open.side === side) {
        open.entryPrice = (open.entryPrice * open.qty + f.price * f.qty) / (open.qty + f.qty);
        open.qty += f.qty; open.fee += f.fee;
      } else {
        open.exitTime = f.ts; open.exitPrice = f.price; open.fee += f.fee;
        out.push(open); open = null;
      }
    }
    if (open) out.push(open);
    return out;
  }

  /* ------------------------------ 笔记 ------------------------------ */

  let noteTimer = null;
  async function loadNote() {
    if (!S.symbol) return;
    try {
      const j = await api('/api/note?key=' + encodeURIComponent(drawKey()));
      S.note = (j && j.text) || '';
    } catch (_) { S.note = ''; }
    $('noteText').value = S.note;
    $('noteTitle').textContent = '本图笔记 · ' + S.tf;
    $('noteStatus').textContent = '';
  }
  function bindNote() {
    $('noteText').addEventListener('input', (e) => {
      S.note = e.target.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(async () => {
        try {
          await api('/api/note', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: drawKey(), text: S.note, meta: { src: S.src, symbol: S.symbol, coin: S.coin, tf: S.tf } }),
          });
          $('noteStatus').textContent = '已保存';
        } catch (err) { toast('笔记保存失败: ' + err.message, true); }
      }, 500);
    });
  }

  /* ------------------------------ 回放 ------------------------------ */

  const R = () => S.replay;

  function tfMinutes(tf) {
    const m = /^(\d+)([mhdw])$/.exec(String(tf || '15m'));
    if (!m) return 15;
    return parseInt(m[1], 10) * ({ m: 1, h: 60, d: 1440, w: 10080 }[m[2]] || 1);
  }
  function windowSize() {
    return S.src.startsWith('okx') ? 1200 : 3000;
  }

  async function fetchWindow(startTs, count) {
    const q = new URLSearchParams({
      src: S.src, symbol: S.symbol, tf: S.tf,
      start: String(Math.max(0, Math.floor(startTs))), count: String(count),
    });
    return api('/api/kline?' + q.toString());
  }

  function trimWindow() {
    const st = R();
    const MAX = 12000;
    if (st.bars.length <= MAX) return;
    const drop = st.bars.length - MAX;
    st.bars = st.bars.slice(drop);
    st.idx = Math.max(0, st.idx - drop);
    st.startIdx = Math.max(0, st.startIdx - drop);
    st.hasPrev = true;
  }

  async function loadReplayWindow(anchorTs) {
    const st = R();
    const tfm = tfMinutes(S.tf);
    const size = windowSize();
    const start = anchorTs - 300 * tfm * 60000;
    const j = await fetchWindow(start, size);
    st.bars = j.bars || [];
    st.hasMore = !!j.hasMore;
    st.hasPrev = st.bars.length ? !(st.bars[0].timestamp > start + tfm * 60000 * 2) : false;
    let i = st.bars.findIndex((b) => b.timestamp >= anchorTs);
    if (i < 0) i = st.bars.length - 1;
    st.idx = Math.max(0, i);
    st.startIdx = st.idx;
    if (st.bars.length && st.bars[0].timestamp > anchorTs + tfm * 60000 * 3) {
      toast('这个品种/周期最早只有 ' + fmtTime(st.bars[0].timestamp), true);
    }
    return st;
  }

  async function ensureForward() {
    const st = R();
    if (!st.hasMore || st.loading || !st.bars.length) return false;
    st.loading = true;
    try {
      const last = st.bars[st.bars.length - 1];
      const j = await fetchWindow(last.timestamp + 1, Math.floor(windowSize() / 2));
      const add = (j.bars || []).filter((b) => b.timestamp > last.timestamp);
      if (!add.length) { st.hasMore = false; return false; }
      st.bars = st.bars.concat(add);
      st.hasMore = !!j.hasMore;
      trimWindow();
      return true;
    } catch (e) {
      toast('加载后续数据失败: ' + e.message, true);
      return false;
    } finally {
      st.loading = false;
    }
  }

  async function ensureBackward() {
    const st = R();
    if (!st.hasPrev || st.loading || !st.bars.length) return false;
    st.loading = true;
    try {
      const tfm = tfMinutes(S.tf);
      const first = st.bars[0];
      const start = first.timestamp - Math.floor(windowSize() / 2) * tfm * 60000;
      const j = await fetchWindow(start, Math.floor(windowSize() / 2));
      const add = (j.bars || []).filter((b) => b.timestamp < first.timestamp);
      if (!add.length) { st.hasPrev = false; return false; }
      st.bars = add.concat(st.bars);
      st.idx += add.length;
      st.startIdx += add.length;
      if (add.length < Math.floor(windowSize() / 4)) st.hasPrev = false;
      trimWindow();
      return true;
    } catch (e) {
      toast('加载历史数据失败: ' + e.message, true);
      return false;
    } finally {
      st.loading = false;
    }
  }

  function bindReplay() {
    $('btnReplay').onclick = pickStartDate;
    $('rbPrev').onclick = () => step(-1);
    $('rbNext').onclick = () => step(1);
    const upBtn = $('rbUp');
    if (upBtn) upBtn.onclick = () => step(-1);
    const dnBtn = $('rbDn');
    if (dnBtn) dnBtn.onclick = () => step(1);
    $('rpQtyLabel').onclick = () => {
      S.unit = S.unit === 'U' ? 'coin' : 'U';
      try { localStorage.setItem('nk.unit', S.unit); } catch (_) { /* 忽略 */ }
      updateUnitLabel();
    };
    $('rbPlay').onclick = togglePlay;
    $('rbExit').onclick = () => exitReplay(false);
    $('rbJump').onclick = () => {
      const d = prompt('跳到哪一天？（YYYY-MM-DD）');
      if (!d) return;
      jumpToDate(d + 'T00:00:00Z');
    };
    $('rpLong').onclick = () => setSide(1);
    $('rpShort').onclick = () => setSide(-1);
    document.querySelectorAll('.pct button').forEach((b) => {
      b.onclick = () => {
        const st = R();
        const price = st.bars[st.idx] ? st.bars[st.idx].close : 0;
        if (!price) return;
        const eq = equity();
        const lev = Number($('rpLev').value) || 1;
        $('rpQty').value = Math.max(0, Math.floor((eq * Number(b.dataset.pct) * lev / price) * 1e6) / 1e6);
      };
    });
    $('rpOpen').onclick = () => placeOrder('open');
    $('rpClose').onclick = () => placeOrder('close');
    $('rpFlip').onclick = () => placeOrder('flip');
  }

  function setSide(side) {
    $('rpLong').classList.toggle('active', side > 0);
    $('rpShort').classList.toggle('active', side < 0);
  }
  function currentSide() { return $('rpShort').classList.contains('active') ? -1 : 1; }

  function equity() {
    const st = R();
    const p = st.bars[st.idx];
    let eq = st.capital + st.closed.reduce((s, t) => s + t.pnl, 0);
    if (st.pos && p) eq += (p.close - st.pos.avg) * st.pos.qty * st.pos.side;
    return eq;
  }

  function renderPos() {
    const st = R();
    const p = st.bars[st.idx];
    const el = $('posCard');
    const chip = $('rbPosChip');
    renderReplayInfo();
    if (!st.active) {
      el.innerHTML = '<span>空仓</span>';
      if (chip) chip.textContent = '';
      $('tradebar').classList.add('hidden');
      return;
    }
    $('tradebar').classList.remove('hidden');
    const upnl = st.pos && p ? (p.close - st.pos.avg) * st.pos.qty * st.pos.side : 0;
    const total = equity() - st.capital;
    if (isMobile()) {
      el.innerHTML = '<span>盈亏 <b class="' + (total >= 0 ? 'pos' : 'neg') + '">' + (total >= 0 ? '+' : '') + fmtNum(total, 2) + '</b></span>' +
        '<span>权益 <b>' + fmtNum(equity(), 0) + '</b></span>';
      if (chip) {
        chip.textContent = st.pos
          ? (st.pos.side > 0 ? '多' : '空') + ' ' + st.pos.qty + ' · ' + (upnl >= 0 ? '+' : '') + fmtNum(upnl, 2)
          : '';
      }
      return;
    }
    if (chip) chip.textContent = '';
    if (!st.pos) {
      el.innerHTML = '<span>空仓</span><span>权益 <b>' + fmtNum(equity(), 2) + '</b></span>';
      return;
    }
    el.innerHTML =
      '<span style="color:' + (st.pos.side > 0 ? 'var(--up)' : 'var(--down)') + '">' + (st.pos.side > 0 ? '多' : '空') + '</span>' +
      '<span>均价 <b>' + fmtPx(st.pos.avg) + '</b></span>' +
      '<span>数量 <b>' + st.pos.qty + '</b></span>' +
      '<span>浮盈 <b class="' + (upnl >= 0 ? 'pos' : 'neg') + '">' + (upnl >= 0 ? '+' : '') + fmtNum(upnl, 2) + '</b></span>' +
      '<span>盈亏 <b class="' + (total >= 0 ? 'pos' : 'neg') + '">' + (total >= 0 ? '+' : '') + fmtNum(total, 2) + '</b></span>' +
      '<span>权益 <b>' + fmtNum(equity(), 2) + '</b></span>';
  }

  function renderReplayInfo() {
    const st = R();
    const p = st.bars[st.idx];
    if (!st.active || !p) { $('rbInfo').textContent = '—'; return; }
    let extra = '';
    if (st.pos) extra = ' · ' + (st.pos.side > 0 ? '多' : '空') + ' ' + (+st.pos.qty.toFixed(4));
    if (isMobile()) {
      $('rbInfo').textContent = fmtTime(p.timestamp) + ' ' + (st.idx + 1) + '/' + st.bars.length + extra;
      return;
    }
    $('rbInfo').textContent = fmtTime(p.timestamp) + ' · 窗口 ' + (st.idx + 1) + '/' + st.bars.length +
      (st.hasMore ? ' · 前面还有' : ' · 已到最新') + extra;
  }

  function applySlice() {
    const st = R();
    const bars = transformBars(st.bars.slice(0, st.idx + 1));
    chart.applyNewData(bars);
    chart.setBarSpace(7);
    chart.scrollToDataIndex(bars.length - 1, 0);
    renderReplayMarkers();
  }

  function renderReplayMarkers() {
    const st = R();
    chart.removeOverlay({ groupId: 'rp' });
    if (!st.active || !st.bars.length) return;
    const cur = st.bars[st.idx];
    const byTs = new Map();
    for (const b of st.bars) byTs.set(b.timestamp, b);
    const list = [];
    for (const o of st.orders) {
      if (o.t > cur.timestamp) continue;
      const bar = byTs.get(o.t);
      if (!bar) continue;
      if (o.kind === 'open') {
        const up = o.side > 0;
        const color = up ? '#2962ff' : '#f23645';
        list.push({
          name: up ? 'arrowUp' : 'arrowDown',
          groupId: 'rp', lock: true,
          points: [{ timestamp: o.t, value: up ? bar.low : bar.high }],
          styles: { polygon: { color }, line: { color, size: 1.5 } },
        });
      } else {
        const pnl = Number(o.pnl) || 0;
        list.push({
          name: 'closeTag',
          groupId: 'rp', lock: true,
          points: [{ timestamp: o.t, value: o.price }],
          styles: { line: { color: pnl >= 0 ? '#26a69a' : '#ef5350', size: 1, style: 'dashed' } },
        });
      }
    }
    if (list.length) chart.createOverlay(list);
    window.__markerCount = list.length;
  }

  async function step(n) {
    const st = R();
    if (!st.active) return;
    if (n > 0 && st.idx >= st.bars.length - 2 && st.hasMore) await ensureForward();
    if (n < 0 && st.idx <= 1 && st.hasPrev) await ensureBackward();
    const next = Math.min(st.bars.length - 1, Math.max(0, st.idx + n));
    if (next === st.idx) { if (n > 0) stopPlay(); return; }
    const forward = next > st.idx;
    st.idx = next;
    if (forward) chart.updateData(transformBar(st.bars[st.idx]));
    else applySlice();
    chart.scrollToDataIndex(st.idx, 0);
    renderReplayInfo(); renderPos();
  }

  async function playTick() {
    const st = R();
    if (!st.playing) return;
    if (st.idx >= st.bars.length - 1 && !st.hasMore) { stopPlay(); return; }
    await step(1);
    if (!st.playing) return;
    st.timer = setTimeout(playTick, Number($('rbSpeed').value) || 300);
  }

  function togglePlay() {
    const st = R();
    if (st.playing) return stopPlay();
    st.playing = true;
    $('rbPlay').textContent = '暂停';
    playTick();
  }
  function stopPlay() {
    const st = R();
    st.playing = false;
    clearTimeout(st.timer);
    st.timer = null;
    $('rbPlay').textContent = '播放';
  }

  async function jumpToDate(iso) {
    const st = R();
    const ts = new Date(iso).getTime();
    if (!isFinite(ts)) return toast('日期格式不对', true);
    busy(true);
    try {
      await loadReplayWindow(ts);
      applySlice(); renderReplayInfo(); renderPos();
    } finally { busy(false); }
  }

  function pickStartDate() {
    if (!S.symbol) return toast('先选品种', true);
    if (!S.bars.length) return toast('行情还在加载，稍等一下', true);
    const lastTs = S.bars[S.bars.length - 1].timestamp;
    const presets = [
      { label: '最近 300 根', ts: S.bars[Math.max(0, S.bars.length - 300)].timestamp },
      { label: '1 个月前', ts: lastTs - 30 * 864e5 },
      { label: '3 个月前', ts: lastTs - 90 * 864e5 },
      { label: '1 年前', ts: lastTs - 365 * 864e5 },
      { label: '3 年前', ts: lastTs - 3 * 365 * 864e5 },
      { label: '5 年前', ts: lastTs - 5 * 365 * 864e5 },
    ];
    openModal(
      '<h3>开始回放</h3>' +
      '<p class="hint">选起点后，之后的 K 线不会显示，你可以一根根往前放，也可以随时切换周期，回放状态不会丢。</p>' +
      '<div class="presetrow">' + presets.map((p) => '<button data-ts="' + p.ts + '">' + p.label + '</button>').join('') + '</div>' +
      '<div class="presetrow"><input type="date" id="rpDate"><button id="rpDateGo">用这个日期</button></div>' +
      '<div class="presetrow"><label style="flex-direction:row;gap:6px;align-items:center">模拟资金 <input type="number" id="rpCap" value="10000" style="width:110px"></label>' +
      (S.session ? '<button id="rpResume" class="primary">继续上次回放</button>' : '') + '</div>'
    );
    document.querySelectorAll('#modalBox button[data-ts]').forEach((b) => {
      b.onclick = () => {
        const cap = Number($('rpCap') ? $('rpCap').value : 10000) || 10000;
        closeModal();
        startReplay(Number(b.dataset.ts), cap);
      };
    });
    $('rpDateGo').onclick = () => {
      const v = $('rpDate').value;
      if (!v) return;
      const cap = Number($('rpCap') ? $('rpCap').value : 10000) || 10000;
      closeModal();
      startReplay(new Date(v + 'T00:00:00Z').getTime(), cap);
    };
    if (S.session) $('rpResume').onclick = () => { closeModal(); resumeReplay(); };
  }

  function clampRb(left, top, w, h) {
    return {
      left: Math.min(Math.max(4, left), Math.max(4, innerWidth - w - 4)),
      top: Math.min(Math.max(4, top), Math.max(4, innerHeight - h - 4)),
    };
  }

  function placeReplayBar(ignoreSaved) {
    const bar = $('replaybar');
    if (bar.classList.contains('hidden')) return;
    const r = bar.getBoundingClientRect();
    let pos = null;
    if (!ignoreSaved) {
      try { pos = JSON.parse(localStorage.getItem('nk.rbPos') || 'null'); } catch (_) { pos = null; }
    }
    if (!pos) {
      const c = $('chart').getBoundingClientRect();
      pos = { left: c.left + c.width / 2 - r.width / 2, top: c.top + c.height - r.height - 62 };
    }
    const p = clampRb(pos.left, pos.top, r.width, r.height);
    bar.style.left = p.left + 'px';
    bar.style.top = p.top + 'px';
  }

  function bindReplayDrag() {
    const bar = $('replaybar');
    if (isMobile()) return; // 手机上回放条固定在底部，不拖拽
    let drag = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,select,input,option')) return;
      const r = bar.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { bar.setPointerCapture(e.pointerId); } catch (_) { /* 忽略 */ }
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const r = bar.getBoundingClientRect();
      const p = clampRb(e.clientX - drag.dx, e.clientY - drag.dy, r.width, r.height);
      bar.style.left = p.left + 'px';
      bar.style.top = p.top + 'px';
    });
    const end = (e) => {
      if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
      drag = null;
      try {
        localStorage.setItem('nk.rbPos', JSON.stringify({ left: parseFloat(bar.style.left), top: parseFloat(bar.style.top) }));
      } catch (_) { /* 忽略 */ }
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => { if (!bar.classList.contains('hidden')) placeReplayBar(true); });
  }

  function showReplayUI(on) {
    const bar = $('replaybar');
    bar.classList.toggle('hidden', !on);
    $('tradebar').classList.toggle('hidden', !on);
    const ra = $('rbArrows');
    if (ra) ra.classList.toggle('hidden', !on);
    if (on) { closeDrawers(); placeReplayBar(false); }
    applyUI();
  }

  async function startReplay(ts, capital) {
    const st = R();
    stopPlay();
    busy(true);
    try {
      const s = await loadReplayWindow(ts);
      if (!s.bars.length) { toast('这个时间点没有数据', true); return; }
      st.capital = capital || 10000;
      st.pos = null; st.closed = []; st.orders = [];
      st.active = true;
      showReplayUI(true);
      S.prec = precision(s.bars[s.idx].close);
      chart.setPriceVolumePrecision(S.prec, 0);
      applySlice();
      renderReplayInfo(); renderPos();
      toast('回放开始：◀ ▶ 或空格前进');
    } catch (e) {
      window.__lastErr = String((e && e.stack) || e);
      toast('回放启动失败: ' + (e && e.message ? e.message : e), true);
    } finally {
      busy(false);
    }
  }

  async function resumeReplay() {
    const s = S.session;
    if (!s) return toast('没有可继续的回放', true);
    const st = R();
    stopPlay();
    busy(true);
    try {
      await loadReplayWindow(s.anchorTs || Date.now());
      st.capital = s.capital || 10000;
      st.pos = s.pos || null;
      st.closed = s.closed || [];
      st.orders = s.orders || [];
      st.active = true;
      showReplayUI(true);
      S.prec = precision(st.bars[st.idx].close);
      chart.setPriceVolumePrecision(S.prec, 0);
      applySlice();
      renderReplayInfo(); renderPos();
      toast('已恢复上次进度：' + fmtTime(st.bars[st.idx].timestamp));
    } finally {
      busy(false);
    }
  }

  function exitReplay(silent) {
    const st = R();
    if (!st.active) return;
    stopPlay();
    if (silent) return finishExit();
    const pnl = st.closed.reduce((s, t) => s + t.pnl, 0);
    openModal(
      '<h3>退出回放？</h3>' +
      '<p class="hint">本次已平仓 ' + st.closed.length + ' 笔，合计 ' + (pnl >= 0 ? '+' : '') + fmtNum(pnl, 2) + ' USDT。</p>' +
      '<div class="presetrow">' +
      '<button id="rpSave" class="primary">保存到交易笔记并退出</button>' +
      '<button id="rpKeep">保留进度</button>' +
      '<button id="rpDrop">放弃本次</button>' +
      '</div>'
    );
    $('rpDrop').onclick = () => { closeModal(); finishExit(); };
    $('rpKeep').onclick = () => { saveSession(); closeModal(); finishExit(); toast('进度已保存'); };
    $('rpSave').onclick = async () => {
      saveReplayTrades();
      await deleteSession();
      closeModal();
      finishExit();
    };
  }

  async function deleteSession() {
    try {
      await api('/api/session?key=' + encodeURIComponent(drawKey()), { method: 'DELETE' });
    } catch (_) { /* 忽略 */ }
    S.session = null;
  }

  function finishExit() {
    const st = R();
    st.active = false;
    st.playing = false;
    clearTimeout(st.timer);
    st.timer = null;
    showReplayUI(false);
    chart.removeOverlay({ groupId: 'rp' });
    chart.applyNewData(transformBars(S.bars));
    chart.scrollToRealTime(0);
    renderPos();
  }

  function abortReplay() {
    const st = R();
    stopPlay();
    st.active = false;
    st.bars = [];
    st.pos = null;
    st.closed = [];
    st.orders = [];
    chart.removeOverlay({ groupId: 'rp' });
    showReplayUI(false);
  }

  function saveReplayTrades() {
    const st = R();
    const sid = 'sim-' + Date.now();
    const list = st.closed.map((t) => ({
      id: uid(), side: t.side, qty: t.qty, entryTime: t.entryTime, entryPrice: t.entryPrice,
      exitTime: t.exitTime, exitPrice: t.exitPrice, lev: null, fee: 0,
      note: '回放练习', tags: [], review: '', sessionId: sid,
    }));
    S.trades = S.trades.concat(list);
    renderTrades();
    persistTrades();
    toast('已保存 ' + list.length + ' 笔到交易笔记');
  }

  function toQty(amount, price) {
    const lev = Number($('rpLev').value) || 1;
    if (S.unit === 'U') return (amount * lev) / price;
    return amount;
  }

  function updateUnitLabel() {
    const el = $('rpQtyLabel');
    if (!el) return;
    el.textContent = S.unit === 'U' ? '金额(U)' : '数量(币)';
    const inp = $('rpQty');
    inp.step = S.unit === 'U' ? '1' : 'any';
    inp.value = S.unit === 'U' ? '100' : '0.1';
  }

  function placeOrder(kind) {
    const st = R();
    if (!st.active) return toast('先开始回放', true);
    const bar = st.bars[st.idx];
    const price = bar.close;
    const side = currentSide();
    const amount = Number($('rpQty').value);
    const lev = Number($('rpLev').value) || null;

    if (kind === 'close' || kind === 'flip') {
      if (!st.pos) { if (kind === 'close') return toast('当前没有持仓', true); }
      else {
        const p = st.pos;
        let qtyToClose = amount > 0 ? toQty(amount, price) : p.qty;
        if (!(qtyToClose > 0)) qtyToClose = p.qty;
        const partial = qtyToClose < p.qty - 1e-9;
        const q = partial ? qtyToClose : p.qty;
        const pnl = (price - p.avg) * q * p.side;
        st.closed.push({ side: p.side > 0 ? 'long' : 'short', qty: q, entryTime: p.entryTime, entryPrice: p.avg, exitTime: bar.timestamp, exitPrice: price, pnl });
        st.orders.push({ t: bar.timestamp, price, side: p.side, qty: q, kind: 'close', pnl });
        if (partial) {
          st.pos.qty = p.qty - q;
        } else {
          st.pos = null;
        }
        if (kind === 'close') { renderPos(); renderReplayMarkers(); return; }
      }
    }

    if (kind === 'open' || kind === 'flip') {
      if (!amount || amount <= 0) return toast('金额要大于 0', true);
      const qty = toQty(amount, price);
      if (st.pos) {
        if (st.pos.side === side) {
          st.pos.avg = (st.pos.avg * st.pos.qty + price * qty) / (st.pos.qty + qty);
          st.pos.qty += qty;
        }
      } else {
        st.pos = { side, qty, avg: price, entryTime: bar.timestamp };
      }
      st.orders.push({ t: bar.timestamp, side, qty, price, kind: 'open', lev });
    }
    renderPos();
    renderReplayMarkers();
  }

  async function loadSession() {
    try {
      const j = await api('/api/session?key=' + encodeURIComponent(drawKey()));
      S.session = j.session || null;
    } catch (_) { S.session = null; }
  }

  async function saveSession() {
    const st = R();
    if (!st.active || !st.bars.length) return;
    try {
      await api('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: drawKey(),
          meta: { src: S.src, symbol: S.symbol, coin: S.coin, tf: S.tf },
          data: {
            anchorTs: st.bars[st.idx].timestamp,
            pos: st.pos, closed: st.closed, orders: st.orders,
            capital: st.capital, updatedAt: Date.now(),
          },
        }),
      });
    } catch (_) { /* 忽略 */ }
  }

  /* ------------------------------ 笔记库 / 导出 ------------------------- */

  async function openLibrary() {
    busy(true);
    try {
      const j = await api('/api/library');
      const items = j.items || [];
      openModal(
        '<h3>笔记库</h3><p class="hint">点一行直接打开对应的图。</p>' +
        (items.length ? items.map((x, i) =>
          '<div class="librow" data-i="' + i + '"><span class="nm">' + esc(x.meta.coin || x.meta.symbol || x.key) + '</span>' +
          '<span class="cnts">' + esc((x.meta.tf || '') + ' · ' + (x.meta.src || '')) + '</span>' +
          '<span class="cnts">标注 ' + x.drawings + ' · 交易 ' + x.trades + '</span>' +
          '<span class="dt">' + (x.updatedAt ? new Date(x.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '') + '</span></div>'
        ).join('') : '<div class="hint">还没有任何标注或交易。</div>')
      );
      document.querySelectorAll('.librow').forEach((row) => {
        row.onclick = () => {
          const x = items[Number(row.dataset.i)];
          closeModal();
          selectSymbol({ id: [x.meta.src, x.meta.symbol].join(':'), src: x.meta.src, symbol: x.meta.symbol, coin: x.meta.coin || x.meta.symbol, mkt: x.meta.src.includes('perp') ? 'perp' : 'spot', label: x.meta.label || x.meta.coin });
          if (x.meta.tf) { S.tf = x.meta.tf; paintTf(); loadAll(); }
        };
      });
    } catch (e) { toast('笔记库读取失败: ' + e.message, true); }
    finally { busy(false); }
  }

  function exportMarkdown() {
    if (!S.trades.length) return toast('当前品种没有交易记录', true);
    const lines = ['# ' + S.coin + ' ' + (S.src.includes('perp') ? '永续' : '现货') + ' 交易复盘', '', '标的：`' + S.symbol + '`　来源：' + S.src, ''];
    if (S.note) lines.push('## 本图笔记', '', S.note, '');
    lines.push('## 交易记录', '');
    [...S.trades].sort((a, b) => a.entryTime - b.entryTime).forEach((t, i) => {
      const pnl = pnlOf(t);
      lines.push('### ' + (i + 1) + '. ' + (t.side === 'long' ? '做多' : '做空') + ' ' + fmtPx(t.entryPrice) + ' → ' + (t.exitPrice != null ? fmtPx(t.exitPrice) : '持仓中'));
      lines.push('- 开仓：' + fmtTime(t.entryTime) + '　平仓：' + (t.exitTime ? fmtTime(t.exitTime) : '—'));
      lines.push('- 数量：' + t.qty + (t.lev ? '　杠杆：' + t.lev + 'x' : ''));
      if (pnl != null) lines.push('- 盈亏：' + (pnl >= 0 ? '+' : '') + fmtNum(pnl));
      if (t.tags && t.tags.length) lines.push('- 标签：' + t.tags.join('、'));
      if (t.review) lines.push('', '> ' + t.review.replace(/\n/g, '\n> '));
      lines.push('');
    });
    download('\ufeff' + lines.join('\n'), S.coin + '_复盘_' + Date.now() + '.md', 'text/markdown');
  }

  function download(text, filename, type) {
    const blob = new Blob([text], { type: (type || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function backupAll() {
    busy(true);
    try {
      const j = await api('/api/backup');
      download(JSON.stringify(j, null, 2), 'nakedk-backup-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
    } catch (e) { toast('备份失败: ' + e.message, true); }
    finally { busy(false); }
  }

  /* ------------------------------ 弹窗/周期 ---------------------------- */

  function openModal(html) { $('modalBox').innerHTML = html; $('modal').classList.remove('hidden'); }
  function closeModal() { $('modal').classList.add('hidden'); }

  function setTab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
  }

  const TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

  function buildTf() {
    const box = $('tfbar');
    box.innerHTML = '';
    TFS.forEach((tf) => {
      const b = document.createElement('button');
      b.textContent = tf; b.dataset.tf = tf;
      b.onclick = () => {
        if (S.tf === tf) return;
        S.tf = tf; paintTf(); loadAll();
      };
      box.appendChild(b);
    });
    paintTf();
  }
  function paintTf() {
    document.querySelectorAll('#tfbar button').forEach((b) => b.classList.toggle('active', b.dataset.tf === S.tf));
  }

  function setScale(mode) {
    if (!SCALES[mode]) mode = 'linear';
    S.scale = mode;
    applyYAxisType();
    try { localStorage.setItem('nk.scale', mode); } catch (_) { /* 忽略 */ }
  }

  /* ------------------------------ 启动 ------------------------------ */

  function bind() {
    document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
    $('btnLibrary').onclick = openLibrary;
    $('btnBackup').onclick = backupAll;
    $('btnTheme').onclick = () => applyTheme(S.theme === 'dark' ? 'light' : 'dark');
    $('scaleSel').onchange = (e) => setScale(e.target.value);
    $('modal').onclick = (e) => { if (e.target === $('modal')) closeModal(); };
    window.addEventListener('resize', () => chart.resize());

    document.addEventListener('keydown', (e) => {
      const typing = /input|textarea|select/i.test((document.activeElement && document.activeElement.tagName) || '');
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.selectedId) {
        removeSelected();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' && S.ui.focus) { toggleFocus(); return; }
      if (S.replay.active) {
        if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
        else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
      }
    });
  }

  async function boot() {
    buildRail();
    buildTf();
    bindSearch();
    bind();
    bindStar();
    bindTradeForm();
    bindNote();
    bindReplay();
    bindReplayDrag();

    try {
      const th = localStorage.getItem('nk.theme');
      if (th) S.theme = th;
      const sc = localStorage.getItem('nk.scale');
      if (sc && SCALES[sc]) { S.scale = sc; $('scaleSel').value = sc; }
      const ui = JSON.parse(localStorage.getItem('nk.ui') || 'null');
      if (ui) { S.ui.left = !!ui.left; S.ui.right = !!ui.right; }
      else if (localStorage.getItem('nk.leftHidden') === '1') S.ui.left = true;
    } catch (_) { /* 忽略 */ }
    applyTheme(S.theme);
    applyYAxisType();
    bindUI();
    applyUI();
    if (isMobile()) {
      $('rbJump').textContent = '跳';
      $('rbExit').textContent = '✕';
    }
    try {
      const u = localStorage.getItem('nk.unit');
      if (u === 'coin' || u === 'U') S.unit = u;
    } catch (_) { /* 忽略 */ }
    updateUnitLabel();

    await loadWatchlist();

    try {
      const saved = JSON.parse(localStorage.getItem('nk.last') || 'null');
      if (saved && saved.src && saved.symbol) {
        if (saved.tf) { S.tf = saved.tf; paintTf(); }
        selectSymbol(saved);
        return;
      }
    } catch (_) { /* 忽略 */ }
    selectSymbol({ id: 'binance-perp:BTCUSDT', src: 'binance-perp', symbol: 'BTCUSDT', coin: 'BTC', mkt: 'perp', label: 'BTC 永续 · 币安' });
  }

  window.addEventListener('beforeunload', () => {
    try {
      localStorage.setItem('nk.last', JSON.stringify({ id: S.id, src: S.src, symbol: S.symbol, coin: S.coin, mkt: S.src.includes('perp') ? 'perp' : 'spot', label: S.label, tf: S.tf }));
    } catch (_) { /* 忽略 */ }
    if (S.replay.active) saveSession();
  });

  window.__nk = { S, removeSelected, setScale, step, ensureForward, ensureBackward, loadReplayWindow };

  boot().catch((e) => {
    window.__bootErr = String((e && e.stack) || e);
    console.error('boot failed', e);
    try { toast('初始化失败: ' + (e && e.message ? e.message : e), true); } catch (_) { /* 忽略 */ }
  });
})();
