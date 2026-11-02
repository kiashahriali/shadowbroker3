import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap, Marker, Popup } from "maplibre-gl";
import { Activity, AlertTriangle, Anchor, Bell, ChevronDown, Crosshair, Globe2, Layers, Menu, Newspaper, Plane, Radio, RefreshCw, Search, Settings2, Shield, X, Zap } from "lucide-react";
import { api } from "./api";
import type { Earthquake, FeedItem, Flight, LayerState } from "./types";

const initialLayers: LayerState = { flights: true, earthquakes: true, conflicts: false, protests: false };
const timeLabel = (date?: string) => date ? new Date(date).toLocaleString() : "Time unavailable";

export default function App() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<Marker[]>([]);
  const [layers, setLayers] = useState<LayerState>(() => {
    try { return { ...initialLayers, ...JSON.parse(localStorage.getItem("sb-layers") || "{}") }; }
    catch { return initialLayers; }
  });
  const [news, setNews] = useState<FeedItem[]>([]);
  const [quakes, setQuakes] = useState<Earthquake[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [serviceStatus, setServiceStatus] = useState<Record<string, {status:string;detail:string}>>({});
  const [activeTab, setActiveTab] = useState<"news"|"alerts"|"sources">("news");
  const [selected, setSelected] = useState<FeedItem | Earthquake | Flight | null>(null);
  const [query, setQuery] = useState("");
  const [mobilePanel, setMobilePanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setBusy(true); setError("");
    const results = await Promise.allSettled([api.news(), api.earthquakes(), api.flights(), api.status()]);
    if (results[0].status === "fulfilled") setNews(results[0].value.items || []);
    if (results[1].status === "fulfilled") setQuakes(results[1].value.items || []);
    if (results[2].status === "fulfilled") setFlights(results[2].value.items || []);
    if (results[3].status === "fulfilled") setServiceStatus(results[3].value.services || {});
    const failed = results.filter(r => r.status === "rejected");
    if (failed.length) setError("Some data sources are temporarily unavailable. Check Sources for details.");
    setLastUpdated(new Date()); setBusy(false);
  };

  useEffect(() => { load(); const timer = window.setInterval(load, 120000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { localStorage.setItem("sb-layers", JSON.stringify(layers)); }, [layers]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: import.meta.env.VITE_MAP_STYLE || "https://tiles.openfreemap.org/styles/dark",
      center: [18, 22], zoom: 1.65, minZoom: 1.2, maxZoom: 12,
      attributionControl: true
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    mapRef.current = map;
    return () => { markerRefs.current.forEach(m => m.remove()); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRefs.current.forEach(m => m.remove()); markerRefs.current = [];
    const add = (lng: number, lat: number, color: string, html: string, item: any) => {
      const el = document.createElement("button");
      el.className = "map-marker"; el.style.setProperty("--marker-color", color); el.title = html;
      el.innerHTML = `<span></span>`;
      el.addEventListener("click", () => setSelected(item));
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      markerRefs.current.push(marker);
    };
    if (layers.earthquakes) quakes.forEach(q => add(q.coordinates[0], q.coordinates[1], "#ffb454", q.title, q));
    if (layers.flights) flights.slice(0, 250).forEach(f => add(f.longitude, f.latitude, "#53c7f4", f.callsign || f.icao24, f));
  }, [layers, quakes, flights]);

  const filteredNews = useMemo(() => news.filter(n => `${n.title} ${n.source} ${n.summary || ""}`.toLowerCase().includes(query.toLowerCase())), [news, query]);
  const alerts = useMemo(() => [
    ...quakes.filter(q => q.magnitude >= 4.5).map(q => ({ id:q.id, title:`Magnitude ${q.magnitude.toFixed(1)} earthquake`, detail:q.place, time:q.time })),
    ...news.filter(n => n.category === "conflict" || n.category === "protest").map(n => ({ id:n.id, title:n.title, detail:n.source, time:n.publishedAt ? new Date(n.publishedAt).getTime() : 0 }))
  ].sort((a,b)=>b.time-a.time).slice(0,30), [quakes, news]);

  const toggle = (key: keyof LayerState) => setLayers(v => ({...v, [key]: !v[key]}));
  const openNews = (item: FeedItem) => setSelected(item);
  const isFeed = (v: any): v is FeedItem => !!v && "source" in v && "url" in v;

  return <div className="app-shell">
    <header className="topbar">
      <button className="icon-button mobile-only" onClick={()=>setMobilePanel(!mobilePanel)} aria-label="Menu"><Menu size={19}/></button>
      <div className="brand"><div className="brand-mark"><Shield size={19}/></div><div><div className="brand-name">SHADOW<span>BROKER</span></div><div className="brand-sub">OPEN SOURCE INTELLIGENCE</div></div></div>
      <div className="top-status"><span className="live-dot"/> PUBLIC DATA MONITOR <span className="status-divider"/> {lastUpdated ? `UPDATED ${lastUpdated.toLocaleTimeString()}` : "CONNECTING"}</div>
      <div className="top-actions"><button className="icon-button" onClick={load} title="Refresh"><RefreshCw size={17} className={busy?"spin":""}/></button><button className="icon-button" onClick={()=>setActiveTab("sources")} title="Sources"><Settings2 size={17}/></button></div>
    </header>

    <main className="workspace">
      <aside className={`left-rail ${mobilePanel?"show":""}`}>
        <div className="rail-heading"><span>INTELLIGENCE LAYERS</span><Layers size={15}/></div>
        <div className="layer-list">
          <Layer icon={<Plane size={16}/>} name="Aircraft" detail={`${flights.length} tracked`} checked={layers.flights} onClick={()=>toggle("flights")} color="blue"/>
          <Layer icon={<Activity size={16}/>} name="Earthquakes" detail={`${quakes.length} events`} checked={layers.earthquakes} onClick={()=>toggle("earthquakes")} color="amber"/>
          <Layer icon={<AlertTriangle size={16}/>} name="Conflict reports" detail="GDELT news signals" checked={layers.conflicts} onClick={()=>toggle("conflicts")} color="red" disabled/>
          <Layer icon={<Radio size={16}/>} name="Protests" detail="GDELT news signals" checked={layers.protests} onClick={()=>toggle("protests")} color="purple" disabled/>
          <Layer icon={<Anchor size={16}/>} name="Maritime / AIS" detail="Provider required" checked={false} onClick={()=>setActiveTab("sources")} color="cyan" disabled/>
        </div>
        <div className="rail-heading section-gap"><span>MAP CONTROLS</span><Crosshair size={15}/></div>
        <div className="map-controls"><button onClick={()=>mapRef.current?.flyTo({center:[18,22],zoom:1.65})}><Globe2 size={15}/> Reset global view</button><button onClick={()=>mapRef.current?.easeTo({zoom:4})}><Search size={15}/> Zoom in</button></div>
        <div className="rail-foot"><span className="tiny-led"/> ALL TIMES UTC <span className="foot-right">v1.0.0</span></div>
      </aside>

      <section className="map-section">
        <div className="map-title"><div><span className="eyebrow">GLOBAL SITUATIONAL AWARENESS</span><h1>World monitor</h1></div><div className="map-coords">GLOBAL VIEW <span>•</span> WGS84</div></div>
        <div className="map-wrap"><div ref={mapNode} className="map-canvas"/>
          <div className="map-overlay map-overlay-top"><span className="map-chip"><span className="live-dot"/> MAP ONLINE</span><span className="map-chip">DATA: PUBLIC SOURCES</span></div>
          <div className="map-overlay map-overlay-bottom"><span>SELECT A MARKER TO INSPECT</span><span>{flights.length} AIRCRAFT · {quakes.length} SEISMIC EVENTS</span></div>
          {selected && <div className="inspector"><button className="close-inspector" onClick={()=>setSelected(null)}><X size={16}/></button><div className="eyebrow">ENTITY INSPECTOR</div>
            {isFeed(selected) ? <><h3>{selected.title}</h3><p>{selected.summary}</p><div className="inspector-meta">{selected.source} · {timeLabel(selected.publishedAt)}</div><a href={selected.url} target="_blank" rel="noreferrer">OPEN ORIGINAL SOURCE ↗</a></> :
            "magnitude" in selected ? <><h3>{selected.title}</h3><p>{selected.place}</p><div className="inspector-meta">Magnitude {selected.magnitude} · {timeLabel(new Date(selected.time).toISOString())}</div><a href={selected.url} target="_blank" rel="noreferrer">USGS EVENT ↗</a></> :
            <><h3>{selected.callsign || selected.icao24}</h3><p>{selected.originCountry}</p><div className="inspector-meta">Altitude {selected.altitude ?? "—"} m · Speed {selected.velocity ?? "—"} m/s</div></>}
          </div>}
        </div>
        <div className="map-footer"><span><span className="legend-dot blue"/> Aircraft</span><span><span className="legend-dot amber"/> Earthquakes</span><span><span className="legend-dot red"/> Conflict (not enabled)</span><span className="map-footer-right">Map tiles: OpenFreeMap</span></div>
      </section>

      <aside className="right-panel">
        <div className="panel-tabs">
          <button className={activeTab==="news"?"active":""} onClick={()=>setActiveTab("news")}><Newspaper size={15}/> NEWS</button>
          <button className={activeTab==="alerts"?"active":""} onClick={()=>setActiveTab("alerts")}><Bell size={15}/> ALERTS <span className="tab-count">{alerts.length}</span></button>
          <button className={activeTab==="sources"?"active":""} onClick={()=>setActiveTab("sources")}><Radio size={15}/> SOURCES</button>
        </div>
        {activeTab==="news" && <div className="panel-content"><div className="panel-intro"><div><div className="eyebrow">GLOBAL NEWSWIRE</div><h2>Latest reports</h2></div><span className="count-pill">{filteredNews.length} ITEMS</span></div>
          <div className="search-box"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search headlines or sources"/></div>
          {error && <div className="inline-warning">{error}</div>}
          <div className="feed-list">{filteredNews.map(item=><button className="feed-item" key={item.id} onClick={()=>openNews(item)}><div className="feed-meta"><span className={`category ${item.category}`}>{item.category.toUpperCase()}</span><span>{item.source}</span></div><h3>{item.title}</h3><p>{item.summary}</p><div className="feed-time">{timeLabel(item.publishedAt)} <span>OPEN REPORT ↗</span></div></button>)}
            {!filteredNews.length && <div className="empty-state">No reports available. Refresh or inspect source status.</div>}</div>
        </div>}
        {activeTab==="alerts" && <div className="panel-content"><div className="panel-intro"><div><div className="eyebrow">EVENT DETECTION</div><h2>Alert stream</h2></div><span className="count-pill">{alerts.length} ACTIVE</span></div>
          <div className="feed-list">{alerts.map(a=><div className="alert-item" key={a.id}><div className="alert-icon"><Zap size={15}/></div><div><h3>{a.title}</h3><p>{a.detail}</p><time>{a.time ? new Date(a.time).toLocaleString() : "Time unavailable"}</time></div></div>)}{!alerts.length&&<div className="empty-state">No alerts from currently available sources.</div>}</div>
        </div>}
        {activeTab==="sources" && <div className="panel-content"><div className="panel-intro"><div><div className="eyebrow">CONNECTIVITY</div><h2>Data sources</h2></div></div><div className="source-list">{Object.entries(serviceStatus).map(([name,s])=><div className="source-row" key={name}><div><strong>{name}</strong><p>{s.detail}</p></div><span className={`source-state ${s.status}`}>{s.status.replaceAll("_"," ")}</span></div>)}</div><div className="source-note"><strong>Data integrity</strong><p>Unavailable providers are never replaced with invented live positions. Some public endpoints enforce rate limits and may temporarily fail.</p></div></div>}
        <div className="panel-bottom"><span className="tiny-led"/> PUBLIC SOURCES ONLY <span>·</span> NO PAID FEEDS</div>
      </aside>
    </main>
  </div>;
}

function Layer({icon,name,detail,checked,onClick,color,disabled=false}:{icon:React.ReactNode;name:string;detail:string;checked:boolean;onClick:()=>void;color:string;disabled?:boolean}) {
  return <button className={`layer-row ${disabled?"disabled":""}`} onClick={onClick}><span className={`layer-icon ${color}`}>{icon}</span><span className="layer-copy"><strong>{name}</strong><small>{detail}</small></span><span className={`toggle ${checked?"on":""}`}><i/></span></button>;
}
