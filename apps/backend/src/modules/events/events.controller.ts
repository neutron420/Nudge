import { Request, Response, NextFunction } from "express";
import { eventService } from "./events.service.js";

export class EventController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const result = await eventService.create(userId, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { status, page, limit } = req.query as any;

      const result = await eventService.list(userId, {
        status,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async listUpcoming(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { days } = req.query as any;

      const result = await eventService.listUpcoming(userId, { days });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const eventId = req.params["id"]!;

      const result = await eventService.getDetails(eventId, userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const eventId = req.params["id"]!;

      const result = await eventService.update(eventId, userId, req.body);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const eventId = req.params["id"]!;

      await eventService.delete(eventId, userId);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  async complete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const eventId = req.params["id"]!;

      await eventService.complete(eventId, userId);

      res.status(200).json({ success: true, message: "Event completed and pending reminders cancelled" });
    } catch (error) {
      next(error);
    }
  }
}

export const eventController = new EventController();
