# vscode-debug-preflight

Check the links between VS Code `launch.json`, `tasks.json`, and `.code-workspace` files before a teammate discovers a broken setup by pressing **F5**.

VS Code's IntelliSense and schemas catch many mistakes while editing. This small CLI adds a headless check for the names that connect files: launch configurations to pre/post-launch tasks, compound launches to configurations, task dependencies to tasks, and `${input:...}` references to input definitions. Run it locally or in CI without starting VS Code.

## Quick start

With an actively supported Node.js LTS release (22 or newer):

```sh
cd path/to/your/project
npx --yes --package=github:thisbejim/vscode-debug-preflight#v0.1.1 -- vscode-debug-preflight
```

For a multi-root workspace, pass the `.code-workspace` file:

```sh
npx --yes --package=github:thisbejim/vscode-debug-preflight#v0.1.1 -- vscode-debug-preflight dev.code-workspace --strict
```

The checker reads JSONC, so comments and trailing commas are accepted. It never evaluates `${...}` expressions, launches a task, invokes VS Code, or changes files.

## Example

Given a launch configuration that names a task that does not exist:

```jsonc
// .vscode/launch.json
{
  "configurations": [{
    "name": "Run API",
    "type": "node",
    "request": "launch",
    "preLaunchTask": "build-api"
  }]
}
```

And a task with a different label:

```jsonc
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [{ "label": "build-server", "type": "shell", "command": "npm run build" }]
}
```

The command points to the broken edge with a source location:

```text
.vscode/launch.json:7:21: warning task-reference-unresolved: Configuration 'Run API' preLaunchTask 'build-api' is not declared in the workspace files checked. An extension task provider may supply it.
```

Task providers contributed by extensions and auto-detected tasks are runtime data the checker cannot enumerate. Unresolved task labels are warnings by default; use `--strict` when your repository relies only on checked-in task definitions and you want CI to fail on them.

## What it checks

- JSONC syntax errors in task, launch, and workspace configuration files.
- Duplicate task labels, launch names within a scope, compound names, and input IDs within a file.
- `dependsOn` references between declared tasks.
- `preLaunchTask` and `postDebugTask` references in launch configurations and compounds.
- Compound members that refer to missing or ambiguous launch configurations.
- `${input:id}` references with no input definition in the same file.
- Folder-scoped configuration in a `.code-workspace` file, including `folders`, workspace tasks, and workspace launches.
- Text, versioned JSON, and SARIF 2.1 output for local use and CI.

It does not validate debugger-extension-specific fields, run configured commands, resolve VS Code variables, or emulate extension task providers. VS Code remains the authority for runtime behavior.

## Options

```text
vscode-debug-preflight [workspace-directory | file.code-workspace] [options]

--strict       Exit non-zero when warnings remain, including unresolved task references
--format NAME  text (default), json, or sarif
--version      Print the version
-h, --help     Show help
```

Errors produce exit code `1`. Warnings are informational and do not fail unless `--strict` is set. Strict mode turns every warning into a failing result. Invalid command-line options produce exit code `2`.

For GitHub Actions, upload SARIF with the normal Code Scanning action, or use JSON as a small machine-readable artifact:

```yaml
- run: npx --yes --package=github:thisbejim/vscode-debug-preflight#v0.1.1 -- vscode-debug-preflight . --strict --format sarif > vscode-debug-preflight.sarif
```

## Local development

```sh
git clone https://github.com/thisbejim/vscode-debug-preflight.git
cd vscode-debug-preflight
npm ci
npm test
```

The project supports Node.js 22 and 24 on Linux, macOS, and Windows. Its only runtime dependency is Microsoft's `jsonc-parser`, also used by VS Code's JSON tooling.

## Why a separate checker?

VS Code documents that `preLaunchTask` names a task label from `tasks.json`, and that compounds refer to launch-configuration names. Those references are checked when a developer uses the setup, but that is late feedback for a configuration committed for teammates. `vscode-debug-preflight` checks those relationships in a clean CLI/CI run without needing the relevant debugger extension installed.

It complements VS Code's schema validation: it checks relationships across files and deliberately leaves extension-specific schemas to VS Code.

## License

MIT. See [LICENSE](LICENSE).
