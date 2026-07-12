/**
 * registry.ts — Agent type registry: project and global agent markdown files.
 * Project overrides global.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOLS } from "./gating.ts";
import type { AgentConfig, ThinkingLevel } from "./types.ts";

export class AgentRegistry {
  private agents = new Map<string, AgentConfig>();

  constructor(private cwd = process.cwd()) {
    this.reload(cwd);
  }

  /** Rebuild from global + project agent files for the active session cwd. */
  reload(cwd = this.cwd): void {
    this.cwd = cwd;
    this.agents.clear();
    this.loadDir(join(dirname(getAgentDir()), "agents"), "global");
    this.loadDir(join(cwd, CONFIG_DIR_NAME, "agents"), "project");
  }

  /** Canonical (case-insensitive) key for a type name, or undefined. */
  private resolveKey(name: string): string | undefined {
    if (this.agents.has(name)) return name;
    const lower = name.toLowerCase();
    for (const key of this.agents.keys())
      if (key.toLowerCase() === lower) return key;
    return undefined;
  }

  /** All loaded configs (including disabled), sorted by name. For catalogs/UI. */
  list(): AgentConfig[] {
    return [...this.agents.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** Enabled type names, for spawning + tool descriptions. */
  availableTypes(): string[] {
    return [...this.agents.entries()]
      .filter(([, c]) => c.enabled !== false)
      .map(([n]) => n);
  }

  /** Resolve a config (case-insensitive). Caller must validate availability first. */
  resolve(type: string): AgentConfig {
    const key = this.resolveKey(type);
    const cfg = key ? this.agents.get(key) : undefined;
    if (cfg && cfg.enabled !== false) return cfg;
    throw new Error(`Unknown or disabled agent type: ${type}`);
  }

  /** Whether a type is present and enabled. */
  isAvailable(type: string): boolean {
    const key = this.resolveKey(type);
    const cfg = key ? this.agents.get(key) : undefined;
    return !!cfg && cfg.enabled !== false;
  }

  private loadDir(dir: string, source: "project" | "global"): void {
    if (!existsSync(dir)) return;
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      return;
    }
    for (const file of files) {
      const name = basename(file, ".md");
      let content: string;
      try {
        content = readFileSync(join(dir, file), "utf-8");
      } catch {
        continue;
      }
      const { frontmatter: fm, body } =
        parseFrontmatter<Record<string, unknown>>(content);
      this.agents.set(name, {
        name,
        filePath: join(dir, file),
        displayName: str(fm.display_name),
        description: str(fm.description) ?? name,
        allowTools: parseTools(fm.tools),
        model: str(fm.model),
        thinking: str(fm.thinking) as ThinkingLevel | undefined,
        maxTurns: posInt(fm.max_turns),
        systemPrompt: body.trim(),
        promptMode: fm.prompt_mode === "append" ? "append" : "replace",
        enabled: fm.enabled !== false,
        source,
      });
    }
  }
}

// ── frontmatter parsers ──────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function posInt(v: unknown): number | undefined {
  return typeof v === "number" && v >= 0 ? v : undefined;
}
/**
 * `tools:` → explicit allowlist. Omitted/empty/"none" → no tools.
 * "*"/"all" → all built-ins. Extension tools must be named explicitly.
 */
function parseTools(v: unknown): string[] {
  if (v == null) return [];
  const s = String(v).trim();
  if (!s || s === "none") return [];
  if (s === "*" || s.toLowerCase() === "all") return [...BUILTIN_TOOLS];
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
