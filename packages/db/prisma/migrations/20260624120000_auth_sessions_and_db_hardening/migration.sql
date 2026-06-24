-- AddEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

-- AlterEnum
ALTER TYPE "ReminderStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3),
ALTER COLUMN "passwordHash" DROP NOT NULL,
DROP COLUMN "refreshToken";

-- Existing timestamp-without-time-zone values were written as UTC instants.
ALTER TABLE "events"
ALTER COLUMN "startAt" TYPE TIMESTAMPTZ(3) USING "startAt" AT TIME ZONE 'UTC',
ALTER COLUMN "endAt" TYPE TIMESTAMPTZ(3) USING "endAt" AT TIME ZONE 'UTC';

ALTER TABLE "reminders"
ALTER COLUMN "scheduledFor" TYPE TIMESTAMPTZ(3) USING "scheduledFor" AT TIME ZONE 'UTC',
ALTER COLUMN "nextRetryAt" TYPE TIMESTAMPTZ(3) USING "nextRetryAt" AT TIME ZONE 'UTC',
ALTER COLUMN "sentAt" TYPE TIMESTAMPTZ(3) USING "sentAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lockedAt" TYPE TIMESTAMPTZ(3) USING "lockedAt" AT TIME ZONE 'UTC';

ALTER TABLE "notification_log"
ADD COLUMN "deviceTokenId" TEXT,
ALTER COLUMN "deliveredAt" TYPE TIMESTAMPTZ(3) USING "deliveredAt" AT TIME ZONE 'UTC';

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- A session represents one signed-in device. Its refresh-token hash is rotated
-- by the backend, while the absolute session lifetime defaults to 30 days.
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- Database-level invariants that Prisma cannot currently express.
ALTER TABLE "events"
ADD CONSTRAINT "events_end_at_after_start_at_check"
CHECK ("endAt" IS NULL OR "endAt" >= "startAt");

ALTER TABLE "reminders"
ADD CONSTRAINT "reminders_offset_minutes_nonnegative_check"
CHECK ("offsetMinutes" >= 0),
ADD CONSTRAINT "reminders_retry_count_nonnegative_check"
CHECK ("retryCount" >= 0),
ADD CONSTRAINT "reminders_max_retries_nonnegative_check"
CHECK ("maxRetries" >= 0),
ADD CONSTRAINT "reminders_retry_count_within_max_check"
CHECK ("retryCount" <= "maxRetries");

ALTER TABLE "notification_log"
ADD CONSTRAINT "notification_log_attempt_number_positive_check"
CHECK ("attemptNumber" > 0);

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_expiry_after_creation_check"
CHECK ("expiresAt" > "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_provider_providerAccountId_key"
ON "auth_accounts"("provider", "providerAccountId");

CREATE INDEX "auth_accounts_userId_idx"
ON "auth_accounts"("userId");

CREATE UNIQUE INDEX "sessions_refreshTokenHash_key"
ON "sessions"("refreshTokenHash");

CREATE INDEX "sessions_userId_revokedAt_idx"
ON "sessions"("userId", "revokedAt");

CREATE INDEX "sessions_expiresAt_idx"
ON "sessions"("expiresAt");

CREATE INDEX "reminders_status_nextRetryAt_idx"
ON "reminders"("status", "nextRetryAt");

CREATE UNIQUE INDEX "reminders_eventId_scheduledFor_key"
ON "reminders"("eventId", "scheduledFor");

CREATE INDEX "notification_log_deviceTokenId_idx"
ON "notification_log"("deviceTokenId");

-- The unique constraint on users.email already supplies the required index.
DROP INDEX "users_email_idx";

-- AddForeignKey
ALTER TABLE "auth_accounts"
ADD CONSTRAINT "auth_accounts_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_log"
ADD CONSTRAINT "notification_log_deviceTokenId_fkey"
FOREIGN KEY ("deviceTokenId") REFERENCES "device_tokens"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
