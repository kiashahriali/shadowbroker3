// Satellite imagery - two open, key-free sources:
//
//  1. NASA GIBS (WMTS, EPSG:3857 "GoogleMapsCompatible" tiles). Tiles are
//     georeferenced on the same Web-Mercator grid MapLibre uses, so they
//     line up exactly with the base map.
//       - GOES-East / GOES-West / Himawari: full-disk every 10 minutes
//         (about 40 min latency)
//       - VIIRS (NOAA-20, NOAA-21, Suomi-NPP) and MODIS (Terra, Aqua):
//         daily true colour, 250 m, available within ~3 h of the pass
//     The newest timestamp of every layer is read from the WMTS
//     GetCapabilities <Default> value, so the app knows when a new image
//     has arrived.
//
//  2. Sentinel-2 L2A scenes (10 m, revisit 2-5 days) found through the
//     Microsoft Planetary Computer STAC API and rendered with its public
//     tiler. Each scene has a real footprint, so it can be shown as an
//     icon on the map and overlaid exactly where it was captured.

import type { SatelliteLayerInfo, SatelliteScene } from "./types";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const CAPS_URL = `${GIBS}/wmts.cgi?SERVICE=WMTS&request=GetCapabilities`;
const PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const PC_DATA = "https://planetarycomputer.microsoft.com/api/data/v1/item";

type Candidate = {
  id: string;
  name: string;
  platform: string;
  kind: "geostationary" | "polar";
  cadence: string;
  resolution: string;
  description: string;
  center: [number, number] | null;
  offline?: { tms: string; ext: string };   // used only if GetCapabilities cannot be read
};

const CANDIDATES: Candidate[] = [
  {
    id: "GOES-East_ABI_GeoColor",
    name: "GOES-East GeoColor",
    platform: "GOES-East",
    kind: "geostationary",
    cadence: "every 10 min",
    resolution: "1-2 km",
    description: "Americas and Atlantic: true colour by day, infrared by night.",
    center: [-75.2, 0],
    offline: { tms: "GoogleMapsCompatible_Level7", ext: "png" }
  },
  {
    id: "GOES-West_ABI_GeoColor",
    name: "GOES-West GeoColor",
    platform: "GOES-West",
    kind: "geostationary",
    cadence: "every 10 min",
    resolution: "1-2 km",
    description: "Pacific, western Americas: true colour by day, infrared by night.",
    center: [-137.2, 0],
    offline: { tms: "GoogleMapsCompatible_Level7", ext: "png" }
  },
  {
    id: "Himawari_AHI_GeoColor",
    name: "Himawari GeoColor",
    platform: "Himawari",
    kind: "geostationary",
    cadence: "every 10 min",
    resolution: "1-2 km",
    description: "Asia-Pacific: true colour by day, infrared by night.",
    center: [140.7, 0]
  },
  {
    id: "Himawari_AHI_Band3_Red_Visible_1km",
    name: "Himawari Visible",
    platform: "Himawari",
    kind: "geostationary",
    cadence: "every 10 min",
    resolution: "1 km",
    description: "Asia-Pacific, red visible band (grayscale).",
    center: [140.7, 0],
    offline: { tms: "GoogleMapsCompatible_Level7", ext: "png" }
  },
  {
    id: "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
    name: "VIIRS NOAA-21 True Color",
    platform: "NOAA-21",
    kind: "polar",
    cadence: "daily",
    resolution: "250 m",
    description: "Global daily mosaic, newest orbit passes.",
    center: null,
    offline: { tms: "GoogleMapsCompatible_Level9", ext: "jpg" }
  },
  {
    id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
    name: "VIIRS NOAA-20 True Color",
    platform: "NOAA-20",
    kind: "polar",
    cadence: "daily",
    resolution: "250 m",
    description: "Global daily mosaic.",
    center: null,
    offline: { tms: "GoogleMapsCompatible_Level9", ext: "jpg" }
  },
  {
    id: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    name: "VIIRS Suomi-NPP True Color",
    platform: "Suomi NPP",
    kind: "polar",
    cadence: "daily",
    resolution: "250 m",
    description: "Global daily mosaic.",
    center: null,
    offline: { tms: "GoogleMapsCompatible_Level9", ext: "jpg" }
  },
  {
    id: "MODIS_Terra_CorrectedReflectance_TrueColor",
    name: "MODIS Terra True Color",
    platform: "Terra",
    kind: "polar",
    cadence: "daily",
    resolution: "250 m",
    description: "Global daily mosaic (morning pass).",
    center: null,
    offline: { tms: "GoogleMapsCompatible_Level9", ext: "jpg" }
  },
  {
    id: "MODIS_Aqua_CorrectedReflectance_TrueColor",
    name: "MODIS Aqua True Color",
    platform: "Aqua",
    kind: "polar",
    cadence: "daily",
    resolution: "250 m",
    description: "Global daily mosaic (afternoon pass).",
    center: null,
    offline: { tms: "GoogleMapsCompatible_Level9", ext: "jpg" }
  }
];

