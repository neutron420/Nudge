import cron from "node-cron";
import crypto from "crypto";
import { prisma } from "../db/prisma.js";
import { notificationsRepository } from "../modules/notifications/notifications.repository.js";
import { sendPushNotifications } from "../integrations/firebase/firebase.js";
import { ReminderStatus, EventStatus, NotificationStatus, Prisma } from "@repo/db";
import logger from "../config/logger.js";

const workerId = crypto.randomUUID();
export let lastSchedulerTick: Date | null = null;

// Helper to calculate exponential backoff time
export function getNextRetryAt(retryCount: number): Date {
  const delays = [1, 2, 5, 15, 30]; // in minutes
  const delayMinutes = delays[retryCount] ?? 30;
  // Add jitter (±15 seconds) to avoid synchronization spikes
  const jitterMs = (Math.random() * 30 - 15) * 1000;
  return new Date(Date.now() + delayMinutes * 60 * 1000 + jitterMs);
}

// 1. Stale Lock Recovery
export async function recoverStaleLocks() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  try {
    const result = await prisma.reminder.updateMany({
      where: {
        status: ReminderStatus.PROCESSING,
        lockedAt: {
          lt: fiveMinutesAgo,
        },
      },
      data: {
        status: ReminderStatus.PENDING,
        lockedAt: null,
        lockedBy: null,
      },
    });

    if (result.count > 0) {
      logger.info(`[Scheduler] Recovered ${result.count} stale locked reminders`);
    }
  } catch (error: any) {
    logger.error("[Scheduler] Error recovering stale locks:", error.message);
  }
}

// 2. Claiming Due Reminders using Row Locking (SKIP LOCKED)
export async function claimDueReminders() {
  try {
    return await prisma.$transaction(async (tx) => {
      // Fetch due reminders (PENDING or RETRY due) using SELECT ... FOR UPDATE SKIP LOCKED
      // Raw query because Prisma doesn't natively support SKIP LOCKED
      const now = new Date();
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM reminders
        WHERE (status = 'PENDING' AND "scheduledFor" <= ${now})
           OR (status = 'RETRY' AND "nextRetryAt" <= ${now})
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);

      // Lock them in DB
      await tx.reminder.updateMany({
        where: { id: { in: ids } },
        data: {
          status: ReminderStatus.PROCESSING,
          lockedAt: new Date(),
          lockedBy: workerId,
        },
      });

      // Load fully populated reminder objects
      return tx.reminder.findMany({
        where: { id: { in: ids } },
        include: {
          event: true,
          user: {
            include: {
              deviceTokens: {
                where: { isActive: true },
              },
            },
          },
        },
      });
    });
  } catch (error: any) {
    logger.error("[Scheduler] Error claiming due reminders:", error.message);
    return [];
  }
}

