# Opportunity research

## Selected problem

Check that a project's committed VS Code launch and task configuration still connects: `preLaunchTask`/`postDebugTask` to task labels, task `dependsOn` to task labels, compound entries to launch names, and `${input:id}` references to input definitions.

VS Code's official debugging documentation defines `preLaunchTask` as a task label and compound configurations as references to named launch configurations. The Tasks documentation describes task dependency edges. The official multi-root documentation adds folder-scoped launch/task configurations and workspace-level sections. These are real cross-file/configuration relationships, not just JSON shape.

The recurring symptom is visible in public support history: a VS Code issue reports “Could not find the specified task” even though the task is visible in the task picker; another issue describes the same class of setup breaking in a multi-folder monorepo. A Stack Overflow question with over 247,000 views asks how to run a command before debugging, reflecting the broad task/launch setup surface. The exact missing-label defect is narrower than the total topic, so this supports a useful niche rather than proving a large standalone market.

## Evidence and strongest alternatives

| Source | What it establishes | Limitation for this task |
| --- | --- | --- |
| [VS Code debugging configuration docs](https://code.visualstudio.com/docs/debugtest/debugging-configuration) | `preLaunchTask`/`postDebugTask` connect debug sessions to tasks; compounds reference named configurations. | Interactive editor/debugger workflow; no headless repository gate is documented. |
| [VS Code task docs](https://code.visualstudio.com/docs/debugtest/tasks) | Tasks can depend on named tasks; task definitions may also be contributed by providers. | Describes the runtime/editor feature; does not provide a command to validate cross-file edges. |
| [VS Code multi-root workspace docs](https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces) | Workspace launch/tasks coexist with per-folder launch/tasks; folder names scope references. | The richer scope model is harder to verify with one-file schema checks. |
| [Issue #157957](https://github.com/microsoft/vscode/issues/157957) | A user hit a “Could not find the specified task” failure despite seeing the task in the picker. | One issue does not quantify frequency. |
| [Issue #94381](https://github.com/microsoft/vscode/issues/94381) | A monorepo setup experienced `preLaunchTask` resolution problems across task labels/folders. | This is an older issue and some behavior may since have changed. |
| [Stack Overflow: running a command from launch.json](https://stackoverflow.com/questions/43836861/how-to-run-a-command-in-visual-studio-code-with-launch-json) | A long-running, high-view question demonstrates how common the launch/task workflow is. | It asks about setup generally, not specifically a linter gap. |
| [VS Code Tasks schema appendix](https://code.visualstudio.com/docs/reference/tasks-appendix) | VS Code documents a schema for task-file structure. | Schema validation does not itself prove labels referenced by another file exist. |

The strongest alternative is VS Code itself: schema/IntelliSense while editing, followed by actually running the task or debugger. That remains authoritative for extension behavior and debugger-specific properties. General JSONC/schema validators can catch syntax and shape errors. The gap is a non-interactive check of the checked-in references before a contributor opens the editor or hits F5. The project intentionally does not claim to validate dynamic extension-provided tasks; it reports unresolved task labels as warnings unless strict mode is explicitly selected.

## Candidate selection

Scores below are 0–10. For positive factors, higher is better; for competition, risk, maintenance burden, volatility, third-party dependence, and weak-demand risk, higher is worse.

| Candidate | Pain | Frequency | Audience | Demand | Dissatisfaction | Improvement | OSS edge | Search | Time to value | Feasibility | Maintainability | Standalone | Competition | Risk | Burden | Volatility | Third-party | Weak-demand risk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| VS Code task/launch reference checker | 6 | 7 | 9 | 7 | 6 | 7 | 8 | 8 | 9 | 9 | 8 | 9 | 4 | 3 | 3 | 2 | 5 |
| Python wheel/sdist smoke-test runner | 7 | 6 | 6 | 7 | 5 | 6 | 8 | 8 | 7 | 8 | 7 | 8 | 7 | 4 | 3 | 4 | 4 |
| Black-box MCP server scenario runner | 7 | 7 | 6 | 7 | 6 | 7 | 8 | 9 | 7 | 7 | 5 | 7 | 8 | 6 | 9 | 5 | 4 |
| PostgreSQL migration safety checker | 9 | 5 | 7 | 8 | 6 | 7 | 8 | 9 | 6 | 6 | 5 | 7 | 9 | 8 | 5 | 5 | 2 |

### Rejections

- **Python artifact smoke tests:** the failure mode is real, but [PyPA build](https://build.pypa.io/en/latest/tutorial/getting-started.html), [tox package environments](https://tox.wiki/en/stable/explanation.html), and [cibuildwheel](https://cibuildwheel.pypa.io/en/stable/options/) already build and run tests against distributions. A new runner risks being a thin wrapper unless it supports a substantially broader artifact contract. Also too close to package/release-preflight projects already in this workspace.
- **MCP black-box testing:** official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) and [protocol conformance tooling](https://github.com/modelcontextprotocol/conformance) already address interactive exploration and protocol-level testing. Additional test harnesses are emerging quickly, while the protocol and transport surface change quickly. The remaining behavior-test gap did not outweigh overlap and maintenance risk.
- **PostgreSQL migration safety:** genuine severe pain, but active tools such as [Squawk](https://github.com/sbdchd/squawk), [safe-migrate](https://github.com/dsecurity49/safe-migrate), and [mig](https://github.com/Tochemey/mig) already compete directly with offline/connected migration analysis. A new implementation would need deep PostgreSQL semantics and creates a high correctness/maintenance burden.

The selected candidate has a narrower impact than database outage prevention, but its failure mode is testable without extensions or credentials, its validation runs from an ordinary checkout, and the workspace does not already contain a VS Code task/launch checker.

## Product challenge

If this appears in a search for “VS Code preLaunchTask not found” or “validate tasks.json launch.json,” choose it when you want a CI-friendly check of checked-in references. It complements VS Code's own schema and runtime checks; it does not replace them.
