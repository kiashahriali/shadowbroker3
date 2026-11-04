// Live connectivity self-test for every data source used by SHADOWBROKER.
//
//   npm run selftest
//
// Run it where the app is hosted (Render shell) or on your own machine: it calls the
// real services, so it tells you which providers answer from THAT network. Cloud
// IPs are sometimes rate-limited by free APIs, and this is the quickest way to see it.

import { unzipSync } from "fflate";
import WebSocket from "ws";
import { conflictInternals } from "./conflicts";
import { getSatelliteLayers, getScenes } from "./satellite";
import { getAnalysis, getHistory, getMarkets } from "./markets";
import { parseDigitrafficLocations } from "./ais";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

async function check(name: string, fn: () => Promise<string>) {
  const started = Date.now();

  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: `${detail} (${Date.now() - started} ms)` });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }

  const r = results[results.length - 1];
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(34)} ${r.detail}`);
}

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    headers: { "User-Agent": "SHADOWBROKER-selftest/3.0", Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
    ...init
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<any>;
}

async function imageOk(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const type = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!type.startsWith("image/")) throw new Error(`not an image (${type})`);
  return `${type}, ${(await response.arrayBuffer()).byteLength} bytes`;
}

async function main() {
  console.log("SHADOWBROKER self-test\n");

  /* ---------------------------------------------------------------- aircraft */
  const points: [string, string][] = [
    ["adsb.lol point", "https://api.adsb.lol/v2/lat/51.5/lon/-0.5/dist/250"],
    ["adsb.fi point", "https://opendata.adsb.fi/api/v2/lat/51.5/lon/-0.5/dist/250"],
    ["airplanes.live point", "https://api.airplanes.live/v2/point/51.5/-0.5/250"]
  ];

  for (const [name, url] of points) {
    await check(`Aircraft: ${name}`, async () => {
      const d = await json(url);
      if (!Array.isArray(d.ac) || !d.ac.length) throw new Error("no aircraft returned");
      return `${d.ac.length} aircraft over London`;
    });
    await new Promise(r => setTimeout(r, 1200));     // respect 1 request / second
  }

  await check("Aircraft: adsb.lol military", async () => {
    const d = await json("https://api.adsb.lol/v2/mil");
    return `${d.ac?.length ?? 0} military aircraft worldwide`;
  });

  await check("Aircraft: OpenSky (anonymous)", async () => {
    const d = await json("https://opensky-network.org/api/states/all");
    return `${d.states?.length ?? 0} states worldwide`;
  });

  /* ------------------------------------------------------------------ ships */
  await check("Ships: Digitraffic locations", async () => {
    const rows = parseDigitrafficLocations(
      await json("https://meri.digitraffic.fi/api/ais/v1/locations", {
        headers: { "Digitraffic-User": "SHADOWBROKER/3.0", "Accept-Encoding": "gzip" }
      })
    );
    if (!rows.length) throw new Error("no vessels");
    return `${rows.length} vessels in the Baltic`;
  });

  await check("Ships: AISStream.io", async () => {
    const key = process.env.AISSTREAM_API_KEY;
    if (!key) throw new Error("AISSTREAM_API_KEY is not set (free key: aisstream.io)");

    return await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("no message within 15 s")); }, 15000);

      ws.on("open", () =>
        ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[50, -5], [60, 10]]], FilterMessageTypes: ["PositionReport"] }))
      );
      ws.on("message", data => {
        clearTimeout(timer);
        ws.close();
        const m = JSON.parse(data.toString());
        m.error ? reject(new Error(m.error)) : resolve(`first message: ${m.MessageType}`);
      });
      ws.on("error", e => { clearTimeout(timer); reject(e); });
    });
  });

  /* ------------------------------------------------------------ conflicts */
  await check("Unrest: GDELT latest export", async () => {
    const text = await (await fetch("https://data.gdeltproject.org/gdeltv2/lastupdate.txt", { signal: AbortSignal.timeout(20000) })).text();
    const url = text.split("\n").find(l => l.includes(".export.CSV.zip"))?.trim().split(/\s+/).pop();
    if (!url) throw new Error("export file not listed");

    const zip = new Uint8Array(await (await fetch(url.replace("http://", "https://"), { signal: AbortSignal.timeout(45000) })).arrayBuffer());
    const files = unzipSync(zip);
    const csv = new TextDecoder().decode(files[Object.keys(files)[0]]);
    const events = conflictInternals.parseExportCsv(csv);
    return `${events.length} conflict/protest events in one 15-min file`;
  });

  /* ------------------------------------------------------------ satellite */
  let gibsTile: string | null = null;

  await check("Satellite: NASA GIBS capabilities", async () => {
    const r = await getSatelliteLayers();
    if (!r.layers.length) throw new Error(r.detail);
    if (!r.layers.some(l => l.latest)) throw new Error(`capabilities not readable: ${r.detail}`);
    gibsTile = r.layers[0].tiles;
    return r.layers.map(l => `${l.name} [${l.latest ?? "?"}]`).join("; ");
  });

  await check("Satellite: GIBS tile download", async () => {
    if (!gibsTile) throw new Error("no layer available");
    return imageOk(gibsTile.replace("{z}", "3").replace("{y}", "3").replace("{x}", "3"));
  });

  let scene: any = null;

  await check("Satellite: Sentinel-2 scene search", async () => {
    const r = await getScenes([5, 45, 15, 52], 24 * 10, 60, 10);
    if (!r.ok || !r.scenes.length) throw new Error(r.detail);
    scene = r.scenes[0];
    return `${r.scenes.length} scenes, newest ${scene.datetime}`;
  });

  await check("Satellite: Sentinel-2 tile render", async () => {
    if (!scene?.tiles) throw new Error("no scene");
    const [w, s, e, n] = scene.bbox as number[];
    const lon = (w + e) / 2;
    const lat = (s + n) / 2;
    const z = 9;
    const x = Math.floor(((lon + 180) / 360) * 2 ** z);
    const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
    return imageOk(scene.tiles.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
  });

  /* -------------------------------------------------------------- markets */
  await check("Markets: quote board", async () => {
    const m = await getMarkets();
    const ok = m.items.filter(i => i.price !== null);
    const missing = m.items.filter(i => i.price === null).map(i => i.symbol);
    if (!ok.length) throw new Error("no quotes at all");
    return `${ok.length}/${m.items.length} priced` + (missing.length ? `; missing: ${missing.join(", ")}` : "");
  });

  for (const symbol of ["XAUUSD", "XAGUSD", "WTI", "BRENT", "NATGAS", "GASOLINE", "DIESEL", "EURUSD", "BTCUSDT"]) {
    await check(`Markets: ${symbol} chart (1M)`, async () => {
      const h = await getHistory(symbol, "1M");
      if (!h.points.length) throw new Error(h.detail || "no points");
      return `${h.points.length} points via ${h.source}`;
    });
  }

  await check("Markets: analysis XAUUSD", async () => {
    const a = await getAnalysis("XAUUSD");
    return `${a.bias} (${a.confidence}), ${a.headlines.length} headlines. ${a.detail ?? ""}`;
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

void main();
