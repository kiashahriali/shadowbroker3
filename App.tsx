
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import maplibregl, {
  Map as MapLibreMap,
  Marker
} from "maplibre-gl";

import {
  Activity,
  AlertTriangle,
  Anchor,
  Bell,
  Crosshair,
  Globe2,
  Layers,
  Menu,
  Newspaper,
  Plane,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  X,
  Zap,
  Satellite,
  Plus,
  Trash2,
  Palette,
  ChartNoAxesCombined
} from "lucide-react";

import { api } from "./api";

import type {
  Earthquake,
  FeedItem,
  Flight,
  LayerState,
  Vessel,
  NewsSource,
  ProviderStatus
} from "./types";

import "./style.css";

const initialLayers: LayerState = {
  flights: true,
  earthquakes: true,
  conflicts: true,
  protests: true,
  vessels: true,
  satellite: false
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

type Tab =
  | "news"
  | "alerts"
  | "sources"
  | "settings";

type AlertItem = {
  id: string;
  title: string;
  detail: string;
  time: number;
};

export default function App() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<Marker[]>([]);
  const satelliteAdded = useRef(false);
  const loadingRef = useRef(false);

  const [layers, setLayers] = useState<LayerState>(() => {
    try {
      const saved = localStorage.getItem("sb-layers");

      return {
        ...initialLayers,
        ...(saved ? JSON.parse(saved) : {})
      };
    } catch {
      return initialLayers;
    }
  });

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("sb-theme");

      return {
        ...defaultTheme,
        ...(saved ? JSON.parse(saved) : {})
      };
    } catch {
      return defaultTheme;
    }
  });

  const [news, setNews] = useState<FeedItem[]>([]);
  const [events, setEvents] = useState<FeedItem[]>([]);
  const [quakes, setQuakes] = useState<Earthquake[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [vessels, setVessels] = useState<Vessel[]>([]);

  const [serviceStatus, setServiceStatus] =
    useState<Record<string, ProviderStatus>>({});

  const [sourceStatus, setSourceStatus] = useState<
    { source: string; status: string; error?: string }[]
  >([]);

  const [sources, setSources] = useState<NewsSource[]>([]);

  const [activeTab, setActiveTab] = useState<Tab>("news");

  const [selected, setSelected] = useState<
    FeedItem | Earthquake | Flight | Vessel | null
  >(null);

  const [query, setQuery] = useState("");
  const [mobilePanel, setMobilePanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState("");

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceCategory, setNewSourceCategory] =
    useState("world");

  const [sourceMessage, setSourceMessage] = useState("");
  const [tickerPaused, setTickerPaused] = useState(false);

  const load = async () => {
    if (loadingRef.current) return;

    loadingRef.current = true;
    setBusy(true);
    setError("");

    try {
      const results = await Promise.allSettled([
        api.news(),
        api.events(),
        api.earthquakes(),
        api.flights(),
        api.vessels(),
        api.status(),
        api.sources()
      ]);

      if (results[0].status === "fulfilled") {
        setNews(results[0].value.items || []);
        setSourceStatus(results[0].value.sourceStatus || []);
      }

      if (results[1].status === "fulfilled") {
        setEvents(results[1].value.items || []);
      }

      if (results[2].status === "fulfilled") {
        setQuakes(results[2].value.items || []);
      }

      if (results[3].status === "fulfilled") {
        setFlights(results[3].value.items || []);
      }

      if (results[4].status === "fulfilled") {
        setVessels(results[4].value.items || []);
      }

      if (results[5].status === "fulfilled") {
        setServiceStatus(results[5].value.services || {});
      }

      if (results[6].status === "fulfilled") {
        setSources(results[6].value.items || []);
      }

      const rejected = results.filter(
        result => result.status === "rejected"
      );

      if (rejected.length > 0) {
        setError(
          "Some services are unavailable. Check Sources."
        );
      }

      setLastUpdated(new Date());

    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : String(err)
      );

    } finally {
      loadingRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      void load();
    }, 120000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "sb-layers",
      JSON.stringify(layers)
    );
  }, [layers]);

  useEffect(() => {
    localStorage.setItem(
      "sb-theme",
      JSON.stringify(theme)
    );

    Object.entries(theme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(
        `--sb-${key}`,
        String(value)
      );
    });
  }, [theme]);

  // MAP INITIALIZATION

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapNode.current,
      style:
        import.meta.env.VITE_MAP_STYLE ||
        "https://tiles.openfreemap.org/styles/dark",
      center: [18, 22],
      zoom: 1.65,
      minZoom: 1.2,
      maxZoom: 16,
      attributionControl: {}
    });

    map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true
      }),
      "top-right"
    );

    map.addControl(
      new maplibregl.ScaleControl({
        unit: "metric"
      }),
      "bottom-left"
    );

    map.on("load", () => {
      satelliteAdded.current = false;
      addSatelliteLayer(map);
      updateSatelliteVisibility(map, layers.satellite);
    });

    mapRef.current = map;

    return () => {
      markerRefs.current.forEach(marker => marker.remove());
      markerRefs.current = [];

      map.remove();
      mapRef.current = null;
      satelliteAdded.current = false;
    };
  }, []);

