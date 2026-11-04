// Markets: spot metals, energy / fuel, forex, crypto and indices - quotes, charts
// and a news + technical analysis for every instrument.
//
// DATA SOURCES (all free, no key by default)
//   Yahoo Finance chart API  query1/query2.finance.yahoo.com/v8/finance/chart/{symbol}
//       Primary source for metals, energy, forex, indices (15 s-1 min delayed,
//       unofficial but widely used; it can rate-limit shared cloud IPs).
//   gold-api.com             live spot XAU / XAG / XPT / XPD       (fallback for metals)
//   Binance public data      data-api.binance.vision               (crypto + PAXG gold token)
//   Frankfurter (ECB)        api.frankfurter.dev                   (daily FX fallback + history)
//   open.er-api.com          daily FX fallback (more currencies)
//   Google News RSS          headlines for the analysis
//
// Truly tick-level free feeds for FX / metals / oil do not exist: the quotes here
// refresh every ~45 s on the server. Every row says which provider served it.

import Parser from "rss-parser";
import type {
  AnalysisHeadline,
  MarketAnalysis,
  MarketAsset,
  MarketGroup,
  MarketHistory,
  MarketPoint
} from "./types";

type Asset = {
  symbol: string;
  name: string;
  fa: string;
  group: MarketGroup;
  currency: string;
  decimals: number;
  yahoo: string[];
  goldApi?: string;
  binance?: string;
  fx?: { base: string; quote: string };
  newsQuery: string;
  profile: "gold" | "energy" | "gas" | "fx" | "crypto" | "index";
};

export const ASSETS: Asset[] = [
  // metals
  { symbol: "XAUUSD", name: "Gold (XAU/USD)", fa: "طلا (انس جهانی)", group: "metals", currency: "USD", decimals: 2,
    yahoo: ["XAUUSD=X", "GC=F"], goldApi: "XAU", newsQuery: "gold price", profile: "gold" },
  { symbol: "XAGUSD", name: "Silver (XAG/USD)", fa: "نقره (انس جهانی)", group: "metals", currency: "USD", decimals: 3,
    yahoo: ["XAGUSD=X", "SI=F"], goldApi: "XAG", newsQuery: "silver price", profile: "gold" },
  { symbol: "XPTUSD", name: "Platinum", fa: "پلاتین", group: "metals", currency: "USD", decimals: 2,
    yahoo: ["PL=F"], goldApi: "XPT", newsQuery: "platinum price", profile: "gold" },
  { symbol: "XPDUSD", name: "Palladium", fa: "پالادیوم", group: "metals", currency: "USD", decimals: 2,
    yahoo: ["PA=F"], goldApi: "XPD", newsQuery: "palladium price", profile: "gold" },
  // energy
  { symbol: "WTI", name: "WTI Crude Oil", fa: "نفت خام وست‌تگزاس (WTI)", group: "energy", currency: "USD", decimals: 2,
    yahoo: ["CL=F"], newsQuery: "WTI crude oil price", profile: "energy" },
  { symbol: "BRENT", name: "Brent Crude Oil", fa: "نفت برنت", group: "energy", currency: "USD", decimals: 2,
    yahoo: ["BZ=F"], newsQuery: "Brent crude oil price", profile: "energy" },
  { symbol: "NATGAS", name: "Natural Gas (Henry Hub)", fa: "گاز طبیعی", group: "energy", currency: "USD", decimals: 3,
    yahoo: ["NG=F"], newsQuery: "natural gas price", profile: "gas" },
  { symbol: "GASOLINE", name: "Gasoline (RBOB)", fa: "بنزین (RBOB)", group: "energy", currency: "USD", decimals: 4,
    yahoo: ["RB=F"], newsQuery: "gasoline futures price", profile: "energy" },
  { symbol: "DIESEL", name: "Diesel / Heating Oil (ULSD)", fa: "گازوئیل (ULSD)", group: "energy", currency: "USD", decimals: 4,
    yahoo: ["HO=F"], newsQuery: "diesel futures price", profile: "energy" },
  // forex
  { symbol: "EURUSD", name: "EUR/USD", fa: "یورو / دلار", group: "forex", currency: "", decimals: 5,
    yahoo: ["EURUSD=X"], fx: { base: "EUR", quote: "USD" }, newsQuery: "euro dollar EUR/USD", profile: "fx" },
  { symbol: "GBPUSD", name: "GBP/USD", fa: "پوند / دلار", group: "forex", currency: "", decimals: 5,
    yahoo: ["GBPUSD=X"], fx: { base: "GBP", quote: "USD" }, newsQuery: "pound sterling GBP/USD", profile: "fx" },
  { symbol: "USDJPY", name: "USD/JPY", fa: "دلار / ین", group: "forex", currency: "", decimals: 3,
    yahoo: ["JPY=X"], fx: { base: "USD", quote: "JPY" }, newsQuery: "yen dollar USD/JPY", profile: "fx" },
  { symbol: "USDCHF", name: "USD/CHF", fa: "دلار / فرانک سوئیس", group: "forex", currency: "", decimals: 5,
    yahoo: ["CHF=X"], fx: { base: "USD", quote: "CHF" }, newsQuery: "Swiss franc USD/CHF", profile: "fx" },
  { symbol: "USDCAD", name: "USD/CAD", fa: "دلار / دلار کانادا", group: "forex", currency: "", decimals: 5,
    yahoo: ["CAD=X"], fx: { base: "USD", quote: "CAD" }, newsQuery: "Canadian dollar loonie", profile: "fx" },
  { symbol: "AUDUSD", name: "AUD/USD", fa: "دلار استرالیا / دلار", group: "forex", currency: "", decimals: 5,
    yahoo: ["AUDUSD=X"], fx: { base: "AUD", quote: "USD" }, newsQuery: "Australian dollar AUD/USD", profile: "fx" },
  { symbol: "NZDUSD", name: "NZD/USD", fa: "دلار نیوزیلند / دلار", group: "forex", currency: "", decimals: 5,
    yahoo: ["NZDUSD=X"], fx: { base: "NZD", quote: "USD" }, newsQuery: "New Zealand dollar kiwi", profile: "fx" },
  { symbol: "USDCNY", name: "USD/CNY", fa: "دلار / یوان", group: "forex", currency: "", decimals: 4,
    yahoo: ["CNY=X"], fx: { base: "USD", quote: "CNY" }, newsQuery: "yuan renminbi USD/CNY", profile: "fx" },
  { symbol: "USDTRY", name: "USD/TRY", fa: "دلار / لیر ترکیه", group: "forex", currency: "", decimals: 4,
    yahoo: ["TRY=X"], fx: { base: "USD", quote: "TRY" }, newsQuery: "Turkish lira dollar", profile: "fx" },
  { symbol: "USDINR", name: "USD/INR", fa: "دلار / روپیه هند", group: "forex", currency: "", decimals: 3,
    yahoo: ["INR=X"], fx: { base: "USD", quote: "INR" }, newsQuery: "Indian rupee dollar", profile: "fx" },
  { symbol: "DXY", name: "US Dollar Index (DXY)", fa: "شاخص دلار (DXY)", group: "forex", currency: "", decimals: 3,
    yahoo: ["DX-Y.NYB", "DX=F"], fx: { base: "USD", quote: "" }, newsQuery: "US dollar index DXY", profile: "fx" },
  // crypto
  { symbol: "BTCUSDT", name: "Bitcoin", fa: "بیت‌کوین", group: "crypto", currency: "USD", decimals: 2,
    yahoo: ["BTC-USD"], binance: "BTCUSDT", newsQuery: "bitcoin price", profile: "crypto" },
  { symbol: "ETHUSDT", name: "Ethereum", fa: "اتریوم", group: "crypto", currency: "USD", decimals: 2,
    yahoo: ["ETH-USD"], binance: "ETHUSDT", newsQuery: "ethereum price", profile: "crypto" },
  { symbol: "BNBUSDT", name: "BNB", fa: "بایننس‌کوین", group: "crypto", currency: "USD", decimals: 2,
    yahoo: ["BNB-USD"], binance: "BNBUSDT", newsQuery: "BNB price", profile: "crypto" },
  { symbol: "SOLUSDT", name: "Solana", fa: "سولانا", group: "crypto", currency: "USD", decimals: 2,
    yahoo: ["SOL-USD"], binance: "SOLUSDT", newsQuery: "solana price", profile: "crypto" },
  { symbol: "XRPUSDT", name: "XRP", fa: "ریپل", group: "crypto", currency: "USD", decimals: 4,
    yahoo: ["XRP-USD"], binance: "XRPUSDT", newsQuery: "XRP price", profile: "crypto" },
  // indices
  { symbol: "SPX", name: "S&P 500", fa: "اس‌اندپی ۵۰۰", group: "index", currency: "", decimals: 2,
    yahoo: ["^GSPC"], newsQuery: "S&P 500 stocks", profile: "index" },
  { symbol: "NDX", name: "Nasdaq Composite", fa: "نزدک", group: "index", currency: "", decimals: 2,
    yahoo: ["^IXIC"], newsQuery: "Nasdaq stocks", profile: "index" },
  { symbol: "DJI", name: "Dow Jones", fa: "داو جونز", group: "index", currency: "", decimals: 2,
    yahoo: ["^DJI"], newsQuery: "Dow Jones stocks", profile: "index" },
  { symbol: "DAX", name: "DAX 40", fa: "داکس آلمان", group: "index", currency: "", decimals: 2,
    yahoo: ["^GDAXI"], newsQuery: "DAX Germany stocks", profile: "index" },
  { symbol: "N225", name: "Nikkei 225", fa: "نیکی ۲۲۵", group: "index", currency: "", decimals: 2,
    yahoo: ["^N225"], newsQuery: "Nikkei stocks", profile: "index" }
];

