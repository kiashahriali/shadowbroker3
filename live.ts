import type { Express } from "express";
import { getFlights, startAdsb, adsbStatus } from "./adsb";
import { getVessels, startAis, aisStatus } from "./ais";
import { getConflicts, startConflicts, conflictStatus } from "./conflicts";
import { getSatelliteLayers, getScenes, satelliteStatus } from "./satellite";
import { ASSETS, getAnalysis, getHistory, getMarkets, marketStatus, startMarkets } from "./markets";

/** Start every background collector. Call once at boot. */
export function startLive() {
  startAdsb();
  startAis();
  startConflicts();
  startMarkets();
}

const fail = (res: any, err: unknown, code = 502) =>
  res.status(code).json({ error: err instanceof Error ? err.message : String(err) });

export function registerLiveRoutes(app: Express) {
  /* ------------------------------------------------------------- aircraft */
  app.get("/api/flights", (_req, res) => {
    const data = getFlights();

    res.set("Cache-Control", "no-store");
    res.json({
      items: data.items,
      count: data.items.length,
      status: data.ok ? "online" : "unavailable",
      detail: data.detail,
      sources: data.sourceCounts
    });
  });

  /* -------------------------------------------------------------- vessels */
  app.get("/api/vessels", (_req, res) => {
    const data = getVessels();

    res.set("Cache-Control", "no-store");
    res.json({ items: data.items, count: data.items.length, status: data.status, detail: data.detail });
  });

  /* ------------------------------------------------- conflicts / protests */
  app.get("/api/conflicts", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(getConflicts());
  });

  /* ------------------------------------------------------------ satellite */
  app.get("/api/satellite/layers", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await getSatelliteLayers());
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/satellite/scenes", async (req, res) => {
    try {
      const parts = String(req.query.bbox || "").split(",").map(Number);
      if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
        return res.status(400).json({ error: "bbox must be west,south,east,north" });
      }

      const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
      const bbox: [number, number, number, number] = [
        clamp(parts[0], -180, 180),
        clamp(parts[1], -90, 90),
        clamp(parts[2], -180, 180),
        clamp(parts[3], -90, 90)
      ];

      if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) {
        return res.status(400).json({ error: "invalid bbox" });
      }

      const hours = clamp(Number(req.query.hours) || 96, 6, 24 * 14);
      const cloud = clamp(Number(req.query.cloud) || 40, 0, 100);
      const limit = clamp(Number(req.query.limit) || 60, 1, 100);

      res.set("Cache-Control", "no-store");
      res.json(await getScenes(bbox, hours, cloud, limit));
    } catch (err) {
      fail(res, err);
    }
  });

  /* --------------------------------------------------------------- markets */
  app.get("/api/markets", async (_req, res) => {
    try {
      const data = await getMarkets();

      res.set("Cache-Control", "no-store");
      res.json({ ...data, services: marketStatus() });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/markets/history", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "");
      if (!ASSETS.some(a => a.symbol === symbol)) return res.status(400).json({ error: "unknown symbol" });

      res.set("Cache-Control", "no-store");
      res.json(await getHistory(symbol, String(req.query.range || "1M").toUpperCase()));
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/markets/analysis", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "");
      if (!ASSETS.some(a => a.symbol === symbol)) return res.status(400).json({ error: "unknown symbol" });

      res.set("Cache-Control", "no-store");
      res.json(await getAnalysis(symbol));
    } catch (err) {
      fail(res, err);
    }
  });
}

/** Provider entries merged into the /api/status response. */
export async function liveStatus() {
  return {
    ...adsbStatus(),
    ...aisStatus(),
    ...conflictStatus(),
    ...(await satelliteStatus()),
    ...marketStatus()
  };
}
