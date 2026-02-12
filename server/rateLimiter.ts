import rateLimit from "express-rate-limit";
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
    return req.path.startsWith("/api/auth/login") || req.path.startsWith("/api/auth/register");
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