const bySymbol = new Map(ASSETS.map(a => [a.symbol, a]));

/* ------------------------------------------------------------- provider state */

type ProviderState = { status: string; detail: string; ok: number; failed: number; lastOk: number };

const providers: Record<string, ProviderState> = {};

function provider(name: string) {
  return (providers[name] ||= { status: "offline", detail: "not used yet", ok: 0, failed: 0, lastOk: 0 });
}

function markOk(name: string, detail = "") {
  const p = provider(name);
  p.ok += 1;
  p.lastOk = Date.now();
  p.status = "online";
  p.detail = detail || `${p.ok} ok / ${p.failed} failed`;
}

function markFail(name: string, error: unknown) {
  const p = provider(name);
  p.failed += 1;
  p.status = p.lastOk && Date.now() - p.lastOk < 10 * 60 * 1000 ? "online" : "offline";
  p.detail = `${error instanceof Error ? error.message : String(error)} (${p.ok} ok / ${p.failed} failed)`;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/* --------------------------------------------------------------------- Yahoo */

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

let yahooGate = 0;
async function yahooWait() {
  const wait = yahooGate - Date.now();
  yahooGate = Math.max(Date.now(), yahooGate) + 220;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

type YahooChart = {
  price: number | null;
  prevClose: number | null;
  high: number | null;
  low: number | null;
  time: number | null;
  points: MarketPoint[];
};

export function parseYahooChart(json: any): YahooChart {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || "empty chart result");

  const meta = result.meta || {};
  const ts: number[] = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const points: MarketPoint[] = [];

  for (let i = 0; i < ts.length; i++) {
    const c = num(q.close?.[i]);
    if (c === null) continue;

    points.push({
      t: ts[i] * 1000,
      c,
      o: num(q.open?.[i]) ?? undefined,
      h: num(q.high?.[i]) ?? undefined,
      l: num(q.low?.[i]) ?? undefined
    });
  }

  return {
    price: num(meta.regularMarketPrice) ?? (points.length ? points[points.length - 1].c : null),
    prevClose: num(meta.previousClose) ?? num(meta.chartPreviousClose),
    high: num(meta.regularMarketDayHigh),
    low: num(meta.regularMarketDayLow),
    time: num(meta.regularMarketTime),
    points
  };
}

async function yahooChart(symbol: string, range: string, interval: string): Promise<YahooChart> {
  let lastError: unknown = null;

  for (const host of ["query1", "query2"]) {
    try {
      await yahooWait();

      const url =
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?range=${range}&interval=${interval}&includePrePost=false`;

      const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);

      const chart = parseYahooChart(await response.json());
      markOk("Yahoo Finance");
      return chart;
    } catch (err) {
      lastError = err;
    }
  }

  markFail("Yahoo Finance", lastError);
  throw lastError;
}

/* ------------------------------------------------------------ other providers */

async function goldApiPrice(code: string): Promise<{ price: number; time: number } | null> {
  try {
    const response = await fetch(`https://api.gold-api.com/price/${code}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as any;
    const price = num(data.price);
    if (price === null) throw new Error("no price in response");

    markOk("gold-api.com");
    return { price, time: data.updatedAt ? Date.parse(data.updatedAt) || Date.now() : Date.now() };
  } catch (err) {
    markFail("gold-api.com", err);
    return null;
  }
}

type BinanceTicker = { price: number; pct: number; abs: number; high: number; low: number };

async function binanceTickers(symbols: string[]): Promise<Map<string, BinanceTicker>> {
  const out = new Map<string, BinanceTicker>();
  if (!symbols.length) return out;

  try {
    const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    for (const t of (await response.json()) as any[]) {
      const price = num(t.lastPrice);
      if (price === null) continue;

      out.set(t.symbol, {
        price,
        pct: num(t.priceChangePercent) ?? 0,
        abs: num(t.priceChange) ?? 0,
        high: num(t.highPrice) ?? price,
        low: num(t.lowPrice) ?? price
      });
    }

    markOk("Binance");
  } catch (err) {
    markFail("Binance", err);
  }

  return out;
}

async function binanceKlines(symbol: string, interval: string, limit: number): Promise<MarketPoint[]> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);

  const rows = (await response.json()) as any[][];
  markOk("Binance");

  return rows.map(r => ({ t: r[0] as number, o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
}

let fxCache: { at: number; rates: Record<string, number>; source: string } | null = null;

/** Units of each currency per 1 USD (daily reference rates). */
async function fxRates(): Promise<{ rates: Record<string, number>; source: string }> {
  if (fxCache && Date.now() - fxCache.at < 30 * 60 * 1000) return fxCache;

  const attempts: [string, string, (d: any) => Record<string, number> | undefined][] = [
    ["Frankfurter (ECB)", "https://api.frankfurter.dev/v1/latest?base=USD", d => d.rates],
    ["open.er-api.com", "https://open.er-api.com/v6/latest/USD", d => d.rates]
  ];

  let lastError: unknown = null;

  for (const [name, url, pick] of attempts) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const rates = pick(await response.json());
      if (!rates) throw new Error("no rates");

      markOk(name);
      fxCache = { at: Date.now(), rates: { ...rates, USD: 1 }, source: name };
      return fxCache;
    } catch (err) {
      lastError = err;
      markFail(name, err);
    }
  }

  throw lastError;
}

async function frankfurterSeries(base: string, quote: string, days: number): Promise<MarketPoint[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const f = (d: Date) => d.toISOString().slice(0, 10);

  const response = await fetch(
    `https://api.frankfurter.dev/v1/${f(start)}..${f(end)}?base=${base}&symbols=${quote}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!response.ok) throw new Error(`Frankfurter HTTP ${response.status}`);

  const data = (await response.json()) as any;
  markOk("Frankfurter (ECB)");

  return Object.entries(data.rates || {})
    .map(([date, v]: [string, any]) => ({ t: Date.parse(date), c: Number(v[quote]) }))
    .filter(p => Number.isFinite(p.c))
    .sort((a, b) => a.t - b.t);
}

/* -------------------------------------------------------------------- quotes */

const quotes = new Map<string, MarketAsset>();
let quotesAt = 0;
let refreshing: Promise<void> | null = null;

function baseAsset(a: Asset): MarketAsset {
  return {
    symbol: a.symbol,
    name: a.name,
    nameFa: a.fa,
    group: a.group,
    price: null,
    change24h: null,
    changeAbs: null,
    high: null,
    low: null,
    currency: a.currency,
    decimals: a.decimals,
    source: "unavailable",
    updatedAt: new Date().toISOString()
  };
}

async function quoteOne(a: Asset, binance: Map<string, BinanceTicker>): Promise<MarketAsset> {
  const out = baseAsset(a);

  // crypto: Binance first (real-time ticker with 24 h change)
  if (a.binance && binance.has(a.binance)) {
    const t = binance.get(a.binance)!;
    return { ...out, price: t.price, change24h: t.pct, changeAbs: t.abs, high: t.high, low: t.low, source: "Binance" };
  }

  // Yahoo (all other groups, plus crypto fallback)
  for (const sym of a.yahoo) {
    try {
      const c = await yahooChart(sym, "1d", "5m");
      if (c.price === null) continue;

      const prev = c.prevClose;
      return {
        ...out,
        price: c.price,
        change24h: prev ? ((c.price - prev) / prev) * 100 : null,
        changeAbs: prev ? c.price - prev : null,
        high: c.high,
        low: c.low,
        source: `Yahoo Finance (${sym})`,
        updatedAt: c.time ? new Date(c.time * 1000).toISOString() : out.updatedAt
      };
    } catch {
      // try the next symbol / provider
    }
  }

  // fallbacks
  if (a.goldApi) {
    const g = await goldApiPrice(a.goldApi);
    if (g) return { ...out, price: g.price, source: "gold-api.com (spot)", updatedAt: new Date(g.time).toISOString() };
  }

  if (a.fx && a.fx.quote) {
    try {
      const { rates, source } = await fxRates();
      const b = rates[a.fx.base];
      const q = rates[a.fx.quote];

      if (b && q) {
        return {
          ...out,
          price: q / b,
          source: `${source} (daily reference)`,
          note: "Daily reference rate, not a live quote"
        };
      }
    } catch {
      // fall through
    }
  }

  return { ...out, note: "All providers unavailable right now" };
}

async function refreshQuotes() {
  const binance = await binanceTickers(ASSETS.filter(a => a.binance).map(a => a.binance!));
  const queue = [...ASSETS];

  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const a = queue.shift()!;
        const q = await quoteOne(a, binance);

        // never replace a good cached price with an empty one
        const old = quotes.get(a.symbol);
        if (q.price === null && old?.price !== null && old) continue;

        quotes.set(a.symbol, q);
      }
    })
  );

  quotesAt = Date.now();
}

function ensureRefresh() {
  if (!refreshing) {
    refreshing = refreshQuotes().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function getMarkets() {
  if (!quotes.size) await Promise.race([ensureRefresh(), new Promise(r => setTimeout(r, 25000))]);
  else if (Date.now() - quotesAt > 40000) void ensureRefresh();

  const items = ASSETS.map(a => quotes.get(a.symbol) || baseAsset(a));

  return { items, updatedAt: new Date(quotesAt || Date.now()).toISOString() };
}

export function startMarkets() {
  void ensureRefresh();
  setInterval(() => void ensureRefresh(), 45000).unref();
}

export function marketStatus() {
  const out: Record<string, { status: string; detail: string }> = {};

  for (const [name, p] of Object.entries(providers)) {
    out[`Markets: ${name}`] = { status: p.status === "online" ? "public" : p.status, detail: p.detail };
  }

  if (!Object.keys(out).length) out["Markets"] = { status: "offline", detail: "starting..." };
  return out;
}

/* ------------------------------------------------------------------- history */

const RANGES: Record<string, { range: string; interval: string; b: [string, number]; days: number }> = {
  "1D": { range: "1d", interval: "5m", b: ["5m", 288], days: 2 },
  "5D": { range: "5d", interval: "15m", b: ["30m", 240], days: 7 },
  "1M": { range: "1mo", interval: "1h", b: ["1h", 720], days: 31 },
  "6M": { range: "6mo", interval: "1d", b: ["1d", 180], days: 183 },
  "1Y": { range: "1y", interval: "1d", b: ["1d", 365], days: 366 },
  "5Y": { range: "5y", interval: "1wk", b: ["1w", 260], days: 1830 }
};

const historyCache = new Map<string, { at: number; value: MarketHistory }>();

export async function getHistory(symbol: string, rangeKey: string): Promise<MarketHistory> {
  const a = bySymbol.get(symbol);
  if (!a) throw new Error("unknown symbol");

  const r = RANGES[rangeKey] || RANGES["1M"];
  const key = `${symbol}|${rangeKey}`;
  const hit = historyCache.get(key);
  const ttl = rangeKey === "1D" || rangeKey === "5D" ? 60000 : 10 * 60000;

  if (hit && Date.now() - hit.at < ttl) return hit.value;

  const errors: string[] = [];
  let points: MarketPoint[] = [];
  let source = "";

  const tryYahoo = async () => {
    for (const sym of a.yahoo) {
      try {
        const c = await yahooChart(sym, r.range, r.interval);
        if (c.points.length > 5) {
          points = c.points;
          source = `Yahoo Finance (${sym})`;
          return;
        }
      } catch (err) {
        errors.push(`${sym}: ${err instanceof Error ? err.message : err}`);
      }
    }
  };

  const tryBinance = async (symbolB: string, label: string) => {
    try {
      const p = await binanceKlines(symbolB, r.b[0], r.b[1]);
      if (p.length > 5) {
        points = p;
        source = label;
      }
    } catch (err) {
      errors.push(`Binance: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (a.binance) {
    await tryBinance(a.binance, "Binance");
    if (!points.length) await tryYahoo();
  } else {
    await tryYahoo();

    if (!points.length && a.symbol === "XAUUSD") await tryBinance("PAXGUSDT", "Binance PAXG (gold-backed token, proxy)");

    if (!points.length && a.fx && a.fx.quote) {
      try {
        points = await frankfurterSeries(a.fx.base, a.fx.quote, Math.max(r.days, 5));
        source = "Frankfurter (ECB daily)";
      } catch (err) {
        errors.push(`Frankfurter: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const value: MarketHistory = {
    symbol,
    range: rangeKey,
    points,
    source: source || "unavailable",
    detail: points.length ? undefined : errors.join(" | ") || "no history available"
  };

  if (points.length) historyCache.set(key, { at: Date.now(), value });
  return value;
}

/* --------------------------------------------------------------- technicals */

export function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

export function rsi(values: number[], n = 14): number | null {
  if (values.length <= n) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }

  gain /= n;
  loss /= n;

  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }

  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

const pct = (from: number | undefined, to: number | undefined) =>
  from && to ? ((to - from) / from) * 100 : null;

/* ---------------------------------------------------------------- sentiment */

type Rule = [RegExp, number, string];

export const DRIVERS: Record<string, { en: string; fa: string }> = {
  rate_cut: { en: "rate-cut expectations", fa: "انتظار کاهش نرخ بهره" },
  hawkish: { en: "hawkish central-bank tone / rate-hike risk", fa: "لحن سخت‌گیرانه بانک مرکزی و ریسک افزایش نرخ" },
  safe_haven: { en: "safe-haven demand", fa: "تقاضای پناهگاه امن" },
  geo_up: { en: "geopolitical tension", fa: "تنش‌های ژئوپلیتیک" },
  geo_down: { en: "easing tensions / ceasefire", fa: "کاهش تنش / آتش‌بس" },
  inflation: { en: "inflation concerns", fa: "نگرانی از تورم" },
  dollar_weak: { en: "weaker US dollar", fa: "ضعف دلار آمریکا" },
  dollar_strong: { en: "stronger US dollar", fa: "قدرت‌گیری دلار آمریکا" },
  yields_up: { en: "rising bond yields", fa: "افزایش بازده اوراق" },
  cb_buying: { en: "central-bank buying", fa: "خرید بانک‌های مرکزی" },
  etf_in: { en: "ETF inflows", fa: "ورود پول به ETF" },
  etf_out: { en: "ETF outflows", fa: "خروج پول از ETF" },
  profit_taking: { en: "profit-taking", fa: "کسب سود" },
  risk_on: { en: "risk-on mood", fa: "رغبت به ریسک" },
  opec_cut: { en: "OPEC+ / production cuts", fa: "کاهش تولید اوپک‌پلاس" },
  opec_raise: { en: "higher output", fa: "افزایش تولید" },
  supply_risk: { en: "supply disruption risk", fa: "ریسک اختلال در عرضه" },
  supply_glut: { en: "oversupply", fa: "مازاد عرضه" },
  attacks: { en: "attacks on energy infrastructure / shipping lanes", fa: "حمله به زیرساخت انرژی و مسیرهای کشتیرانی" },
  sanctions: { en: "sanctions", fa: "تحریم‌ها" },
  inventory_draw: { en: "falling inventories", fa: "کاهش ذخایر" },
  inventory_build: { en: "rising inventories", fa: "افزایش ذخایر" },
  demand_up: { en: "stronger demand", fa: "رشد تقاضا" },
  demand_down: { en: "weaker demand", fa: "ضعف تقاضا" },
  recession: { en: "growth / recession worries", fa: "نگرانی از رکود و رشد اقتصادی" },
  weather_cold: { en: "cold / storm weather", fa: "هوای سرد یا طوفان" },
  weather_mild: { en: "mild weather", fa: "هوای معتدل" },
  etf_approval: { en: "ETF / institutional adoption", fa: "ETF و ورود نهادی" },
  regulation: { en: "regulatory crackdown", fa: "سخت‌گیری قانونی" },
  hack: { en: "hacks / exploits", fa: "هک و سوءاستفاده" },
  liquidations: { en: "liquidations / sell-off", fa: "تصفیه موقعیت‌ها و فروش" },
  earnings_up: { en: "strong earnings", fa: "سود شرکت‌ها بهتر از انتظار" },
  earnings_down: { en: "weak earnings", fa: "سود شرکت‌ها ضعیف" },
  tariffs: { en: "tariffs / trade tensions", fa: "تعرفه‌ها و تنش تجاری" },
  trade_deal: { en: "trade deal", fa: "توافق تجاری" },
  strong_data: { en: "strong economic data", fa: "داده‌های اقتصادی قوی" },
  weak_data: { en: "weak economic data", fa: "داده‌های اقتصادی ضعیف" },
  momentum_up: { en: "price momentum up", fa: "شتاب صعودی قیمت" },
  momentum_down: { en: "price momentum down", fa: "شتاب نزولی قیمت" },
  intervention: { en: "currency intervention", fa: "مداخله ارزی" }
};

const GOLD_RULES: Rule[] = [
  [/rate[- ]cuts?|cut(ting)? (interest )?rates|dovish|easing cycle|fed pivot/i, 1, "rate_cut"],
  [/safe[- ]haven|flight to safety|haven demand/i, 1, "safe_haven"],
  [/geopolitic|tensions?\b|\bwar\b|conflict|escalat|missile|invasion|sanction/i, 0.8, "geo_up"],
  [/inflation (fears|concerns|worries|rises|jumps|heats)|hot (cpi|inflation)/i, 0.6, "inflation"],
  [/(weaker|weakening|softer|falling|sliding) (us )?dollar|dollar (falls|slips|weakens|drops|declines|retreats|slides|eases)/i, 1, "dollar_weak"],
  [/central banks? (buy|buying|purchases?|demand|accumulat)/i, 1, "cb_buying"],
  [/etf (inflows?|buying)|inflows? (into|to) .{0,20}etf/i, 0.8, "etf_in"],
  [/rate[- ]hikes?|hawkish|higher for longer|raise rates|no rate cuts?/i, -1, "hawkish"],
  [/(stronger|strengthening|firmer|rising|surging) (us )?dollar|dollar (rises|gains|strengthens|jumps|surges|climbs|firms)/i, -1, "dollar_strong"],
  [/yields? (rise|rises|jump|jumps|climb|climbs|surge|surges|spike|spikes)/i, -0.8, "yields_up"],
  [/profit[- ]taking|takes? profits?|taking profits?/i, -0.7, "profit_taking"],
  [/cease[- ]?fire|peace (deal|talks|agreement)|de-?escalat|tensions? (ease|eases|easing|cool|cools)/i, -0.8, "geo_down"],
  [/risk[- ]on|stocks rall(y|ies)|equities rall(y|ies)/i, -0.4, "risk_on"],
  [/etf (outflows?|selling)|outflows? from .{0,20}etf/i, -0.8, "etf_out"]
];

const ENERGY_RULES: Rule[] = [
  [/opec\+?.{0,40}(cut|cuts|curb|curbs|extend|extends|reduce|lower)|(production|output|supply) cuts?/i, 1, "opec_cut"],
  [/supply (disruption|concerns|worries|risk|shortage|fears|outage)|outages?|disruptions?/i, 1, "supply_risk"],
  [/sanction/i, 0.7, "sanctions"],
  [/houthi|red sea|hormuz|blockade|(attack|drone|missile|strike|strikes)\b.{0,40}(refiner|pipeline|tanker|oil|field|port|facility|terminal)/i, 0.9, "attacks"],
  [/(inventor(y|ies)|stocks|stockpiles?|crude stocks?).{0,25}(draw|drawdown|fall|fell|drop|dropped|decline|declined|shrink|shrank|decrease)/i, 1, "inventory_draw"],
  [/(demand|consumption).{0,20}(growth|rebound|recover|recovery|surge|strong|rise|rises|higher|robust)/i, 0.8, "demand_up"],
  [/tensions?\b|escalat|\bwar\b|conflict/i, 0.5, "geo_up"],
  [/oversupply|supply glut|\bglut\b|surplus|ample supply/i, -1, "supply_glut"],
  [/(inventor(y|ies)|stocks|stockpiles?).{0,25}(build|builds|rise|rose|jump|jumped|increase|increased|climb|surge)/i, -1, "inventory_build"],
  [/(demand|consumption).{0,20}(concerns?|worries|fears|weak|weakness|slump|slow|slowdown|fall|falls|drop|decline|soft)/i, -1, "demand_down"],
  [/recession|slowdown|slowing (economy|growth)|growth (fears|worries|concerns)/i, -0.8, "recession"],
  [/opec\+?.{0,40}(increase|raise|hike|boost|add|ramp|unwind|pump)|output (hike|increase|boost)|(increase|raise|boost)s? (output|production)|record (production|output)/i, -1, "opec_raise"],
  [/cease[- ]?fire|peace (deal|talks)|de-?escalat|tensions? (ease|eases|easing)|sanctions? (relief|lifted|eased)/i, -0.8, "geo_down"],
  [/(stronger|strengthening|rising) (us )?dollar|dollar (rises|gains|strengthens|jumps)/i, -0.5, "dollar_strong"]
];

const GAS_RULES: Rule[] = [
  ...ENERGY_RULES,
  [/cold snap|freeze|freezing|polar vortex|hurricane|heat ?wave|storm/i, 0.7, "weather_cold"],
  [/mild (weather|winter)|warm(er)? (weather|winter|forecast)/i, -0.7, "weather_mild"]
];

const CRYPTO_RULES: Rule[] = [
  [/etf (inflows?|approval|approved)|institutional|adoption|halving|rate cuts?|treasury (buys|purchases)/i, 0.8, "etf_approval"],
  [/\bhack(ed|s)?\b|exploit|stolen|breach/i, -0.9, "hack"],
  [/\bban(s|ned)?\b|crackdown|lawsuit|sec sues|regulat(ion|ory) (fears|concerns)/i, -0.8, "regulation"],
  [/outflows?|liquidations?|sell-?off|crash|capitulation/i, -0.8, "liquidations"],
  [/rate[- ]hikes?|hawkish/i, -0.5, "hawkish"]
];

const INDEX_RULES: Rule[] = [
  [/rate[- ]cuts?|dovish|soft landing|cooling inflation/i, 0.8, "rate_cut"],
  [/earnings (beat|beats|top|surge)|strong earnings|record (profit|earnings)/i, 0.8, "earnings_up"],
  [/trade (deal|truce)|tariffs? (cut|eased|pause)/i, 0.7, "trade_deal"],
  [/strong (jobs|data|growth|economy)/i, 0.5, "strong_data"],
  [/recession|slowdown/i, -0.8, "recession"],
  [/rate[- ]hikes?|hawkish|higher for longer|yields? (rise|jump|surge|spike)/i, -0.8, "hawkish"],
  [/tariffs?|trade war/i, -0.7, "tariffs"],
  [/earnings (miss|misses|disappoint|warning)|profit warning/i, -0.8, "earnings_down"],
  [/weak (jobs|data|growth)|shutdown|inflation (hot|surge|jump|rises)/i, -0.6, "weak_data"],
  [/geopolitic|\bwar\b|tensions?\b/i, -0.4, "geo_up"]
];

const UP_WORDS =
  /\b(rise|rises|rose|rising|gain|gains|gained|climb|climbs|climbed|jump|jumps|jumped|surge|surges|surged|soar|soars|soared|rall(y|ies|ied)|record high|higher|advance|advances|rebound|rebounds|recover|recovers)\b/i;
const DOWN_WORDS =
  /\b(fall|falls|fell|falling|drop|drops|dropped|slip|slips|slipped|slide|slides|slid|slump|slumps|plunge|plunges|plunged|tumble|tumbles|tumbled|decline|declines|declined|lower|retreat|retreats|sink|sinks|sank|loses|lost|sell-?off)\b/i;

const CCY: Record<string, RegExp> = {
  USD: /\b(dollar|greenback|usd|fed|federal reserve|powell|treasur(y|ies))\b/i,
  EUR: /\b(euro|eur|ecb|lagarde|eurozone)\b/i,
  GBP: /\b(pound|sterling|gbp|boe|bank of england|bailey)\b/i,
  JPY: /\b(yen|jpy|boj|bank of japan|ueda)\b/i,
  CHF: /\b(franc|chf|snb|swiss national bank)\b/i,
  CAD: /\b(loonie|cad|canadian dollar|bank of canada|boc)\b/i,
  AUD: /\b(aussie|aud|australian dollar|rba)\b/i,
  NZD: /\b(kiwi|nzd|new zealand dollar|rbnz)\b/i,
  CNY: /\b(yuan|renminbi|cny|pboc)\b/i,
  TRY: /\b(lira|turkish lira)\b/i,
  INR: /\b(rupee|inr|rbi)\b/i
};

const CCY_UP =
  /\b(rise|rises|rose|gain|gains|gained|firm|firms|firmer|strengthen|strengthens|strengthened|climb|climbs|surge|surges|rall(y|ies)|jump|jumps|hawkish|rate hikes?|higher rates|hot inflation|strong (data|jobs|growth)|beats?|safe[- ]haven)\b/i;
const CCY_DOWN =
  /\b(fall|falls|fell|drop|drops|dropped|slip|slips|slide|slides|slump|slumps|weaken|weakens|weakened|decline|declines|tumble|tumbles|dovish|rate cuts?|lower rates|cools?|weak (data|jobs|growth)|misses?|recession)\b/i;

function currencyStrength(title: string, ccy: string, others: string[]): number {
  const re = CCY[ccy];
  if (!re) return 0;

  const m = re.exec(title);
  if (!m) return 0;

  // the clause about this currency ends where another tracked currency is named
  const from = m.index + m[0].length;
  let end = Math.min(title.length, m.index + 70);

  for (const other of others) {
    if (other === ccy || !CCY[other]) continue;
    const next = CCY[other].exec(title.slice(from));
    if (next) end = Math.min(end, from + next.index);
  }

  const after = title.slice(m.index, end);
  const up = CCY_UP.test(after);
  const down = CCY_DOWN.test(after);

  if (up !== down) return up ? 1 : -1;

  // no local verb: only trust the whole headline when no other tracked currency is named
  const multiple = others.some(o => o !== ccy && CCY[o]?.test(title));
  if (multiple) return 0;

  const u = CCY_UP.test(title);
  const d = CCY_DOWN.test(title);
  return u === d ? 0 : u ? 1 : -1;
}

function profileRules(a: Asset): Rule[] {
  switch (a.profile) {
    case "gold": return GOLD_RULES;
    case "energy": return ENERGY_RULES;
    case "gas": return GAS_RULES;
    case "crypto": return CRYPTO_RULES;
    case "index": return INDEX_RULES;
    default: return [];
  }
}

export function scoreHeadline(title: string, a: Asset): { score: number; drivers: string[] } {
  const drivers: string[] = [];
  let score = 0;

  if (a.profile === "fx" && a.fx) {
    const list = Object.keys(CCY);
    const base = currencyStrength(title, a.fx.base, list);
    const quote = a.fx.quote ? currencyStrength(title, a.fx.quote, list) : 0;
    score = base - quote;

    if (/hawkish|rate hikes?|higher rates/i.test(title)) drivers.push("hawkish");
    if (/dovish|rate cuts?|lower rates/i.test(title)) drivers.push("rate_cut");
    if (/interven/i.test(title)) drivers.push("intervention");
    if (/strong (data|jobs|growth)/i.test(title)) drivers.push("strong_data");
    if (/weak (data|jobs|growth)|recession/i.test(title)) drivers.push("weak_data");
    if (/inflation/i.test(title)) drivers.push("inflation");

    return { score: Math.max(-3, Math.min(3, score * 1.5)) / 3, drivers };
  }

  for (const [re, w, key] of profileRules(a)) {
    if (re.test(title)) {
      score += w;
      drivers.push(key);
    }
  }

  // generic "price rises / falls" wording (counted once each)
  if (UP_WORDS.test(title)) score += 0.5;
  if (DOWN_WORDS.test(title)) score -= 0.5;

  return { score: Math.max(-3, Math.min(3, score)) / 3, drivers };
}

/* ---------------------------------------------------------------------- news */

const rss = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "Mozilla/5.0 SHADOWBROKER/3.0" },
  customFields: { item: [["source", "sourceName"]] }
});

const newsCache = new Map<string, { at: number; items: { title: string; source: string; url: string; time: number }[] }>();

async function fetchNews(query: string) {
  const hit = newsCache.get(query);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.items;

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:3d")}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 SHADOWBROKER/3.0", Accept: "application/rss+xml,application/xml,text/xml" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const feed = await rss.parseString(await response.text());
    const seen = new Set<string>();
    const items: { title: string; source: string; url: string; time: number }[] = [];

    for (const it of feed.items || []) {
      let title = String(it.title || "").trim();
      let source = String((it as any).sourceName?._ ?? (it as any).sourceName ?? "").trim();

      const cut = title.lastIndexOf(" - ");
      if (cut > 20) {
        if (!source) source = title.slice(cut + 3);
        title = title.slice(0, cut);
      }

      const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 80);
      if (!title || seen.has(norm)) continue;
      seen.add(norm);

      items.push({
        title,
        source: source || "Google News",
        url: String(it.link || ""),
        time: it.isoDate ? Date.parse(it.isoDate) : Date.now()
      });

      if (items.length >= 30) break;
    }

    markOk("Google News RSS");
    newsCache.set(query, { at: Date.now(), items });
    return items;
  } catch (err) {
    markFail("Google News RSS", err);
    return hit?.items || [];
  }
}

/* ------------------------------------------------------------------ analysis */

const analysisCache = new Map<string, { at: number; value: MarketAnalysis }>();

const fmt = (v: number | null, d = 2) =>
  v === null ? "n/a" : new Intl.NumberFormat("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);

const sgn = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);

export async function getAnalysis(symbol: string): Promise<MarketAnalysis> {
  const a = bySymbol.get(symbol);
  if (!a) throw new Error("unknown symbol");

  const hit = analysisCache.get(symbol);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value;

  const [history, news, market] = await Promise.all([
    getHistory(symbol, "6M").catch(() => null),
    fetchNews(a.newsQuery),
    getMarkets()
  ]);

  const quote = market.items.find(i => i.symbol === symbol);
  const closes = (history?.points || []).map(p => p.c);
  const price = quote?.price ?? (closes.length ? closes[closes.length - 1] : null);

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const last = closes[closes.length - 1];

  const isIntraday = false; // 6M history is daily
  const change1d = quote?.change24h ?? (closes.length > 1 && !isIntraday ? pct(closes[closes.length - 2], last) : null);
  const change5d = closes.length > 5 ? pct(closes[closes.length - 6], last) : null;
  const change1m = closes.length > 21 ? pct(closes[closes.length - 22], last) : null;
  const month = closes.slice(-22);

  let trend: "up" | "down" | "sideways" | "unknown" = "unknown";
  if (price !== null && sma20 !== null && sma50 !== null) {
    if (price > sma20 && sma20 > sma50) trend = "up";
    else if (price < sma20 && sma20 < sma50) trend = "down";
    else trend = "sideways";
  } else if (price !== null && sma20 !== null) {
    trend = price > sma20 * 1.01 ? "up" : price < sma20 * 0.99 ? "down" : "sideways";
  }

  // technical score in -1..1
  let tech = 0;
  let techParts = 0;

  if (price !== null && sma20 !== null) { tech += price > sma20 ? 0.35 : -0.35; techParts++; }
  if (sma20 !== null && sma50 !== null) { tech += sma20 > sma50 ? 0.25 : -0.25; techParts++; }
  if (rsi14 !== null) { tech += rsi14 > 55 ? 0.2 : rsi14 < 45 ? -0.2 : 0; techParts++; }
  if (change5d !== null) { tech += Math.max(-0.2, Math.min(0.2, change5d / 10)); techParts++; }

  const technicalScore = techParts ? Math.max(-1, Math.min(1, tech)) : 0;

  // news
  const now = Date.now();
  let weighted = 0;
  let weights = 0;
  const headlines: AnalysisHeadline[] = [];
  const driverTally = new Map<string, { sum: number; count: number }>();

  for (const item of news) {
    const { score, drivers } = scoreHeadline(item.title, a);
    const ageH = Math.max(0, (now - item.time) / 3600000);
    const w = Math.pow(0.5, ageH / 24);

    if (score !== 0) {
      weighted += score * w;
      weights += w;
    }

    for (const d of drivers) {
      const t = driverTally.get(d) || { sum: 0, count: 0 };
      t.sum += score;
      t.count += 1;
      driverTally.set(d, t);
    }

    headlines.push({
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: new Date(item.time).toISOString(),
      sentiment: Math.round(score * 100) / 100,
      drivers: drivers.map(d => DRIVERS[d]).filter(Boolean)
    });
  }

  const scored = headlines.filter(h => h.sentiment !== 0);
  const newsScore = weights ? Math.max(-1, Math.min(1, weighted / weights)) : 0;
  const pos = scored.filter(h => h.sentiment > 0).length;
  const neg = scored.filter(h => h.sentiment < 0).length;

  const newsWeight = scored.length >= 5 ? 0.55 : scored.length >= 2 ? 0.4 : 0.15;
  const score = Math.max(-1, Math.min(1, newsScore * newsWeight + technicalScore * (1 - newsWeight)));

  const bias: "bullish" | "bearish" | "neutral" = score > 0.18 ? "bullish" : score < -0.18 ? "bearish" : "neutral";
  const agree = newsScore * technicalScore > 0 || (Math.abs(newsScore) < 0.1 && Math.abs(technicalScore) > 0.3);
  const confidence: "low" | "medium" | "high" =
    Math.abs(score) > 0.5 && agree && scored.length >= 4 ? "high" : Math.abs(score) > 0.28 && (agree || scored.length < 2) ? "medium" : "low";

  const topDrivers = [...driverTally.entries()]
    .filter(([key]) => DRIVERS[key])
    .map(([key, t]) => ({
      ...DRIVERS[key],
      count: t.count,
      direction: (t.sum >= 0 ? "up" : "down") as "up" | "down"
    }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 5);

  const shown = [...headlines]
    .sort((x, y) => Math.abs(y.sentiment) - Math.abs(x.sentiment) || Date.parse(y.publishedAt || "") - Date.parse(x.publishedAt || ""))
    .slice(0, 8);

  const cur = a.currency ? ` ${a.currency}` : "";
  const dp = a.decimals > 3 ? 4 : Math.min(a.decimals, 3);
  const upDrivers = topDrivers.filter(d => d.direction === "up").map(d => d.en);
  const downDrivers = topDrivers.filter(d => d.direction === "down").map(d => d.en);
  const upDriversFa = topDrivers.filter(d => d.direction === "up").map(d => d.fa);
  const downDriversFa = topDrivers.filter(d => d.direction === "down").map(d => d.fa);

  const rsiTextEn = rsi14 === null ? "n/a" : rsi14 > 70 ? "overbought" : rsi14 < 30 ? "oversold" : rsi14 > 55 ? "positive momentum" : rsi14 < 45 ? "negative momentum" : "neutral";
  const rsiTextFa = rsi14 === null ? "نامشخص" : rsi14 > 70 ? "اشباع خرید" : rsi14 < 30 ? "اشباع فروش" : rsi14 > 55 ? "شتاب مثبت" : rsi14 < 45 ? "شتاب منفی" : "خنثی";
  const trendEn = { up: "an uptrend", down: "a downtrend", sideways: "sideways / range-bound", unknown: "unclear" }[trend];
  const trendFa = { up: "صعودی", down: "نزولی", sideways: "خنثی (رنج)", unknown: "نامشخص" }[trend];
  const biasEn = { bullish: "BULLISH (price more likely to rise)", bearish: "BEARISH (price more likely to fall)", neutral: "NEUTRAL (no clear edge)" }[bias];
  const biasFa = { bullish: "صعودی (احتمال افزایش قیمت بیشتر است)", bearish: "نزولی (احتمال کاهش قیمت بیشتر است)", neutral: "خنثی (برتری مشخصی دیده نمی‌شود)" }[bias];
  const confEn = { low: "low", medium: "medium", high: "high" }[confidence];
  const confFa = { low: "کم", medium: "متوسط", high: "زیاد" }[confidence];

  const priceStr = price === null ? "n/a" : fmt(price, dp);

  const en = [
    `${a.name} is trading at ${priceStr}${cur} (${sgn(change1d)} in 24 h, ${sgn(change5d)} over 5 days, ${sgn(change1m)} over 1 month).`,
    price !== null && sma20 !== null
      ? `Technically the picture is ${trendEn}: price is ${price > sma20 ? "above" : "below"} its 20-day average (${fmt(sma20, dp)})${sma50 !== null ? ` and ${price > sma50 ? "above" : "below"} the 50-day average (${fmt(sma50, dp)})` : ""}; RSI(14) is ${fmt(rsi14, 0)} (${rsiTextEn}).`
      : "Not enough price history for a reliable technical read.",
    scored.length
      ? `News flow: of ${news.length} headlines in the last 3 days, ${pos} lean supportive and ${neg} lean negative for the price${upDrivers.length ? `; supportive drivers: ${upDrivers.join(", ")}` : ""}${downDrivers.length ? `; negative drivers: ${downDrivers.join(", ")}` : ""}.`
      : "News flow: no headline in the last 3 days gave a clear directional signal.",
    `Overall bias: ${biasEn}, ${confEn} confidence.`
  ].join(" ");

  const fa = [
    `${a.fa} با قیمت ${priceStr}${cur} معامله می‌شود (${sgn(change1d)} در ۲۴ ساعت، ${sgn(change5d)} در ۵ روز، ${sgn(change1m)} در یک ماه).`,
    price !== null && sma20 !== null
      ? `از نظر تکنیکال روند ${trendFa} است: قیمت ${price > sma20 ? "بالای" : "پایین"} میانگین ۲۰ روزه (${fmt(sma20, dp)}) قرار دارد${sma50 !== null ? ` و ${price > sma50 ? "بالای" : "پایین"} میانگین ۵۰ روزه (${fmt(sma50, dp)}) است` : ""}؛ RSI(14) برابر ${fmt(rsi14, 0)} (${rsiTextFa}) است.`
      : "داده کافی برای تحلیل تکنیکال قابل اتکا وجود ندارد.",
    scored.length
      ? `در اخبار، از ${news.length} تیتر ۳ روز اخیر، ${pos} مورد به نفع افزایش قیمت و ${neg} مورد به ضرر آن ارزیابی شد${upDriversFa.length ? `؛ عوامل حمایتی: ${upDriversFa.join("، ")}` : ""}${downDriversFa.length ? `؛ عوامل منفی: ${downDriversFa.join("، ")}` : ""}.`
      : "در اخبار ۳ روز اخیر سیگنال جهت‌دار روشنی دیده نشد.",
    `جمع‌بندی: سوگیری ${biasFa} با اطمینان ${confFa}.`
  ].join(" ");

  const value: MarketAnalysis = {
    symbol,
    name: a.name,
    bias,
    confidence,
    score: Math.round(score * 100) / 100,
    newsScore: Math.round(newsScore * 100) / 100,
    technicalScore: Math.round(technicalScore * 100) / 100,
    technicals: {
      price,
      change1d,
      change5d,
      change1m,
      rsi14: rsi14 === null ? null : Math.round(rsi14 * 10) / 10,
      sma20,
      sma50,
      high1m: month.length ? Math.max(...month) : null,
      low1m: month.length ? Math.min(...month) : null,
      trend
    },
    headlines: shown,
    topDrivers,
    summary: { en, fa },
    disclaimer: {
      en: "Automated, rule-based reading of public headlines and simple technicals. It is not investment advice and can be wrong.",
      fa: "این تحلیل خودکار و مبتنی بر قواعد ساده روی تیترهای عمومی و اندیکاتورهای پایه است؛ توصیه سرمایه‌گذاری نیست و ممکن است اشتباه باشد."
    },
    generatedAt: new Date().toISOString(),
    detail: !closes.length ? "price history unavailable" : !news.length ? "news feed unavailable" : undefined
  };

  analysisCache.set(symbol, { at: Date.now(), value });
  return value;
}

export const marketInternals = { parseYahooChart, scoreHeadline, sma, rsi, ASSETS, bySymbol };
