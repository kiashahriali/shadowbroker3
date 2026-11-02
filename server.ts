
import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import { resolve } from "node:path";
import { RSS_SOURCES } from "./sources";

const app = express();
const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "SHADOWBROKER/1.0 public-data-dashboard"
  }
});

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8787);
const cache = new Map<string, {
  expires: number;
  data: unknown;
}>();

const TTL = 120000;

async function cached<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const current = cache.get(key);

  if (current && current.expires > Date.now()) {
    return current.data as T;
  }

  const value = await fn();

  cache.set(key, {
    expires: Date.now() + TTL,
    data: value
  });

  return value;
}

function cleanText(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as any).cause;
    return [
      error.name,
      error.message,
      cause ? String(cause) : ""
    ].filter(Boolean).join(" | ");
  }

  return String(error);
}

async function fetchJson(url: string, timeout = 20000) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SHADOWBROKER/1.0"
    },
    signal: AbortSignal.timeout(timeout)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// HEALTH

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "SHADOWBROKER API",
    timestamp: new Date().toISOString()
  });
});

// NEWS

app.get("/api/news", async (_req, res) => {
  try {
    const result = await cached("news", async () => {
      const feeds = await Promise.allSettled(
        RSS_SOURCES.map(async source => {
          const feed = await parser.parseURL(source.url);

          const items = (feed.items || [])
            .slice(0, 18)
            .map(item => ({
              id: `${source.name}-${item.guid || item.link || item.title}`,
              title: cleanText(item.title || "Untitled report"),
              source: source.name,
              url: item.link || "",
              publishedAt: item.isoDate || item.pubDate,
              summary: cleanText(
                item.contentSnippet || item.content || ""
              ),
              category: source.category
            }));

          return {
            source: source.name,
            items
          };
        })
      );

      const items = feeds.flatMap(feed =>
        feed.status === "fulfilled" ? feed.value.items : []
      );

      const sourceStatus = feeds.map((feed, index) => ({
        source: RSS_SOURCES[index].name,
        status: feed.status === "fulfilled" ? "online" : "offline",
        error: feed.status === "rejected"
          ? errorMessage(feed.reason)
          : undefined
      }));

      return {
        items,
        sourceStatus,
        status: items.length > 0
          ? "online"
          : "unavailable"
      };
    });

    res.json(result);

  } catch (error) {
    console.error("NEWS ERROR:", error);

    res.status(502).json({
      items: [],
      status: "unavailable",
      error: errorMessage(error)
    });
  }
});

// EARTHQUAKES

app.get("/api/earthquakes", async (_req, res) => {
  try {
    const items = await cached("earthquakes", async () => {
      const geo: any = await fetchJson(
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
      );

      return (geo.features || []).map((f: any) => ({
        id: f.id,
        title: f.properties.title,
        place: f.properties.place,
        magnitude: f.properties.mag,
        time: f.properties.time,
        coordinates: [
          f.geometry.coordinates[0],
          f.geometry.coordinates[1]
        ],
        url: f.properties.url
      }));
    });

    res.json({
      items,
      status: "online"
    });

  } catch (error) {
    console.error("USGS ERROR:", error);

    res.status(502).json({
      items: [],
      status: "unavailable",
      error: errorMessage(error)
    });
  }
});

// AIRCRAFT

app.get("/api/flights", async (_req, res) => {
  try {
    const items = await cached("flights", async () => {
      const headers: Record<string, string> = {};

      const username = process.env.OPENSKY_USERNAME;
      const password = process.env.OPENSKY_PASSWORD;

      if (username && password) {
        headers.Authorization =
          "Basic " +
          Buffer.from(`${username}:${password}`).toString("base64");
      }

      const response = await fetch(
        "https://opensky-network.org/api/states/all",
        {
          headers,
          signal: AbortSignal.timeout(20000)
        }
      );

      if (!response.ok) {
        throw new Error(
          `OpenSky HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data: any = await response.json();

      return (data.states || [])
        .filter((s: any[]) =>
          s[5] !== null &&
          s[6] !== null &&
          Number.isFinite(s[5]) &&
          Number.isFinite(s[6]) &&
          s[5] >= -180 &&
          s[5] <= 180 &&
          s[6] >= -90 &&
          s[6] <= 90
        )
        .map((s: any[]) => ({
          icao24: s[0],
          callsign: String(s[1] || "").trim(),
          originCountry: s[2],
          longitude: s[5],
          latitude: s[6],
          altitude: s[7],
          velocity: s[9],
          heading: s[10]
        }));
    });

    res.json({
      items,
      status: "online",
      count: items.length
    });

  } catch (error) {
    console.error("OPENSKY ERROR:", error);

    res.status(502).json({
      items: [],
      status: "unavailable",
      error: errorMessage(error)
    });
  }
});

// SERVICE STATUS

app.get("/api/status", async (_req, res) => {
  const services = {
    "BBC / Guardian / Al Jazeera / DW RSS": {
      status: "online",
      detail: "Public RSS feeds. Availability varies by publisher."
    },
    "USGS Earthquake Feed": {
      status: "online",
      detail: "USGS public GeoJSON feed."
    },
    "OpenSky Network": {
      status: "external",
      detail: "Aircraft data depends on OpenSky connectivity and access limits."
    },
    "GDELT": {
      status: "needs_credentials",
      detail: "Not connected in this release."
    },
    "Maritime AIS": {
      status: "needs_credentials",
      detail: "An AIS data provider and API credentials are required."
    },
    "NASA FIRMS": {
      status: "needs_credentials",
      detail: "A NASA FIRMS MAP_KEY is required."
    }
  };

  res.json({ services });
});

// FRONTEND

const frontendDist = resolve(process.cwd(), "dist");

app.use(express.static(frontendDist));

app.get("*", (_req, res) => {
  res.sendFile(resolve(frontendDist, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SHADOWBROKER listening on ${PORT}`);
});
