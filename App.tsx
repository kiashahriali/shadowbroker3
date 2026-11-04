import { useEffect, useMemo, useRef, useState } from "react";

import maplibregl, { Map as MapLibreMap } from "maplibre-gl";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  Activity,
  AlertTriangle,
  Anchor,
  Bell,
  ChartNoAxesCombined,
  Crosshair,
  Globe,
  Globe2,
  Layers,
  Menu,
  Newspaper,
  Palette,
  Plane,
  Plus,
  Radio,
  RefreshCw,
  Satellite,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
  X,
  Zap
} from "lucide-react";

import { api } from "./api";
import MarketsPanel from "./MarketsPanel";
import SatellitePanel, { ago } from "./SatellitePanel";
import {
  FLIGHT_COLORS,
  FLIGHT_LEGEND,
  VESSEL_COLORS,
  VESSEL_LEGEND,
  ensureIcon,
  iconDataUrl,
  type IconShape
} from "./mapIcons";

import type {
  ConflictCluster,
  Earthquake,
  FeedItem,
  Flight,
  LayerState,
  MarketAsset,
  NewsSource,
  ProviderStatus,
  SatelliteLayerInfo,
  SatelliteScene,
  Vessel
} from "./types";

import "./style.css";

const initialLayers: LayerState = {
  flights: true,
  earthquakes: true,
  conflicts: true,
  protests: true,
  vessels: true,
  satellite: false,
  scenes: true
};

const defaultTheme = {
  accent: "#53c7f4",
  background: "#07111a",
  panel: "#08131b",
  news: "#ef4444",
  aircraft: "#53c7f4",
  vessels: "#40d9c2",
  earthquakes: "#ffb454",
  conflicts: "#ff5252",
  protests: "#bd83ff",
  countryLabels: "#dce8ef"
};

const timeLabel = (date?: string) =>
  date ? new Date(date).toLocaleString() : "Time unavailable";

type Tab = "news" | "alerts" | "sources" | "settings" | "markets" | "satellite";

type AlertItem = {
  id: string;
  title: string;
  detail: string;
  time: number;
};

type Theme = typeof defaultTheme;

type Entity =
  | FeedItem
  | Earthquake
  | Flight
  | Vessel
  | ConflictCluster
  | SatelliteScene
  | SatelliteLayerInfo;

/* ---------------------------------------------------------- map layer setup */

// Local GeoJSON types (the global `GeoJSON` namespace is not available in this tsconfig)
type GeoFeature = {
  type: "Feature";
  properties: Record<string, string | number>;
  geometry: { type: "Point"; coordinates: [number, number] };
};

type GeoCollection = { type: "FeatureCollection"; features: GeoFeature[] };

const emptyCollection = (): GeoCollection => ({ type: "FeatureCollection", features: [] });

// [size at zoom 1, zoom 6, zoom 12] - small pictograms
const SYMBOL_LAYERS = [
  { id: "conflicts", size: [0.5, 0.62, 0.95] },
  { id: "protests", size: [0.5, 0.62, 0.95] },
  { id: "vessels", size: [0.4, 0.52, 0.85] },
  { id: "flights", size: [0.42, 0.55, 0.9] },
  { id: "scenes", size: [0.6, 0.72, 1.0] }
] as const;

type EntityLayerId = "quakes" | (typeof SYMBOL_LAYERS)[number]["id"];

const ENTITY_IDS: EntityLayerId[] = ["quakes", "conflicts", "protests", "vessels", "flights", "scenes"];

const SAT_LAYER = "sb-satellite-layer";
const OVERLAY_LAYER = "sb-scene-overlay-layer";

/** [lon, lat] or null. Null / NaN / out of range / (0,0) can never pile up on one point. */
const validCoord = (lon: unknown, lat: unknown): [number, number] | null => {
  if (lon == null || lat == null || lon === "" || lat === "") return null;

  const x = Number(lon);
  const y = Number(lat);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > 180 || Math.abs(y) > 90) return null;
  if (x === 0 && y === 0) return null;

  return [x, y];
};

function ensureEntityLayers(map: MapLibreMap) {
  ENTITY_IDS.forEach(id => {
    if (!map.getSource(`sb-${id}`)) {
      map.addSource(`sb-${id}`, { type: "geojson", data: emptyCollection() as never });
    }
  });

  if (!map.getLayer("sb-quakes-layer")) {
    map.addLayer({
      id: "sb-quakes-layer",
      type: "circle",
      source: "sb-quakes",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 8, 9],
        "circle-color": "#ffb454",
        "circle-opacity": 0.75,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#07111a"
      }
    });
  }

  SYMBOL_LAYERS.forEach(({ id, size }) => {
    if (map.getLayer(`sb-${id}-layer`)) return;

    map.addLayer({
      id: `sb-${id}-layer`,
      type: "symbol",
      source: `sb-${id}`,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, size[0], 6, size[1], 12, size[2]],
        "icon-rotate": ["get", "rot"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "z"]
      }
    });
  });
}

const m2ft = (m?: number | null) => (m == null ? null : Math.round(m * 3.28084));
const ms2kt = (v?: number | null) => (v == null ? null : Math.round(v * 1.94384));

