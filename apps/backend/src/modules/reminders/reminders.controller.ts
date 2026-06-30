import { Request, Response, NextFunction } from "express";
import { remindersService } from "./reminders.service.js";

export class RemindersController {
  async add(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const eventId = req.params["eventId"]!;
      const { offsetMinutes } = req.body;

      const result = await remindersService.addReminder(userId, eventId, offsetMinutes);

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const eventId = req.params["eventId"]!;

      const result = await remindersService.listReminders(userId, eventId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const reminderId = req.params["id"]!;
      const { offsetMinutes } = req.body;

      const result = await remindersService.updateReminder(userId, reminderId, offsetMinutes);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const reminderId = req.params["id"]!;

      const result = await remindersService.cancelReminder(userId, reminderId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async retry(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const reminderId = req.params["id"]!;

      const result = await remindersService.retryReminder(userId, reminderId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const remindersController = new RemindersController();
