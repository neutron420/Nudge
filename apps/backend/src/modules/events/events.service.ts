import { eventRepository } from "./events.repository.js";
import { NotFoundError, BadRequestError } from "../../common/errors/custom-errors.js";
import { EventStatus, ReminderStatus } from "@repo/db";

export class EventService {
  private verifyEventOwnership<T>(event: T | null | undefined, userId: string): T {
    if (!event || (event as any).userId !== userId) {
      throw new NotFoundError("Event not found or you do not have permission");
    }
    return event;
  }

  async create(
    userId: string,
    data: {
      title: string;
      description?: string;
      eventType: any;
      startAt: string;
      endAt?: string;
      timezone: string;
      location?: string;
      isAllDay: boolean;
      reminders: { offsetMinutes: number }[];
    }
  ) {
    const startAtDate = new Date(data.startAt);
    const endAtDate = data.endAt ? new Date(data.endAt) : undefined;

    // Map reminders to computed times
    const remindersToCreate = data.reminders.map((rem) => {
      const scheduledFor = new Date(startAtDate.getTime() - rem.offsetMinutes * 60 * 1000);
      return {
        offsetMinutes: rem.offsetMinutes,
        scheduledFor,
      };
    });

    return eventRepository.createEvent(
      userId,
      {
        title: data.title,
        description: data.description,
        eventType: data.eventType,
        startAt: startAtDate,
        endAt: endAtDate,
        timezone: data.timezone,
        location: data.location,
        isAllDay: data.isAllDay,
      },
      remindersToCreate
    );
  }

  async list(userId: string, query: { status?: string; page: number; limit: number }) {
    const statusEnum = query.status as EventStatus | undefined;
    const skip = (query.page - 1) * query.limit;

    const { data, total } = await eventRepository.listEvents(userId, {
      status: statusEnum,
      skip,
      limit: query.limit,
    });

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

  async listUpcoming(userId: string, query: { days: number }) {
    const endDate = new Date(Date.now() + query.days * 24 * 60 * 60 * 1000);
    const data = await eventRepository.listUpcoming(userId, endDate);
    return { data };
  }

  async getDetails(eventId: string, userId: string) {
    const rawEvent = await eventRepository.findEventById(eventId, userId);
    const event = this.verifyEventOwnership(rawEvent, userId);
    return event;
  }

  async update(
    eventId: string,
    userId: string,
    data: {
      title?: string;
      description?: string;
      eventType?: any;
      startAt?: string;
      endAt?: string;
      timezone?: string;
      location?: string;
      isAllDay?: boolean;
      reminders?: { offsetMinutes: number }[];
    }
  ) {
    const rawEvent = await eventRepository.findEventById(eventId, userId);
    const event = this.verifyEventOwnership(rawEvent, userId);

    if (event.status !== EventStatus.ACTIVE) {
      throw new BadRequestError("Only active events can be updated");
    }

    const newStartAt = data.startAt ? new Date(data.startAt) : new Date(event.startAt);
    const newEndAt = data.endAt ? new Date(data.endAt) : event.endAt ? new Date(event.endAt) : undefined;

    if (newEndAt && newEndAt < newStartAt) {
      throw new BadRequestError("endAt must be greater than or equal to startAt");
    }

    const startAtChanged = data.startAt !== undefined || data.timezone !== undefined;

    // Build lists for reconciliation
    const remindersToDelete: string[] = [];
    const remindersToCreate: { offsetMinutes: number; scheduledFor: Date }[] = [];
    const remindersToUpdate: { id: string; scheduledFor: Date }[] = [];

    const existingReminders = event.reminders;

    if (data.reminders !== undefined) {
      // Reconcile reminders
      const newOffsets = new Set(data.reminders.map((r) => r.offsetMinutes));

      // 1. Identify which existing reminders are NOT in the new list
      for (const existing of existingReminders) {
        if (!newOffsets.has(existing.offsetMinutes)) {
          // If pending/retry, we delete it
          if (existing.status === ReminderStatus.PENDING || existing.status === ReminderStatus.RETRY) {
            remindersToDelete.push(existing.id);
          }
          // If already sent/processing/failed, we preserve history and do nothing
        }
      }

      // 2. Identify which new offsets need to be created or updated
      for (const newRem of data.reminders) {
        const scheduledFor = new Date(newStartAt.getTime() - newRem.offsetMinutes * 60 * 1000);
        const existing = existingReminders.find((r) => r.offsetMinutes === newRem.offsetMinutes);

        if (existing) {
          // Exists in DB
          if (existing.status === ReminderStatus.PENDING || existing.status === ReminderStatus.RETRY) {
            // Update scheduledFor if startAt changed
            if (startAtChanged) {
              if (scheduledFor < new Date()) {
                throw new BadRequestError(
                  `Recalculated reminder time (${scheduledFor.toISOString()}) is in the past`
                );
              }
              remindersToUpdate.push({ id: existing.id, scheduledFor });
            }
          }
        } else {
          // Create new reminder
          if (scheduledFor < new Date()) {
            throw new BadRequestError(
              `Recalculated reminder time (${scheduledFor.toISOString()}) is in the past`
            );
          }
          remindersToCreate.push({ offsetMinutes: newRem.offsetMinutes, scheduledFor });
        }
      }
    } else if (startAtChanged) {
      // If startAt changed but reminders list was not updated,
      // we must recalculate scheduledFor for all existing PENDING and RETRY reminders
      for (const existing of existingReminders) {
        if (existing.status === ReminderStatus.PENDING || existing.status === ReminderStatus.RETRY) {
          const scheduledFor = new Date(newStartAt.getTime() - existing.offsetMinutes * 60 * 1000);
          if (scheduledFor < new Date()) {
            throw new BadRequestError(
              `Recalculated reminder time (${scheduledFor.toISOString()}) is in the past`
            );
          }
          remindersToUpdate.push({ id: existing.id, scheduledFor });
        }
      }
    }

    // Build clean event details updates
    const eventUpdateData: any = {};
    if (data.title !== undefined) eventUpdateData.title = data.title;
    if (data.description !== undefined) eventUpdateData.description = data.description;
    if (data.eventType !== undefined) eventUpdateData.eventType = data.eventType;
    if (data.startAt !== undefined) eventUpdateData.startAt = newStartAt;
    if (data.endAt !== undefined) eventUpdateData.endAt = newEndAt;
    if (data.timezone !== undefined) eventUpdateData.timezone = data.timezone;
    if (data.location !== undefined) eventUpdateData.location = data.location;
    if (data.isAllDay !== undefined) eventUpdateData.isAllDay = data.isAllDay;

    return eventRepository.updateEventTransaction(
      eventId,
      userId,
      eventUpdateData,
      remindersToDelete,
      remindersToCreate,
      remindersToUpdate
    );
  }

  async delete(eventId: string, userId: string) {
    const rawEvent = await eventRepository.findEventById(eventId, userId);
    this.verifyEventOwnership(rawEvent, userId);

    await eventRepository.cancelEventTransaction(eventId);
  }

  async complete(eventId: string, userId: string) {
    const rawEvent = await eventRepository.findEventById(eventId, userId);
    const event = this.verifyEventOwnership(rawEvent, userId);

    if (event.status !== EventStatus.ACTIVE) {
      throw new BadRequestError("Only active events can be marked complete");
    }

    await eventRepository.completeEventTransaction(eventId);
  }
}

export const eventService = new EventService();
