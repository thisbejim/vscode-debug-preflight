#!/usr/bin/env node
import { auditWorkspace, formatJson, formatSarif, formatText, hasFailure } from "./audit.js";
const VERSION = "0.1.0";
const HELP = `vscode-debug-preflight ${VERSION}

Check cross-file references in VS Code launch, task, and workspace configuration.

Usage:
  vscode-debug-preflight [workspace-directory | file.code-workspace] [options]

Options:
  --strict       Fail when warnings remain, including unresolved task labels
  --format NAME  Output: text (default), json, or sarif
  --version      Print the version
  -h, --help     Show this help

The checker reads JSON with comments, never runs task commands, and does not
need VS Code or debugger extensions. Unresolved task labels are warnings by
default because extensions can contribute tasks at runtime.
`;
function main(args) {
    let target = process.cwd();
    let targetSet = false;
    let strict = false;
    let format = "text";
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
            process.stdout.write(HELP);
            return 0;
        }
        if (arg === "--version") {
            process.stdout.write(`${VERSION}\n`);
            return 0;
        }
        if (arg === "--strict") {
            strict = true;
            continue;
        }
        if (arg === "--format") {
            const next = args[i + 1];
            if (next !== "text" && next !== "json" && next !== "sarif") {
                process.stderr.write("--format must be text, json, or sarif.\n");
                return 2;
            }
            format = next;
            i += 1;
            continue;
        }
        if (arg?.startsWith("-")) {
            process.stderr.write(`Unknown option: ${arg}\n\n${HELP}`);
            return 2;
        }
        if (arg !== undefined && !targetSet) {
            target = arg;
            targetSet = true;
            continue;
        }
        process.stderr.write(`Unexpected argument: ${arg ?? ""}\n\n${HELP}`);
        return 2;
    }
    const diagnostics = auditWorkspace({ target, strict });
    const output = format === "json" ? formatJson(diagnostics)
        : format === "sarif" ? formatSarif(diagnostics)
            : formatText(diagnostics);
    process.stdout.write(`${output}\n`);
    return hasFailure(diagnostics, strict) ? 1 : 0;
}
process.exitCode = main(process.argv.slice(2));
//# sourceMappingURL=cli.js.map