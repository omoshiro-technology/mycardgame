// TCG Card Ability Text Generator (Japanese)
// Converts Card IR to human-readable Japanese text

import {
  type Card,
  type Effect,
  type ReplacementEffect,
  type Trigger,
  type ContinuousEffect,
  type Filter,
  type Condition,
  type Selector,
  type Value,
  type Metric,
  type Zone,
  type PlayerRef,
  type TriggerWhen,
  type CmpOp,
} from './schema.ts';

// ---------------- Helpers ----------------
function zoneToJP(zone: Zone): string {
  switch (zone) {
    case 'LIB': return 'ライブラリー';
    case 'HAND': return '手札';
    case 'BF': return '戦場';
    case 'GY': return '墓地';
    case 'EXILE': return '追放領域';
    case 'STACK': return 'スタック';
    default: { const _exhaustive: never = zone; return _exhaustive; }
  }
}

function playerToJP(ref: PlayerRef): string {
  switch (ref) {
    case 'SELF': return 'あなた';
    case 'OPP': return '対戦相手';
    default: { const _exhaustive: never = ref; return _exhaustive; }
  }
}

function eventToJP(event: TriggerWhen): string {
  switch (event) {
    case 'OnEnter': return '戦場に出たとき';
    case 'OnTokenCreated': return 'トークンが生成されたとき';
    case 'OnDraw': return 'カードを引いたとき';
    case 'OnDamageDealt': return 'ダメージを与えたとき';
    case 'OnAttack': return '攻撃したとき';
    case 'OnDeath': return '破壊されたとき';
    case 'OnCast': return '唱えたとき';
    case 'OnUpkeepStart': return 'アップキープ開始時';
    case 'OnNameMatched': return '名前が一致したとき';
    default: { const _exhaustive: never = event; return _exhaustive; }
  }
}

function cmpOpToJP(op: CmpOp): string {
  switch (op) {
    case '>=': return '以上';
    case '>': return 'より大きい';
    case '<=': return '以下';
    case '<': return '未満';
    case '==': return '等しい';
    case '!=': return '等しくない';
    default: { const _exhaustive: never = op; return _exhaustive; }
  }
}

// Metric/Value rendering
function metricToText(m: Metric): string {
  switch (m.kind) {
    case 'Const':
      return String(m.n);
    case 'CardStat': {
      const who = m.of === 'Self' ? 'これ' : '対象';
      const stat = m.stat === 'ATK' ? '攻撃力' : '体力';
      return `${who}の${stat}`;
    }
    case 'BoardCount': {
      const who = playerToJP(m.who);
      const zone = m.zone ? `${zoneToJP(m.zone)}の` : '';
      const tag = m.tag ? `「${m.tag}」` : 'カード';
      return `${who}の${zone}${tag}の数`;
    }
    case 'Life':
      return `${playerToJP(m.who)}のライフ`;
  }
  // Fallback (should be unreachable)
  const _exhaustive: never = m;
  return _exhaustive;
}

function valueToText(v: Value): string {
  switch (v.kind) {
    case 'Const':
      return String(v.n);
    case 'Clamp':
      return `${metricToText(v.of)}（最小${v.min}、最大${v.max}）`;
  }
  const _exhaustive: never = v;
  return _exhaustive;
}

// Predicate/Selector rendering
function predicateToText(filter: Filter): string {
  if (!filter) return '';
  switch (filter.kind) {
    case 'True':
      return '';
    case 'HasTag':
      return `「${filter.tag}」を持つ`;
    case 'HasAttribute': {
      const attr = (() => {
        switch (filter.attr) {
          case 'Element': return '属性';
          case 'Class': return 'クラス';
          case 'Species': return '種族';
          default: { const _exhaustive: never = filter.attr; return _exhaustive; }
        }
      })();
      return `${attr}が「${filter.value}」の`;
    }
    case 'HasName': {
      const text = filter.name.text;
      switch (filter.name.mode) {
        case 'Exact': return `「${text}」という名前の`;
        case 'Prefix': return `名前が「${text}」で始まる`;
        case 'Contains': return `名前に「${text}」を含む`;
        default: { const _exhaustive: never = filter.name.mode; return _exhaustive; }
      }
    }
    case 'IsToken':
      return 'トークン';
    case 'WasSummonedThisTurn':
      return 'このターンに召喚された';
    case 'HasCounter':
      return `${filter.counter}カウンターが${filter.atLeast}個以上ある`;
    case 'ControllerIs':
      return `${playerToJP(filter.who)}がコントロールしている`;
    case 'EventOccurred': {
      const emap = (() => {
        switch (filter.event) {
          case 'UnitDied': return 'ユニットが死亡';
          case 'TokenCreated': return 'トークンが生成';
          case 'SpellCast': return 'スペルが唱えられた';
          default: { const _exh: never = filter.event; return _exh; }
        }
      })();
      const period = filter.since === 'TURN' ? 'このターンに' : 'このゲームで';
      const who = filter.who ? `${playerToJP(filter.who)}が` : '';
      return `${period}${who}${emap}（${filter.atLeast}回以上）`;
    }
    case 'Cmp': {
      return `${metricToText(filter.left)}が${metricToText(filter.right)}に${cmpOpToJP(filter.op)}`;
    }
    case 'And':
      return filter.items.map((f: Filter) => predicateToText(f)).filter(Boolean).join('かつ');
    case 'Or':
      return filter.items.map((f: Filter) => predicateToText(f)).filter(Boolean).join('または');
    case 'Not':
      return `${predicateToText(filter.item)}でない`;
  }
  const _exhaustive: never = filter;
  return _exhaustive;
}

