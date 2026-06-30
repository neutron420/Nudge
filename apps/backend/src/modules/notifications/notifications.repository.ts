import { prisma } from "../../db/prisma.js";
import { DeviceType, NotificationStatus } from "@repo/db";

export class NotificationsRepository {
  async upsertDeviceToken(data: { userId: string; fcmToken: string; deviceType: DeviceType; deviceName?: string }) {
    return prisma.deviceToken.upsert({
      where: { fcmToken: data.fcmToken },
      update: {
        userId: data.userId,
        deviceType: data.deviceType,
        deviceName: data.deviceName,
        isActive: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId: data.userId,
        fcmToken: data.fcmToken,
        deviceType: data.deviceType,
        deviceName: data.deviceName,
        isActive: true,
      },
    });
  }

  async findDeviceToken(id: string, userId: string) {
    return prisma.deviceToken.findFirst({
      where: { id, userId },
    });
  }

  async deactivateDeviceToken(id: string, userId: string): Promise<any> {
    return prisma.deviceToken.updateMany({
      where: { id, userId },
      data: { isActive: false },
    });
  }

  async deactivateDeviceTokenByToken(fcmToken: string): Promise<any> {
    return prisma.deviceToken.updateMany({
      where: { fcmToken },
      data: { isActive: false },
    });
  }

  async listActiveTokensForUser(userId: string) {
    return prisma.deviceToken.findMany({
      where: { userId, isActive: true },
    });
  }

  async createNotificationLog(data: {
    reminderId: string;
    userId: string;
    deviceTokenId?: string;
    fcmMessageId?: string;
    status: NotificationStatus;
    attemptNumber: number;
    errorCode?: string;
    deliveredAt?: Date;
    payload: any;
  }) {
    return prisma.notificationLog.create({
      data: {
        reminderId: data.reminderId,
        userId: data.userId,
        deviceTokenId: data.deviceTokenId,
        fcmMessageId: data.fcmMessageId,
        status: data.status,
        attemptNumber: data.attemptNumber,
        errorCode: data.errorCode,
        deliveredAt: data.deliveredAt,
        payload: data.payload,
      },
    });
  }

  async getLogsForUser(userId: string, skip: number, limit: number) {
    const [data, total] = await prisma.$transaction([
      prisma.notificationLog.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: {
          reminder: {
            include: { event: true },
          },
          deviceToken: true,
        },
        skip,
        take: limit,
      }),
      prisma.notificationLog.count({ where: { userId } }),
    ]);

    return { data, total };
  }

  async getDeliveryHealthStats(userId: string) {
    const logs = await prisma.notificationLog.findMany({
      where: { userId },
      select: { status: true },
    });

    const total = logs.length;
    const sent = logs.filter((l) => l.status === NotificationStatus.SENT).length;
    const failed = total - sent;

    const deviceTokens = await prisma.deviceToken.findMany({
      where: { userId },
      select: { isActive: true },
    });

    const activeDevices = deviceTokens.filter((d) => d.isActive).length;
    const inactiveDevices = deviceTokens.length - activeDevices;

    return {
      totalAttempts: total,
      successfulAttempts: sent,
      failedAttempts: failed,
      successRate: total > 0 ? (sent / total) * 100 : 100,
      activeDevices,
      inactiveDevices,
    };
  }
}

export const notificationsRepository = new NotificationsRepository();
