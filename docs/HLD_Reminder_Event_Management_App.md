# High-Level Design: Reminder & Event Management Application

**Engineering Design Document · v1.0**
**Author:** Senior Software Architect
**Review Type:** Staff Engineer Design Review
**Status:** Ready for Review

---

## Table of Contents

1. Executive Summary
2. Requirements Analysis
3. System Overview
4. Architecture Diagram
5. Component Breakdown
6. Data Flow Diagrams
7. Database Design
8. API Design
9. Push Notification Architecture
10. Scheduler Design
11. Security Design
12. Scalability Considerations
13. Deployment Architecture
14. Risks and Mitigations
15. Final Recommended Architecture

---

## 1. Executive Summary

This document presents a production-ready High-Level Design for a mobile-first Reminder & Event Management application. The system is built on a pragmatic, monolithic-first architecture using React Native (frontend), Node.js + Express (backend), and PostgreSQL (database), with Firebase Cloud Messaging for push notifications.

The core product promise is **zero missed events**. Every architectural decision is evaluated against that promise — reliable scheduling, fault-tolerant notification delivery, and a resilient retry strategy are first-class concerns, not afterthoughts.

The design deliberately avoids premature complexity. No Redis, no microservices, no Kubernetes — just a well-structured monolith that scales vertically first and horizontally later. The codebase is explicitly organized so that the future migration to Redis, message queues, and microservices is mechanical rather than a rewrite.

**Key architectural bets:**
- A modular monolith with clean internal boundaries (Auth, Event, Reminder, Notification, Dashboard) that can be extracted into services later without touching business logic.
- PostgreSQL doubles as both the system of record *and* the job queue, using `SELECT ... FOR UPDATE SKIP LOCKED` to emulate queue semantics without Redis.
- An abstracted `EventBus` interface so business logic never directly imports the scheduler or FCM client — when a real message broker arrives, only the implementation behind the interface changes.
- Every notification attempt is logged immutably, giving us an audit trail and the data needed for retry/backoff decisions.

---

## 2. Requirements Analysis

### 2.1 Functional Requirements

| Domain | Feature | Priority |
|---|---|---|
| User Management | Registration, Login, JWT Auth, Profile Management | P0 |
| Event Management | Create, Update, Delete, View, List Upcoming | P0 |
| Reminder Management | Single/Multiple Reminders, Custom Times, Mark Sent | P0 |
| Notification System | Push Notifications, Reliable Delivery, Retry, History | P0 |
| Dashboard | Today's Events, Upcoming Events, Overdue Events | P1 |

### 2.2 Non-Functional Requirements

| Concern | Target | How We Get There |
|---|---|---|
| Availability | 99.9% uptime (single region) | Health checks, process manager auto-restart, DB connection pooling |
| Notification Latency | < 30s from scheduled time | 1-minute cron tick + batched dispatch |
| API Response Time | p95 < 300ms | Indexed queries, connection pooling, lean middleware |
| Security | OWASP Top 10 compliant | JWT, bcrypt, Helmet, rate limiting, input validation |
| Scalability | Vertical first, horizontal-ready | Stateless API layer, externalized config, DB as single source of truth |
| Maintainability | Clean Architecture, typed end-to-end | TypeScript everywhere, layered modules, dependency injection |
| Fault Tolerance | No silent notification loss | Idempotent dispatch, row-level locking, immutable audit log |
| Extensibility | New event types/channels without rewrites | Enum-driven event types, channel-agnostic notification interface |

### 2.3 Constraints & Architectural Decisions

| Constraint | Decision | Rationale |
|---|---|---|
| No Redis | Scheduler state lives in PostgreSQL | `SKIP LOCKED` gives queue-like semantics for free |
| No microservices | Single Express app, modular by domain | Avoids network overhead and operational burden at this scale |
| No Kubernetes | Docker Compose locally, single container in prod | Team velocity matters more than orchestration at this stage |
| No event-driven architecture | Direct function calls behind an `EventBus` interface | Keeps it simple now, swappable later |

---

## 3. System Overview

The system consists of four primary components:

1. **React Native Mobile App** — iOS & Android, TypeScript, offline-capable, the only client surface for v1.
2. **Node.js Monolith API** — Express, TypeScript, organized into Clean Architecture layers (API → Business → Data).
3. **PostgreSQL Database** — Primary data store *and* scheduler state machine (no separate queue infra needed).
4. **Firebase Cloud Messaging** — Push notification delivery to both iOS (via APNs bridge) and Android.

A background cron scheduler runs inside the same Node.js process (using `node-cron`), polls PostgreSQL once a minute for due reminders, and dispatches FCM pushes through a worker with built-in retry handling.

This is intentionally a **single deployable unit**. One codebase, one process type, one database. This isn't a limitation — it's the correct choice for the current scale, and the design explicitly documents (Section 12) how each piece graduates into its own service when load actually demands it.

---

