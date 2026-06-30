import bcrypt from "bcryptjs";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env.js";
import { signAccessToken } from "../../common/security/jwt.js";
import { authRepository } from "./auth.repository.js";
import { AuthProvider } from "@repo/db";
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from "../../common/errors/custom-errors.js";
import logger from "../../config/logger.js";

// Initialize Google OAuth2 Client if client ID is set
const googleClient = env.GOOGLE_WEB_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_WEB_CLIENT_ID)
  : null;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class AuthService {
  private generateSessionTokens(userId: string) {
    const rawRefreshToken = crypto.randomBytes(32).toString("hex");
    const refreshTokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    return {
      rawRefreshToken,
      refreshTokenHash,
      expiresAt,
    };
  }

  async register(data: { email: string; passwordHash: string; name: string; timezone: string }, ip?: string, ua?: string) {
    const existing = await authRepository.findUserByEmail(data.email);
    if (existing) {
      throw new ConflictError("Email is already registered");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.passwordHash, salt);

    const user = await authRepository.createUserWithEmail({
      email: data.email,
      passwordHash,
      name: data.name,
      timezone: data.timezone,
    });

    const { rawRefreshToken, refreshTokenHash, expiresAt } = this.generateSessionTokens(user.id);

    const session = await authRepository.createSession({
      userId: user.id,
      refreshTokenHash,
      expiresAt,
      ipAddress: ip,
      userAgent: ua,
    });

    const accessToken = await signAccessToken({ userId: user.id, sessionId: session.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async login(data: { email: string; passwordHash: string }, ip?: string, ua?: string) {
    const user = await authRepository.findUserByEmail(data.email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const isMatch = await bcrypt.compare(data.passwordHash, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const { rawRefreshToken, refreshTokenHash, expiresAt } = this.generateSessionTokens(user.id);

    const session = await authRepository.createSession({
      userId: user.id,
      refreshTokenHash,
      expiresAt,
      ipAddress: ip,
      userAgent: ua,
    });

    const accessToken = await signAccessToken({ userId: user.id, sessionId: session.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async googleLogin(idToken: string, timezone: string, ip?: string, ua?: string) {
    let email: string | undefined;
    let name: string | undefined;
    let googleSub: string | undefined;
    let emailVerified = false;

    // Support mock verification in test/development if credentials are not fully configured
    if (env.NODE_ENV !== "production" && idToken.startsWith("mock-google-token-")) {
      const mockEmail = `${idToken.replace("mock-google-token-", "")}@example.com`;
      email = mockEmail;
      name = "Mock User";
      googleSub = `google-sub-${mockEmail}`;
      emailVerified = true;
      logger.info(`Bypassed Google OAuth check in development for: ${mockEmail}`);
    } else {
      if (!googleClient) {
        throw new BadRequestError("Google Authentication Client ID is not configured on this server");
      }
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken,
          audience: env.GOOGLE_WEB_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload) {
          throw new UnauthorizedError("Invalid Google token payload");
        }
        email = payload.email;
        name = payload.name;
        googleSub = payload.sub;
        emailVerified = payload.email_verified === true;
      } catch (err: any) {
        logger.warn("Google token verification failed:", err.message);
        throw new UnauthorizedError("Google Authentication failed");
      }
    }

    if (!email || !googleSub) {
      throw new UnauthorizedError("Google account does not expose email or unique ID");
    }

    if (!emailVerified) {
      throw new UnauthorizedError("Google email is not verified");
    }

    // Upsert user and account
    const { user } = await authRepository.createUserWithOAuth({
      email,
      name: name || email.split("@")[0] || "Google User",
      timezone,
      provider: AuthProvider.GOOGLE,
      providerAccountId: googleSub,
      emailVerifiedAt: new Date(),
    });

    const { rawRefreshToken, refreshTokenHash, expiresAt } = this.generateSessionTokens(user.id);

    const session = await authRepository.createSession({
      userId: user.id,
      refreshTokenHash,
      expiresAt,
      ipAddress: ip,
      userAgent: ua,
    });

    const accessToken = await signAccessToken({ userId: user.id, sessionId: session.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async refresh(rawRefreshToken: string, ip?: string, ua?: string) {
    const hashed = hashToken(rawRefreshToken);
    const session = await authRepository.findSessionByHash(hashed);

    if (!session) {
      // Reused/stolen refresh token detection: if a token hash is not found but was submitted,
      // it is possible the session was already rotated. For simplicity, throw Unauthorized.
      throw new UnauthorizedError("Session has expired or is invalid");
    }

    if (session.revokedAt) {
      throw new UnauthorizedError("Session has been revoked");
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedError("Session has expired");
    }

    // Generate new rotated token
    const newTokens = this.generateSessionTokens(session.userId);

    await authRepository.updateSession(session.id, {
      refreshTokenHash: newTokens.refreshTokenHash,
      expiresAt: newTokens.expiresAt,
      lastUsedAt: new Date(),
    });

    const accessToken = await signAccessToken({ userId: session.userId, sessionId: session.id });

    return {
      accessToken,
      refreshToken: newTokens.rawRefreshToken,
    };
  }

  async logout(sessionId: string) {
    await authRepository.revokeSession(sessionId);
  }

  async logoutAll(userId: string) {
    await authRepository.revokeAllUserSessions(userId);
  }

  async getProfile(userId: string) {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedError("User profile not found");
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      avatarUrl: user.avatarUrl,
    };
  }

  async updateProfile(userId: string, data: { name?: string; timezone?: string; avatarUrl?: string }) {
    const user = await authRepository.updateUserProfile(userId, data);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      avatarUrl: user.avatarUrl,
    };
  }

  async getSessions(userId: string) {
    return authRepository.listActiveSessions(userId);
  }

  async revokeSession(userId: string, sessionIdToRevoke: string) {
    const session = await authRepository.findSessionById(sessionIdToRevoke);
    if (!session || session.userId !== userId) {
      throw new BadRequestError("Session not found or not owned by you");
    }
    await authRepository.revokeSession(sessionIdToRevoke);
  }
}

export const authService = new AuthService();
