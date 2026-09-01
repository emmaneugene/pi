import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { auditSkillCollisions } from "../audit.ts";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{
  root: string;
  cwd: string;
  agentDir: string;
  homeDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-skill-audit-"));
  temporaryDirectories.push(root);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const homeDir = join(root, "home");
  await Promise.all([
    mkdir(join(cwd, ".git"), { recursive: true }),
    mkdir(join(cwd, ".pi", "skills"), { recursive: true }),
    mkdir(join(agentDir, "skills"), { recursive: true }),
    mkdir(homeDir, { recursive: true }),
  ]);
  return { root, cwd, agentDir, homeDir };
}

async function writeDirectorySkill(
  skillsDirectory: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  const skillDirectory = join(skillsDirectory, name);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Audit fixture\n---\n\n# ${name}\n`,
  );
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(skillDirectory, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("auditSkillCollisions", () => {
  it("classifies byte-identical skill packages as identical and ignores .DS_Store", async () => {
    const paths = await fixture();
    const files = {
      "scripts/check.ts": "export const answer = 42;\n",
      "references/guide.md": "Same reference\n",
    };
    await Promise.all([
      writeDirectorySkill(join(paths.cwd, ".pi", "skills"), "same", files),
      writeDirectorySkill(join(paths.agentDir, "skills"), "same", files),
    ]);
    await writeFile(
      join(paths.agentDir, "skills", "same", ".DS_Store"),
      "filesystem noise",
    );

    const result = await auditSkillCollisions(paths);

    assert.deepEqual(
      result.collisions.map(({ name, status }) => ({ name, status })),
      [{ name: "same", status: "identical" }],
    );
    assert.deepEqual(result.discoveryWarnings, []);
  });

  it("classifies packages with equal SKILL.md and different assets as different", async () => {
    const paths = await fixture();
    await Promise.all([
      writeDirectorySkill(join(paths.cwd, ".pi", "skills"), "changed", {
        "scripts/check.ts": "project\n",
      }),
      writeDirectorySkill(join(paths.agentDir, "skills"), "changed", {
        "scripts/check.ts": "global\n",
      }),
    ]);

    const result = await auditSkillCollisions(paths);

    assert.equal(result.collisions[0]?.status, "different");
  });

  it("compares standalone markdown skills without comparing their siblings", async () => {
    const paths = await fixture();
    const content =
      "---\nname: standalone\ndescription: Audit fixture\n---\n\nSame\n";
    await Promise.all([
      writeFile(join(paths.cwd, ".pi", "skills", "project-name.md"), content),
      writeFile(join(paths.agentDir, "skills", "global-name.md"), content),
      writeFile(
        join(paths.cwd, ".pi", "skills", "unrelated.md"),
        "---\nname: unrelated\ndescription: Not part of the collision\n---\n",
      ),
    ]);

    const result = await auditSkillCollisions(paths);

    assert.equal(result.collisions[0]?.status, "identical");
  });

  it("follows symlinked package files", async () => {
    const paths = await fixture();
    const projectSkills = join(paths.cwd, ".pi", "skills");
    const globalSkills = join(paths.agentDir, "skills");
    await Promise.all([
      writeDirectorySkill(projectSkills, "linked", {}),
      writeDirectorySkill(globalSkills, "linked", {}),
    ]);
    await Promise.all([
      writeFile(join(paths.root, "project-script.ts"), "project\n"),
      writeFile(join(paths.root, "global-script.ts"), "global\n"),
      mkdir(join(projectSkills, "linked", "scripts"), { recursive: true }),
      mkdir(join(globalSkills, "linked", "scripts"), { recursive: true }),
    ]);
    await Promise.all([
      symlink(
        join(paths.root, "project-script.ts"),
        join(projectSkills, "linked", "scripts", "check.ts"),
      ),
      symlink(
        join(paths.root, "global-script.ts"),
        join(globalSkills, "linked", "scripts", "check.ts"),
      ),
    ]);

    const result = await auditSkillCollisions(paths);

    assert.equal(result.collisions[0]?.status, "different");
  });
});
