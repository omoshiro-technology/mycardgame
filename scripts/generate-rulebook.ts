#!/usr/bin/env tsx
// Generate RULEBOOK.md from types (schema.ts) and program constants (core-rules.ts).
// Optionally, load cards JSON and run analyzeGlobal to ensure no infinite trigger loops.

import fs from 'node:fs';
import path from 'node:path';
declare const process: {
  argv?: string[];
  exit?: (code?: number) => never;
  env: Record<string, string | undefined>;
};
import { z } from 'zod';

import { CardZ, type Card } from '../schema.ts';
import { analyzeGlobal, type GlobalAnalysis } from '../analysis.ts';
import { buildRulebookMarkdown } from '../rulebook.ts';

type Args = { out: string; cards?: string[] };

function parseArgs(argv: string[]): Args {
  const args: Args = { out: 'RULEBOOK.md' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (!v) throw new Error(`Missing value for ${a}`); return v; };
    switch (a) {
      case '--out': args.out = next(); break;
      case '--cards': args.cards = next().split(',').map(s => s.trim()).filter(Boolean); break;
      case '-h':
      case '--help':
        printHelp(); process.exit && process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Generate RULEBOOK.md from types and constants\n\nUsage: tsx scripts/generate-rulebook.ts [--out RULEBOOK.md] [--cards out.json[,more.json]]\n\n--out    Output markdown file path (default RULEBOOK.md)\n--cards  One or more JSON files containing cards to analyze for loop safety.\n         Accepts either:\n         - Array<Card>\n         - { results: [{ card: Card, ok: boolean }, ...] }\n         - { card: Card }\n`);
}

function tryExtractCards(obj: any): Card[] {
  const out: Card[] = [];
  const pushIfValid = (maybe: any) => {
    const p = CardZ.safeParse(maybe);
    if (p.success) out.push(p.data);
  };
  if (Array.isArray(obj)) {
    for (const it of obj) pushIfValid(it);
  } else if (obj && typeof obj === 'object') {
    if (Array.isArray(obj.results)) {
      for (const r of obj.results) {
        if (r && r.card) pushIfValid(r.card);
      }
    } else if (obj.card) {
      pushIfValid(obj.card);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv || []);

  // Load cards (optional)
  let global: GlobalAnalysis | undefined = undefined;
  if (args.cards && args.cards.length > 0) {
    const acc: Card[] = [];
    for (const f of args.cards) {
      const p = path.resolve(f);
      const raw = fs.readFileSync(p, 'utf8');
      const json = JSON.parse(raw);
      const extracted = tryExtractCards(json);
      acc.push(...extracted);
    }
    if (acc.length > 0) {
      global = analyzeGlobal(acc);
    }
  } else {
    // Auto-load out.json if present
    const guess = path.resolve('out.json');
    if (fs.existsSync(guess)) {
      const raw = fs.readFileSync(guess, 'utf8');
      const json = JSON.parse(raw);
      const cards = tryExtractCards(json);
      if (cards.length > 0) global = analyzeGlobal(cards);
    }
  }

  // Build markdown
  const md = buildRulebookMarkdown(global);
  fs.writeFileSync(path.resolve(args.out), md, 'utf8');
  const issueCount = global ? global.issues.length : 0;
  console.log(`Wrote ${args.out}${global ? ` (issues: ${issueCount})` : ''}`);
}

main().catch((err) => { console.error(err?.stack || err?.message || String(err)); process.exit && process.exit(1); });

