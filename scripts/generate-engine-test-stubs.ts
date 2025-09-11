/* Auto-generate skeleton engine test cases per Effect kind.
 * The goal is to create editable stubs, not to fully verify semantics.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { EffectZ } from '../schema.ts';

function listEffectKinds(): string[] {
  // Resolve z.lazy
  const resolved: any = (EffectZ as any)._def?.getter ? (EffectZ as any)._def.getter() : EffectZ;
  const optMap: Map<string, unknown> | undefined = resolved?.optionsMap;
  if (optMap && typeof optMap.size === 'number') return Array.from(optMap.keys());
  const opts = resolved?._def?.options ?? resolved?.options ?? [];
  const kinds: string[] = [];
  for (const opt of opts) {
    try {
      const shape = typeof opt?._def?.shape === 'function' ? opt._def.shape() : opt?._def?.shape;
      const kindLit = shape?.kind?._def?.value;
      if (typeof kindLit === 'string') kinds.push(kindLit);
    } catch {}
  }
  return Array.from(new Set(kinds));
}

type Stub = { name: string; effect: any };

function defaultEffect(kind: string): any {
  switch (kind) {
    case 'DealDamage': return { kind, target: { owner: 'OPP', zone: 'BF', max: 1, filter: { kind: 'True' } }, amount: { kind: 'Const', n: 1 } };
    case 'PreventDamage': return { kind, target: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, amount: { kind: 'Const', n: 1 }, duration: 'EOT' };
    case 'Heal': return { kind, target: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, amount: { kind: 'Const', n: 1 } };
    case 'Draw': return { kind, who: 'SELF', n: { kind: 'Const', n: 1 } };
    case 'Mill': return { kind, who: 'OPP', n: { kind: 'Const', n: 1 } };
    case 'LookAtTop': return { kind, who: 'SELF', n: 1 };
    case 'CreateToken': return { kind, who: 'SELF', atk: 1, hp: 1 };
    case 'AddCounter': return { kind, target: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, counter: '+1/+1', n: { kind: 'Const', n: 1 } };
    case 'RemoveCounter': return { kind, target: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, counter: '+1/+1', n: { kind: 'Const', n: 1 } };
    case 'Buff': return { kind, target: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, atk: 1, duration: 'EOT' };
    case 'Move': return { kind, target: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, to: 'GY' };
    case 'ChangeController': return { kind, target: { owner: 'OPP', zone: 'BF', max: 1, filter: { kind: 'True' } }, newController: 'SELF', duration: 'EOT' };
    case 'Transform': return { kind, target: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, into: { atk: 1, hp: 1 }, duration: 'EOT' };
    case 'CopyStats': return { kind, from: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, to: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, clamp: { atk: [0, 20], hp: [1, 40] }, duration: 'EOT' };
    case 'Conditional': return { kind, if: { kind: 'True' }, then: { kind: 'NoOp' } };
    case 'Case': return { kind, branches: [{ when: { kind: 'True' }, do: { kind: 'NoOp' } }] };
    case 'ForEach': return { kind, among: { owner: 'SELF', zone: 'BF', max: 1, filter: { kind: 'True' } }, maxTargets: 1, body: { kind: 'NoOp' } };
    case 'Sequence': return { kind, steps: [{ kind: 'NoOp' }] };
    case 'Repeat': return { kind, times: 1, body: { kind: 'NoOp' } };
    case 'NoOp': return { kind };
    default: return { kind: 'NoOp' };
  }
}

function generate(): string {
  const kinds = listEffectKinds();
  const lines: string[] = [];
  lines.push("import type { TestCase } from '../harness.ts';");
  lines.push("import { mkUnit } from '../harness.ts';");
  lines.push('');
  lines.push('export const cases: TestCase[] = [');
  for (const k of kinds) {
    const eff = JSON.stringify(defaultEffect(k), null, 2).replace(/"/g, "'");
    lines.push('  {');
    lines.push(`    name: 'Effect stub: ${k}',`);
    lines.push("    pre: {\n      turn: { number: 1, active: 0, phase: 'MAIN' },\n      cards: [\n        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },\n        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },\n        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },\n      ],\n    },");
    lines.push('    actions: [');
    lines.push('      {');
    lines.push("        kind: 'resolve', controller: 0, effect: " + eff + ',');
    lines.push("        targets: ['B1'],");
    lines.push('      },');
    lines.push('    ],');
    lines.push('    expect: { /* TODO: add expectations */ },');
    lines.push('  },');
  }
  lines.push('];');
  lines.push('export default cases;');
  return lines.join('\n');
}

const outPath = join('test', 'engine', 'generated', 'effects.stubs.ts');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, generate(), 'utf8');
console.log('Generated stubs at', outPath);

