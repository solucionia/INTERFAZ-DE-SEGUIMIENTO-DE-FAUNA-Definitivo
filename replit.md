# WildTrack - Sistema de Seguimiento de Fauna Silvestre

## Overview
Wildlife tracking system that connects to the Movebank API for monitoring animal studies. Built with React, Express, PostgreSQL, and Passport.js. Includes an event detection system that analyzes accelerometer data to identify animal behaviors.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Recharts + Leaflet
- **Backend**: Express + TypeScript + Passport.js sessions + Nodemailer
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Passport.js local strategy with bcrypt, sessions stored in PostgreSQL

## Project Structure
- `shared/schema.ts` - Data models: users, studies, userStudies, individuals, deployments, speciesProfiles, detectedEvents, alertLogs; EVENT_LABELS/EVENT_COLORS/EVENT_SEVERITY constants
- `server/auth.ts` - Passport.js setup, session config, requireAuth/requireSuperuser middleware
- `server/storage.ts` - DatabaseStorage class implementing IStorage interface
- `server/movebank.ts` - Movebank API integration (CSV parsing, Basic Auth)
- `server/eventDetection.ts` - Event detection algorithms (mortality, detachment, fight, feeding, incubation) with configurable thresholds
- `server/emailService.ts` - Email alert service using Nodemailer with Google Maps links
- `server/scheduler.ts` - Cron scheduler for automated event detection and emission checks (node-cron)
- `server/routes.ts` - All API endpoints
- `server/db.ts` - PostgreSQL pool + Drizzle instance
- `client/src/lib/auth.tsx` - AuthProvider context with login/register/logout
- `client/src/components/app-sidebar.tsx` - Main sidebar with study list and admin links
- `client/src/pages/auth-page.tsx` - Login/Register page
- `client/src/pages/dashboard.tsx` - Main dashboard
- `client/src/pages/study-detail.tsx` - Study detail with individual animals list
- `client/src/pages/study-visualization.tsx` - Data visualization with accelerometer chart + GPS map + event overlay
- `client/src/pages/admin-studies.tsx` - CRUD for studies with species profile assignment (superuser only)
- `client/src/pages/admin-users.tsx` - User listing (superuser only)
- `client/src/pages/admin-species-profiles.tsx` - Species profile management with threshold editing (superuser only)
- `client/src/pages/emission-monitor.tsx` - Emission monitor with search and configurable email alerts

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

## Event Detection
- **Mortality**: Detects prolonged stationary accelerometer (low variance across all axes)
- **Detachment**: Detects X-axis out of expected range (transmitter may have fallen off)
- **Fight/Predation**: Detects Z-axis alternating patterns indicating struggle
- **Feeding**: Detects sustained high Y-axis values indicating feeding behavior
- **Incubation/Flight**: Detects contained Y-axis with periodic movement bursts
- Thresholds stored as JSON in species_profiles table for maximum flexibility
- Detection runs server-side on-demand via POST /api/studies/:id/detect-events
- Email deduplication via alert_logs table

## API Routes
- POST /api/auth/register, /api/auth/login, /api/auth/logout, GET /api/auth/me
- GET /api/studies, GET /api/studies/:id, POST /api/studies, PATCH /api/studies/:id, DELETE /api/studies/:id
- GET/POST /api/studies/:id/users, DELETE /api/studies/:studyId/users/:userId
- GET /api/studies/:id/individuals, GET /api/studies/:id/deployments
- GET /api/studies/:id/events?individuals=...&sensor_type=...&timestamp_start=...&timestamp_end=... (GPS: 653, Acc: 2365683)
- POST /api/studies/:id/sync (triggers Movebank fetch)
- GET /api/users (superuser only)
- GET/POST /api/species-profiles, GET/PATCH/DELETE /api/species-profiles/:id (superuser only)
- GET /api/studies/:id/detected-events?timestamp_start=...&timestamp_end=...
- POST /api/studies/:id/detect-events (triggers analysis)
- GET /api/monitor/emissions?days=N (check non-emitting animals)
- GET/POST /api/emission-alerts, PATCH/DELETE /api/emission-alerts/:id

## Environment Variables
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM - Email alert configuration
- DATABASE_URL - PostgreSQL connection
- SESSION_SECRET - Express session secret

## User Preferences
- Language: Spanish (UI text in Spanish)
- Dark theme by default
- Scientific/technical design aesthetic
