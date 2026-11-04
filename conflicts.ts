// Conflict and protest events from the GDELT 2.0 Event Database.
//
// GDELT publishes a new tab-separated export every 15 minutes (open data, no key):
//   https://data.gdeltproject.org/gdeltv2/lastupdate.txt
//   https://data.gdeltproject.org/gdeltv2/YYYYMMDDHHMMSS.export.CSV.zip
//
// Column indexes (GDELT 2.0 event codebook, 0-based):
//   0 GLOBALEVENTID  26 EventCode  28 EventRootCode  29 QuadClass  30 GoldsteinScale
//   31 NumMentions   32 NumSources 33 NumArticles    34 AvgTone
//   51 ActionGeo_Type (1 country, 2 US state, 3 US city, 4 world city, 5 world ADM1)
//   52 ActionGeo_FullName  53 ActionGeo_CountryCode  56 ActionGeo_Lat  57 ActionGeo_Long
//   59 DATEADDED   60 SOURCEURL
//
// CAMEO root codes used:  14 = Protest   18 = Assault   19 = Fight   20 = Mass violence
//
// Accuracy note: GDELT geocodes the PLACE MENTIONED in the article. Country-level
// matches (type 1/2) would stack on a country centroid, which is exactly the
// kind of fake cluster you do not want, so only city / ADM1 matches are kept.

import { unzipSync } from "fflate";
import type { ConflictCluster, ConflictKind } from "./types";

const BASE = "https://data.gdeltproject.org/gdeltv2";
const WINDOW_MS = (Number(process.env.GDELT_WINDOW_HOURS) || 24) * 3600 * 1000;
const BACKFILL_FILES = Number(process.env.GDELT_BACKFILL_FILES) || 32;   // 32 x 15 min = 8 h
const MAX_CLUSTERS = 2500;

type RawEvent = {
  id: string;
  kind: ConflictKind;
  code: string;
  lat: number;
  lon: number;
  place: string;
  country: string;
  geoType: number;
  mentions: number;
  tone: number;
  goldstein: number;
  time: number;
  url: string;
};

const events = new Map<string, RawEvent>();
const processed = new Set<string>();

const state = {
  status: "offline",
  detail: "not started",
  lastFile: "",
  lastRun: 0,
  files: 0
};

const CAMEO: Record<string, string> = {
  "140": "Protest", "141": "Demonstration", "142": "Hunger strike", "143": "Strike / boycott",
  "144": "Obstruction / blockade", "145": "Riot",
  "180": "Violent assault", "181": "Abduction", "182": "Physical assault", "183": "Bombing",
  "184": "Human shield", "185": "Assassination attempt", "186": "Assassination",
  "190": "Armed clash", "191": "Blockade (armed)", "192": "Occupy territory", "193": "Small arms fight",
  "194": "Artillery / tank fight", "195": "Air / drone strike", "196": "Ceasefire violation",
  "200": "Mass violence", "201": "Mass expulsion", "202": "Mass killings", "203": "Ethnic cleansing",
  "204": "Weapon of mass destruction"
};

const num = (v: string | undefined) => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "YYYYMMDDHHMMSS" (UTC) -> epoch ms */
function parseStamp(s: string) {
  if (!/^\d{14}$/.test(s)) return Date.now();
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}

export function parseExportCsv(csv: string): RawEvent[] {
  const out: RawEvent[] = [];

  for (const line of csv.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    if (f.length < 61) continue;

    const root = f[28];
    let kind: ConflictKind | null = null;

    if (root === "14") kind = "protest";
    else if (root === "18" || root === "19" || root === "20") kind = "conflict";
    if (!kind) continue;

    const geoType = num(f[51]);
    if (geoType === null || geoType < 3 || geoType > 5) continue;   // drop country-level pins

    const lat = num(f[56]);
    const lon = num(f[57]);
    if (lat === null || lon === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;

    out.push({
      id: f[0],
      kind,
      code: f[26],
      lat,
      lon,
      place: f[52] || "",
      country: f[53] || "",
      geoType,
      mentions: Math.max(1, num(f[31]) ?? 1),
      tone: num(f[34]) ?? 0,
      goldstein: num(f[30]) ?? 0,
      time: parseStamp(f[59]),
      url: f[60] || ""
    });
  }

  return out;
}

async function fetchExport(url: string): Promise<RawEvent[] | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": "SHADOWBROKER/3.0" },
    signal: AbortSignal.timeout(45000)
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const zip = new Uint8Array(await response.arrayBuffer());
  const files = unzipSync(zip);
  const name = Object.keys(files)[0];
  if (!name) return [];

  return parseExportCsv(new TextDecoder("utf-8").decode(files[name]));
}

function store(list: RawEvent[]) {
  const cutoff = Date.now() - WINDOW_MS;

  for (const e of list) {
    if (e.time >= cutoff) events.set(e.id, e);
  }

  for (const [id, e] of events) {
    if (e.time < cutoff) events.delete(id);
  }
}

