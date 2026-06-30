import { Router } from "express";
import { dashboardController } from "./dashboard.controller.js";
import { authMiddleware } from "../../api/middleware/auth.middleware.js";

const router = Router();

router.get("/", authMiddleware, dashboardController.getSummary);

export default router;
