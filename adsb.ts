// Aircraft: global ADS-B sweep over several open community APIs (+ optional OpenSky).
//
// WHY THE OLD VERSION LOOKED WRONG
//   Every ADS-B aggregator only knows about aircraft that a volunteer ground
//   receiver heard, so coverage is naturally dense in Europe / USA and thin
//   over oceans, Africa and Central Asia. On top of that, the first version
//   queried only ~60 circles (max 250 nm each), which left big areas of the
//   map with NO query at all. This version tiles the traffic-bearing parts of
//   the globe with a hex lattice of 250 nm circles, spreads the cells over
//   three independent networks, adds each network's global military feed, and
//   optionally merges OpenSky's one-call global snapshot.
//
// Sources (all free, no key):
//   adsb.lol        https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{nm}   , /v2/mil
//   adsb.fi         https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm} , /v2/mil   (1 req/s)
//   airplanes.live  https://api.airplanes.live/v2/point/{lat}/{lon}/{nm} , /v2/mil            (1 req/s)
//   OpenSky         https://opensky-network.org/api/states/all  (anonymous: 400 credits/day;
//                   OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET raise that to 4000)

import type { Flight, FlightCategory } from "./types";

const RADIUS_NM = 250;
const MAX_AIRCRAFT = Number(process.env.ADSB_MAX_AIRCRAFT) || 20000;
const STALE_MS = 6 * 60 * 1000;
const MAX_POSITION_AGE_S = 150;
const MIN_SWEEP_GAP_MS = 20 * 1000;

type Provider = {
  name: string;
  pointUrl: (lat: number, lon: number, nm: number) => string;
  milUrl: string;
  gapMs: number;           // minimum delay between two requests to this provider
  lastRequest: number;
  failures: number;        // consecutive failures
  pausedUntil: number;
  ok: number;
  failed: number;
  lastError: string;
};

type ProviderDef = Pick<Provider, "name" | "pointUrl" | "milUrl" | "gapMs">;

const PROVIDER_DEFS: ProviderDef[] = [
  {
    name: "adsb.lol",
    pointUrl: (la, lo, nm) => `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/${nm}`,
    milUrl: "https://api.adsb.lol/v2/mil",
    gapMs: 350
  },
  {
    name: "adsb.fi",
    pointUrl: (la, lo, nm) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${nm}`,
    milUrl: "https://opendata.adsb.fi/api/v2/mil",
    gapMs: 1150
  },
  {
    name: "airplanes.live",
    pointUrl: (la, lo, nm) => `https://api.airplanes.live/v2/point/${la}/${lo}/${nm}`,
    milUrl: "https://api.airplanes.live/v2/mil",
    gapMs: 1150
  }
];

const providers: Provider[] = PROVIDER_DEFS.map(p => ({
  ...p,
  lastRequest: 0,
  failures: 0,
  pausedUntil: 0,
  ok: 0,
  failed: 0,
  lastError: ""
}));

// Regions that carry air traffic. Cells whose centre is outside every box are
// skipped (open ocean, polar caps) so the sweep stays affordable.
const TRAFFIC_BOXES: [number, number, number, number][] = [
  // [latMin, latMax, lonMin, lonMax]
  [7, 72, -170, -50],      // North & Central America, Caribbean, Alaska
  [14, 26, -165, -150],    // Hawaii
  [38, 64, -52, -8],       // North Atlantic corridor
  [-56, 13, -82, -34],     // South America
  [5, 72, -12, 150],       // Europe, Middle East, Russia, Asia
  [28, 70, 150, 180],      // Japan / Kamchatka
  [-35, 38, -18, 52],      // Africa
  [-12, 25, 90, 150],      // SE Asia
  [-48, -10, 110, 180],    // Australia / New Zealand
  [-35, 25, 52, 90]        // Indian Ocean routes
];

// Almost-empty airspace inside the boxes above (Arctic Canada / Greenland,
// northern Siberia, central Sahara): skipped to save requests.
const EMPTY_BOXES: [number, number, number, number][] = [
  [62, 72, -135, -50],
  [64, 72, 60, 180],
  [17, 27, -10, 28]
];

