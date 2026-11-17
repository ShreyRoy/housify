export type TokenSession = { accessToken: string; refreshToken: string; accessExpiresAt: number; expiresAt: number };
export type TokenPayload = { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string };

export function tokenSession(tokens: TokenPayload, prior?: TokenSession, now = Date.now()): TokenSession | null {
  const refreshToken = tokens.refresh_token || prior?.refreshToken;
  if (!tokens.access_token || !refreshToken || typeof tokens.expires_in !== "number" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || tokens.token_type?.toLowerCase() !== "bearer") return null;
  return { accessToken: tokens.access_token, refreshToken, accessExpiresAt: now + tokens.expires_in * 1000, expiresAt: prior?.expiresAt ?? now + 30 * 24 * 60 * 60 * 1000 };
}
