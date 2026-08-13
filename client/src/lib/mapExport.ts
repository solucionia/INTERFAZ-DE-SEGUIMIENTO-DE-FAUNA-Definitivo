import html2canvas, { createDefaultValidator } from "html2canvas-pro";

export const MAP_CAPTURE_TIMEOUT_MS = 60_000;
export const CHART_CAPTURE_TIMEOUT_MS = 30_000;
const TILE_IMAGE_TIMEOUT_MS = 20_000;
const TILE_PROXY_PATH = "/api/tile-proxy";
// html2canvas-pro valida `proxy` con `new URL(url)` sin base y exige http/https;
// una ruta relativa hace que el constructor lance y la opción sea rechazada
// ("Invalid URL format"). Se resuelve a absoluta same-origin en tiempo de carga.
const TILE_PROXY_URL = new URL(TILE_PROXY_PATH, window.location.origin).toString();

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

export interface YRange {
  top: number;
  bottom: number;
}

// Mide, en px CSS relativos a `container`, el rango vertical de cada elemento
// que no debe partirse entre dos páginas al paginar una captura muy alta
// (usado por exportPdf en geo-analysis.tsx para no cortar Cards por la mitad).
export function findProtectedRanges(container: HTMLElement, selector: string): YRange[] {
  const containerTop = container.getBoundingClientRect().top;
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - containerTop, bottom: r.bottom - containerTop };
  });
}

// Fusiona rangos solapados/adyacentes (p. ej. dos Cards en la misma fila de un
// grid comparten casi el mismo rango vertical) en zonas únicas "no cortables".
export function mergeRanges(ranges: YRange[]): YRange[] {
  const sorted = [...ranges].sort((a, b) => a.top - b.top);
  const merged: YRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.top <= last.bottom) {
      last.bottom = Math.max(last.bottom, r.bottom);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

// Calcula los puntos de corte acumulados (en px del canvas) para paginar un
// canvas alto en bloques de hasta `maxHeightForPage(pageIndex)` de alto,
// retrasando cada corte hasta el borde superior de la zona protegida que lo
// cubriría. Si una sola zona es más alta que una página entera, se acepta un
// corte duro ahí (no hay forma de evitarlo sin encoger el contenido).
export function computePageBreaks(
  totalHeight: number,
  protectedRanges: YRange[],
  maxHeightForPage: (pageIndex: number) => number
): number[] {
  const breaks = [0];
  let cursor = 0;
  let pageIndex = 0;
  while (cursor < totalHeight) {
    let candidate = cursor + maxHeightForPage(pageIndex);
    if (candidate >= totalHeight) {
      breaks.push(totalHeight);
      break;
    }
    const blocking = protectedRanges.find((r) => r.top < candidate && r.bottom > candidate);
    if (blocking && blocking.top > cursor) {
      candidate = blocking.top;
    }
    breaks.push(candidate);
    cursor = candidate;
    pageIndex++;
  }
  return breaks;
}

// Recorta la franja horizontal [top, top + height) de `source` a un canvas
// nuevo del mismo ancho, para insertarla como una página independiente.
export function cropCanvasVertical(source: HTMLCanvasElement, top: number, height: number): HTMLCanvasElement {
  const y = Math.round(top);
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, y, source.width, h, 0, 0, source.width, h);
  return canvas;
}

// El tema depende de las variables CSS de :root que la clase "dark" en <html>
// sobreescribe (ver theme-provider.tsx / index.css). Cambiar esa clase en el
// documento clonado que arma html2canvas-pro antes de rasterizar rompía el
// layout de la captura (Cards sin borde/fondo, tiles de Leaflet desalineados)
// sin que exista ninguna regla de layout (display/position/grid) atada a
// ".dark" en este proyecto — así que en vez de tocar classList, se
// sobreescriben solo los valores de color: se leen en vivo los del :root real
// (para no duplicarlos a mano y que se desincronicen de index.css) y se
// aplican como estilo inline en el <html> del clon.
function getRootLightDeclarations(): string {
  const declarations: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // hoja de otro origen (CORS): no puede ser la de nuestro tema
    }
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText.split(",").map((s) => s.trim()).includes(":root")
      ) {
        declarations.push(rule.style.cssText);
      }
    }
  }
  return declarations.join(" ");
}

function forceLightMode(clonedDoc: Document): void {
  const lightDeclarations = getRootLightDeclarations();
  if (lightDeclarations) {
    clonedDoc.documentElement.style.cssText += ` ${lightDeclarations}`;
  }
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
  proxy: TILE_PROXY_URL,
  imageTimeout: TILE_IMAGE_TIMEOUT_MS,
  // El validador de html2canvas-pro rechaza por defecto proxies en
  // localhost/IP privada (contexto "proxy"); en dev, TILE_PROXY_URL
  // resuelve a http://localhost:<puerto> y caería en esa restricción.
  validator: createDefaultValidator({ allowLocalhostProxy: true }),
};

export async function captureChart(
  el: HTMLElement,
  backgroundColor: string | null,
  scale?: number
): Promise<HTMLCanvasElement> {
  return withTimeout(
    html2canvas(el, {
      backgroundColor,
      scale,
      ...html2canvasBaseOptions,
      onclone: (clonedDoc) => forceLightMode(clonedDoc),
    }),
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
      onclone: (clonedDoc, clonedEl) => {
        forceLightMode(clonedDoc);
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
