/* Simple engine test runner
 * - Discovers *.spec.ts under test/engine
 * - Imports default export or named `cases` array of TestCase
 * - Runs with the harness and prints a summary; exits non-zero on failures
 */

declare const process: {
  cwd: () => string;
  exit: (code?: number) => never;
};

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import type { TestCase } from '../test/engine/harness.ts';
import { runAll } from '../test/engine/harness.ts';

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith('.spec.ts')) yield p;
  }
}

async function loadCasesFrom(file: string): Promise<TestCase[]> {
  const mod = await import(pathToFileURL(file).href);
  const arr: unknown = mod.default || mod.cases;
  if (!Array.isArray(arr)) return [];
  return arr as TestCase[];
}

async function main() {
  const root = join(process.cwd(), 'test', 'engine');
  const files = Array.from(walk(root));
  let all: TestCase[] = [];
  for (const f of files) {
    const cs = await loadCasesFrom(f);
    all = all.concat(cs);
  }
  if (all.length === 0) {
    console.log('No engine test cases found.');
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  }
  const { results, failed } = runAll(all);
  for (const r of results) {
    if (r.ok) console.log(`✔ ${r.name}`);
    else {
      console.log(`✖ ${r.name}`);
      for (const e of r.errors) console.log('  - ' + e);
    }
  }
  console.log(`\n${results.length} test(s), ${failed} failed.`);
  if (failed > 0) {
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

main();