function stampFor(date: Date) {
  const p = (n: number) => String(n).padStart(2, "0");

  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}00`
  );
}

async function ingestUrl(url: string) {
  if (processed.has(url)) return;

  const list = await fetchExport(url);
  processed.add(url);

  if (list) {
    store(list);
    state.files += 1;
  }

  if (processed.size > 500) {
    [...processed].slice(0, 200).forEach(u => processed.delete(u));
  }
}

async function backfill() {
  const now = new Date();
  now.setUTCSeconds(0, 0);
  now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 15) * 15);

  const urls: string[] = [];
  for (let i = 1; i <= BACKFILL_FILES; i++) {
    urls.push(`${BASE}/${stampFor(new Date(now.getTime() - i * 15 * 60000))}.export.CSV.zip`);
  }

  // 3 downloads at a time
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < urls.length) {
        const url = urls[next++];
        try {
          await ingestUrl(url);
        } catch {
          // a single missing file must not stop the backfill
        }
      }
    })
  );
}

async function refresh() {
  try {
    const response = await fetch(`${BASE}/lastupdate.txt`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`lastupdate HTTP ${response.status}`);

    const text = await response.text();
    const line = text.split("\n").find(l => l.includes(".export.CSV.zip"));
    const url = line?.trim().split(/\s+/).pop();

    if (url) {
      const https = url.replace(/^http:\/\//, "https://");
      await ingestUrl(https);
      state.lastFile = https.split("/").pop() || "";
    }

    state.lastRun = Date.now();
    state.status = events.size ? "public" : "offline";
    state.detail = `GDELT 2.0 - ${events.size} geolocated events in ${WINDOW_MS / 3600000}h window - last file ${state.lastFile}`;
  } catch (err) {
    state.status = events.size ? "public" : "offline";
    state.detail = `GDELT refresh failed: ${err instanceof Error ? err.message : String(err)}` +
      (events.size ? ` (serving ${events.size} cached events)` : "");
  }
}

export function startConflicts() {
  state.detail = "loading GDELT history...";

  void backfill().then(refresh);
  setInterval(() => void refresh(), 5 * 60 * 1000).unref();
}

export function clusterEvents(list: Iterable<RawEvent>): ConflictCluster[] {
  type Acc = {
    kind: ConflictKind; lat: number; lon: number; place: string; country: string;
    events: number; mentions: number; toneSum: number; gold: number; last: number;
    geoType: number; codes: Map<string, number>; urls: Map<string, number>;
  };

  const groups = new Map<string, Acc>();

  for (const e of list) {
    // ~1 km grid so repeated reports of the same incident collapse into one marker
    const key = `${e.kind}|${e.lat.toFixed(2)}|${e.lon.toFixed(2)}`;
    let g = groups.get(key);

    if (!g) {
      g = {
        kind: e.kind, lat: e.lat, lon: e.lon, place: e.place, country: e.country,
        events: 0, mentions: 0, toneSum: 0, gold: 0, last: 0,
        geoType: e.geoType, codes: new Map(), urls: new Map()
      };
      groups.set(key, g);
    }

    g.events += 1;
    g.mentions += e.mentions;
    g.toneSum += e.tone * e.mentions;
    g.gold = Math.min(g.gold, e.goldstein);
    g.last = Math.max(g.last, e.time);
    g.codes.set(e.code, (g.codes.get(e.code) || 0) + e.mentions);
    if (e.url) g.urls.set(e.url, (g.urls.get(e.url) || 0) + e.mentions);
  }

  return [...groups.entries()]
    .map(([key, g]): ConflictCluster => {
      const topCode = [...g.codes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      const label =
        CAMEO[topCode] || CAMEO[topCode.slice(0, 2) + "0"] || (g.kind === "protest" ? "Protest" : "Violence");

      return {
        id: key,
        kind: g.kind,
        latitude: g.lat,
        longitude: g.lon,
        place: g.place,
        country: g.country,
        events: g.events,
        mentions: g.mentions,
        tone: Math.round((g.toneSum / Math.max(1, g.mentions)) * 10) / 10,
        goldstein: g.gold,
        label,
        precision: g.geoType === 5 ? "region" : "city",
        lastEvent: new Date(g.last).toISOString(),
        sources: [...g.urls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([u]) => u)
      };
    })
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, MAX_CLUSTERS);
}

export function getConflicts() {
  const clusters = clusterEvents(events.values());

  return {
    conflicts: clusters.filter(c => c.kind === "conflict"),
    protests: clusters.filter(c => c.kind === "protest"),
    status: state.status,
    detail: state.detail,
    eventCount: events.size,
    windowHours: WINDOW_MS / 3600000
  };
}

export function conflictStatus() {
  return { "GDELT events": { status: state.status, detail: state.detail } };
}

export const conflictInternals = { parseExportCsv, clusterEvents, store, events };