function inTraffic(lat: number, lon: number) {
  const box = ([a, b, c, d]: [number, number, number, number]) => lat >= a && lat <= b && lon >= c && lon <= d;
  return TRAFFIC_BOXES.some(box) && !EMPTY_BOXES.some(box);
}

/** Hex lattice of 250 nm circles (row step 1.5 r, column step sqrt(3) r). */
function buildCells(): [number, number][] {
  const r = (RADIUS_NM * 1.852) / 111.19;       // radius in degrees of latitude
  const rowStep = 1.5 * r * 0.97;               // slight overlap
  const cells: [number, number][] = [];
  let row = 0;

  for (let lat = -56; lat <= 72; lat += rowStep, row++) {
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.25);
    const colStep = (Math.sqrt(3) * r * 0.97) / cosLat;
    const offset = row % 2 ? colStep / 2 : 0;

    for (let lon = -180 + offset; lon < 180; lon += colStep) {
      const la = Math.round(lat * 10) / 10;
      const lo = Math.round(lon * 10) / 10;
      if (inTraffic(la, lo)) cells.push([la, lo]);
    }
  }

  return cells;
}

const CELLS = buildCells();

type Stored = Flight & { seenAt: number; posAge: number; source: string };

const aircraft = new Map<string, Stored>();
const militaryHex = new Set<string>();

const stats = {
  sweeps: 0,
  lastSweepMs: 0,
  lastSweepAt: 0,
  cellsOk: 0,
  cellsFailed: 0,
  militaryCount: 0,
  openSky: "not used yet",
  running: false
};

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const FT_TO_M = 0.3048;
const KT_TO_MS = 0.514444;

export function classifyAircraft(input: {
  military?: boolean;
  squawk?: string | null;
  emergency?: string | null;
  category?: string | null;      // ADS-B emitter category A0..A7, B*, C*
  callsign?: string;
}): FlightCategory {
  if (input.military) return "military";

  const sq = input.squawk || "";
  if (sq === "7500" || sq === "7600" || sq === "7700") return "emergency";
  if (input.emergency && input.emergency !== "none") return "emergency";

  const cat = (input.category || "").toUpperCase();
  if (cat === "A7") return "helicopter";

  const cs = (input.callsign || "").trim().toUpperCase();
  // Airline style callsign: 3 letters + digits (e.g. RYR123, UAE9AB)
  if (/^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/.test(cs)) return "commercial";
  if (cat === "A3" || cat === "A4" || cat === "A5") return "commercial";

  return "private";
}

function normalize(ac: Record<string, unknown>, source: string): Stored | null {
  // Number(null) === 0, so null/undefined are rejected BEFORE conversion.
  const lat = num(ac.lat);
  const lon = num(ac.lon);

  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;

  const hex = String(ac.hex || "").trim().toLowerCase().replace(/^~/, "");
  if (!hex) return null;

  const posAge = num(ac.seen_pos) ?? num(ac.seen) ?? 0;
  if (posAge > MAX_POSITION_AGE_S) return null;

  const onGround = ac.alt_baro === "ground";
  const altFt = onGround ? 0 : num(ac.alt_baro);
  const gs = num(ac.gs);
  const flags = num(ac.dbFlags) ?? 0;
  const callsign = String(ac.flight || "").trim();
  const squawk = ac.squawk ? String(ac.squawk) : null;

  return {
    icao24: hex,
    callsign,
    originCountry: "",
    longitude: lon,
    latitude: lat,
    altitude: altFt === null ? null : Math.round(altFt * FT_TO_M),
    velocity: gs === null ? null : Math.round(gs * KT_TO_MS),
    heading: num(ac.track),
    registration: ac.r ? String(ac.r) : null,
    aircraftType: ac.t ? String(ac.t) : null,
    onGround,
    squawk,
    category: classifyAircraft({
      military: (flags & 1) === 1 || militaryHex.has(hex),
      squawk,
      emergency: ac.emergency ? String(ac.emergency) : null,
      category: ac.category ? String(ac.category) : null,
      callsign
    }),
    seenAt: Date.now(),
    posAge,
    source
  };
}

