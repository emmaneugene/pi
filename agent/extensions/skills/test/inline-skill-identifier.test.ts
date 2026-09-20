import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  referencedSkills,
  rewriteSkillAliasInput,
} from "../inline-skill-identifier.ts";

const known = new Set(["bro", "animation-vocabulary", "simplify"]);

describe("referencedSkills", () => {
  it("returns unique known skill names in first-seen order", () => {
    assert.deepEqual(
      referencedSkills("$bro $50 $animation-vocabulary $bro $simplify", known),
      ["bro", "animation-vocabulary", "simplify"],
    );
  });

  it("ignores tokens that are not loaded skill names", () => {
    assert.deepEqual(referencedSkills("pay $50 then $HOME", known), []);
  });
});

describe("rewriteSkillAliasInput", () => {
  it("leaves text unchanged when no token matches a loaded skill", () => {
    assert.equal(
      rewriteSkillAliasInput("pay $50 then $HOME", known),
      undefined,
    );
    assert.equal(rewriteSkillAliasInput("no aliases here", known), undefined);
  });

  it("expands a single known skill and keeps the original $token", () => {
    assert.equal(
      rewriteSkillAliasInput("$bro restated simply", known),
      "/skill:bro $bro restated simply",
    );
  });

  it("does not rewrite an unknown $token next to one known skill", () => {
    assert.equal(
      rewriteSkillAliasInput("$bro costs $50", known),
      "/skill:bro $bro costs $50",
    );
  });

  it("expands the first known skill and replaces later known $ with /skill:", () => {
    assert.equal(
      rewriteSkillAliasInput(
        "$bro $animation-vocabulary name this motion",
        known,
      ),
      "/skill:bro $bro /skill:animation-vocabulary name this motion",
    );
  });

  it("leaves unknown $tokens between later known skills", () => {
    assert.equal(
      rewriteSkillAliasInput("$bro $50 $animation-vocabulary $simplify", known),
      "/skill:bro $bro $50 /skill:animation-vocabulary /skill:simplify",
    );
  });

  it("rewrites a later repeat of the first skill", () => {
    assert.equal(
      rewriteSkillAliasInput("$bro then $bro again", known),
      "/skill:bro $bro then /skill:bro again",
    );
  });

  it("expands the first known skill even when an unknown $token comes first", () => {
    assert.equal(
      rewriteSkillAliasInput("$50 $bro $animation-vocabulary", known),
      "/skill:bro $50 $bro /skill:animation-vocabulary",
    );
  });
});
