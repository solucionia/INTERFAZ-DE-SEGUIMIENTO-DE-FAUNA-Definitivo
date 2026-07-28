// Fuente única de verdad para los proveedores de tiles de mapa usados por
// MapLayerControl (cliente) y validados por el proxy de exportación
// (server/tileProxy.ts). Si se añade o cambia un proveedor, este es el único
// archivo a tocar para que cliente y allowlist del servidor no diverjan.

export const OSM_SUBDOMAINS = ["a", "b", "c"] as const;
export const OSM_TILE_HOST_SUFFIX = "tile.openstreetmap.org";
export const GOOGLE_TILE_HOST = "mt1.google.com";

export const OSM_TILE_HOSTS: readonly string[] = OSM_SUBDOMAINS.map(
  (s) => `${s}.${OSM_TILE_HOST_SUFFIX}`
);

export const ALLOWED_TILE_HOSTS: readonly string[] = [...OSM_TILE_HOSTS, GOOGLE_TILE_HOST];

export const OSM_TILE_URL_TEMPLATE = `https://{s}.${OSM_TILE_HOST_SUFFIX}/{z}/{x}/{y}.png`;

export const GOOGLE_TILE_LAYERS = {
  satellite: "s",
  hybrid: "y",
  terrain: "p",
} as const;

export type GoogleTileLayerKey = keyof typeof GOOGLE_TILE_LAYERS;

export function googleTileUrlTemplate(layer: GoogleTileLayerKey): string {
  return `https://${GOOGLE_TILE_HOST}/vt/lyrs=${GOOGLE_TILE_LAYERS[layer]}&x={x}&y={y}&z={z}`;
}

const OSM_PATH_PATTERN = /^\/\d{1,2}\/\d+\/\d+\.png$/;
// La plantilla de Google no lleva "?" antes de lyrs= (así es como sirve tiles
// ese endpoint no oficial: "/vt/lyrs=s&x=..&y=..&z=.."), así que todo el
// querystring cae dentro de pathname, no de url.search/searchParams. Se valida
// con un patrón anclado sobre pathname en vez de leer searchParams.
const GOOGLE_PATH_PATTERN = /^\/vt\/lyrs=(s|y|p)&x=\d+&y=\d+&z=\d{1,2}$/;

// Valida una URL de tile absoluta antes de que el proxy del servidor la
// reenvíe. Compara por hostname exacto (nunca substring/includes, para que no
// se pueda burlar con "tile.openstreetmap.org.evil.com" o querystrings
// falsificados) y exige un patrón de ruta acorde al proveedor, como defensa
// adicional si algún día ese host sirve algo más que tiles.
export function isAllowedTileUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (!ALLOWED_TILE_HOSTS.includes(url.hostname)) return false;

  if (url.hostname === GOOGLE_TILE_HOST) {
    return GOOGLE_PATH_PATTERN.test(url.pathname);
  }

  return OSM_PATH_PATTERN.test(url.pathname);
}