function addSatelliteLayer(map: MapLibreMap) {
  if (satelliteAdded.current) return;

  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 2);

  const imageDate = date.toISOString().slice(0, 10);

  const tileUrl =
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/` +
    `MODIS_Terra_CorrectedReflectance_TrueColor/default/` +
    `${imageDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;

  if (!map.getSource("sb-satellite")) {
    map.addSource("sb-satellite", {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      attribution: "NASA GIBS / NASA Earthdata"
    });
  }

  if (!map.getLayer("sb-satellite-layer")) {
    map.addLayer({
      id: "sb-satellite-layer",
      type: "raster",
      source: "sb-satellite",
      layout: {
        visibility: "none"
      },
      paint: {
        "raster-opacity": 0.9
      }
    });
  }

  satelliteAdded.current = true;
}

  function updateSatelliteVisibility(
    map: MapLibreMap,
    visible: boolean
  ) {
    if (!map.isStyleLoaded()) return;

    if (!map.getLayer("sb-satellite-layer")) {
      addSatelliteLayer(map);
    }

    if (map.getLayer("sb-satellite-layer")) {
      map.setLayoutProperty(
        "sb-satellite-layer",
        "visibility",
        visible ? "visible" : "none"
      );
    }
  }

  // SATELLITE LAYER

  useEffect(() => {
    const map = mapRef.current;

    if (!map) return;

    if (map.isStyleLoaded()) {
      updateSatelliteVisibility(map, layers.satellite);
    } else {
      map.once("load", () => {
        updateSatelliteVisibility(map, layers.satellite);
      });
    }
  }, [layers.satellite]);

  // MARKERS

  useEffect(() => {
    const map = mapRef.current;

    if (!map) return;

    markerRefs.current.forEach(marker => marker.remove());
    markerRefs.current = [];

    const addMarker = (
      longitude: number,
      latitude: number,
      color: string,
      title: string,
      item: FeedItem | Earthquake | Flight | Vessel,
      symbol = ""
    ) => {
      if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude)
      ) return;

      const element = document.createElement("button");

      element.className = "map-marker";
      element.style.setProperty("--marker-color", color);
      element.title = title;
      element.type = "button";

      const symbolElement = document.createElement("span");
      symbolElement.textContent = symbol;
      element.appendChild(symbolElement);

      element.addEventListener("click", () => {
        setSelected(item);
      });

      const marker = new maplibregl.Marker({
        element,
        anchor: "center"
      })
        .setLngLat([longitude, latitude])
        .addTo(map);

      markerRefs.current.push(marker);
    };

    if (layers.earthquakes) {
      quakes.forEach(quake => {
        addMarker(
          quake.coordinates[0],
          quake.coordinates[1],
          theme.earthquakes,
          quake.title,
          quake,
          "•"
        );
      });
    }

    if (layers.flights) {
      flights.slice(0, 500).forEach(flight => {
        addMarker(
          flight.longitude,
          flight.latitude,
          theme.aircraft,
          flight.callsign || flight.icao24,
          flight,
          "✈"
        );
      });
    }

    if (layers.vessels) {
      vessels.slice(0, 500).forEach(vessel => {
        addMarker(
          vessel.longitude,
          vessel.latitude,
          theme.vessels,
          vessel.name,
          vessel,
          "◆"
        );
      });
    }
  }, [
    layers,
    quakes,
    flights,
    vessels,
    theme
  ]);

  // NEWS

  const allNews = useMemo(() => {
    const combined = [...news, ...events];

    const unique = new Map<string, FeedItem>();

    combined.forEach(item => {
      const key = item.url || item.title;

      if (!unique.has(key)) {
        unique.set(key, item);
      }
    });

    return [...unique.values()].sort((a, b) =>
      new Date(b.publishedAt || 0).getTime() -
      new Date(a.publishedAt || 0).getTime()
    );
  }, [news, events]);

  const filteredNews = useMemo(() => {
    const value = query.toLowerCase();

    return allNews.filter(item =>
      `${item.title} ${item.source} ${item.summary || ""}`
        .toLowerCase()
        .includes(value)
    );
  }, [allNews, query]);

  const tickerItems = useMemo(
    () => allNews.slice(0, 20),
    [allNews]
  );

  // ALERTS

  const alerts = useMemo<AlertItem[]>(() => [
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
      time: item.publishedAt
        ? new Date(item.publishedAt).getTime()
        : 0
    }))
  ]
    .sort((a, b) => b.time - a.time)
    .slice(0, 50), [quakes, events]);

  const toggle = (key: keyof LayerState) => {
    setLayers(value => ({
      ...value,
      [key]: !value[key]
    }));
  };

  const isFeed = (
    value: FeedItem | Earthquake | Flight | Vessel
  ): value is FeedItem =>
    "source" in value &&
    "url" in value;

  const isVessel = (
    value: FeedItem | Earthquake | Flight | Vessel
  ): value is Vessel =>
    "mmsi" in value;

  const addNewsSource = async () => {
    setSourceMessage("");

    try {
      const result = await api.addSource({
        name: newSourceName,
        url: newSourceUrl,
        category: newSourceCategory
      });

      setSourceMessage(
        `Added ${result.source.name}`
      );

      setNewSourceName("");
      setNewSourceUrl("");

      const updated = await api.sources();
      setSources(updated.items);

      await load();

    } catch (err: unknown) {
      setSourceMessage(
        err instanceof Error
          ? err.message
          : String(err)
      );
    }
  };

  const removeNewsSource = async (url: string) => {
    try {
      await api.removeSource(url);

      const updated = await api.sources();
      setSources(updated.items);

      await load();

    } catch (err: unknown) {
      setSourceMessage(
        err instanceof Error
          ? err.message
          : String(err)
      );
    }
  };

  const setColor = (
  key: keyof typeof defaultTheme,
  value: string
) => {
  setTheme((old: typeof defaultTheme) => ({
    ...old,
    [key]: value
  }));
};

  const setSatelliteMode = () => {
    setLayers(old => ({
      ...old,
      satellite: !old.satellite
    }));
  };

  return (
    <div className="app-shell">

      <header className="topbar">

        <button
          className="icon-button mobile-only"
          onClick={() => setMobilePanel(!mobilePanel)}
          aria-label="Menu"
        >
          <Menu size={19}/>
        </button>

        <div className="brand">
          <div className="brand-mark">
            <Shield size={19}/>
          </div>

          <div>
            <div className="brand-name">
              SHADOW<span>BROKER</span>
            </div>

            <div className="brand-sub">
              GLOBAL INTELLIGENCE PLATFORM
            </div>
          </div>
        </div>

        <nav className="main-navigation">

          <button
            className="active"
            onClick={() => setActiveTab("news")}
          >
            <Globe2 size={15}/> WORLD
          </button>

          <button
            onClick={() => setActiveTab("sources")}
          >
            <Newspaper size={15}/> NEWS
          </button>

          <button
            disabled
            title="Markets module is not implemented yet"
          >
            <ChartNoAxesCombined size={15}/> MARKETS
          </button>

        </nav>

        <div className="top-status">
          <span className="live-dot"/>
          GLOBAL MONITOR
          <span className="status-divider"/>
          {lastUpdated
            ? `UPDATED ${lastUpdated.toLocaleTimeString()}`
            : "CONNECTING"}
        </div>

        <div className="top-actions">

          <button
            className="icon-button"
            onClick={() => void load()}
            title="Refresh"
          >
            <RefreshCw
              size={17}
              className={busy ? "spin" : ""}
            />
          </button>

          <button
            className="icon-button"
            onClick={() => setActiveTab("settings")}
            title="Appearance"
          >
            <Palette size={17}/>
          </button>

        </div>
      </header>

      <main className="workspace">

        <aside className={`left-rail ${mobilePanel ? "show" : ""}`}>

          <div className="rail-heading">
            <span>INTELLIGENCE LAYERS</span>
            <Layers size={15}/>
          </div>

          <div className="layer-list">

            <Layer
              icon={<Plane size={16}/>}
              name="Aircraft"
              detail={`${flights.length} tracked`}
              checked={layers.flights}
              onClick={() => toggle("flights")}
              color="blue"
            />

            <Layer
              icon={<Activity size={16}/>}
              name="Earthquakes"
              detail={`${quakes.length} events`}
              checked={layers.earthquakes}
              onClick={() => toggle("earthquakes")}
              color="amber"
            />

            <Layer
              icon={<AlertTriangle size={16}/>}
              name="Conflicts"
              detail="GDELT reports"
              checked={layers.conflicts}
              onClick={() => toggle("conflicts")}
              color="red"
            />

            <Layer
              icon={<Radio size={16}/>}
              name="Protests"
              detail="GDELT reports"
              checked={layers.protests}
              onClick={() => toggle("protests")}
              color="purple"
            />

            <Layer
              icon={<Anchor size={16}/>}
              name="Maritime / AIS"
              detail={`${vessels.length} vessels`}
              checked={layers.vessels}
              onClick={() => toggle("vessels")}
              color="cyan"
            />

            <Layer
              icon={<Satellite size={16}/>}
              name="Satellite imagery"
              detail={layers.satellite ? "NASA GIBS" : "Dark map"}
              checked={layers.satellite}
              onClick={setSatelliteMode}
              color="green"
            />

          </div>

          <div className="rail-heading section-gap">
            <span>MAP CONTROLS</span>
            <Crosshair size={15}/>
          </div>

          <div className="map-controls">

            <button
              onClick={() =>
                mapRef.current?.flyTo({
                  center: [18, 22],
                  zoom: 1.65
                })
              }
            >
              <Globe2 size={15}/>
              Reset global view
            </button>

            <button
              onClick={() =>
                mapRef.current?.easeTo({
                  zoom: Math.min(
                    (mapRef.current?.getZoom() || 1) + 1,
                    16
                  )
                })
              }
            >
              <Search size={15}/>
              Zoom in
            </button>

          </div>

          <div className="rail-foot">
            <span className="tiny-led"/>
            PUBLIC DATA
            <span className="foot-right">v2.0.0</span>
          </div>

        </aside>

        <section className="map-section">

          <div className="map-title">
            <div>
              <span className="eyebrow">
                GLOBAL SITUATIONAL AWARENESS
              </span>
              <h1>World monitor</h1>
            </div>

            <div className="map-coords">
              GLOBAL VIEW <span>•</span> WGS84
            </div>
          </div>

          <div className="map-wrap">

            <div
              ref={mapNode}
              className="map-canvas"
            />

            <div className="map-overlay map-overlay-top">

              <span className="map-chip">
                <span className="live-dot"/>
                MAP ONLINE
              </span>

              <span className="map-chip">
                {layers.satellite
                  ? "NASA SATELLITE"
                  : "DARK MAP"}
              </span>

            </div>

            <div className="map-overlay map-overlay-bottom">
              <span>SELECT A MARKER TO INSPECT</span>

              <span>
                {flights.length} AIRCRAFT ·
                {vessels.length} VESSELS ·
                {quakes.length} SEISMIC EVENTS
              </span>
            </div>

            {selected && (
              <div className="inspector">

                <button
                  className="close-inspector"
                  onClick={() => setSelected(null)}
                >
                  <X size={16}/>
                </button>

                <div className="eyebrow">
                  ENTITY INSPECTOR
                </div>

                {isFeed(selected) ? (
                  <>
                    <h3>{selected.title}</h3>
                    <p>{selected.summary}</p>

                    <div className="inspector-meta">
                      {selected.source} ·
                      {timeLabel(selected.publishedAt)}
                    </div>

                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      OPEN ORIGINAL SOURCE ↗
                    </a>
                  </>
                ) : "magnitude" in selected ? (
                  <>
                    <h3>{selected.title}</h3>
                    <p>{selected.place}</p>

                    <div className="inspector-meta">
                      Magnitude {selected.magnitude} ·
                      {timeLabel(
                        new Date(selected.time).toISOString()
                      )}
                    </div>

                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      USGS EVENT ↗
                    </a>
                  </>
                ) : isVessel(selected) ? (
                  <>
                    <h3>{selected.name}</h3>
                    <p>MMSI: {selected.mmsi}</p>

                    <div className="inspector-meta">
                      Speed: {selected.speed ?? "—"} knots ·
                      Heading: {selected.heading ?? "—"}
                    </div>
                  </>
                ) : (
                  <>
                    <h3>
                      {selected.callsign || selected.icao24}
                    </h3>

                    <p>{selected.originCountry}</p>

                    <div className="inspector-meta">
                      Altitude {selected.altitude ?? "—"} m ·
                      Speed {selected.velocity ?? "—"} m/s
                    </div>
                  </>
                )}

              </div>
            )}

          </div>

          <div className="map-footer">
            <span>
              <span className="legend-dot blue"/>
              Aircraft
            </span>

            <span>
              <span className="legend-dot amber"/>
              Earthquakes
            </span>

            <span>
              <span className="legend-dot red"/>
              Conflicts
            </span>

            <span>
              <span className="legend-dot purple"/>
              Protests
            </span>

            <span>
              <span className="legend-dot cyan"/>
              Vessels
            </span>

            <span className="map-footer-right">
              NASA GIBS / OpenFreeMap
            </span>
          </div>

        </section>

        <aside className="right-panel">

          <div className="panel-tabs">

            <button
              className={activeTab === "news" ? "active" : ""}
              onClick={() => setActiveTab("news")}
            >
              <Newspaper size={15}/> NEWS
            </button>

            <button
              className={activeTab === "alerts" ? "active" : ""}
              onClick={() => setActiveTab("alerts")}
            >
              <Bell size={15}/> ALERTS
              <span className="tab-count">
                {alerts.length}
              </span>
            </button>

            <button
              className={activeTab === "sources" ? "active" : ""}
              onClick={() => setActiveTab("sources")}
            >
              <Radio size={15}/> SOURCES
            </button>

            <button
              className={activeTab === "settings" ? "active" : ""}
              onClick={() => setActiveTab("settings")}
            >
              <Settings2 size={15}/>
            </button>

          </div>

          {activeTab === "news" && (
            <div className="panel-content">

              <div className="panel-intro">
                <div>
                  <div className="eyebrow">
                    GLOBAL NEWSWIRE
                  </div>
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
                  onChange={event =>
                    setQuery(event.target.value)
                  }
                  placeholder="Search headlines or sources"
                />
              </div>

              {error && (
                <div className="inline-warning">
                  {error}
                </div>
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
                  <div className="eyebrow">
                    EVENT DETECTION
                  </div>
                  <h2>Alert stream</h2>
                </div>

                <span className="count-pill">
                  {alerts.length} EVENTS
                </span>
              </div>

              <div className="feed-list">

                {alerts.map(alert => (
                  <div
                    className="alert-item"
                    key={alert.id}
                  >
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

          {activeTab === "sources" && (
            <div className="panel-content">

              <div className="panel-intro">
                <div>
                  <div className="eyebrow">
                    CONNECTIVITY
                  </div>
                  <h2>Data sources</h2>
                </div>
              </div>

              <div className="source-list">

                {Object.entries(serviceStatus).map(
                  ([name, status]) => (
                    <div
                      className="source-row"
                      key={name}
                    >
                      <div>
                        <strong>{name}</strong>
                        <p>{status.detail}</p>
                      </div>

                      <span
                        className={`source-state ${status.status}`}
                      >
                        {status.status.replaceAll("_", " ")}
                      </span>
                    </div>
                  )
                )}

              </div>

              <div className="source-note">
                <strong>RSS source health</strong>

                {sourceStatus.map(source => (
                  <p key={source.source}>
                    {source.source}: {source.status}
                    {source.error
                      ? ` — ${source.error}`
                      : ""}
                  </p>
                ))}
              </div>

              <div className="source-note">
                <strong>Data integrity</strong>
                <p>
                  Unavailable providers are not replaced
                  with invented live positions.
                </p>
              </div>

              <div className="source-manager">

                <h3>Add news agency</h3>

                <input
                  value={newSourceName}
                  onChange={event =>
                    setNewSourceName(event.target.value)
                  }
                  placeholder="Agency name"
                />

                <input
                  value={newSourceUrl}
                  onChange={event =>
                    setNewSourceUrl(event.target.value)
                  }
                  placeholder="RSS / Atom URL"
                />

                <select
                  value={newSourceCategory}
                  onChange={event =>
                    setNewSourceCategory(event.target.value)
                  }
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
                  disabled={
                    !newSourceName.trim() ||
                    !newSourceUrl.trim()
                  }
                >
                  <Plus size={15}/>
                  Add source
                </button>

                {sourceMessage && (
                  <p className="source-message">
                    {sourceMessage}
                  </p>
                )}

                <h3>Custom sources</h3>

                {sources
                  .filter(source => source.custom)
                  .map(source => (
                    <div
                      className="custom-source"
                      key={source.url}
                    >
                      <span>{source.name}</span>

                      <button
                        onClick={() =>
                          void removeNewsSource(source.url)
                        }
                        title="Remove source"
                      >
                        <Trash2 size={15}/>
                      </button>
                    </div>
                  ))}

              </div>

            </div>
          )}

          {activeTab === "settings" && (
            <div className="panel-content">

              <div className="panel-intro">
                <div>
                  <div className="eyebrow">
                    INTERFACE CONTROL
                  </div>
                  <h2>Appearance</h2>
                </div>
              </div>

              <div className="theme-list">

                {(
                  Object.keys(defaultTheme) as
                    (keyof typeof defaultTheme)[]
                ).map(key => (
                  <label
                    className="theme-row"
                    key={key}
                  >
                    <span>
                      {key.replace(/([A-Z])/g, " $1")}
                    </span>

                    <input
                      type="color"
                      value={theme[key]}
                      onChange={event =>
                        setColor(key, event.target.value)
                      }
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
            <span className="tiny-led"/>
            PUBLIC DATA SOURCES
            <span>·</span>
            {busy ? "UPDATING" : "MONITORING"}
          </div>

        </aside>

      </main>

      <div className="breaking-ticker">

        <button
          className="ticker-label"
          onClick={() => setTickerPaused(!tickerPaused)}
        >
          <span className="ticker-live"/>
          BREAKING NEWS
          {tickerPaused ? " ▶" : " ❚❚"}
        </button>

        <div
          className={`ticker-track ${tickerPaused ? "paused" : ""}`}
        >
          {tickerItems.length ? (
            [...tickerItems, ...tickerItems].map(
              (item, index) => (
                <button
                  className="ticker-item"
                  key={`${item.id}-${index}`}
                  onClick={() => setSelected(item)}
                >
                  <strong>{item.source}</strong>
                  <span>{item.title}</span>
                </button>
              )
            )
          ) : (
            <span className="ticker-empty">
              Waiting for news feeds...
            </span>
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
    <button
      className="layer-row"
      onClick={onClick}
    >
      <span className={`layer-icon ${color}`}>
        {icon}
      </span>

      <span className="layer-copy">
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>

      <span className={`toggle ${checked ? "on" : ""}`}>
        <i/>
      </span>
    </button>
  );
}
