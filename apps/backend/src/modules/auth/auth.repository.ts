import { prisma } from "../../db/prisma.js";
import { AuthProvider } from "@repo/db";

export class AuthRepository {
  async findUserByEmail(email: string) {
    return prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { authAccounts: true },
    });
  }

  async findUserById(id: string) {
    return prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async findOAuthAccount(provider: AuthProvider, providerAccountId: string) {
    return prisma.authAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      include: {
        user: true,
      },
    });
  }

  async createUserWithEmail(data: { email: string; passwordHash: string; name: string; timezone: string }) {
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        timezone: data.timezone,
      },
    });
  }

  async createUserWithOAuth(data: {
    email: string;
    name: string;
    timezone: string;
    provider: AuthProvider;
    providerAccountId: string;
    emailVerifiedAt?: Date;
  }) {
    return prisma.$transaction(async (tx) => {
      // Check if user already exists
      const existingUser = await tx.user.findUnique({
        where: { email: data.email },
      });

      if (existingUser) {
        // Link to existing user
        const account = await tx.authAccount.create({
          data: {
            userId: existingUser.id,
            provider: data.provider,
            providerAccountId: data.providerAccountId,
          },
        });
        return { user: existingUser, account };
      }

      // Create new user and account
      const user = await tx.user.create({
        data: {
          email: data.email,
          name: data.name,
          timezone: data.timezone,
          emailVerifiedAt: data.emailVerifiedAt,
          authAccounts: {
            create: {
              provider: data.provider,
              providerAccountId: data.providerAccountId,
            },
          },
        },
      });

      return { user };
    });
  }

  async updateUserProfile(userId: string, data: { name?: string; timezone?: string; avatarUrl?: string }) {
    return prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async createSession(data: { userId: string; refreshTokenHash: string; expiresAt: Date; userAgent?: string; ipAddress?: string }) {
    return prisma.session.create({
      data: {
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
      },
    });
  }

  async findSessionByHash(refreshTokenHash: string) {
    return prisma.session.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });
  }

  async findSessionById(id: string) {
    return prisma.session.findUnique({
      where: { id },
    });
  }

  async updateSession(
    id: string,
    data: { refreshTokenHash: string; expiresAt: Date; lastUsedAt: Date }
  ) {
    return prisma.session.update({
      where: { id },
      data,
    });
  }

  async revokeSession(id: string) {
    return prisma.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string) {
    return prisma.$transaction(async (tx) => {
      // Revoke all sessions
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Deactivate all device tokens
      await tx.deviceToken.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });
    });
  }

  async listActiveSessions(userId: string) {
    return prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: {
        lastUsedAt: "desc",
      },
    });
  }
}
export const authRepository = new AuthRepository();
