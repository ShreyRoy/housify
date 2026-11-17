import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createPkce() {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), state: randomBytes(32).toString("base64url") };
}

export function equalState(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

// AES-GCM provides confidentiality and tamper detection. Purpose binding prevents
// an OAuth transaction cookie from being interpreted as an authenticated session.
export function seal(value: unknown, key: Buffer, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function unseal<T>(value: string | undefined, key: Buffer, purpose: string): T | null {
  if (!value) return null;
  try {
    const packed = Buffer.from(value, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(packed.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(packed.subarray(28)), cipher.final()]).toString("utf8")) as T;
  } catch { return null; }
}
