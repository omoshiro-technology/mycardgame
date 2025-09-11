#!/usr/bin/env tsx
// Minimal CLI to generate cards using world_rules.ts.
// - Loads OPENAI_API_KEY from environment or .env.local
// - Accepts optional CLI flags or auto-generates inputs via LLM

import fs from 'node:fs';
import path from 'node:path';
declare const process: {
  argv?: string[];
  exit?: (code?: number) => never;
  env: Record<string, string | undefined>;
  cwd?: () => string;
};
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

import { generateCard, type GenerateCardOptions } from '../generator.ts';
import { analyzeGlobal, type GlobalAnalysis } from '../analysis.ts';
import { type Card } from '../schema.ts';
import { cardToJapaneseJSON } from '../ability-text-generator.ts';

// ------------------------- env loader (.env.local) -------------------------
function loadEnvLocal() {
  if (process.env.OPENAI_API_KEY) return;
  const cwd = process.cwd && process.cwd() || '.';
  const envPath = path.join(cwd, '.env.local');
  try {
    const txt = fs.readFileSync(envPath, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (_) {
    // ignore
  }
}

// ------------------------- CLI arg parsing -------------------------
type Args = {
  archetype?: string;
  rarity?: 'C' | 'U' | 'R' | 'M';
  seedNameHint?: string;
  power?: number;
  complexity?: number;
  interaction?: number;
  allow?: string[];
  model?: string;
  count: number;
  out?: string;
  auto: boolean;
  japanese?: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { count: 1, auto: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextReq = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--archetype': args.archetype = nextReq(); break;
      case '--rarity': {
        const v = nextReq();
        if (v === 'C' || v === 'U' || v === 'R' || v === 'M') args.rarity = v;
        break;
      }
      case '--seed-name': args.seedNameHint = nextReq(); break;
      case '--power': args.power = Number(nextReq()); break;
      case '--complexity': args.complexity = Number(nextReq()); break;
      case '--interaction': args.interaction = Number(nextReq()); break;
      case '--allow': args.allow = nextReq().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--model': args.model = nextReq(); break;
      case '--count': args.count = Math.max(1, Number(nextReq())); break;
      case '--out': args.out = nextReq(); break;
      case '--auto': args.auto = true; break;
      case '--japanese': args.japanese = true; break;
      case '-h':
      case '--help':
        printHelp();
        process.exit && process.exit(0);
      default:
        // ignore unknown flag for now
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Generate TCG cards via world_rules.ts

Usage: npm run generate -- [options]

Options:
  --archetype <name>       e.g., "Token Swarm", "Aggro Burn"
  --rarity <C|U|R|M>       card rarity
  --seed-name <text>       hint for name-based synergy
  --power <n>              budget: power cap (default 8)
  --complexity <n>         budget: complexity cap (default 4)
  --interaction <n>        budget: interaction cap (default 6)
  --allow <k1,k2,...>      allowed Effect kinds (optional)
  --model <id>             LLM model id (default gpt-4o-mini)
  --count <n>              number of cards to generate (default 1)
  --out <file.json>        write results to JSON file
  --auto                   let LLM propose inputs for you
  --japanese               output card abilities in Japanese JSON format
  -h, --help               show this help
`);
}

// ------------------------- LLM: propose input options -------------------------
const InputZ = z.object({
  archetype: z.string().min(2).max(40),
  rarity: z.enum(['C','U','R','M']),
  seedNameHint: z.string().min(2).max(32).optional(),
  budgets: z.object({
    power: z.number().int().min(1).max(20).default(8),
    complexity: z.number().int().min(1).max(20).default(4),
    interaction: z.number().int().min(0).max(20).default(6),
  }).default({ power: 8, complexity: 4, interaction: 6 }),
});

async function suggestInputs(modelId?: string) {
  // Try Anthropic first if available, then Google, then OpenAI
  const model = process.env.ANTHROPIC_API_KEY 
    ? anthropic(modelId || 'claude-3-5-haiku-20241022')
    : process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ? google(modelId || 'gemini-1.5-flash')
    : openai(modelId || 'gpt-4o-mini');
  const system = 'You generate concise, sensible input options for a TCG card generator.';
  const prompt = [
    'Pick an archetype and rarity that could yield an interesting, safe design.',
    'Prefer archetypes with either token synergy, on-enter triggers, or top-deck play.',
    'Use modest budgets: power≈8, complexity≈4, interaction≈6, unless you have a good reason.',
  ].join('\n');
  const result = await generateObject({ model, system, prompt, schema: InputZ });
  return result.object as z.infer<typeof InputZ>;
}

// ------------------------- Main -------------------------
async function main() {
  loadEnvLocal();

  const args = parseArgs(process.argv || []);
  if ((process.argv && process.argv.length || 0) <= 2) {
    // no args: show help hint
    console.log('Tip: run with --auto to let the LLM pick inputs.');
  }

  // Select model based on available API keys
  const defaultModel = process.env.ANTHROPIC_API_KEY 
    ? 'claude-sonnet-4-20250514'
    : process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ? 'gemini-1.5-flash'
    : 'gpt-4o-mini';
  
  const modelId = args.model || defaultModel;
  const model = process.env.ANTHROPIC_API_KEY && modelId.includes('claude')
    ? anthropic(modelId)
    : process.env.GOOGLE_GENERATIVE_AI_API_KEY && modelId.includes('gemini')
    ? google(modelId)
    : openai(modelId);

  let resolved: GenerateCardOptions | undefined;
  if (args.auto) {
    const s = await suggestInputs(args.model);
    resolved = {
      model,
      archetype: s.archetype,
      rarity: s.rarity,
      budgets: s.budgets,
      seedNameHint: s.seedNameHint,
      allowEffects: args.allow,
    };
  } else {
    resolved = {
      model,
      archetype: args.archetype,
      rarity: args.rarity,
      budgets: {
        power: args.power ?? 8,
        complexity: args.complexity ?? 4,
        interaction: args.interaction ?? 6,
      },
      seedNameHint: args.seedNameHint,
      allowEffects: args.allow,
    };
  }

  type GenResult = Awaited<ReturnType<typeof generateCard>>;
  type OutputResult = GenResult & { japanese?: object };
  const results: OutputResult[] = [];
  for (let i = 0; i < (args.count || 1); i++) {
    const res = await generateCard(resolved);
    // Add Japanese version to the result without mutating type to any
    if (args.japanese && res.ok && 'card' in res && res.card) {
      results.push({ ...res, japanese: cardToJapaneseJSON(res.card) });
    } else {
      results.push(res);
    }
  }

  // Optionally compute a global analysis if we got valid cards
  const validCards: Card[] = results
    .map(r => ('card' in r && r.ok ? r.card : undefined))
    .filter((c): c is Card => Boolean(c));
  let globalAnalysis: GlobalAnalysis | undefined = undefined;
  if (validCards.length > 0) {
    globalAnalysis = analyzeGlobal(validCards);
  }

  const output = { inputs: resolved, results, global: globalAnalysis };

  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), JSON.stringify(output, null, 2), 'utf8');
    console.log(`Wrote ${results.length} result(s) to ${args.out}`);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

main().catch((err) => {
  console.error('Error:', err?.message || err);
  process.exit && process.exit(1);
});
