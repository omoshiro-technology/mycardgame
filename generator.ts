// Card generation using Vercel AI SDK
// Depends on schema (types) and analysis (validation)

import { z } from 'zod';
import { generateObject, GenerateObjectResult } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

import {
  CardZ,
  type Card,
  MAX_REPEAT,
  MAX_FOREACH_TARGETS,
  MAX_LOOKTOP_N,
  MAX_CASE_BRANCHES,
} from './schema.ts';
import { analyzeCard } from './analysis.ts';

export type GenerateCardOptions = {
  model?: ReturnType<typeof openai> | any; // allow any provider model
  archetype?: string; // e.g., "Aggro Burn", "Token Swarm"
  rarity?: 'C'|'U'|'R'|'M';
  allowEffects?: string[]; // whitelist of Effect.kind; if omitted, default set is used
  budgets?: { power?: number; complexity?: number; interaction?: number };
  seedNameHint?: string; // optional canonical name hint for name-based synergies
};

const DEFAULT_ALLOWED_EFFECTS = [
  'DealDamage','PreventDamage','Heal','Draw','Mill','LookAtTop','CreateToken','AddCounter','RemoveCounter','Buff','Move','ChangeController','Transform','CopyStats','Conditional','Case','ForEach','Sequence','Repeat','NoOp'
];

export async function generateCard(opts: GenerateCardOptions = {}) {
  // Auto-select model based on available API keys if not provided
  const model = opts.model ?? (
    process.env.ANTHROPIC_API_KEY
      ? anthropic('claude-sonnet-4-20250514')
      : process.env.GOOGLE_GENERATIVE_AI_API_KEY
      ? google('gemini-1.5-flash')
      : openai('gpt-4o-mini')
  );

  const allow = (opts.allowEffects ?? DEFAULT_ALLOWED_EFFECTS).join(', ');
  const budgets = {
    power: opts.budgets?.power ?? 8,
    complexity: opts.budgets?.complexity ?? 4,
    interaction: opts.budgets?.interaction ?? 6,
  };

  const system = `You are a TCG card generator. Output ONLY JSON that validates against the provided schema. Use concise, balanced designs. Respect ALL bounds: Repeat.times<=${MAX_REPEAT}, ForEach.maxTargets<=${MAX_FOREACH_TARGETS}, LookAtTop.n<=${MAX_LOOKTOP_N}, Case.branches<=${MAX_CASE_BRANCHES}, provide clamp for CopyStats, provide duration for ChangeController, ReplacementEffect.limit is required, Trigger.limit is required, forbid WouldDraw->Draw.`;

  const prompt = [
    `Archetype: ${opts.archetype ?? 'Open'}`,
    `Rarity: ${opts.rarity ?? 'U'}`,
    `Allowed Effect kinds: ${allow}`,
    `Budgets: power<=${budgets.power}, complexity<=${budgets.complexity}, interaction<=${budgets.interaction}`,
    opts.seedNameHint ? `If possible, include a name-based or attribute-based synergy around ${opts.seedNameHint}.` : '',
    `Prefer at least one of: name-match, attribute-match, token interaction, transform, or top-deck manipulation (LookAtTop).`,
    `All numbers must be small and clamped; do not create unbounded loops or unlimited triggers.`,
  ].filter(Boolean).join('\n');

  const result: GenerateObjectResult<z.infer<typeof CardZ>> = await generateObject({
    model,
    schema: CardZ,
    system,
    prompt,
  });

  const card = result.object as Card;

  // Validate (again) + static analysis
  const parse = CardZ.safeParse(card);
  if (!parse.success) {
    return { ok: false as const, errors: parse.error.flatten().fieldErrors, raw: card };
  }
  const analysis = analyzeCard(parse.data);
  return { ok: analysis.ok, card: parse.data, analysis };
}

