// Static analysis functions (per-card and global)
// Depends only on schema (no Node/AI SDK)

import {
  type Card,
  type EventKind,
  EventKind as EventKindObj,
  MAX_CASE_BRANCHES,
  MAX_FOREACH_TARGETS,
  MAX_LOOKTOP_N,
  MAX_REPEAT,
  MAX_SPAWN_CREDITS_PER_RESOLUTION,
  MAX_TRIGGER_CREDITS_PER_RESOLUTION,
} from './schema.ts';

// ----------------------------- Types -----------------------------
export type AnalysisIssue = { level: 'error' | 'warning'; code: string; message: string; path?: string[] };
export type AnalysisResult = { ok: boolean; issues: AnalysisIssue[]; computed?: { complexity: number; interaction: number; triggerCredits: number; spawnCredits: number } };

// Effect walker
function walkEffect(e: any, visit: (node: any) => void) {
  visit(e);
  switch (e?.kind) {
    case 'Conditional':
      walkEffect(e.then, visit);
      if (e.else) walkEffect(e.else, visit);
      break;
    case 'Case':
      e.branches.forEach((b: any) => walkEffect(b.do, visit));
      if (e.else) walkEffect(e.else, visit);
      break;
    case 'ForEach':
      walkEffect(e.body, visit);
      break;
    case 'Sequence':
      e.steps.forEach((s: any) => walkEffect(s, visit));
      break;
    case 'Repeat':
      walkEffect(e.body, visit);
      break;
  }
}

// Worst-case multiplicity calculator for emitted events and spawns
type EmitCount = Partial<Record<EventKind, number>>;
function multiply(a: number, b: number) { return Math.min(Number.MAX_SAFE_INTEGER, (a||1) * (b||1)); }

function effectMultiplicity(e: any, contextMult = 1): { emits: EmitCount; spawns: number } {
  let emits: EmitCount = {};
  let spawns = 0;

  const add = (k: EventKind, n: number) => { emits[k] = (emits[k] || 0) + n; };

  const recur = (node: any, mult: number) => {
    switch (node?.kind) {
      case 'CreateToken':
        spawns += mult; add(EventKindObj.OnTokenCreated, mult); add(EventKindObj.OnEnter, mult);
        break;
      case 'Move':
        if (node.to === 'BF') { spawns += mult; add(EventKindObj.OnEnter, mult); }
        break;
      case 'Draw':
        add(EventKindObj.OnDraw, mult);
        break;
      case 'DealDamage':
        add(EventKindObj.OnDamageDealt, mult);
        break;
      case 'Sequence':
        node.steps.forEach((s: any) => recur(s, mult));
        break;
      case 'Conditional':
        recur(node.then, mult); if (node.else) recur(node.else, mult);
        break;
      case 'Case':
        node.branches.forEach((b: any) => recur(b.do, mult)); if (node.else) recur(node.else, mult);
        break;
      case 'ForEach': {
        const t = Math.min(node.maxTargets ?? 1, MAX_FOREACH_TARGETS);
        recur(node.body, multiply(mult, t));
        break; }
      case 'Repeat': {
        const t = Math.min(node.times ?? 1, MAX_REPEAT);
        recur(node.body, multiply(mult, t));
        break; }
      default:
        break;
    }
  };

  recur(e, contextMult);
  return { emits, spawns };
}

