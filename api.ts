import type { Earthquake, FeedItem, Flight } from "./types";
async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
export const api = {
  news: () => get<{items: FeedItem[]; status: string}>("/api/news"),
  earthquakes: () => get<{items: Earthquake[]; status: string}>("/api/earthquakes"),
  flights: () => get<{items: Flight[]; status: string}>("/api/flights"),
  status: () => get<{services: Record<string, {status: string; detail: string}>}>("/api/status")
};
