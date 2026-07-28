import type { Request, Response } from "express";
import { isAllowedTileUrl } from "@shared/tileProviders";

const MAX_TILE_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 8000;
const CACHE_MAX_ENTRIES = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  body: Buffer;
  contentType: string;
  cachedAt: number;
}

// LRU simple en memoria: los tiles de una z/x/y dada casi nunca cambian, y el
// proceso se reinicia en cada deploy, así que un TTL largo + tope de tamaño
// basta sin necesitar una dependencia externa.
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key: string, entry: CacheEntry): void {
  cache.set(key, entry);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

// Reenvía peticiones de tiles de mapa (OSM/Google) para que html2canvas las
// reciba same-origin y no manche el canvas ("tainted canvas"), sin depender
// de que el proveedor mande cabeceras CORS de forma consistente. Solo se usa
// durante la exportación de PNG/PDF (ver client/src/lib/mapExport.ts), nunca
// para el mapa interactivo normal.
export async function tileProxyHandler(req: Request, res: Response): Promise<void> {
  const rawUrl = req.query.url;
  if (typeof rawUrl !== "string" || !isAllowedTileUrl(rawUrl)) {
    res.status(400).json({ message: "URL de tile no permitida" });
    return;
  }

  const cached = cacheGet(rawUrl);
  if (cached) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(cached.body);
    return;
  }

  try {
    // redirect:"manual" es la mitigación clave contra SSRF vía redirect: un
    // host permitido que redirigiera a una IP interna (p.ej. el metadata
    // server de GCP) no se sigue automáticamente, se rechaza directamente.
    const upstream = await fetch(rawUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (upstream.type === "opaqueredirect" || (upstream.status >= 300 && upstream.status < 400)) {
      res.status(502).json({ message: "El proveedor de tiles devolvió una redirección; solicitud rechazada" });
      return;
    }
    if (!upstream.ok) {
      res.status(502).json({ message: `El proveedor de tiles respondió ${upstream.status}` });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      res.status(502).json({ message: "Respuesta del proveedor de tiles no es una imagen" });
      return;
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_TILE_BYTES) {
      res.status(502).json({ message: "Tile demasiado grande" });
      return;
    }

    const body = Buffer.from(arrayBuffer);
    cacheSet(rawUrl, { body, contentType, cachedAt: Date.now() });

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(body);
  } catch (e: any) {
    res.status(502).json({ message: `Error obteniendo tile: ${e.message}` });
  }
}
