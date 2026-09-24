export type Severity = "error" | "warning" | "info";
export interface Diagnostic {
    code: string;
    severity: Severity;
    message: string;
    file: string;
    line: number;
    column: number;
}
export interface AuditOptions {
    target?: string;
    strict?: boolean;
}
export declare function auditWorkspace(options?: AuditOptions): Diagnostic[];
export declare function hasFailure(diagnostics: Diagnostic[], strict?: boolean): boolean;
export declare function formatText(diagnostics: Diagnostic[]): string;
export declare function formatJson(diagnostics: Diagnostic[]): string;
export declare function formatSarif(diagnostics: Diagnostic[]): string;