function selectorToText(sel?: Selector): string {
  if (!sel) return '';
  const owner = sel.owner ? `${playerToJP(sel.owner)}の` : '';
  const zone = sel.zone ? `${zoneToJP(sel.zone)}の` : '';
  const f = sel.filter ? predicateToText(sel.filter) : '';
  return `${owner}${zone}${f}`;
}

// ---------------- Effect/Ability rendering ----------------
function effectToText(effect: Effect): string {
  if (!effect) return '';
  switch (effect.kind) {
    case 'DealDamage': {
      const target = effect.target ? `${selectorToText(effect.target)}に` : '';
      return `${target}${valueToText(effect.amount)}点のダメージを与える`;
    }
    case 'PreventDamage': {
      const target = effect.target ? `${selectorToText(effect.target)}への` : '';
      const dur = effect.duration === 'EOT' ? 'ターン終了時まで' : '永続的に';
      return `${target}次の${valueToText(effect.amount)}点のダメージを軽減する（${dur}）`;
    }
    case 'Heal': {
      const target = effect.target ? `${selectorToText(effect.target)}を` : '';
      return `${target}${valueToText(effect.amount)}点回復する`;
    }
    case 'Draw':
      return `${playerToJP(effect.who)}はカードを${valueToText(effect.n)}枚引く`;
    case 'Mill':
      return `${playerToJP(effect.who)}はライブラリーの上から${valueToText(effect.n)}枚を墓地に置く`;
    case 'LookAtTop': {
      const chooseText = effect.choose
        ? `、その中から${effect.choose.keep}枚を選び、残りを${zoneToJP(effect.choose.moveRestTo)}に置く`
        : '';
      return `${playerToJP(effect.who)}はライブラリーの上から${effect.n}枚を見る${chooseText}`;
    }
    case 'CreateToken': {
      const stats = `${effect.atk}/${effect.hp}`;
      const tags = effect.tags?.length ? `「${effect.tags.join('」「')}」` : '';
      return `${playerToJP(effect.who)}は${stats}の${tags}トークンを生成する`;
    }
    case 'AddCounter': {
      const target = effect.target ? `${selectorToText(effect.target)}に` : 'これに';
      return `${target}${effect.counter}カウンターを${valueToText(effect.n)}個置く`;
    }
    case 'RemoveCounter': {
      const target = effect.target ? `${selectorToText(effect.target)}から` : 'これから';
      return `${target}${effect.counter}カウンターを${valueToText(effect.n)}個取り除く`;
    }
    case 'Buff': {
      const target = effect.target ? selectorToText(effect.target) : 'これ';
      const atk = typeof effect.atk === 'number' ? `+${effect.atk}` : '+0';
      const hp = typeof effect.hp === 'number' ? `+${effect.hp}` : '+0';
      const dur = effect.duration === 'EOT' ? 'ターン終了時まで' : '永続的に';
      return `${target}は${atk}/${hp}の修整を受ける（${dur}）`;
    }
    case 'Move': {
      const target = selectorToText(effect.target);
      return `${target}を${zoneToJP(effect.to)}に移動する`;
    }
    case 'ChangeController': {
      const target = selectorToText(effect.target);
      const who = playerToJP(effect.newController);
      const dur = effect.duration === 'EOT' ? 'ターン終了時まで' : '永続的に';
      return `${target}のコントロールを${who}が得る（${dur}）`;
    }
    case 'Transform': {
      const target = selectorToText(effect.target);
      return `${target}を変身させる`;
    }
    case 'CopyStats': {
      const from = selectorToText(effect.from);
      const to = selectorToText(effect.to);
      const clampText = effect.clamp ? `（攻撃力は${effect.clamp.atk[0]}〜${effect.clamp.atk[1]}、体力は${effect.clamp.hp[0]}〜${effect.clamp.hp[1]}）` : '';
      const dur = effect.duration === 'EOT' ? 'ターン終了時まで' : '永続的に';
      return `${to}は${from}の攻撃力/体力をコピーする${clampText}（${dur}）`;
    }
    case 'Conditional': {
      const cond = predicateToText(effect.if);
      const thenText = effectToText(effect.then);
      const elseText = effect.else ? `、そうでなければ${effectToText(effect.else)}` : '';
      return `${cond}、${thenText}${elseText}`;
    }
    case 'Case': {
      const branches = effect.branches
        .map((b: { when: Filter; do: Effect }) => `${predicateToText(b.when)}の場合、${effectToText(b.do)}`)
        .join('；');
      const elseCase = effect.else ? `；そうでなければ${effectToText(effect.else)}` : '';
      return branches + elseCase;
    }
    case 'ForEach': {
      const among = selectorToText(effect.among);
      const body = effectToText(effect.body);
      const max = effect.maxTargets ? `（最大${effect.maxTargets}体）` : '';
      return `${among}それぞれに対して${max}、${body}`;
    }
    case 'Sequence':
      return effect.steps.map((e: Effect) => effectToText(e)).join('。その後、');
    case 'Repeat':
      return `${effect.times}回、${effectToText(effect.body)}`;
    case 'NoOp':
      return '何もしない';
  }
  const _exhaustive: never = effect;
  return _exhaustive;
}

