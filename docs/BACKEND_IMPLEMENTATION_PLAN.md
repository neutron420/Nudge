# Nudge API — Backend Implementation Plan

**Document status:** Ready for implementation  
**Architecture:** TypeScript modular monolith  
**Database:** PostgreSQL on Neon through Prisma  
**Primary concerns:** secure authentication, transactional event creation, reliable reminder scheduling, and auditable push delivery

---

## 1. Backend Scope

The backend should provide:

- Email/password registration and login
- Google ID-token login
- Short-lived access tokens
- Hashed, rotating refresh tokens with 30-day sessions
- User/profile management
- Event and reminder CRUD
- Dashboard aggregation
- Device-token registration
- Push notification scheduling, retry, and history
- Session/device management
- Health and scheduler health endpoints

The API and scheduler may run in the same process for v1, but their modules must remain separable.

---

## 2. Current Database Status

The live Neon database currently has:

- One applied migration: `20260619150301_init`
- Tables: `users`, `events`, `reminders`, `notification_log`, `device_tokens`
- Zero rows in all application tables
- No invalid event ranges
- No invalid reminder counters
- No duplicate reminder times
- No invalid notification attempt numbers

The local v2 migration is:

```text
20260624120000_auth_sessions_and_db_hardening
```

It adds:

- Google OAuth identities
- 30-day multi-device sessions
- Nullable password hashes for Google-only users
- Email verification timestamp
- Cancelled reminder status
- Timezone-aware event/reminder timestamps
- Retry and duplicate-reminder indexes
- Device-specific notification logs
- Database check constraints

Because the live tables are empty, this migration has no current data-conflict risk.

---

## 3. Recommended Stack

- Node.js LTS
- TypeScript
- Express
- Prisma
- Zod
- `jose` for JWT signing and verification
- `argon2` or bcrypt for password hashing
- Node `crypto` for opaque refresh tokens and SHA-256 token hashes
- `google-auth-library` for Google ID-token verification
- Firebase Admin SDK for FCM
- `node-cron` for the initial scheduler
- Pino for structured logging
- Vitest and Supertest for tests

Do not use Passport unless several additional OAuth providers are planned. Direct Google ID-token verification is smaller and easier to audit for the current requirements.

---

## 4. Suggested Backend Structure

```text
apps/backend/
  src/
    app.ts
    server.ts
    config/
      env.ts
      logger.ts
    api/
      routes/
      middleware/
      schemas/
    modules/
      auth/
        auth.controller.ts
        auth.service.ts
        auth.repository.ts
        auth.schemas.ts
        auth.types.ts
      users/
      events/
      reminders/
      notifications/
      dashboard/
      sessions/
    scheduler/
      reminder.scheduler.ts
      reminder.claim.ts
      retry.policy.ts
      stale-lock.recovery.ts
    integrations/
      google/
      firebase/
    db/
      prisma.ts
    common/
      errors/
      security/
      time/
      pagination/
    tests/
```

Controllers should handle HTTP translation. Services should own business rules. Repositories should own Prisma queries. Scheduler SQL that requires `FOR UPDATE SKIP LOCKED` may be isolated as reviewed raw SQL.

---

## 5. Authentication and 30-Day Sessions

### Token model

| Token | Lifetime | Storage |
|---|---|---|
| Access token | 15 minutes | Mobile app memory |
| Refresh token | Rotated on each use | Mobile SecureStore; only its hash is stored in `sessions` |
| Session | Maximum 30 days | `sessions.expiresAt` |

### Session creation

After sign-up or login:

1. Generate at least 32 random bytes for the refresh token.
2. Hash it with SHA-256 before database storage.
3. Create a `Session` row with `expiresAt = now + 30 days`.
4. Issue a 15-minute signed access token containing `sub`, `sessionId`, and token version/issuer data.
5. Return the raw refresh token only once.

The database default is a safety net. The service should explicitly calculate `expiresAt` so tests and policy are clear.

### Refresh rotation

Within one transaction:

1. Hash the submitted refresh token.
2. Lock or atomically locate the session.
3. Reject missing, expired, or revoked sessions.
4. Generate a new refresh token.
5. Replace `refreshTokenHash`.
6. Update `lastUsedAt`.
7. Return a new access token and refresh token.

If an already-rotated token is reused, treat it as suspected theft and revoke that session. A stronger later design can maintain a refresh-token family/reuse-detection table.

### Logout

- Current-device logout revokes the current `Session`.
- It also deactivates the current `DeviceToken`.
- Logout-all revokes every active session and device token belonging to the user.
- Expired/revoked sessions should be periodically deleted after an audit retention window.

---

## 6. Google Authentication

Endpoint:

```http
POST /api/v1/auth/google
```

Request:

```json
{
  "idToken": "google-id-token",
  "timezone": "Asia/Kolkata"
}
```

Flow:

