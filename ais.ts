// Maritime tracking from two open sources, merged by MMSI:
//
//  1. AISStream.io  - global, free API key, WebSocket (server side only).
//                     Needs AISSTREAM_API_KEY. Terrestrial AIS: coverage is
//                     good near coasts, thin in the open ocean.
//  2. Digitraffic   - Finland's open AIS feed (CC BY 4.0), NO key. Covers the
//                     Baltic Sea / Gulf of Finland / Gulf of Bothnia.
//                     https://meri.digitraffic.fi/api/ais/v1/locations (+ /vessels metadata)
//
// Ship colours / icons are driven by the AIS ship-type code (ITU-R M.1371):
//   30 fishing, 31-32/52 tug, 35 military, 36 sailing, 37 pleasure,
//   40-49 high-speed craft, 55 law enforcement, 60-69 passenger,
//   70-79 cargo, 80-89 tanker.

import WebSocket from "ws";
import type { Vessel, VesselCategory } from "./types";

const STREAM_URL = process.env.AISSTREAM_URL || "wss://stream.aisstream.io/v0/stream";
const MAX_AGE_MS = (Number(process.env.AIS_MAX_AGE_MINUTES) || 30) * 60 * 1000;
const MAX_VESSELS = Number(process.env.AIS_MAX_VESSELS) || 15000;
const WATCHDOG_MS = 90 * 1000;
const DIGITRAFFIC = "https://meri.digitraffic.fi/api/ais/v1";

type StoredVessel = Vessel & { updatedAt: number };

type StaticInfo = {
  name?: string;
  type?: number | null;
  destination?: string;
  imo?: number | null;
};

const vessels = new Map<string, StoredVessel>();
const statics = new Map<string, StaticInfo>();

const state = {
  aisstream: { status: "offline", detail: "not started", lastMessageAt: 0, received: 0 },
  digitraffic: { status: "offline", detail: "not started", count: 0, updatedAt: 0 }
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export function shipCategory(type: number | null | undefined, name = ""): VesselCategory {
  if (/^(USS|USNS|HMS|HMAS|HMCS|HNLMS|FGS|FS|ITS|INS|ROKS|JS|PLAN|RFS)\s/i.test(name.trim())) {
    return "military";
  }

  if (type === null || type === undefined) return "other";
  if (type === 35 || type === 55) return "military";
  if (type === 30) return "fishing";
  if (type === 31 || type === 32 || type === 52 || type === 33) return "tug";
  if (type === 36 || type === 37) return "sailing";
  if (type >= 40 && type <= 49) return "passenger";
  if (type >= 60 && type <= 69) return "passenger";
  if (type >= 70 && type <= 79) return "cargo";
  if (type >= 80 && type <= 89) return "tanker";

  return "other";
}

function upsert(input: {
  mmsi: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  course: number | null;
  name?: string;
  source: string;
  time?: number;
}) {
  const lat = input.latitude;
  const lon = input.longitude;

  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  if (lat === 0 && lon === 0) return;

  const info = statics.get(input.mmsi);
  const previous = vessels.get(input.mmsi);
  const name = (input.name || info?.name || previous?.name || "").trim();
  const shipType = info?.type ?? previous?.shipType ?? null;

  vessels.set(input.mmsi, {
    mmsi: input.mmsi,
    name: name || `MMSI ${input.mmsi}`,
    longitude: lon,
    latitude: lat,
    speed: input.speed,
    heading: input.heading,
    course: input.course,
    destination: info?.destination || previous?.destination,
    shipType,
    category: shipCategory(shipType, name),
    source: input.source,
    updatedAt: input.time || Date.now()
  });
}

function setStatic(mmsi: string, info: StaticInfo) {
  statics.set(mmsi, { ...statics.get(mmsi), ...info });

  const v = vessels.get(mmsi);
  if (v) {
    const merged = statics.get(mmsi)!;
    v.name = merged.name || v.name;
    v.shipType = merged.type ?? v.shipType;
    v.destination = merged.destination || v.destination;
    v.category = shipCategory(v.shipType, v.name);
  }
}

/* ------------------------------------------------------------------ AISStream */

let socket: WebSocket | null = null;
let started = false;
let backoff = 2000;
let reconnectTimer: NodeJS.Timeout | null = null;

function boundingBoxes() {
  const raw = process.env.AIS_BBOX;

  if (raw) {
    const p = raw.split(",").map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) return [[[p[0], p[1]], [p[2], p[3]]]];
  }

  return [[[-90, -180], [90, 180]]];
}

