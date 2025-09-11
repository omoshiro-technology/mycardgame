// Minimal typed test harness for engine pre/post state testing
// NodeNext/ESM: keep extension-suffixed imports
import { CORE_RULES, type GameRules } from '../../core-rules.ts';
import type { Card, Effect, Phase, Zone } from '../../schema.ts';
import {
  type PlayerIndex,
  type GameState,
  type DeckEntry,
  type LoadedDeck,
  startTurn,
  advancePhase,
  endTurn,
  canCastFromHand,
  castFromHand,
  resolveEffect,
  attack,
  listBattlefield,
} from '../../engine.ts';

// Public harness types
export type PlayerZone = Exclude<Zone, 'STACK'>;

export type PrePlayer = Partial<{ name: string; life: number; ap: number }>;

export type PreCard = {
  id: string; // human-friendly handle used in tests (must be unique)
  owner: PlayerIndex;
  zone: PlayerZone;
  card: Card;
  isToken?: boolean;
  damage?: number;
  counters?: Record<string, number>;
  turnEntered?: number;
};

export type PreSetup = {
  seed?: number; // reserved for future randomness in harness
  players?: [PrePlayer?, PrePlayer?];
  turn?: Partial<{ number: number; active: PlayerIndex; phase: Phase }>;
  cards?: PreCard[];
};

export type Action =
  | { kind: 'startTurn' }
  | { kind: 'advancePhase' }
  | { kind: 'endTurn' }
  | { kind: 'setAP'; pid: PlayerIndex; ap: number }
  | { kind: 'setLife'; pid: PlayerIndex; life: number }
  | { kind: 'cast'; pid: PlayerIndex; handId: string; targets?: string[] }
  | { kind: 'resolve'; controller: PlayerIndex; source?: string; effect: Effect; targets?: string[] }
  | { kind: 'attack'; pid: PlayerIndex; attackerId: string; target: { kind: 'Player' } | { kind: 'Unit'; id: string } };

export type PostExpect = {
  winner?: PlayerIndex | undefined;
  turn?: Partial<{ number: number; active: PlayerIndex; phase: Phase }>;
  logIncludes?: string[];
  players?: [Partial<{ life: number; ap: number; zones: Partial<Record<PlayerZone, string[]>> }>? , Partial<{ life: number; ap: number; zones: Partial<Record<PlayerZone, string[]>> }>?];
  cards?: Array<Partial<{ id: string; zone: PlayerZone; owner: PlayerIndex; damage: number }>>;
};

export type TestCase = {
  name: string;
  pre: PreSetup;
  actions: Action[];
  expect: PostExpect;
};

export type TestResult = { name: string; ok: boolean; errors: string[] };

// Helpers
const PLAYER_ZONES: readonly PlayerZone[] = ['LIB','HAND','BF','GY','EXILE'] as const;

function emptyGameState(rules: GameRules): GameState {
  return {
    rules,
    players: [
      { idx: 0, name: 'P0', life: rules.build.startingLife, ap: 0, library: [], hand: [], battlefield: [], graveyard: [], exile: [], mulligansTaken: 0 },
      { idx: 1, name: 'P1', life: rules.build.startingLife, ap: 0, library: [], hand: [], battlefield: [], graveyard: [], exile: [], mulligansTaken: 0 },
    ],
    cards: new Map(),
    turn: { number: 1, active: 0, phase: 'MAIN' },
    stack: [],
    winner: undefined,
    preventEOT: new Map(),
    preventPERM: new Map(),
    controlRevertEOT: new Map(),
    eventsTurn: new Map(),
    eventsGame: new Map(),
    triggerUseTurn: new Map(),
    triggerUseGame: new Map(),
    replUseTurn: new Map(),
    replUseGame: new Map(),
    log: [],
  };
}

function pushToZoneArrays(s: GameState, id: string, owner: PlayerIndex, zone: PlayerZone) {
  const p = s.players[owner];
  switch (zone) {
    case 'LIB': p.library.push(id); break;
    case 'HAND': p.hand.push(id); break;
    case 'BF': p.battlefield.push(id); break;
    case 'GY': p.graveyard.push(id); break;
    case 'EXILE': p.exile.push(id); break;
    default: throw new Error(`Unreachable zone ${String(zone)}`);
  }
}

