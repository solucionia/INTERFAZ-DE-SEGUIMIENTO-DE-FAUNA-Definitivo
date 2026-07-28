import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: true,
  message: { message: "Demasiados intentos. Espere un minuto antes de intentar de nuevo." },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: true,
  skip: (req: Request) => {
    return (
      req.path.startsWith("/api/auth/login") ||
      req.path.startsWith("/api/auth/register") ||
      req.path.startsWith("/api/tile-proxy")
    );
  },
  message: { message: "Límite de peticiones alcanzado. Espere un momento." },
});

export const movebankLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: true,
  message: { message: "Demasiadas consultas a Movebank. Espere un momento." },
});

// Una sola exportación de mapa puede pedir 100-200 tiles, por eso va aparte
// del apiLimiter general (que lo excluye explícitamente, ver arriba). Se
// limita por usuario autenticado (la ruta exige requireAuth) en vez de por
// IP: no se pudo confirmar si hay un load balancer delante de nginx en la VM
// de GCP, y de haberlo, "trust proxy" tendría que contar 2 saltos en vez de 1
// para que req.ip fuera el del cliente real. Usar el id de usuario evita que
// este limiter dependa de esa configuración de red.
export const tileProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: true,
  keyGenerator: (req: Request) => (req as any).user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: { message: "Demasiadas peticiones de tiles. Espere un momento." },
});
