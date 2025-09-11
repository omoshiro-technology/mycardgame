// Schema and types for the TCG card generator
// Pure type/Zod module: no Node or AI SDK dependencies

import { z } from 'zod';

// ----------------------------- Global Termination Guards -----------------------------
export const MAX_REPEAT = 3; // Repeat.times <= 3
export const MAX_FOREACH_TARGETS = 3; // ForEach.maxTargets <= 3
export const MAX_CASE_BRANCHES = 4; // Case.branches <= 4
export const MAX_LOOKTOP_N = 5; // LookAtTop.n <= 5
export const MAX_TRIGGER_CREDITS_PER_RESOLUTION = 8; // bound for total trigger firings in one chain
export const MAX_SPAWN_CREDITS_PER_RESOLUTION = 6;   // bound for total BF entries/creations in one chain

// Helper: event kinds the engine recognizes (subset, enough for safety checks)
export const EventKind = {
  OnEnter: 'OnEnter',
  OnTokenCreated: 'OnTokenCreated',
  OnDraw: 'OnDraw',
  OnDamageDealt: 'OnDamageDealt',
  OnAttack: 'OnAttack',
  OnDeath: 'OnDeath',
  OnCast: 'OnCast',
  OnUpkeepStart: 'OnUpkeepStart',
  OnNameMatched: 'OnNameMatched',
} as const;
export type EventKind = typeof EventKind[keyof typeof EventKind];

// ----------------------------- Primitive Types -----------------------------
export const ZoneZ = z.enum(["LIB", "HAND", "BF", "GY", "EXILE", "STACK"]);
export type Zone = z.infer<typeof ZoneZ>;

export const PhaseZ = z.enum(["UPKEEP", "MAIN", "COMBAT", "END"]);
export type Phase = z.infer<typeof PhaseZ>;

export const PlayerRefZ = z.enum(["SELF", "OPP"]);
export type PlayerRef = z.infer<typeof PlayerRefZ>;

export const NameMatchZ = z.object({
  mode: z.enum(["Exact", "Prefix", "Contains"]),
  text: z.string().min(1).max(64),
});
export type NameMatch = z.infer<typeof NameMatchZ>;

// Metrics used inside predicates and values
export const MetricZ = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('Const'), n: z.number() }),
  z.object({ kind: z.literal('CardStat'), stat: z.enum(['ATK','HP']), of: z.enum(['Target','Self']) }),
  z.object({ kind: z.literal('BoardCount'), who: PlayerRefZ, tag: z.string().min(1).max(32).optional(), zone: ZoneZ.optional() }),
  z.object({ kind: z.literal('Life'), who: PlayerRefZ }),
]);
export type Metric = z.infer<typeof MetricZ>;

export const CmpOpZ = z.enum([">=", ">", "<=", "<", "==", "!="]);
export type CmpOp = z.infer<typeof CmpOpZ>;

// ----------------------------- Predicates (recursive, strongly typed) -----------------------------
export type PredTrue = { kind: 'True' };
export type PredHasTag = { kind: 'HasTag'; tag: string; in?: 'Target' | 'Self' };
export type PredHasAttribute = { kind: 'HasAttribute'; attr: 'Element' | 'Class' | 'Species'; value: string; in?: 'Target' | 'Self' };
export type PredHasName = { kind: 'HasName'; name: NameMatch; in?: 'Target' | 'Self' };
export type PredIsToken = { kind: 'IsToken'; in?: 'Target' | 'Self' };
export type PredWasSummonedThisTurn = { kind: 'WasSummonedThisTurn'; in?: 'Target' | 'Self' };
export type PredHasCounter = { kind: 'HasCounter'; counter: string; atLeast: number; in?: 'Target' | 'Self' };
export type PredControllerIs = { kind: 'ControllerIs'; who: PlayerRef; in?: 'Target' | 'Self' };
export type PredEventOccurred = { kind: 'EventOccurred'; event: 'UnitDied' | 'TokenCreated' | 'SpellCast'; who?: PlayerRef; since: 'TURN' | 'GAME'; atLeast: number };
export type PredCmp = { kind: 'Cmp'; left: Metric; op: CmpOp; right: Metric };
export type PredAnd = { kind: 'And'; items: Predicate[] };
export type PredOr = { kind: 'Or'; items: Predicate[] };
export type PredNot = { kind: 'Not'; item: Predicate };

