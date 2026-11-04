import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChartNoAxesCombined,
  CircleDollarSign,
  Coins,
  Fuel,
  Gem,
  Landmark,
  RefreshCw,
  TrendingDown,
  TrendingUp
} from "lucide-react";

import { api } from "./api";
import type {
  MarketAnalysis,
  MarketAsset,
  MarketGroup,
  MarketHistory,
  MarketPoint,
  ProviderStatus
} from "./types";

type Filter = "all" | MarketGroup;
type Lang = "fa" | "en";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "metals", label: "METALS" },
  { id: "energy", label: "OIL & FUEL" },
  { id: "forex", label: "FOREX" },
  { id: "crypto", label: "CRYPTO" },
  { id: "index", label: "INDICES" }
];

const RANGES = ["1D", "5D", "1M", "6M", "1Y", "5Y"] as const;

const GROUP_ICON: Record<MarketGroup, JSX.Element> = {
  metals: <Gem size={17} />,
  energy: <Fuel size={17} />,
  forex: <CircleDollarSign size={17} />,
  crypto: <Coins size={17} />,
  index: <Landmark size={17} />
};

function fmtNum(value: number | null | undefined, decimals: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";

  const abs = Math.abs(value);
  const d = abs >= 1000 ? Math.min(decimals, 2) : abs >= 100 ? Math.min(decimals, 3) : decimals;

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: d, minimumFractionDigits: Math.min(2, d) }).format(value);
}

const fmtPct = (v?: number | null) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

function fmtTime(t: number, range: string) {
  const d = new Date(t);
  return range === "1D" || range === "5D"
    ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { year: range === "5Y" || range === "1Y" ? "numeric" : undefined, month: "short", day: "numeric" });
}

