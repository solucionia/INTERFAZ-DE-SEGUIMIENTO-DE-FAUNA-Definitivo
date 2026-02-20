# WildTrack - Sistema de Seguimiento de Fauna Silvestre

## Overview
Wildlife tracking system that connects to the Movebank API for monitoring animal studies. Built with React, Express, PostgreSQL, and Passport.js. Includes an event detection system that analyzes accelerometer data to identify animal behaviors.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Recharts + Leaflet
- **Backend**: Express + TypeScript + Passport.js sessions + Nodemailer
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Passport.js local strategy with bcrypt, sessions stored in PostgreSQL

## Project Structure
- `shared/schema.ts` - Data models: users, studies, userStudies, individuals, deployments, speciesProfiles, detectedEvents, alertLogs, emissionAlerts, cronLogs, savedAnalyses, cachedGpsEvents, cachedAccEvents, cachedFetchRanges; EVENT_LABELS/EVENT_COLORS/EVENT_SEVERITY/ANALYSIS_TYPES/ANALYSIS_LABELS constants
- `server/auth.ts` - Passport.js setup, session config, requireAuth/requireSuperuser middleware
- `server/storage.ts` - DatabaseStorage class implementing IStorage interface
- `server/movebank.ts` - Movebank API integration (CSV parsing, Basic Auth)
- `server/eventDetection.ts` - Event detection algorithms (mortality, detachment, fight, feeding, incubation) with configurable thresholds
- `server/emailService.ts` - Email alert service using Nodemailer with Google Maps links
- `server/immobilityDetector.ts` - GPS-based immobility/mortality detection (speed analysis, position change, transmission gaps)
- `server/scheduler.ts` - Cron scheduler for automated event detection, emission checks, and immobility analysis (node-cron)
- `server/routes.ts` - All API endpoints
- `server/db.ts` - PostgreSQL pool + Drizzle instance
- `client/src/lib/auth.tsx` - AuthProvider context with login/register/logout
- `client/src/components/app-sidebar.tsx` - Main sidebar with study list and admin links
- `client/src/pages/auth-page.tsx` - Login/Register page
- `client/src/pages/dashboard.tsx` - Main dashboard
- `client/src/pages/study-detail.tsx` - Study detail with individual animals list + search filter
- `client/src/components/animal-search.tsx` - Reusable animal search with autocomplete, multi/single select, accent-insensitive filtering
- `client/src/components/global-animal-search.tsx` - Global Ctrl+K animal search dialog using cmdk
- `client/src/pages/study-visualization.tsx` - Data visualization with accelerometer chart + GPS map + event overlay
- `client/src/pages/admin-studies.tsx` - CRUD for studies with species profile assignment (superuser only)
- `client/src/pages/admin-users.tsx` - User listing (superuser only)
- `client/src/pages/admin-species-profiles.tsx` - Species profile management with threshold editing (superuser only)
- `client/src/pages/emission-monitor.tsx` - Emission monitor with search and configurable email alerts
- `client/src/pages/immobility-monitor.tsx` - Immobility/mortality detector with GPS analysis, configurable thresholds, map, and alert tables
- `server/geoAnalysis.ts` - Geospatial analysis engine using Turf.js (comprehensive: multi-percent MCP/Kernel with HREF+LSCV bandwidth, eccentricity, linearity, distance stats, sampling)
- `client/src/pages/geo-analysis.tsx` - Geospatial analysis UI with comprehensive metrics panels, graduated map colors, percentage toggles, multi-animal comparison table
- `client/src/pages/alert-history.tsx` - Alert history with filtering, read/resolved status, pagination
- `client/src/pages/raw-data.tsx` - Raw GPS/accelerometer data table with CSV export
- `client/src/components/breadcrumbs.tsx` - Hierarchical breadcrumb navigation
- `server/rateLimiter.ts` - Rate limiting middleware (auth: 5/min, API: 100/min, Movebank: 20/min)
- `client/src/pages/import-csv.tsx` - CSV import page with drag-and-drop, preview, and results summary

