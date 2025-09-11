#!/usr/bin/env tsx
// Simple CLI to play a 1v1 game using engine.ts and CORE_RULES

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
declare const process: {
  argv?: string[];
  exit?: (code?: number) => never;
  env: Record<string, string | undefined>;
};

import { initGame, loadDeck, validateDeck, startTurn, advancePhase, endTurn, castFromHand, canCastFromHand, listBattlefield, attack, snapshotPublic, type DeckEntry } from './engine.ts';
import type { Card } from './schema.ts';

type DeckFile = { name?: string; cards: { card: Card; count: number }[] };

function readDeck(file: string, ownerIdx: 0|1) {
  const p = path.resolve(file);
  const raw = fs.readFileSync(p, 'utf8');
  const json: DeckFile = JSON.parse(raw);
  const loaded = loadDeck(json, ownerIdx);
  return loaded;
}

function printHelp() {
  console.log(
`Commands:
  status                 Show life/AP, battlefield, and recent log
  hand                   Show your hand with indices
  play <i>               Play/cast card at hand index i
  atk <i> player         Attack opposing player with your unit index i
  atk <i> unit <j>       Attack opposing unit j with your unit i
  next                   Advance to next phase (UPKEEP->MAIN->COMBAT->END)
  end                    End your turn
  help                   Show this help
  quit                   Exit
`);
}

async function main() {
  const f1 = (process.argv && process.argv[2]) || 'decks/starter-aggro.json';
  const f2 = (process.argv && process.argv[3]) || 'decks/starter-control.json';

  const d1 = readDeck(f1, 0);
  const d2 = readDeck(f2, 1);

  // Quick deck checks
  const v1 = validateDeck(d1.list, (await import('./core-rules.ts')).CORE_RULES);
  const v2 = validateDeck(d2.list, (await import('./core-rules.ts')).CORE_RULES);
  if (!v1.ok) console.warn(`[Deck1 issues]\n- ${v1.issues.join('\n- ')}`);
  if (!v2.ok) console.warn(`[Deck2 issues]\n- ${v2.issues.join('\n- ')}`);

  const s = initGame(d1, d2);
  startTurn(s);
  // Move to MAIN after upkeep
  advancePhase(s); // MAIN

  const rl = readline.createInterface({ input, output });
  printHelp();

  while (true) {
    if (s.winner != null) {
      const w = s.players[s.winner];
      console.log(`Game over! Winner: ${w.name}`);
      break;
    }

    const pub = snapshotPublic(s);
    const cp = s.players[s.turn.active];
    const op = s.players[s.turn.active === 0 ? 1 : 0];
    const prompt = `[T${pub.turn.number} ${pub.turn.phase}] ${cp.name} (L${cp.life}/AP${cp.ap}) > `;
    const line = (await rl.question(prompt)).trim();
    const [cmd, ...args] = line.split(/\s+/);
    if (!cmd) continue;

    try {
      if (cmd === 'quit' || cmd === 'exit') break;
      if (cmd === 'help' || cmd === 'h') { printHelp(); continue; }
      if (cmd === 'status' || cmd === 'st') {
        console.log(`\n${cp.name}  Life=${cp.life} AP=${cp.ap}`);
        console.log(`  BF: ${cp.battlefield.map((id, i) => `${i}:${s.cards.get(id)!.card.name}`).join(', ') || '(empty)'}`);
        console.log(`${op.name}  Life=${op.life} AP=${op.ap}`);
        console.log(`  BF: ${op.battlefield.map((id, i) => `${i}:${s.cards.get(id)!.card.name}`).join(', ') || '(empty)'}`);
        console.log('Recent log:');
        for (const m of pub.log) console.log('  ' + m);
        console.log('');
        continue;
      }
      if (cmd === 'hand') {
        console.log(cp.hand.map((id, i) => `${i}: ${s.cards.get(id)!.card.name} [cost ${s.cards.get(id)!.card.cost.generic}]`).join('\n') || '(empty)');
        continue;
      }
      if (cmd === 'play') {
        if (s.turn.phase !== 'MAIN') { console.log('You can only cast during MAIN.'); continue; }
        const idx = Number(args[0]);
        const check = canCastFromHand(s, cp.idx, idx);
        if (!check.ok) { console.log(check.reason); continue; }
        const id = cp.hand[idx];
        const card = s.cards.get(id)!.card;
        let chosen: string[] | undefined;
        if (card.type !== 'Unit' && card.textIR?.cast) {
          if (card.textIR.cast.kind === 'DealDamage' || card.textIR.cast.kind === 'Heal' || card.textIR.cast.kind === 'Move') {
            const who = await rl.question('Target who? (self/opponent) default=opponent: ');
            const targetPlayer = (who.trim().toLowerCase() === 'self') ? cp.idx : op.idx;
            const bf = (targetPlayer === cp.idx) ? cp.battlefield : op.battlefield;
            if (bf.length === 0) { console.log('No unit targets available.'); continue; }
            const tIndex = Number(await rl.question(`Target unit index [0..${bf.length-1}]: `));
            if (Number.isNaN(tIndex) || tIndex < 0 || tIndex >= bf.length) { console.log('Invalid target.'); continue; }
            chosen = [bf[tIndex]];
          }
        }
        const res = castFromHand(s, cp.idx, idx, chosen);
        if (!res.ok) console.log(res.reason);
        continue;
      }
      if (cmd === 'atk') {
        if (s.turn.phase !== 'COMBAT') { console.log('You can only attack during COMBAT.'); continue; }
        const i = Number(args[0]);
        if (args[1] === 'player') {
          const r = attack(s, cp.idx, i, { kind: 'Player' });
          if (!r.ok) console.log(r.reason);
        } else if (args[1] === 'unit') {
          const j = Number(args[2]);
          const r = attack(s, cp.idx, i, { kind: 'Unit', index: j });
          if (!r.ok) console.log(r.reason);
        } else {
          console.log('Usage: atk <i> player | atk <i> unit <j>');
        }
        continue;
      }
      if (cmd === 'next') {
        if (s.turn.phase === 'END') {
          console.log('Already at END. Use end to pass turn.');
        } else {
          advancePhase(s);
        }
        continue;
      }
      if (cmd === 'end') {
        endTurn(s);
        startTurn(s);
        advancePhase(s); // to MAIN
        continue;
      }
      console.log('Unknown command. Type help');
    } catch (err: any) {
      console.error('Error:', err?.message || String(err));
    }
  }

  rl.close();
}

main().catch(e => { console.error(e?.stack || e?.message || String(e)); process.exit && process.exit(1); });
