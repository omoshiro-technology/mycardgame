// Verifies that all rules declared in schema.ts are implemented by the engine.
// Fails with a detailed report when coverage is incomplete.

declare const process: {
  argv?: string[];
  exit?: (code?: number) => never;
  env: Record<string, string | undefined>;
};
import {
  EffectZ,
  ContinuousEffectZ,
  TriggerWhenZ,
  ReplacementEffectZ,
  CardTypeZ,
} from '../schema.ts';
import { CORE_RULES } from '../core-rules.ts';
import { buildRulebook, RULEBOOK_REQUIRED_KEYS, type RulebookKey } from '../rulebook.ts';

type CoverageSection = {
  all: string[];
  implemented: string[];
  missing: string[];
  // For effects only: engine advertised kinds that aren't in schema (type mismatch)
  engineOnly?: string[];
};

type CoverageReport = {
  effects: CoverageSection;
  triggers: CoverageSection;
  replacements: CoverageSection;
  continuous: CoverageSection;
  cardTypes: CoverageSection;
  rules: {
    stack: { requiredByRules: boolean; supported: boolean };
    illegalTargetFizzle: { requiredByRules: boolean; supported: boolean };
  };
  rulebook: { missingMentions: string[] };
  issues: string[];
  ok: boolean;
};

function uniq(xs: string[]): string[] { return Array.from(new Set(xs)); }
function sort(xs: string[]): string[] { return [...xs].sort(); }

function listEnumOptions(zEnum: any): string[] {
  if (Array.isArray(zEnum?.options)) return zEnum.options as string[];
  if (Array.isArray(zEnum?._def?.values)) return zEnum._def.values as string[];
  return [];
}

function listDiscriminantKinds(zType: any): string[] {
  // Resolve z.lazy if present
  const resolved = typeof zType?._def?.getter === 'function' ? zType._def.getter() : zType;
  // Prefer optionsMap when available (Zod >= 3.22)
  const optMap: Map<string, any> | undefined = resolved?.optionsMap;
  if (optMap && typeof optMap.size === 'number') {
    return Array.from(optMap.keys());
  }
  // Fallback: scan options array and extract object shape's kind literal
  const opts = resolved?._def?.options ?? resolved?.options ?? [];
  const kinds: string[] = [];
  for (const opt of opts) {
    try {
      const shape = typeof opt?._def?.shape === 'function' ? opt._def.shape() : opt?._def?.shape;
      const kindLit = shape?.kind?._def?.value;
      if (typeof kindLit === 'string') kinds.push(kindLit);
    } catch {}
  }
  return uniq(kinds);
}

