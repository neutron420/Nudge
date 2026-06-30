import { Router } from "express";
import { authController } from "./auth.controller.js";
import { authMiddleware } from "../../api/middleware/auth.middleware.js";
import { validate } from "../../api/middleware/validate.middleware.js";
import { authRateLimiter } from "../../api/middleware/rateLimiter.middleware.js";
import {
  registerSchema,
  loginSchema,
  googleLoginSchema,
  refreshSchema,
  updateProfileSchema,
} from "./auth.schemas.js";

const router = Router();

// Public routes with authentication rate limiting
router.post(
  "/register",
  authRateLimiter,
  validate({ body: registerSchema }),
  authController.register
);

router.post(
  "/login",
  authRateLimiter,
  validate({ body: loginSchema }),
  authController.login
);

router.post(
  "/google",
  authRateLimiter,
  validate({ body: googleLoginSchema }),
  authController.googleLogin
);

router.post(
  "/refresh",
  validate({ body: refreshSchema }),
  authController.refresh
);

// Authenticated routes
router.post("/logout", authMiddleware, authController.logout);
router.post("/logout-all", authMiddleware, authController.logoutAll);

router.get("/me", authMiddleware, authController.me);
router.patch(
  "/me",
  authMiddleware,
  validate({ body: updateProfileSchema }),
  authController.updateProfile
);

router.get("/sessions", authMiddleware, authController.getSessions);
router.delete("/sessions/:id", authMiddleware, authController.revokeSession);

export default router;
