import { z } from "zod";
import { EventType } from "@repo/db";

const eventTypeEnum = z.nativeEnum(EventType);

export const createReminderSchema = z.object({
  offsetMinutes: z.number().int().min(0, "Offset minutes must be greater than or equal to 0"),
});

export const createEventSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(1000).optional(),
    eventType: eventTypeEnum,
    startAt: z.string().datetime("startAt must be a valid ISO timestamp"),
    endAt: z.string().datetime("endAt must be a valid ISO timestamp").optional(),
    timezone: z.string().default("UTC"),
    location: z.string().max(250).optional(),
    isAllDay: z.boolean().default(false),
    reminders: z.array(createReminderSchema).default([]),
  })
  .refine(
    (data) => {
      if (data.endAt) {
        return new Date(data.endAt) >= new Date(data.startAt);
      }
      return true;
    },
    {
      message: "endAt must be greater than or equal to startAt",
      path: ["endAt"],
    }
  );

export const updateEventSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    eventType: eventTypeEnum.optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    timezone: z.string().optional(),
    location: z.string().max(250).optional(),
    isAllDay: z.boolean().optional(),
    reminders: z.array(createReminderSchema).optional(),
  })
  .refine(
    (data) => {
      if (data.startAt && data.endAt) {
        return new Date(data.endAt) >= new Date(data.startAt);
      }
      return true;
    },
    {
      message: "endAt must be greater than or equal to startAt",
      path: ["endAt"],
    }
  );

export const queryEventsSchema = z.object({
  status: z.enum(["ACTIVE", "CANCELLED", "COMPLETED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const queryUpcomingSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
});