## Key Features
1. Two roles: superuser (first registered user) and normal user
2. Study CRUD with Movebank credentials per study
3. User-to-study assignment (superuser only)
4. Movebank API sync for individuals and deployments
5. Local caching of Movebank data in PostgreSQL
6. Dark/light theme toggle
7. Collapsible sidebar with Shadcn sidebar primitives
8. Data visualization page with accelerometer chart (Recharts) and GPS map (Leaflet)
9. Bidirectional chart-map synchronization (click chart → highlight map, click map → highlight chart)
10. Multi-animal support with color-coded tracks and per-animal chart filtering
11. Zoom by drag on accelerometer chart with visual selection area
12. Resizable split panel layout (accelerometer chart top, GPS map bottom)
13. Event detection system with 5 event types: mortality, transmitter detachment, fight/predation, feeding, incubation/flight
14. Species profiles with configurable thresholds per event type (accordion UI)
15. Email alerts for critical/high severity events via SMTP (Nodemailer)
16. Event overlay bands on accelerometer chart with color-coded event types
17. Event list panel with click-to-navigate (zooms chart + map to event location)
18. Google Maps links in event cards for location viewing
19. Emission monitor: detect animals that stopped transmitting with configurable day threshold
20. Emission alert system: users configure email alerts for non-transmitting animals with daily deduplication
21. Automated cron scheduler (node-cron): runs event detection and emission checks every 6 hours
22. Active/inactive animal indicators on study detail page (green=active, grayed=inactive)
23. Geospatial analysis using Turf.js (@turf/turf): MCP home range, Kernel density, distance traveled, movement speed
24. Analysis results visualized on Leaflet map (polygons) and Recharts (distance/speed charts)
25. Saved analyses with history, reload, and CSV export
26. Local data cache for GPS/accelerometer events with cache-first strategy and gap-filling
27. Force reload from Movebank button in visualization page
28. Cache statistics endpoint for monitoring cached data
29. CSV import: drag-and-drop upload supporting two formats (Movebank and Base Lunar), auto-detect format by separator/columns, preview with column mapping, batch insert with duplicate detection, auto-create individuals with metadata (taxon, sex from Base Lunar)
30. Comprehensive geospatial analysis: multi-percent MCP (20-100% in 5% steps), multi-percent Kernel (5-95% in 5% steps), dual bandwidth methods (HREF Silverman + LSCV cross-validation), eccentricity (PCA), linearity, full distance statistics, random sampling for >10k points, multi-animal comparison table, graduated map colors with percentage toggles, CSV metrics export
31. R-compatible CSV exports: VALORES.csv (metrics with m² areas), HRREF.csv (Kernel areas), MPC.csv (MCP areas), GeoJSON (polygons + trajectory)
32. Area-vs-percentage charts for HRREF and MPC, visual bars for eccentricity/linearity, trajectory overlay on map, export dropdown menu

## Event Detection
- **Mortality**: Detects prolonged stationary accelerometer (low variance across all axes)
- **Detachment**: Detects X-axis out of expected range (transmitter may have fallen off)
- **Fight/Predation**: Detects Z-axis alternating patterns indicating struggle
- **Feeding**: Detects sustained high Y-axis values indicating feeding behavior
- **Incubation/Flight**: Detects contained Y-axis with periodic movement bursts
- Thresholds stored as JSON in species_profiles table for maximum flexibility
- Detection runs server-side on-demand via POST /api/studies/:id/detect-events
- Email deduplication via alert_logs table

## Immobility / Mortality Detection
- **Immobility**: GPS-based detection of prolonged stationary behavior (speed < threshold + position change < threshold)
- **No Transmission**: Detects animals that stopped transmitting GPS data beyond configurable hours
- Configurable: hoursToAnalyze (96h), immobilityThresholdHours (24h), noTransmissionThresholdHours (48h), speedThreshold (0.5 m/s), positionChangeThreshold (0.0001°)
- Analyses cached GPS data (no Movebank call), runs via POST /api/studies/:id/immobility-analysis
- Cron job runs every 6h alongside event detection and emission checks
- Email alerts for immobility events via sendImmobilityAlertEmail
- Frontend: /immobility page with study selector, config sliders, summary cards, Leaflet map (red/orange/green markers), alert tables

