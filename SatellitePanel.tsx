import { Eye, EyeOff, RefreshCw, Satellite as SatIcon, Sparkles } from "lucide-react";
import type { SatelliteLayerInfo, SatelliteScene } from "./types";

export function ago(iso?: string | null) {
  if (!iso) return "unknown";

  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;

  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 2) return "just now";
  if (m < 90) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

const isFresh = (iso?: string | null, hours = 6) => !!iso && Date.now() - Date.parse(iso) < hours * 3600000;

export default function SatellitePanel({
  layers,
  detail,
  loading,
  imageryOn,
  onToggleImagery,
  selectedId,
  onSelect,
  opacity,
  onOpacity,
  fresh,
  scenesOn,
  onToggleScenes,
  scenes,
  scenesDetail,
  scenesBusy,
  zoomOk,
  overlayId,
  onPickScene,
  onClearOverlay,
  onRefresh
}: {
  layers: SatelliteLayerInfo[];
  detail: string;
  loading: boolean;
  imageryOn: boolean;
  onToggleImagery: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
  opacity: number;
  onOpacity: (v: number) => void;
  fresh: Set<string>;
  scenesOn: boolean;
  onToggleScenes: () => void;
  scenes: SatelliteScene[];
  scenesDetail: string;
  scenesBusy: boolean;
  zoomOk: boolean;
  overlayId: string | null;
  onPickScene: (scene: SatelliteScene) => void;
  onClearOverlay: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="panel-content sat-panel">
      <div className="panel-intro">
        <div>
          <div className="eyebrow">OPEN SATELLITE IMAGERY</div>
          <h2>Earth observation</h2>
        </div>

        <button className="market-refresh" onClick={onRefresh} title="Refresh imagery list">
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className="sat-switch">
        <button className={imageryOn ? "primary-action on" : "primary-action"} onClick={onToggleImagery}>
          {imageryOn ? <Eye size={15} /> : <EyeOff size={15} />}
          {imageryOn ? "Imagery visible" : "Imagery hidden"}
        </button>

        <label className="opacity-row">
          <span>Opacity</span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={e => onOpacity(Number(e.target.value) / 100)}
          />
        </label>
      </div>

      <div className="eyebrow sat-group">NASA GIBS · GLOBAL, FREE</div>

      <div className="sat-list">
        {layers.map(layer => (
          <button
            key={layer.id}
            className={`sat-item ${selectedId === layer.id ? "active" : ""}`}
            onClick={() => onSelect(layer.id)}
          >
            <div className="sat-item-top">
              <strong>{layer.name}</strong>
              {fresh.has(layer.id) && (
                <span className="new-badge"><Sparkles size={10} /> NEW</span>
              )}
            </div>

            <p>{layer.description}</p>

            <div className="sat-item-meta">
              <span>{layer.cadence}</span>
              <span>{layer.resolution}</span>
              <span>
                {layer.latest
                  ? layer.kind === "polar" ? `date ${layer.latest}` : `${ago(layer.latest)} · ${layer.latest.slice(11, 16)}Z`
                  : "latest"}
              </span>
            </div>
          </button>
        ))}

        {!layers.length && <div className="empty-state">{loading ? "Reading NASA GIBS…" : detail || "No imagery layers"}</div>}
      </div>

      <div className="sat-detail">{detail}</div>

      <div className="eyebrow sat-group">SENTINEL-2 · 10 m · NEW SCENES</div>

      <div className="sat-switch">
        <button className={scenesOn ? "primary-action on" : "primary-action"} onClick={onToggleScenes}>
          <SatIcon size={15} />
          {scenesOn ? "Scene icons on map" : "Scene icons hidden"}
        </button>
      </div>

      {scenesOn && !zoomOk && (
        <div className="inline-warning">Zoom in a little (about the size of a country) to search for new Sentinel-2 scenes.</div>
      )}

      {overlayId && (
        <button className="primary-action clear-overlay" onClick={onClearOverlay}>
          Remove scene overlay
        </button>
      )}

      <div className="sat-list">
        {scenes.slice(0, 25).map(scene => (
          <button
            key={scene.id}
            className={`sat-item scene ${overlayId === scene.id ? "active" : ""}`}
            onClick={() => onPickScene(scene)}
          >
            <div className="sat-item-top">
              <strong>{scene.platform} · {scene.tile || "scene"}</strong>
              {isFresh(scene.datetime) && <span className="new-badge"><Sparkles size={10} /> NEW</span>}
            </div>

            <div className="sat-item-meta">
              <span>{new Date(scene.datetime).toLocaleString()}</span>
              <span>{ago(scene.datetime)}</span>
              <span>{scene.cloud === null ? "cloud ?" : `${scene.cloud}% cloud`}</span>
            </div>
          </button>
        ))}

        {scenesOn && zoomOk && !scenes.length && (
          <div className="empty-state">{scenesBusy ? "Searching for scenes…" : scenesDetail || "No recent scenes in view."}</div>
        )}
      </div>

      {scenesOn && zoomOk && scenes.length > 0 && <div className="sat-detail">{scenesDetail}</div>}

      <div className="source-note">
        <strong>How fresh is it?</strong>
        <p>
          GOES / Himawari full-disk images arrive every 10 minutes (about 40 minutes after capture). VIIRS and MODIS
          daily mosaics appear within roughly 3 hours of each satellite pass. Sentinel-2 revisits a place every 2–5
          days; each new scene gets a satellite icon at its exact footprint — tap it to overlay it.
        </p>
      </div>
    </div>
  );
}
