
import type {
  Earthquake,
  FeedItem,
  Flight,
  Vessel,
  NewsSource,
  ProviderStatus
} from "./types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data as T;
}

export const api = {
  news: () =>
    get<{
      items: FeedItem[];
      status: string;
      sourceStatus: {
        source: string;
        status: string;
        error?: string;
      }[];
    }>("/api/news"),

  events: () =>
    get<{
      items: FeedItem[];
      status: string;
    }>("/api/events"),

  earthquakes: () =>
    get<{
      items: Earthquake[];
      status: string;
    }>("/api/earthquakes"),

  flights: () =>
    get<{
      items: Flight[];
      status: string;
      count: number;
      detail?: string;
    }>("/api/flights"),

  vessels: () =>
    get<{
      items: Vessel[];
      status: string;
      count: number;
      detail?: string;
    }>("/api/vessels"),

  sources: () =>
    get<{ items: NewsSource[] }>("/api/news/sources"),

  addSource: (source: {
    name: string;
    url: string;
    category: string;
  }) =>
    post<{ ok: boolean; source: NewsSource }>(
      "/api/news/sources",
      source
    ),

  removeSource: (url: string) =>
    post<{ ok: boolean }>(
      "/api/news/sources/remove",
      { url }
    ),

  status: () =>
    get<{
      services: Record<string, ProviderStatus>;
    }>("/api/status")
};
