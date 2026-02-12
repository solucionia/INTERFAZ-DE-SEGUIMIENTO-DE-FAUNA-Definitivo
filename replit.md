# WildTrack - Sistema de Seguimiento de Fauna Silvestre

## Overview
Wildlife tracking system that connects to the Movebank API for monitoring animal studies. Built with React, Express, PostgreSQL, and Passport.js.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Recharts
- **Backend**: Express + TypeScript + Passport.js sessions
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Passport.js local strategy with bcrypt, sessions stored in PostgreSQL

## Project Structure
- `shared/schema.ts` - Data models: users, studies, userStudies, individuals, deployments
- `server/auth.ts` - Passport.js setup, session config, requireAuth/requireSuperuser middleware
- `server/storage.ts` - DatabaseStorage class implementing IStorage interface
- `server/movebank.ts` - Movebank API integration (CSV parsing, Basic Auth)
- `server/routes.ts` - All API endpoints
- `server/db.ts` - PostgreSQL pool + Drizzle instance
- `client/src/lib/auth.tsx` - AuthProvider context with login/register/logout
- `client/src/components/app-sidebar.tsx` - Main sidebar with study list
- `client/src/pages/auth-page.tsx` - Login/Register page
- `client/src/pages/dashboard.tsx` - Main dashboard
- `client/src/pages/study-detail.tsx` - Study detail with individual animals list
- `client/src/pages/admin-studies.tsx` - CRUD for studies (superuser only)
- `client/src/pages/admin-users.tsx` - User listing (superuser only)

## Key Features
1. Two roles: superuser (first registered user) and normal user
2. Study CRUD with Movebank credentials per study
3. User-to-study assignment (superuser only)
4. Movebank API sync for individuals and deployments
5. Local caching of Movebank data in PostgreSQL
6. Dark/light theme toggle
7. Collapsible sidebar with Shadcn sidebar primitives

## API Routes
- POST /api/auth/register, /api/auth/login, /api/auth/logout, GET /api/auth/me
- GET /api/studies, GET /api/studies/:id, POST /api/studies, PATCH /api/studies/:id, DELETE /api/studies/:id
- GET/POST /api/studies/:id/users, DELETE /api/studies/:studyId/users/:userId
- GET /api/studies/:id/individuals, GET /api/studies/:id/deployments
- POST /api/studies/:id/sync (triggers Movebank fetch)
- GET /api/users (superuser only)

## User Preferences
- Language: Spanish (UI text in Spanish)
- Dark theme by default
- Scientific/technical design aesthetic