const SAT_SEEN_KEY = "sb-sat-seen";

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SAT_SEEN_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function App() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadingRef = useRef(false);
  const entityIndex = useRef<Record<string, Entity>>({});
  const labelBefore = useRef<string | undefined>(undefined);
  const layersRef = useRef<LayerState>(initialLayers);
  const globeRef = useRef(false);

  const [layers, setLayers] = useState<LayerState>(() => {
    try {
      const saved = localStorage.getItem("sb-layers");
      return { ...initialLayers, ...(saved ? JSON.parse(saved) : {}) };
    } catch {
      return initialLayers;
    }
  });

  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("sb-theme");
      return { ...defaultTheme, ...(saved ? JSON.parse(saved) : {}) };
    } catch {
      return defaultTheme;
    }
  });

  const [globe, setGlobe] = useState<boolean>(() => localStorage.getItem("sb-globe") === "1");

  const [news, setNews] = useState<FeedItem[]>([]);
  const [events, setEvents] = useState<FeedItem[]>([]);
  const [quakes, setQuakes] = useState<Earthquake[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [conflicts, setConflicts] = useState<ConflictCluster[]>([]);
  const [protests, setProtests] = useState<ConflictCluster[]>([]);

  const [flightInfo, setFlightInfo] = useState("");
  const [vesselInfo, setVesselInfo] = useState("");
  const [conflictInfo, setConflictInfo] = useState("");
  const [dropped, setDropped] = useState<Record<string, number>>({});

  const [serviceStatus, setServiceStatus] = useState<Record<string, ProviderStatus>>({});
  const [sourceStatus, setSourceStatus] = useState<{ source: string; status: string; error?: string }[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);

  const [marketItems, setMarketItems] = useState<MarketAsset[]>([]);
  const [marketServices, setMarketServices] = useState<Record<string, ProviderStatus>>({});
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState("");
  const marketLoadingRef = useRef(false);

  // satellite
  const [satLayers, setSatLayers] = useState<SatelliteLayerInfo[]>([]);
  const [satDetail, setSatDetail] = useState("");
  const [satLoading, setSatLoading] = useState(false);
  const [satSelected, setSatSelected] = useState<string>(() => localStorage.getItem("sb-sat-layer") || "");
  const [satOpacity, setSatOpacity] = useState<number>(() => Number(localStorage.getItem("sb-sat-opacity")) || 0.9);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const announced = useRef<Record<string, string>>({});

  const [scenes, setScenes] = useState<SatelliteScene[]>([]);
  const [scenesDetail, setScenesDetail] = useState("");
  const [scenesBusy, setScenesBusy] = useState(false);
  const [zoomOk, setZoomOk] = useState(false);
  const [sceneOverlay, setSceneOverlay] = useState<SatelliteScene | null>(null);
  const scenesSeq = useRef(0);
  const knownScenes = useRef<Set<string> | null>(null);

  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);

  const [activeTab, setActiveTab] = useState<Tab>("news");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [query, setQuery] = useState("");
  const [mobilePanel, setMobilePanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState("");

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceCategory, setNewSourceCategory] = useState("world");
  const [sourceMessage, setSourceMessage] = useState("");
  const [tickerPaused, setTickerPaused] = useState(false);

  layersRef.current = layers;
  globeRef.current = globe;

  const toast = (text: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, text }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 9000);
  };

  /* -------------------------------------------------------------- data loading */

  const load = async () => {
    if (loadingRef.current) return;

    loadingRef.current = true;
    setBusy(true);
    setError("");

    try {
      const tasks = {
        news: api.news(),
        events: api.events(),
        earthquakes: api.earthquakes(),
        flights: api.flights(),
        vessels: api.vessels(),
        conflicts: api.conflicts(),
        status: api.status(),
        sources: api.sources()
      };

      const keys = Object.keys(tasks) as (keyof typeof tasks)[];
      const settled = await Promise.allSettled(keys.map(k => tasks[k]));

      const pick = <K extends keyof typeof tasks>(key: K) => {
        const r = settled[keys.indexOf(key)];
        return r.status === "fulfilled" ? (r.value as Awaited<(typeof tasks)[K]>) : null;
      };

      const n = pick("news");
      if (n) { setNews(n.items || []); setSourceStatus(n.sourceStatus || []); }

      const ev = pick("events");
      if (ev) setEvents(ev.items || []);

      const q = pick("earthquakes");
      if (q) setQuakes(q.items || []);

      const f = pick("flights");
      if (f) { setFlights(f.items || []); setFlightInfo(f.detail || f.status || ""); }

      const v = pick("vessels");
      if (v) { setVessels(v.items || []); setVesselInfo(v.detail || v.status || ""); }

      const c = pick("conflicts");
      if (c) {
        setConflicts(c.conflicts || []);
        setProtests(c.protests || []);
        setConflictInfo(c.detail || c.status || "");
      }

      const st = pick("status");
      if (st) setServiceStatus(st.services || {});

      const so = pick("sources");
      if (so) setSources(so.items || []);

      const failures = settled
        .map((r, i) =>
          r.status === "rejected"
            ? `${keys[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
            : null
        )
        .filter(Boolean) as string[];

      if (failures.length) {
        console.warn("[load] failed:", failures);
        setError(failures.join(" | "));
      }

      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      loadingRef.current = false;
      setBusy(false);
    }
  };

  const loadMarkets = async () => {
    if (marketLoadingRef.current) return;

    marketLoadingRef.current = true;
    setMarketLoading(true);
    setMarketError("");

    try {
      const result = await api.markets();
      setMarketItems(result.items || []);
      setMarketServices(result.services || {});
    } catch (err: unknown) {
      setMarketError(err instanceof Error ? err.message : String(err));
    } finally {
      marketLoadingRef.current = false;
      setMarketLoading(false);
    }
  };

  const loadSatLayers = async () => {
    setSatLoading(true);

    try {
      const result = await api.satelliteLayers();
      setSatLayers(result.layers);
      setSatDetail(result.detail);

      const seen = readSeen();
      const newly = new Set<string>();

      for (const layer of result.layers) {
        if (!layer.latest) continue;

        if (!seen[layer.id]) {
          seen[layer.id] = layer.latest;          // first visit: nothing is "new" yet
          announced.current[layer.id] = layer.latest;
          continue;
        }

        if (layer.latest > seen[layer.id]) {
          newly.add(layer.id);

          if (announced.current[layer.id] !== layer.latest) {
            announced.current[layer.id] = layer.latest;
            toast(
              `New imagery: ${layer.name} · ${layer.kind === "polar" ? layer.latest : layer.latest.slice(11, 16) + "Z"}`
            );
          }
        }
      }

      localStorage.setItem(SAT_SEEN_KEY, JSON.stringify(seen));
      setFresh(newly);

      setSatSelected(current => {
        if (current && result.layers.some(l => l.id === current)) return current;
        return result.layers[0]?.id || "";
      });
    } catch (err) {
      setSatDetail(err instanceof Error ? err.message : String(err));
    } finally {
      setSatLoading(false);
    }
  };

  const acknowledgeLayer = (id: string) => {
    const layer = satLayers.find(l => l.id === id);
    if (!layer?.latest) return;

    const seen = readSeen();
    seen[id] = layer.latest;
    localStorage.setItem(SAT_SEEN_KEY, JSON.stringify(seen));

    setFresh(old => {
      const next = new Set(old);
      next.delete(id);
      return next;
    });
  };

  const loadScenes = async () => {
    const map = mapRef.current;
    if (!map || !layersRef.current.scenes) return;

    const ok = map.getZoom() >= 3.2;
    setZoomOk(ok);

    if (!ok) {
      setScenes([]);
      return;
    }

    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    if (bbox[0] >= bbox[2]) return;                 // view crosses the antimeridian

    const seq = ++scenesSeq.current;
    setScenesBusy(true);

    try {
      const result = await api.scenes(bbox);
      if (seq !== scenesSeq.current) return;

      setScenes(result.scenes);
      setScenesDetail(result.detail);

      const ids = new Set(result.scenes.map(s => s.id));

      if (knownScenes.current) {
        const added = result.scenes.filter(
          s => !knownScenes.current!.has(s.id) && Date.now() - Date.parse(s.datetime) < 6 * 3600000
        );
        if (added.length) toast(`${added.length} new Sentinel-2 scene${added.length > 1 ? "s" : ""} in view`);
      }

      knownScenes.current = new Set([...(knownScenes.current || []), ...ids]);
    } catch (err) {
      if (seq === scenesSeq.current) setScenesDetail(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === scenesSeq.current) setScenesBusy(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadMarkets();
    const timer = window.setInterval(() => void loadMarkets(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadSatLayers();
    const timer = window.setInterval(() => void loadSatLayers(), 5 * 60000);
    return () => window.clearInterval(timer);
  }, []);

  /* ----------------------------------------------------------- local settings */

  useEffect(() => localStorage.setItem("sb-layers", JSON.stringify(layers)), [layers]);
  useEffect(() => localStorage.setItem("sb-globe", globe ? "1" : "0"), [globe]);
  useEffect(() => localStorage.setItem("sb-sat-layer", satSelected), [satSelected]);
  useEffect(() => localStorage.setItem("sb-sat-opacity", String(satOpacity)), [satOpacity]);

  useEffect(() => {
    localStorage.setItem("sb-theme", JSON.stringify(theme));

    Object.entries(theme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--sb-${key}`, String(value));
    });
  }, [theme]);

  /* ------------------------------------------------------------ map creation */

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapNode.current,
      style: import.meta.env.VITE_MAP_STYLE || "https://tiles.openfreemap.org/styles/dark",
      center: [18, 22],
      zoom: 1.65,
      minZoom: 1.2,
      maxZoom: 16,
      attributionControl: {}
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      // rasters go UNDER the base map's labels, markers go on top of everything
      labelBefore.current = map.getStyle().layers.find(l => l.type === "symbol")?.id;

      ensureEntityLayers(map);

      [...ENTITY_IDS.map(id => `sb-${id}-layer`)].forEach(layerId => {
        map.on("click", layerId, event => {
          const key = event.features?.[0]?.properties?.key;
          const item = key ? entityIndex.current[key] : undefined;
          if (item) setSelected(item);
        });

        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      });

      map.setProjection({ type: globeRef.current ? "globe" : "mercator" });

      setMapError("");
      setMapReady(true);
    });

    map.on("error", event => {
      console.error("MapLibre error:", event.error);

      if (!map.isStyleLoaded()) {
        setMapReady(false);
        setMapError(event.error?.message || "Map style could not be loaded.");
      }
    });

    let timer = 0;
    map.on("moveend", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadScenes(), 900);
    });

    mapRef.current = map;

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // flat map <-> globe
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    map.setProjection({ type: globe ? "globe" : "mercator" });
  }, [globe, mapReady]);

  /* ------------------------------------------------------ satellite raster */

  const selectedSat = satLayers.find(l => l.id === satSelected) || null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (map.getLayer(SAT_LAYER)) map.removeLayer(SAT_LAYER);
    if (map.getSource("sb-satellite")) map.removeSource("sb-satellite");

    if (!layers.satellite || !selectedSat) return;

    map.addSource("sb-satellite", {
      type: "raster",
      tiles: [selectedSat.tiles],
      tileSize: selectedSat.tileSize,
      maxzoom: selectedSat.maxzoom,
      attribution: "Imagery: NASA GIBS / ESDIS"
    });

    const before = map.getLayer(OVERLAY_LAYER)
      ? OVERLAY_LAYER
      : labelBefore.current || "sb-quakes-layer";

    map.addLayer(
      {
        id: SAT_LAYER,
        type: "raster",
        source: "sb-satellite",
        paint: { "raster-opacity": satOpacity, "raster-fade-duration": 0 }
      },
      before
    );
  }, [mapReady, layers.satellite, selectedSat?.tiles, selectedSat?.maxzoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReady && map.getLayer(SAT_LAYER)) {
      map.setPaintProperty(SAT_LAYER, "raster-opacity", satOpacity);
    }
  }, [satOpacity, mapReady]);

  // a single Sentinel-2 scene drawn exactly on its footprint
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (map.getLayer(OVERLAY_LAYER)) map.removeLayer(OVERLAY_LAYER);
    if (map.getSource("sb-scene-overlay")) map.removeSource("sb-scene-overlay");

    if (!sceneOverlay?.tiles) return;

    map.addSource("sb-scene-overlay", {
      type: "raster",
      tiles: [sceneOverlay.tiles],
      tileSize: 256,
      minzoom: 5,
      maxzoom: 16,
      bounds: sceneOverlay.bbox,
      attribution: "Copernicus Sentinel-2 / Microsoft Planetary Computer"
    });

    map.addLayer(
      {
        id: OVERLAY_LAYER,
        type: "raster",
        source: "sb-scene-overlay",
        paint: { "raster-opacity": 1, "raster-fade-duration": 0 }
      },
      labelBefore.current || "sb-quakes-layer"
    );
  }, [mapReady, sceneOverlay]);

  // scene search when the toggle or the map changes
  useEffect(() => {
    if (!mapReady) return;

    if (!layers.scenes) {
      setScenes([]);
      return;
    }

    void loadScenes();
    const timer = window.setInterval(() => void loadScenes(), 10 * 60000);
    return () => window.clearInterval(timer);
  }, [mapReady, layers.scenes]);

  /* ----------------------------------------------------------- map entities */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    ensureEntityLayers(map);

    const index: Record<string, Entity> = {};
    const skipped: Record<string, number> = {};

    const collect = <T,>(
      prefix: string,
      items: T[],
      read: (item: T) => {
        pos: [unknown, unknown];
        shape?: IconShape;
        color?: string;
        rot?: number;
        z?: number;
      } | null
    ): GeoCollection => {
      const features: GeoFeature[] = [];

      items.forEach((item, i) => {
        const r = read(item);
        if (!r) return;

        const c = validCoord(...r.pos);
        if (!c) {
          skipped[prefix] = (skipped[prefix] || 0) + 1;
          return;
        }

        const key = `${prefix}:${i}`;
        index[key] = item as unknown as Entity;

        features.push({
          type: "Feature",
          properties: {
            key,
            icon: r.shape && r.color ? ensureIcon(map, r.shape, r.color) : "",
            rot: r.rot ?? 0,
            z: r.z ?? 0
          },
          geometry: { type: "Point", coordinates: c }
        });
      });

      return { type: "FeatureCollection", features };
    };

    const apply = (id: EntityLayerId, data: GeoCollection, visible: boolean) => {
      const source = map.getSource(`sb-${id}`) as maplibregl.GeoJSONSource | undefined;
      source?.setData(data as unknown as Parameters<maplibregl.GeoJSONSource["setData"]>[0]);
      map.setLayoutProperty(`sb-${id}-layer`, "visibility", visible ? "visible" : "none");
    };

    apply(
      "flights",
      collect("flights", flights, f => {
        if (f.onGround && f.category !== "military") return null;       // keep airports readable

        const cat = f.category || "commercial";
        const color = cat === "commercial" ? theme.aircraft : FLIGHT_COLORS[cat];
        const z = cat === "emergency" ? 4 : cat === "military" ? 3 : cat === "helicopter" ? 2 : cat === "private" ? 0 : 1;

        return {
          pos: [f.longitude, f.latitude],
          shape: cat === "helicopter" ? "heli" : "plane",
          color,
          rot: f.heading ?? 0,
          z
        };
      }),
      layers.flights
    );

    apply(
      "vessels",
      collect("vessels", vessels, v => {
        const cat = v.category || "other";
        return {
          pos: [v.longitude, v.latitude],
          shape: "ship",
          color: cat === "cargo" ? theme.vessels : VESSEL_COLORS[cat],
          rot: v.heading ?? v.course ?? 0,
          z: cat === "military" ? 2 : 0
        };
      }),
      layers.vessels
    );

    apply(
      "conflicts",
      collect("conflicts", conflicts, c => ({
        pos: [c.longitude, c.latitude],
        shape: "conflict",
        color: theme.conflicts,
        z: Math.min(5, Math.log10(c.mentions + 1))
      })),
      layers.conflicts
    );

    apply(
      "protests",
      collect("protests", protests, c => ({
        pos: [c.longitude, c.latitude],
        shape: "protest",
        color: theme.protests,
        z: Math.min(5, Math.log10(c.mentions + 1))
      })),
      layers.protests
    );

    // satellite icons: Sentinel-2 scenes + geostationary platforms
    const geo = satLayers.filter(
      (l, i, arr) => l.kind === "geostationary" && l.center && arr.findIndex(x => x.platform === l.platform) === i
    );

    const sceneCollection = collect("scenes", scenes, s => ({
      pos: [s.center[0], s.center[1]],
      shape: "sat",
      color: Date.now() - Date.parse(s.datetime) < 6 * 3600000 ? "#3ddc97" : "#7aa88f",
      z: Date.parse(s.datetime) / 1e12
    }));

    const geoCollection = collect("geo", geo, l => ({
      pos: [l.center![0], l.center![1]],
      shape: "sat",
      color: fresh.has(l.id) ? "#ffffff" : "#8fa5b3",
      z: 0
    }));

    apply("scenes", { type: "FeatureCollection", features: [...sceneCollection.features, ...geoCollection.features] }, layers.scenes);

    // earthquakes (circles)
    const quakeData: GeoCollection = { type: "FeatureCollection", features: [] };

    quakes.forEach((q, i) => {
      const c = validCoord(q.coordinates?.[0], q.coordinates?.[1]);
      if (!c) { skipped.quakes = (skipped.quakes || 0) + 1; return; }

      const key = `quakes:${i}`;
      index[key] = q;
      quakeData.features.push({
        type: "Feature",
        properties: { key },
        geometry: { type: "Point", coordinates: c }
      });
    });

    apply("quakes", quakeData, layers.earthquakes);
    map.setPaintProperty("sb-quakes-layer", "circle-color", theme.earthquakes);

    entityIndex.current = index;
    setDropped(skipped);
  }, [mapReady, layers, quakes, flights, vessels, conflicts, protests, scenes, satLayers, fresh, theme]);

  /* ------------------------------------------------------------------- news */

  const allNews = useMemo(() => {
    const unique = new Map<string, FeedItem>();

    [...news, ...events].forEach(item => {
      const key = item.url || item.title;
      if (!unique.has(key)) unique.set(key, item);
    });

    return [...unique.values()].sort(
      (a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()
    );
  }, [news, events]);

  const filteredNews = useMemo(() => {
    const value = query.toLowerCase();

    return allNews.filter(item =>
      `${item.title} ${item.source} ${item.summary || ""}`.toLowerCase().includes(value)
    );
  }, [allNews, query]);

  const tickerItems = useMemo(() => allNews.slice(0, 20), [allNews]);

  const alerts = useMemo<AlertItem[]>(
    () =>
      [
        ...quakes
          .filter(quake => quake.magnitude >= 4.5)
          .map(quake => ({
            id: quake.id,
            title: `Magnitude ${quake.magnitude.toFixed(1)} earthquake`,
            detail: quake.place,
            time: quake.time
          })),

        ...events.map(item => ({
          id: item.id,
          title: item.title,
          detail: item.source,
          time: item.publishedAt ? new Date(item.publishedAt).getTime() : 0
        }))
      ]
        .sort((a, b) => b.time - a.time)
        .slice(0, 50),
    [quakes, events]
  );

  /* ---------------------------------------------------------------- helpers */

  const toggle = (key: keyof LayerState) => setLayers(value => ({ ...value, [key]: !value[key] }));

  const isConflict = (v: Entity): v is ConflictCluster => "events" in v && "mentions" in v;
  const isScene = (v: Entity): v is SatelliteScene => "footprint" in v;
  const isSatLayer = (v: Entity): v is SatelliteLayerInfo => "cadence" in v && "tiles" in v;
  const isFeed = (v: Entity): v is FeedItem => "source" in v && "url" in v && "title" in v && "category" in v;
  const isVessel = (v: Entity): v is Vessel => "mmsi" in v;

  const pickScene = (scene: SatelliteScene) => {
    setSceneOverlay(scene);
    setSelected(scene);

    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: scene.center, zoom: Math.max(map.getZoom(), 7.5) });
    }
  };

  const selectSatLayer = (id: string) => {
    setSatSelected(id);
    setLayers(old => ({ ...old, satellite: true }));
    acknowledgeLayer(id);
  };

  const addNewsSource = async () => {
    setSourceMessage("");

    try {
      const result = await api.addSource({
        name: newSourceName,
        url: newSourceUrl,
        category: newSourceCategory
      });

      setSourceMessage(`Added ${result.source.name}`);
      setNewSourceName("");
      setNewSourceUrl("");

      const updated = await api.sources();
      setSources(updated.items);
      await load();
    } catch (err: unknown) {
      setSourceMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const removeNewsSource = async (url: string) => {
    try {
      await api.removeSource(url);

      const updated = await api.sources();
      setSources(updated.items);
      await load();
    } catch (err: unknown) {
      setSourceMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const setColor = (key: keyof Theme, value: string) => setTheme((old: Theme) => ({ ...old, [key]: value }));

  const layerDetail = (count: number, word: string, info: string, skipped?: number) => {
    if (!count) return info || "no data";
    return skipped ? `${count} ${word} · ${skipped} no position` : `${count} ${word}`;
  };

  const flightsOnMap = flights.filter(f => !(f.onGround && f.category !== "military")).length;
  const militaryCount = flights.filter(f => f.category === "military").length;

  /* ------------------------------------------------------------------ render */

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="icon-button mobile-only"
          onClick={() => setMobilePanel(!mobilePanel)}
          aria-label="Menu"
        >
          <Menu size={19} />
        </button>

        <div className="brand">
          <div className="brand-mark">
            <Shield size={19} />
          </div>

          <div>
            <div className="brand-name">
              SHADOW<span>BROKER</span>
            </div>
            <div className="brand-sub">GLOBAL INTELLIGENCE PLATFORM</div>
          </div>
        </div>

        <nav className="main-navigation">
          <button className={activeTab === "news" ? "active" : ""} onClick={() => setActiveTab("news")}>
            <Globe2 size={15} /> WORLD
          </button>

          <button className={activeTab === "satellite" ? "active" : ""} onClick={() => setActiveTab("satellite")}>
            <Satellite size={15} /> SATELLITE
          </button>

          <button className={activeTab === "markets" ? "active" : ""} onClick={() => setActiveTab("markets")}>
            <ChartNoAxesCombined size={15} /> MARKETS
          </button>

          <button className={activeTab === "sources" ? "active" : ""} onClick={() => setActiveTab("sources")}>
            <Radio size={15} /> SOURCES
          </button>
        </nav>

        <div className="top-status">
          <span className="live-dot" />
          GLOBAL MONITOR
          <span className="status-divider" />
          {lastUpdated ? `UPDATED ${lastUpdated.toLocaleTimeString()}` : "CONNECTING"}
        </div>

        <div className="top-actions">
          <button
            className="icon-button"
            onClick={() => {
              void load();
              void loadMarkets();
              void loadSatLayers();
            }}
            title="Refresh"
          >
            <RefreshCw size={17} className={busy || marketLoading ? "spin" : ""} />
          </button>

          <button className="icon-button" onClick={() => setActiveTab("settings")} title="Appearance">
            <Palette size={17} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className={`left-rail ${mobilePanel ? "show" : ""}`}>
          <div className="rail-heading">
            <span>INTELLIGENCE LAYERS</span>
            <Layers size={15} />
          </div>

          <div className="layer-list">
            <Layer
              icon={<Plane size={16} />}
              name="Aircraft"
              detail={layerDetail(flightsOnMap, `airborne · ${militaryCount} mil`, flightInfo, dropped.flights)}
              checked={layers.flights}
              onClick={() => toggle("flights")}
              color="blue"
            />

            <Layer
              icon={<Anchor size={16} />}
              name="Maritime / AIS"
              detail={layerDetail(vessels.length, "vessels", vesselInfo, dropped.vessels)}
              checked={layers.vessels}
              onClick={() => toggle("vessels")}
              color="cyan"
            />

            <Layer
              icon={<AlertTriangle size={16} />}
              name="Conflicts"
              detail={conflicts.length ? `${conflicts.length} hotspots · 24 h` : conflictInfo || "loading…"}
              checked={layers.conflicts}
              onClick={() => toggle("conflicts")}
              color="red"
            />

            <Layer
              icon={<Radio size={16} />}
              name="Protests"
              detail={protests.length ? `${protests.length} locations · 24 h` : conflictInfo || "loading…"}
              checked={layers.protests}
              onClick={() => toggle("protests")}
              color="purple"
            />

            <Layer
              icon={<Activity size={16} />}
              name="Earthquakes"
              detail={`${quakes.length} events`}
              checked={layers.earthquakes}
              onClick={() => toggle("earthquakes")}
              color="amber"
            />

            <Layer
              icon={<Satellite size={16} />}
              name="Satellite imagery"
              detail={layers.satellite ? selectedSat?.name || "NASA GIBS" : "off · pick in SAT tab"}
              checked={layers.satellite}
              onClick={() => {
                toggle("satellite");
                if (!layers.satellite) setActiveTab("satellite");
              }}
              color="green"
            />

            <Layer
              icon={<Sparkles size={16} />}
              name="New scene icons"
              detail={`${scenes.length} Sentinel-2 in view`}
              checked={layers.scenes}
              onClick={() => toggle("scenes")}
              color="green"
            />

            <Layer
              icon={<Globe size={16} />}
              name="Globe view"
              detail={globe ? "3D sphere" : "flat map"}
              checked={globe}
              onClick={() => setGlobe(g => !g)}
              color="blue"
            />
          </div>

          <div className="rail-heading section-gap">
            <span>LEGEND</span>
          </div>

          <div className="legend">
            {FLIGHT_LEGEND.map(l => (
              <span key={l.key}>
                <img
                  src={iconDataUrl(l.shape, l.key === "commercial" ? theme.aircraft : FLIGHT_COLORS[l.key])}
                  alt=""
                />
                {l.label}
              </span>
            ))}

            {VESSEL_LEGEND.map(l => (
              <span key={l.key}>
                <img
                  src={iconDataUrl("ship", l.key === "cargo" ? theme.vessels : VESSEL_COLORS[l.key])}
                  alt=""
                />
                {l.label}
              </span>
            ))}

            <span><img src={iconDataUrl("conflict", theme.conflicts)} alt="" />Conflict</span>
            <span><img src={iconDataUrl("protest", theme.protests)} alt="" />Protest</span>
            <span><img src={iconDataUrl("sat", "#3ddc97")} alt="" />New imagery</span>
          </div>

          <div className="rail-heading section-gap">
            <span>MAP CONTROLS</span>
            <Crosshair size={15} />
          </div>

          <div className="map-controls">
            <button onClick={() => mapRef.current?.flyTo({ center: [18, 22], zoom: 1.65 })}>
              <Globe2 size={15} />
              Reset global view
            </button>

            <button
              onClick={() =>
                mapRef.current?.easeTo({ zoom: Math.min((mapRef.current?.getZoom() || 1) + 1, 16) })
              }
            >
              <Search size={15} />
              Zoom in
            </button>
          </div>

          <div className="rail-foot">
            <span className="tiny-led" />
            PUBLIC DATA
            <span className="foot-right">v3.0.0</span>
          </div>
        </aside>

        <section className="map-section">
          <div className="map-title">
            <div>
              <span className="eyebrow">GLOBAL SITUATIONAL AWARENESS</span>
              <h1>World monitor</h1>
            </div>

            <div className="map-coords">
              {globe ? "GLOBE" : "FLAT"} VIEW <span>•</span> WGS84
            </div>
          </div>

          <div className="map-wrap">
            <div ref={mapNode} className="map-canvas" />

            {!mapReady && (
              <div className="map-loading">
                <RefreshCw size={20} className="spin" />
                <span>{mapError ? "MAP UNAVAILABLE" : "INITIALIZING MAP"}</span>
                {mapError && <small>{mapError}</small>}
              </div>
            )}

            {mapReady && mapError && <div className="map-error">MAP WARNING: {mapError}</div>}

            <div className="map-overlay map-overlay-top">
              <span className={`map-chip ${mapReady ? "online" : "offline"}`}>
                <span className="live-dot" />
                {mapReady ? "MAP ONLINE" : "MAP OFFLINE"}
              </span>

              <span className="map-chip">
                {layers.satellite && selectedSat ? selectedSat.name.toUpperCase() : "DARK MAP"}
                {layers.satellite && selectedSat?.latest && selectedSat.kind === "geostationary"
                  ? ` · ${ago(selectedSat.latest)}`
                  : ""}
              </span>
            </div>

            <button
              className="globe-toggle"
              onClick={() => setGlobe(g => !g)}
              title={globe ? "Switch to flat map" : "Switch to globe"}
            >
              <Globe size={16} />
              {globe ? "FLAT" : "GLOBE"}
            </button>

            <div className="map-toasts">
              {toasts.map(t => (
                <div className="map-toast" key={t.id}>
                  <Sparkles size={14} />
                  {t.text}
                </div>
              ))}
            </div>

            <div className="map-overlay map-overlay-bottom">
              <span>SELECT AN ICON TO INSPECT</span>

              <span>
                {flightsOnMap} AIRCRAFT · {vessels.length} VESSELS · {conflicts.length + protests.length} UNREST ·{" "}
                {quakes.length} SEISMIC
              </span>
            </div>

            {selected && (
              <div className="inspector">
                <button className="close-inspector" onClick={() => setSelected(null)}>
                  <X size={16} />
                </button>

                <div className="eyebrow">ENTITY INSPECTOR</div>

                {isConflict(selected) ? (
                  <>
                    <h3>
                      {selected.label} — {selected.place || "unknown place"}
                    </h3>
                    <p>
                      {selected.events} report{selected.events > 1 ? "s" : ""} · {selected.mentions} mentions in the
                      last 24 h · tone {selected.tone}
                    </p>
                    <div className="inspector-meta">
                      Last event {timeLabel(selected.lastEvent)} · location precision: {selected.precision}
                      <br />
                      Location is where the news places the event (GDELT), not a surveyed position.
                    </div>
                    {selected.sources.map(u => (
                      <a key={u} href={u} target="_blank" rel="noreferrer">
                        {new URL(u).hostname} ↗
                      </a>
                    ))}
                  </>
                ) : isScene(selected) ? (
                  <>
                    <h3>
                      {selected.platform} · {selected.tile || "scene"}
                    </h3>
                    {selected.preview && (
                      <img className="scene-preview" src={selected.preview} alt="Sentinel-2 preview" loading="lazy" />
                    )}
                    <div className="inspector-meta">
                      Captured {timeLabel(selected.datetime)} ({ago(selected.datetime)})
                      <br />
                      Cloud cover {selected.cloud ?? "?"}% · 10 m true colour
                    </div>
                    <div className="inspector-actions">
                      {sceneOverlay?.id === selected.id ? (
                        <button className="primary-action" onClick={() => setSceneOverlay(null)}>
                          Remove overlay
                        </button>
                      ) : (
                        <button className="primary-action" onClick={() => pickScene(selected)}>
                          Overlay on map
                        </button>
                      )}
                    </div>
                  </>
                ) : isSatLayer(selected) ? (
                  <>
                    <h3>{selected.name}</h3>
                    <p>{selected.description}</p>
                    <div className="inspector-meta">
                      {selected.cadence} · {selected.resolution}
                      <br />
                      Latest image: {selected.latest ? `${selected.latest} (${ago(selected.latest)})` : "unknown"}
                    </div>
                    <div className="inspector-actions">
                      <button className="primary-action" onClick={() => selectSatLayer(selected.id)}>
                        Show this imagery
                      </button>
                    </div>
                  </>
                ) : isFeed(selected) ? (
                  <>
                    <h3>{selected.title}</h3>
                    <p>{selected.summary}</p>
                    <div className="inspector-meta">
                      {selected.source} · {timeLabel(selected.publishedAt)}
                    </div>
                    <a href={selected.url} target="_blank" rel="noreferrer">
                      OPEN ORIGINAL SOURCE ↗
                    </a>
                  </>
                ) : "magnitude" in selected ? (
                  <>
                    <h3>{selected.title}</h3>
                    <p>{selected.place}</p>
                    <div className="inspector-meta">
                      Magnitude {selected.magnitude} · {timeLabel(new Date(selected.time).toISOString())}
                    </div>
                    <a href={selected.url} target="_blank" rel="noreferrer">
                      USGS EVENT ↗
                    </a>
                  </>
                ) : isVessel(selected) ? (
                  <>
                    <h3>{selected.name}</h3>
                    <p>
                      MMSI {selected.mmsi} · {(selected.category || "other").toUpperCase()}
                      {selected.destination ? ` → ${selected.destination}` : ""}
                    </p>
                    <div className="inspector-meta">
                      Speed {selected.speed ?? "—"} kn · Heading {selected.heading ?? "—"}°
                      <br />
                      Source: {selected.source || "AIS"}
                      {selected.updatedAt ? ` · ${ago(new Date(selected.updatedAt).toISOString())}` : ""}
                    </div>
                  </>
                ) : (
                  <>
                    <h3>{(selected as Flight).callsign || (selected as Flight).icao24}</h3>
                    <p>
                      {((selected as Flight).category || "commercial").toUpperCase()}
                      {(selected as Flight).aircraftType ? ` · ${(selected as Flight).aircraftType}` : ""}
                      {(selected as Flight).registration ? ` · ${(selected as Flight).registration}` : ""}
                      {(selected as Flight).originCountry ? ` · ${(selected as Flight).originCountry}` : ""}
                    </p>
                    <div className="inspector-meta">
                      Altitude {(selected as Flight).altitude ?? "—"} m ({m2ft((selected as Flight).altitude) ?? "—"} ft)
                      <br />
                      Speed {ms2kt((selected as Flight).velocity) ?? "—"} kn · Heading {(selected as Flight).heading ?? "—"}°
                      {(selected as Flight).squawk ? ` · squawk ${(selected as Flight).squawk}` : ""}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="map-footer">
            <span><span className="legend-dot blue" />Aircraft</span>
            <span><span className="legend-dot cyan" />Vessels</span>
            <span><span className="legend-dot red" />Conflicts</span>
            <span><span className="legend-dot purple" />Protests</span>
            <span><span className="legend-dot amber" />Earthquakes</span>
            <span className="map-footer-right">NASA GIBS / Sentinel-2 / OpenFreeMap</span>
          </div>
        </section>

        <aside className="right-panel">
          <div className="panel-tabs">
            <button className={activeTab === "news" ? "active" : ""} onClick={() => setActiveTab("news")}>
              <Newspaper size={15} /> NEWS
            </button>

            <button className={activeTab === "alerts" ? "active" : ""} onClick={() => setActiveTab("alerts")}>
              <Bell size={15} /> ALERTS
              <span className="tab-count">{alerts.length}</span>
            </button>

            <button
              className={activeTab === "satellite" ? "active" : ""}
              onClick={() => setActiveTab("satellite")}
              title="Satellite imagery"
            >
              <Satellite size={15} /> SAT
              {fresh.size > 0 && <span className="tab-count fresh">{fresh.size}</span>}
            </button>

            <button className={activeTab === "sources" ? "active" : ""} onClick={() => setActiveTab("sources")}>
              <Radio size={15} /> SRC
            </button>

            <button
              className={activeTab === "markets" ? "active" : ""}
              onClick={() => setActiveTab("markets")}
              title="Markets"
            >
              <ChartNoAxesCombined size={15} />
            </button>

            <button
              className={activeTab === "settings" ? "active" : ""}
              onClick={() => setActiveTab("settings")}
              title="Settings"
            >
              <Settings2 size={15} />
            </button>
          </div>

          {activeTab === "news" && (
            <div className="panel-content">

              <div className="panel-intro">
                <div>
                  <div className="eyebrow">GLOBAL NEWSWIRE</div>
                  <h2>Latest reports</h2>
                </div>

                <span className="count-pill">
                  {filteredNews.length} ITEMS
                </span>
              </div>

              <div className="search-box">
                <Search size={15}/>

                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search headlines or sources"
                />
              </div>

              {error && (
                <div className="inline-warning">{error}</div>
              )}

              <div className="feed-list">

                {filteredNews.map(item => (
                  <button
                    className="feed-item"
                    key={item.id}
                    onClick={() => setSelected(item)}
                  >
                    <div className="feed-meta">
                      <span className={`category ${item.category}`}>
                        {item.category.toUpperCase()}
                      </span>

                      <span>{item.source}</span>
                    </div>

                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>

                    <div className="feed-time">
                      {timeLabel(item.publishedAt)}
                      <span>OPEN REPORT ↗</span>
                    </div>
                  </button>
                ))}

                {!filteredNews.length && (
                  <div className="empty-state">
                    No reports available.
                  </div>
                )}

              </div>
            </div>
          )}

          {activeTab === "alerts" && (
            <div className="panel-content">

              <div className="panel-intro">
                <div>
                  <div className="eyebrow">EVENT DETECTION</div>
                  <h2>Alert stream</h2>
                </div>

                <span className="count-pill">
                  {alerts.length} EVENTS
                </span>
              </div>

              <div className="feed-list">

                {alerts.map(alert => (
                  <div className="alert-item" key={alert.id}>
                    <div className="alert-icon">
                      <Zap size={15}/>
                    </div>

                    <div>
                      <h3>{alert.title}</h3>
                      <p>{alert.detail}</p>

                      <time>
                        {alert.time
                          ? new Date(alert.time).toLocaleString()
                          : "Time unavailable"}
                      </time>
                    </div>
                  </div>
                ))}

                {!alerts.length && (
                  <div className="empty-state">
                    No alerts available.
                  </div>
                )}

              </div>
            </div>
          )}

          {activeTab === "satellite" && (
            <SatellitePanel
              layers={satLayers}
              detail={satDetail}
              loading={satLoading}
              imageryOn={layers.satellite}
              onToggleImagery={() => toggle("satellite")}
              selectedId={satSelected}
              onSelect={selectSatLayer}
              opacity={satOpacity}
              onOpacity={setSatOpacity}
              fresh={fresh}
              scenesOn={layers.scenes}
              onToggleScenes={() => toggle("scenes")}
              scenes={scenes}
              scenesDetail={scenesDetail}
              scenesBusy={scenesBusy}
              zoomOk={zoomOk}
              overlayId={sceneOverlay?.id || null}
              onPickScene={pickScene}
              onClearOverlay={() => setSceneOverlay(null)}
              onRefresh={() => void loadSatLayers()}
            />
          )}

          {activeTab === "sources" && (
            <div className="panel-content">
              <div className="panel-intro">
                <div>
                  <div className="eyebrow">CONNECTIVITY</div>
                  <h2>Data sources</h2>
                </div>
              </div>

              {error && <div className="inline-warning">{error}</div>}

              <div className="source-list">
                {Object.entries(serviceStatus).map(([name, status]) => (
                  <div className="source-row" key={name}>
                    <div>
                      <strong>{name}</strong>
                      <p>{status.detail}</p>
                    </div>

                    <span className={`source-state ${status.status}`}>
                      {status.status.replaceAll("_", " ")}
                    </span>
                  </div>
                ))}
              </div>

              <div className="source-note">
                <strong>Live layer diagnostics</strong>
                <p>
                  Aircraft: {flights.length} received
                  {dropped.flights ? `, ${dropped.flights} without valid position` : ""}
                  {flightInfo ? ` — ${flightInfo}` : ""}
                </p>
                <p>
                  Vessels: {vessels.length} received
                  {dropped.vessels ? `, ${dropped.vessels} without valid position` : ""}
                  {vesselInfo ? ` — ${vesselInfo}` : ""}
                </p>
                <p>
                  Unrest: {conflicts.length} conflict + {protests.length} protest locations
                  {conflictInfo ? ` — ${conflictInfo}` : ""}
                </p>
              </div>

              <div className="source-note">
                <strong>RSS source health</strong>

                {sourceStatus.map(source => (
                  <p key={source.source}>
                    {source.source}: {source.status}
                    {source.error ? ` — ${source.error}` : ""}
                  </p>
                ))}
              </div>

              <div className="source-note">
                <strong>Data integrity</strong>
                <p>Unavailable providers are never replaced with invented positions or prices.</p>
              </div>

              <div className="source-manager">

                <h3>Add news agency</h3>

                <input
                  value={newSourceName}
                  onChange={event => setNewSourceName(event.target.value)}
                  placeholder="Agency name"
                />

                <input
                  value={newSourceUrl}
                  onChange={event => setNewSourceUrl(event.target.value)}
                  placeholder="RSS / Atom URL"
                />

                <select
                  value={newSourceCategory}
                  onChange={event => setNewSourceCategory(event.target.value)}
                >
                  <option value="world">World</option>
                  <option value="conflict">Conflict</option>
                  <option value="protest">Protest</option>
                  <option value="technology">Technology</option>
                  <option value="finance">Finance</option>
                </select>

                <button
                  className="primary-action"
                  onClick={() => void addNewsSource()}
                  disabled={!newSourceName.trim() || !newSourceUrl.trim()}
                >
                  <Plus size={15}/>
                  Add source
                </button>

                {sourceMessage && (
                  <p className="source-message">{sourceMessage}</p>
                )}

                <h3>Custom sources</h3>

                {sources
                  .filter(source => source.custom)
                  .map(source => (
                    <div className="custom-source" key={source.url}>
                      <span>{source.name}</span>

                      <button
                        onClick={() => void removeNewsSource(source.url)}
                        title="Remove source"
                      >
                        <Trash2 size={15}/>
                      </button>
                    </div>
                  ))}

              </div>

            </div>
          )}

          {activeTab === "markets" && (
            <MarketsPanel
              items={marketItems}
              services={marketServices}
              loading={marketLoading}
              error={marketError}
              onRefresh={() => void loadMarkets()}
            />
          )}

          {activeTab === "settings" && (
            <div className="panel-content">

              <div className="panel-intro">
                <div>
                  <div className="eyebrow">INTERFACE CONTROL</div>
                  <h2>Appearance</h2>
                </div>
              </div>

              <div className="theme-list">

                {(Object.keys(defaultTheme) as (keyof Theme)[]).map(key => (
                  <label className="theme-row" key={key}>
                    <span>{key.replace(/([A-Z])/g, " $1")}</span>

                    <input
                      type="color"
                      value={theme[key]}
                      onChange={event => setColor(key, event.target.value)}
                    />
                  </label>
                ))}

                <button
                  className="primary-action"
                  onClick={() => setTheme(defaultTheme)}
                >
                  Reset theme
                </button>

              </div>

              <div className="source-note">
                Theme settings are saved locally in this browser.
              </div>

            </div>
          )}

          <div className="panel-bottom">
            <span className="tiny-led" />
            PUBLIC DATA SOURCES
            <span>·</span>
            {busy || marketLoading ? "UPDATING" : "MONITORING"}
          </div>
        </aside>
      </main>

      <div className="breaking-ticker">
        <button className="ticker-label" onClick={() => setTickerPaused(!tickerPaused)}>
          <span className="ticker-live" />
          BREAKING NEWS
          {tickerPaused ? " ▶" : " ❚❚"}
        </button>

        <div className="ticker-viewport">
          {tickerItems.length ? (
            <div
              className={`ticker-track ${tickerPaused ? "paused" : ""}`}
              style={{ animationDuration: `${Math.max(40, tickerItems.length * 7)}s` }}
            >
              {[...tickerItems, ...tickerItems].map((item, index) => (
                <button className="ticker-item" key={`${item.id}-${index}`} onClick={() => setSelected(item)}>
                  <strong>{item.source}</strong>
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <span className="ticker-empty">Waiting for news feeds...</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Layer({
  icon,
  name,
  detail,
  checked,
  onClick,
  color
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  checked: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button className="layer-row" onClick={onClick} aria-pressed={checked}>
      <span className={`layer-icon ${color}`}>{icon}</span>

      <span className="layer-copy">
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>

      <span className={`toggle ${checked ? "on" : ""}`}>
        <i />
      </span>
    </button>
  );
}