## API Routes
- POST /api/auth/register, /api/auth/login, /api/auth/logout, GET /api/auth/me
- GET /api/individuals/all (all individuals across user-accessible studies with studyName)
- GET /api/studies, GET /api/studies/:id, POST /api/studies, PATCH /api/studies/:id, DELETE /api/studies/:id
- GET/POST /api/studies/:id/users, DELETE /api/studies/:studyId/users/:userId
- GET /api/studies/:id/individuals, GET /api/studies/:id/deployments
- GET /api/studies/:id/events?individuals=...&sensor_type=...&timestamp_start=...&timestamp_end=...&force=true (GPS: 653, Acc: 2365683, cache-first with gap-filling)
- POST /api/studies/:id/sync (triggers Movebank fetch)
- GET /api/users (superuser only)
- GET/POST /api/species-profiles, GET/PATCH/DELETE /api/species-profiles/:id (superuser only)
- GET /api/studies/:id/detected-events?timestamp_start=...&timestamp_end=...
- POST /api/studies/:id/detect-events (triggers analysis)
- GET /api/monitor/emissions?days=N (check non-emitting animals)
- GET/POST /api/emission-alerts, PATCH/DELETE /api/emission-alerts/:id
- POST /api/studies/:id/analysis (execute Turf.js geospatial analysis)
- GET /api/studies/:id/analyses (list saved analyses for study)
- GET /api/analyses/:id, DELETE /api/analyses/:id (get/delete saved analysis)
- GET /api/analyses/:id/export-csv (export analysis metrics as VALORES.csv with m² areas)
- GET /api/analyses/:id/export-hrref (export Kernel HREF/LSCV areas as HRREF.csv)
- GET /api/analyses/:id/export-mpc (export MCP areas as MPC.csv)
- GET /api/analyses/:id/export-geojson (export full GeoJSON with polygons + trajectory)
- GET /api/dashboard/summary (dashboard statistics)
- GET /api/alerts/history?studyId=...&eventType=...&readStatus=...&resolvedStatus=...&dateStart=...&dateEnd=...&page=... (alert history with filtering/pagination)
- PATCH /api/alerts/:id/read, /api/alerts/:id/resolve (mark alert read/resolved)
- POST /api/alerts/mark-read (bulk mark alerts as read)
- GET /api/studies/:id/export-kml (KML export for Google Earth)
- POST /api/studies/:id/export-visualization (multi-format export: CSV, KMZ, SHP/GeoJSON ZIP, GeoJSON; body: {individualIds, startDate, endDate, format})
- GET /api/cache/stats (cache statistics: total GPS/Acc records, per-study breakdown)
- POST /api/studies/:id/import-csv (multipart/form-data: file + dataType, batch CSV import with duplicate detection)
- POST /api/studies/:id/immobility-analysis (GPS-based immobility/mortality analysis with configurable thresholds)
- GET /api/studies/:id/immobility-status (latest mortality events for study, last 30 days)

## Data Cache
- GPS and accelerometer data from Movebank is cached locally in `cached_gps_events` and `cached_acc_events` tables
- Cache-first strategy: queries check local cache, only fetch from Movebank for missing time ranges
- Explicit range tracking via `cached_fetch_ranges` table: records which time ranges have been fetched per animal/sensor
- Gap-filling uses range tracking: computes uncovered subranges by comparing requested range against union of fetched ranges, fetches only missing gaps
- Ranges are merged on insert (overlapping/adjacent ranges are consolidated)
- Cron job automatically caches data it fetches during event detection
- Force reload (`force=true` query param) bypasses cache and fetches fresh data from Movebank, updating cache
- UNIQUE constraint on (study_id, individual_local_identifier, timestamp) prevents duplicates
- Cache is cascaded on study deletion

## Credential Encryption
- Movebank credentials (username/password) are encrypted at rest using AES-256-GCM
- `server/encryption.ts` - encrypt/decrypt module using Node.js crypto
- `server/migrateEncrypt.ts` - Auto-migration script that encrypts plaintext credentials on startup
- Encrypted format: `iv_hex:authTag_hex:ciphertext_hex`
- Credentials are masked as "••••••••" in API responses to the UI
- Decryption happens only when connecting to Movebank API
- Edit form allows empty credential fields to keep existing values unchanged

## Environment Variables
- ENCRYPTION_KEY - 64-char hex string (32 bytes) for AES-256-GCM encryption of Movebank credentials
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM - Email alert configuration
- DATABASE_URL - PostgreSQL connection
- SESSION_SECRET - Express session secret

## User Preferences
- Language: Spanish (UI text in Spanish)
- Dark theme by default
- Scientific/technical design aesthetic
