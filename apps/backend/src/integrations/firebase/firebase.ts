import admin from "firebase-admin";
import crypto from "crypto";
import { env } from "../../config/env.js";
import logger from "../../config/logger.js";

let firebaseInitialized = false;

if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
  try {
    const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
    firebaseInitialized = true;
    logger.info("Firebase Admin SDK initialized successfully");
  } catch (error: any) {
    logger.error("Failed to initialize Firebase Admin SDK:", error.message);
  }
} else {
  logger.warn(
    "Firebase environment variables are missing. Push notifications will run in SIMULATOR mode."
  );
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  token: string;
  success: boolean;
  messageId?: string;
  error?: string;
  isUnregistered: boolean;
}

export async function sendPushNotifications(
  tokens: string[],
  payload: PushPayload
): Promise<PushSendResult[]> {
  if (tokens.length === 0) return [];

  if (!firebaseInitialized) {
    // Simulator Mode
    logger.info({
      msg: "[SIMULATOR] Sending Push Notifications",
      tokensCount: tokens.length,
      payload,
    });
    return tokens.map((token) => ({
      token,
      success: true,
      messageId: `sim-${crypto.randomUUID()}`,
      isUnregistered: false,
    }));
  }

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
    });

    return response.responses.map((res, index) => {
      const token = tokens[index]!;
      const success = res.success;
      const messageId = res.messageId;
      const error = res.error;

      let isUnregistered = false;
      if (error) {
        // FCM error codes for unregistered/invalid tokens
        const code = error.code;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          error.message?.includes("not registered")
        ) {
          isUnregistered = true;
        }
      }

      return {
        token,
        success,
        messageId,
        error: error?.message,
        isUnregistered,
      };
    });
  } catch (error: any) {
    logger.error("Multicast push sending failed:", error.message);
    return tokens.map((token) => ({
      token,
      success: false,
      error: error.message,
      isUnregistered: false,
    }));
  }
}
