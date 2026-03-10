import { log } from "./index";

const DAILY_LIMIT = 100;
const COOLDOWN_HOURS = 2;

class MovebankRateLimiter {
  private blockedUntil: number | null = null;
  private dailyCount: number = 0;
  private dailyResetAt: number = this.getNextMidnightUTC();

  private getNextMidnightUTC(): number {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return tomorrow.getTime();
  }

  private checkDailyReset(): void {
    if (Date.now() >= this.dailyResetAt) {
      this.dailyCount = 0;
      this.dailyResetAt = this.getNextMidnightUTC();
      log("Movebank: Contador diario reseteado", "movebank");
    }
  }

  isBlocked(): { blocked: boolean; blockedUntil: Date | null; reason: string } {
    this.checkDailyReset();

    if (this.blockedUntil && Date.now() < this.blockedUntil) {
      const until = new Date(this.blockedUntil);
      return {
        blocked: true,
        blockedUntil: until,
        reason: `Movebank está temporalmente limitado. Se podrá sincronizar de nuevo a las ${this.formatTime(until)}`,
      };
    }

    if (this.blockedUntil && Date.now() >= this.blockedUntil) {
      this.blockedUntil = null;
    }

    if (this.dailyCount >= DAILY_LIMIT) {
      const resetAt = new Date(this.dailyResetAt);
      return {
        blocked: true,
        blockedUntil: resetAt,
        reason: `Límite diario de ${DAILY_LIMIT} peticiones a Movebank alcanzado. Se restablece a las ${this.formatTime(resetAt)}`,
      };
    }

    return { blocked: false, blockedUntil: null, reason: "" };
  }

  recordRequest(): void {
    this.checkDailyReset();
    this.dailyCount++;
    if (this.dailyCount % 10 === 0) {
      log(`Movebank: ${this.dailyCount}/${DAILY_LIMIT} peticiones hoy`, "movebank");
    }
  }

  record429(): void {
    this.blockedUntil = Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000;
    const until = new Date(this.blockedUntil);
    log(`Movebank 429 detectado. Bloqueado hasta ${this.formatTime(until)} (${COOLDOWN_HOURS}h cooldown)`, "movebank");
  }

  getDailyCount(): number {
    this.checkDailyReset();
    return this.dailyCount;
  }

  getStatus(): { blocked: boolean; blockedUntil: string | null; dailyCount: number; dailyLimit: number; reason: string } {
    const { blocked, blockedUntil, reason } = this.isBlocked();
    return {
      blocked,
      blockedUntil: blockedUntil ? blockedUntil.toISOString() : null,
      dailyCount: this.dailyCount,
      dailyLimit: DAILY_LIMIT,
      reason,
    };
  }

  private formatTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
}

export const movebankRateLimiter = new MovebankRateLimiter();

export function movebankDelay(ms: number = 2000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