function triggerToText(trigger: Trigger): string {
  const whenText = eventToJP(trigger.when);
  const conditionText = trigger.condition ? predicateToText(trigger.condition) : '';
  const effectText = effectToText(trigger.effect);
  const limitText = trigger.limit ? `（${trigger.limit.per === 'TURN' ? '各ターン' : '各ゲーム'}${trigger.limit.times}回まで）` : '';
  const fullCondition = conditionText ? `、${conditionText}` : '';
  return `${whenText}${fullCondition}、${effectText}${limitText}`;
}

function continuousToText(ability: ContinuousEffect): string {
  switch (ability.kind) {
    case 'StaticBuff': {
      const targetText = ability.target ? selectorToText(ability.target) : 'これ';
      const atkBuff = typeof ability.atk === 'number' ? `+${ability.atk}` : '+0';
      const hpBuff = typeof ability.hp === 'number' ? `+${ability.hp}` : '+0';
      return `${targetText}は${atkBuff}/${hpBuff}の修整を受ける`;
    }
    case 'CostModifier': {
      const pred = predicateToText(ability.predicate);
      const delta = ability.delta;
      const action = delta >= 0 ? `${delta}増える` : `${-delta}減る`;
      const floor = ability.floor != null ? `（最低${ability.floor}）` : '';
      return `${pred}のコストは${action}${floor}`;
    }
  }
  // Exhaustive check to keep type safety when new variants are added
  const _exhaustive: never = ability as never;
  return _exhaustive;
}

function replacementToText(r: ReplacementEffect): string {
  const subject = r.subject ? selectorToText(r.subject) : '';
  const instead = effectToText(r.instead);
  const limit = r.limit ? `（${r.limit.per === 'TURN' ? '各ターン' : '各ゲーム'}${r.limit.times}回まで）` : '';
  let when = '';
  switch (r.when) {
    case 'WouldDraw': when = 'カードを引く代わりに'; break;
    case 'WouldDie': when = '破壊される代わりに'; break;
    case 'WouldBeDamaged': when = 'ダメージを受ける代わりに'; break;
    // Replacement when is a union; exhaustive now, keep the pattern.
    default: { const _exhaustive: never = r.when as never; return _exhaustive; }
  }
  return `${subject}が${when}、${instead}${limit}`;
}

// ---------------- Public API ----------------
export function generateAbilityText(card: Card): string[] {
  const abilities: string[] = [];

  // Keywords
  if (card.keywords && card.keywords.length > 0) {
    const keywordMap: Record<string, string> = {
      Flying: '飛行',
      Vigilance: '警戒',
      Haste: '速攻',
      FirstStrike: '先制攻撃',
      Lifelink: '絆魂',
      Deathtouch: '接死',
      Trample: 'トランプル',
      Reach: '到達',
      Defender: '防衛',
      Hexproof: '呪禁',
      Indestructible: '破壊不能',
      Menace: '威迫',
    } as const;
    abilities.push(...card.keywords.map((k) => keywordMap[k] || k));
  }

  const ir = card.textIR;
  if (!ir) return abilities;

  if (ir.cast) {
    abilities.push(`【唱えたとき】${effectToText(ir.cast)}`);
  }
  if (ir.triggers) {
    abilities.push(...ir.triggers.map((t) => `【トリガー】${triggerToText(t)}`));
  }
  if (ir.continuous) {
    abilities.push(...ir.continuous.map((c) => `【常在】${continuousToText(c)}`));
  }
  if (ir.replacements) {
    abilities.push(...ir.replacements.map((r) => `【置換】${replacementToText(r)}`));
  }

  return abilities;
}

export function cardToJapaneseJSON(card: Card): object {
  const abilities = generateAbilityText(card);
  return {
    name: card.name,
    canonicalName: card.canonicalName,
    cost: {
      generic: card.cost.generic,
      colors: card.cost.colors?.map((c) => {
        const colorMap: Record<string, string> = {
          White: '白',
          Blue: '青',
          Black: '黒',
          Red: '赤',
          Green: '緑',
        };
        return colorMap[c] || c;
      }) || [],
    },
    type: card.type === 'Unit' ? 'ユニット' : 'スペル',
    stats: card.stats ? { atk: card.stats.atk, hp: card.stats.hp } : undefined,
    tags: card.tags || [],
    attributes: card.attributes || {},
    abilities,
    rarity: card.rarity,
    flavorText: `${card.name}の力は、その名が示す通りである。`,
  };
}
