import { Router } from "express";
import { remindersController } from "./reminders.controller.js";
import { authMiddleware } from "../../api/middleware/auth.middleware.js";
import { validate } from "../../api/middleware/validate.middleware.js";
import { z } from "zod";

const router = Router();
router.use(authMiddleware);

const offsetSchema = z.object({
  offsetMinutes: z.number().int().min(0, "Offset minutes must be 0 or more"),
});

// Event-scoped reminder routes
router.post(
  "/events/:eventId/reminders",
  validate({ body: offsetSchema }),
  remindersController.add
);
router.get("/events/:eventId/reminders", remindersController.list);

// Global reminder routes
router.patch("/reminders/:id", validate({ body: offsetSchema }), remindersController.update);
router.delete("/reminders/:id", remindersController.cancel);
router.post("/reminders/:id/retry", remindersController.retry);

export default router;
