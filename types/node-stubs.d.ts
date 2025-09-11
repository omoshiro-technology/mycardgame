declare module 'node:fs' { const anyExport: any; export = anyExport; }
declare module 'node:path' { const anyExport: any; export = anyExport; }
declare module 'node:readline/promises' { const anyExport: any; export = anyExport; }
declare module 'node:process' { export const env: Record<string, string | undefined>; export const argv: string[]; export function exit(code?: number): never; export const stdin: any; export const stdout: any; export function cwd(): string; }

// Ambient globals fallback
declare const process: { env: Record<string, string | undefined>; argv: string[]; exit: (code?: number) => never; cwd: () => string };