export function analyzeCard(card: Card): AnalysisResult {
  const issues: AnalysisIssue[] = [];
  const err = (code: string, message: string, path?: string[]) => issues.push({ level: 'error', code, message, path });
  const warn = (code: string, message: string, path?: string[]) => issues.push({ level: 'warning', code, message, path });

  // 1) Basic logical constraints
  if (card.type === 'Unit' && !card.stats) err('UNIT_STATS_MISSING', 'Unit must have stats {atk,hp}', ['stats']);
  if (card.type !== 'Unit' && card.stats) warn('NON_UNIT_HAS_STATS', 'Non-Unit has stats; they will be ignored', ['stats']);

  // 2) Replacement safety rules (schema requires limit)
  (card.textIR.replacements || []).forEach((repl, idx) => {
    // Forbid WouldDie -> Move to GY
    walkEffect(repl.instead, (node) => {
      if (repl.when === 'WouldDie' && node?.kind === 'Move' && node.to === 'GY') {
        err('REPL_WOULD_DIE_TO_GY', 'WouldDie replacement cannot move directly to GY. Use EXILE/return pattern.', ['textIR','replacements',String(idx)]);
      }
      if (repl.when === 'WouldDraw' && node?.kind === 'Draw') {
        err('REPL_WOULD_DRAW_TO_DRAW', 'WouldDraw replacement cannot perform Draw (same-event reentry).', ['textIR','replacements',String(idx)]);
      }
    });
  });

  // 3) Effect audits + credits estimation
  const auditEffect = (e: any, path: string[]) => {
    walkEffect(e, (node) => {
      switch (node?.kind) {
        case 'LookAtTop':
          if (node.choose && node.choose.keep > node.n) {
            err('LOOKTOP_KEEP_GT_N', 'keep must be <= n', [...path,'LookAtTop']);
          }
          break;
        case 'ChangeController':
          if (!node.duration) err('CHANGE_CTRL_NO_DURATION', 'ChangeController requires duration', path);
          break;
        case 'CopyStats':
          if (!node.clamp) err('COPY_NO_CLAMP', 'CopyStats requires clamp', path);
          break;
        case 'ForEach':
          if (node.maxTargets > MAX_FOREACH_TARGETS) err('FOREACH_MAXTARGETS_EXCESS', `maxTargets must be <= ${MAX_FOREACH_TARGETS}`, path);
          if (node.among?.max && node.maxTargets > node.among.max) warn('FOREACH_TARGETS_GT_SELECTOR_MAX', 'maxTargets exceeds selector.max; some iterations may be skipped', path);
          break;
        case 'Repeat':
          if (node.times > MAX_REPEAT) err('REPEAT_TOO_LARGE', `Repeat.times must be <= ${MAX_REPEAT}`, path);
          break;
        case 'Case':
          if (node.branches?.length > MAX_CASE_BRANCHES) err('CASE_TOO_MANY', `Case.branches must be <= ${MAX_CASE_BRANCHES}`, path);
          break;
        case 'Transform':
          if (typeof node.into?.atk !== 'number' || typeof node.into?.hp !== 'number') {
            err('TRANSFORM_DYNAMIC', 'Transform.into must be a fixed stat block', path);
          }
          break;
      }
    });
  };

  if (card.textIR.cast) auditEffect(card.textIR.cast, ['textIR','cast']);
  (card.textIR.triggers || []).forEach((t, i) => auditEffect(t.effect, ['textIR','triggers', String(i)]));
  (card.textIR.replacements || []).forEach((r, i) => auditEffect(r.instead, ['textIR','replacements', String(i),'instead']));

  // Complexity & interaction (heuristic)
  const complexity = (() => {
    let c = 0;
    const bump = (k: string) => {
      if (k === 'Conditional' || k === 'Case') c += 1;
      if (k === 'Repeat') c += 1; // +times handled below
      if (k === 'ForEach') c += 1;
    };
    if (card.textIR.cast) walkEffect(card.textIR.cast, (n) => { bump(n?.kind); if (n?.kind === 'Repeat') c += Math.max(0, (n.times||0) - 1); });
    (card.textIR.triggers || []).forEach((t) => { c += 1; walkEffect(t.effect, (n) => bump(n?.kind)); });
    (card.textIR.continuous || []).forEach(() => c += 1);
    (card.textIR.replacements || []).forEach(() => c += 1);
    return c;
  })();

  // Interaction heuristic
  const interaction = (() => {
    let i = 0;
    const add = (k: string) => {
      if (k === 'DealDamage' || k === 'PreventDamage' || k === 'ChangeController' || k === 'Transform') i += 1;
    };
    if (card.textIR.cast) walkEffect(card.textIR.cast, (n) => add(n?.kind));
    (card.textIR.triggers || []).forEach((t) => walkEffect(t.effect, (n) => add(n?.kind)));
    (card.textIR.replacements || []).forEach((r) => walkEffect(r.instead, (n) => add(n?.kind)));
    return i;
  })();

  // Credits estimate for triggers/spawns
  let triggerCredits = 0;
  let spawnCredits = 0;
  (card.textIR.triggers || []).forEach((t) => {
    const em = effectMultiplicity(t.effect);
    const total = Object.values(em.emits).reduce((a, b) => a + (b || 0), 0);
    triggerCredits += Math.min(t.limit?.times ?? 0, total);
  });
  (card.textIR.cast ? [card.textIR.cast] : []).forEach((e) => { spawnCredits += effectMultiplicity(e).spawns; });
  (card.textIR.triggers || []).forEach((t) => { spawnCredits += effectMultiplicity(t.effect).spawns; });
  (card.textIR.replacements || []).forEach((r) => { spawnCredits += effectMultiplicity(r.instead).spawns; });

  if (triggerCredits > MAX_TRIGGER_CREDITS_PER_RESOLUTION) {
    err('TRIGGER_CREDITS_EXCESS', `Trigger credits exceed safe bound (${triggerCredits} > ${MAX_TRIGGER_CREDITS_PER_RESOLUTION})`);
  }
  if (spawnCredits > MAX_SPAWN_CREDITS_PER_RESOLUTION) {
    err('SPAWN_CREDITS_EXCESS', `Spawn credits exceed safe bound (${spawnCredits} > ${MAX_SPAWN_CREDITS_PER_RESOLUTION})`);
  }

  return { ok: issues.filter((i) => i.level === 'error').length === 0, issues, computed: { complexity, interaction, triggerCredits, spawnCredits } };
}

