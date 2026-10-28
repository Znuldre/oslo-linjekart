/** HTTP med disk-cache, retry og samtidighetsgrense. Kun Node-innebygde moduler. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(process.cwd(), ".cache", "http");
mkdirSync(CACHE_DIR, { recursive: true });

export const FORCE = process.argv.includes("--force");
export const ET_CLIENT_NAME =
  process.env.ET_CLIENT_NAME || process.env.NEXT_PUBLIC_ET_CLIENT_NAME || "kehus-linjekart";
export const USER_AGENT = "ruter-interaktivt-linjekart/0.1 (konseptprosjekt; sondrekehus@gmail.com)";

const DAY = 24 * 3600 * 1000;
export const TTL = { entur: 1 * DAY, nsr: 7 * DAY, overpass: 30 * DAY, wikimedia: 30 * DAY } as const;

type CacheEntry = { fetchedAt: number; status: number; body: unknown };

function cacheKey(url: string, body?: string) {
  return createHash("sha1")
    .update(url + "\n" + (body ?? ""))
    .digest("hex");
}

function readCache(key: string, ttl: number): CacheEntry | null {
  const file = join(CACHE_DIR, key + ".json");
  if (FORCE || !existsSync(file)) return null;
  try {
    const entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
    if (Date.now() - entry.fetchedAt > ttl) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(key: string, entry: CacheEntry) {
  writeFileSync(join(CACHE_DIR, key + ".json"), JSON.stringify(entry));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Enkel semafor for samtidighet og minimumsavstand per kilde. */
export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  private last = 0;
  private readonly max: number;
  private readonly minGapMs: number;

  constructor(max: number, minGapMs = 0) {
    this.max = max;
    this.minGapMs = minGapMs;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      const wait = this.last + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export interface FetchJsonOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  ttl: number;
  limiter: Limiter;
  retries?: number;
  label?: string;
}

const stats = { hits: 0, misses: 0, errors: 0 };
export const httpStats = () => ({ ...stats });

class RetryableError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const key = cacheKey(url + (opts.method ?? "GET"), opts.body);
  const cached = readCache(key, opts.ttl);
  if (cached) {
    stats.hits++;
    return cached.body as T;
  }
  stats.misses++;
  const retries = opts.retries ?? 4;
  let attempt = 0;
  for (;;) {
    try {
      const body = await opts.limiter.run(async () => {
        const res = await fetch(url, {
          method: opts.method ?? "GET",
          headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...opts.headers },
          body: opts.body,
        });
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableError(`${res.status} ${res.statusText} for ${opts.label ?? url}`, res.status);
        }
        if (!res.ok) {
          const text = (await res.text()).slice(0, 300);
          throw new Error(`${res.status} ${res.statusText} for ${opts.label ?? url}: ${text}`);
        }
        return (await res.json()) as unknown;
      });
      writeCache(key, { fetchedAt: Date.now(), status: 200, body });
      return body as T;
    } catch (err) {
      const e = err as Error;
      const retryable = err instanceof RetryableError || e?.name === "TypeError"; // TypeError = nettverksfeil i fetch
      if (!retryable || attempt >= retries) {
        stats.errors++;
        throw err;
      }
      const backoff = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      console.warn(`  retry ${attempt + 1}/${retries} etter ${Math.round(backoff)} ms: ${e.message}`);
      await sleep(backoff);
      attempt++;
    }
  }
}
