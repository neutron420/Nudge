import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { prisma } from "../db/prisma.js";

describe("Nudge API End-to-End Tests", () => {
  const testEmail = `test_${Date.now()}@example.com`;
  const testPassword = "Password123!";
  let accessToken: string;
  let refreshToken: string;
  let createdEventId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    // Clean up test data
    try {
      const user = await prisma.user.findFirst({
        where: { email: testEmail },
      });
      if (user) {
        await prisma.user.delete({
          where: { id: user.id },
        });
      }
    } catch (err: any) {
      console.warn("Cleanup failed:", err.message);
    }
    await prisma.$disconnect();
  });

  describe("Health Endpoints", () => {
    it("should respond with live status", async () => {
      const res = await request(app).get("/health/live");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("alive");
    });

    it("should respond with ready status", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
    });
  });

  describe("Authentication Module", () => {
    it("should register a new user successfully", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: testEmail,
          password: testPassword,
          name: "Test Runner",
          timezone: "Asia/Kolkata",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
      expect(res.body.user.email).toBe(testEmail);

      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it("should reject registration with duplicate email", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: testEmail,
          password: testPassword,
          name: "Test Duplicate",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });

    it("should login successfully with correct credentials", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body.user.email).toBe(testEmail);
    });

    it("should fetch current user profile details", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testEmail);
      expect(res.body.name).toBe("Test Runner");
    });

    it("should rotate refresh tokens successfully", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
    });
  });

  describe("Events and Reminders Modules", () => {
    it("should create event with reminders successfully", async () => {
      const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 1 day from now
      const res = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          title: "Exam Review Session",
          description: "Prepare syllabus notes",
          eventType: "EXAM",
          startAt,
          timezone: "Asia/Kolkata",
          reminders: [
            { offsetMinutes: 60 },
            { offsetMinutes: 15 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("event");
      expect(res.body.event.title).toBe("Exam Review Session");
      expect(res.body.reminders).toHaveLength(2);

      createdEventId = res.body.event.id;
    });

    it("should list active events for user", async () => {
      const res = await request(app)
        .get("/api/v1/events")
        .set("Authorization", `Bearer ${accessToken}`)
        .query({ status: "ACTIVE" });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].title).toBe("Exam Review Session");
    });

    it("should fetch event details", async () => {
      const res = await request(app)
        .get(`/api/v1/events/${createdEventId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Exam Review Session");
      expect(res.body.reminders).toHaveLength(2);
    });

    it("should fetch dashboard summary stats", async () => {
      const res = await request(app)
        .get("/api/v1/dashboard")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.stats.upcomingCount).toBe(1);
    });
  });
});
