import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email().transform((val) => val.toLowerCase().trim()),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  timezone: z.string().default("UTC"),
});

export const loginSchema = z.object({
  email: z.string().email().transform((val) => val.toLowerCase().trim()),
  password: z.string(),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(1, "Google ID token is required"),
  timezone: z.string().default("UTC"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  timezone: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});
