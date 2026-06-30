import { notificationsRepository } from "./notifications.repository.js";
import { DeviceType } from "@repo/db";

export class NotificationsService {
  async registerDeviceToken(
    userId: string,
    data: { fcmToken: string; deviceType: DeviceType; deviceName?: string }
  ) {
    return notificationsRepository.upsertDeviceToken({
      userId,
      fcmToken: data.fcmToken,
      deviceType: data.deviceType,
      deviceName: data.deviceName,
    });
  }

  async deactivateDeviceToken(userId: string, id: string): Promise<any> {
    return notificationsRepository.deactivateDeviceToken(id, userId);
  }

  async getHistory(userId: string, query: { page: number; limit: number }) {
    const skip = (query.page - 1) * query.limit;
    const { data, total } = await notificationsRepository.getLogsForUser(userId, skip, query.limit);

    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getHealth(userId: string) {
    return notificationsRepository.getDeliveryHealthStats(userId);
  }
}

export const notificationsService = new NotificationsService();
