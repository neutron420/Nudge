import { prisma } from "../../db/prisma.js";
import { EventStatus, ReminderStatus } from "@repo/db";

export class EventRepository {
  async findEventById(id: string, userId: string) {
    return prisma.event.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        reminders: {
          orderBy: { scheduledFor: "asc" },
        },
      },
    });
  }

  async listEvents(userId: string, filters: { status?: EventStatus; skip: number; limit: number }) {
    const whereClause: any = { userId, deletedAt: null };
    if (filters.status) {
      whereClause.status = filters.status;
    }

    const [data, total] = await prisma.$transaction([
      prisma.event.findMany({
        where: whereClause,
        orderBy: { startAt: "asc" },
        skip: filters.skip,
        take: filters.limit,
      }),
      prisma.event.count({ where: whereClause }),
    ]);

    return { data, total };
  }

  async listUpcoming(userId: string, endDate: Date) {
    return prisma.event.findMany({
      where: {
        userId,
        status: EventStatus.ACTIVE,
        deletedAt: null,
        startAt: {
          gte: new Date(),
          lte: endDate,
        },
      },
      orderBy: { startAt: "asc" },
    });
  }

  async createEvent(
    userId: string,
    eventData: {
      title: string;
      description?: string;
      eventType: any;
      startAt: Date;
      endAt?: Date;
      timezone: string;
      location?: string;
      isAllDay: boolean;
    },
    reminders: { offsetMinutes: number; scheduledFor: Date }[]
  ) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          ...eventData,
          userId,
        },
      });

      let createdReminders: any[] = [];
      if (reminders.length > 0) {
        // Build map to ensure distinct schedule per event
        const seenScheduled = new Set<string>();
        const distinctReminders = reminders.filter((r) => {
          const key = r.scheduledFor.toISOString();
          if (seenScheduled.has(key)) return false;
          seenScheduled.add(key);
          return true;
        });

        createdReminders = await Promise.all(
          distinctReminders.map((rem) =>
            tx.reminder.create({
              data: {
                eventId: event.id,
                userId,
                scheduledFor: rem.scheduledFor,
                offsetMinutes: rem.offsetMinutes,
                status: ReminderStatus.PENDING,
              },
            })
          )
        );
      }

      return { event, reminders: createdReminders };
    });
  }

  async updateEventTransaction(
    eventId: string,
    userId: string,
    eventData: any,
    remindersToDelete: string[],
    remindersToCreate: { offsetMinutes: number; scheduledFor: Date }[],
    remindersToUpdate: { id: string; scheduledFor: Date }[]
  ) {
    return prisma.$transaction(async (tx) => {
      // 1. Update event details
      const event = await tx.event.update({
        where: { id: eventId },
        data: eventData,
      });

      // 2. Delete reminders marked for deletion
      if (remindersToDelete.length > 0) {
        await tx.reminder.deleteMany({
          where: { id: { in: remindersToDelete } },
        });
      }

      // 3. Update existing reminders scheduledFor
      for (const rem of remindersToUpdate) {
        await tx.reminder.update({
          where: { id: rem.id },
          data: { scheduledFor: rem.scheduledFor },
        });
      }

      // 4. Create new reminders
      let createdReminders: any[] = [];
      if (remindersToCreate.length > 0) {
        // Enforce database level distinct constraint
        const existing = await tx.reminder.findMany({
          where: { eventId },
          select: { scheduledFor: true },
        });
        const seen = new Set(existing.map((e) => e.scheduledFor.toISOString()));

        for (const rem of remindersToCreate) {
          const key = rem.scheduledFor.toISOString();
          if (!seen.has(key)) {
            seen.add(key);
            const created = await tx.reminder.create({
              data: {
                eventId,
                userId,
                scheduledFor: rem.scheduledFor,
                offsetMinutes: rem.offsetMinutes,
                status: ReminderStatus.PENDING,
              },
            });
            createdReminders.push(created);
          }
        }
      }

      // Get final list of reminders
      const allReminders = await tx.reminder.findMany({
        where: { eventId },
        orderBy: { scheduledFor: "asc" },
      });

      return { event, reminders: allReminders };
    });
  }

  async cancelEventTransaction(eventId: string) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.event.update({
        where: { id: eventId },
        data: {
          status: EventStatus.CANCELLED,
          deletedAt: new Date(),
        },
      });

      await tx.reminder.updateMany({
        where: {
          eventId,
          status: { in: [ReminderStatus.PENDING, ReminderStatus.RETRY] },
        },
        data: {
          status: ReminderStatus.CANCELLED,
        },
      });

      return event;
    });
  }

  async completeEventTransaction(eventId: string) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.event.update({
        where: { id: eventId },
        data: {
          status: EventStatus.COMPLETED,
        },
      });

      await tx.reminder.updateMany({
        where: {
          eventId,
          status: { in: [ReminderStatus.PENDING, ReminderStatus.RETRY] },
        },
        data: {
          status: ReminderStatus.CANCELLED,
        },
      });

      return event;
    });
  }
}

export const eventRepository = new EventRepository();
