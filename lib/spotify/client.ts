import { responseError, SpotifyError } from "./errors.ts";
import type { SpotifyPage } from "./types.ts";

const API = "https://api.spotify.com/v1";

export class SpotifyClient {
  constructor(private accessToken: string, private refresh: () => Promise<string>, private request: typeof fetch = fetch) {}

  async get<T>(path: string): Promise<T> {
    const url = new URL(path.startsWith("/") ? `${API}${path}` : path);
    if (url.origin !== "https://api.spotify.com" || !url.pathname.startsWith("/v1/") || url.username || url.password) throw new SpotifyError(502, "Spotify returned an invalid pagination link.");
    let response = await this.send(url);
    if (response.status === 401) {
      this.accessToken = await this.refresh();
      response = await this.send(url); // One refresh/retry only; never an unbounded loop.
    }
    if (!response.ok) throw responseError(response);
    return response.json() as Promise<T>;
  }

  private send(url: URL) {
    return this.request(url, { headers: { Authorization: `Bearer ${this.accessToken}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  }

  async all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let next: string | null = path;
    while (next) {
      if (seen.has(next)) throw new SpotifyError(502, "Spotify returned a repeated pagination link. Please reload.");
      seen.add(next);
      const page: SpotifyPage<T> = await this.get(next);
      if (!Array.isArray(page.items)) throw new SpotifyError(502, "Spotify returned an incomplete playlist response.");
      items.push(...page.items);
      next = page.next;
    }
    return items;
  }
}