function handleAisStream(message: any) {
  const s = state.aisstream;

  if (message?.error) {
    s.status = "offline";
    s.detail = `AISStream error: ${message.error}`;
    socket?.close();
    return;
  }

  const type = message?.MessageType as string | undefined;
  const meta = message?.MetaData || {};
  if (!type) return;

  if (type === "ShipStaticData") {
    const d = message.Message?.ShipStaticData;
    if (!d) return;

    const mmsi = String(d.UserID ?? meta.MMSI ?? "").trim();
    if (!mmsi) return;

    setStatic(mmsi, {
      name: String(d.Name || meta.ShipName || "").trim() || undefined,
      type: num(d.Type),
      destination: String(d.Destination || "").trim() || undefined,
      imo: num(d.ImoNumber)
    });

    s.lastMessageAt = Date.now();
    return;
  }

  const report =
    message.Message?.PositionReport ||
    message.Message?.StandardClassBPositionReport ||
    message.Message?.ExtendedClassBPositionReport;

  if (!report) return;

  const lat = num(report.Latitude ?? meta.latitude);
  const lon = num(report.Longitude ?? meta.longitude);
  if (lat === null || lon === null) return;     // AIS 91/181 "not available" is rejected in upsert

  const mmsi = String(report.UserID ?? meta.MMSI ?? "").trim();
  if (!mmsi) return;

  if (type === "ExtendedClassBPositionReport" && report.Type !== undefined) {
    setStatic(mmsi, { type: num(report.Type), name: String(report.Name || "").trim() || undefined });
  }

  const sog = num(report.Sog);
  const trueHeading = num(report.TrueHeading);
  const course = num(report.Cog);

  let heading: number | null = null;
  if (trueHeading !== null && trueHeading < 360) heading = trueHeading;
  else if (course !== null && course < 360) heading = course;

  upsert({
    mmsi,
    latitude: lat,
    longitude: lon,
    speed: sog === null || sog >= 102.3 ? null : sog,
    heading,
    course,
    name: String(meta.ShipName || "").trim(),
    source: "AISStream"
  });

  s.received += 1;
  s.lastMessageAt = Date.now();
  s.status = "online";
  s.detail = `AISStream - ${s.received} messages - ${vessels.size} vessels tracked`;
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectAisStream();
  }, backoff);

  backoff = Math.min(backoff * 2, 60000);
}

function connectAisStream() {
  const key = process.env.AISSTREAM_API_KEY;
  const s = state.aisstream;

  if (!key) {
    s.status = "needs_credentials";
    s.detail = "Set AISSTREAM_API_KEY (free at aisstream.io) for global coverage";
    return;
  }

  s.status = "offline";
  s.detail = "connecting to AISStream...";

  const ws = new WebSocket(STREAM_URL);
  socket = ws;

  ws.on("open", () => {
    // Must arrive within 3 seconds of connecting
    ws.send(
      JSON.stringify({
        APIKey: key,
        BoundingBoxes: boundingBoxes(),
        FilterMessageTypes: [
          "PositionReport",
          "StandardClassBPositionReport",
          "ExtendedClassBPositionReport",
          "ShipStaticData"
        ]
      })
    );

    backoff = 2000;
    s.detail = "connected, waiting for first positions...";
  });

  ws.on("message", (data: WebSocket.RawData) => {
    try {
      handleAisStream(JSON.parse(data.toString()));
    } catch {
      // ignore malformed frames
    }
  });

  ws.on("error", (err: Error) => {
    s.status = "offline";
    s.detail = `AISStream connection error: ${err.message}`;
  });

  ws.on("close", (code: number) => {
    if (socket === ws) socket = null;

    s.status = "offline";
    if (!s.detail.startsWith("AISStream error")) {
      s.detail = `AISStream disconnected (code ${code}), retrying...`;
    }

    scheduleReconnect();
  });
}

/* ----------------------------------------------------------------- Digitraffic */

const dtHeaders = {
  "Digitraffic-User": process.env.DIGITRAFFIC_USER || "SHADOWBROKER/3.0",
  "Accept-Encoding": "gzip",
  Accept: "application/json"
};