1. Verify the token with `google-auth-library`.
2. Verify signature, issuer, expiration, and audience.
3. Require `email_verified = true`.
4. Use Google's immutable `sub` as `providerAccountId`.
5. Find `AuthAccount(provider=GOOGLE, providerAccountId=sub)`.
6. If found, load its user.
7. If not found:
   - Find an existing verified user with the same normalized email.
   - Link only under an explicit, reviewed account-linking policy.
   - Otherwise create the user and OAuth account transactionally.
8. Update safe profile fields such as avatar when appropriate.
9. Create a Nudge session and return Nudge tokens.

Never use a Google access token as a Nudge access token. Never trust profile fields sent separately by the client.

---

## 7. API Inventory

### Authentication

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Register with email/password |
| POST | `/api/v1/auth/login` | Email/password login |
| POST | `/api/v1/auth/google` | Google ID-token login |
| POST | `/api/v1/auth/refresh` | Rotate refresh token |
| POST | `/api/v1/auth/logout` | Revoke current session |
| POST | `/api/v1/auth/logout-all` | Revoke every session |
| POST | `/api/v1/auth/forgot-password` | Request password reset |
| POST | `/api/v1/auth/reset-password` | Complete password reset |
| GET | `/api/v1/auth/me` | Current profile |
| PATCH | `/api/v1/auth/me` | Update profile/timezone |

### Sessions

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/auth/sessions` | List active sessions |
| DELETE | `/api/v1/auth/sessions/:id` | Revoke one owned session |

### Events

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v1/events` | Create event and reminders transactionally |
| GET | `/api/v1/events` | Paginated/filterable event list |
| GET | `/api/v1/events/upcoming` | Upcoming range |
| GET | `/api/v1/events/:id` | Owned event details |
| PATCH | `/api/v1/events/:id` | Update event and reconcile reminders |
| DELETE | `/api/v1/events/:id` | Soft-delete event and cancel pending/retry reminders |
| PATCH | `/api/v1/events/:id/complete` | Mark complete and cancel future reminders |

### Reminders

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v1/events/:eventId/reminders` | Add reminder |
| GET | `/api/v1/events/:eventId/reminders` | List reminders |
| PATCH | `/api/v1/reminders/:id` | Update pending reminder |
| DELETE | `/api/v1/reminders/:id` | Cancel reminder |
| POST | `/api/v1/reminders/:id/retry` | Manually retry a failed reminder |

The scheduler should not call a public “mark sent” route. It should update through an internal service/repository transaction.

### Notifications

| Method | Route | Purpose |
|---|---|---|
| PUT | `/api/v1/notifications/device-token` | Upsert current device token |
| DELETE | `/api/v1/notifications/device-token/:id` | Deactivate owned token |
| GET | `/api/v1/notifications/history` | Paginated delivery history |
| GET | `/api/v1/notifications/health` | Permission-independent server-side token/delivery health |

### Dashboard and health

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/dashboard` | Today, upcoming, overdue, failed reminder summary |
| GET | `/health/live` | Process is alive |
| GET | `/health/ready` | Database and required integrations are ready |
| GET | `/health/scheduler` | Last successful scheduler tick |

---

## 8. Event and Reminder Rules

### Creation

Create the event and all reminders in one transaction.

For each reminder:

```text
scheduledFor = event.startAt - offsetMinutes
```

Rules:

- `endAt >= startAt`
- `offsetMinutes >= 0`
- No duplicate `(eventId, scheduledFor)`
- All ownership comes from authenticated `userId`, never request body `userId`
- Normalize incoming timestamps to real instants
- Store the selected IANA timezone separately for display/editing

### Update

When `startAt` changes:

- Recalculate only pending/retry reminders.
- Never rewrite sent notification history.
- Reject or explicitly handle reminders whose recalculated time is in the past.

### Delete/cancel

Within one transaction:

- Set event `deletedAt`.
- Set event status to `CANCELLED`.
- Set `PENDING` and `RETRY` reminders to `CANCELLED`.
- A claimed `PROCESSING` reminder must re-check event/reminder status before FCM send.

---

## 9. Scheduler and Push Delivery

### Tick order

Every minute:

1. Record scheduler heartbeat.
2. Recover stale `PROCESSING` reminders.
3. Claim due `PENDING` reminders.
4. Claim due `RETRY` reminders.
5. Dispatch claimed reminders with bounded concurrency.
6. Persist a `NotificationLog` row per device and attempt.
7. Mark reminder `SENT`, `RETRY`, or `FAILED`.

### Claiming

Use a short transaction with:

```sql
FOR UPDATE SKIP LOCKED
```

Then set `PROCESSING`, `lockedAt`, and `lockedBy` before committing.

### Delivery semantics

One reminder may target multiple active device tokens. Therefore:

- Log each device result separately with `deviceTokenId`.
- Mark the reminder `SENT` when at least one intended device accepts the message.
- Preserve failed device logs even if another device succeeds.
- If every active device fails transiently, schedule retry.
- If no active device exists, classify the failure clearly and surface it in notification health.
- Deactivate tokens rejected as unregistered/invalid by FCM.

### Retry policy

Suggested delays:

1. 1 minute
2. 2 minutes
3. 5 minutes
4. 15 minutes
5. 30 minutes

Add jitter to avoid synchronized retry spikes. Permanent FCM errors should not be retried.

