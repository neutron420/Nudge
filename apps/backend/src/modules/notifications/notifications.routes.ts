import { Router } from "express";
import { notificationsController } from "./notifications.controller.js";
import { authMiddleware } from "../../api/middleware/auth.middleware.js";
import { validate } from "../../api/middleware/validate.middleware.js";
import { z } from "zod";
import { DeviceType } from "@repo/db";

const router = Router();
router.use(authMiddleware);

const deviceTokenSchema = z.object({
  fcmToken: z.string().min(1, "fcmToken is required"),
  deviceType: z.nativeEnum(DeviceType),
  deviceName: z.string().max(100).optional(),
});

router.put("/device-token", validate({ body: deviceTokenSchema }), notificationsController.upsertToken);
router.delete("/device-token/:id", notificationsController.deactivateToken);
router.get("/history", notificationsController.history);
router.get("/health", notificationsController.health);

export default router;