function PriceChart({
  points,
  decimals,
  range
}: {
  points: MarketPoint[];
  decimals: number;
  range: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 340;
  const H = 170;
  const pad = { l: 4, r: 4, t: 10, b: 4 };

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map(p => p.c);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }

    const margin = (max - min) * 0.08;
    min -= margin;
    max += margin;

    const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
    const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`;

    return { x, y, line, area, min, max };
  }, [points]);

  if (!geometry) return <div className="chart-empty">No chart data available</div>;

  const first = points[0].c;
  const last = points[points.length - 1].c;
  const up = last >= first;
  const color = up ? "var(--positive)" : "var(--negative)";

  const move = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;

    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (points.length - 1)));
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="chart-wrap">
      <div className="chart-readout">
        {hp ? (
          <>
            <strong>{fmtNum(hp.c, decimals)}</strong>
            <span>{fmtTime(hp.t, range)}</span>
          </>
        ) : (
          <>
            <strong className={up ? "positive" : "negative"}>
              {fmtPct(((last - first) / first) * 100)}
            </strong>
            <span>
              {fmtTime(points[0].t, range)} → {fmtTime(points[points.length - 1].t, range)}
            </span>
          </>
        )}
      </div>

      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="price-chart"
        preserveAspectRatio="none"
        onPointerMove={e => move(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onPointerDown={e => move(e.clientX)}
      >
        <defs>
          <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="chart-grid" />
        ))}

        <path d={geometry.area} fill="url(#chartFill)" />
        <path d={geometry.line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />

        {hover !== null && (
          <>
            <line
              x1={geometry.x(hover)} x2={geometry.x(hover)} y1={0} y2={H}
              className="chart-cursor" vectorEffect="non-scaling-stroke"
            />
            <circle cx={geometry.x(hover)} cy={geometry.y(points[hover].c)} r="3.2" fill={color} />
          </>
        )}
      </svg>

      <div className="chart-axis">
        <span>{fmtNum(geometry.max, decimals)}</span>
        <span>{fmtNum(geometry.min, decimals)}</span>
      </div>
    </div>
  );
}

const BIAS_LABEL: Record<Lang, Record<string, string>> = {
  en: { bullish: "BULLISH", bearish: "BEARISH", neutral: "NEUTRAL" },
  fa: { bullish: "صعودی", bearish: "نزولی", neutral: "خنثی" }
};

const CONF_LABEL: Record<Lang, Record<string, string>> = {
  en: { low: "low confidence", medium: "medium confidence", high: "high confidence" },
  fa: { low: "اطمینان کم", medium: "اطمینان متوسط", high: "اطمینان زیاد" }
};

function Analysis({ data, lang }: { data: MarketAnalysis; lang: Lang }) {
  const t = data.technicals;
  const rtl = lang === "fa";

  return (
    <div className="analysis-card" dir={rtl ? "rtl" : "ltr"}>
      <div className="analysis-head">
        <span className={`bias-pill ${data.bias}`}>
          {data.bias === "bullish" ? <TrendingUp size={14} /> : data.bias === "bearish" ? <TrendingDown size={14} /> : <ChartNoAxesCombined size={14} />}
          {BIAS_LABEL[lang][data.bias]}
        </span>
        <span className="analysis-conf">{CONF_LABEL[lang][data.confidence]}</span>
      </div>

      <div className="bias-meter" dir="ltr" title={`score ${data.score}`}>
        <i style={{ left: `${((data.score + 1) / 2) * 100}%` }} />
      </div>

      <p className="analysis-text">{data.summary[lang]}</p>

      {data.topDrivers.length > 0 && (
        <div className="driver-list">
          {data.topDrivers.map(d => (
            <span key={d.en} className={`driver ${d.direction}`}>
              {d.direction === "up" ? "▲" : "▼"} {lang === "fa" ? d.fa : d.en}
            </span>
          ))}
        </div>
      )}

      <div className="tech-grid" dir="ltr">
        <div><span>RSI(14)</span><strong>{t.rsi14 ?? "—"}</strong></div>
        <div><span>SMA 20</span><strong>{fmtNum(t.sma20, 4)}</strong></div>
        <div><span>SMA 50</span><strong>{fmtNum(t.sma50, 4)}</strong></div>
        <div><span>5D</span><strong>{fmtPct(t.change5d)}</strong></div>
        <div><span>1M</span><strong>{fmtPct(t.change1m)}</strong></div>
        <div><span>1M range</span><strong>{fmtNum(t.low1m, 2)} – {fmtNum(t.high1m, 2)}</strong></div>
      </div>

      <div className="headline-title">{lang === "fa" ? "تیترهای مؤثر" : "Headlines that moved the score"}</div>

      <div className="headline-list" dir="ltr">
        {data.headlines.length === 0 && <div className="empty-state">No headlines</div>}

        {data.headlines.map((h, i) => (
          <a key={i} href={h.url} target="_blank" rel="noreferrer" className="headline">
            <span className={`headline-dot ${h.sentiment > 0 ? "up" : h.sentiment < 0 ? "down" : ""}`}>
              {h.sentiment > 0 ? "▲" : h.sentiment < 0 ? "▼" : "•"}
            </span>
            <span>
              {h.title}
              <small>{h.source}{h.publishedAt ? ` · ${new Date(h.publishedAt).toLocaleString()}` : ""}</small>
            </span>
          </a>
        ))}
      </div>

      <p className="analysis-disclaimer">{data.disclaimer[lang]}</p>
      {data.detail && <p className="analysis-disclaimer">⚠ {data.detail}</p>}
    </div>
  );
}

export default function MarketsPanel({
  items,
  services,
  loading,
  error,
  onRefresh
}: {
  items: MarketAsset[];
  services: Record<string, ProviderStatus>;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>("1M");
  const [history, setHistory] = useState<MarketHistory | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("sb-analysis-lang") as Lang) || "fa");

  const asset = items.find(i => i.symbol === selected) || null;

  useEffect(() => {
    localStorage.setItem("sb-analysis-lang", lang);
  }, [lang]);

  // chart data
  useEffect(() => {
    if (!selected) return;

    let alive = true;

    const run = async (silent: boolean) => {
      if (!silent) {
        setHistoryBusy(true);
        setHistoryError("");
      }

      try {
        const h = await api.marketHistory(selected, range);
        if (alive) {
          setHistory(h);
          if (!h.points.length) setHistoryError(h.detail || "No chart data");
        }
      } catch (err) {
        if (alive) setHistoryError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setHistoryBusy(false);
      }
    };

    void run(false);
    const timer = window.setInterval(() => void run(true), 60000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [selected, range]);

  // analysis
  useEffect(() => {
    if (!selected) return;

    let alive = true;
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisBusy(true);

    api
      .marketAnalysis(selected)
      .then(a => alive && setAnalysis(a))
      .catch(err => alive && setAnalysisError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setAnalysisBusy(false));

    return () => {
      alive = false;
    };
  }, [selected]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    items.forEach(i => (c[i.group] = (c[i.group] || 0) + 1));
    return c;
  }, [items]);

  const shown = filter === "all" ? items : items.filter(i => i.group === filter);

  /* ------------------------------------------------------------- detail view */
  if (selected && asset) {
    const pts = history?.points || [];
    const unit = asset.currency ? ` ${asset.currency}` : "";

    return (
      <div className="panel-content markets-panel">
        <button className="back-link" onClick={() => setSelected(null)}>
          <ArrowLeft size={15} /> ALL MARKETS
        </button>

        <div className="detail-head">
          <div className={`market-icon ${asset.group}`}>{GROUP_ICON[asset.group]}</div>

          <div className="detail-title">
            <strong>{asset.name}</strong>
            <span>{asset.nameFa}</span>
          </div>

          <button className="market-refresh" onClick={onRefresh} title="Refresh">
            <RefreshCw size={15} className={loading ? "spin" : ""} />
          </button>
        </div>

        <div className="detail-price">
          <strong>{fmtNum(asset.price, asset.decimals)}<small>{unit}</small></strong>
          <span className={asset.change24h == null ? "" : asset.change24h >= 0 ? "positive" : "negative"}>
            {asset.change24h != null && (asset.change24h >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />)}
            {fmtPct(asset.change24h)}
            {asset.changeAbs != null && ` (${asset.changeAbs > 0 ? "+" : ""}${fmtNum(asset.changeAbs, asset.decimals)})`}
          </span>
        </div>

        <div className="detail-sub">
          Day {fmtNum(asset.low, asset.decimals)} – {fmtNum(asset.high, asset.decimals)} · {asset.source}
        </div>

        {asset.note && <div className="inline-warning">{asset.note}</div>}

        <div className="range-tabs">
          {RANGES.map(r => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>

        {historyBusy && !pts.length ? (
          <div className="chart-empty"><RefreshCw size={16} className="spin" /> Loading chart…</div>
        ) : pts.length ? (
          <PriceChart points={pts} decimals={asset.decimals} range={range} />
        ) : (
          <div className="chart-empty">{historyError || "No chart data available"}</div>
        )}

        {history && pts.length > 0 && <div className="detail-sub">Chart source: {history.source}</div>}

        <div className="analysis-title">
          <span>
            <ChartNoAxesCombined size={15} /> NEWS &amp; TREND ANALYSIS
          </span>

          <div className="lang-toggle">
            <button className={lang === "fa" ? "active" : ""} onClick={() => setLang("fa")}>فارسی</button>
            <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>

        {analysisBusy && <div className="chart-empty"><RefreshCw size={16} className="spin" /> Reading news and price action…</div>}
        {analysisError && <div className="inline-warning">{analysisError}</div>}
        {analysis && <Analysis data={analysis} lang={lang} />}
      </div>
    );
  }

  /* --------------------------------------------------------------- list view */
  return (
    <div className="panel-content markets-panel">
      <div className="panel-intro">
        <div>
          <div className="eyebrow">GLOBAL FINANCIAL DATA</div>
          <h2>Market monitor</h2>
        </div>

        <button className="market-refresh" onClick={onRefresh} title="Refresh market data">
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className="market-summary">
        <div className="market-summary-icon"><ChartNoAxesCombined size={20} /></div>
        <div>
          <strong>{items.filter(i => i.price !== null).length}/{items.length}</strong>
          <span>LIVE INSTRUMENTS · TAP ONE FOR CHART &amp; ANALYSIS</span>
        </div>
        <div className="market-summary-status">
          <span className="live-dot" />
          {loading ? "UPDATING" : "~45 s"}
        </div>
      </div>

      <div className="market-filters">
        {FILTERS.map(f => (
          <button key={f.id} className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>
            {f.label}
            <span>{counts[f.id] || 0}</span>
          </button>
        ))}
      </div>

      {error && <div className="inline-warning">{error}</div>}

      <div className="market-list">
        {shown.map(item => (
          <button
            className="market-item market-row"
            key={item.symbol}
            onClick={() => setSelected(item.symbol)}
          >
            <div className="market-item-main">
              <div className={`market-icon ${item.group}`}>{GROUP_ICON[item.group]}</div>

              <div className="market-name">
                <strong>{item.name}</strong>
                <span>{item.nameFa}</span>
              </div>

              <div className="market-row-values">
                <strong>{fmtNum(item.price, item.decimals)}</strong>
                <span className={item.change24h == null ? "" : item.change24h >= 0 ? "positive" : "negative"}>
                  {item.change24h != null && (item.change24h >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
                  {fmtPct(item.change24h)}
                </span>
              </div>
            </div>

            <div className="market-item-meta">
              <span>{item.group.toUpperCase()}</span>
              <span>{item.source}</span>
            </div>
          </button>
        ))}

        {!shown.length && (
          <div className="empty-state">{loading ? "Loading market data…" : "No market data available."}</div>
        )}
      </div>

      <div className="market-provider-list">
        <div className="eyebrow">PROVIDER STATUS</div>

        {Object.entries(services).map(([name, status]) => (
          <div className="market-provider" key={name} title={status.detail}>
            <span>{name.replace("Markets: ", "")}</span>
            <span className={`source-state ${status.status}`}>{status.status.replaceAll("_", " ")}</span>
          </div>
        ))}
      </div>

      <div className="source-note market-disclaimer">
        <strong>About the data</strong>
        <p>
          Quotes refresh about every 45 seconds from free public sources (Yahoo Finance, Binance, gold-api.com,
          ECB reference rates). Free tick-by-tick feeds for gold, forex and oil do not exist, so values can be
          up to a minute behind. Analysis is automatic, based on public headlines and simple technicals; it is
          not investment advice.
        </p>
      </div>
    </div>
  );
}
