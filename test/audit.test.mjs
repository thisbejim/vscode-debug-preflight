import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  auditWorkspace,
  formatSarif,
  hasFailure,
} from "../dist/audit.js";

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), "vscode-debug-preflight-"));
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("accepts JSONC and resolves task, input, and compound references", (t) => {
  const ws = workspace({
    ".vscode/tasks.json": `{
      // Build the app before debugging.
      "version": "2.0.0",
      "tasks": [
        { "label": "build", "type": "shell", "command": "npm run build" },
        { "label": "watch", "dependsOn": ["build"] }
      ],
    }`,
    ".vscode/launch.json": `{
      "version": "0.2.0",
      "inputs": [{ "id": "mode", "type": "pickString", "options": ["dev", "prod"] }],
      "configurations": [{
        "name": "App", "type": "node", "request": "launch",
        "preLaunchTask": "build", "postDebugTask": "watch",
        "args": ["--mode", "\u0024{input:mode}"]
      }],
      "compounds": [{ "name": "Debug stack", "configurations": ["App"] }]
    }`,
  });
  t.after(ws.close);
  const diagnostics = auditWorkspace({ target: ws.root });
  assert.deepEqual(diagnostics, []);
  assert.equal(hasFailure(diagnostics), false);
});

test("reports unresolved references with source locations and strict mode fails", (t) => {
  const ws = workspace({
    ".vscode/tasks.json": `{"version":"2.0.0","tasks":[{"label":"compile","dependsOn":"missing-dep"}]}`,
    ".vscode/launch.json": `{
      "configurations": [{"name":"App","type":"node","request":"launch","preLaunchTask":"misspelled"}],
      "compounds": [{"name":"All","configurations":["Missing"]}]
    }`,
  });
  t.after(ws.close);
  const diagnostics = auditWorkspace({ target: ws.root });
  assert.deepEqual(diagnostics.map((item) => item.code).sort(), [
    "compound-configuration-unresolved",
    "task-reference-unresolved",
    "task-reference-unresolved",
  ]);
  assert.ok(diagnostics.every((item) => item.line > 0 && item.column > 0));
  assert.equal(hasFailure(diagnostics), true);
  assert.equal(hasFailure(auditWorkspace({ target: ws.root, strict: true }), true), true);
});

test("checks duplicate task labels, launch names, and missing input ids", (t) => {
  const ws = workspace({
    ".vscode/tasks.json": `{
      "inputs": [{"id":"choice","type":"promptString"}],
      "tasks": [{"label":"same","command":"a"},{"label":"same","command":"b"}]
    }`,
    ".vscode/launch.json": `{
      "configurations": [
        {"name":"App","type":"node","request":"launch","preLaunchTask":"same","args":["\u0024{input:nope}"]},
        {"name":"App","type":"node","request":"launch"}
      ]
    }`,
  });
  t.after(ws.close);
  const codes = auditWorkspace({ target: ws.root }).map((item) => item.code);
  assert.ok(codes.includes("duplicate-task-label"));
  assert.ok(codes.includes("duplicate-configuration-name"));
  assert.ok(codes.includes("input-reference-unresolved"));
  assert.ok(codes.includes("task-reference-ambiguous"));
});

test("checks workspace-level launch and task sections", (t) => {
  const ws = workspace({
    "demo.code-workspace": `{
      "folders": [{"path":"app", "name":"App"}],
      "tasks": {"version":"2.0.0", "tasks":[{"label":"build","command":"make"}]},
      "launch": {"version":"0.2.0", "configurations":[{"name":"Run","preLaunchTask":"build"}], "compounds":[{"name":"All","configurations":["Run"]}]}
    }`,
    "app/.vscode/tasks.json": `{"version":"2.0.0","tasks":[{"label":"app-build","command":"make"}]}`,
  });
  t.after(ws.close);
  const diagnostics = auditWorkspace({ target: join(ws.root, "demo.code-workspace") });
  assert.deepEqual(diagnostics, []);
});

test("keeps duplicate labels in different folders ambiguous and honors folder-qualified launch members", (t) => {
  const ws = workspace({
    "team.code-workspace": `{
      "folders": [{"path":"client", "name":"Client"},{"path":"server", "name":"Server"}],
      "launch": {
        "configurations": [{"name":"Workspace runner","type":"node","request":"launch","preLaunchTask":"build"}],
        "compounds": [{"name":"Client only","configurations":[{"folder":"Client","name":"App"}]}]
      }
    }`,
    "client/.vscode/tasks.json": `{"version":"2.0.0","tasks":[{"label":"build","command":"npm run build"}]}`,
    "server/.vscode/tasks.json": `{"version":"2.0.0","tasks":[{"label":"build","command":"npm run build"}]}`,
    "client/.vscode/launch.json": `{"configurations":[{"name":"App","type":"node","request":"launch"}]}`,
    "server/.vscode/launch.json": `{"configurations":[{"name":"App","type":"node","request":"launch"}]}`,
  });
  t.after(ws.close);
  const target = join(ws.root, "team.code-workspace");
  const diagnostics = auditWorkspace({ target });
  assert.deepEqual(diagnostics.map((item) => item.code), ["task-reference-ambiguous"]);
  assert.equal(hasFailure(diagnostics), false);
  assert.equal(hasFailure(auditWorkspace({ target, strict: true }), true), true);
});

test("reports malformed JSONC and produces SARIF 2.1", (t) => {
  const ws = workspace({ ".vscode/launch.json": `{"configurations": [}` });
  t.after(ws.close);
  const diagnostics = auditWorkspace({ target: ws.root });
  assert.ok(diagnostics.some((item) => item.code === "invalid-jsonc"));
  const sarif = JSON.parse(formatSarif(diagnostics));
  assert.equal(sarif.version, "2.1.0");
  assert.ok(sarif.runs[0].results.length > 0);
});

test("does not fail when the selected folder has no VS Code files", (t) => {
  const ws = workspace({});
  t.after(ws.close);
  const diagnostics = auditWorkspace({ target: ws.root });
  assert.equal(diagnostics[0].code, "no-config-files");
  assert.equal(hasFailure(diagnostics), false);
});

test("reports a missing workspace path", () => {
  const diagnostics = auditWorkspace({ target: "/path/that/does/not/exist" });
  assert.equal(diagnostics[0].code, "workspace-read-error");
  assert.match(diagnostics[0].message, /does not exist/);
});
