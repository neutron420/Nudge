import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service.js";

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password, name, timezone } = req.body;
      const ip = req.ip;
      const ua = req.headers["user-agent"];

      const result = await authService.register(
        { email, passwordHash: password, name, timezone },
        ip,
        ua
      );

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const ip = req.ip;
      const ua = req.headers["user-agent"];

      const result = await authService.login({ email, passwordHash: password }, ip, ua);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async googleLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { idToken, timezone } = req.body;
      const ip = req.ip;
      const ua = req.headers["user-agent"];

      const result = await authService.googleLogin(idToken, timezone, ip, ua);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const ip = req.ip;
      const ua = req.headers["user-agent"];

      const result = await authService.refresh(refreshToken, ip, ua);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = req.user!.sessionId;
      await authService.logout(sessionId);

      res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      next(error);
    }
  }

  async logoutAll(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      await authService.logoutAll(userId);

      res.status(200).json({ success: true, message: "Logged out from all devices successfully" });
    } catch (error) {
      next(error);
    }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const profile = await authService.getProfile(userId);

      res.status(200).json(profile);
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { name, timezone, avatarUrl } = req.body;

      const profile = await authService.updateProfile(userId, { name, timezone, avatarUrl });

      res.status(200).json(profile);
    } catch (error) {
      next(error);
    }
  }

  async getSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const sessions = await authService.getSessions(userId);

      res.status(200).json(sessions);
    } catch (error) {
      next(error);
    }
  }

  async revokeSession(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const sessionToRevoke = req.params["id"]!;

      await authService.revokeSession(userId, sessionToRevoke);

      res.status(200).json({ success: true, message: "Session revoked successfully" });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