type CapsEntry = { title: string; tms: string; ext: string; latest: string | null };

const decode = (s: string) => s.replace(/&amp;/g, "&").trim();

/** Extract the layers we care about from a WMTS GetCapabilities document. */
export function parseGibsCapabilities(xml: string, ids: string[]): Record<string, CapsEntry> {
  const found: Record<string, CapsEntry> = {};

  for (const id of ids) {
    const marker = `<ows:Identifier>${id}</ows:Identifier>`;
    const at = xml.indexOf(marker);
    if (at < 0) continue;

    const end = xml.indexOf("</Layer>", at);
    const block = xml.slice(at, end < 0 ? at + 8000 : end);

    const title = /<ows:Title[^>]*>([^<]*)<\/ows:Title>/.exec(xml.slice(Math.max(0, at - 400), at + 200))?.[1];
    const format = /<Format>([^<]+)<\/Format>/.exec(block)?.[1] || "image/png";
    const tms = /<TileMatrixSetLink>\s*<TileMatrixSet>([^<]+)<\/TileMatrixSet>/.exec(block)?.[1];
    const latest = /<Dimension>[\s\S]*?<Default>([^<]+)<\/Default>/.exec(block)?.[1] || null;

    if (!tms) continue;

    found[id] = {
      title: decode(title || id),
      tms: tms.trim(),
      ext: format.includes("jpeg") || format.includes("jpg") ? "jpg" : "png",
      latest: latest ? latest.trim() : null
    };
  }

  return found;
}

let capsCache: { at: number; data: Record<string, CapsEntry>; ok: boolean; detail: string } = {
  at: 0,
  data: {},
  ok: false,
  detail: "not loaded"
};

