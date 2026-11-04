
export type NewsCategory =
  | "world"
  | "conflict"
  | "protest"
  | "technology"
  | "finance";

export type FeedItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt?: string;
  summary?: string;
  category: NewsCategory;
};

export type Earthquake = {
  id: string;
  title: string;
  place: string;
  magnitude: number;
  time: number;
  coordinates: [number, number];
  url: string;
};

export type Flight = {
  icao24: string;
  callsign: string;
  originCountry: string;
  longitude: number;
  latitude: number;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  registration?: string | null;
  aircraftType?: string | null;
  onGround?: boolean;
  squawk?: string | null;
  category?: FlightCategory;
};

export type FlightCategory =
  | "commercial"
  | "military"
  | "helicopter"
  | "private"
  | "emergency";

export type VesselCategory =
  | "cargo"
  | "tanker"
  | "passenger"
  | "fishing"
  | "military"
  | "tug"
  | "sailing"
  | "other";

export type Vessel = {
  mmsi: string;
  name: string;
  longitude: number;
  latitude: number;
  speed?: number | null;
  heading?: number | null;
  destination?: string;
  vesselType?: string;
  course?: number | null;
  updatedAt?: number;
  shipType?: number | null;
  category?: VesselCategory;
  source?: string;
};

export type LayerState = {
  flights: boolean;
  earthquakes: boolean;
  conflicts: boolean;
  protests: boolean;
  vessels: boolean;
  satellite: boolean;
  scenes: boolean;
};

export type ProviderStatus = {
  status: string;
  detail: string;
  updatedAt?: string;
};

export type NewsSource = {
  name: string;
  url: string;
  category: NewsCategory;
  enabled: boolean;
  custom?: boolean;
};

export type MarketGroup = "metals" | "energy" | "forex" | "crypto" | "index";

export type MarketAsset = {
  symbol: string;
  name: string;
  nameFa?: string;
  group: MarketGroup;
  price: number | null;
  change24h?: number | null;
  changeAbs?: number | null;
  high?: number | null;
  low?: number | null;
  currency: string;
  decimals: number;
  source: string;
  updatedAt: string;
  note?: string;
};

export type MarketPoint = { t: number; c: number; o?: number; h?: number; l?: number };

export type MarketHistory = {
  symbol: string;
  range: string;
  points: MarketPoint[];
  source: string;
  detail?: string;
};

export type AnalysisHeadline = {
  title: string;
  source: string;
  url: string;
  publishedAt?: string;
  sentiment: number;           // -1 .. +1 effect on THIS asset's price
  drivers: { en: string; fa: string }[];
};

export type MarketAnalysis = {
  symbol: string;
  name: string;
  bias: "bullish" | "bearish" | "neutral";
  confidence: "low" | "medium" | "high";
  score: number;               // -1 .. +1
  newsScore: number;
  technicalScore: number;
  technicals: {
    price: number | null;
    change1d: number | null;
    change5d: number | null;
    change1m: number | null;
    rsi14: number | null;
    sma20: number | null;
    sma50: number | null;
    high1m: number | null;
    low1m: number | null;
    trend: "up" | "down" | "sideways" | "unknown";
  };
  headlines: AnalysisHeadline[];
  topDrivers: { en: string; fa: string; count: number; direction: "up" | "down" }[];
  summary: { en: string; fa: string };
  disclaimer: { en: string; fa: string };
  generatedAt: string;
  detail?: string;
};

export type ConflictKind = "conflict" | "protest";

export type ConflictCluster = {
  id: string;
  kind: ConflictKind;
  latitude: number;
  longitude: number;
  place: string;
  country: string;
  events: number;
  mentions: number;
  tone: number;
  goldstein: number;
  label: string;
  precision: "city" | "region";
  lastEvent: string;
  sources: string[];
};

export type SatelliteLayerInfo = {
  id: string;
  name: string;
  platform: string;
  kind: "geostationary" | "polar";
  cadence: string;
  resolution: string;
  description: string;
  tiles: string;
  tileSize: number;
  maxzoom: number;
  latest: string | null;
  center: [number, number] | null;
  available: boolean;
};

export type SatelliteScene = {
  id: string;
  collection: string;
  datetime: string;
  platform: string;
  cloud: number | null;
  bbox: [number, number, number, number];
  center: [number, number];
  footprint: [number, number][];
  tiles: string | null;
  preview: string | null;
  link: string;
  tile: string | null;
};
