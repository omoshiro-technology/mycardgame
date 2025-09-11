import { cardToJapaneseJSON } from '../ability-text-generator.ts';
import type { Card } from '../schema.ts';

// Minimal valid card for formatting test
const sample: Card = {
  name: 'Flame Adept',
  canonicalName: 'Flame Adept',
  cost: { generic: 2, colors: ['Red'] },
  type: 'Unit',
  stats: { atk: 2, hp: 2 },
  keywords: ['Haste'],
  tags: ['Mage'],
  attributes: { Element: 'Fire' },
  textIR: {
    cast: {
      kind: 'DealDamage',
      target: { owner: 'OPP', zone: 'BF', max: 1, filter: { kind: 'True' } },
      amount: { kind: 'Const', n: 2 },
    },
    triggers: [
      {
        when: 'OnEnter',
        effect: {
          kind: 'CreateToken',
          who: 'SELF',
          atk: 1,
          hp: 1,
          tags: ['Elemental']
        },
        limit: { per: 'TURN', times: 1 },
      },
    ],
    continuous: [
      {
        kind: 'StaticBuff',
        target: { owner: 'SELF', zone: 'BF', filter: { kind: 'HasTag', tag: 'Elemental' } },
        atk: 1,
      },
    ],
    replacements: [
      {
        when: 'WouldBeDamaged',
        subject: { owner: 'SELF', zone: 'BF', filter: { kind: 'HasTag', tag: 'Mage' } },
        instead: { kind: 'PreventDamage', target: { owner: 'SELF' }, amount: { kind: 'Const', n: 1 }, duration: 'EOT' },
        duration: 'EOT',
        limit: { per: 'TURN', times: 1 },
      },
    ],
  },
  budgets: { power: 8, complexity: 4, interaction: 3 },
  rarity: 'U',
  version: 1,
};

const jp = cardToJapaneseJSON(sample);
console.log(JSON.stringify(jp, null, 2));

