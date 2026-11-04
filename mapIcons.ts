import type { Map as MapLibreMap } from "maplibre-gl";
import type { FlightCategory, VesselCategory } from "./types";

/** Small flat pictograms: no outline, no circle - just a coloured plane / ship / etc. */
export type IconShape = "plane" | "heli" | "ship" | "sat" | "conflict" | "protest";

const SIZE = 48;          // bitmap px, rendered at pixelRatio 2  ->  24 css px at icon-size 1
const GRID = 64;          // all shapes are authored on a 64 x 64 grid

export const FLIGHT_COLORS: Record<FlightCategory, string> = {
  commercial: "#53c7f4",
  military: "#ff4d4d",
  helicopter: "#ffa94d",
  private: "#7ee787",
  emergency: "#ff2bd6"
};

export const VESSEL_COLORS: Record<VesselCategory, string> = {
  cargo: "#40d9c2",
  tanker: "#ff9f43",
  passenger: "#7aa2ff",
  fishing: "#c6f36b",
  military: "#ff4d4d",
  tug: "#f4d35e",
  sailing: "#e6edf3",
  other: "#9aa7b2"
};

export const FLIGHT_LEGEND: { key: FlightCategory; label: string; shape: IconShape }[] = [
  { key: "commercial", label: "Airliner", shape: "plane" },
  { key: "military", label: "Military", shape: "plane" },
  { key: "private", label: "Private / GA", shape: "plane" },
  { key: "helicopter", label: "Helicopter", shape: "heli" },
  { key: "emergency", label: "Emergency", shape: "plane" }
];

export const VESSEL_LEGEND: { key: VesselCategory; label: string }[] = [
  { key: "cargo", label: "Cargo" },
  { key: "tanker", label: "Tanker" },
  { key: "passenger", label: "Passenger" },
  { key: "fishing", label: "Fishing" },
  { key: "military", label: "Naval / law" },
  { key: "tug", label: "Tug / special" },
  { key: "sailing", label: "Sailing" },
  { key: "other", label: "Other" }
];

const PLANE_RIGHT: [number, number][] = [
  [32, 2], [35, 9], [36, 24], [61, 41], [61, 47], [36, 40], [35, 53], [44, 59], [44, 63], [32, 60]
];

function planePath(): [number, number][] {
  const left = PLANE_RIGHT.slice(1, -1).reverse().map(([x, y]) => [GRID - x, y] as [number, number]);
  return [...PLANE_RIGHT, ...left];
}

const SHIP: [number, number][] = [[32, 2], [43, 16], [43, 50], [39, 62], [25, 62], [21, 50], [21, 16]];

function star(points = 8, outer = 30, inner = 13): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    out.push([32 + r * Math.cos(a), 32 + r * Math.sin(a)]);
  }
  return out;
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, shape: IconShape, color: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";

  switch (shape) {
    case "plane":
      poly(ctx, planePath());
      break;

    case "ship":
      poly(ctx, SHIP);
      break;

    case "heli":
      ctx.beginPath();
      ctx.ellipse(32, 34, 9, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(32, 44); ctx.lineTo(32, 60); ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(25, 59); ctx.lineTo(39, 59); ctx.stroke();
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(56, 52); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8, 52); ctx.lineTo(56, 10); ctx.stroke();
      break;

    case "sat":
      ctx.fillRect(24, 22, 16, 20);
      ctx.fillRect(3, 26, 17, 12);
      ctx.fillRect(44, 26, 17, 12);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(20, 32); ctx.lineTo(24, 32); ctx.moveTo(40, 32); ctx.lineTo(44, 32); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(32, 22); ctx.lineTo(32, 13); ctx.stroke();
      ctx.beginPath(); ctx.arc(32, 9, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(32, 50, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(32, 42); ctx.lineTo(32, 48); ctx.stroke();
      break;

    case "conflict":
      poly(ctx, star());
      break;

    case "protest":
      ctx.fillRect(13, 6, 5, 54);
      poly(ctx, [[18, 8], [55, 8], [46, 20], [55, 32], [18, 32]]);
      break;
  }
}

function render(shape: IconShape, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(SIZE / GRID, SIZE / GRID);
  draw(ctx, shape, color);

  return canvas;
}

/** Registers `shape` in `color` on the map (once) and returns its image id. */
export function ensureIcon(map: MapLibreMap, shape: IconShape, color: string): string {
  const id = `ic-${shape}-${color.replace("#", "")}`;

  if (!map.hasImage(id)) {
    const canvas = render(shape, color);
    const data = canvas.getContext("2d")!.getImageData(0, 0, SIZE, SIZE);
    map.addImage(id, data, { pixelRatio: 2 });
  }

  return id;
}

const urlCache = new Map<string, string>();

/** Data URL of the same pictogram, for the legend. */
export function iconDataUrl(shape: IconShape, color: string): string {
  const key = `${shape}|${color}`;
  let url = urlCache.get(key);

  if (!url) {
    url = render(shape, color).toDataURL("image/png");
    urlCache.set(key, url);
  }

  return url;
}
