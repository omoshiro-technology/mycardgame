#!/usr/bin/env tsx
// AI vs AI battle script for testing game integrity

import fs from 'node:fs';
import path from 'node:path';
declare const process: {
  argv?: string[];
  exit?: (code?: number) => never;
  env: Record<string, string | undefined>;
};
import { initGame, loadDeck, validateDeck, startTurn, advancePhase, endTurn, castFromHand, canCastFromHand, attack, snapshotPublic, type DeckEntry, type PlayerState, type GameState, type PlayerIndex } from './engine.ts';
import type { Card, Effect, Value } from './schema.ts';

type DeckFile = { name?: string; cards: { card: Card; count: number }[] };

type CardAnalysis = {
  index: number;
  card: Card;
  cardId: string;
  priority: number;
  reasons: string[];
};

type TargetInfo = {
  id: string;
  idx: number;
  threat: number;
  card: Card;
};

type UnitInfo = {
  id: string;
  idx: number;
  value: number;
  card: Card;
};

// Card analysis and display functions
function valueToNumber(v: Value | undefined): number {
  if (!v) return 0;
  if (v.kind === 'Const') return v.n;
  if (v.kind === 'Clamp') return Math.max(v.min, Math.min(v.max, 0));
  return 0;
}

function getCardDescription(card: Card): string {
  let desc = `${card.name} [${card.cost.generic}]`;
  
  if (card.type === 'Unit') {
    const atk = card.stats?.atk ?? 0;
    const hp = card.stats?.hp ?? 0;
    desc += ` ${atk}/${hp}`;
  }
  
  if (card.textIR?.cast) {
    const cast = card.textIR.cast;
    switch (cast.kind) {
      case 'DealDamage': {
        const n = valueToNumber(cast.amount);
        desc += ` (Deal ${n} damage)`; break;
      }
      case 'Heal': {
        const n = valueToNumber(cast.amount);
        desc += ` (Heal ${n})`; break;
      }
      case 'Draw': {
        const n = valueToNumber(cast.n);
        desc += ` (Draw ${n})`; break;
      }
      case 'Move': {
        desc += ` (Move target to ${cast.to})`; break;
      }
      default:
        desc += ` (${cast.kind})`;
    }
  }
  
  return desc;
}

function analyzeCardValue(card: Card, gameState: GameState, playerIdx: PlayerIndex, strategy: string): { value: number, reasons: string[] } {
  const player = gameState.players[playerIdx];
  const opponent = gameState.players[playerIdx === 0 ? 1 : 0];
  let value = 0;
  const reasons: string[] = [];
  
  // Base card evaluation
  if (card.type === 'Unit') {
    const atk = card.stats?.atk ?? 0;
    const hp = card.stats?.hp ?? 0;
    const statTotal = atk + hp;
    value += statTotal * 3;
    reasons.push(`Unit stats: ${statTotal} total`);
    
    if (strategy === 'aggressive' || strategy === 'early_game') {
      value += atk * 2;
      reasons.push(`Aggressive: +${atk * 2} for power`);
    }
    
    if (strategy === 'defensive' && hp >= atk) {
      value += hp * 2;
      reasons.push(`Defensive: +${hp * 2} for toughness`);
    }
  } else {
    // Spell evaluation
    if (card.textIR?.cast) {
      const cast = card.textIR.cast;
      if (cast.kind === 'DealDamage') {
        const damage = valueToNumber(cast.amount);
        value += damage * 4;
        if (strategy === 'aggressive') value += damage * 2;
        reasons.push(`Damage: ${damage} (${strategy === 'aggressive' ? 'aggressive bonus' : 'base'})`);
      } else if (cast.kind === 'Heal') {
        const heal = valueToNumber(cast.amount);
        value += heal * 2;
        if (strategy === 'defensive') value += heal * 3;
        reasons.push(`Heal: ${heal} (${strategy === 'defensive' ? 'defensive bonus' : 'base'})`);
      } else if (cast.kind === 'Move') {
        value += opponent.battlefield.length > 0 ? 15 : 3;
        reasons.push(`Move: ${opponent.battlefield.length > 0 ? 'has targets' : 'no targets'}`);
      } else if (cast.kind === 'Draw') {
        const n = valueToNumber(cast.n);
        value += n * 3;
        reasons.push(`Draw: ${n} cards`);
      }
    }
  }
  
  // Mana curve considerations
  if (card.cost.generic <= player.ap) {
    value += 5;
    reasons.push(`Playable with ${player.ap} AP`);
  }
  
  if (card.cost.generic === player.ap) {
    value += 3;
    reasons.push(`Perfect mana use`);
  }
  
  return { value, reasons };
}

