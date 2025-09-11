// Core game rules encoded as typed constants
// These cover rules not fully specified by the card IR schema.

import { PhaseZ, type Phase } from './schema.ts';

// Turn structure and timing rules
export type TurnRules = {
  phases: Phase[];
  drawOnTurnStart: boolean;
  playOneLandPerTurn?: boolean; // reserved for variants
};

// Deck/build & match configuration
export type BuildRules = {
  startingLife: number;
  startingHand: number;
  maxHandSize?: number; // undefined means no max
  minDeckSize: number;
  maxCopiesPerName: number; // 4 means up to 4 of the same canonicalName
  sideboardSize?: number;
};

// Mulligan policy
export type MulliganRules =
  | { kind: 'FreeOnce' } // first mulligan is free, then -1 each time
  | { kind: 'London'; bottomCount: number } // London mulligan: draw N then put bottomCount on bottom
  | { kind: 'DrawOneLess' };

// Targeting/stack/priority policy
export type ActionRules = {
  usesStack: boolean; // LIFO resolution
  illegalTargetFizzle: boolean; // targeted effects fizzle if all targets illegal on resolution
  simultaneousTriggersOrder: 'ControllerChooses' | 'ActivePlayerFirst';
};

export type DamageRules = {
  lethalAt: number; // HP <= lethalAt => dies
  damagePersistsTurn: boolean; // damage marked until end of turn
};

export type TokenRules = {
  tokensLeaveTo: 'GY' | 'EXILE';
};

export type ResourceRules = {
  mode: 'ActionPoints';
  name: string; // 表記名（例: エネルギー）
  perTurnGainBase: number; // 各ターン開始時に得る基本量
  carryOver: boolean; // 余剰は次のターンへ持ち越すか
  maxPool?: number; // 上限（省略可）
  payment: 'GenericOnly' | 'GenericAndColors';
  colors: {
    policy: 'DeckOnly' | 'InGamePayment';
    symbols: string[]; // 許可する色記号（例: W,U,B,R,G）
  };
};

export type CombatRules = {
  canBlock: boolean; // if false,攻撃はブロックされない（攻撃側が対象を選ぶ）
  attackerTargets: 'PlayerOrUnit' | 'PlayerOnly' | 'UnitOnly';
  summoningSickness: boolean; // 召喚酔い（このターンに出たユニットは攻撃不可）
};

export type WinLoseRules = {
  lifeZeroLoss: boolean; // プレイヤーのライフが0以下で敗北
  drawFromEmptyLoss?: boolean; // 空のライブラリーから引けないと敗北
};

export type GameRules = {
  turns: TurnRules;
  build: BuildRules;
  mulligan: MulliganRules;
  actions: ActionRules;
  damage: DamageRules;
  tokens: TokenRules;
  combat: CombatRules;
  win: WinLoseRules;
  resources: ResourceRules;
};

// Export a single, typed ruleset instance. Adjust here to tweak the game.
export const CORE_RULES: GameRules = {
  turns: {
    phases: PhaseZ.options,
    drawOnTurnStart: true,
    playOneLandPerTurn: undefined, // not used in this game
  },
  build: {
    startingLife: 20,
    startingHand: 5,
    maxHandSize: 10,
    minDeckSize: 40,
    maxCopiesPerName: 3,
    sideboardSize: 0,
  },
  mulligan: { kind: 'London', bottomCount: 1 },
  actions: {
    usesStack: true,
    illegalTargetFizzle: true,
    simultaneousTriggersOrder: 'ControllerChooses',
  },
  damage: {
    lethalAt: 0,
    damagePersistsTurn: true,
  },
  tokens: {
    tokensLeaveTo: 'GY',
  },
  combat: {
    canBlock: false,
    attackerTargets: 'PlayerOrUnit',
    summoningSickness: true,
  },
  win: {
    lifeZeroLoss: true,
    drawFromEmptyLoss: true,
  },
  resources: {
    mode: 'ActionPoints',
    name: 'エネルギー',
    perTurnGainBase: 1,
    carryOver: false,
    maxPool: undefined,
    payment: 'GenericOnly',
    colors: {
      policy: 'DeckOnly',
      symbols: ['W','U','B','R','G'],
    },
  },
};
