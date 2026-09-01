import { spawn } from "node:child_process";
import { accessSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  loadSkillsFromDir,
  type ExtensionAPI,
  type Skill,
} from "@earendil-works/pi-coding-agent";

const AUTO_REPORT_LIMIT = 8;

type AuditCollision = {
  name: string;
  projectPath: string;
  globalPath: string;
  status: "identical" | "different" | "inconclusive";
  detail?: string;
};

export type SkillAuditResult = {
  collisions: AuditCollision[];
  discoveryWarnings: string[];
};

type DiffResult =
  | { status: "identical" }
  | { status: "different" }
  | { status: "inconclusive"; detail: string };

function packagePath(skill: Skill): string {
  return basename(skill.filePath) === "SKILL.md"
    ? skill.baseDir
    : skill.filePath;
}

function diffPackages(
  projectPath: string,
  globalPath: string,
): Promise<DiffResult> {
  return new Promise((resolveDiff) => {
    const child = spawn(
      "diff",
      ["-qr", "--exclude=.DS_Store", projectPath, globalPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    let settled = false;
    const settle = (result: DiffResult): void => {
      if (settled) return;
      settled = true;
      resolveDiff(result);
    };

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle({ status: "inconclusive", detail: error.message });
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        settle({ status: "identical" });
      } else if (code === 1) {
        settle({ status: "different" });
      } else {
        const detail = stderr.trim() || `diff exited with ${code ?? signal}`;
        settle({ status: "inconclusive", detail });
      }
    });
  });
}

async function compareSkills(
  projectSkill: Skill,
  globalSkill: Skill,
): Promise<AuditCollision> {
  const result = await diffPackages(
    packagePath(projectSkill),
    packagePath(globalSkill),
  );
  return {
    name: projectSkill.name,
    projectPath: projectSkill.filePath,
    globalPath: globalSkill.filePath,
    ...result,
  };
}

function findGitBoundary(cwd: string): string {
  let current = resolve(cwd);
  while (true) {
    try {
      // Pi stops ancestor skill discovery at a repository root. A worktree's
      // .git marker is a file, so existence rather than directory type matters.
      accessSync(join(current, ".git"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return parse(current).root;
      current = parent;
    }
  }
}

function ancestorAgentSkillDirs(cwd: string): string[] {
  const boundary = findGitBoundary(cwd);
  const directories: string[] = [];
  let current = resolve(cwd);

  while (true) {
    directories.push(join(current, ".agents", "skills"));
    if (current === boundary) return directories;
    const parent = dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

function discoverSkills(
  directories: string[],
  source: string,
): { skills: Map<string, Skill>; warnings: string[] } {
  const skills = new Map<string, Skill>();
  const warnings: string[] = [];

  for (const directory of directories) {
    const result = loadSkillsFromDir({ dir: directory, source });
    for (const diagnostic of result.diagnostics) {
      warnings.push(`${diagnostic.path}: ${diagnostic.message}`);
    }
    for (const skill of result.skills) {
      if (!skills.has(skill.name)) skills.set(skill.name, skill);
    }
  }

  return { skills, warnings };
}

export async function auditSkillCollisions(options: {
  cwd: string;
  agentDir?: string;
  homeDir?: string;
}): Promise<SkillAuditResult> {
  const agentDir = options.agentDir ?? getAgentDir();
  const homeDir = options.homeDir ?? homedir();
  const projectDirectories = [
    join(options.cwd, CONFIG_DIR_NAME, "skills"),
    ...ancestorAgentSkillDirs(options.cwd),
  ];
  const globalDirectories = [
    join(agentDir, "skills"),
    join(homeDir, ".agents", "skills"),
  ];

  const project = discoverSkills(projectDirectories, "project");
  const global = discoverSkills(globalDirectories, "user");
  const sharedNames = [...project.skills.keys()]
    .filter((name) => global.skills.has(name))
    .sort();

  const collisions = await Promise.all(
    sharedNames.map((name) =>
      compareSkills(project.skills.get(name)!, global.skills.get(name)!),
    ),
  );

  return {
    collisions,
    discoveryWarnings: [...project.warnings, ...global.warnings],
  };
}

function automaticWarning(result: SkillAuditResult): string | undefined {
  const actionable = result.collisions.filter(
    (collision) => collision.status !== "identical",
  );
  if (actionable.length === 0 && result.discoveryWarnings.length === 0) {
    return undefined;
  }

  const names = actionable
    .slice(0, AUTO_REPORT_LIMIT)
    .map((collision) => collision.name);
  const remaining = actionable.length - names.length;
  const collisionSummary = names.length
    ? `${names.join(", ")}${remaining > 0 ? `, +${remaining} more` : ""}`
    : "none";
  const discoverySummary = result.discoveryWarnings.length
    ? `; ${result.discoveryWarnings.length} discovery warning(s)`
    : "";
  return `Skill audit found divergent or unreadable collisions: ${collisionSummary}${discoverySummary}.`;
}

export default function skillAudit(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const result = await auditSkillCollisions({ cwd: ctx.cwd });
    const warning = automaticWarning(result);
    if (warning) ctx.ui.notify(warning, "warning");
  });
}