export type Predicate =
  | PredTrue
  | PredHasTag
  | PredHasAttribute
  | PredHasName
  | PredIsToken
  | PredWasSummonedThisTurn
  | PredHasCounter
  | PredControllerIs
  | PredEventOccurred
  | PredCmp
  | PredAnd
  | PredOr
  | PredNot;

// PredicateZ: zod schema aligned to strongly-typed Predicate
export const PredicateZ: z.ZodType<Predicate> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('True') }),
  z.object({ kind: z.literal('HasTag'), tag: z.string().min(1).max(32), in: z.enum(['Target','Self']).optional() }),
  z.object({ kind: z.literal('HasAttribute'), attr: z.enum(['Element','Class','Species']), value: z.string().min(1).max(32), in: z.enum(['Target','Self']).optional() }),
  z.object({ kind: z.literal('HasName'), name: NameMatchZ, in: z.enum(['Target','Self']).optional() }),
  z.object({ kind: z.literal('IsToken'), in: z.enum(['Target','Self']).optional() }),
  z.object({ kind: z.literal('WasSummonedThisTurn'), in: z.enum(['Target','Self']).optional() }),
  z.object({ kind: z.literal('HasCounter'), counter: z.string().min(1).max(24), atLeast: z.number().int().min(1).max(10), in: z.enum(['Target','Self']).optional() }),
  z.object({ kind: z.literal('ControllerIs'), who: PlayerRefZ, in: z.enum(['Target','Self']).optional() }),
  z.object({ kind: z.literal('EventOccurred'), event: z.enum(['UnitDied','TokenCreated','SpellCast']), who: PlayerRefZ.optional(), since: z.enum(['TURN','GAME']), atLeast: z.number().int().min(1).max(10) }),
  z.object({ kind: z.literal('Cmp'), left: MetricZ, op: CmpOpZ, right: MetricZ }),
  z.object({ kind: z.literal('And'), items: z.array(PredicateZ).min(1).max(5) }),
  z.object({ kind: z.literal('Or'), items: z.array(PredicateZ).min(1).max(5) }),
  z.object({ kind: z.literal('Not'), item: PredicateZ }),
]));
export type Filter = Predicate; // Alias for ability text generator
export type Condition = Predicate; // Alias for ability text generator
// (Filter/Condition aliases moved to follow PredicateZ to preserve order)

export const SelectorZ = z.object({
  owner: PlayerRefZ.optional(),
  zone: ZoneZ.optional(),
  max: z.number().int().min(1).max(99).optional(), // additional caps enforced by analysis
  filter: PredicateZ.optional(),
});
export type Selector = z.infer<typeof SelectorZ>;

export const DurationZ = z.enum(["EOT","PERM"]);
export type Duration = z.infer<typeof DurationZ>;

export const ValueZ = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('Const'), n: z.number() }),
  z.object({ kind: z.literal('Clamp'), min: z.number(), max: z.number(), of: MetricZ })
]);
export type Value = z.infer<typeof ValueZ>;

// ----------------------------- Effects (recursive) -----------------------------
// Strongly-typed discriminated union for compile-time exhaustiveness
export type DealDamage = { kind: 'DealDamage'; target: Selector; amount: Value };
export type PreventDamage = { kind: 'PreventDamage'; target: Selector; amount: Value; duration: Duration };
export type Heal = { kind: 'Heal'; target: Selector; amount: Value };
export type Draw = { kind: 'Draw'; who: PlayerRef; n: Value };
export type Mill = { kind: 'Mill'; who: PlayerRef; n: Value };
export type LookAtTop = {
  kind: 'LookAtTop';
  who: PlayerRef;
  n: number;
  choose?: { keep: number; moveRestTo: Zone; reveal?: boolean };
};
export type CreateToken = { kind: 'CreateToken'; who: PlayerRef; atk: number; hp: number; tags?: string[]; attributes?: Record<string, string> };
export type AddCounter = { kind: 'AddCounter'; target: Selector; counter: string; n: Value; max?: number };
export type RemoveCounter = { kind: 'RemoveCounter'; target: Selector; counter: string; n: Value };
export type Buff = { kind: 'Buff'; target: Selector; atk?: number; hp?: number; duration: Duration };
export type Move = { kind: 'Move'; target: Selector; to: Zone };
export type ChangeController = { kind: 'ChangeController'; target: Selector; newController: PlayerRef; duration: Duration };
export type Transform = { kind: 'Transform'; target: Selector; into: { atk: number; hp: number; tags?: string[]; attributes?: Record<string, string> }; duration?: Duration };
export type CopyStats = { kind: 'CopyStats'; from: Selector; to: Selector; clamp: { atk: [number, number]; hp: [number, number] }; duration: Duration };
export type Conditional = { kind: 'Conditional'; if: Predicate; then: Effect; else?: Effect };
export type Case = { kind: 'Case'; branches: { when: Predicate; do: Effect }[]; else?: Effect };
export type ForEach = { kind: 'ForEach'; among: Selector; maxTargets: number; body: Effect };
export type Sequence = { kind: 'Sequence'; steps: Effect[] };
export type Repeat = { kind: 'Repeat'; times: number; body: Effect };
export type NoOp = { kind: 'NoOp' };

