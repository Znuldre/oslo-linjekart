import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const ROOT = process.cwd();
export const DATA_DIR = join(ROOT, "data");
export const CONTENT_DIR = join(ROOT, "content");
export const WORK_DIR = join(ROOT, ".cache", "work"); // mellomresultater mellom steg

export function writeJson(path: string, value: unknown, pretty = true) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pretty ? JSON.stringify(value, null, 2) + "\n" : JSON.stringify(value));
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readJsonIfExists<T>(path: string): T | null {
  return existsSync(path) ? readJson<T>(path) : null;
}

export function listJson(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
}

export const work = (name: string) => join(WORK_DIR, name);
export const data = (...parts: string[]) => join(DATA_DIR, ...parts);
export const content = (...parts: string[]) => join(CONTENT_DIR, ...parts);

export function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