function ingest(list: Record<string, unknown>[], source: string) {
  for (const raw of list) {
    const flight = normalize(raw, source);
    if (!flight) continue;

    const previous = aircraft.get(flight.icao24);

    // Keep whichever report has the fresher position
    if (!previous || flight.posAge <= previous.posAge || Date.now() - previous.seenAt > 60000) {
      aircraft.set(flight.icao24, flight);
    }
  }
}

async function throttled(provider: Provider) {
  const wait = provider.lastRequest + provider.gapMs - Date.now();
  provider.lastRequest = Math.max(Date.now(), provider.lastRequest + provider.gapMs);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

async function getJson(provider: Provider, url: string) {
  await throttled(provider);

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "SHADOWBROKER/3.0 (open-source dashboard)" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return (await response.json()) as { ac?: Record<string, unknown>[] };
}

function markFailure(provider: Provider, error: unknown) {
  provider.failed += 1;
  provider.failures += 1;
  provider.lastError = error instanceof Error ? error.message : String(error);

  if (provider.failures >= 3) {
    // exponential back-off, max 5 minutes
    provider.pausedUntil = Date.now() + Math.min(300000, 15000 * 2 ** (provider.failures - 3));
  }
}

function markSuccess(provider: Provider) {
  provider.ok += 1;
  provider.failures = 0;
  provider.pausedUntil = 0;
}

type Job = { cell: [number, number]; tries: number };

async function sweep() {
  if (stats.running) return;
  stats.running = true;

  const started = Date.now();
  const queue: Job[] = CELLS.map(cell => ({ cell, tries: 0 }));
  let ok = 0;
  let failed = 0;

  const worker = async (provider: Provider) => {
    while (queue.length) {
      if (Date.now() < provider.pausedUntil) {
        // this provider is cooling down; let the others drain the queue
        await new Promise(r => setTimeout(r, 2000));
        if (providers.every(p => Date.now() < p.pausedUntil)) return;
        continue;
      }

      const job = queue.shift();
      if (!job) return;

      try {
        const data = await getJson(provider, provider.pointUrl(job.cell[0], job.cell[1], RADIUS_NM));
        ingest(Array.isArray(data.ac) ? data.ac : [], provider.name);
        markSuccess(provider);
        ok += 1;
      } catch (err) {
        markFailure(provider, err);

        if (job.tries < 2) queue.push({ cell: job.cell, tries: job.tries + 1 });
        else failed += 1;
      }
    }
  };

  try {
    await Promise.all(providers.map(worker));
  } finally {
    const now = Date.now();

    for (const [hex, flight] of aircraft) {
      if (now - flight.seenAt > STALE_MS) aircraft.delete(hex);
    }

    stats.sweeps += 1;
    stats.lastSweepAt = now;
    stats.lastSweepMs = now - started;
    stats.cellsOk = ok;
    stats.cellsFailed = failed + queue.length;
    stats.running = false;
  }
}

/** Global military feed (one call per provider, rotated). */
let milTurn = 0;

async function refreshMilitary() {
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[(milTurn + i) % providers.length];
    if (Date.now() < provider.pausedUntil) continue;

    try {
      const data = await getJson(provider, provider.milUrl);
      const list = Array.isArray(data.ac) ? data.ac : [];

      militaryHex.clear();
      for (const ac of list) {
        const hex = String(ac.hex || "").toLowerCase().replace(/^~/, "");
        if (hex) militaryHex.add(hex);
      }

      // Force the flag + make sure military aircraft outside swept cells appear
      for (const raw of list) raw.dbFlags = (num(raw.dbFlags) ?? 0) | 1;
      ingest(list, provider.name);

      for (const hex of militaryHex) {
        const flight = aircraft.get(hex);
        if (flight) flight.category = "military";
      }

      stats.militaryCount = militaryHex.size;
      markSuccess(provider);
      milTurn = (milTurn + i + 1) % providers.length;
      return;
    } catch (err) {
      markFailure(provider, err);
    }
  }
}

/* ------------------------------------------------------------------ OpenSky */

let openSkyToken: { value: string; expires: number } | null = null;