export type Effect =
  | DealDamage | PreventDamage | Heal | Draw | Mill | LookAtTop
  | CreateToken | AddCounter | RemoveCounter | Buff | Move | ChangeController
  | Transform | CopyStats
  | Conditional | Case | ForEach | Sequence | Repeat
  | NoOp;

// Zod schemas mirroring the TypeScript union above
const DealDamageZ = z.object({ kind: z.literal('DealDamage'), target: SelectorZ, amount: ValueZ });
const PreventDamageZ = z.object({ kind: z.literal('PreventDamage'), target: SelectorZ, amount: ValueZ, duration: DurationZ });
const HealZ = z.object({ kind: z.literal('Heal'), target: SelectorZ, amount: ValueZ });
const DrawZ = z.object({ kind: z.literal('Draw'), who: PlayerRefZ, n: ValueZ });
const MillZ = z.object({ kind: z.literal('Mill'), who: PlayerRefZ, n: ValueZ });
const LookAtTopZ = z.object({
  kind: z.literal('LookAtTop'),
  who: PlayerRefZ,
  n: z.number().int().min(1).max(MAX_LOOKTOP_N),
  choose: z.object({
    keep: z.number().int().min(0).max(MAX_LOOKTOP_N),
    moveRestTo: ZoneZ,
    reveal: z.boolean().optional(),
  }).optional(),
});
const CreateTokenZ = z.object({ kind: z.literal('CreateToken'), who: PlayerRefZ, atk: z.number().int().min(0).max(20), hp: z.number().int().min(1).max(40), tags: z.array(z.string()).max(5).optional(), attributes: z.record(z.string()).optional() });
const AddCounterZ = z.object({ kind: z.literal('AddCounter'), target: SelectorZ, counter: z.string().min(1).max(24), n: ValueZ, max: z.number().int().min(1).max(20).optional() });
const RemoveCounterZ = z.object({ kind: z.literal('RemoveCounter'), target: SelectorZ, counter: z.string().min(1).max(24), n: ValueZ });
const BuffZ = z.object({ kind: z.literal('Buff'), target: SelectorZ, atk: z.number().int().min(-10).max(10).optional(), hp: z.number().int().min(-20).max(20).optional(), duration: DurationZ });
const MoveZ = z.object({ kind: z.literal('Move'), target: SelectorZ, to: ZoneZ });
const ChangeControllerZ = z.object({ kind: z.literal('ChangeController'), target: SelectorZ, newController: PlayerRefZ, duration: DurationZ });
const TransformZ = z.object({ kind: z.literal('Transform'), target: SelectorZ, into: z.object({ atk: z.number().int().min(0).max(20), hp: z.number().int().min(1).max(40), tags: z.array(z.string()).max(5).optional(), attributes: z.record(z.string()).optional() }), duration: DurationZ.optional() });
const CopyStatsZ = z.object({ kind: z.literal('CopyStats'), from: SelectorZ, to: SelectorZ, clamp: z.object({ atk: z.tuple([z.number(), z.number()]), hp: z.tuple([z.number(), z.number()]) }), duration: DurationZ });