// ----------------------------- Global Analyzer (multi-card, cycle check) -----------------------------
export type GlobalIssue = AnalysisIssue & { cards?: string[] };
export type GlobalAnalysis = { ok: boolean; issues: GlobalIssue[] };

function effectEmits(e: any): EmitCount { return effectMultiplicity(e).emits; }

export function analyzeGlobal(cards: Card[]): GlobalAnalysis {
  const issues: GlobalIssue[] = [];

  // Build event dependency graph: Trigger.when -> Effect emits
  type Edge = { from: EventKind; to: EventKind; multiplicity: number; card: string; limit: number };
  const edges: Edge[] = [];

  for (const card of cards) {
    // Triggers
    for (const t of card.textIR.triggers || []) {
      const emits = effectEmits(t.effect);
      for (const [to, m] of Object.entries(emits) as [EventKind, number][]) {
        if (m && m > 0) edges.push({ from: t.when as EventKind, to, multiplicity: m, card: card.name, limit: t.limit.times });
      }
    }
    // Replacements cannot emit same event type as they replace
    for (const r of card.textIR.replacements || []) {
      const emits = effectEmits(r.instead);
      if (r.when === 'WouldDraw' && (emits as any)[EventKindObj.OnDraw]) {
        issues.push({ level:'error', code:'REPL_SAME_EVENT_EMIT', message:`Replacement for WouldDraw emits OnDraw`, path:['textIR','replacements'], cards:[card.name] });
      }
      if (r.when === 'WouldBeDamaged' && (emits as any)[EventKindObj.OnDamageDealt]) {
        issues.push({ level:'error', code:'REPL_SAME_EVENT_EMIT', message:`Replacement for WouldBeDamaged emits OnDamageDealt`, path:['textIR','replacements'], cards:[card.name] });
      }
      if (r.when === 'WouldDie') {
        if ((emits as any)[EventKindObj.OnDeath]) {
          issues.push({ level:'error', code:'REPL_EMITS_ONDEATH', message:`WouldDie replacement emits OnDeath`, path:['textIR','replacements'], cards:[card.name] });
        }
      }
    }
  }

  // Detect cycles in the event graph
  const nodes: EventKind[] = Array.from(new Set(edges.flatMap(e => [e.from, e.to])));
  const adj: Record<string, Edge[]> = {}; nodes.forEach(n => { adj[n] = []; });
  edges.forEach(e => adj[e.from].push(e));

  const visiting = new Set<EventKind>();
  const visited = new Set<EventKind>();

  function dfs(u: EventKind, stack: Edge[]) {
    if (visiting.has(u)) return;
    visiting.add(u);
    for (const e of adj[u] || []) {
      const v = e.to;
      if (!visited.has(v)) {
        if (visiting.has(v)) {
          // Found a cycle: stack edges + e
          const cycle = [...stack, e];
          const totalLimit = cycle.reduce((acc, ed) => acc + ed.limit, 0);
          const maxMult = cycle.reduce((acc, ed) => multiply(acc, ed.multiplicity), 1);
          if (totalLimit > MAX_TRIGGER_CREDITS_PER_RESOLUTION || maxMult > MAX_SPAWN_CREDITS_PER_RESOLUTION) {
            issues.push({ level:'error', code:'EVENT_CYCLE_UNBOUNDED', message:`Event cycle exceeds credits (limitSum=${totalLimit}, mult=${maxMult}).`, cards: cycle.map(c=>c.card) });
          }
        } else {
          dfs(v, [...stack, e]);
        }
      }
    }
    visiting.delete(u); visited.add(u);
  }

  nodes.forEach(n => dfs(n, []));

  return { ok: issues.filter(i => i.level==='error').length===0, issues };
}