## 4. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                    MOBILE LAYER                                        │
│  ┌────────────────────┐      ┌──────────────────────┐    ┌─────────────────────────┐  │
│  │   React Native      │      │   AsyncStorage        │    │   FCM SDK                │  │
│  │   (iOS / Android)   │      │   Offline Cache       │    │   Device Token Capture   │  │
│  └──────────┬───────────┘      └──────────────────────┘    └────────────┬─────────────┘  │
└─────────────┼──────────────────────────────────────────────────────────┼───────────────┘
              │ HTTPS REST (JWT in header)                                 │ Token Upload
              ▼                                                            │
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                              API / BUSINESS LAYER (Node.js Monolith)                    │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────┐   │
│  │   Express Middleware Chain: Helmet → CORS → Rate Limiter → Body Parser → JWT     │   │
│  └────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
│  │  Auth Module  │   │  Event       │   │  Reminder         │   │  Notification        │  │
│  │  - Register   │   │  Module      │   │  Module           │   │  Module              │◄─┤
│  │  - Login      │   │  - CRUD      │   │  - Create/Update  │   │  - History           │  │
│  │  - Refresh    │   │  - List      │   │  - Custom Times   │   │  - Mark Sent         │  │
│  └──────────────┘   └──────────────┘   └──────────────────┘   └────────────────────┘  │
│                                                                                          │
│  ┌────────────────────────────────────┐   ┌──────────────────────────────────────┐    │
│  │   Dashboard Module                  │   │   Cron Scheduler (node-cron, 60s)     │    │
│  │   - Today / Upcoming / Overdue      │   │   ↳ Polls PostgreSQL for due reminders│    │
│  └────────────────────────────────────┘   └──────────────────┬─────────────────────┘    │
│                                                                  │                       │
│                                              ┌──────────────────▼─────────────────────┐  │
│                                              │   FCM Worker + Retry Engine             │  │
│                                              └──────────────────┬─────────────────────┘  │
└─────────────────────────────────────┬─────────────────────────┼──────────────────────────┘
                                        │ Prisma Client                │ FCM Admin SDK
                                        ▼                               ▼
┌──────────────────────────────────────────┐         ┌──────────────────────────────────┐
│              DATA LAYER                    │         │      EXTERNAL SERVICES             │
│  ┌──────────────────────────────────────┐ │         │  ┌──────────────────────────────┐ │
│  │           PostgreSQL                  │ │         │  │   Firebase Cloud Messaging    │ │
│  │  ┌────────┐ ┌────────┐ ┌────────────┐│ │         │  └──────────────┬───────────────┘ │
│  │  │ Users  │ │ Events │ │ Reminders   ││ │         │                 │                  │
│  │  └────────┘ └────────┘ └────────────┘│ │         │  ┌──────────────▼───────┐ ┌───────┐ │
│  │  ┌──────────────┐ ┌──────────────────┐│ │         │  │  APNs (iOS bridge)   │ │  GCM  │ │
│  │  │ NotifLog      │ │ DeviceTokens     ││ │         │  └──────────────────────┘ │(Android)│
│  │  └──────────────┘ └──────────────────┘│ │         │                            └───────┘ │
│  └──────────────────────────────────────┘ │         └──────────────────────────────────┘ │
└──────────────────────────────────────────┘                          │
                                                                         ▼ Push Delivery
                                                              ┌────────────────────┐
                                                              │   User's Device     │
                                                              └────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                  INFRASTRUCTURE                                         │
│   ┌──────────────┐      ┌──────────────────┐      ┌──────────────────────┐            │
│   │   NGINX        │      │   Docker Container │      │   SSL/TLS (Certbot)   │            │
│   │   Reverse Proxy│      │   (Node.js App)    │      │                        │            │
│   └──────────────┘      └──────────────────┘      └──────────────────────┘            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Component Breakdown

### 5.1 Mobile App (React Native + TypeScript)

**Responsibilities:** User-facing UI, FCM token registration, local event caching, offline mutation queueing.

**Key modules:**
- `AuthContext` — JWT storage via secure Keychain/Keystore, automatic refresh-token rotation.
- `EventStore` — Zustand store holding the local event/reminder state, synced from the API.
- `NotificationHandler` — Wraps the FCM SDK, extracts the device token on app start/refresh, and uploads it to the backend.
- `APIClient` — Axios instance with request interceptors (JWT attachment) and response interceptors (401 → refresh-and-retry).
- `OfflineQueue` — AsyncStorage-backed queue that captures failed mutations (create/update/delete) while offline and replays them in order once connectivity returns.

**Navigation:** React Navigation v6, a stack + bottom-tab hybrid (Dashboard, Events, Create, Profile).

**Why this matters for the "never miss an event" goal:** the OfflineQueue means a user creating a reminder in a subway tunnel doesn't lose that reminder — it syncs the moment they're back online, and the reminder's `scheduledFor` time is computed client-side for immediate display, then reconciled server-side as the source of truth.

### 5.2 API Layer (Express.js)

A thin HTTP layer. Its only concerns are routing, middleware, request validation (Zod schemas), and response shaping. It contains **zero business logic** — every route handler is a one-liner that calls into a service and returns the result.

```
src/
  api/
    routes/
      auth.routes.ts
      events.routes.ts
      reminders.routes.ts
      notifications.routes.ts
      dashboard.routes.ts
    middleware/
      auth.middleware.ts        ← JWT verification, attaches req.user
      validate.middleware.ts    ← Zod schema validation per route
      rateLimiter.middleware.ts ← express-rate-limit, tiered by route sensitivity
      errorHandler.middleware.ts← Central error formatter, no stack leaks in prod
```

### 5.3 Business Layer (Domain Services)

Pure TypeScript classes. No HTTP imports, no direct database imports — only repository interfaces injected via constructor. This is what makes the layer unit-testable without spinning up Express or Postgres.

```
src/
  services/
    AuthService.ts          ← register, login, token refresh, password hashing calls
    EventService.ts         ← CRUD orchestration, ownership checks
    ReminderService.ts      ← reminder creation tied to event lifecycle
    NotificationService.ts  ← dispatch orchestration, history queries
    DashboardService.ts     ← today/upcoming/overdue aggregation queries
  scheduler/
    ReminderScheduler.ts    ← cron registration + PG polling logic
    FCMWorker.ts            ← actual dispatch + retry/backoff logic
  events/
    EventBus.ts             ← abstraction over "something happened" (in-process today)
```

### 5.4 Database Layer (Prisma + PostgreSQL)

Prisma Client is the single point of database access across the entire codebase — no raw SQL scattered through services. Repositories wrap Prisma calls and return typed domain entities, isolating the rest of the app from ORM-specific quirks.

