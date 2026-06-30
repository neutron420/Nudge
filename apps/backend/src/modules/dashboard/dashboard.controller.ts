import { Request, Response, NextFunction } from "express";
import { dashboardService } from "./dashboard.service.js";

export class DashboardController {
  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const result = await dashboardService.getSummary(userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const dashboardController = new DashboardController();
