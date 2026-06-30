import { Request, Response, NextFunction } from "express";
import { notificationsService } from "./notifications.service.js";

export class NotificationsController {
  async upsertToken(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { fcmToken, deviceType, deviceName } = req.body;

      const result = await notificationsService.registerDeviceToken(userId, {
        fcmToken,
        deviceType,
        deviceName,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async deactivateToken(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const tokenId = req.params["id"]!;

      await notificationsService.deactivateDeviceToken(userId, tokenId);

      res.status(200).json({ success: true, message: "Device token deactivated successfully" });
    } catch (error) {
      next(error);
    }
  }

  async history(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const page = parseInt(req.query["page"] as string) || 1;
      const limit = parseInt(req.query["limit"] as string) || 20;

      const result = await notificationsService.getHistory(userId, { page, limit });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async health(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const result = await notificationsService.getHealth(userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const notificationsController = new NotificationsController();