### Idempotency

The unique reminder schedule constraint prevents duplicate reminder rows, but dispatch also needs an idempotency strategy. At minimum:

- Status-guarded transitions
- One worker claim at a time
- Stable worker IDs
- No send when event/reminder became cancelled

For stronger guarantees, add a dispatch key/outbox pattern in a later version.

---

## 10. Validation, Security, and Error Handling

### Validation

- Zod schemas for params, query, and body
- Reject unknown request fields
- Validate UUIDs, pagination limits, timezone names, and ISO timestamps
- Limit title, description, location, device name, and user-agent lengths

### Security

- Helmet
- Strict CORS allowlist
- Rate limiting by IP and account
- JWT issuer/audience checks
- Generic login errors
- Password hashing with an approved cost
- No secrets or tokens in logs
- HTTPS only in production
- Constant-time token/hash comparisons where relevant

Suggested auth rate limits:

- Register/login/Google login: 5 attempts per minute per IP
- Forgot password: aggressive account/IP throttling
- Refresh: moderate per-session throttling

### Error format

```json
{
  "error": {
    "code": "EVENT_NOT_FOUND",
    "message": "Event not found",
    "requestId": "request-id",
    "details": null
  }
}
```

Use stable machine-readable codes and avoid stack traces outside development.

---

## 11. Remaining Database Additions

The current v2 database is sufficient for core events, Google login, sessions, and push delivery. The following additions are still recommended for the complete frontend plan:

### Required before email password recovery

- `PasswordResetToken`
  - hashed token
  - user ID
  - expiry
  - consumed timestamp
- Optional `EmailVerificationToken` if email verification is required for password accounts

### Required for synchronized notification preferences

- `NotificationPreference`
  - user ID
  - push enabled
  - default reminder offsets
  - quiet-hours settings, if supported later

### Required only for unread notification badges

- Add `readAt` to a notification inbox record, or create a separate `NotificationInbox` model.
- `NotificationLog` is an immutable delivery audit log and should not be overloaded with mutable inbox state.

### Optional later features

- Recurring-event rules
- Event attachments
- Event sharing/invitations
- Audit/security events
- Refresh-token family/reuse history
- Notification outbox/idempotency keys

Do not add optional models until their product behavior is agreed.

---

## 12. Environment Variables

```text
NODE_ENV
PORT
DATABASE_URL
JWT_ACCESS_PRIVATE_KEY
JWT_ACCESS_PUBLIC_KEY
JWT_ISSUER
JWT_AUDIENCE
ACCESS_TOKEN_TTL_MINUTES=15
SESSION_TTL_DAYS=30
GOOGLE_WEB_CLIENT_ID
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
CORS_ALLOWED_ORIGINS
LOG_LEVEL
```

Validate all variables during startup and fail fast when required production configuration is absent.

---

## 13. Testing Strategy

### Unit tests

- Reminder time calculation
- Retry backoff
- Session expiry and rotation
- Google account linking rules
- Authorization/ownership guards

### Integration tests

- Registration/login/refresh/logout
- Google token verification with mocked Google verifier
- Event creation transaction
- Event update reminder reconciliation
- Event cancellation
- Device-token upsert
- Scheduler claim behavior

### Database tests

- Check constraints reject invalid rows
- Unique reminder schedule works
- Cascades and `SET NULL` behavior work
- Concurrent claims do not duplicate work

### End-to-end tests

- New user creates event and receives push
- Expired access token refreshes transparently
- Revoked session cannot refresh
- Deleted event never sends a reminder
- Invalid FCM token becomes inactive

---

## 14. Implementation Order

### Phase 0 — Database

- Deploy v2 migration
- Add password reset/preference migration when those features begin
- Generate Prisma client

### Phase 1 — Backend foundation

- TypeScript/Express setup
- Environment validation
- Prisma singleton
- Logging, error handling, request IDs
- Health endpoints

### Phase 2 — Authentication

- Email register/login
- Access tokens
- 30-day session creation and refresh rotation
- Google login
- Logout and session management

### Phase 3 — Events and dashboard

- Event/reminder repositories and services
- Transactional CRUD
- Dashboard queries

### Phase 4 — Notifications

- Device-token APIs
- Firebase integration
- Scheduler claiming/retry/recovery
- Delivery history and health

### Phase 5 — Hardening

- Rate limits
- Full tests
- Metrics and alerting
- Deployment and backup verification

---

## 15. Backend Definition of Done

- The production migration is applied and Prisma reports no pending migrations.
- Email and Google authentication both create secure 30-day sessions.
- Refresh tokens are random, hashed in storage, and rotated.
- Every data query is scoped to the authenticated user.
- Event and reminder writes are transactional.
- Scheduler claims are concurrency-safe.
- Every device delivery attempt is auditable.
- Invalid FCM tokens are deactivated.
- Health endpoints expose API, database, and scheduler status.
- Critical unit, integration, database, and end-to-end tests pass.
- Logs contain request IDs but no passwords, JWTs, refresh tokens, Google tokens, or FCM tokens.
