
import type {
  Earthquake,
  FeedItem,
  Flight
} from "./types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed: ${response.status}`
    );
  }

  return data as T;
}

export const api = {
  news: () =>
    get<{
      items: FeedItem[];
      status: string;
      sourceStatus?: {
        source: string;
        status: string;
        error?: string;
      }[];
    }>("/api/news"),

  earthquakes: () =>
    get<{
      items: Earthquake[];
      status: string;
    }>("/api/earthquakes"),

  flights: () =>
    get<{
      items: Flight[];
      status: string;
      count?: number;
    }>("/api/flights"),

  status: () =>
    get<{
      services: Record<
        string,
        {
          status: string;
          detail: string;
        }
      >;
    }>("/api/status")
};
