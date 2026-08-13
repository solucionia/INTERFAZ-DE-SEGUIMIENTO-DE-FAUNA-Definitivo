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