```
src/
  repositories/
    UserRepository.ts
    EventRepository.ts
    ReminderRepository.ts
    NotificationRepository.ts
    DeviceTokenRepository.ts
```

### 5.5 Notification Layer (FCM)

The `FCMWorker` sends messages via the Firebase Admin SDK's `sendEachForMulticast()`. Each send attempt is logged to `notification_log` regardless of outcome. Failures increment a `retryCount` column on the reminder row and schedule a `nextRetryAt` using exponential backoff. After `maxRetries` (default 5) consecutive failures, the reminder is marked `FAILED` and surfaced on the dashboard so the user has a fallback signal even if push delivery is broken.

---

## 6. Data Flow Diagrams

### 6.1 Event Creation Flow

```
User                Mobile App         API Layer          EventService        PostgreSQL
 │                       │                  │                    │                  │
 │  Fill event form      │                  │                    │                  │
 ├──────────────────────►│                  │                    │                  │
 │                       │  POST /events    │                    │                  │
 │                       ├─────────────────►│                    │                  │
 │                       │                  │ Zod validate body  │                  │
 │                       │                  │ JWT auth check     │                  │
 │                       │                  ├───────────────────►│                  │
 │                       │                  │                    │ BEGIN TX         │
 │                       │                  │                    ├─────────────────►│
 │                       │                  │                    │ INSERT events    │
 │                       │                  │                    ├─────────────────►│
 │                       │                  │                    │ INSERT reminders │
 │                       │                  │                    │ (status=PENDING) │
 │                       │                  │                    ├─────────────────►│
 │                       │                  │                    │ COMMIT           │
 │                       │                  │                    ├─────────────────►│
 │                       │                  │  201 {event, reminders}                │
 │                       │◄─────────────────┤◄───────────────────┤                  │
 │  Show confirmation    │                  │                    │                  │
 │◄──────────────────────┤                  │                    │                  │
```

### 6.2 Reminder Scheduling Flow

```
node-cron (every 60s)         ReminderScheduler          PostgreSQL              FCMWorker
        │                            │                       │                       │
        │  tick                     │                       │                       │
        ├───────────────────────────►│                       │                       │
        │                            │ SELECT * FROM reminders                       │
        │                            │ WHERE scheduledFor <= NOW()                   │
        │                            │ AND status = 'PENDING'                        │
        │                            │ FOR UPDATE SKIP LOCKED                        │
        │                            │ LIMIT 100                                     │
        │                            ├──────────────────────►│                       │
        │                            │  batch of due reminders                       │
        │                            │◄───────────────────────┤                       │
        │                            │  UPDATE status='PROCESSING', lockedBy=workerId │
        │                            ├──────────────────────►│                       │
        │                            │                       │                       │
        │                            │  hand off batch        │                       │
        │                            ├─────────────────────────────────────────────►│
        │                            │                       │   build FCM payloads   │
        │                            │                       │   per device token     │
        │                            │                       │◄──────────────────────┤
        │                            │                       │   (continues below)    │
```

### 6.3 Push Notification Flow

```
FCMWorker              Firebase Cloud Messaging         PostgreSQL              User Device
    │                              │                          │                       │
    │  sendEachForMulticast()      │                          │                       │
    ├─────────────────────────────►│                          │                       │
    │                              │  route via APNs/GCM      │                       │
    │                              ├──────────────────────────┼──────────────────────►│
    │                              │                          │                       │
    │  per-message response        │                          │                       │
    │◄─────────────────────────────┤                          │                       │
    │                              │                          │                       │
    │  IF success:                 │                          │                       │
    │   UPDATE reminders SET       │                          │                       │
    │   status='SENT', sentAt=NOW()│                          │                       │
    ├──────────────────────────────┼─────────────────────────►│                       │
    │   INSERT notification_log    │                          │                       │
    │   (status='SENT')            │                          │                       │
    ├──────────────────────────────┼─────────────────────────►│                       │
    │                              │                          │                       │
    │  IF failure:                 │                          │                       │
    │   UPDATE reminders SET       │                          │                       │
    │   retryCount+=1,             │                          │                       │
    │   nextRetryAt=NOW()+backoff, │                          │                       │
    │   status='RETRY'             │                          │                       │
    ├──────────────────────────────┼─────────────────────────►│                       │
    │   INSERT notification_log    │                          │                       │
    │   (status='FAILED', errorCode)│                         │                       │
    ├──────────────────────────────┼─────────────────────────►│                       │
    │                              │                          │  Push notification    │
    │                              │                          │  appears in tray       │
    │                              │                          │                       │◄──┘
```

---

## 7. Database Design

### 7.1 Entities & Relationships

```
User ──1:N── Event ──1:N── Reminder ──1:N── NotificationLog
User ──1:N── DeviceToken
Reminder ──N:1── DeviceToken (resolved at dispatch time, not stored as FK)
```

### 7.2 ER Diagram (Text Form)

