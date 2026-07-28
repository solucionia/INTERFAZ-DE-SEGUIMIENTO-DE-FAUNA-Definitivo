# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WildTrack is a wildlife-tracking web app (React + Express + PostgreSQL/Drizzle) that ingests GPS/accelerometer
data from the Movebank API and Ornitela devices, runs server-side event detection (mortality, zone deviation,
low activity, electrocution, etc.), and visualizes it on maps/charts. UI text and code comments are in Spanish;
respond and write UI copy in Spanish unless told otherwise.

`replit.md` is the living, detailed spec of the domain logic (thresholds, dedup rules, table columns, "why"
notes for non-obvious behavior) — read it before touching event detection, Ornitela sync, or immobility/alerting
code. Keep it updated when you change that logic; this file only covers structure and commands.

## Commands

```bash
npm run dev      # start dev server (tsx server/index.ts), serves API + Vite client on :5000
npm run build     # script/build.ts: vite build (client) + esbuild bundle (server) -> dist/
npm run start     # run production build (dist/index.cjs), requires npm run build first
npm run check     # tsc typecheck, no emit
npm run db:push   # drizzle-kit push — sync shared/schema.ts to DATABASE_URL
```

There is no test suite and no lint script configured in this repo.

To import server modules (e.g. one-off scripts under `scripts/`) without booting the HTTP server, scheduler,
or SFTP watcher, set `WILDTRACK_NO_BOOT=1` (checked in `server/index.ts`).

## Architecture

### Layout
- `client/src/` — React app (Vite root is `client/`). Routing via `wouter` (`client/src/App.tsx`), server
  state via TanStack Query, maps via Leaflet/react-leaflet, charts via Recharts, UI via shadcn (`components/ui`).
  Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`, `@assets/*` → `attached_assets/*`.
- `server/` — Express + TypeScript, single process. `routes.ts` (~4k lines) registers essentially all
  HTTP endpoints and holds a lot of request-scoped business logic (access-scoping, SSE streaming, CSV export
  helpers) rather than being split into controllers — expect to search within it rather than assuming a
  per-resource file exists.
- `shared/schema.ts` — single source of truth for Drizzle table defs, Zod insert/validation schemas, and
  domain constants shared by client and server (`EVENT_TYPES`, `EVENT_COLORS`/`EVENT_LABELS`,
  `DEFAULT_THRESHOLDS`, `BEHAVIOR_TYPES`, `HDOP_QUALITY_THRESHOLD`, etc.).
- `server/storage.ts` — all DB access goes through the `IStorage` interface / `DatabaseStorage` implementation
  (exported singleton `storage`). Routes and detectors call `storage.*`, never `db` directly, for anything
  beyond ad-hoc scripts. When adding a query, add the method to `IStorage` first.
- `scripts/` — standalone Node/tsx scripts (backfills, debugging, cron trigger) run outside the main server.

### Data & environments
- Dev (Replit "Helium") and prod (Neon) are **separate Postgres instances** — migrations/data fixes must be
  applied to each independently; nothing dev-side affects prod.
- Movebank and Ornitela responses are cached locally (`cached_gps_events`, `cached_acc_events`,
  `cached_fetch_ranges`) for a cache-first read path and to avoid re-hitting rate-limited external APIs.
  Range bookkeeping/gap detection lives in `getFetchedRanges`/`computeUncoveredGaps` in `storage.ts`.
- External credentials (e.g. Movebank) are stored encrypted at rest (AES-256-GCM, `server/encryption.ts`,
  key from `ENCRYPTION_KEY`); `getStudyDecrypted` is the decrypt-on-read accessor.

### Auth & access control
- Passport local strategy + `express-session` backed by Postgres (`server/auth.ts`). Three roles: `superuser`,
  `user`, `observer`. Route guards: `requireAuth`, `requireSuperuser`, `checkRole(...roles)` (all in `auth.ts`).
- Study-level access is scoped per user via `user_studies` (`getStudiesForUser`, `requireStudyAccess` middleware
  in `routes.ts`) — most non-admin endpoints filter through this rather than a global allow-all.
- Individuals (animals) can be marked inactive (`individuals.is_active`); inactive animals are excluded from
  alert generation everywhere (cron detection, manual detect-events, immobility analysis) but keep visible history.

### Event detection & alerting
Detection logic is split across `server/eventDetection.ts` (accelerometer-behavior detectors, ACC low-activity
and electrocution — Ornitela-only, gated on `study.ornitelaEnabled`), `server/immobilityDetector.ts`
(mortality via ACC variance primary / GPS radius fallback, no-transmission, zone-deviation), and
`server/scheduler.ts` (cron orchestration, dedup, resolution, email alerts via `server/emailService.ts`).
Recurring behaviors to preserve when touching this code:
- New/changed alert types need entries in `EVENT_TYPES`/`EVENT_COLORS`/`EVENT_LABELS`/`EVENT_SEVERITY`
  (`shared/schema.ts`) and, if thresholded, in `eventThresholdsSchema`/`DEFAULT_THRESHOLDS`/`normalizeThresholds`
  so existing species profiles inherit sane defaults.
- Alerts dedupe against a 24h unresolved window (`findRecentUnresolvedDetectedEvent`) before persisting, and
  get auto-resolved (`markDetectedEventsResolved`) when the underlying condition clears.
- A sync that writes new cached GPS/ACC rows should trigger `analyzeImmobility` in the background
  (`triggerImmobilityAnalysisInBackground`, fire-and-forget via `setImmediate`) rather than block the sync.

### Ornitela integration
Two independent ingestion paths, both writing into the same `cached_gps_events`/`cached_acc_events` tables:
- **cpanel scrape**: login + HTML parse (`cheerio`) + per-IMEI CSV download, exposed as a paginated SSE endpoint
  (`POST /api/studies/:id/ornitela-sync`) to avoid HTTP timeouts on large device counts.
- **SFTP watcher** (`server/services/sftpWatcher.ts`, started from `server/index.ts`): polls every 2 min,
  imports CSVs via `parseOrnitelaCsv`, then **moves** processed files to `/uploads/processed` — meaning only
  one environment may ever consume a given file. `ORNITELA_SFTP_DISABLED=1` must stay set in development so
  dev doesn't steal files from production's feed.

### Config & thresholds
Runtime-tunable settings live in the `app_settings` key/value table (`getSetting`/`setSetting`), not env vars
or code constants, when they're meant to be admin-editable (e.g. `no_transmission_threshold_days`, editable at
`/admin/alerts`, superuser-only). Species-specific detection thresholds live on `species_profiles` instead.

## Environment variables

See `replit.md` → "Variables de entorno" for the full list and behavior notes (`ENCRYPTION_KEY`,
`ORNITELA_SFTP_*`, `ORNITELA_DEFAULT_STUDY_ID`, `SYNC_URL`/`SYNC_SECRET` for `scripts/cron-sync.mjs`,
`IMMOBILITY_ALERT_EMAIL`, `IMMOBILITY_CRON_INTERVAL`). Local secrets live in `.env` (gitignored) and are loaded
into the PM2 process via `ecosystem.config.cjs` in production — never commit real values from that file.
