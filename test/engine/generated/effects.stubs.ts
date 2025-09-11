import type { TestCase } from '../harness.ts';
import { mkUnit } from '../harness.ts';

export const cases: TestCase[] = [
  {
    name: 'Effect stub: DealDamage',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'DealDamage',
  'target': {
    'owner': 'OPP',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'amount': {
    'kind': 'Const',
    'n': 1
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: PreventDamage',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'PreventDamage',
  'target': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'amount': {
    'kind': 'Const',
    'n': 1
  },
  'duration': 'EOT'
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Heal',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Heal',
  'target': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'amount': {
    'kind': 'Const',
    'n': 1
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Draw',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Draw',
  'who': 'SELF',
  'n': {
    'kind': 'Const',
    'n': 1
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Mill',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Mill',
  'who': 'OPP',
  'n': {
    'kind': 'Const',
    'n': 1
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: LookAtTop',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'LookAtTop',
  'who': 'SELF',
  'n': 1
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: CreateToken',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'CreateToken',
  'who': 'SELF',
  'atk': 1,
  'hp': 1
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: AddCounter',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'AddCounter',
  'target': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'counter': '+1/+1',
  'n': {
    'kind': 'Const',
    'n': 1
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: RemoveCounter',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'RemoveCounter',
  'target': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'counter': '+1/+1',
  'n': {
    'kind': 'Const',
    'n': 1
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Buff',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Buff',
  'target': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'atk': 1,
  'duration': 'EOT'
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Move',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Move',
  'target': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'to': 'GY'
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: ChangeController',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'ChangeController',
  'target': {
    'owner': 'OPP',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'newController': 'SELF',
  'duration': 'EOT'
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Transform',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Transform',
  'target': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'into': {
    'atk': 1,
    'hp': 1
  },
  'duration': 'EOT'
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: CopyStats',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'CopyStats',
  'from': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'to': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'clamp': {
    'atk': [
      0,
      20
    ],
    'hp': [
      1,
      40
    ]
  },
  'duration': 'EOT'
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Conditional',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Conditional',
  'if': {
    'kind': 'True'
  },
  'then': {
    'kind': 'NoOp'
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Case',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Case',
  'branches': [
    {
      'when': {
        'kind': 'True'
      },
      'do': {
        'kind': 'NoOp'
      }
    }
  ]
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: ForEach',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'ForEach',
  'among': {
    'owner': 'SELF',
    'zone': 'BF',
    'max': 1,
    'filter': {
      'kind': 'True'
    }
  },
  'maxTargets': 1,
  'body': {
    'kind': 'NoOp'
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Sequence',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Sequence',
  'steps': [
    {
      'kind': 'NoOp'
    }
  ]
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: Repeat',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'Repeat',
  'times': 1,
  'body': {
    'kind': 'NoOp'
  }
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
  {
    name: 'Effect stub: NoOp',
    pre: {
      turn: { number: 1, active: 0, phase: 'MAIN' },
      cards: [
        { id: 'A1', owner: 0, zone: 'BF', card: mkUnit('Ally', 2, 2) },
        { id: 'B1', owner: 1, zone: 'BF', card: mkUnit('Enemy', 2, 2) },
        { id: 'D1', owner: 0, zone: 'LIB', card: mkUnit('DrawFiller', 0, 1) },
      ],
    },
    actions: [
      {
        kind: 'resolve', controller: 0, effect: {
  'kind': 'NoOp'
},
        targets: ['B1'],
      },
    ],
    expect: { /* TODO: add expectations */ },
  },
];
export default cases;