```
┌────────────────────┐        ┌──────────────────────┐        ┌──────────────────────────┐
│       USERS          │        │        EVENTS          │        │       REMINDERS            │
├────────────────────┤        ├──────────────────────┤        ├──────────────────────────┤
│ PK id (UUID)         │───┐    │ PK id (UUID)           │───┐    │ PK id (UUID)               │
│    email (UNIQUE)    │   │    │ FK userId               │   │    │ FK eventId                  │
│    passwordHash      │   └───►│    title                │   └───►│ FK userId                   │
│    name               │        │    description          │        │    scheduledFor             │
│    timezone           │        │    eventType (ENUM)     │        │    offsetMinutes            │
│    avatarUrl          │        │    startAt               │        │    status (ENUM)            │
│    refreshToken       │        │    endAt                 │        │      PENDING|PROCESSING|    │
│    createdAt          │        │    timezone               │        │      SENT|RETRY|FAILED      │
│    updatedAt          │        │    location               │        │    retryCount               │
│    deletedAt (soft)   │        │    isAllDay               │        │    maxRetries (default 5)   │
│    isActive           │        │    status (ENUM)          │        │    nextRetryAt              │
└─────────┬───────────┘        │    createdAt / updatedAt │        │    sentAt                   │
          │                     │    deletedAt (soft)       │        │    lockedAt                 │
          │                     └──────────────────────┘        │    lockedBy                  │
          │                                                       │    createdAt / updatedAt    │
          │                                                       └─────────────┬─────────────┘
          │                                                                     │
          │                     ┌──────────────────────────┐                  │
          │                     │   NOTIFICATION_LOG          │                  │
          │                     ├──────────────────────────┤                  │
          │                     │ PK id (UUID)               │◄─────────────────┘
          │                     │ FK reminderId               │
          └────────────────────►│ FK userId                   │
          │                     │    fcmMessageId             │
          │                     │    status (SENT/FAILED)     │
          │                     │    attemptNumber            │
          │                     │    errorCode                │
          │                     │    deliveredAt              │
          │                     │    payload (JSONB)          │
          │                     │    createdAt                │
          │                     └──────────────────────────┘
          │
          │                     ┌──────────────────────────┐
          │                     │      DEVICE_TOKENS          │
          │                     ├──────────────────────────┤
          └────────────────────►│ PK id (UUID)               │
                                 │ FK userId                   │
                                 │    fcmToken                 │
                                 │    deviceType (IOS/ANDROID) │
                                 │    deviceName                │
                                 │    isActive                  │
                                 │    lastSeenAt                │
                                 │    createdAt / updatedAt    │
                                 └──────────────────────────┘
```

### 7.3 Prisma Schema Design

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum EventType {
  EXAM
  INTERVIEW
  ONLINE_ASSESSMENT
  MEETING
  APPOINTMENT
  INVITATION
  PERSONAL
  CUSTOM
}

enum EventStatus {
  ACTIVE
  COMPLETED
  CANCELLED
}

enum ReminderStatus {
  PENDING
  PROCESSING
  SENT
  RETRY
  FAILED
}

enum NotificationStatus {
  SENT
  FAILED
}

enum DeviceType {
  IOS
  ANDROID
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  passwordHash  String
  name          String
  timezone      String         @default("UTC")
  avatarUrl     String?
  refreshToken  String?
  isActive      Boolean        @default(true)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  deletedAt     DateTime?

  events        Event[]
  reminders     Reminder[]
  deviceTokens  DeviceToken[]
  notifications NotificationLog[]

  @@index([email])
  @@map("users")
}

model Event {
  id          String      @id @default(uuid())
  userId      String
  title       String
  description String?
  eventType   EventType
  startAt     DateTime
  endAt       DateTime?
  timezone    String      @default("UTC")
  location    String?
  isAllDay    Boolean     @default(false)
  status      EventStatus @default(ACTIVE)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  deletedAt   DateTime?

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  reminders   Reminder[]

  @@index([userId, startAt])
  @@index([userId, status])
  @@map("events")
}

model Reminder {
  id             String          @id @default(uuid())
  eventId        String
  userId         String
  scheduledFor   DateTime
  offsetMinutes  Int
  status         ReminderStatus  @default(PENDING)
  retryCount     Int             @default(0)
  maxRetries     Int             @default(5)
  nextRetryAt    DateTime?
  sentAt         DateTime?
  lockedAt       DateTime?
  lockedBy       String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  event          Event             @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  notifications  NotificationLog[]

  @@index([status, scheduledFor])
  @@index([userId, status])
  @@map("reminders")
}

model NotificationLog {
  id             String              @id @default(uuid())
  reminderId     String
  userId         String
  fcmMessageId   String?
  status         NotificationStatus
  attemptNumber  Int
  errorCode      String?
  deliveredAt    DateTime?
  payload        Json
  createdAt      DateTime            @default(now())

  reminder       Reminder @relation(fields: [reminderId], references: [id], onDelete: Cascade)
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([reminderId])
  @@index([userId, createdAt])
  @@map("notification_log")
}

