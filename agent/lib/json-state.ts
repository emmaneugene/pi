/**
 * Small helpers for loading and persisting local JSON state files
 * (`~/.pi/agent/*.json`) with a consistent, forgiving on-disk format.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Read and parse a JSON file, returning `undefined` if it is missing,
 * unreadable, or not valid JSON. Callers are responsible for validating
 * the parsed shape.
 */
export function readJsonFile(path: string): unknown {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    // Ignore parse/read errors; caller falls back to defaults.
  }
  return undefined;
}

/** Write a value as pretty-printed JSON, creating parent directories. */
export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