// recursive: Conditional, Case, ForEach, Sequence, Repeat
export const EffectZ: z.ZodType<Effect> = z.lazy(() => z.discriminatedUnion('kind', [
  DealDamageZ, PreventDamageZ, HealZ, DrawZ, MillZ, LookAtTopZ,
  CreateTokenZ, AddCounterZ, RemoveCounterZ, BuffZ, MoveZ, ChangeControllerZ,
  TransformZ, CopyStatsZ,
  z.object({ kind: z.literal('Conditional'), if: PredicateZ, then: EffectZ, else: EffectZ.optional() }),
  z.object({ kind: z.literal('Case'), branches: z.array(z.object({ when: PredicateZ, do: EffectZ })).min(1).max(MAX_CASE_BRANCHES), else: EffectZ.optional() }),
  z.object({ kind: z.literal('ForEach'), among: SelectorZ, maxTargets: z.number().int().min(1).max(MAX_FOREACH_TARGETS), body: EffectZ }),
  z.object({ kind: z.literal('Sequence'), steps: z.array(EffectZ).min(1).max(8) }),
  z.object({ kind: z.literal('Repeat'), times: z.number().int().min(1).max(MAX_REPEAT), body: EffectZ }),
  z.object({ kind: z.literal('NoOp') }),
]));

// Replacement Effects — limit is REQUIRED & same-event reentry is analyzed
export const ReplacementEffectZ = z.object({
  when: z.enum(['WouldDie','WouldBeDamaged','WouldDraw']),
  subject: SelectorZ,
  instead: EffectZ,
  duration: DurationZ,
  limit: z.object({ per: z.enum(['TURN','GAME']), times: z.number().int().min(1).max(5) }),
});
export type ReplacementEffect = z.infer<typeof ReplacementEffectZ>;

// Triggers & Continuous Effects — limit is REQUIRED
export const TriggerWhenZ = z.enum([
  'OnCast','OnEnter','OnAttack','OnDamageDealt','OnDeath','OnTokenCreated','OnDraw','OnUpkeepStart','OnNameMatched'
]);
export type TriggerWhen = z.infer<typeof TriggerWhenZ>;

export const TriggerZ = z.object({
  when: TriggerWhenZ,
  condition: PredicateZ.optional(),
  effect: EffectZ,
  limit: z.object({ per: z.enum(['TURN','GAME']), times: z.number().int().min(1).max(5) }),
});
export type Trigger = z.infer<typeof TriggerZ>;

export const ContinuousEffectZ = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('StaticBuff'), target: SelectorZ, atk: z.number().int().min(-10).max(10).optional(), hp: z.number().int().min(-20).max(20).optional() }),
  z.object({ kind: z.literal('CostModifier'), predicate: PredicateZ, delta: z.number().int().min(-5).max(5), floor: z.number().int().min(0).max(10).optional() }),
]);
export type ContinuousEffect = z.infer<typeof ContinuousEffectZ>;

export const ManaCostZ = z.object({ generic: z.number().int().min(0).max(15), colors: z.array(z.string()).max(3).optional() });
export type ManaCost = z.infer<typeof ManaCostZ>;

export const CardTypeZ = z.enum(["Unit","Spell","Artifact","Enchantment"]);
export type CardType = z.infer<typeof CardTypeZ>;

export const CardZ = z.object({
  name: z.string().min(1).max(64),
  canonicalName: z.string().min(1).max(64).optional(),
  cost: ManaCostZ,
  type: CardTypeZ,
  stats: z.object({ atk: z.number().int().min(0).max(50), hp: z.number().int().min(1).max(100) }).optional(),
  keywords: z.array(z.string()).max(8).optional(),
  tags: z.array(z.string()).max(10),
  attributes: z.record(z.string()).optional(),
  textIR: z.object({
    cast: EffectZ.optional(),
    triggers: z.array(TriggerZ).max(5).optional(),
    continuous: z.array(ContinuousEffectZ).max(3).optional(),
    replacements: z.array(ReplacementEffectZ).max(2).optional(),
  }),
  budgets: z.object({ power: z.number().int().min(0).max(30), complexity: z.number().int().min(0).max(20), interaction: z.number().int().min(0).max(20).optional() }),
  rarity: z.enum(['C','U','R','M']),
  version: z.number().int().min(1).max(9999),
});
export type Card = z.infer<typeof CardZ>;
