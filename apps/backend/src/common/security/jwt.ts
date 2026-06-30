import * as jose from "jose";
import { env } from "../../config/env.js";
import logger from "../../config/logger.js";

// Helper to determine if we should use asymmetric keys
const isAsymmetric = () => {
  return (
    !!env.JWT_ACCESS_PRIVATE_KEY &&
    env.JWT_ACCESS_PRIVATE_KEY.includes("-----BEGIN") &&
    !!env.JWT_ACCESS_PUBLIC_KEY &&
    env.JWT_ACCESS_PUBLIC_KEY.includes("-----BEGIN")
  );
};

// Cache keys after loading
let privateKeyCache: jose.KeyLike | Uint8Array | null = null;
let publicKeyCache: jose.KeyLike | Uint8Array | null = null;

async function getPrivateKey(): Promise<jose.KeyLike | Uint8Array> {
  if (privateKeyCache) return privateKeyCache;

  if (isAsymmetric()) {
    try {
      privateKeyCache = await jose.importPKCS8(env.JWT_ACCESS_PRIVATE_KEY!, "RS256");
      return privateKeyCache;
    } catch (err: any) {
      logger.error("Failed to import JWT_ACCESS_PRIVATE_KEY as PKCS8 PEM, falling back to symmetric HS256:", err.message);
    }
  }

  // Fallback to symmetric key
  const secretString = env.JWT_ACCESS_PRIVATE_KEY || "default_nudge_secret_key_at_least_32_chars_long_123456";
  privateKeyCache = new TextEncoder().encode(secretString);
  return privateKeyCache;
}

async function getPublicKey(): Promise<jose.KeyLike | Uint8Array> {
  if (publicKeyCache) return publicKeyCache;

  if (isAsymmetric()) {
    try {
      publicKeyCache = await jose.importSPKI(env.JWT_ACCESS_PUBLIC_KEY!, "RS256");
      return publicKeyCache;
    } catch (err: any) {
      logger.error("Failed to import JWT_ACCESS_PUBLIC_KEY as SPKI PEM, falling back to symmetric HS256:", err.message);
    }
  }

  // Fallback to symmetric key (must use same secret as private key)
  const secretString = env.JWT_ACCESS_PRIVATE_KEY || "default_nudge_secret_key_at_least_32_chars_long_123456";
  publicKeyCache = new TextEncoder().encode(secretString);
  return publicKeyCache;
}

export async function signAccessToken(payload: { userId: string; sessionId: string }): Promise<string> {
  const key = await getPrivateKey();
  const alg = isAsymmetric() && !(key instanceof Uint8Array) ? "RS256" : "HS256";

  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MINUTES}m`)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<{ userId: string; sessionId: string }> {
  const key = await getPublicKey();
  const { payload } = await jose.jwtVerify(token, key, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });

  return {
    userId: payload.userId as string,
    sessionId: payload.sessionId as string,
  };
}