export function parseDigitrafficLocations(data: any) {
  const out: {
    mmsi: string;
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number | null;
    course: number | null;
    time: number;
  }[] = [];

  for (const f of data?.features || []) {
    const coords = f?.geometry?.coordinates;
    const p = f?.properties || {};
    const mmsi = String(f?.mmsi ?? p.mmsi ?? "").trim();
    if (!mmsi || !Array.isArray(coords)) continue;

    const lon = num(coords[0]);
    const lat = num(coords[1]);
    if (lat === null || lon === null) continue;

    const sog = num(p.sog);
    const cog = num(p.cog);
    const th = num(p.heading);

    let heading: number | null = null;
    if (th !== null && th < 360) heading = th;
    else if (cog !== null && cog < 360) heading = cog;

    out.push({
      mmsi,
      latitude: lat,
      longitude: lon,
      speed: sog === null || sog >= 102.3 ? null : sog,
      heading,
      course: cog,
      time: num(p.timestampExternal) ?? (num(p.timestamp) ? (num(p.timestamp) as number) * 1000 : Date.now())
    });
  }

  return out;
}

async function refreshDigitrafficMetadata() {
  try {
    const response = await fetch(`${DIGITRAFFIC}/vessels`, {
      headers: dtHeaders,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const list = (await response.json()) as any[];

    for (const v of list) {
      const mmsi = String(v.mmsi ?? "").trim();
      if (!mmsi) continue;

      setStatic(mmsi, {
        name: String(v.name || "").trim() || undefined,
        type: num(v.shipType),
        destination: String(v.destination || "").trim() || undefined,
        imo: num(v.imo)
      });
    }
  } catch (err) {
    state.digitraffic.detail = `metadata unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function refreshDigitraffic() {
  const s = state.digitraffic;

  try {
    const response = await fetch(`${DIGITRAFFIC}/locations`, {
      headers: dtHeaders,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rows = parseDigitrafficLocations(await response.json());
    const cutoff = Date.now() - MAX_AGE_MS;
    let used = 0;

    for (const row of rows) {
      if (row.time < cutoff) continue;

      const existing = vessels.get(row.mmsi);
      // Do not overwrite a fresher AISStream position
      if (existing && existing.source === "AISStream" && existing.updatedAt > row.time) continue;

      upsert({ ...row, source: "Digitraffic" });
      used += 1;
    }

    s.status = "online";
    s.count = used;
    s.updatedAt = Date.now();
    s.detail = `Digitraffic (Baltic, no key) - ${used} vessels`;
  } catch (err) {
    s.status = "offline";
    s.detail = `Digitraffic unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/* ------------------------------------------------------------------ lifecycle */

function maintenance() {
  const now = Date.now();

  for (const [mmsi, vessel] of vessels) {
    if (now - vessel.updatedAt > MAX_AGE_MS) vessels.delete(mmsi);
  }

  if (vessels.size > MAX_VESSELS * 1.3) {
    const newest = [...vessels.entries()]
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_VESSELS);

    vessels.clear();
    newest.forEach(([k, v]) => vessels.set(k, v));
  }

  if (statics.size > 200000) statics.clear();

  const s = state.aisstream;
  if (
    socket &&
    socket.readyState === WebSocket.OPEN &&
    s.lastMessageAt &&
    now - s.lastMessageAt > WATCHDOG_MS
  ) {
    socket.terminate();
  }
}

export function startAis() {
  if (started) return;
  started = true;

  connectAisStream();

  void refreshDigitrafficMetadata().then(refreshDigitraffic);
  setInterval(() => void refreshDigitraffic(), 60 * 1000).unref();
  setInterval(() => void refreshDigitrafficMetadata(), 30 * 60 * 1000).unref();
  setInterval(maintenance, 30000).unref();
}

export function getVessels() {
  const now = Date.now();

  const items = [...vessels.values()]
    .filter(v => now - v.updatedAt <= MAX_AGE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_VESSELS);

  const parts = [
    `AISStream: ${state.aisstream.status === "online" ? "online" : state.aisstream.detail}`,
    `Digitraffic: ${state.digitraffic.status}`
  ];

  return {
    items,
    status: items.length ? "online" : state.aisstream.status,
    detail: `${items.length} vessels - ${parts.join(" - ")}`
  };
}

export function aisStatus() {
  return {
    "AISStream.io": { status: state.aisstream.status, detail: state.aisstream.detail },
    "Digitraffic AIS (Baltic)": {
      status: state.digitraffic.status === "online" ? "public" : state.digitraffic.status,
      detail: state.digitraffic.detail
    }
  };
}
