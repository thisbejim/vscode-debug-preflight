import { readFileSync, existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findNodeAtLocation, parse, parseTree, printParseErrorCode, } from "jsonc-parser";
const JSONC_OPTIONS = { allowTrailingComma: true, disallowComments: false };
const SPECIAL_TASK_REFS = new Set(["${defaultBuildTask}"]);
const DETECTED_TASK_PREFIXES = /^(npm|gulp|grunt|typescript|tsc|c\/c\+\+|cmake):\s/i;
function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function array(value) {
    return Array.isArray(value) ? value : undefined;
}
function lineColumn(text, offset) {
    const before = text.slice(0, Math.max(0, offset));
    const lines = before.split("\n");
    return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}
function relativeFile(root, file) {
    const rel = resolve(file);
    const path = relative(root, rel).split(sep).join("/");
    return path || basename(rel);
}
function addDiagnostic(diagnostics, root, parsed, code, severity, message, node, offset) {
    const source = parsed?.text ?? "";
    const position = lineColumn(source, node?.offset ?? offset ?? 0);
    diagnostics.push({
        code,
        severity,
        message,
        file: relativeFile(root, parsed?.file ?? "<workspace>"),
        ...position,
    });
}
function parseFile(file, root, diagnostics) {
    if (!existsSync(file))
        return undefined;
    let text;
    try {
        text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    }
    catch (error) {
        diagnostics.push({
            code: "file-read-error", severity: "error",
            message: error instanceof Error ? error.message : String(error),
            file: relativeFile(root, file), line: 1, column: 1,
        });
        return undefined;
    }
    const errors = [];
    const value = parse(text, errors, JSONC_OPTIONS);
    const treeErrors = [];
    const tree = parseTree(text, treeErrors, JSONC_OPTIONS);
    for (const error of errors) {
        const pos = lineColumn(text, error.offset);
        diagnostics.push({
            code: "invalid-jsonc", severity: "error",
            message: printParseErrorCode(error.error),
            file: relativeFile(root, file), ...pos,
        });
    }
    if (value === undefined && text.trim() !== "")
        return undefined;
    return { file, text, value, ...(tree === undefined ? {} : { tree }) };
}
function nodeAt(parsed, path) {
    return parsed?.tree === undefined ? undefined : findNodeAtLocation(parsed.tree, [...(parsed.prefix ?? []), ...path]);
}
function readWorkspace(target, diagnostics) {
    const absolute = resolve(target);
    if (!existsSync(absolute))
        throw new Error("Selected workspace path does not exist.");
    const stats = statSync(absolute);
    if (absolute.endsWith(".code-workspace")) {
        if (!stats.isFile())
            throw new Error("A .code-workspace target must be a file.");
        const root = dirname(absolute);
        const workspaceFile = parseFile(absolute, root, diagnostics);
        const workspace = object(workspaceFile?.value) ?? {};
        const scopes = [];
        const folders = array(workspace.folders) ?? [];
        for (const entry of folders) {
            const folder = object(entry);
            const rawPath = typeof entry === "string" ? entry : folder?.path;
            if (typeof rawPath !== "string")
                continue;
            if (rawPath.includes("://")) {
                addDiagnostic(diagnostics, root, workspaceFile, "remote-folder", "info", `Remote workspace folder '${rawPath}' is outside this local check.`);
                continue;
            }
            if (rawPath.includes("${")) {
                addDiagnostic(diagnostics, root, workspaceFile, "dynamic-folder-path", "info", `Workspace folder path '${rawPath}' contains a variable and cannot be resolved statically.`);
                continue;
            }
            const folderRoot = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath);
            const folderName = typeof folder?.name === "string" ? folder.name : basename(folderRoot);
            const tasksFile = parseFile(join(folderRoot, ".vscode", "tasks.json"), root, diagnostics);
            const launchFile = parseFile(join(folderRoot, ".vscode", "launch.json"), root, diagnostics);
            scopes.push({
                name: folderName, root: folderRoot, tasks: tasksFile, launch: launchFile,
                tasksValue: object(tasksFile?.value), launchValue: object(launchFile?.value),
            });
        }
        const workspaceTasks = workspaceFile === undefined || workspace.tasks === undefined ? undefined : {
            file: workspaceFile.file, text: workspaceFile.text,
            value: workspace.tasks,
            prefix: ["tasks"],
            ...(workspaceFile.tree === undefined ? {} : { tree: workspaceFile.tree }),
        };
        const workspaceLaunch = workspaceFile === undefined || workspace.launch === undefined ? undefined : {
            file: workspaceFile.file, text: workspaceFile.text,
            value: workspace.launch,
            prefix: ["launch"],
            ...(workspaceFile.tree === undefined ? {} : { tree: workspaceFile.tree }),
        };
        scopes.push({
            name: "workspace", root, tasks: workspaceTasks, launch: workspaceLaunch,
            tasksValue: object(workspace.tasks), launchValue: object(workspace.launch),
        });
        return { root, scopes };
    }
    if (!stats.isDirectory())
        throw new Error("Expected a workspace directory or a .code-workspace file.");
    const root = absolute;
    const tasks = parseFile(join(root, ".vscode", "tasks.json"), root, diagnostics);
    const launch = parseFile(join(root, ".vscode", "launch.json"), root, diagnostics);
    return {
        root,
        scopes: [{
                name: basename(root), root, tasks, launch,
                tasksValue: object(tasks?.value), launchValue: object(launch?.value),
            }],
    };
}
function assertArray(value, property, parsed, root, diagnostics) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        addDiagnostic(diagnostics, root, parsed, "expected-array", "error", `'${property}' must be an array.`, nodeAt(parsed, [property]));
        return [];
    }
    return value;
}
function collectTasks(scopes, root, diagnostics) {
    const records = [];
    for (const scope of scopes) {
        if (scope.tasksValue === undefined)
            continue;
        const items = assertArray(scope.tasksValue?.tasks, "tasks", scope.tasks, root, diagnostics);
        const labels = new Map();
        items.forEach((raw, index) => {
            const task = object(raw);
            const label = task?.label;
            const node = nodeAt(scope.tasks, ["tasks", index, "label"]);
            if (typeof label !== "string" || label.trim() === "") {
                addDiagnostic(diagnostics, root, scope.tasks, "task-label-missing", "error", `Task ${index + 1} must have a non-empty label.`, node ?? nodeAt(scope.tasks, ["tasks", index]));
                return;
            }
            const count = (labels.get(label) ?? 0) + 1;
            labels.set(label, count);
            if (count > 1) {
                addDiagnostic(diagnostics, root, scope.tasks, "duplicate-task-label", "error", `Task label '${label}' is defined more than once in this scope.`, node);
            }
            records.push({ label, scope, index, ...(node === undefined ? {} : { node }) });
        });
    }
    return records;
}
function collectConfigurations(scopes, root, diagnostics) {
    const records = [];
    for (const scope of scopes) {
        if (scope.launchValue === undefined)
            continue;
        const configs = assertArray(scope.launchValue?.configurations, "configurations", scope.launch, root, diagnostics);
        const names = new Map();
        configs.forEach((raw, index) => {
            const config = object(raw);
            const name = config?.name;
            const node = nodeAt(scope.launch, ["configurations", index, "name"]);
            if (typeof name !== "string" || name.trim() === "") {
                addDiagnostic(diagnostics, root, scope.launch, "configuration-name-missing", "error", `Launch configuration ${index + 1} must have a non-empty name.`, node ?? nodeAt(scope.launch, ["configurations", index]));
                return;
            }
            const count = (names.get(name) ?? 0) + 1;
            names.set(name, count);
            if (count > 1) {
                addDiagnostic(diagnostics, root, scope.launch, "duplicate-configuration-name", "error", `Launch configuration '${name}' is defined more than once in this scope.`, node);
            }
            records.push({ name, scope, index, ...(node === undefined ? {} : { node }) });
        });
    }
    return records;
}
function taskMatches(records, reference) {
    const direct = records.filter((record) => record.label === reference);
    if (direct.length > 0)
        return direct;
    const separator = reference.indexOf(": ");
    if (separator > 0) {
        const folder = reference.slice(0, separator);
        const label = reference.slice(separator + 2);
        return records.filter((record) => record.label === label && record.scope.name === folder);
    }
    return [];
}
function externalTaskProviderReference(reference) {
    return DETECTED_TASK_PREFIXES.test(reference);
}
function checkTaskReference(reference, owner, ownerRoot, node, tasks, diagnostics, strict, relationship) {
    if (typeof reference !== "string" || reference.trim() === "") {
        addDiagnostic(diagnostics, ownerRoot, owner, "task-reference-invalid", "error", `${relationship} must be a non-empty task label.`, node);
        return;
    }
    if (SPECIAL_TASK_REFS.has(reference) || reference.includes("${"))
        return;
    const matches = taskMatches(tasks, reference);
    if (matches.length === 1)
        return;
    if (matches.length > 1) {
        addDiagnostic(diagnostics, ownerRoot, owner, "task-reference-ambiguous", strict ? "error" : "warning", `${relationship} '${reference}' matches tasks in multiple workspace scopes. Qualify it with a folder name.`, node);
        return;
    }
    if (externalTaskProviderReference(reference))
        return;
    addDiagnostic(diagnostics, ownerRoot, owner, "task-reference-unresolved", strict ? "error" : "warning", `${relationship} '${reference}' is not declared in the workspace files checked. An extension task provider may supply it.`, node);
}
function checkTaskDependencies(tasks, root, diagnostics, strict) {
    for (const record of tasks) {
        const parsed = record.scope.tasks;
        const task = object(record.scope.tasksValue?.tasks instanceof Array
            ? record.scope.tasksValue.tasks[record.index] : undefined);
        if (task?.dependsOn === undefined)
            continue;
        const dependencies = typeof task.dependsOn === "string"
            ? [task.dependsOn]
            : array(task.dependsOn);
        if (dependencies === undefined) {
            addDiagnostic(diagnostics, root, parsed, "depends-on-invalid", "error", `Task '${record.label}' has a 'dependsOn' value that must be a string or array.`, nodeAt(parsed, ["tasks", record.index, "dependsOn"]));
            continue;
        }
        dependencies.forEach((dependency, depIndex) => {
            const depNode = nodeAt(parsed, ["tasks", record.index, "dependsOn", ...(typeof task.dependsOn === "string" ? [] : [depIndex])]);
            checkTaskReference(dependency, parsed, root, depNode, tasks, diagnostics, strict, `Task '${record.label}' dependency`);
        });
    }
}
function configMatches(configurations, reference) {
    if (typeof reference === "string")
        return configurations.filter((config) => config.name === reference);
    const value = object(reference);
    if (value === undefined || typeof value.name !== "string" || typeof value.folder !== "string")
        return [];
    return configurations.filter((config) => config.name === value.name &&
        (config.scope.name === value.folder || config.scope.root === value.folder || basename(config.scope.root) === value.folder));
}
function checkLaunches(scopes, root, tasks, configurations, diagnostics, strict) {
    for (const scope of scopes) {
        const launch = scope.launchValue;
        const file = scope.launch;
        if (launch === undefined)
            continue;
        const configs = array(launch.configurations) ?? [];
        configs.forEach((raw, index) => {
            const config = object(raw);
            if (config === undefined)
                return;
            for (const field of ["preLaunchTask", "postDebugTask"]) {
                if (config[field] !== undefined) {
                    checkTaskReference(config[field], file, root, nodeAt(file, ["configurations", index, field]), tasks, diagnostics, strict, `Configuration '${String(config.name ?? index + 1)}' ${field}`);
                }
            }
        });
        const compounds = assertArray(launch.compounds, "compounds", file, root, diagnostics);
        const seen = new Set();
        compounds.forEach((raw, index) => {
            const compound = object(raw);
            if (compound === undefined) {
                addDiagnostic(diagnostics, root, file, "compound-invalid", "error", `Compound ${index + 1} must be an object.`, nodeAt(file, ["compounds", index]));
                return;
            }
            if (typeof compound.name !== "string" || compound.name.trim() === "") {
                addDiagnostic(diagnostics, root, file, "compound-name-missing", "error", `Compound ${index + 1} must have a non-empty name.`, nodeAt(file, ["compounds", index, "name"]));
            }
            else if (seen.has(compound.name)) {
                addDiagnostic(diagnostics, root, file, "duplicate-compound-name", "error", `Compound name '${compound.name}' is defined more than once in this scope.`, nodeAt(file, ["compounds", index, "name"]));
            }
            else
                seen.add(compound.name);
            const members = array(compound.configurations);
            if (members === undefined || members.length === 0) {
                addDiagnostic(diagnostics, root, file, "compound-configurations-invalid", "error", `Compound '${String(compound.name ?? index + 1)}' must list at least one configuration.`, nodeAt(file, ["compounds", index, "configurations"]));
            }
            else {
                members.forEach((member, memberIndex) => {
                    const matches = configMatches(configurations, member);
                    const memberNode = nodeAt(file, ["compounds", index, "configurations", memberIndex]);
                    if (matches.length === 0) {
                        addDiagnostic(diagnostics, root, file, "compound-configuration-unresolved", "error", `Compound '${String(compound.name ?? index + 1)}' refers to a launch configuration that was not found.`, memberNode);
                    }
                    else if (matches.length > 1) {
                        addDiagnostic(diagnostics, root, file, "compound-configuration-ambiguous", "warning", `Compound member '${typeof member === "string" ? member : String(object(member)?.name)}' matches multiple workspace folders; qualify it with a folder.`, memberNode);
                    }
                });
            }
            if (compound.preLaunchTask !== undefined) {
                checkTaskReference(compound.preLaunchTask, file, root, nodeAt(file, ["compounds", index, "preLaunchTask"]), tasks, diagnostics, strict, `Compound '${String(compound.name ?? index + 1)}' preLaunchTask`);
            }
        });
    }
}
function checkInputReferences(scopes, root, diagnostics) {
    for (const scope of scopes) {
        for (const [value, parsed] of [[scope.launchValue, scope.launch], [scope.tasksValue, scope.tasks]]) {
            if (value === undefined || parsed === undefined)
                continue;
            const available = new Set();
            for (const input of array(value.inputs) ?? []) {
                const id = object(input)?.id;
                if (typeof id === "string")
                    available.add(id);
            }
            const visit = (current, path) => {
                if (typeof current === "string") {
                    for (const match of current.matchAll(/\$\{input:([^}]+)\}/g)) {
                        const id = match[1];
                        if (id !== undefined && !available.has(id)) {
                            const start = path.length === 0 ? parsed.tree?.offset : nodeAt(parsed, path)?.offset;
                            addDiagnostic(diagnostics, root, parsed, "input-reference-unresolved", "error", `Input variable '\${input:${id}}' has no matching input definition in this scope.`, nodeAt(parsed, path), start);
                        }
                    }
                }
                else if (Array.isArray(current)) {
                    current.forEach((item, index) => visit(item, [...path, index]));
                }
                else {
                    const record = object(current);
                    if (record !== undefined) {
                        for (const [key, item] of Object.entries(record))
                            visit(item, [...path, key]);
                    }
                }
            };
            visit(value, []);
        }
    }
}
export function auditWorkspace(options = {}) {
    const target = options.target ?? process.cwd();
    const diagnostics = [];
    let layout;
    try {
        layout = readWorkspace(target, diagnostics);
    }
    catch (error) {
        return [{
                code: "workspace-read-error", severity: "error",
                message: error instanceof Error ? error.message : String(error),
                file: basename(target), line: 1, column: 1,
            }];
    }
    const { root, scopes } = layout;
    if (scopes.every((scope) => scope.tasks === undefined && scope.launch === undefined)) {
        diagnostics.push({
            code: "no-config-files", severity: "info",
            message: "No launch.json or tasks.json files were found in the selected workspace.",
            file: ".", line: 1, column: 1,
        });
        return diagnostics;
    }
    for (const scope of scopes) {
        for (const [kind, parsed, value] of [
            ["task", scope.tasks, scope.tasksValue], ["launch", scope.launch, scope.launchValue],
        ]) {
            if (parsed !== undefined && value === undefined) {
                addDiagnostic(diagnostics, root, parsed, "expected-object", "error", `${kind} configuration must be a JSON object.`, parsed.tree);
            }
        }
    }
    const tasks = collectTasks(scopes, root, diagnostics);
    const configs = collectConfigurations(scopes, root, diagnostics);
    checkTaskDependencies(tasks, root, diagnostics, options.strict ?? false);
    checkLaunches(scopes, root, tasks, configs, diagnostics, options.strict ?? false);
    checkInputReferences(scopes, root, diagnostics);
    for (const scope of scopes) {
        for (const [value, parsed] of [[scope.launchValue, scope.launch], [scope.tasksValue, scope.tasks]]) {
            const seenInputIds = new Set();
            for (const [index, input] of (array(value?.inputs) ?? []).entries()) {
                const id = object(input)?.id;
                if (typeof id === "string" && seenInputIds.has(id)) {
                    addDiagnostic(diagnostics, root, parsed, "duplicate-input-id", "error", `Input id '${id}' appears more than once in this file.`, nodeAt(parsed, ["inputs", index, "id"]));
                }
                if (typeof id === "string")
                    seenInputIds.add(id);
            }
        }
    }
    diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
    return diagnostics;
}
export function hasFailure(diagnostics, strict = false) {
    return diagnostics.some((item) => item.severity === "error" || (strict && item.severity === "warning"));
}
export function formatText(diagnostics) {
    if (diagnostics.length === 0)
        return "No broken VS Code task or launch references found.";
    return diagnostics.map((item) => `${item.file}:${item.line}:${item.column}: ${item.severity} ${item.code}: ${item.message}`).join("\n");
}
export function formatJson(diagnostics) {
    return JSON.stringify({ version: 1, diagnostics }, null, 2);
}
export function formatSarif(diagnostics) {
    const ruleIds = [...new Set(diagnostics.map((item) => item.code))].sort();
    const level = (severity) => severity === "error" ? "error" : severity === "warning" ? "warning" : "note";
    return JSON.stringify({
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        version: "2.1.0",
        runs: [{
                tool: { driver: { name: "vscode-debug-preflight", rules: ruleIds.map((id) => ({ id })) } },
                results: diagnostics.map((item) => ({
                    ruleId: item.code,
                    level: level(item.severity),
                    message: { text: item.message },
                    locations: [{ physicalLocation: {
                                artifactLocation: { uri: item.file },
                                region: { startLine: item.line, startColumn: item.column },
                            } }],
                })),
            }],
    }, null, 2);
}
//# sourceMappingURL=audit.js.map