function readDeck(file: string, ownerIdx: 0|1) {
  const p = path.resolve(file);
  const raw = fs.readFileSync(p, 'utf8');
  const json: DeckFile = JSON.parse(raw);
  const loaded = loadDeck(json, ownerIdx);
  return loaded;
}

// Enhanced AI with multiple strategies
function makeAIMove(gameState: GameState, playerIdx: PlayerIndex) {
  const player = gameState.players[playerIdx];
  const opponent = gameState.players[playerIdx === 0 ? 1 : 0];
  
  if (gameState.turn.phase === 'MAIN') {
    // Analyze game state for strategic decisions
    const myLife = player.life;
    const enemyLife = opponent.life;
    const myBoardSize = player.battlefield.length;
    const enemyBoardSize = opponent.battlefield.length;
    const myAP = player.ap;
    const turnNumber = gameState.turn.number;
    
    // Strategy selection based on game state
    let strategy = 'balanced';
    if (myLife <= 10 && enemyLife > 10) strategy = 'defensive';
    else if (enemyLife <= 10) strategy = 'aggressive';
    else if (turnNumber <= 5) strategy = 'early_game';
    else if (myBoardSize >= enemyBoardSize + 2) strategy = 'dominant';
    
    console.log(`${player.name} strategy: ${strategy} (Life: ${myLife}/${enemyLife}, Board: ${myBoardSize}/${enemyBoardSize})`);
    
    // Show hand with detailed card information
    console.log(`\n${player.name}'s Hand:`);
    player.hand.forEach((cardId: string, index: number) => {
      const card = gameState.cards.get(cardId)!.card;
      console.log(`  [${index}] ${getCardDescription(card)}`);
    });
    
    // Create prioritized card list with detailed analysis
    const handWithAnalysis = player.hand.map((cardId: string, index: number) => {
      const card = gameState.cards.get(cardId)!.card;
      const analysis = analyzeCardValue(card, gameState, playerIdx, strategy);
      
      return { 
        index, 
        card, 
        cardId,
        priority: analysis.value, 
        reasons: analysis.reasons 
      };
    }).sort((a: CardAnalysis, b: CardAnalysis) => b.priority - a.priority);
    
    console.log(`\nCard Evaluation (${strategy} strategy):`);
    handWithAnalysis.forEach(({ card, priority, reasons }: CardAnalysis, i: number) => {
      if (i < 3) { // Show top 3 cards
        console.log(`  ${card.name}: ${priority} points - ${reasons.join(', ')}`);
      }
    });
    
    // Try to play cards in priority order
    for (const { index, card, cardId, priority, reasons } of handWithAnalysis) {
      const check = canCastFromHand(gameState, playerIdx, index);
      if (!check.ok) {
        console.log(`  Cannot play ${card.name}: ${check.reason}`);
        continue;
      }
      
      let chosen: string[] | undefined;
      let targetInfo = '';
      
      // Smart targeting for spells
      if (card.type !== 'Unit' && card.textIR?.cast) {
        if (card.textIR.cast.kind === 'DealDamage' || card.textIR.cast.kind === 'Move') {
          // Show opponent board for targeting decisions
          if (opponent.battlefield.length > 0) {
            console.log(`  Enemy battlefield:`);
            opponent.battlefield.forEach((id: string, idx: number) => {
              const targetCard = gameState.cards.get(id)!.card;
              console.log(`    [${idx}] ${getCardDescription(targetCard)}`);
            });
          }
          
          // Target selection priority: biggest threat, then lowest health
          const targets = opponent.battlefield.map((id: string, idx: number) => {
            const targetCard = gameState.cards.get(id)!.card;
            const threat = (targetCard.stats?.atk ?? 0) + (targetCard.stats?.hp ?? 0);
            return { id, idx, threat, card: targetCard };
          }).sort((a: TargetInfo, b: TargetInfo) => b.threat - a.threat);
          
          if (targets.length > 0) {
            chosen = [targets[0].id];
            targetInfo = ` targeting ${targets[0].card.name} (threat: ${targets[0].threat})`;
          } else if (strategy === 'aggressive') {
            console.log(`  Skipping ${card.name} - no targets and aggressive strategy`);
            continue;
          }
        } else if (card.textIR.cast.kind === 'Heal') {
          // Target our most damaged or valuable unit
          const myUnits = player.battlefield.map((id: string, idx: number) => {
            const unitCard = gameState.cards.get(id)!.card;
            const value = (unitCard.stats?.atk ?? 0) + (unitCard.stats?.hp ?? 0);
            return { id, idx, value, card: unitCard };
          }).sort((a: UnitInfo, b: UnitInfo) => b.value - a.value);
          
          if (myUnits.length > 0) {
            chosen = [myUnits[0].id];
            targetInfo = ` targeting ${myUnits[0].card.name} (value: ${myUnits[0].value})`;
          } else {
            console.log(`  Skipping ${card.name} - no targets to heal`);
            continue;
          }
        }
      }
      
      const res = castFromHand(gameState, playerIdx, index, chosen);
      if (res.ok) {
        console.log(`\n✓ ${player.name} plays ${getCardDescription(card)}${targetInfo}`);
        console.log(`  Reasoning: ${reasons.join(', ')} (${priority} points)`);
        
        // Try to play another card if we have AP left
        if (player.ap > 0) {
          console.log(`  Remaining AP: ${player.ap}, checking for more plays...`);
          continue;
        }
        return true;
      }
    }
    
    // If no cards to play, advance to combat
    advancePhase(gameState);
    return true;
  }
  
  if (gameState.turn.phase === 'COMBAT') {
    // Strategic combat decisions
    const myLife = player.life;
    const enemyLife = opponent.life;
    const myBoardSize = player.battlefield.length;
    const enemyBoardSize = opponent.battlefield.length;
    
    console.log(`\n--- ${player.name} Combat Phase ---`);
    console.log(`My battlefield:`);
    player.battlefield.forEach((id: string, idx: number) => {
      const unitCard = gameState.cards.get(id)!.card;
      const unit = gameState.cards.get(id)!;
      const sick = unit.turnEntered === gameState.turn.number;
      const status = sick ? '(sick)' : '(ready)';
      console.log(`  [${idx}] ${getCardDescription(unitCard)} ${status}`);
    });
    
    if (opponent.battlefield.length > 0) {
      console.log(`Enemy battlefield:`);
      opponent.battlefield.forEach((id: string, idx: number) => {
        const unitCard = gameState.cards.get(id)!.card;
        console.log(`  [${idx}] ${getCardDescription(unitCard)}`);
      });
    }
    
    let attacked = false;
    for (let i = 0; i < player.battlefield.length; i++) {
      const unitId = player.battlefield[i];
      const unit = gameState.cards.get(unitId);
      
      if (unit && unit.turnEntered !== gameState.turn.number) { // Not summoning sick
        const unitCard = unit.card;
        const myPower = unitCard.stats?.atk ?? 0;
        const myToughness = unitCard.stats?.hp ?? 0;
        
        // Analyze attack options
        console.log(`\nAnalyzing attack with ${unitCard.name} (${myPower}/${myToughness}):`);
        
        // Decide attack target based on board state
        let shouldAttackPlayer = true;
        let bestTarget = null;
        let bestValue = 0;
        let bestReason = `Face damage: ${myPower} (enemy at ${enemyLife})`;
        
        // Evaluate attacking enemy units
        const tradeAnalysis: Array<{target: any, value: number, reason: string}> = [];
        
        for (let j = 0; j < opponent.battlefield.length; j++) {
          const enemyUnitId = opponent.battlefield[j];
          const enemyUnit = gameState.cards.get(enemyUnitId);
          if (!enemyUnit) continue;
          
          const enemyCard = enemyUnit.card;
          const enemyPower = enemyCard.stats?.atk ?? 0;
          const enemyToughness = enemyCard.stats?.hp ?? 0;
          
          // Calculate trade value
          let tradeValue = 0;
          let reasons = [];
          
          if (myPower >= enemyToughness) {
            tradeValue += enemyPower + enemyToughness; // Value of killing enemy unit
            reasons.push(`Kill ${enemyCard.name} (+${enemyPower + enemyToughness})`);
            
            if (enemyPower < myToughness) {
              tradeValue += 5; // Bonus for surviving the trade
              reasons.push(`Survive trade (+5)`);
            } else if (enemyPower >= myToughness) {
              reasons.push(`Die in trade`);
            }
          } else {
            reasons.push(`Can't kill (${myPower} < ${enemyToughness})`);
          }
          
          // Prioritize removing threats when defensive or even board
          if ((myLife <= enemyLife || myBoardSize <= enemyBoardSize) && enemyPower > 0) {
            const threatBonus = enemyPower * 2;
            tradeValue += threatBonus;
            reasons.push(`Threat removal (+${threatBonus})`);
          }
          
          const tradeReason = reasons.join(', ');
          tradeAnalysis.push({
            target: { kind: 'Unit' as const, index: j },
            value: tradeValue,
            reason: `vs ${enemyCard.name}: ${tradeReason} = ${tradeValue}`
          });
          
          if (tradeValue > bestValue) {
            bestValue = tradeValue;
            bestTarget = { kind: 'Unit' as const, index: j };
            bestReason = tradeReason;
            shouldAttackPlayer = false;
          }
        }
        
        // Show all options
        console.log(`  Face: ${myPower} damage (${enemyLife} -> ${enemyLife - myPower})`);
        tradeAnalysis.forEach(analysis => {
          console.log(`  ${analysis.reason}`);
        });
        
        // Override: Always go face if enemy is low and we can win
        if (enemyLife <= myPower) {
          shouldAttackPlayer = true;
          bestTarget = null;
          bestReason = `LETHAL: ${myPower} damage kills enemy`;
        }
        
        // Execute attack
        const target = shouldAttackPlayer ? { kind: 'Player' as const } : bestTarget;
        if (target) {
          const res = attack(gameState, playerIdx, i, target);
          if (res.ok) {
            const targetName = target.kind === 'Player' ? 'opponent' : 
              gameState.cards.get(opponent.battlefield[target.index])?.card.name || 'enemy unit';
            console.log(`✓ ${unitCard.name} attacks ${targetName} - ${bestReason}`);
            attacked = true;
          }
        }
      }
    }
    
    // Advance to end phase
    advancePhase(gameState);
    return true;
  }
  
  if (gameState.turn.phase === 'END') {
    // End turn
    endTurn(gameState);
    startTurn(gameState);
    advancePhase(gameState); // to MAIN
    return true;
  }
  
  return false;
}

