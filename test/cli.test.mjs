import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(projectRoot, "dist/cli.js");

test("CLI accepts a valid checked-in example", () => {
  const result = spawnSync(process.execPath, [cli, "examples/valid"], {
    cwd: projectRoot, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No broken VS Code/);
});

test("CLI strict mode fails on a broken checked-in example", () => {
  const result = spawnSync(process.execPath, [cli, "examples/invalid", "--strict"], {
    cwd: projectRoot, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /task-reference-unresolved/);
  assert.match(result.stdout, /compound-configuration-unresolved/);
});

test("CLI emits parseable SARIF", () => {
  const result = spawnSync(process.execPath, [cli, "examples/invalid", "--format", "sarif"], {
    cwd: projectRoot, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).version, "2.1.0");
});
