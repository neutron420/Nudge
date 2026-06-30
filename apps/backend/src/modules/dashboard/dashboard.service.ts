import { prisma } from "../../db/prisma.js";
import { EventStatus, ReminderStatus } from "@repo/db";

export class DashboardService {
  async getSummary(userId: string) {
    const now = new Date();
    
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // Run queries sequentially instead of Promise.all to prevent database driver adapter concurrency limits
    const todayCount = await prisma.event.count({
      where: {
        userId,
        status: EventStatus.ACTIVE,
        deletedAt: null,
        startAt: {
          gte: startOfToday,
          lte: endOfToday,
        },
      },
    });

    const upcomingCount = await prisma.event.count({
      where: {
        userId,
        status: EventStatus.ACTIVE,
        deletedAt: null,
        startAt: {
          gt: endOfToday,
          lte: new Date(endOfToday.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    });

    const overdueCount = await prisma.event.count({
      where: {
        userId,
        status: EventStatus.ACTIVE,
        deletedAt: null,
        startAt: {
          lt: now,
        },
      },
    });

    const failedRemindersCount = await prisma.reminder.count({
      where: {
        userId,
        status: ReminderStatus.FAILED,
      },
    });

    // Fetch a brief list of today's events
    const todayEvents = await prisma.event.findMany({
      where: {
        userId,
        status: EventStatus.ACTIVE,
        deletedAt: null,
        startAt: {
          gte: startOfToday,
          lte: endOfToday,
        },
      },
      orderBy: { startAt: "asc" },
      take: 5,
    });

    return {
      stats: {
        todayCount,
        upcomingCount,
        overdueCount,
        failedRemindersCount,
      },
      todayEvents,
    };
  }
}

export const dashboardService = new DashboardService();
