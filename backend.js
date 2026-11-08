/* 静态版后端：把原来由 server.js 提供的接口，全部用浏览器和 localStorage 实现 */
(function () {
  'use strict';

  const LS = {
    get(k, d) {
      try {
        const v = localStorage.getItem('nk.' + k);
        return v ? JSON.parse(v) : d;
      } catch (_) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('nk.' + k, JSON.stringify(v)); } catch (e) { console.warn('本地存储写入失败', e); }
    },
    del(k) { try { localStorage.removeItem('nk.' + k); } catch (_) { /* 忽略 */ } },
    keys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('nk.')) out.push(k.slice(3));
      }
      return out;
    },
  };

  async function j(url, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 20000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  /* ------------------------------ 周期工具 ------------------------------ */

  const UNIT = { m: 1, h: 60, d: 1440, w: 10080 };
  function parseTF(tf) {
    const m = /^(\d+)([mhdw])$/.exec(String(tf || '15m'));
    if (!m) return 15;
    return parseInt(m[1], 10) * UNIT[m[2]];
  }

  /* ------------------------------ 商品目录 ------------------------------ */

  async function getCatalog(force) {
    const cached = LS.get('catalog', null);
    if (!force && cached && Date.now() - cached.at < 6 * 3600 * 1000) return cached.items || [];
    const items = [];
    const vol = {};

    try {
      const [info, tick] = await Promise.all([
        j('https://fapi.binance.com/fapi/v1/exchangeInfo'),
        j('https://fapi.binance.com/fapi/v1/ticker/24hr').catch(() => []),
      ]);
      (tick || []).forEach((t) => { vol[t.symbol] = parseFloat(t.quoteVolume) || 0; });
      (info.symbols || []).forEach((s) => {
        if (s.contractType !== 'PERPETUAL' || s.quoteAsset !== 'USDT' || s.status !== 'TRADING') return;
        items.push({ id: 'binance-perp:' + s.symbol, src: 'binance-perp', ex: 'binance', mkt: 'perp', symbol: s.symbol, coin: s.baseAsset, label: s.baseAsset + ' 永续 · 币安', vol: vol[s.symbol] || 0 });
      });
    } catch (_) { /* 忽略 */ }

    try {
      const info = await j('https://api.binance.com/api/v3/exchangeInfo');
      (info.symbols || []).forEach((s) => {
        if (s.quoteAsset !== 'USDT' || s.status !== 'TRADING') return;
        items.push({ id: 'binance-spot:' + s.symbol, src: 'binance-spot', ex: 'binance', mkt: 'spot', symbol: s.symbol, coin: s.baseAsset, label: s.baseAsset + ' 现货 · 币安', vol: 0 });
      });
    } catch (_) { /* 忽略 */ }

    try {
      const r = await j('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
      (r.data || []).forEach((s) => {
        if (s.ctType !== 'linear' || s.settleCcy !== 'USDT' || s.state !== 'live') return;
        const base = (s.instId || '').split('-')[0];
        items.push({ id: 'okx-swap:' + s.instId, src: 'okx-swap', ex: 'okx', mkt: 'perp', symbol: s.instId, coin: base, label: base + ' 永续 · OKX', vol: 0 });
      });
    } catch (_) { /* 忽略 */ }

    try {
      const r = await j('https://www.okx.com/api/v5/public/instruments?instType=SPOT');
      (r.data || []).forEach((s) => {
        if (s.quoteCcy !== 'USDT' || s.state !== 'live') return;
        items.push({ id: 'okx-spot:' + s.instId, src: 'okx-spot', ex: 'okx', mkt: 'spot', symbol: s.instId, coin: s.baseCcy, label: s.baseCcy + ' 现货 · OKX', vol: 0 });
      });
    } catch (_) { /* 忽略 */ }

    if (!items.length) throw new Error('品种目录拉取失败，检查网络或关掉广告拦截');
    LS.set('catalog', { at: Date.now(), items });
    return items;
  }

  function searchCatalog(items, q) {
    const s = String(q || '').trim().toUpperCase();
    if (!s) return [];
    const scored = [];
    for (const it of items) {
      const coin = (it.coin || '').toUpperCase();
      const sym = (it.symbol || '').toUpperCase();
      let score = 0;
      if (coin === s) score = 100;
      else if (coin.startsWith(s)) score = 80 - Math.min(20, coin.length - s.length);
      else if (sym.startsWith(s)) score = 60;
      else if (sym.includes(s)) score = 40;
      else continue;
      scored.push({ it, score });
    }
    scored.sort((a, b) => b.score - a.score || (b.it.vol || 0) - (a.it.vol || 0));
    return scored.slice(0, 60).map((x) => x.it);
  }

  /* ------------------------------ K 线 ------------------------------ */

  const BN_NATIVE = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 };
  const OKX_BAR = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };

  function barFromBinance(r) {
    return { timestamp: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] };
  }

  async function bnLatest(src, symbol, tf) {
    const futures = src === 'binance-perp';
    const limit = futures ? 1500 : 1000;
    const base = futures ? 'https://fapi.binance.com' : 'https://api.binance.com';
    const path = futures ? '/fapi/v1/klines' : '/api/v3/klines';
    const maxBars = parseTF(tf) < 1440 ? 8000 : 20000;
    const chunks = [];
    let end = Date.now();
    let total = 0;
    let guard = 0;
    while (guard < 20 && total < maxBars) {
      guard++;
      const rows = await j(base + path + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + tf + '&endTime=' + end + '&limit=' + limit);
      if (!Array.isArray(rows) || !rows.length) break;
      chunks.unshift(rows);
      total += rows.length;
      end = rows[0][0] - 1;
      if (rows.length < limit) break;
    }
    const bars = [];
    for (const rows of chunks) for (const r of rows) bars.push(barFromBinance(r));
    if (!bars.length) throw new Error('没有取到 K 线：' + symbol);
    return bars;
  }

  async function okxLatest(src, symbol, tf) {
    const bar = OKX_BAR[tf] || '1m';
    const maxBars = 4000;
    const rows = [];
    let after = Date.now() + 60000;
    let guard = 0;
    while (guard < 60 && rows.length < maxBars) {
      guard++;
      const r = await j('https://www.okx.com/api/v5/market/history-candles?instId=' + encodeURIComponent(symbol) + '&bar=' + bar + '&after=' + after + '&limit=100');
      if (!r || r.code !== '0' || !r.data || !r.data.length) break;
      for (const x of r.data) rows.push({ timestamp: +x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +(x[7] || x[5] || 0) });
      after = +r.data[r.data.length - 1][0];
      if (r.data.length < 100) break;
    }
    if (!rows.length) throw new Error('OKX 没有取到 K 线：' + symbol);
    rows.reverse();
    return rows;
  }

  async function bnRange(src, symbol, tf, startTs, count) {
    const futures = src === 'binance-perp';
    const limit = futures ? 1500 : 1000;
    const base = futures ? 'https://fapi.binance.com' : 'https://api.binance.com';
    const path = futures ? '/fapi/v1/klines' : '/api/v3/klines';
    const bars = [];
    let start = Math.max(0, Math.floor(startTs));
    let guard = 0;
    while (bars.length < count && guard < 20) {
      guard++;
      const rows = await j(base + path + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + tf + '&startTime=' + start + '&limit=' + limit);
      if (!Array.isArray(rows) || !rows.length) break;
      for (const r of rows) if (!bars.length || r[0] > bars[bars.length - 1].timestamp) bars.push(barFromBinance(r));
      start = bars[bars.length - 1].timestamp + 1;
      if (rows.length < limit) break;
    }
    return bars.slice(0, count);
  }

  async function okxRange(src, symbol, tf, startTs, count) {
    const bar = OKX_BAR[tf] || '1m';
    const tfMs = parseTF(tf) * 60000;
    const out = [];
    let after = Math.max(1, Math.floor(startTs)) + count * tfMs;
    let guard = 0;
    while (out.length < count && guard < 80) {
      guard++;
      const r = await j('https://www.okx.com/api/v5/market/history-candles?instId=' + encodeURIComponent(symbol) + '&bar=' + bar + '&after=' + after + '&limit=100');
      if (!r || r.code !== '0' || !r.data || !r.data.length) break;
      const rows = r.data
        .map((x) => ({ timestamp: +x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +(x[7] || x[5] || 0) }))
        .sort((a, b) => a.timestamp - b.timestamp);
      for (const b of rows) out.push(b);
      after = rows[0].timestamp;
      if (rows[0].timestamp <= startTs) break;
    }
    const seen = new Set();
    const bars = [];
    for (const b of out) {
      if (b.timestamp >= startTs && !seen.has(b.timestamp)) { seen.add(b.timestamp); bars.push(b); }
    }
    bars.sort((a, b) => a.timestamp - b.timestamp);
    return bars.slice(0, count);
  }

  /* ------------------------------ 路由 ------------------------------ */

  function bodyOf(opts) {
    try { return JSON.parse((opts && opts.body) || '{}'); } catch (_) { return {}; }
  }

  window.NK_API = async function (path, opts) {
    const url = new URL(path, 'https://x/');
    const p = url.pathname;
    const q = url.searchParams;
    const method = (opts && opts.method) || 'GET';

    if (p === '/api/catalog') {
      const kw = (q.get('q') || '').trim();
      if (!kw) return { items: [] };
      const all = await getCatalog(q.get('refresh') === '1');
      return { items: searchCatalog(all, kw), total: all.length };
    }

    if (p === '/api/kline') {
      const src = q.get('src') || 'binance-perp';
      const symbol = q.get('symbol') || '';
      const tf = q.get('tf') || '1d';
      if (!symbol) throw new Error('缺少 symbol');
      const startRaw = q.get('start');
      const okx = src.startsWith('okx');

      if (startRaw !== null && startRaw !== '') {
        const startTs = Number(startRaw);
        const count = Number(q.get('count')) || 3000;
        const bars = okx ? await okxRange(src, symbol, tf, startTs, count) : await bnRange(src, symbol, tf, startTs, count);
        return {
          bars,
          count: bars.length,
          hasMore: bars.length ? bars[bars.length - 1].timestamp < Date.now() - parseTF(tf) * 60000 * 2 : false,
          first: bars.length ? bars[0].timestamp : 0,
          last: bars.length ? bars[bars.length - 1].timestamp : 0,
          source: src,
          tf,
        };
      }

      const bars = okx ? await okxLatest(src, symbol, tf) : await bnLatest(src, symbol, tf);
      return { bars, count: bars.length, source: src, tf, hasMore: false };
    }

    if (p === '/api/watchlist') {
      if (method === 'GET') return { groups: LS.get('watchlist', [{ id: 'main', name: '主看', items: [] }]) };
      LS.set('watchlist', bodyOf(opts).groups || []);
      return { ok: true };
    }

    if (p === '/api/drawings') {
      const key = q.get('key') || '';
      if (method === 'GET') return { items: (LS.get('draw|' + key, {}) || {}).items || [] };
      const b = bodyOf(opts);
      LS.set('draw|' + b.key, { meta: b.meta || {}, items: b.items || [], updatedAt: Date.now() });
      return { ok: true, count: (b.items || []).length };
    }

    if (p === '/api/trades') {
      const key = q.get('key') || '';
      if (method === 'GET') return { items: (LS.get('trade|' + key, {}) || {}).items || [] };
      const b = bodyOf(opts);
      LS.set('trade|' + b.key, { meta: b.meta || {}, items: b.items || [], updatedAt: Date.now() });
      return { ok: true, count: (b.items || []).length };
    }

    if (p === '/api/note') {
      const key = q.get('key') || '';
      if (method === 'GET') return { text: (LS.get('note|' + key, {}) || {}).text || '' };
      const b = bodyOf(opts);
      LS.set('note|' + b.key, { meta: b.meta || {}, text: b.text || '', updatedAt: Date.now() });
      return { ok: true };
    }

    if (p === '/api/session') {
      const key = q.get('key') || '';
      if (method === 'GET') return { session: (LS.get('replay|' + key, {}) || {}).data || null };
      if (method === 'DELETE') { LS.del('replay|' + key); return { ok: true }; }
      const b = bodyOf(opts);
      LS.set('replay|' + b.key, { meta: b.meta || {}, data: b.data || null, updatedAt: Date.now() });
      return { ok: true };
    }

    if (p === '/api/library') {
      const map = new Map();
      for (const k of LS.keys()) {
        const kind = k.startsWith('draw|') ? 'draw' : k.startsWith('trade|') ? 'trade' : null;
        if (!kind) continue;
        const key = k.slice(kind.length + 1);
        const rec = LS.get(k, {}) || {};
        const cur = map.get(key) || { key, meta: rec.meta || {}, drawings: 0, trades: 0, updatedAt: 0 };
        if (kind === 'draw') cur.drawings += (rec.items || []).length;
        else cur.trades += (rec.items || []).length;
        cur.updatedAt = Math.max(cur.updatedAt, rec.updatedAt || 0);
        if (!cur.meta.symbol && rec.meta && rec.meta.symbol) cur.meta = rec.meta;
        map.set(key, cur);
      }
      return { items: [...map.values()].filter((x) => x.drawings || x.trades).sort((a, b) => b.updatedAt - a.updatedAt) };
    }

    if (p === '/api/backup') {
      const records = LS.keys().map((k) => ({ key: k, data: LS.get(k, null) }));
      return { exportedAt: Date.now(), records };
    }

    throw new Error('接口不存在: ' + p);
  };
})();
