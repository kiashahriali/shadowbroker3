export type FeedItem = {
  id: string; title: string; source: string; url: string; publishedAt?: string;
  summary?: string; category: "world" | "conflict" | "protest" | "technology";
};
export type Earthquake = {
  id: string; title: string; place: string; magnitude: number; time: number;
  coordinates: [number, number]; url: string;
};
export type Flight = {
  icao24: string; callsign: string; originCountry: string; longitude: number;
  latitude: number; altitude: number | null; velocity: number | null; heading: number | null;
};
export type LayerState = { flights: boolean; earthquakes: boolean; conflicts: boolean; protests: boolean };