// 3. Dispatching Single Reminder
export async function dispatchReminder(reminder: any) {
  const { id: reminderId, userId, event, user } = reminder;

  try {
    // Check cancellation status
    if (event.status === EventStatus.CANCELLED || event.deletedAt) {
      logger.info(`[Scheduler] Skipping cancelled event reminder ${reminderId}`);
      await prisma.reminder.update({
        where: { id: reminderId },
        data: {
          status: ReminderStatus.CANCELLED,
          lockedAt: null,
          lockedBy: null,
        },
      });
      return;
    }

    const deviceTokens = user.deviceTokens;

    if (deviceTokens.length === 0) {
      logger.warn(`[Scheduler] User ${userId} has no active device tokens for reminder ${reminderId}`);

      // Log failure in NotificationLog
      await notificationsRepository.createNotificationLog({
        reminderId,
        userId,
        status: NotificationStatus.FAILED,
        attemptNumber: reminder.retryCount + 1,
        errorCode: "NO_ACTIVE_DEVICES",
        payload: { error: "No active FCM registration tokens found" },
      });

      // Mark reminder as FAILED directly (cannot retry without devices)
      await prisma.reminder.update({
        where: { id: reminderId },
        data: {
          status: ReminderStatus.FAILED,
          lockedAt: null,
          lockedBy: null,
        },
      });
      return;
    }

    // Build push notification payload
    const pushPayload = {
      title: event.title,
      body: event.description || "You have an upcoming event!",
      data: {
        eventId: event.id,
        reminderId,
        eventType: event.eventType,
        startAt: event.startAt.toISOString(),
      },
    };

    const tokens = deviceTokens.map((d: any) => d.fcmToken);
    const results = await sendPushNotifications(tokens, pushPayload);

    let atLeastOneSuccess = false;

    // Record each attempt log and deactivate unregistered tokens
    for (const res of results) {
      const matchedDevice = deviceTokens.find((d: any) => d.fcmToken === res.token);

      await notificationsRepository.createNotificationLog({
        reminderId,
        userId,
        deviceTokenId: matchedDevice?.id,
        fcmMessageId: res.messageId,
        status: res.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
        attemptNumber: reminder.retryCount + 1,
        errorCode: res.error,
        deliveredAt: res.success ? new Date() : undefined,
        payload: { payload: pushPayload, error: res.error },
      });

      if (res.success) {
        atLeastOneSuccess = true;
      }

      if (res.isUnregistered) {
        logger.info(`[Scheduler] Deactivating unregistered token for device ${matchedDevice?.deviceName || "unknown"}`);
        await notificationsRepository.deactivateDeviceTokenByToken(res.token);
      }
    }

    // Update reminder final status
    if (atLeastOneSuccess) {
      await prisma.reminder.update({
        where: { id: reminderId },
        data: {
          status: ReminderStatus.SENT,
          sentAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      });
      logger.info(`[Scheduler] Successfully sent reminder ${reminderId}`);
    } else {
      // Retry policy
      const nextRetryCount = reminder.retryCount + 1;
      if (nextRetryCount < reminder.maxRetries) {
        const nextRetryAt = getNextRetryAt(reminder.retryCount);
        await prisma.reminder.update({
          where: { id: reminderId },
          data: {
            status: ReminderStatus.RETRY,
            retryCount: nextRetryCount,
            nextRetryAt,
            lockedAt: null,
            lockedBy: null,
          },
        });
        logger.info(`[Scheduler] Failed sending reminder ${reminderId}. Scheduled retry ${nextRetryCount} at ${nextRetryAt.toISOString()}`);
      } else {
        await prisma.reminder.update({
          where: { id: reminderId },
          data: {
            status: ReminderStatus.FAILED,
            retryCount: nextRetryCount,
            lockedAt: null,
            lockedBy: null,
          },
        });
        logger.error(`[Scheduler] Failed sending reminder ${reminderId} after maximum retries`);
      }
    }
  } catch (error: any) {
    logger.error(`[Scheduler] Error dispatching reminder ${reminderId}:`, error.message);
    // Safety release lock
    try {
      await prisma.reminder.update({
        where: { id: reminderId },
        data: {
          status: ReminderStatus.PENDING,
          lockedAt: null,
          lockedBy: null,
        },
      });
    } catch (e: any) {
      logger.error(`[Scheduler] Failed to release lock for reminder ${reminderId}:`, e.message);
    }
  }
}

// 4. Tick execution
export async function tick() {
  lastSchedulerTick = new Date();
  logger.debug("[Scheduler] Ticking...");
  
  await recoverStaleLocks();
  const claimed = await claimDueReminders();
  
  if (claimed.length > 0) {
    logger.info(`[Scheduler] Claimed ${claimed.length} reminders to process`);
    // Run concurrent dispatching
    await Promise.all(claimed.map((rem) => dispatchReminder(rem)));
  }
}

// Start scheduler cron job
export function startScheduler() {
  logger.info("[Scheduler] Starting scheduler engine...");
  // Run once immediately on startup to clear anything missed
  tick();
  
  // Run every minute
  cron.schedule("* * * * *", () => {
    tick();
  });
}