export function buildState(pre: PreSetup): GameState {
  const rules = CORE_RULES;
  const s = emptyGameState(rules);
  if (pre.players?.[0]) {
    const p = pre.players[0];
    if (p?.name != null) s.players[0].name = p.name;
    if (p?.life != null) s.players[0].life = p.life;
    if (p?.ap != null) s.players[0].ap = p.ap;
  }
  if (pre.players?.[1]) {
    const p = pre.players[1];
    if (p?.name != null) s.players[1].name = p.name;
    if (p?.life != null) s.players[1].life = p.life;
    if (p?.ap != null) s.players[1].ap = p.ap;
  }
  if (pre.turn) {
    if (pre.turn.number != null) s.turn.number = pre.turn.number;
    if (pre.turn.active != null) s.turn.active = pre.turn.active;
    if (pre.turn.phase != null) s.turn.phase = pre.turn.phase;
  }
  for (const pc of pre.cards || []) {
    // Use provided id as runtime id for stable references
    s.cards.set(pc.id, {
      id: pc.id,
      owner: pc.owner,
      card: pc.card,
      zone: pc.zone,
      damage: pc.damage || 0,
      turnEntered: pc.turnEntered,
      isToken: pc.isToken,
      counters: pc.counters,
      bonusAtkPerm: undefined,
      bonusHpPerm: undefined,
      bonusAtkEOT: undefined,
      bonusHpEOT: undefined,
      transformPerm: undefined,
      transformEOT: undefined,
    });
    pushToZoneArrays(s, pc.id, pc.owner, pc.zone);
  }
  return s;
}

export function execActions(s: GameState, actions: Action[]) {
  for (const a of actions) {
    switch (a.kind) {
      case 'startTurn': startTurn(s); break;
      case 'advancePhase': advancePhase(s); break;
      case 'endTurn': endTurn(s); break;
      case 'setAP': s.players[a.pid].ap = a.ap; break;
      case 'setLife': s.players[a.pid].life = a.life; break;
      case 'cast': {
        const arr = s.players[a.pid].hand;
        const idx = arr.indexOf(a.handId);
        if (idx < 0) throw new Error(`cast: handId ${a.handId} not found for player ${a.pid}`);
        const can = canCastFromHand(s, a.pid, idx);
        if (!can.ok) throw new Error(`canCastFromHand failed: ${can.reason}`);
        const res = castFromHand(s, a.pid, idx, a.targets);
        if (!res.ok) throw new Error(`castFromHand failed: ${res.reason}`);
        break;
      }
      case 'resolve': {
        const tgtIds = a.targets;
        resolveEffect(s, a.controller, a.source, a.effect, tgtIds);
        break;
      }
      case 'attack': {
        // resolve attacker index from id
        const units = listBattlefield(s, a.pid);
        const idx = units.findIndex(u => u.id === a.attackerId);
        if (idx < 0) throw new Error(`attack: attackerId ${a.attackerId} not found on BF`);
        const t = a.target;
        if (t.kind === 'Player') {
          const res = attack(s, a.pid, idx, { kind: 'Player' });
          if (!res.ok) throw new Error(`attack failed: ${res.reason}`);
        } else {
          const oppUnits = listBattlefield(s, a.pid === 0 ? 1 : 0);
          const tIndex = oppUnits.findIndex(u => u.id === (t as { kind: 'Unit'; id: string }).id);
          const res = attack(s, a.pid, idx, { kind: 'Unit', index: tIndex });
          if (!res.ok) throw new Error(`attack failed: ${res.reason}`);
        }
        break;
      }
      default: ((x: never) => { throw new Error(`Unreachable action: ${String(x)}`); })(a);
    }
  }
}

// Pure execution helper: returns a new state (does not mutate the input)
export async function execActionsPure(s: GameState, actions: Action[]): Promise<GameState> {
  const mod = await import('../../engine-fp.ts');
  const toFpAction = (a: Action): any => a; // shapes are compatible
  const fpActions = actions.map(toFpAction);
  return mod.reduceAll(s, fpActions);
}

