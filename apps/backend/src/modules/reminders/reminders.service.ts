import { remindersRepository } from "./reminders.repository.js";
import { eventRepository } from "../events/events.repository.js";
import { NotFoundError, BadRequestError } from "../../common/errors/custom-errors.js";
import { ReminderStatus, EventStatus } from "@repo/db";

export class RemindersService {
  async addReminder(userId: string, eventId: string, offsetMinutes: number) {
    const event = await eventRepository.findEventById(eventId, userId);
    if (!event || event.userId !== userId) {
      throw new NotFoundError("Event not found or you do not have permission");
    }

    if (event.status !== EventStatus.ACTIVE) {
      throw new BadRequestError("Cannot add reminders to a non-active event");
    }

    const scheduledFor = new Date(new Date(event.startAt).getTime() - offsetMinutes * 60 * 1000);
    if (scheduledFor < new Date()) {
      throw new BadRequestError("Calculated reminder time is in the past");
    }

    // Check for duplicate scheduledFor or offset
    const existing = await remindersRepository.listForEvent(eventId, userId);
    if (existing.some((r) => r.offsetMinutes === offsetMinutes)) {
      throw new BadRequestError("A reminder with this offset already exists for this event");
    }

    return remindersRepository.create({
      eventId,
      userId,
      scheduledFor,
      offsetMinutes,
    });
  }

  async listReminders(userId: string, eventId: string) {
    const event = await eventRepository.findEventById(eventId, userId);
    if (!event || event.userId !== userId) {
      throw new NotFoundError("Event not found or you do not have permission");
    }

    return remindersRepository.listForEvent(eventId, userId);
  }

  async updateReminder(userId: string, reminderId: string, offsetMinutes: number) {
    const reminder = await remindersRepository.findById(reminderId, userId);
    if (!reminder) {
      throw new NotFoundError("Reminder not found or you do not have permission");
    }

    if (reminder.status !== ReminderStatus.PENDING) {
      throw new BadRequestError("Only pending reminders can be updated");
    }

    const event = reminder.event;
    const scheduledFor = new Date(new Date(event.startAt).getTime() - offsetMinutes * 60 * 1000);
    if (scheduledFor < new Date()) {
      throw new BadRequestError("Calculated reminder time is in the past");
    }

    return remindersRepository.update(reminderId, {
      scheduledFor,
    });
  }

  async cancelReminder(userId: string, reminderId: string) {
    const reminder = await remindersRepository.findById(reminderId, userId);
    if (!reminder) {
      throw new NotFoundError("Reminder not found or you do not have permission");
    }

    if (reminder.status === ReminderStatus.SENT) {
      throw new BadRequestError("Cannot cancel a reminder that has already been sent");
    }

    return remindersRepository.update(reminderId, {
      status: ReminderStatus.CANCELLED,
    });
  }

  async retryReminder(userId: string, reminderId: string) {
    const reminder = await remindersRepository.findById(reminderId, userId);
    if (!reminder) {
      throw new NotFoundError("Reminder not found or you do not have permission");
    }

    if (reminder.status !== ReminderStatus.FAILED) {
      throw new BadRequestError("Only failed reminders can be retried manually");
    }

    return remindersRepository.update(reminderId, {
      status: ReminderStatus.RETRY,
      retryCount: 0,
      nextRetryAt: new Date(),
    });
  }
}

export const remindersService = new RemindersService();
