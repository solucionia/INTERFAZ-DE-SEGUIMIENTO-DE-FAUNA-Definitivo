# WildTrack - Sistema de Seguimiento de Fauna Silvestre

## Overview
WildTrack is a comprehensive wildlife tracking system designed to monitor animal studies by integrating with the Movebank API. It provides robust capabilities for data visualization, event detection, geospatial analysis, and automated alerting for various animal behaviors and statuses. The project aims to offer researchers a powerful tool for managing and analyzing wildlife movement data, enhancing ecological studies and conservation efforts.

## User Preferences
- Language: Spanish (UI text in Spanish)
- Dark theme by default
- Scientific/technical design aesthetic

## System Architecture
The system is built on a modern full-stack architecture. The frontend uses React with TypeScript, Tailwind CSS, Shadcn UI for components, Recharts for data visualization, and Leaflet for interactive maps. The backend is an Express application written in TypeScript, handling API requests, authentication, and business logic. PostgreSQL serves as the primary database, managed with Drizzle ORM. Authentication is implemented using Passport.js with local strategy and session management.

Key architectural features include:
- **Role-Based Access Control**: Three distinct user roles (superuser, user, observer) with granular permissions.
- **Data Synchronization**: Integration with the Movebank API for fetching individual and deployment data, with local caching in PostgreSQL for performance and offline access.
- **Event Detection System**: Server-side analysis of accelerometer data to identify specific animal behaviors (mortality, detachment, fight/predation, feeding, incubation/flight) based on configurable species profiles.
- **Immobility/Mortality Detection**: GPS-based analysis for detecting prolonged immobility or lack of transmission, with configurable thresholds.
- **Geospatial Analysis Engine**: Utilizes Turf.js for advanced home range analysis (MCP, Kernel density), distance traveled, and movement speed calculations, with comprehensive visualization and export options.
- **Alerting System**: Automated email notifications for critical events, immobility, and emission monitoring, with deduplication.
- **Data Import**: Support for importing CSV data from various sources (Movebank, Base Lunar, Ornitela) with format auto-detection and intelligent parsing.
- **Data Caching Strategy**: A cache-first approach for GPS and accelerometer data, including explicit range tracking and gap-filling to optimize Movebank API calls.
- **Credential Security**: Encryption of sensitive external credentials (e.g., Movebank) at rest using AES-256-GCM.
- **Ornitela Panel Sync**: Automated synchronization with Ornitela cpanel (login, HTML parsing with cheerio, CSV download per device IMEI) with configurable intervals and cron integration.
- **Movebank Rate Limiting**: Singleton rate limiter (`server/movebankRateLimit.ts`) tracks daily request count (100/day limit, resets at UTC midnight), detects HTTP 429 responses (triggers 2-hour cooldown), and enforces 2-second delays between sequential Movebank API calls. The dashboard shows a real-time request counter, and sync buttons are disabled when blocked. Cron jobs skip Movebank calls when rate-limited.
- **Automated Scheduling**: Cron jobs manage periodic tasks like event detection, emission checks, immobility analysis, and Ornitela sync.
- **Reference Data System**: Species catalog (`species` table: id, nombre_comun, nombre_cientifico) and Projects catalog (`projects` table: id, descripcion, id_especie FK). Individuals can be assigned to a project (`project_id` FK) and given a `history_number`. Seed data import endpoint (`POST /api/admin/import-reference-data`) loads 31 species and 61 projects idempotently. Admin pages at `/admin/ref-species` and `/admin/ref-projects` with full CRUD.
- **Individual Project Assignment**: Edit dialog on study-detail includes Proyecto dropdown and Nº Historial field. History numbers render as external links to `http://192.168.2.1/buho/formulario_historiales.php?editar_exp={history_number}`. Project and Nº Historial columns added to the individuals table.
- **Project Filtering**: All animal-listing pages (study-detail, geo-analysis, study-visualization, last-positions) include a project filter dropdown that appears when any individuals in the current context have projects assigned. The filter narrows the displayed/selectable animals to those belonging to the chosen project.
- **UI/UX**: Features a dark/light theme toggle, collapsible sidebar, interactive charts and maps with bidirectional synchronization, and intuitive admin interfaces for managing studies, users, species profiles, species catalog, and projects.

## External Dependencies
- **Movebank API**: Primary source for animal tracking data (individuals, deployments, GPS/accelerometer events).
- **PostgreSQL**: Relational database for all application data, cached Movebank data, and session storage.
- **Nodemailer**: Used for sending email alerts and notifications via SMTP.
- **Google Maps**: Links provided in event alerts for easy location viewing.
- **Turf.js**: JavaScript library for advanced geospatial analysis.
- **Ornitela**: Integration for syncing device data from Ornitela panels via HTML parsing and CSV import.