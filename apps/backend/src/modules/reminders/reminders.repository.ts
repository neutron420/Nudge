import { prisma } from "../../db/prisma.js";
import { ReminderStatus } from "@repo/db";

export class RemindersRepository {
  async findById(id: string, userId: string) {
    return prisma.reminder.findFirst({
      where: { id, userId },
      include: { event: true },
    });
  }

  async listForEvent(eventId: string, userId: string) {
    return prisma.reminder.findMany({
      where: { eventId, userId },
      orderBy: { scheduledFor: "asc" },
    });
  }

  async create(data: { eventId: string; userId: string; scheduledFor: Date; offsetMinutes: number }) {
    return prisma.reminder.create({
      data: {
        eventId: data.eventId,
        userId: data.userId,
        scheduledFor: data.scheduledFor,
        offsetMinutes: data.offsetMinutes,
        status: ReminderStatus.PENDING,
      },
    });
  }

  async update(id: string, data: { scheduledFor?: Date; status?: ReminderStatus; retryCount?: number; nextRetryAt?: Date | null; sentAt?: Date | null }) {
    return prisma.reminder.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return prisma.reminder.delete({
      where: { id },
    });
  }
}

export const remindersRepository = new RemindersRepository();
