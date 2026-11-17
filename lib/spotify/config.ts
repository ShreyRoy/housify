import "server-only";

export function spotifyConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) throw new Error("Spotify configuration missing");
  const callback = new URL(redirectUri);
  const loopback = callback.hostname === "127.0.0.1" || callback.hostname === "[::1]";
  if ((callback.protocol !== "https:" && !(loopback && callback.protocol === "http:")) || callback.pathname !== "/api/auth/callback" || callback.search || callback.hash || callback.username || callback.password) {
    throw new Error("Invalid Spotify redirect URI");
  }
  return { clientId, redirectUri, origin: callback.origin, secure: callback.protocol === "https:" };
}

export function sessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("SESSION_SECRET must be a 32-byte base64url key");
  const key = Buffer.from(secret, "base64url");
  if (key.length !== 32) throw new Error("Invalid session key");
  return key;
}
