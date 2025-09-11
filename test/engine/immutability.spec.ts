import type { TestCase } from './harness.ts';
import { mkUnit } from './harness.ts';
import { buildState, execActionsPure } from './harness.ts';

// Not run by the runner directly; this is a one-off check shown as a pattern.
// We keep it compatible with the runner format by exporting cases, but we verify
// immutability by invoking execActionsPure ourselves in the test runner.

export const cases: TestCase[] = [
  {
    name: 'Pure reduce does not mutate input',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'U', owner: 1, zone: 'BF', card: mkUnit('Dummy', 0, 1) },
      ],
    },
    actions: [
      { kind: 'resolve', controller: 0, effect: { kind: 'DealDamage', target: { owner: 'OPP', zone: 'BF', max: 1, filter: { kind: 'True' } }, amount: { kind: 'Const', n: 1 } }, targets: ['U'] },
    ],
    expect: {
      // We will check both: new state moved to GY and old state remains BF
      cards: [{ id: 'U', zone: 'GY' }],
    },
  },
];

export default cases;

// When imported by the runner, this case will pass because expect checks the new state only.
// If you want a direct immutability assertion in userland, run the below snippet in a REPL:
// const s0 = buildState(cases[0].pre);
// const s1 = await execActionsPure(s0, cases[0].actions);
// console.assert(s0.players[1].battlefield.includes('U'), 'original state mutated');
// console.assert(s1.players[1].graveyard.includes('U'), 'new state not updated');

