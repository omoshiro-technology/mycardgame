// Minimal game engine to play with CORE_RULES and Card schema
// Scope: implements enough to play matches with Units and simple Spells.
// Supported effects: DealDamage, Heal, Draw, Move, NoOp
// Unsupported (ignored for now): complex target choices, advanced stacking

import { CORE_RULES, type GameRules } from './core-rules.ts';
import { analyzeRules } from './rules-verifier.ts';
import type {
  Card,
  Effect,
  Selector,
  Predicate,
  Metric,
  Value,
  Zone,
  Phase,
  TriggerWhen,
  ContinuousEffect,
  ReplacementEffect,
} from './schema.ts';

// ---------------- Types for runtime ----------------
export type PlayerIndex = 0 | 1;

type RuntimeCard = {
  id: string;
  owner: PlayerIndex;
  card: Card;
  zone: PlayerZone;
  damage: number;
  turnEntered?: number;
  isToken?: boolean;
  // Runtime state extensions
  tapped?: boolean; // tapped state for permanents (units/artifacts/enchantments)
  counters?: Record<string, number>;
  // Temporary/permanent stat modifications
  bonusAtkPerm?: number;
  bonusHpPerm?: number;
  bonusAtkEOT?: number;
  bonusHpEOT?: number;
  // Transform overrides (set-stats) layering: EOT overrides PERM overrides base
  transformPerm?: { atk: number; hp: number };
  transformEOT?: { atk: number; hp: number };
};

export type DeckEntry = { card: Card; count: number };
export type LoadedDeck = { name?: string; list: RuntimeCard[] };

export type PlayerState = {
  idx: PlayerIndex;
  name: string;
  life: number;
  ap: number; // action points (generic resource)
  // Optional color pool for colored cost payment when enabled by rules
  colorPool?: Record<string, number>;
  library: string[]; // card ids (top is end of array)
  hand: string[];
  battlefield: string[];
  graveyard: string[];
  exile: string[];
  mulligansTaken: number;
};

export type GameState = {
  rules: GameRules;
  players: [PlayerState, PlayerState];
  cards: Map<string, RuntimeCard>;
  turn: { number: number; active: PlayerIndex; phase: Phase };
  stack: { controller: PlayerIndex; sourceId: string; effect: Effect; targets?: string[] }[];
  winner?: PlayerIndex;
  // Damage prevention pools
  // EOT map resets at end of each turn; PERM persists
  preventEOT: Map<string, number>;
  preventPERM: Map<string, number>;
  // Control-change reverts at EOT
  controlRevertEOT: Map<string, PlayerIndex>;
  // Event counters for predicates
  eventsTurn: Map<string, number>; // key format: EVENT:pid
  eventsGame: Map<string, number>;
  // Trigger and replacement usage limits
  triggerUseTurn: Map<string, number>; // key: cardId#index
  triggerUseGame: Map<string, number>;
  replUseTurn: Map<string, number>;
  replUseGame: Map<string, number>;
  log: string[];
};

// ---------------- Utilities ----------------
// Exhaustiveness guard used across discriminated unions
const exhaustive = (x: never): never => { throw new Error(`Unreachable: ${String(x)}`); };
let nextId = 1;
function makeId() { return `C${nextId++}`; }

// Helper type: zones that actually belong to a player (excludes STACK)
type PlayerZone = Exclude<Zone, 'STACK'>;
const PLAYER_ZONES: readonly PlayerZone[] = ['LIB','HAND','BF','GY','EXILE'] as const;

function shuffle<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function pushLog(s: GameState, msg: string) { s.log.push(msg); }

function getZoneArray(p: PlayerState, zone: PlayerZone): string[] {
  switch (zone) {
    case 'LIB': return p.library;
    case 'HAND': return p.hand;
    case 'BF': return p.battlefield;
    case 'GY': return p.graveyard;
    case 'EXILE': return p.exile;
    default: return exhaustive(zone);
  }
}

function transferControl(s: GameState, id: string, newOwner: PlayerIndex) {
  const rc = s.cards.get(id);
  if (!rc) return;
  if (rc.owner === newOwner) return;
  const oldOwner = rc.owner;
  const from = s.players[oldOwner];
  const to = s.players[newOwner];
  // Remove id from all zones of old owner
  for (const z of PLAYER_ZONES) {
    const arr = getZoneArray(from, z);
    const idx = arr.indexOf(id);
    if (idx >= 0) arr.splice(idx, 1);
  }
  // Add to same zone for new owner
  getZoneArray(to, rc.zone).push(id);
  rc.owner = newOwner;
}

function moveCard(s: GameState, cardId: string, toZone: PlayerZone) {
  const rc = s.cards.get(cardId);
  if (!rc) return;
  const p = s.players[rc.owner];
  // Respect token leave rule: whenever a token leaves BF, it goes to the configured zone
  let dest: PlayerZone = toZone;
  if (rc.isToken && rc.zone === 'BF' && toZone !== 'BF') {
    dest = s.rules.tokens.tokensLeaveTo;
  }
  // remove from all zones
  for (const z of PLAYER_ZONES) {
    const arr = getZoneArray(p, z);
    const i = arr.indexOf(cardId);
    if (i >= 0) arr.splice(i, 1);
  }
  getZoneArray(p, dest).push(cardId);
  rc.zone = dest;
  // Fire OnEnter when a card enters BF
  if (dest === 'BF') {
    // entering battlefield: comes in untapped by default
    rc.tapped = false;
    fireTriggers(s, 'OnEnter', { subjectId: cardId });
    fireTriggers(s, 'OnNameMatched', { subjectId: cardId });
  }
}

function topDraw(s: GameState, who: PlayerIndex, n: number): boolean {
  const p = s.players[who];
  for (let i = 0; i < n; i++) {
    // Replacement: WouldDraw — if any active replacement with subject.owner matches this player, apply instead and skip draw
    const wouldDrawHandled = applyWouldDrawReplacement(s, who);
    if (wouldDrawHandled) continue;
    if (p.library.length === 0) {
      if (s.rules.win.drawFromEmptyLoss) {
        s.winner = (who === 0 ? 1 : 0);
        pushLog(s, `Player ${p.name} cannot draw and loses.`);
      }
      return false;
    }
    const id = p.library.pop()!; // top is end
    moveCard(s, id, 'HAND');
    pushLog(s, `${p.name} draws a card.`);
    // Triggers
    fireTriggers(s, 'OnDraw', { subjectId: id, subjectPlayer: who });
    fireTriggers(s, 'OnNameMatched', { subjectId: id, subjectPlayer: who });
  }
  return true;
}

// Determine whether a given target is still legal for a selector at resolution time
function isLegalTarget(s: GameState, controller: PlayerIndex, sel: Selector, id: string, selfId?: string): boolean {
  const rc = s.cards.get(id);
  if (!rc) return false;
  // owner restriction
  if (sel.owner != null) {
    const expectOwner = sel.owner === 'SELF' ? controller : (controller === 0 ? 1 : 0);
    if (rc.owner !== expectOwner) return false;
  }
  // zone restriction (default BF for permanents when omitted)
  const zones: Zone[] = sel.zone ? [sel.zone] : ['BF'];
  if (!zones.includes(rc.zone)) return false;
  // predicate filter
  if (sel.filter && !matchesPredicate(s, controller, selfId, id, sel.filter)) return false;
  // keyword-based targeting restrictions
  const hasKeyword = (k: string) => !!rc.card.keywords?.includes(k);
  // Hexproof: cannot be targeted by opponent's spells/abilities
  if (hasKeyword('Hexproof') && rc.owner !== controller) return false;
  return true;
}

