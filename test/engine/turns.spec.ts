import type { TestCase } from './harness.ts';
import { mkUnit } from './harness.ts';

export const cases: TestCase[] = [
  {
    name: 'startTurn: AP gain and draw on turn start',
    pre: {
      players: [ { name: 'A', ap: 0 }, { name: 'B', ap: 0 } ],
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawMe', 0, 1) },
      ],
    },
    actions: [ { kind: 'startTurn' } ],
    expect: {
      turn: { phase: 'UPKEEP' },
      players: [ { ap: 1, zones: { HAND: ['D1'], LIB: [] } }, {} as any ],
      logIncludes: ['Turn 1 start: A'],
    },
  },
  {
    name: 'advancePhase: UPKEEP -> MAIN',
    pre: { turn: { number: 1, active: 0, phase: 'UPKEEP' } },
    actions: [ { kind: 'advancePhase' } ],
    expect: { turn: { phase: 'MAIN' }, logIncludes: ['Phase -> MAIN'] },
  },
  {
    name: 'endTurn: clears damage and flips active',
    pre: {
      players: [ { name: 'A' }, { name: 'B' } ],
      turn: { number: 1, active: 0, phase: 'END' },
      cards: [
        { id: 'U', owner: 0, zone: 'BF', card: mkUnit('Soldier', 1, 2), damage: 1 },
      ],
    },
    actions: [ { kind: 'endTurn' } ],
    expect: {
      turn: { number: 2, active: 1, phase: 'UPKEEP' },
      cards: [ { id: 'U', zone: 'BF', damage: 0 } ],
    },
  },
  {
    name: 'endTurn: control reverts for EOT change controller',
    pre: {
      turn: { number: 1, active: 0, phase: 'END' },
      cards: [
        { id: 'O', owner: 1, zone: 'BF', card: mkUnit('Thief', 1, 1) },
      ],
    },
    actions: [
      { kind: 'resolve', controller: 0, effect: { kind: 'ChangeController', target: { owner: 'OPP', zone: 'BF', max: 1, filter: { kind: 'True' } }, newController: 'SELF', duration: 'EOT' }, targets: ['O'] },
      { kind: 'endTurn' },
    ],
    expect: {
      cards: [ { id: 'O', owner: 1 } ],
    },
  },
];

export default cases;

