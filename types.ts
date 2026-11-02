
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
  category?: string;
};

export type Vessel = {
  mmsi: string;
  name: string;
  longitude: number;
  latitude: number;
  speed?: number | null;
  heading?: number | null;
  destination?: string;
  vesselType?: string;
};

export type LayerState = {
  flights: boolean;
  earthquakes: boolean;
  conflicts: boolean;
  protests: boolean;
  vessels: boolean;
  satellite: boolean;
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