async function loadCapabilities(force = false) {
  if (!force && Date.now() - capsCache.at < 10 * 60 * 1000) return capsCache;

  try {
    const response = await fetch(CAPS_URL, {
      headers: { "User-Agent": "SHADOWBROKER/3.0", Accept: "application/xml" },
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const xml = await response.text();
    const data = parseGibsCapabilities(xml, CANDIDATES.map(c => c.id));

    capsCache = {
      at: Date.now(),
      data,
      ok: Object.keys(data).length > 0,
      detail: `NASA GIBS - ${Object.keys(data).length}/${CANDIDATES.length} layers found`
    };
  } catch (err) {
    capsCache = {
      at: Date.now() - 8 * 60 * 1000,      // retry in ~2 min
      data: capsCache.data,
      ok: false,
      detail: `GIBS capabilities unavailable: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  return capsCache;
}

export function buildTileUrl(id: string, time: string | null, tms: string, ext: string) {
  return `${GIBS}/${id}/default/${time || "default"}/${tms}/{z}/{y}/{x}.${ext}`;
}

export async function getSatelliteLayers(): Promise<{
  layers: SatelliteLayerInfo[];
  ok: boolean;
  detail: string;
  updatedAt: string;
}> {
  const caps = await loadCapabilities();
  const layers: SatelliteLayerInfo[] = [];

  for (const c of CANDIDATES) {
    const entry = caps.data[c.id];

    if (!entry && (caps.ok || !c.offline)) continue;   // GIBS does not list it -> do not offer it

    const tms = entry?.tms || c.offline!.tms;
    const ext = entry?.ext || c.offline!.ext;
    const level = Number(/Level(\d+)/.exec(tms)?.[1] ?? 7);

    layers.push({
      id: c.id,
      name: c.name,
      platform: c.platform,
      kind: c.kind,
      cadence: c.cadence,
      resolution: c.resolution,
      description: c.description,
      tiles: buildTileUrl(c.id, entry?.latest || null, tms, ext),
      tileSize: 256,
      maxzoom: level,
      latest: entry?.latest || null,
      center: c.center,
      available: true
    });
  }

  return { layers, ok: layers.length > 0, detail: caps.detail, updatedAt: new Date(caps.at).toISOString() };
}

/* ---------------------------------------------------------------- Sentinel-2 */

const sceneCache = new Map<string, { at: number; scenes: SatelliteScene[]; detail: string }>();

export function sceneTileTemplate(id: string) {
  return (
    `${PC_DATA}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=sentinel-2-l2a&item=${encodeURIComponent(id)}` +
    `&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&format=png`
  );
}

export function scenePreviewUrl(id: string) {
  return (
    `${PC_DATA}/preview.png?collection=sentinel-2-l2a&item=${encodeURIComponent(id)}` +
    `&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&format=png`
  );
}

export function parseStacItems(items: any[]): SatelliteScene[] {
  const newestPerTile = new Map<string, SatelliteScene>();

  for (const item of items) {
    const id = String(item?.id || "");
    const props = item?.properties || {};
    const bbox = item?.bbox as number[] | undefined;
    if (!id || !bbox || bbox.length < 4 || !props.datetime) continue;

    const ring = item?.geometry?.coordinates?.[0] as [number, number][] | undefined;

    const scene: SatelliteScene = {
      id,
      collection: String(item.collection || "sentinel-2-l2a"),
      datetime: String(props.datetime),
      platform: String(props.platform || "Sentinel-2"),
      cloud: typeof props["eo:cloud_cover"] === "number" ? Math.round(props["eo:cloud_cover"] * 10) / 10 : null,
      bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
      center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
      footprint: Array.isArray(ring) ? ring.map(p => [p[0], p[1]] as [number, number]) : [],
      tiles: sceneTileTemplate(id),
      preview: scenePreviewUrl(id),
      link: `https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(id)}`,
      tile: props["s2:mgrs_tile"] ? String(props["s2:mgrs_tile"]) : null
    };

    const key = scene.tile || id;
    const prev = newestPerTile.get(key);
    if (!prev || prev.datetime < scene.datetime) newestPerTile.set(key, scene);
  }

  return [...newestPerTile.values()].sort((a, b) => b.datetime.localeCompare(a.datetime));
}

export async function getScenes(bbox: [number, number, number, number], hours: number, maxCloud: number, limit: number) {
  const round = (n: number) => Math.round(n * 2) / 2;
  const key = [...bbox.map(round), hours, maxCloud, limit].join("|");
  const hit = sceneCache.get(key);

  if (hit && Date.now() - hit.at < 120000) return { scenes: hit.scenes, detail: hit.detail, ok: true };

  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);

  const body = {
    collections: ["sentinel-2-l2a"],
    bbox,
    datetime: `${start.toISOString()}/${end.toISOString()}`,
    query: { "eo:cloud_cover": { lt: maxCloud } },
    sortby: [{ field: "datetime", direction: "desc" }],
    limit
  };

  try {
    const response = await fetch(PC_STAC, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/geo+json", "User-Agent": "SHADOWBROKER/3.0" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as { features?: any[] };
    const scenes = parseStacItems(data.features || []);
    const detail = `Sentinel-2 L2A via Planetary Computer - ${scenes.length} scenes (last ${hours} h)`;

    sceneCache.set(key, { at: Date.now(), scenes, detail });
    if (sceneCache.size > 200) sceneCache.delete(sceneCache.keys().next().value as string);

    return { scenes, detail, ok: true };
  } catch (err) {
    return {
      scenes: hit?.scenes || [],
      detail: `Sentinel-2 search failed: ${err instanceof Error ? err.message : String(err)}`,
      ok: false
    };
  }
}

export async function satelliteStatus() {
  const caps = await loadCapabilities();

  return {
    "NASA GIBS imagery": { status: caps.ok ? "public" : "offline", detail: caps.detail },
    "Sentinel-2 (Planetary Computer)": {
      status: "public",
      detail: "STAC search + tiler, queried on demand (no key)"
    }
  };
}

export const satelliteInternals = { parseGibsCapabilities, parseStacItems, CANDIDATES };