async function openSkyAuth(): Promise<string | null> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (openSkyToken && openSkyToken.expires > Date.now() + 30000) return openSkyToken.value;

  const response = await fetch(
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) throw new Error(`OpenSky auth HTTP ${response.status}`);

  const data = (await response.json()) as { access_token: string; expires_in?: number };
  openSkyToken = {
    value: data.access_token,
    expires: Date.now() + (data.expires_in || 300) * 1000
  };

  return openSkyToken.value;
}

async function refreshOpenSky() {
  try {
    const token = await openSkyAuth();

    const response = await fetch("https://opensky-network.org/api/states/all", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as { states?: unknown[][] };
    let added = 0;

    for (const s of data.states || []) {
      const lon = num(s[5]);
      const lat = num(s[6]);
      if (lon === null || lat === null) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;

      const hex = String(s[0] || "").toLowerCase();
      if (!hex || num(s[3]) === null) continue;

      const age = Math.max(0, Math.floor(Date.now() / 1000) - (num(s[3]) as number));
      if (age > MAX_POSITION_AGE_S) continue;

      const existing = aircraft.get(hex);
      // ADS-B network data is richer; OpenSky only fills gaps / adds country
      if (existing) {
        if (!existing.originCountry) existing.originCountry = String(s[2] || "");
        continue;
      }

      const callsign = String(s[1] || "").trim();
      const squawk = s[14] ? String(s[14]) : null;
      const cat = num(s[17]);

      aircraft.set(hex, {
        icao24: hex,
        callsign,
        originCountry: String(s[2] || ""),
        longitude: lon,
        latitude: lat,
        altitude: num(s[13]) ?? num(s[7]),
        velocity: num(s[9]),
        heading: num(s[10]),
        onGround: s[8] === true,
        squawk,
        category: classifyAircraft({
          military: militaryHex.has(hex),
          squawk,
          category: cat === 8 ? "A7" : cat !== null && cat >= 4 && cat <= 6 ? "A4" : null,
          callsign
        }),
        seenAt: Date.now(),
        posAge: age,
        source: "OpenSky"
      });

      added += 1;
    }

    stats.openSky = `OK - ${added} extra aircraft${token ? " (OAuth)" : " (anonymous)"}`;
  } catch (err) {
    stats.openSky = `unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/* ------------------------------------------------------------------- public */

export function getFlights() {
  const items = [...aircraft.values()]
    .filter(f => Date.now() - f.seenAt <= STALE_MS)
    .slice(0, MAX_AIRCRAFT)
    .map(({ seenAt, posAge, source, ...flight }) => flight as Flight);

  const sourceCounts: Record<string, number> = {};
  aircraft.forEach(f => (sourceCounts[f.source] = (sourceCounts[f.source] || 0) + 1));

  const summary = providers
    .map(p => `${p.name} ${p.ok}ok/${p.failed}err${Date.now() < p.pausedUntil ? " (paused)" : ""}`)
    .join(", ");

  const ok = items.length > 0;

  return {
    items,
    ok,
    detail: stats.sweeps === 0 && !ok
      ? `first sweep in progress (${CELLS.length} cells)...`
      : `${items.length} aircraft - sweep ${Math.round(stats.lastSweepMs / 1000)}s, ` +
        `${stats.cellsOk}/${CELLS.length} cells - ${stats.militaryCount} military - ${summary}`,
    sourceCounts
  };
}

export function startAdsb() {
  const loop = async () => {
    try {
      await refreshMilitary();
      await sweep();
    } catch (err) {
      console.error("ADS-B sweep failed:", err);
    } finally {
      setTimeout(loop, MIN_SWEEP_GAP_MS);
    }
  };

  void loop();

  const hasCredentials = Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);
  const interval = hasCredentials ? 120 * 1000 : 20 * 60 * 1000;

  void refreshOpenSky();
  setInterval(() => void refreshOpenSky(), interval).unref();
  setInterval(() => void refreshMilitary(), 90 * 1000).unref();
}

export function adsbStatus() {
  const data = getFlights();

  return {
    "ADS-B network sweep": {
      status: data.ok ? "online" : stats.sweeps === 0 ? "offline" : "unavailable",
      detail: data.detail
    },
    OpenSky: {
      status: stats.openSky.startsWith("OK") ? "online" : "offline",
      detail: stats.openSky
    }
  };
}

export const adsbInternals = { CELLS, normalize, classifyAircraft };
