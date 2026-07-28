import html2canvas from "html2canvas";

export const MAP_CAPTURE_TIMEOUT_MS = 60_000;
export const CHART_CAPTURE_TIMEOUT_MS = 30_000;
const TILE_IMAGE_TIMEOUT_MS = 20_000;
const TILE_PROXY_PATH = "/api/tile-proxy";

// Evita que una captura (html2canvas) se quede colgada indefinidamente: si
// tarda más de `ms`, rechaza para que el botón no quede bloqueado y el
// usuario reciba un error explícito.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Tiempo de espera agotado al ${label}. Inténtalo de nuevo o reduce el rango de datos.`)),
        ms
      )
    ),
  ]);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string): void {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function parseTranslate(t: string): { tx: number; ty: number } | null {
  if (!t || t === "none") return null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/))) {
    return { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
  }
  if ((m = t.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/))) {
    return { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
  }
  if ((m = t.match(/matrix3d\(([^)]+)\)/))) {
    const v = m[1].split(",").map((n) => parseFloat(n.trim()));
    if (v.length === 16) return { tx: v[12], ty: v[13] };
  }
  if ((m = t.match(/matrix\(([^)]+)\)/))) {
    const v = m[1].split(",").map((n) => parseFloat(n.trim()));
    if (v.length === 6) return { tx: v[4], ty: v[5] };
  }
  return null;
}

// useCORS debe ir en false: html2canvas solo usa la opción `proxy` cuando
// useCORS es false (ver Cache.loadImage en su fuente). Enrutar los tiles por
// nuestro proxy same-origin evita el "tainted canvas" sin depender de que
// OSM/Google manden cabeceras CORS de forma consistente en todos sus nodos.
const html2canvasBaseOptions = {
  useCORS: false,
  allowTaint: false,
  proxy: TILE_PROXY_PATH,
  imageTimeout: TILE_IMAGE_TIMEOUT_MS,
} as const;

export async function captureChart(
  el: HTMLElement,
  backgroundColor: string | null,
  scale?: number
): Promise<HTMLCanvasElement> {
  return withTimeout(
    html2canvas(el, { backgroundColor, scale, ...html2canvasBaseOptions }),
    CHART_CAPTURE_TIMEOUT_MS,
    "capturar la gráfica"
  );
}

// Captura un mapa Leaflet corrigiendo el desplazamiento de las capas
// vectoriales SVG (KDE/MCP/trayectorias): html2canvas ignora el transform CSS
// propio del <svg> al rasterizarlo (pero respeta su viewBox), por lo que se
// desplazan hacia el oeste. Movemos el offset al layout (left/top).
export async function captureMap(
  el: HTMLElement,
  backgroundColor: string | null,
  scale?: number
): Promise<HTMLCanvasElement> {
  return withTimeout(
    html2canvas(el, {
      backgroundColor,
      scale,
      ...html2canvasBaseOptions,
      onclone: (_doc, clonedEl) => {
        const panes = clonedEl.querySelectorAll<HTMLElement>(
          ".leaflet-pane, .leaflet-tile, .leaflet-zoom-animated, .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-overlay-pane svg"
        );
        panes.forEach((p) => {
          const parsed = parseTranslate(p.style.transform);
          if (!parsed) return;
          if (p.tagName.toLowerCase() === "svg") {
            p.style.transform = "none";
            p.style.left = `${parsed.tx}px`;
            p.style.top = `${parsed.ty}px`;
          } else {
            p.style.transform = `translate(${parsed.tx}px, ${parsed.ty}px)`;
          }
        });
      },
    }),
    MAP_CAPTURE_TIMEOUT_MS,
    "capturar el mapa"
  );
}