async function runAIBattle() {
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
  advancePhase(s); // to MAIN

  console.log(`=== AI Battle Started ===`);
  console.log(`Player 1: ${s.players[0].name}`);
  console.log(`Player 2: ${s.players[1].name}`);
  console.log('');

  let turnCount = 0;
  const maxTurns = 100; // Safety limit

  while (s.winner == null && turnCount < maxTurns) {
    const pub = snapshotPublic(s);
    const cp = s.players[s.turn.active];
    const op = s.players[s.turn.active === 0 ? 1 : 0];
    
    // Show game state every few turns
    if (turnCount % 5 === 0 || cp.life <= 10) {
      console.log(`\n--- Turn ${pub.turn.number} (${pub.turn.phase}) ---`);
      console.log(`${cp.name}: Life=${cp.life}, AP=${cp.ap}, Hand=${cp.hand.length}, BF=${cp.battlefield.length}`);
      console.log(`${op.name}: Life=${op.life}, AP=${op.ap}, Hand=${op.hand.length}, BF=${op.battlefield.length}`);
    }

    // Make AI move
    const moved = makeAIMove(s, s.turn.active);
    if (!moved) {
      console.log(`AI ${cp.name} couldn't make a move, advancing phase`);
      if (s.turn.phase === 'END') {
        endTurn(s);
        startTurn(s);
        advancePhase(s);
      } else {
        advancePhase(s);
      }
    }

    // Check for new turn
    if (s.turn.phase === 'UPKEEP') {
      turnCount++;
    }
  }

  if (s.winner != null) {
    const winner = s.players[s.winner];
    console.log(`\n=== GAME OVER ===`);
    console.log(`Winner: ${winner.name}`);
    console.log(`Final state:`);
    console.log(`${s.players[0].name}: Life=${s.players[0].life}`);
    console.log(`${s.players[1].name}: Life=${s.players[1].life}`);
    console.log(`Total turns: ${turnCount}`);
  } else {
    console.log(`\n=== GAME TIMEOUT ===`);
    console.log(`Reached maximum ${maxTurns} turns without conclusion`);
  }
}

runAIBattle().catch(e => { 
  console.error('Battle error:', e?.stack || e?.message || String(e)); 
  process.exit && process.exit(1); 
});
