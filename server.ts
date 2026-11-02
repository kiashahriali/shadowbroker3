import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import { resolve } from "node:path";
import { RSS_SOURCES } from "./sources";

const app = express();
const parser = new Parser({ timeout: 12000, headers: { "User-Agent": "SHADOWBROKER/1.0 public-data-dashboard" } });
app.use(cors());
app.use(express.json());
const PORT = Number(process.env.PORT || 8787);
const cache = new Map<string, { expires: number; data: unknown }>();
const TTL = 120_000;

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const current = cache.get(key);
  if (current && current.expires > Date.now()) return current.data as T;
  const value = await fn(); cache.set(key, { expires: Date.now() + TTL, data: value }); return value;
}
function cleanText(value = "") { return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500); }

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "SHADOWBROKER API", timestamp: new Date().toISOString() }));

app.get("/api/news", async (_req, res) => {
  try {
    const items = await cached("news", async () => {
      const feeds = await Promise.allSettled(RSS_SOURCES.map(async source => {
        const feed = await parser.parseURL(source.url);
        return (feed.items || []).slice(0, 18).map(item => ({
          id: `${source.name}-${item.guid || item.link || item.title}`,
          title: cleanText(item.title || "Untitled report"),
          source: source.name, url: item.link || "", publishedAt: item.isoDate || item.pubDate,
          summary: cleanText(item.contentSnippet || item.content || ""),
          category: source.category
        }));
      }));
      return feeds.flatMap((f, i) => f.status === "fulfilled" ? f.value : []);
    });
    res.json({ items, status: "public_rss" });
  } catch (error) { res.status(502).json({ items: [], status: "unavailable", error: String(error) }); }
});

app.get("/api/earthquakes", async (_req, res) => {
  try {
    const items = await cached("earthquakes", async () => {
      const response = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
      if (!response.ok) throw new Error(`USGS ${response.status}`);
      const geo = await response.json() as any;
      return (geo.features || []).map((f: any) => ({
        id: f.id, title: f.properties.title, place: f.properties.place,
        magnitude: f.properties.mag, time: f.properties.time,
        coordinates: [f.geometry.coordinates[0], f.geometry.coordinates[1]], url: f.properties.url
      }));
    });
    res.json({ items, status: "online" });
  } catch (error) { res.status(502).json({ items: [], status: "unavailable", error: String(error) }); }
});

app.get("/api/flights", async (_req, res) => {
  try {
    const items = await cached("flights", async () => {
      const url = "https://opensky-network.org/api/states/all";
      const headers: Record<string,string> = {};
      const user = process.env.OPENSKY_USERNAME, pass = process.env.OPENSKY_PASSWORD;
      if (user && pass) headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`OpenSky ${response.status}`);
      const data = await response.json() as any;
      return (data.states || []).filter((s: any[]) => s[5] != null && s[6] != null).map((s: any[]) => ({
        icao24: s[0], callsign: String(s[1] || "").trim(), originCountry: s[2],
        longitude: s[5], latitude: s[6], altitude: s[7], velocity: s[9], heading: s[10]
      }));
    });
    res.json({ items, status: "online" });
  } catch (error) { res.status(502).json({ items: [], status: "unavailable", error: String(error) }); }
});

app.get("/api/status", async (_req, res) => {
  const services = {
    "BBC / Guardian / Al Jazeera / DW RSS": { status: "online", detail: "Public RSS feeds; availability varies by publisher." },
    "USGS Earthquake Feed": { status: "online", detail: "USGS public GeoJSON feed; past 24 hours." },
    "OpenSky Network": { status: "degraded", detail: "Public endpoint; rate limits and anonymous access restrictions may apply." },
    "GDELT": { status: "needs_credentials", detail: "Not yet connected in this release; public API adapter is a planned extension." },
    "Maritime AIS": { status: "needs_credentials", detail: "No dependable unrestricted global AIS feed; connect a provider with a permitted free tier." },
    "NASA FIRMS": { status: "needs_credentials", detail: "Free MAP_KEY registration required; not enabled until configured." }
  };
  res.json({ services });
});

// In production, serve the Vite build from the same origin as the API.
// This keeps /api requests same-origin and avoids a separate frontend service.
const frontendDist = resolve(process.cwd(), "dist");
app.use(express.static(frontendDist));
app.get("*", (_req, res) => res.sendFile(resolve(frontendDist, "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`SHADOWBROKER listening on ${PORT}`));
