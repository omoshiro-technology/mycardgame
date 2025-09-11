import type { TestCase } from './harness.ts';
import { mkUnit, mkSpell } from './harness.ts';

// Two basic sanity tests to demonstrate the harness.

export const cases: TestCase[] = [
  {
    name: 'DealDamage destroys a 1 HP unit at lethal threshold',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'U1', owner: 1, zone: 'BF', card: mkUnit('Goblin', 1, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve',
        controller: 0,
        effect: {
          kind: 'DealDamage',
          target: { owner: 'OPP', zone: 'BF', max: 1, filter: { kind: 'True' } },
          amount: { kind: 'Const', n: 1 },
        },
        targets: ['U1'],
      },
    ],
    expect: {
      cards: [{ id: 'U1', zone: 'GY' }],
      logIncludes: ['dies'],
    },
  },
  {
    name: 'Draw from empty library makes player lose (core rule)',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      players: [{ name: 'A' }, { name: 'B' }],
      cards: [],
    },
    actions: [
      {
        kind: 'resolve',
        controller: 0,
        effect: { kind: 'Draw', who: 'SELF', n: { kind: 'Const', n: 1 } },
      },
    ],
    expect: {
      winner: 1,
      logIncludes: ['cannot draw and loses'],
    },
  },
];

export default cases;