function sameMultiset(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const ca = [...a].sort();
  const cb = [...b].sort();
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return false;
  return true;
}

export function verifyExpect(s: GameState, exp: PostExpect): string[] {
  const errors: string[] = [];
  if ('winner' in exp) {
    const got = s.winner;
    if (got !== (exp.winner as any)) errors.push(`winner mismatch: expected ${String(exp.winner)}, got ${String(got)}`);
  }
  if (exp.turn) {
    if (exp.turn.number != null && s.turn.number !== exp.turn.number) errors.push(`turn.number expected=${exp.turn.number} got=${s.turn.number}`);
    if (exp.turn.active != null && s.turn.active !== exp.turn.active) errors.push(`turn.active expected=${exp.turn.active} got=${s.turn.active}`);
    if (exp.turn.phase != null && s.turn.phase !== exp.turn.phase) errors.push(`turn.phase expected=${exp.turn.phase} got=${s.turn.phase}`);
  }
  if (exp.players) {
    for (const pid of [0,1] as const) {
      const e = exp.players[pid]; if (!e) continue;
      const p = s.players[pid];
      if (e.life != null && p.life !== e.life) errors.push(`p${pid}.life expected=${e.life} got=${p.life}`);
      if (e.ap != null && p.ap !== e.ap) errors.push(`p${pid}.ap expected=${e.ap} got=${p.ap}`);
      if (e.zones) {
        for (const z of Object.keys(e.zones) as PlayerZone[]) {
          const want = e.zones[z];
          const got = (() => {
            switch (z) {
              case 'LIB': return p.library;
              case 'HAND': return p.hand;
              case 'BF': return p.battlefield;
              case 'GY': return p.graveyard;
              case 'EXILE': return p.exile;
            }
          })();
          if (!sameMultiset(want, got)) {
            errors.push(`p${pid}.${z} mismatch: expected=[${(want||[]).join(',')}], got=[${(got||[]).join(',')}]`);
          }
        }
      }
    }
  }
  if (exp.cards) {
    for (const c of exp.cards) {
      if (!c?.id) continue;
      const rc = s.cards.get(c.id);
      if (!rc) { errors.push(`card ${c.id} missing`); continue; }
      if (c.zone && rc.zone !== c.zone) errors.push(`card ${c.id} zone expected=${c.zone} got=${rc.zone}`);
      if (c.owner != null && rc.owner !== c.owner) errors.push(`card ${c.id} owner expected=${c.owner} got=${rc.owner}`);
      if (c.damage != null && rc.damage !== c.damage) errors.push(`card ${c.id} damage expected=${c.damage} got=${rc.damage}`);
    }
  }
  if (exp.logIncludes) {
    for (const needle of exp.logIncludes) {
      if (!s.log.some(l => l.includes(needle))) errors.push(`log missing: ${needle}`);
    }
  }
  return errors;
}

export function runCase(tc: TestCase): TestResult {
  const s = buildState(tc.pre);
  execActions(s, tc.actions);
  const errors = verifyExpect(s, tc.expect);
  return { name: tc.name, ok: errors.length === 0, errors };
}

export function runAll(cases: TestCase[]): { results: TestResult[]; failed: number } {
  const results = cases.map(runCase);
  const failed = results.filter(r => !r.ok).length;
  return { results, failed };
}

// Convenience builders for tests
export function mkUnit(name: string, atk: number, hp: number, tags: string[] = []): Card {
  return {
    name,
    canonicalName: name,
    cost: { generic: 0, colors: [] },
    type: 'Unit',
    stats: { atk, hp },
    keywords: [],
    tags,
    attributes: {},
    textIR: {},
    budgets: { power: 0, complexity: 0 },
    rarity: 'C',
    version: 1,
  };
}

export function mkSpell(name: string, cast: Effect): Card {
  return {
    name,
    canonicalName: name,
    cost: { generic: 0, colors: [] },
    type: 'Spell',
    keywords: [],
    tags: [],
    attributes: {},
    textIR: { cast },
    budgets: { power: 0, complexity: 0 },
    rarity: 'C',
    version: 1,
  } as Card;
}