model DeviceToken {
  id          String      @id @default(uuid())
  userId      String
  fcmToken    String      @unique
  deviceType  DeviceType
  deviceName  String?
  isActive    Boolean     @default(true)
  lastSeenAt  DateTime    @default(now())
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  user        User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isActive])
  @@map("device_tokens")
}
```

**Indexing rationale:**
- `events(userId, startAt)` — powers the "List Upcoming Events" and dashboard queries directly.
- `reminders(status, scheduledFor)` — this is the index the scheduler's polling query hits every 60 seconds; without it, that query becomes a full table scan as reminder volume grows.
- `device_tokens(userId, isActive)` — fast lookup of all live tokens for a user at dispatch time (a user can have multiple devices).

---

## 8. API Design

All endpoints are prefixed with `/api/v1`. All authenticated endpoints require `Authorization: Bearer <jwt>`.

### 8.1 Authentication APIs

#### `POST /api/v1/auth/register`

**Request:**
```json
{
  "email": "priya@example.com",
  "password": "SecurePass123!",
  "name": "Priya Sharma",
  "timezone": "Asia/Kolkata"
}
```

**Response `201 Created`:**
```json
{
  "user": {
    "id": "8f14e45f-ceea-4d-9b-9d6f0c7e1d2a",
    "email": "priya@example.com",
    "name": "Priya Sharma",
    "timezone": "Asia/Kolkata"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "8d2e1f4a-...-uuid-style-refresh-token"
}
```

#### `POST /api/v1/auth/login`

**Request:**
```json
{
  "email": "priya@example.com",
  "password": "SecurePass123!"
}
```

**Response `200 OK`:**
```json
{
  "user": { "id": "8f14e45f-ceea-4d-9b-9d6f0c7e1d2a", "email": "priya@example.com", "name": "Priya Sharma" },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "8d2e1f4a-...-uuid-style-refresh-token"
}
```

**Response `401 Unauthorized`:**
```json
{ "error": "INVALID_CREDENTIALS", "message": "Email or password is incorrect" }
```

#### `POST /api/v1/auth/refresh`

**Request:**
```json
{ "refreshToken": "8d2e1f4a-...-uuid-style-refresh-token" }
```

**Response `200 OK`:**
```json
{ "accessToken": "eyJhbGciOiJIUzI1NiIs...new..." }
```

#### `GET /api/v1/auth/me`

**Response `200 OK`:**
```json
{
  "id": "8f14e45f-ceea-4d-9b-9d6f0c7e1d2a",
  "email": "priya@example.com",
  "name": "Priya Sharma",
  "timezone": "Asia/Kolkata",
  "avatarUrl": null
}
```

#### `PATCH /api/v1/auth/me` (Profile Update)

**Request:**
```json
{ "name": "Priya S.", "timezone": "America/New_York" }
```

**Response `200 OK`:** returns updated user object.

---

### 8.2 Event APIs

#### `POST /api/v1/events`

**Request:**
```json
{
  "title": "Final Year Project Viva",
  "description": "Bring printed report and laptop",
  "eventType": "EXAM",
  "startAt": "2026-07-02T09:30:00.000Z",
  "endAt": "2026-07-02T11:00:00.000Z",
  "timezone": "Asia/Kolkata",
  "location": "Room 204, CS Block",
  "reminders": [
    { "offsetMinutes": 1440 },
    { "offsetMinutes": 60 },
    { "offsetMinutes": 15 }
  ]
}
```

**Response `201 Created`:**
```json
{
  "event": {
    "id": "e7c1...",
    "title": "Final Year Project Viva",
    "eventType": "EXAM",
    "startAt": "2026-07-02T09:30:00.000Z",
    "status": "ACTIVE"
  },
  "reminders": [
    { "id": "r1...", "scheduledFor": "2026-07-01T09:30:00.000Z", "status": "PENDING" },
    { "id": "r2...", "scheduledFor": "2026-07-02T08:30:00.000Z", "status": "PENDING" },
    { "id": "r3...", "scheduledFor": "2026-07-02T09:15:00.000Z", "status": "PENDING" }
  ]
}
```

#### `GET /api/v1/events?status=ACTIVE&page=1&limit=20`

**Response `200 OK`:**
```json
{
  "data": [
    { "id": "e7c1...", "title": "Final Year Project Viva", "eventType": "EXAM", "startAt": "2026-07-02T09:30:00.000Z" }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

#### `GET /api/v1/events/upcoming?days=7`

**Response `200 OK`:**
```json
{
  "data": [
    { "id": "e7c1...", "title": "Final Year Project Viva", "startAt": "2026-07-02T09:30:00.000Z", "eventType": "EXAM" }
  ]
}
```

#### `GET /api/v1/events/:id`

**Response `200 OK`:** full event object including its reminders array.

**Response `404 Not Found`:**
```json
{ "error": "EVENT_NOT_FOUND", "message": "Event not found or you don't have access" }
```

#### `PUT /api/v1/events/:id`

**Request:** same shape as create, partial fields allowed via `PATCH` semantics if preferred.

**Response `200 OK`:** updated event object.

#### `DELETE /api/v1/events/:id`

**Response `204 No Content`** (soft delete — sets `deletedAt`, cascades a `CANCELLED` status to associated pending reminders so the scheduler skips them).

---

### 8.3 Reminder APIs

#### `POST /api/v1/events/:eventId/reminders`

**Request:**
```json
{ "offsetMinutes": 30 }
```

**Response `201 Created`:**
```json
{ "id": "r4...", "eventId": "e7c1...", "scheduledFor": "2026-07-02T09:00:00.000Z", "status": "PENDING" }
```

#### `GET /api/v1/events/:eventId/reminders`

**Response `200 OK`:**
```json
{
  "data": [
    { "id": "r1...", "scheduledFor": "2026-07-01T09:30:00.000Z", "status": "SENT", "sentAt": "2026-07-01T09:30:04.000Z" },
    { "id": "r2...", "scheduledFor": "2026-07-02T08:30:00.000Z", "status": "PENDING" }
  ]
}
```

#### `PATCH /api/v1/reminders/:id`

**Request:**
```json
{ "scheduledFor": "2026-07-02T08:45:00.000Z" }
```

**Response `200 OK`:** updated reminder (only allowed while `status = PENDING`).

#### `DELETE /api/v1/reminders/:id`

**Response `204 No Content`**

#### `PATCH /api/v1/reminders/:id/mark-sent` *(internal/admin use — primarily called by the scheduler itself, exposed for manual override / testing)*

**Response `200 OK`:**
```json
{ "id": "r1...", "status": "SENT", "sentAt": "2026-07-01T09:30:04.000Z" }
```

---

### 8.4 Notification APIs

#### `POST /api/v1/notifications/device-token`

**Request:**
```json
{ "fcmToken": "dGhpcyBpcyBhIGZha2UgZmNtIHRva2Vu...", "deviceType": "ANDROID", "deviceName": "Pixel 8" }
```

**Response `200 OK`:**
```json
{ "id": "dt1...", "fcmToken": "dGhpcyBpcyBhIGZha2UgZmNtIHRva2Vu...", "isActive": true }
```

*(Upsert semantics: if `fcmToken` already exists, refreshes `lastSeenAt` and re-activates if previously deactivated.)*

#### `DELETE /api/v1/notifications/device-token/:id`

Called on logout — deactivates the token so the user stops receiving pushes on that device.

**Response `204 No Content`**

#### `GET /api/v1/notifications/history?page=1&limit=20`

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "n1...",
      "reminderId": "r1...",
      "eventTitle": "Final Year Project Viva",
      "status": "SENT",
      "deliveredAt": "2026-07-01T09:30:04.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

---

### 8.5 Dashboard APIs

#### `GET /api/v1/dashboard`

**Response `200 OK`:**
```json
{
  "today": [
    { "id": "e9...", "title": "Team Standup", "startAt": "2026-06-17T15:00:00.000Z" }
  ],
  "upcoming": [
    { "id": "e7c1...", "title": "Final Year Project Viva", "startAt": "2026-07-02T09:30:00.000Z" }
  ],
  "overdue": [
    { "id": "e5...", "title": "Submit Visa Documents", "startAt": "2026-06-15T18:00:00.000Z" }
  ]
}
```

---

## 9. Push Notification Architecture

### 9.1 Device Token Registration

When the app launches, the FCM SDK generates (or retrieves a cached) device token. The app immediately calls `POST /notifications/device-token` to register/refresh it server-side. Tokens are **upserted, never duplicated** — `fcmToken` carries a unique constraint, so a re-install or token-rotation event simply updates `lastSeenAt` on the existing row rather than creating orphaned entries.

### 9.2 Token Storage

Stored in `device_tokens`, scoped to `userId`. A single user can have multiple active tokens (phone + tablet), and every active token receives every push — this is intentional, since the goal is "the user sees it somewhere," not "the user sees it exactly once."

### 9.3 Reminder Scheduler → Trigger → Delivery → Failure → Retry → Tracking

```
                              ┌─────────────────────┐
                              │   node-cron (60s)     │
                              └──────────┬───────────┘
                                         │
                                         ▼
                       ┌──────────────────────────────────┐
                       │  ReminderScheduler.pollDueReminders()│
                       │  SELECT ... WHERE scheduledFor<=NOW()│
                       │  AND status='PENDING'                 │
                       │  FOR UPDATE SKIP LOCKED LIMIT 100     │
                       └──────────────┬───────────────────┘
                                       │ claims batch, sets status=PROCESSING
                                       ▼
                       ┌──────────────────────────────────┐
                       │  FCMWorker.dispatch(batch)          │
                       │  - fetch active device tokens       │
                       │    per reminder.userId               │
                       │  - build multicast message           │
                       └──────────────┬───────────────────┘
                                       │
                                       ▼
                       ┌──────────────────────────────────┐
                       │  Firebase Admin SDK                 │
                       │  sendEachForMulticast(tokens, msg)  │
                       └──────────────┬───────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          ▼                          ▼
                  ┌───────────────┐         ┌───────────────────┐
                  │  SUCCESS         │         │  FAILURE             │
                  │  status=SENT     │         │  retryCount += 1      │
                  │  sentAt=NOW()    │         │  nextRetryAt =        │
                  │                  │         │   NOW() + backoff(n)  │
                  │                  │         │  IF retryCount >=     │
                  │                  │         │   maxRetries:         │
                  │                  │         │     status=FAILED     │
                  │                  │         │  ELSE:                │
                  │                  │         │     status=RETRY      │
                  └────────┬─────────┘         └──────────┬────────────┘
                           │                                │
                           └──────────────┬─────────────────┘
                                          ▼
                       ┌──────────────────────────────────┐
                       │  INSERT notification_log             │
                       │  (immutable audit record per attempt)│
                       └──────────────────────────────────┘
```

### 9.4 Sequence Diagram — Full Push Lifecycle

```
Scheduler        PostgreSQL        FCMWorker        Firebase (FCM)        User Device
   │                  │                 │                   │                    │
   │  poll (every 60s)│                 │                   │                    │
   ├─────────────────►│                 │                   │                    │
   │  due batch        │                 │                   │                    │
   │◄─────────────────┤                 │                   │                    │
   │  lock rows         │                 │                   │                    │
   ├─────────────────►│                 │                   │                    │
   │  hand off batch                      │                   │                    │
   ├───────────────────────────────────►│                   │                    │
   │                  │  fetch active tokens                 │                    │
   │                  │◄─────────────────┤                   │                    │
   │                  │  tokens           │                   │                    │
   │                  ├─────────────────►│                   │                    │
   │                  │                 │  sendEachForMulticast()                  │
   │                  │                 ├──────────────────►│                    │
   │                  │                 │                   │  route via APNs/GCM │
   │                  │                 │                   ├───────────────────►│
   │                  │                 │  per-message result│                    │
   │                  │                 │◄──────────────────┤                    │
   │                  │  update reminder status               │                    │
   │                  │◄─────────────────┤                   │                    │
   │                  │  insert notification_log               │                    │
   │                  │◄─────────────────┤                   │                    │
   │                  │                 │                   │  notification shown │
   │                  │                 │                   │                    │◄──┘
```

### 9.5 Failure Handling & Retry Strategy

| Failure Type | Handling |
|---|---|
| Invalid/expired FCM token | Mark token `isActive=false`, skip on future sends, no retry for this token |
| Network/timeout error | Treated as retryable; `retryCount += 1`, exponential backoff applied |
| FCM rate-limit response | Backoff respects `Retry-After` if present, else falls back to standard exponential curve |
| All tokens for user inactive | Reminder marked `FAILED` immediately with `errorCode=NO_ACTIVE_DEVICE`, surfaced in dashboard's overdue/failed section |
| Max retries exhausted | `status=FAILED`, no further scheduler pickup, visible to user as a missed-but-logged event |

**Backoff formula:** `nextRetryAt = NOW() + min(2^retryCount * 30s, 30min)` — caps growth so a flaky 2-minute FCM outage doesn't push a retry out by hours.

### 9.6 Notification Tracking

Every single dispatch attempt — success or failure — writes one immutable row to `notification_log`. This is what powers:
- The Notification History API (`GET /notifications/history`)
- Debugging "why didn't I get notified" support tickets (trace by `reminderId`)
- Future analytics on delivery success rates per device type / OS version

---

## 10. Scheduler Design (No Redis)

Since Redis is explicitly excluded, PostgreSQL itself plays the role of the job queue. This works because Postgres row-level locking gives us the two properties a queue needs: **exclusivity** (no two workers grab the same job) and **visibility** (we can always query current job state).

### 10.1 How Reminders Are Picked

```sql
SELECT id, eventId, userId, scheduledFor
FROM reminders
WHERE status = 'PENDING'
  AND scheduledFor <= NOW()
ORDER BY scheduledFor ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

`FOR UPDATE` locks the selected rows for the duration of the transaction. `SKIP LOCKED` means that if a second cron tick (or a second app instance, once horizontally scaled) runs this query concurrently, it simply skips rows already locked by the first transaction instead of blocking — this is what gives single-table Postgres queue-like behavior without a real broker.

Immediately after selection, the worker updates `status='PROCESSING', lockedAt=NOW(), lockedBy=<workerId>` and commits, releasing the lock but preserving the claim via the `PROCESSING` status.

### 10.2 How Reminders Are Marked Sent

After a successful FCM dispatch, the worker runs:

```sql
UPDATE reminders
SET status = 'SENT', sentAt = NOW()
WHERE id = $1 AND status = 'PROCESSING';
```

The `AND status = 'PROCESSING'` guard is deliberate — it ensures the update only applies if this worker still legitimately owns the row, preventing a stale/duplicate worker from overwriting a result that another process already finalized.

### 10.3 How Duplicate Notifications Are Prevented

Three layers work together:

1. **Row-level locking** (`FOR UPDATE SKIP LOCKED`) prevents two workers from claiming the same `PENDING` reminder simultaneously.
2. **Status-guarded updates** (`WHERE status='PROCESSING'`) prevent a second, possibly delayed, write from re-triggering a send on a reminder that's already `SENT`.
3. **Stale lock recovery**: if a worker crashes mid-dispatch and leaves a reminder stuck in `PROCESSING`, a watchdog query reclaims it:
   ```sql
   UPDATE reminders
   SET status = 'PENDING', lockedAt = NULL, lockedBy = NULL
   WHERE status = 'PROCESSING' AND lockedAt < NOW() - INTERVAL '5 minutes';
   ```
   This runs once per scheduler tick before the main polling query, so abandoned jobs re-enter the pickup pool within 5 minutes rather than being lost forever.

### 10.4 How Failed Jobs Are Retried

Failed sends don't get re-picked by the main `PENDING` query — they live in `status='RETRY'` with a `nextRetryAt` timestamp. A second, lighter polling query handles them:

```sql
SELECT id FROM reminders
WHERE status = 'RETRY'
  AND nextRetryAt <= NOW()
  AND retryCount < maxRetries
FOR UPDATE SKIP LOCKED
LIMIT 50;
```

This separation (fresh `PENDING` jobs vs. `RETRY` jobs) keeps the hot path query simple and lets retry backoff timing be respected exactly, rather than retried jobs flooding back into the main queue prematurely.

---

## 11. Security Design

| Layer | Mechanism |
|---|---|
| **Authentication** | JWT access tokens (short-lived, 15 min) + opaque refresh tokens (long-lived, 30 days, stored hashed in DB, rotated on each use) |
| **Password Storage** | bcrypt, cost factor 12, never logged, never returned in any API response |
| **Authorization** | Every Event/Reminder query is scoped by `userId` at the repository layer — there is no code path that can return another user's data, even by ID guessing |
| **Input Validation** | Zod schemas on every route, rejecting unknown fields and enforcing type/format constraints before the request reaches a service |
| **Rate Limiting** | Tiered via `express-rate-limit`: 5 req/min on `/auth/login` and `/auth/register`, 100 req/min on general authenticated routes |
| **Secrets Management** | `.env` for local dev only; production secrets (DB URL, JWT secret, Firebase service account key) injected via the hosting platform's secret manager, never committed |
| **Transport Security** | TLS enforced end-to-end via NGINX + Certbot-issued certificates; HTTP requests redirected to HTTPS |
| **Headers** | `helmet` middleware sets sensible defaults (HSTS, X-Content-Type-Options, X-Frame-Options, etc.) |
| **SQL Injection** | Eliminated by construction — Prisma's query builder parameterizes all queries; no raw SQL string concatenation anywhere in the codebase |

---

## 12. Scalability Considerations

The architecture is monolithic by choice, not by accident — and every component is built so its future extraction is a clean cut, not a rewrite.

### 12.1 Redis (Future)

**Trigger to adopt:** scheduler polling load becomes meaningful (millions of reminders) or the team wants sub-second notification latency instead of the current ~30-60s tick window.

**Migration path:** introduce Redis as a cache layer first (session/token blacklist, dashboard query caching), then as a proper job queue (BullMQ) sitting in front of the same Postgres tables. Because the `FCMWorker` is already isolated behind a clean interface, swapping "pulled from Postgres poll" for "pulled from a BullMQ job" only touches the scheduler module — `EventService`, `ReminderService`, and the API layer don't change at all.

### 12.2 Message Queues (Future)

**Trigger to adopt:** notification dispatch needs to scale independently of the API process, or new async workflows appear (e.g., email digests, SMS fallback).

**Migration path:** the `EventBus` abstraction already in place today (currently a no-op in-process pass-through) becomes the seam. Swap its implementation to publish onto SQS/RabbitMQ/Kafka, and any service that currently calls `eventBus.emit('reminder.created', payload)` keeps working unchanged — only the bus implementation and a new consumer process are added.

### 12.3 Microservices (Future)

**Trigger to adopt:** team size grows past what a single deploy pipeline can support, or one domain (e.g., Notifications) needs an independent scaling/release cadence from the rest.

**Migration path:** because the codebase is already split into domain modules (`Auth`, `Event`, `Reminder`, `Notification`, `Dashboard`) with repository-level data access and no cross-module business logic, extraction means: move the module's folder into its own service, point its repositories at the same (or a split) database, and replace its direct function calls with HTTP/gRPC calls behind the same interface signatures. The Notification module is the natural first candidate to extract, since it already has the cleanest external boundary (FCM in, dispatch results out).

### 12.4 Event-Driven Architecture (Future)

**Trigger to adopt:** the system needs to react to state changes from multiple independent consumers (e.g., analytics, audit logging, third-party webhooks) without each one being bolted onto the core service code.

**Migration path:** once the `EventBus` is backed by a real broker (per 12.2), event-driven architecture is mostly already there — domain events (`event.created`, `reminder.sent`, `reminder.failed`) just need additional subscribers wired up. No core business logic needs to change, since publishing was never tightly coupled to a single consumer.

---

## 13. Deployment Architecture

### 13.1 Development Environment

- Docker Compose spinning up: Node.js app (hot-reload via `ts-node-dev`), PostgreSQL container, and a local Firebase emulator suite for FCM testing without hitting real devices.
- `.env.development` holds local secrets; Prisma Migrate runs against the local Postgres container.

### 13.2 Staging Environment

- Single small VM/container (e.g., Railway, Render, or a small EC2 instance) running the same Docker image that will go to production.
- Connected to a separate staging PostgreSQL instance and a separate Firebase project (so staging push tests never reach real users' devices).
- CI pipeline (GitHub Actions) runs lint, typecheck, unit tests, and Prisma migration dry-runs before deploying here automatically on every merge to `develop`.

### 13.3 Production Environment

```
                          ┌─────────────────────┐
                          │   DNS + Cloudflare     │
                          │   (CDN / DDoS layer)   │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │   NGINX (TLS term.)    │
                          │   + Certbot auto-renew │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │   Node.js App           │
                          │   (Docker Container)    │
                          │   - API + Scheduler      │
                          │     in one process       │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │   Managed PostgreSQL     │
                          │   (e.g., RDS / Neon /    │
                          │    Supabase, with daily  │
                          │    automated backups)    │
                          └──────────────────────┘
```

- Process management via `pm2` (or the container runtime's own restart policy) so a crashed Node process auto-restarts without manual intervention.
- Database backups: automated daily snapshots with point-in-time recovery enabled — critical given Postgres also holds scheduler state.
- Logging: structured JSON logs (via `pino`) shipped to a centralized log viewer for production debugging of failed notification batches.
- Monitoring: basic uptime checks on the API health endpoint + alerting if the scheduler's last successful tick is older than 3 minutes (signals a stuck/crashed scheduler before users start missing reminders).

---

## 14. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Scheduler process crashes silently | Users miss reminders with no signal | Health-check alert on "last successful tick" age; `pm2`/container auto-restart |
| FCM token becomes stale without app knowing | Notification silently fails to deliver | Token refresh on every app foreground; failed-send detection deactivates dead tokens proactively |
| Single Postgres instance is a single point of failure | Total system outage | Managed Postgres with automated failover (e.g., RDS Multi-AZ) as a near-term upgrade, even before any Redis/microservice work |
| Clock drift between client and server | Reminder fires at the "wrong" perceived time | All `scheduledFor` values computed and stored server-side in UTC; client only sends intent (offset + event time), never an absolute scheduled timestamp |
| Polling-based scheduler has inherent latency (up to ~60s) | Notification not instantaneous | Acceptable for the stated NFR (<30s target achieved on average since polls are evenly distributed); documented as a known trade-off, with Redis/queue migration as the explicit fix if requirements tighten |
| Retry storm if FCM has an extended outage | Database load spike from repeated retry attempts | Exponential backoff cap (30 min ceiling) bounds the worst case; `maxRetries` ensures jobs eventually stop trying rather than retrying forever |
| A user deletes an event but its reminders were already claimed by the scheduler (race condition) | A notification fires for an event the user just deleted | Soft-delete cascades a `CANCELLED` status to all `PENDING` reminders synchronously in the same transaction as the event delete; the scheduler's `WHERE status='PENDING'` filter naturally excludes them going forward |

---

## 15. Final Recommended Architecture

**Recommendation: proceed with the modular monolith as designed.**

This architecture deliberately optimizes for the actual constraint at this stage of the product — team velocity and operational simplicity — while explicitly engineering every seam (module boundaries, the `EventBus` abstraction, repository-pattern data access) that will be needed when the *next* constraint (notification volume, team size, latency requirements) actually materializes.

The "never miss an event" product promise is protected at three independent layers: client-side offline queueing ensures input is never lost, Postgres-backed locking with stale-lock recovery ensures scheduled jobs are never silently dropped, and the immutable notification log ensures every delivery attempt — success or failure — is traceable.

This is not a design that needs to be "thrown away" as the product grows. It's a design that grows *into* Redis, queues, and service extraction one deliberate step at a time, with each step touching only the layer that needs it.

**Sign-off checklist before implementation begins:**
- [ ] Confirm Firebase project setup (separate dev/staging/prod projects)
- [ ] Confirm managed Postgres provider and backup/recovery SLA
- [ ] Finalize JWT expiry durations with the security review
- [ ] Confirm `maxRetries` and backoff ceiling values against expected FCM SLA
- [ ] Load-test the scheduler's polling query at projected reminder volume before launch

---

*End of Document.*
