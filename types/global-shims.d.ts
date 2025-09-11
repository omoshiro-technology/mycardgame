// Minimal shims to avoid requiring @types/node during tsc
declare const process: { env: Record<string, string | undefined> };

