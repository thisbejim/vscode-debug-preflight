# Product specification

## Target user

Teams that commit `.vscode/launch.json`, `.vscode/tasks.json`, or `.code-workspace` configuration so contributors can build and debug a project consistently.

## Problem

Launch configurations link to task labels, compounds link to launch configuration names, tasks can depend on other task labels, and configurations can reference declared inputs. A typo or stale label can make a documented F5 setup fail only when a teammate starts it.

## Current workaround

Use editor IntelliSense and JSON schemas while editing, then open the workspace in VS Code and try the task or debug configuration. CI can validate JSON shape with general JSON Schema tools, but the cross-file links are specific to VS Code's task and launch model.

## Why existing alternatives are inadequate

- VS Code provides interactive schema validation and runtime execution, but no documented headless command that checks the references across these files.
- Generic JSON/JSONC schema validators can check structure when given a schema; they do not resolve task labels or compound members across separate files.
- Opening a debugger configuration or running a task is not a stable CI check and may require a language/debugger extension.

## Core use case

Run one command at a repository root or against a `.code-workspace` file. Receive stable diagnostics for malformed JSONC and broken local configuration references, with line and column; optionally treat unresolved local task references as CI failures.

## Non-goals

- Emulate VS Code, a debug adapter, or an extension task provider.
- Validate extension-specific launch fields.
- Execute shell commands, tasks, builds, or debuggers.
- Resolve environment, command, input, or workspace variables to runtime values.
- Rewrite or repair configuration files.

## Interface and data

- CLI: `vscode-debug-preflight [directory | workspace.code-workspace] [--strict] [--format text|json|sarif]`.
- Inputs: local JSONC files at `.vscode/tasks.json` and `.vscode/launch.json`, plus workspace-scoped `tasks`/`launch` sections and local folders in a `.code-workspace` file.
- Outputs: deterministic text, versioned JSON diagnostics, or SARIF 2.1.0.
- Error behavior: malformed files and definite broken compound/task-graph edges fail with exit code 1. Unknown task references are warnings by default because extensions and automatic task providers can supply them; `--strict` promotes these to failures. CLI usage errors use exit code 2.

## Supported environments and architecture

Node.js 22+, on Linux, macOS, and Windows. TypeScript CLI with a single runtime dependency, `jsonc-parser`. The checker is local and read-only; it neither starts VS Code nor invokes configuration commands.

## Validation strategy

Unit/black-box tests cover valid JSONC, missing and duplicate links, multi-root workspace data, malformed files, machine output, and empty workspaces. CI runs on Node.js 22 and 24 on all three major desktop/server operating systems.

## Why choose this over the strongest alternative?

Use VS Code's editor validation for debugger-specific fields and interactive feedback. Use this CLI when you need to validate checked-in cross-file references in a terminal or CI without installing VS Code or every language extension.
