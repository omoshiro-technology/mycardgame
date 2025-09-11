// Functional wrapper around engine.ts: pure reducer style
// - Clones the input GameState and applies engine actions on the clone
// - Returns a new GameState, leaving the original untouched

import type { Effect, Phase, Zone } from './schema.ts';
import type { GameRules } from './core-rules.ts';
import {
  type GameState,
  type PlayerIndex,
  startTurn,
  advancePhase,
  endTurn,
  canCastFromHand,
  castFromHand,
  resolveEffect,
  attack,
  listBattlefield,
} from './engine.ts';

export type PlayerZone = Exclude<Zone, 'STACK'>;

export type EngineAction =
  | { kind: 'startTurn' }
  | { kind: 'advancePhase' }
  | { kind: 'endTurn' }
  | { kind: 'setAP'; pid: PlayerIndex; ap: number }
  | { kind: 'setLife'; pid: PlayerIndex; life: number }
  | { kind: 'cast'; pid: PlayerIndex; handId: string; targets?: string[] }
  | { kind: 'resolve'; controller: PlayerIndex; source?: string; effect: Effect; targets?: string[] }
  | { kind: 'attack'; pid: PlayerIndex; attackerId: string; target: { kind: 'Player' } | { kind: 'Unit'; id: string } };

function cloneArray<T>(xs: readonly T[] | T[]): T[] { return xs.slice(); }

function cloneMap<K, V>(m: Map<K, V>, cloneV: (v: V) => V): Map<K, V> {
  const out = new Map<K, V>();
  for (const [k, v] of m.entries()) out.set(k, cloneV(v));
  return out;
}

export function cloneState(s: GameState): GameState {
  // cards (shallow clone of each runtime card object)
  const cards = cloneMap(s.cards, (rc: any) => ({ ...rc }));
  return {
    rules: s.rules as GameRules,
    players: [0,1].map((i) => {
      const p = s.players[i as 0 | 1];
      return {
        idx: p.idx,
        name: p.name,
        life: p.life,
        ap: p.ap,
        library: cloneArray(p.library),
        hand: cloneArray(p.hand),
        battlefield: cloneArray(p.battlefield),
        graveyard: cloneArray(p.graveyard),
        exile: cloneArray(p.exile),
        mulligansTaken: p.mulligansTaken,
      };
    }) as [GameState['players'][0], GameState['players'][1]],
    cards,
    turn: { number: s.turn.number, active: s.turn.active, phase: s.turn.phase as Phase },
    stack: s.stack.map(x => ({ ...x })),
    winner: s.winner,
    preventEOT: cloneMap(s.preventEOT, (v) => v),
    preventPERM: cloneMap(s.preventPERM, (v) => v),
    controlRevertEOT: cloneMap(s.controlRevertEOT, (v) => v),
    eventsTurn: cloneMap(s.eventsTurn, (v) => v),
    eventsGame: cloneMap(s.eventsGame, (v) => v),
    triggerUseTurn: cloneMap(s.triggerUseTurn, (v) => v),
    triggerUseGame: cloneMap(s.triggerUseGame, (v) => v),
    replUseTurn: cloneMap(s.replUseTurn, (v) => v),
    replUseGame: cloneMap(s.replUseGame, (v) => v),
    log: cloneArray(s.log),
  };
}

export function reduce(state: GameState, action: EngineAction): GameState {
  const s = cloneState(state);
  switch (action.kind) {
    case 'startTurn': startTurn(s); return s;
    case 'advancePhase': advancePhase(s); return s;
    case 'endTurn': endTurn(s); return s;
    case 'setAP': s.players[action.pid].ap = action.ap; return s;
    case 'setLife': s.players[action.pid].life = action.life; return s;
    case 'cast': {
      const arr = s.players[action.pid].hand;
      const idx = arr.indexOf(action.handId);
      if (idx < 0) return s; // invalid -> no-op in pure reducer
      const can = canCastFromHand(s, action.pid, idx);
      if (!can.ok) return s;
      castFromHand(s, action.pid, idx, action.targets);
      return s;
    }
    case 'resolve': {
      resolveEffect(s, action.controller, action.source, action.effect, action.targets);
      return s;
    }
    case 'attack': {
      const units = listBattlefield(s, action.pid);
      const idx = units.findIndex(u => u.id === action.attackerId);
      if (idx < 0) return s;
      const t = action.target;
      if (t.kind === 'Player') {
        attack(s, action.pid, idx, { kind: 'Player' });
      } else {
        const oppUnits = listBattlefield(s, action.pid === 0 ? 1 : 0);
        const tIndex = oppUnits.findIndex(u => u.id === (t as { kind: 'Unit'; id: string }).id);
        attack(s, action.pid, idx, { kind: 'Unit', index: tIndex });
      }
      return s;
    }
    default: ((x: never) => { throw new Error(`Unreachable action: ${String(x)}`); })(action);
  }
}

export function reduceAll(state: GameState, actions: EngineAction[]): GameState {
  return actions.reduce((acc, a) => reduce(acc, a), state);
}
