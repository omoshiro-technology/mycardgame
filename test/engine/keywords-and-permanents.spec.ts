import type { TestCase } from './harness.ts';
import { mkUnit } from './harness.ts';

const mkKeywordsUnit = (name: string, atk: number, hp: number, keywords: string[]) => {
  const u = mkUnit(name, atk, hp);
  return { ...u, keywords } as const;
};

export const cases: TestCase[] = [
  {
    name: 'Cast Enchantment moves to battlefield as permanent',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      players: [{ ap: 0 }, { ap: 0 }],
      cards: [
        {
          id: 'E1', owner: 0, zone: 'HAND',
          card: {
            name: 'Simple Aura', canonicalName: 'Simple Aura',
            cost: { generic: 0, colors: [] }, type: 'Enchantment',
            tags: [], attributes: {}, keywords: [], textIR: {},
            budgets: { power: 0, complexity: 0 }, rarity: 'C', version: 1,
          }
        },
      ],
    },
    actions: [
      { kind: 'cast', pid: 0, handId: 'E1' },
    ],
    expect: {
      players: [
        { zones: { HAND: [], BF: ['E1'] } },
        {},
      ],
    },
  },
  {
    name: 'Hexproof prevents opponent targeting with DealDamage',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'HX', owner: 1, zone: 'BF', card: mkKeywordsUnit('Cloaked', 2, 2, ['Hexproof']) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0,
        effect: { kind: 'DealDamage', target: { owner: 'OPP', zone: 'BF', max: 1, filter: { kind: 'True' } }, amount: { kind: 'Const', n: 2 } },
        targets: ['HX'],
      },
    ],
    expect: {
      cards: [{ id: 'HX', zone: 'BF', damage: 0 }],
      logIncludes: ['fizzles'],
    },
  },
  {
    name: 'Haste allows attacking on entry turn',
    pre: {
      turn: { number: 3, active: 0, phase: 'COMBAT' },
      cards: [
        { id: 'H', owner: 0, zone: 'BF', card: mkKeywordsUnit('Runner', 3, 1, ['Haste']), turnEntered: 3 },
      ],
    },
    actions: [
      { kind: 'attack', pid: 0, attackerId: 'H', target: { kind: 'Player' } },
    ],
    expect: {
      players: [ {}, { life: 20 - 3 } ],
    },
  },
  {
    name: 'Vigilance allows multiple attacks in same combat (no tap)',
    pre: {
      turn: { number: 5, active: 0, phase: 'COMBAT' },
      cards: [
        { id: 'V', owner: 0, zone: 'BF', card: mkKeywordsUnit('Guardian', 2, 3, ['Vigilance']), turnEntered: 4 },
      ],
    },
    actions: [
      { kind: 'attack', pid: 0, attackerId: 'V', target: { kind: 'Player' } },
      { kind: 'attack', pid: 0, attackerId: 'V', target: { kind: 'Player' } },
    ],
    expect: {
      players: [ {}, { life: 20 - 4 } ],
    },
  },
  {
    name: 'Deathtouch destroys damaged unit regardless of remaining HP',
    pre: {
      turn: { number: 2, active: 0, phase: 'COMBAT' },
      cards: [
        { id: 'D', owner: 0, zone: 'BF', card: mkKeywordsUnit('Assassin', 1, 1, ['Deathtouch']), turnEntered: 1 },
        { id: 'X', owner: 1, zone: 'BF', card: mkUnit('Big Bear', 0, 5), turnEntered: 1 },
      ],
    },
    actions: [
      { kind: 'attack', pid: 0, attackerId: 'D', target: { kind: 'Unit', id: 'X' } },
    ],
    expect: {
      players: [ {}, {} ],
      cards: [ { id: 'X', zone: 'GY' } ],
      logIncludes: ['dies'],
    },
  },
  {
    name: 'Indestructible survives lethal damage',
    pre: {
      turn: { number: 4, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'I', owner: 1, zone: 'BF', card: mkKeywordsUnit('Immortal', 2, 2, ['Indestructible']), turnEntered: 1 },
      ],
    },
    actions: [
      { kind: 'resolve', controller: 0, effect: { kind: 'DealDamage', target: { owner: 'OPP', zone: 'BF', max: 1, filter: { kind: 'True' } }, amount: { kind: 'Const', n: 100 } }, targets: ['I'] },
    ],
    expect: {
      cards: [ { id: 'I', zone: 'BF' } ],
      logIncludes: ['indestructible'],
    },
  },
];

export default cases;

