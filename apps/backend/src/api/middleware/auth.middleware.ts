import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../../common/security/jwt.js";
import { UnauthorizedError } from "../../common/errors/custom-errors.js";

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Authentication token is missing or malformed");
    }

    const token = authHeader.substring(7); // Remove "Bearer "
    const decoded = await verifyAccessToken(token);

    // Attach decoded info to req.user
    req.user = {
      userId: decoded.userId,
      sessionId: decoded.sessionId,
    };

    next();
  } catch (err: any) {
    const message = err.name === "JWTExpired" ? "Access token has expired" : "Invalid access token";
    next(new UnauthorizedError(message));
  }
};