// ---------------- Deck loading & validation ----------------
export function loadDeck(raw: { name?: string; cards: DeckEntry[] }, owner: PlayerIndex): LoadedDeck {
  const list: RuntimeCard[] = [];
  const name = raw.name;
  for (const entry of raw.cards) {
    const count = Math.max(0, Math.floor(entry.count));
    for (let i = 0; i < count; i++) {
      const id = makeId();
      list.push({ id, owner, card: entry.card, zone: 'LIB', damage: 0 });
    }
  }
  return { name, list };
}

export function validateDeck(list: RuntimeCard[], rules: GameRules): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (list.length < rules.build.minDeckSize) {
    issues.push(`Deck too small: ${list.length} < ${rules.build.minDeckSize}`);
  }
  const byName = new Map<string, number>();
  for (const rc of list) {
    const key = rc.card.canonicalName || rc.card.name;
    byName.set(key, (byName.get(key) || 0) + 1);
  }
  for (const [name, n] of byName) {
    if (n > rules.build.maxCopiesPerName) {
      issues.push(`Too many copies of ${name}: ${n} > ${rules.build.maxCopiesPerName}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

// ---------------- Game setup ----------------
export function initGame(deckA: LoadedDeck, deckB: LoadedDeck, seed = 42): GameState {
  const rules = CORE_RULES;
  // seedable rng
  let state = seed >>> 0;
  const rng = () => {
    // xorshift32
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17; state >>>= 0;
    state ^= state << 5;  state >>>= 0;
    return (state >>> 0) / 0x100000000;
  };

  const cards = new Map<string, RuntimeCard>();
  const p0: PlayerState = { idx: 0, name: deckA.name || 'P1', life: rules.build.startingLife, ap: 0, colorPool: {}, library: [], hand: [], battlefield: [], graveyard: [], exile: [], mulligansTaken: 0 };
  const p1: PlayerState = { idx: 1, name: deckB.name || 'P2', life: rules.build.startingLife, ap: 0, colorPool: {}, library: [], hand: [], battlefield: [], graveyard: [], exile: [], mulligansTaken: 0 };

  for (const rc of deckA.list) { cards.set(rc.id, rc); p0.library.push(rc.id); }
  for (const rc of deckB.list) { cards.set(rc.id, rc); p1.library.push(rc.id); }
  shuffle(p0.library, rng); shuffle(p1.library, rng);

  const s: GameState = {
    rules,
    players: [p0, p1],
    cards,
    turn: { number: 1, active: 0, phase: 'UPKEEP' },
    stack: [],
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

  // Verify ruleset consistency at startup and log results
  const analysis = analyzeRules(rules);
  if (!analysis.ok) {
    const errs = analysis.issues.filter(i => i.level === 'error');
    pushLog(s, `[RulesVerifier] Errors: ${errs.map(e => e.code).join(', ')}`);
  }
  const warns = analysis.issues.filter(i => i.level === 'warning');
  if (warns.length) {
    pushLog(s, `[RulesVerifier] Warnings: ${warns.map(w => w.code).join(', ')}`);
  }

  // Starting hands
  topDraw(s, 0, rules.build.startingHand);
  topDraw(s, 1, rules.build.startingHand);

  return s;
}

// ---------------- Value/Metric/Predictor eval (subset) ----------------
function evalValue(s: GameState, controller: PlayerIndex, selfId: string | undefined, targetId: string | undefined, v: Value): number {
  switch (v.kind) {
    case 'Const': return v.n;
    case 'Clamp': {
      const raw = evalMetric(s, controller, selfId, targetId, v.of);
      return Math.min(v.max, Math.max(v.min, raw));
    }
    default: return exhaustive(v);
  }
}

function evalMetric(s: GameState, controller: PlayerIndex, selfId: string | undefined, targetId: string | undefined, m: Metric): number {
  switch (m.kind) {
    case 'Const': return m.n;
    case 'Life': return s.players[m.who === 'SELF' ? controller : (controller === 0 ? 1 : 0)].life;
    case 'BoardCount': {
      const pid = m.who === 'SELF' ? controller : (controller === 0 ? 1 : 0);
      const p = s.players[pid];
      const zone: Zone | undefined = m.zone;
      let ids: readonly string[];
      switch (zone) {
        case undefined: ids = p.battlefield; break; // default to battlefield
        case 'BF': ids = p.battlefield; break;
        case 'HAND': ids = p.hand; break;
        case 'GY': ids = p.graveyard; break;
        case 'EXILE': ids = p.exile; break;
        case 'LIB': ids = p.library; break;
        case 'STACK': return 0; // not a per-player zone in this engine
        default: return exhaustive(zone as never);
      }
      if (!m.tag) return ids.length;
      return ids
        .map(id => s.cards.get(id))
        .filter((rc): rc is RuntimeCard => !!rc)
        .filter(rc => rc.card.tags.includes(m.tag!)).length;
    }
    case 'CardStat': {
      const id = m.of === 'Self' ? selfId : targetId;
      if (!id) return 0;
      const rc = s.cards.get(id);
      if (!rc || !rc.card.stats) return 0;
      const stats = getEffectiveBaseStats(s, rc);
      const atk = stats.atk + (rc.bonusAtkPerm || 0) + (rc.bonusAtkEOT || 0);
      const hpMax = stats.hp + (rc.bonusHpPerm || 0) + (rc.bonusHpEOT || 0);
      return m.stat === 'ATK' ? atk : Math.max(0, hpMax - rc.damage);
    }
    default: return exhaustive(m);
  }
}

// ---------------- Pure planning layer (operations) ----------------
type Duration = 'EOT' | 'PERM';
type Operation =
  | { kind: 'Log'; msg: string }
  | { kind: 'FireTriggers'; when: TriggerWhen; ctx: { subjectId?: string; subjectPlayer?: PlayerIndex; sourceId?: string; forPlayer?: PlayerIndex } }
  | { kind: 'ResolveEffectOp'; controller: PlayerIndex; sourceId?: string; effect: Effect; targets?: string[] }
  | { kind: 'DealDamageMany'; targets: string[]; amount: number; sourceId?: string }
  | { kind: 'PreventDamageMany'; targets: string[]; amount: number; duration: Duration }
  | { kind: 'HealMany'; targets: string[]; amount: number }
  | { kind: 'Draw'; pid: PlayerIndex; n: number }
  | { kind: 'Mill'; pid: PlayerIndex; n: number }
  | { kind: 'LookAtTop'; pid: PlayerIndex; n: number; choose?: { keep: number; moveRestTo: PlayerZone; reveal?: boolean } }
  | { kind: 'CreateToken'; pid: PlayerIndex; atk: number; hp: number; tags?: string[]; attributes?: Record<string,string> }
  | { kind: 'AddCounterMany'; targets: string[]; counter: string; n: number; max?: number }
  | { kind: 'RemoveCounterMany'; targets: string[]; counter: string; n: number }
  | { kind: 'BuffMany'; targets: string[]; atkDelta: number; hpDelta: number; duration: Duration }
  | { kind: 'MoveMany'; targets: string[]; to: PlayerZone }
  | { kind: 'ChangeControllerMany'; targets: string[]; newOwner: PlayerIndex; duration: Duration }
  | { kind: 'TransformMany'; targets: string[]; into: { atk: number; hp: number }; duration?: Duration }
  | { kind: 'CopyStatsToMany'; targets: string[]; toAtk: number; toHp: number; duration: Duration }
  | { kind: 'SetPhase'; phase: Phase }
  | { kind: 'TurnStart' }
  | { kind: 'EndTurn' }
  | { kind: 'IncTriggerUsage'; key: string; per: 'TURN' | 'GAME' }
  | { kind: 'IncReplacementUsage'; key: string; per: 'TURN' | 'GAME' }
  | { kind: 'IncEvent'; event: 'UnitDied'|'TokenCreated'|'SpellCast'; who: PlayerIndex }
  | { kind: 'SpendAP'; pid: PlayerIndex; amount: number }
  | { kind: 'SpendColors'; pid: PlayerIndex; colors: Record<string, number> }
  | { kind: 'SetTurnEntered'; id: string; turn: number }
  | { kind: 'SetTapped'; id: string; tapped: boolean }
  | { kind: 'DamagePlayer'; pid: PlayerIndex; amount: number; sourceId?: string }
  | { kind: 'CheckPlayers' };

function planEffect(s: GameState, controller: PlayerIndex, sourceId: string | undefined, eff: Effect, chosenTargets?: string[]): Operation[] {
  switch (eff.kind) {
    case 'DealDamage': {
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect DealDamage fizzles (no legal targets).' }];
      const n = evalValue(s, controller, sourceId, targets[0], eff.amount);
      return [{ kind: 'DealDamageMany', targets, amount: n, sourceId }];
    }
    case 'PreventDamage': {
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect PreventDamage fizzles (no legal targets).' }];
      const n = evalValue(s, controller, sourceId, targets[0], eff.amount);
      return [{ kind: 'PreventDamageMany', targets, amount: n, duration: eff.duration === 'EOT' ? 'EOT' : 'PERM' }];
    }
    case 'Heal': {
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect Heal fizzles (no legal targets).' }];
      const n = evalValue(s, controller, sourceId, targets[0], eff.amount);
      return [{ kind: 'HealMany', targets, amount: n }];
    }
    case 'Draw': {
      const pid = eff.who === 'SELF' ? controller : (controller === 0 ? 1 : 0);
      const n = evalValue(s, controller, sourceId, undefined, eff.n);
      return [{ kind: 'Draw', pid, n }];
    }
    case 'Mill': {
      const pid = eff.who === 'SELF' ? controller : (controller === 0 ? 1 : 0);
      const n = evalValue(s, controller, sourceId, undefined, eff.n);
      return [{ kind: 'Mill', pid, n }];
    }
    case 'LookAtTop': {
      const pid = eff.who === 'SELF' ? controller : (controller === 0 ? 1 : 0);
      return [{ kind: 'LookAtTop', pid, n: eff.n, choose: eff.choose && eff.choose.moveRestTo !== 'STACK' ? { keep: eff.choose.keep, moveRestTo: eff.choose.moveRestTo as PlayerZone, reveal: eff.choose.reveal } : undefined }];
    }
    case 'CreateToken': {
      const pid = eff.who === 'SELF' ? controller : (controller === 0 ? 1 : 0);
      return [{ kind: 'CreateToken', pid, atk: eff.atk, hp: eff.hp, tags: eff.tags, attributes: eff.attributes }];
    }
    case 'AddCounter': {
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect AddCounter fizzles (no legal targets).' }];
      const n = Math.max(0, Math.floor(evalValue(s, controller, sourceId, targets[0], eff.n)));
      return [{ kind: 'AddCounterMany', targets, counter: eff.counter, n, max: eff.max }];
    }
    case 'RemoveCounter': {
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect RemoveCounter fizzles (no legal targets).' }];
      const n = Math.max(0, Math.floor(evalValue(s, controller, sourceId, targets[0], eff.n)));
      return [{ kind: 'RemoveCounterMany', targets, counter: eff.counter, n }];
    }
    case 'Buff': {
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect Buff fizzles (no legal targets).' }];
      return [{ kind: 'BuffMany', targets, atkDelta: eff.atk ?? 0, hpDelta: eff.hp ?? 0, duration: 'EOT' }];
    }
    case 'Move': {
      if (eff.to === 'STACK') return [{ kind: 'Log', msg: 'Move to STACK unsupported; NoOp.' }];
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect Move fizzles (no legal targets).' }];
      return [{ kind: 'MoveMany', targets, to: eff.to as PlayerZone }];
    }
    case 'ChangeController': {
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect ChangeController fizzles (no legal targets).' }];
      const newOwner = (eff.newController === 'SELF') ? controller : (controller === 0 ? 1 : 0);
      return [{ kind: 'ChangeControllerMany', targets, newOwner, duration: 'EOT' }];
    }
    case 'Transform': {
      const initial = chosenTargets && chosenTargets.length ? chosenTargets : selectTargets(s, controller, eff.target);
      const targets = initial.filter((id) => isLegalTarget(s, controller, eff.target, id, sourceId));
      if (targets.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'Effect Transform fizzles (no legal targets).' }];
      return [{ kind: 'TransformMany', targets, into: eff.into, duration: eff.duration === 'EOT' ? 'EOT' : 'PERM' }];
    }
    case 'CopyStats': {
      const fromIds = selectTargets(s, controller, eff.from);
      const srcId = fromIds.find((id) => isLegalTarget(s, controller, eff.from, id, sourceId));
      if (!srcId) return [{ kind: 'Log', msg: 'CopyStats: no valid source' }];
      const srcRc = s.cards.get(srcId);
      if (!srcRc || !srcRc.card.stats) return [{ kind: 'Log', msg: 'CopyStats: source lacks stats' }];
      const srcStats = getEffectiveBaseStats(s, srcRc);
      const srcAtk = srcStats.atk + (srcRc.bonusAtkPerm || 0) + (srcRc.bonusAtkEOT || 0);
      const srcHpMax = srcStats.hp + (srcRc.bonusHpPerm || 0) + (srcRc.bonusHpEOT || 0);
      const atkMin = eff.clamp.atk[0], atkMax = eff.clamp.atk[1];
      const hpMin = eff.clamp.hp[0], hpMax = eff.clamp.hp[1];
      const toAtk = Math.max(atkMin, Math.min(atkMax, srcAtk));
      const toHp = Math.max(hpMin, Math.min(hpMax, srcHpMax));
      const toIds = selectTargets(s, controller, eff.to).filter((id) => isLegalTarget(s, controller, eff.to, id, sourceId));
      if (toIds.length === 0 && s.rules.actions.illegalTargetFizzle) return [{ kind: 'Log', msg: 'CopyStats fizzles (no legal targets).' }];
      return [{ kind: 'CopyStatsToMany', targets: toIds, toAtk, toHp, duration: eff.duration }];
    }
    case 'Conditional': {
      const cond = matchesPredicate(s, controller, sourceId, sourceId || '', eff.if);
      const inner = cond ? eff.then : eff.else;
      if (!inner) return [];
      return planEffect(s, controller, sourceId, inner, chosenTargets);
    }
    case 'Case': {
      for (const br of eff.branches) {
        if (matchesPredicate(s, controller, sourceId, sourceId || '', br.when)) {
          return planEffect(s, controller, sourceId, br.do, chosenTargets);
        }
      }
      return eff.else ? planEffect(s, controller, sourceId, eff.else, chosenTargets) : [];
    }
    case 'ForEach': {
      const among = selectTargets(s, controller, eff.among).slice(0, eff.maxTargets);
      const ops: Operation[] = [];
      for (const tid of among) ops.push(...planEffect(s, controller, tid, eff.body, [tid]));
      return ops;
    }
    case 'Sequence': {
      const ops: Operation[] = [];
      for (const step of eff.steps) ops.push(...planEffect(s, controller, sourceId, step, chosenTargets));
      return ops;
    }
    case 'Repeat': {
      const ops: Operation[] = [];
      for (let i = 0; i < eff.times; i++) ops.push(...planEffect(s, controller, sourceId, eff.body, chosenTargets));
      return ops;
    }
    case 'NoOp': return [];
    default: return exhaustive(eff);
  }
}

function applyOperation(s: GameState, op: Operation) {
  switch (op.kind) {
    case 'Log': { pushLog(s, op.msg); return; }
    case 'FireTriggers': { for (const o of planTriggers(s, op.when, op.ctx)) applyOperation(s, o); return; }
    case 'ResolveEffectOp': { const ops = planEffect(s, op.controller, op.sourceId, op.effect, op.targets); for (const o of ops) applyOperation(s, o); return; }
    case 'SetPhase': { s.turn.phase = op.phase; pushLog(s, `Phase -> ${op.phase}`); return; }
    case 'DealDamageMany': {
      for (const id of op.targets) dealDamageToPermanent(s, id, op.amount, op.sourceId);
      return;
    }
    case 'PreventDamageMany': {
      for (const id of op.targets) {
        if (op.duration === 'EOT') s.preventEOT.set(id, (s.preventEOT.get(id) || 0) + op.amount);
        else s.preventPERM.set(id, (s.preventPERM.get(id) || 0) + op.amount);
      }
      pushLog(s, `Prevent up to ${op.amount} damage ${op.duration === 'EOT' ? 'until EOT' : 'permanently'} to ${op.targets.length} target(s).`);
      return;
    }
    case 'HealMany': {
      for (const id of op.targets) healPermanent(s, id, op.amount);
      return;
    }
    case 'Draw': { topDraw(s, op.pid, op.n); return; }
    case 'Mill': {
      const p = s.players[op.pid];
      let moved = 0;
      for (let i = 0; i < op.n && p.library.length > 0; i++) {
        const id = p.library.pop()!;
        moveCard(s, id, 'GY');
        moved++;
      }
      pushLog(s, `${s.players[op.pid].name} mills ${moved} card(s).`);
      return;
    }
    case 'LookAtTop': {
      const p = s.players[op.pid];
      const n = Math.max(0, Math.min(op.n, p.library.length));
      if (n === 0) { pushLog(s, `${s.players[op.pid].name} looks at top: empty.`); return; }
      const topN = p.library.slice(-n);
      if (!op.choose) {
        const names = topN.map((id) => s.cards.get(id)?.card.name || '???');
        pushLog(s, `${s.players[op.pid].name} looks at top ${n}: ${names.join(', ')}`);
        return;
      }
      const keep = Math.max(0, Math.min(op.choose.keep, n));
      const rest = topN.slice(0, n - keep);
      if (op.choose.reveal) {
        const names = rest.map((id) => s.cards.get(id)?.card.name || '???');
        pushLog(s, `${s.players[op.pid].name} reveals moving: ${names.join(', ')}`);
      }
      for (const id of rest) {
        const idx = p.library.indexOf(id);
        if (idx >= 0) p.library.splice(idx, 1);
        moveCard(s, id, op.choose.moveRestTo);
      }
      return;
    }
    case 'CreateToken': {
      const pid = op.pid;
      const name = `Token ${op.atk}/${op.hp}`;
      const tokenCard: Card = {
        name,
        canonicalName: undefined,
        cost: { generic: 0 },
        type: 'Unit',
        stats: { atk: op.atk, hp: op.hp },
        keywords: [],
        tags: op.tags ? [...op.tags] : [],
        attributes: op.attributes ? { ...op.attributes } : undefined,
        textIR: {},
        budgets: { power: 0, complexity: 0, interaction: 0 },
        rarity: 'C',
        version: 1,
      };
      const id = makeId();
      const rc: RuntimeCard = { id, owner: pid as PlayerIndex, card: tokenCard, zone: 'BF', damage: 0, isToken: true, turnEntered: s.turn.number };
      s.cards.set(id, rc);
      s.players[pid as PlayerIndex].battlefield.push(id);
      pushLog(s, `${s.players[pid as PlayerIndex].name} creates a token ${name}.`);
      incEvent(s, 'TokenCreated', pid as PlayerIndex);
      fireTriggers(s, 'OnTokenCreated', { subjectId: id });
      fireTriggers(s, 'OnEnter', { subjectId: id });
      fireTriggers(s, 'OnNameMatched', { subjectId: id });
      return;
    }
    case 'AddCounterMany': {
      for (const id of op.targets) {
        const rc = s.cards.get(id);
        if (!rc) continue;
        rc.counters = rc.counters || {};
        const cur = rc.counters[op.counter] || 0;
        const next = op.max != null ? Math.min(op.max, cur + op.n) : cur + op.n;
        rc.counters[op.counter] = next;
      }
      return;
    }
    case 'RemoveCounterMany': {
      for (const id of op.targets) {
        const rc = s.cards.get(id);
        if (!rc || !rc.counters) continue;
        const cur = rc.counters[op.counter] || 0;
        rc.counters[op.counter] = Math.max(0, cur - op.n);
      }
      return;
    }
    case 'BuffMany': {
      for (const id of op.targets) {
        const rc = s.cards.get(id);
        if (!rc || !rc.card.stats) continue;
        if (op.duration === 'EOT') {
          rc.bonusAtkEOT = (rc.bonusAtkEOT || 0) + op.atkDelta;
          rc.bonusHpEOT = (rc.bonusHpEOT || 0) + op.hpDelta;
        } else {
          rc.bonusAtkPerm = (rc.bonusAtkPerm || 0) + op.atkDelta;
          rc.bonusHpPerm = (rc.bonusHpPerm || 0) + op.hpDelta;
        }
        checkLethalAfterStatChange(s, id);
      }
      return;
    }
    case 'MoveMany': { for (const id of op.targets) moveCard(s, id, op.to); return; }
    case 'ChangeControllerMany': {
      for (const id of op.targets) {
        const rc = s.cards.get(id);
        if (!rc) continue;
        if (op.duration === 'EOT') {
          if (!s.controlRevertEOT.has(id)) s.controlRevertEOT.set(id, rc.owner);
        }
        transferControl(s, id, op.newOwner);
      }
      return;
    }
    case 'TransformMany': {
      for (const id of op.targets) {
        const rc = s.cards.get(id);
        if (!rc || !rc.card.stats) continue;
        if (op.duration === 'EOT') rc.transformEOT = { atk: op.into.atk, hp: op.into.hp };
        else rc.transformPerm = { atk: op.into.atk, hp: op.into.hp };
        checkLethalAfterStatChange(s, id);
      }
      return;
    }
    case 'CopyStatsToMany': {
      for (const id of op.targets) {
        const rc = s.cards.get(id);
        if (!rc || !rc.card.stats) continue;
        if (op.duration === 'EOT') rc.transformEOT = { atk: op.toAtk, hp: op.toHp };
        else rc.transformPerm = { atk: op.toAtk, hp: op.toHp };
        checkLethalAfterStatChange(s, id);
      }
      return;
    }
    case 'TurnStart': {
      const p = s.players[s.turn.active];
      s.turn.phase = 'UPKEEP';
      pushLog(s, `-- Turn ${s.turn.number} start: ${p.name} --`);
      // Untap all permanents of the active player at the start of their turn
      for (const id of p.battlefield) {
        const rc = s.cards.get(id);
        if (rc) rc.tapped = false;
      }
      // reset per-turn counters
      s.eventsTurn.clear();
      s.triggerUseTurn.clear();
      s.replUseTurn.clear();
      // Triggers: upkeep start
      fireTriggers(s, 'OnUpkeepStart', { forPlayer: p.idx });
      // resources
      if (s.rules.resources.mode === 'ActionPoints') {
        if (s.rules.resources.carryOver) {
          p.ap += s.rules.resources.perTurnGainBase;
        } else {
          p.ap = s.rules.resources.perTurnGainBase;
        }
        const max = s.rules.resources.maxPool;
        if (typeof max === 'number') {
          p.ap = Math.min(p.ap, max);
        }
      }
      // draw
      if (s.rules.turns.drawOnTurnStart) topDraw(s, p.idx, 1);
      return;
    }
    case 'EndTurn': {
      // end step cleanup
      for (const pid of [0,1] as const) {
        const p = s.players[pid];
        // hand size limit
        const max = s.rules.build.maxHandSize;
        if (max != null && p.hand.length > max) {
          const extra = p.hand.length - max;
          for (let i = 0; i < extra; i++) {
            const id = p.hand.shift()!;
            moveCard(s, id, 'GY');
            pushLog(s, `${p.name} discards down to max hand.`);
          }
        }
        // Damage clears at end of turn if rule says so
        if (s.rules.damage.damagePersistsTurn) {
          for (const id of p.battlefield) {
            const rc = s.cards.get(id)!; rc.damage = 0;
          }
        }
        // Clear EOT stat buffs/transforms
        for (const id of p.battlefield) {
          const rc = s.cards.get(id)!;
          rc.bonusAtkEOT = 0;
          rc.bonusHpEOT = 0;
          rc.transformEOT = undefined;
        }
      }
      // Clear EOT prevent pools
      s.preventEOT.clear();
      // Revert EOT control changes
      for (const [id, prevOwner] of Array.from(s.controlRevertEOT.entries())) {
        const rc = s.cards.get(id);
        if (rc) transferControl(s, id, prevOwner);
      }
      s.controlRevertEOT.clear();

      // next turn
      s.turn.active = s.turn.active === 0 ? 1 : 0;
      s.turn.number += 1;
      s.turn.phase = 'UPKEEP';
      return;
    }
    case 'IncTriggerUsage': {
      if (op.per === 'TURN') s.triggerUseTurn.set(op.key, (s.triggerUseTurn.get(op.key) || 0) + 1);
      else s.triggerUseGame.set(op.key, (s.triggerUseGame.get(op.key) || 0) + 1);
      return;
    }
    case 'IncReplacementUsage': {
      if (op.per === 'TURN') s.replUseTurn.set(op.key, (s.replUseTurn.get(op.key) || 0) + 1);
      else s.replUseGame.set(op.key, (s.replUseGame.get(op.key) || 0) + 1);
      return;
    }
    case 'IncEvent': { incEvent(s, op.event, op.who); return; }
    case 'SpendAP': { s.players[op.pid].ap -= op.amount; if (s.players[op.pid].ap < 0) s.players[op.pid].ap = 0; return; }
    case 'SpendColors': {
      const pool = (s.players[op.pid].colorPool = s.players[op.pid].colorPool || {});
      for (const [c, n] of Object.entries(op.colors)) {
        pool[c] = Math.max(0, (pool[c] || 0) - n);
      }
      return;
    }
    case 'SetTurnEntered': { const rc = s.cards.get(op.id); if (rc) rc.turnEntered = op.turn; return; }
    case 'SetTapped': { const rc = s.cards.get(op.id); if (rc) rc.tapped = op.tapped; return; }
    case 'DamagePlayer': {
      const opp = s.players[op.pid];
      opp.life -= op.amount;
      pushLog(s, `${opp.name} takes ${op.amount} damage. (life ${opp.life})`);
      // Lifelink: if source has lifelink, its controller gains life equal to damage dealt
      if (op.sourceId) {
        const src = s.cards.get(op.sourceId);
        if (src && src.card.keywords?.includes('Lifelink')) {
          const ctrl = s.players[src.owner];
          ctrl.life += op.amount;
          pushLog(s, `${ctrl.name} gains ${op.amount} life (Lifelink). (life ${ctrl.life})`);
        }
      }
      // Triggers
      fireTriggers(s, 'OnDamageDealt', { subjectPlayer: op.pid, sourceId: op.sourceId });
      checkPlayerDeath(s);
      return;
    }
    case 'CheckPlayers': { checkPlayerDeath(s); return; }
    default: return exhaustive(op as never);
  }
}

function getEffectiveBaseStats(s: GameState, rc: RuntimeCard): { atk: number; hp: number } {
  const baseAtk = rc.card.stats?.atk ?? 0;
  const baseHp = rc.card.stats?.hp ?? 0;
  const perm = rc.transformPerm ?? null;
  const eot = rc.transformEOT ?? null;
  const core = eot ? { atk: eot.atk, hp: eot.hp } : (perm ? { atk: perm.atk, hp: perm.hp } : { atk: baseAtk, hp: baseHp });
  // Apply continuous StaticBuffs
  const buff = getStaticBuffBonus(s, rc.id);
  return { atk: core.atk + buff.atk, hp: core.hp + buff.hp };
}

function matchesPredicate(s: GameState, controller: PlayerIndex, selfId: string | undefined, targetId: string, pred?: Predicate): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case 'True': return true;
    case 'HasTag': {
      const subjId = (pred.in === 'Self') ? selfId : targetId;
      const rc = subjId ? s.cards.get(subjId) : undefined;
      return !!rc && rc.card.tags.includes(pred.tag);
    }
    case 'HasAttribute': {
      const subjId = (pred.in === 'Self') ? selfId : targetId;
      const rc = subjId ? s.cards.get(subjId) : undefined;
      return !!rc && rc.card.attributes?.[pred.attr] === pred.value;
    }
    case 'HasName': {
      const subjId = (pred.in === 'Self') ? selfId : targetId;
      const rc = subjId ? s.cards.get(subjId) : undefined;
      if (!rc) return false;
      const name = rc.card.name;
      const txt = pred.name.text;
      switch (pred.name.mode) {
        case 'Exact': return name === txt;
        case 'Prefix': return name.startsWith(txt);
        case 'Contains': return name.includes(txt);
        default: return exhaustive(pred.name.mode);
      }
    }
    case 'IsToken': {
      const subjId = (pred.in === 'Self') ? selfId : targetId;
      const rc = subjId ? s.cards.get(subjId) : undefined;
      return !!rc?.isToken;
    }
    case 'WasSummonedThisTurn': {
      const subjId = (pred.in === 'Self') ? selfId : targetId;
      const rc = subjId ? s.cards.get(subjId) : undefined;
      return !!rc && rc.turnEntered === s.turn.number;
    }
    case 'HasCounter': {
      const subjId = (pred.in === 'Self') ? selfId : targetId;
      const rc = subjId ? s.cards.get(subjId) : undefined;
      if (!rc) return false;
      const cur = rc.counters?.[pred.counter] || 0;
      return cur >= pred.atLeast;
    }
    case 'ControllerIs': {
      const subjId = (pred.in === 'Self') ? selfId : targetId;
      const rc = subjId ? s.cards.get(subjId) : undefined;
      const who = pred.who === 'SELF' ? controller : (controller === 0 ? 1 : 0);
      return !!rc && rc.owner === who;
    }
    case 'EventOccurred': {
      // Map schema events to our counters
      const whoPid = pred.who == null ? controller : (pred.who === 'SELF' ? controller : (controller === 0 ? 1 : 0));
      const key = `${pred.event}:${whoPid}`;
      const turnCount = s.eventsTurn.get(key) || 0;
      const gameCount = s.eventsGame.get(key) || 0;
      const count = pred.since === 'TURN' ? turnCount : gameCount;
      return count >= pred.atLeast;
    }
    case 'Cmp': {
      const l = evalMetric(s, controller, selfId, targetId, pred.left);
      const r = evalMetric(s, controller, selfId, targetId, pred.right);
      switch (pred.op) {
        case '>=': return l >= r;
        case '>': return l > r;
        case '<=': return l <= r;
        case '<': return l < r;
        case '==': return l === r;
        case '!=': return l !== r;
        default: return exhaustive(pred.op);
      }
    }
    case 'And': return pred.items.every((p: Predicate) => matchesPredicate(s, controller, selfId, targetId, p));
    case 'Or': return pred.items.some((p: Predicate) => matchesPredicate(s, controller, selfId, targetId, p));
    case 'Not': return !matchesPredicate(s, controller, selfId, targetId, pred.item);
    default: return exhaustive(pred);
  }
}

function selectTargets(s: GameState, controller: PlayerIndex, sel: Selector): string[] {
  // default zone for selectors is BF
  const ownerIdx = sel.owner == null ? undefined : (sel.owner === 'SELF' ? controller : (controller === 0 ? 1 : 0));
  const z = sel.zone;
  if (z === 'STACK') {
    // Targeting the stack is not supported in this minimal engine
    pushLog(s, 'Selector with zone=STACK unsupported; ignoring.');
    return [];
  }
  const zones: readonly PlayerZone[] = z ? [z] : ['BF'];
  const pool: string[] = [];
  for (const zone of zones) {
    for (const p of [s.players[controller], s.players[controller === 0 ? 1 : 0]] as const) {
      if (ownerIdx != null && p.idx !== ownerIdx) continue;
      const arr = getZoneArray(p, zone);
      for (const id of arr) {
        if (sel.filter && !matchesPredicate(s, controller, undefined, id, sel.filter)) continue;
        pool.push(id);
      }
    }
  }
  const max = sel.max ?? pool.length;
  return pool.slice(0, max);
}

// ---------------- Effect execution (subset) ----------------
export function resolveEffect(s: GameState, controller: PlayerIndex, sourceId: string | undefined, eff: Effect, chosenTargets?: string[]): void {
  const ops = planEffect(s, controller, sourceId, eff, chosenTargets);
  for (const op of ops) applyOperation(s, op);
}

function dealDamageToPermanent(s: GameState, id: string, n: number, sourceId?: string) {
  const rc = s.cards.get(id); if (!rc) return;
  if (!rc.card.stats) return; // not a Unit
  // Replacement: WouldBeDamaged
  if (applyReplacement(s, 'WouldBeDamaged', id)) {
    return; // replaced fully
  }
  // Apply prevention (PERM first, then EOT)
  let dmg = n;
  const usePerm = Math.min(dmg, s.preventPERM.get(id) || 0);
  if (usePerm > 0) {
    s.preventPERM.set(id, (s.preventPERM.get(id) || 0) - usePerm);
    dmg -= usePerm;
  }
  const useEOT = Math.min(dmg, s.preventEOT.get(id) || 0);
  if (useEOT > 0) {
    s.preventEOT.set(id, (s.preventEOT.get(id) || 0) - useEOT);
    dmg -= useEOT;
  }
  if (dmg <= 0) {
    pushLog(s, `${rc.card.name} damage prevented (${n}).`);
    return;
  }
  rc.damage += dmg;
  const stats = getEffectiveBaseStats(s, rc);
  const hpMax = stats.hp + (rc.bonusHpPerm || 0) + (rc.bonusHpEOT || 0);
  pushLog(s, `${rc.card.name} takes ${n} damage (HP ${Math.max(0, hpMax - rc.damage)}).`);
  // Lifelink to controller of source (if any)
  if (sourceId) {
    const src = s.cards.get(sourceId);
    if (src && src.card.keywords?.includes('Lifelink')) {
      const ctrl = s.players[src.owner];
      ctrl.life += dmg;
      pushLog(s, `${ctrl.name} gains ${dmg} life (Lifelink). (life ${ctrl.life})`);
    }
  }
  // Deathtouch: any damage from a source with Deathtouch destroys the unit (unless indestructible)
  if (sourceId) {
    const src = s.cards.get(sourceId);
    const targetIndestructible = !!rc.card.keywords?.includes('Indestructible');
    if (src && src.card.keywords?.includes('Deathtouch') && !targetIndestructible) {
      destroyPermanent(s, id);
      return;
    }
  }
  // Triggers: damage dealt
  fireTriggers(s, 'OnDamageDealt', { subjectId: id, sourceId });
  // lethal check
  if ((hpMax - rc.damage) <= s.rules.damage.lethalAt) {
    // Indestructible survives lethal damage
    if (rc.card.keywords?.includes('Indestructible')) {
      pushLog(s, `${rc.card.name} is indestructible and survives lethal damage.`);
    } else {
      destroyPermanent(s, id);
    }
  }
}

function healPermanent(s: GameState, id: string, n: number) {
  const rc = s.cards.get(id); if (!rc) return;
  if (!rc.card.stats) return;
  rc.damage = Math.max(0, rc.damage - n);
  pushLog(s, `${rc.card.name} heals ${n} (damage now ${rc.damage}).`);
}

function destroyPermanent(s: GameState, id: string) {
  const rc = s.cards.get(id); if (!rc) return;
  if (rc.zone !== 'BF') return;
  // Replacement: WouldDie
  if (applyReplacement(s, 'WouldDie', id)) {
    return; // death prevented/changed
  }
  const owner = s.players[rc.owner];
  pushLog(s, `${rc.card.name} dies.`);
  // Event counters + triggers
  incEvent(s, 'UnitDied', rc.owner);
  fireTriggers(s, 'OnDeath', { subjectId: id });
  const leaveTo: PlayerZone = rc.isToken ? s.rules.tokens.tokensLeaveTo : 'GY';
  moveCard(s, id, leaveTo);
}

function checkLethalAfterStatChange(s: GameState, id: string) {
  const rc = s.cards.get(id); if (!rc || !rc.card.stats) return;
  const stats = getEffectiveBaseStats(s, rc);
  const hpMax = stats.hp + (rc.bonusHpPerm || 0) + (rc.bonusHpEOT || 0);
  if ((hpMax - rc.damage) <= s.rules.damage.lethalAt) {
    if (rc.card.keywords?.includes('Indestructible')) {
      pushLog(s, `${rc.card.name} is indestructible and survives lethal change.`);
    } else {
      destroyPermanent(s, id);
    }
  }
}

function checkPlayerDeath(s: GameState) {
  if (!s.rules.win.lifeZeroLoss) return;
  for (const p of s.players) {
    if (p.life <= 0) {
      s.winner = (p.idx === 0 ? 1 : 0);
      pushLog(s, `${p.name} has 0 or less life and loses.`);
    }
  }
}

// ---------------- Turn/Phase flow ----------------
export function startTurn(s: GameState) {
  const ops: Operation[] = [{ kind: 'TurnStart' }];
  for (const op of ops) applyOperation(s, op);
}

export function advancePhase(s: GameState) {
  const phases = s.rules.turns.phases;
  const idx = phases.indexOf(s.turn.phase);
  if (idx < 0 || idx === phases.length - 1) return; // end handled by endTurn
  applyOperation(s, { kind: 'SetPhase', phase: phases[idx + 1] });
}

export function endTurn(s: GameState) {
  applyOperation(s, { kind: 'EndTurn' });
}

// ---------------- Actions ----------------
export function canCastFromHand(s: GameState, pid: PlayerIndex, handIndex: number): { ok: boolean; reason?: string } {
  const p = s.players[pid];
  // Only active player during MAIN phase may cast (per core rules)
  if (s.turn.active !== pid) return { ok: false, reason: 'Not your turn' };
  if (s.turn.phase !== 'MAIN') return { ok: false, reason: 'Can cast only in MAIN phase' };
  if (handIndex < 0 || handIndex >= p.hand.length) return { ok: false, reason: 'Invalid hand index' };
  const rc = s.cards.get(p.hand[handIndex])!;
  let cost = rc.card.cost.generic || 0;
  // Apply continuous cost modifiers
  cost = Math.max(0, applyCostModifiers(s, pid, rc.id, cost));
  if (p.ap < cost) return { ok: false, reason: 'Not enough AP' };
  // Color payment (optional)
  const colorCheck = canPayColoredCost(s, pid, rc.card.cost.colors || []);
  if (!colorCheck.ok) return colorCheck;
  return { ok: true };
}

export function castFromHand(s: GameState, pid: PlayerIndex, handIndex: number, chosenTargets?: string[]): { ok: boolean; reason?: string } {
  const p = s.players[pid];
  if (handIndex < 0 || handIndex >= p.hand.length) return { ok: false, reason: 'Invalid hand index' };
  const id = p.hand[handIndex];
  const rc = s.cards.get(id)!;
  let cost = rc.card.cost.generic || 0;
  cost = Math.max(0, applyCostModifiers(s, pid, id, cost));
  if (p.ap < cost) return { ok: false, reason: 'Not enough AP' };
  const colorCheck = canPayColoredCost(s, pid, rc.card.cost.colors || []);
  if (!colorCheck.ok) return colorCheck;
  // Plan operations for cast
  const newAp = p.ap - cost;
  const ops: Operation[] = [];
  ops.push({ kind: 'SpendAP', pid, amount: cost });
  if (Object.keys(colorCheck.toSpend || {}).length > 0) {
    ops.push({ kind: 'SpendColors', pid, colors: colorCheck.toSpend! });
  }
  ops.push({ kind: 'Log', msg: `${p.name} casts ${rc.card.name} (cost ${cost}, AP ${newAp}).` });
  ops.push({ kind: 'IncEvent', event: 'SpellCast', who: pid });
  ops.push({ kind: 'FireTriggers', when: 'OnCast', ctx: { subjectId: id } });
  ops.push({ kind: 'FireTriggers', when: 'OnNameMatched', ctx: { subjectId: id } });

  if (rc.card.type === 'Unit' || rc.card.type === 'Artifact' || rc.card.type === 'Enchantment') {
    ops.push({ kind: 'MoveMany', targets: [id], to: 'BF' });
    ops.push({ kind: 'SetTurnEntered', id, turn: s.turn.number });
  } else {
    if (rc.card.textIR?.cast) ops.push({ kind: 'ResolveEffectOp', controller: pid, sourceId: id, effect: rc.card.textIR.cast, targets: chosenTargets });
    ops.push({ kind: 'MoveMany', targets: [id], to: 'GY' });
  }
  ops.push({ kind: 'CheckPlayers' });
  for (const op of ops) applyOperation(s, op);
  return { ok: true };
}

export function listBattlefield(s: GameState, pid: PlayerIndex): RuntimeCard[] {
  const p = s.players[pid];
  return p.battlefield.map(id => s.cards.get(id)!).filter(Boolean);
}

export function canAttack(s: GameState, pid: PlayerIndex, bfIndex: number): { ok: boolean; reason?: string } {
  const units = listBattlefield(s, pid);
  if (bfIndex < 0 || bfIndex >= units.length) return { ok: false, reason: 'Invalid unit index' };
  const rc = units[bfIndex];
  if (!rc.card.stats) return { ok: false, reason: 'Not a unit' };
  if (rc.tapped) return { ok: false, reason: 'Tapped' };
  const hasHaste = !!rc.card.keywords?.includes('Haste');
  const isSummoningSick = s.rules.combat.summoningSickness && rc.turnEntered === s.turn.number && !hasHaste;
  if (isSummoningSick) return { ok: false, reason: 'Summoning sickness' };
  if (rc.card.keywords?.includes('Defender')) return { ok: false, reason: 'Defender (can\'t attack)' };
  return { ok: true };
}

export function attack(s: GameState, pid: PlayerIndex, bfIndex: number, target: { kind: 'Player' } | { kind: 'Unit', index: number }): { ok: boolean; reason?: string } {
  // Only active player and during COMBAT
  if (s.turn.active !== pid) return { ok: false, reason: 'Not your turn' };
  if (s.turn.phase !== 'COMBAT') return { ok: false, reason: 'Attacks only in COMBAT phase' };
  const can = canAttack(s, pid, bfIndex); if (!can.ok) return can;
  const attacker = listBattlefield(s, pid)[bfIndex];
  const oppId = pid === 0 ? 1 : 0;
  // Enforce attacker target policy
  if (s.rules.combat.attackerTargets === 'PlayerOnly' && target.kind !== 'Player') return { ok: false, reason: 'Must attack player' };
  if (s.rules.combat.attackerTargets === 'UnitOnly' && target.kind !== 'Unit') return { ok: false, reason: 'Must attack unit' };
  const ops: Operation[] = [];
  // Tap to attack unless Vigilance
  const vigilant = !!attacker.card.keywords?.includes('Vigilance');
  if (!vigilant) ops.push({ kind: 'SetTapped', id: attacker.id, tapped: true });
  ops.push({ kind: 'FireTriggers', when: 'OnAttack', ctx: { subjectId: attacker.id } });
  const aStats = getEffectiveBaseStats(s, attacker);
  const dmg = aStats.atk + (attacker.bonusAtkPerm || 0) + (attacker.bonusAtkEOT || 0);
  if (target.kind === 'Player') {
    // Replacement for players not supported; direct damage
    // Keep previous user-friendly log format
    ops.push({ kind: 'Log', msg: `${s.players[pid].name}'s ${attacker.card.name} hits ${s.players[oppId].name} for ${dmg}. (life ${s.players[oppId].life - dmg})` });
    ops.push({ kind: 'DamagePlayer', pid: oppId, amount: dmg, sourceId: attacker.id });
  } else {
    const oppUnits = listBattlefield(s, oppId);
    if (target.index < 0 || target.index >= oppUnits.length) return { ok: false, reason: 'Invalid target unit' };
    const defender = oppUnits[target.index];
    ops.push({ kind: 'DealDamageMany', targets: [defender.id], amount: dmg, sourceId: attacker.id });
  }
  for (const op of ops) applyOperation(s, op);
  return { ok: true };
}

export function gameOver(s: GameState): boolean { return s.winner != null; }

export function currentPlayer(s: GameState): PlayerState { return s.players[s.turn.active]; }
export function opponentOf(s: GameState, pid: PlayerIndex): PlayerState { return s.players[pid === 0 ? 1 : 0]; }

export function snapshotPublic(s: GameState) {
  // utility for CLI
  const toName = (id: string) => s.cards.get(id)!.card.name;
  return {
    turn: s.turn,
    p0: { name: s.players[0].name, life: s.players[0].life, ap: s.players[0].ap, hand: s.players[0].hand.map(toName), bf: s.players[0].battlefield.map(toName) },
    p1: { name: s.players[1].name, life: s.players[1].life, ap: s.players[1].ap, hand: s.players[1].hand.map(toName), bf: s.players[1].battlefield.map(toName) },
    log: s.log.slice(-10),
  };
}

// Simple mulligan (London with fixed bottomCount): optional helper
export function mulliganLondon(s: GameState, pid: PlayerIndex): { ok: boolean; reason?: string } {
  const rules = s.rules;
  if (rules.mulligan.kind !== 'London') return { ok: false, reason: 'Mulligan rule is not London' };
  const p = s.players[pid];
  // Put hand back, shuffle, draw same, then bottom N
  while (p.hand.length) p.library.push(p.hand.pop()!);
  shuffle(p.library, Math.random);
  topDraw(s, pid, rules.build.startingHand);
  // bottom fixed count
  const bottom = Math.min(rules.mulligan.bottomCount, p.hand.length);
  for (let i = 0; i < bottom; i++) {
    const id = p.hand.pop()!;
    // bottom of library = front of array
    p.library.unshift(id);
    s.cards.get(id)!.zone = 'LIB';
  }
  p.mulligansTaken += 1;
  pushLog(s, `${p.name} mulligans and bottoms ${bottom}.`);
  return { ok: true };
}

// ---------------- Triggers / Replacements / Continuous helpers ----------------

function incEvent(s: GameState, event: 'UnitDied'|'TokenCreated'|'SpellCast', who: PlayerIndex) {
  const key = `${event}:${who}`;
  s.eventsTurn.set(key, (s.eventsTurn.get(key) || 0) + 1);
  s.eventsGame.set(key, (s.eventsGame.get(key) || 0) + 1);
}

function planTriggers(
  s: GameState,
  when: TriggerWhen,
  ctx: { subjectId?: string; subjectPlayer?: PlayerIndex; sourceId?: string; forPlayer?: PlayerIndex }
): Operation[] {
  const ops: Operation[] = [];
  for (const rc of s.cards.values()) {
    const trigs = rc.card.textIR?.triggers || [];
    for (let i = 0; i < trigs.length; i++) {
      const t = trigs[i];
      if (t.when !== when) continue;
      const key = `${rc.id}#${i}`;
      const used = (t.limit.per === 'TURN' ? s.triggerUseTurn : s.triggerUseGame).get(key) || 0;
      if (used >= t.limit.times) continue;
      if (!(rc.zone === 'BF' || rc.id === ctx.subjectId)) continue;
      const condOk = t.condition ? matchesPredicate(s, rc.owner, rc.id, ctx.subjectId || ctx.sourceId || rc.id, t.condition) : true;
      if (!condOk) continue;
      ops.push({ kind: 'IncTriggerUsage', key, per: t.limit.per });
      const effOps = planEffect(s, rc.owner, rc.id, t.effect, ctx.subjectId ? [ctx.subjectId] : undefined);
      ops.push(...effOps);
    }
  }
  return ops;
}

function fireTriggers(
  s: GameState,
  when: TriggerWhen,
  ctx: { subjectId?: string; subjectPlayer?: PlayerIndex; sourceId?: string; forPlayer?: PlayerIndex }
) {
  const ops = planTriggers(s, when, ctx);
  for (const op of ops) applyOperation(s, op);
}

function listActiveReplacements(s: GameState): { host: RuntimeCard; repl: ReplacementEffect; index: number }[] {
  const out: { host: RuntimeCard; repl: ReplacementEffect; index: number }[] = [];
  for (const rc of s.cards.values()) {
    if (rc.zone !== 'BF') continue;
    const reps = rc.card.textIR?.replacements || [];
    for (let i = 0; i < reps.length; i++) out.push({ host: rc, repl: reps[i], index: i });
  }
  return out;
}

function planReplacementForSubject(
  s: GameState,
  when: ReplacementEffect['when'],
  subjectId: string,
): Operation[] {
  const candidates = listActiveReplacements(s).filter(({ repl }) => repl.when === when);
  for (const { host, repl, index } of candidates) {
    const key = `${host.id}#${index}`;
    const used = (repl.limit.per === 'TURN' ? s.replUseTurn : s.replUseGame).get(key) || 0;
    if (used >= repl.limit.times) continue;
    const ok = isLegalTarget(s, host.owner, repl.subject, subjectId, host.id);
    if (!ok) continue;
    const ops: Operation[] = [
      { kind: 'Log', msg: `Replacement (${repl.when}) from ${host.card.name} applies.` },
      { kind: 'IncReplacementUsage', key, per: repl.limit.per },
    ];
    const effOps = planEffect(s, host.owner, host.id, repl.instead, [subjectId]);
    ops.push(...effOps);
    return ops; // apply first matching replacement
  }
  return [];
}

function applyReplacement(
  s: GameState,
  when: ReplacementEffect['when'],
  subjectId: string,
): boolean {
  const ops = planReplacementForSubject(s, when, subjectId);
  if (ops.length === 0) return false;
  for (const op of ops) applyOperation(s, op);
  return true;
}

function applyWouldDrawReplacement(s: GameState, who: PlayerIndex): boolean {
  const ops = planWouldDrawReplacement(s, who);
  if (ops.length === 0) return false;
  for (const op of ops) applyOperation(s, op);
  return true;
}

function planWouldDrawReplacement(s: GameState, who: PlayerIndex): Operation[] {
  for (const { host, repl, index } of listActiveReplacements(s)) {
    if (repl.when !== 'WouldDraw') continue;
    const targetPid = repl.subject.owner == null
      ? host.owner
      : (repl.subject.owner === 'SELF' ? host.owner : (host.owner === 0 ? 1 : 0));
    if (targetPid !== who) continue;
    const key = `${host.id}#${index}`;
    const used = (repl.limit.per === 'TURN' ? s.replUseTurn : s.replUseGame).get(key) || 0;
    if (used >= repl.limit.times) continue;
    const ops: Operation[] = [
      { kind: 'Log', msg: `Replacement (WouldDraw) from ${host.card.name} applies to player ${s.players[who].name}.` },
      { kind: 'IncReplacementUsage', key, per: repl.limit.per },
    ];
    ops.push(...planEffect(s, host.owner, host.id, repl.instead));
    return ops;
  }
  return [];
}

function listContinuousEffects(s: GameState): { host: RuntimeCard; eff: ContinuousEffect }[] {
  const out: { host: RuntimeCard; eff: ContinuousEffect }[] = [];
  for (const rc of s.cards.values()) {
    if (rc.zone !== 'BF') continue;
    for (const eff of rc.card.textIR?.continuous || []) out.push({ host: rc, eff });
  }
  return out;
}

function getStaticBuffBonus(s: GameState, targetId: string): { atk: number; hp: number } {
  let atk = 0, hp = 0;
  for (const { host, eff } of listContinuousEffects(s)) {
    switch (eff.kind) {
      case 'StaticBuff': {
        if (isLegalTarget(s, host.owner, eff.target, targetId, host.id)) {
          atk += eff.atk ?? 0;
          hp += eff.hp ?? 0;
        }
        break;
      }
      case 'CostModifier': break; // not a stat buff
      default: exhaustive(eff);
    }
  }
  return { atk, hp };
}

function applyCostModifiers(s: GameState, controller: PlayerIndex, cardId: string, baseCost: number): number {
  let cost = baseCost;
  for (const { host, eff } of listContinuousEffects(s)) {
    switch (eff.kind) {
      case 'CostModifier': {
        // Evaluate predicate against the target card
        if (matchesPredicate(s, host.owner, host.id, cardId, eff.predicate)) {
          cost = cost + eff.delta;
          if (eff.floor != null && cost < eff.floor) cost = eff.floor;
        }
        break;
      }
      case 'StaticBuff': break;
      default: exhaustive(eff);
    }
  }
  return cost;
}

// Colored cost payment (optional): when resources.payment is GenericAndColors and policy is InGamePayment,
// enforce that the player has sufficient colorPool to pay for cost.colors.
function tallyColors(colors: string[]): Record<string, number> {
  const need: Record<string, number> = {};
  for (const c of colors) need[c] = (need[c] || 0) + 1;
  return need;
}

function canPayColoredCost(
  s: GameState,
  pid: PlayerIndex,
  colors: string[],
): { ok: true; toSpend: Record<string, number> } | { ok: false; reason: string } {
  if (colors.length === 0) return { ok: true, toSpend: {} };
  const res = s.rules.resources;
  if (res.payment !== 'GenericAndColors') return { ok: true, toSpend: {} };
  if (res.colors.policy !== 'InGamePayment') {
    // Color membership only; do not enforce at runtime
    return { ok: true, toSpend: {} };
  }
  const need = tallyColors(colors);
  const pool = s.players[pid].colorPool || {};
  const lacking: string[] = [];
  for (const [c, n] of Object.entries(need)) {
    if ((pool[c] || 0) < n) lacking.push(`${c}x${n}`);
  }
  if (lacking.length > 0) return { ok: false, reason: `Not enough colors (${lacking.join(', ')})` };
  return { ok: true, toSpend: need };
}

function resolveStack(s: GameState) {
  while (s.stack.length) {
    const top = s.stack.pop()!;
    resolveEffect(s, top.controller, top.sourceId, top.effect, top.targets);
  }
}