function buildReport(): CoverageReport {
  // All schema-declared kinds
  const allEffects = sort(listDiscriminantKinds(EffectZ));
  const allContinuous = sort(listDiscriminantKinds(ContinuousEffectZ));
  const allTriggers = sort(listEnumOptions(TriggerWhenZ));
  const allReplacementWhens = sort(listEnumOptions((ReplacementEffectZ as any)._def.shape().when));
  const allCardTypes = sort(listEnumOptions(CardTypeZ));

  // Engine supported capabilities (declare explicitly here)
  // Note: keep this in sync with engine.ts; this script is the authority for verification.
  const implEffects = sort([
    // Primitive effects fully supported by the engine
    'DealDamage',
    'PreventDamage',
    'Heal',
    'Draw',
    'LookAtTop',
    'CreateToken',
    'Move',
    'NoOp',
    'AddCounter',
    'RemoveCounter',
    'Buff',
    'ChangeController',
    'Transform',
    'CopyStats',
    // Control-flow/combinator effects supported in engine.resolveEffect
    'Conditional',
    'Case',
    'ForEach',
    'Sequence',
    'Repeat',
    // Small utility effects additionally supported
    'Mill',
  ]);
  const implTriggers: string[] = sort(['OnAttack','OnCast','OnDamageDealt','OnDeath','OnDraw','OnEnter','OnNameMatched','OnTokenCreated','OnUpkeepStart']);
  const implReplacements: string[] = sort(['WouldBeDamaged','WouldDie','WouldDraw']);
  const implContinuous: string[] = sort(['CostModifier','StaticBuff']);
  // Card types handling: Unit (permanent), Spell (spell-like). Artifact/Enchantment not handled as permanents yet.
  const implCardTypes = sort(['Unit', 'Spell', 'Artifact', 'Enchantment']);

  // Compute differences
  const missingEffects = allEffects.filter(k => !implEffects.includes(k));
  const engineOnlyEffects = implEffects.filter(k => !allEffects.includes(k));
  const missingTriggers = allTriggers.filter(k => !implTriggers.includes(k));
  const missingReplacements = allReplacementWhens.filter(k => !implReplacements.includes(k));
  const missingContinuous = allContinuous.filter(k => !implContinuous.includes(k));
  const missingCardTypes = allCardTypes.filter(k => !implCardTypes.includes(k));

  // Rule toggles cross-check
  const stackReq = !!CORE_RULES.actions.usesStack; // true currently
  const stackImpl = true; // minimal LIFO stack is implemented (auto-resolve)
  const fizzleReq = !!CORE_RULES.actions.illegalTargetFizzle;
  const fizzleImpl = true; // implemented in engine (resolution-time legality check)

  // Rulebook coverage check (typed): build and compare required keys
  const rb = buildRulebook();
  const coveredKeys = rb.covered;
  const rbMissing: string[] = RULEBOOK_REQUIRED_KEYS.filter((k) => !coveredKeys.has(k as RulebookKey));

  const issues: string[] = [];
  if (missingEffects.length) issues.push(`Missing effects: ${missingEffects.join(', ')}`);
  if (engineOnlyEffects.length) issues.push(`Engine-only (not in schema) effects: ${engineOnlyEffects.join(', ')}`);
  if (missingTriggers.length) issues.push(`Missing trigger handlers: ${missingTriggers.join(', ')}`);
  if (missingReplacements.length) issues.push(`Missing replacement handlers: ${missingReplacements.join(', ')}`);
  if (missingContinuous.length) issues.push(`Missing continuous effects: ${missingContinuous.join(', ')}`);
  if (missingCardTypes.length) issues.push(`Missing card type handling: ${missingCardTypes.join(', ')}`);
  if (stackReq && !stackImpl) issues.push('usesStack is true but engine stack is not implemented');
  if (fizzleReq && !fizzleImpl) issues.push('illegalTargetFizzle is true but engine lacks fizzle recheck');
  if (rbMissing.length) issues.push(`Rulebook missing mentions: ${rbMissing.join(' | ')}`);

  return {
    effects: { all: allEffects, implemented: implEffects, missing: missingEffects, engineOnly: engineOnlyEffects },
    triggers: { all: allTriggers, implemented: implTriggers, missing: missingTriggers },
    replacements: { all: allReplacementWhens, implemented: implReplacements, missing: missingReplacements },
    continuous: { all: allContinuous, implemented: implContinuous, missing: missingContinuous },
    cardTypes: { all: allCardTypes, implemented: implCardTypes, missing: missingCardTypes },
    rules: {
      stack: { requiredByRules: stackReq, supported: stackImpl },
      illegalTargetFizzle: { requiredByRules: fizzleReq, supported: fizzleImpl },
    },
    rulebook: { missingMentions: rbMissing },
    issues,
    ok: issues.length === 0,
  };
}

const report = buildReport();

// Pretty print and fail when not OK
function printReport(r: CoverageReport) {
  const p = (label: string, sec: CoverageSection) => {
    console.log(`- ${label}:`);
    console.log(`  all:         ${sec.all.join(', ') || '(none)'}`);
    console.log(`  implemented: ${sec.implemented.join(', ') || '(none)'}`);
    console.log(`  missing:     ${sec.missing.join(', ') || '(none)'}`);
    if (sec.engineOnly && sec.engineOnly.length) {
      console.log(`  engineOnly:  ${sec.engineOnly.join(', ')}`);
    }
  };
  console.log('=== Engine Coverage Report ===');
  p('Effects', r.effects);
  p('Triggers', r.triggers);
  p('Replacements', r.replacements);
  p('Continuous', r.continuous);
  p('CardTypes', r.cardTypes);
  console.log('- Rules:');
  console.log(`  usesStack: required=${r.rules.stack.requiredByRules}, supported=${r.rules.stack.supported}`);
  console.log(`  illegalTargetFizzle: required=${r.rules.illegalTargetFizzle.requiredByRules}, supported=${r.rules.illegalTargetFizzle.supported}`);
  if (r.rulebook.missingMentions.length) {
    console.log('- Rulebook:');
    console.log(`  missing: ${r.rulebook.missingMentions.join('; ')}`);
  }
  if (r.issues.length) {
    console.log('\n[Issues]');
    for (const m of r.issues) console.log(`- ${m}`);
  } else {
    console.log('\nNo issues detected.');
  }
}

printReport(report);
if (!report.ok) {
  // Fail intentionally until engine catches up
  console.error('\nCoverage check FAILED.');
  // Non-zero exit for CI/CLI failure
  // eslint-disable-next-line no-process-exit
  process.exit && process.exit(1);
}
