// Builds the Markdown rulebook by introspecting zod schemas (types)
// and embedding constant (non-type) rules from core-rules.ts.

import {
  ZoneZ,
  PhaseZ,
  CardTypeZ,
  ReplacementEffectZ,
  TriggerWhenZ,
  ContinuousEffectZ,
  EffectZ,
  DurationZ,
  ValueZ,
  MetricZ,
  PredicateZ,
  type Card,
  type Value,
  type Metric,
  type Predicate,
  type Effect,
  type TriggerWhen,
  type ReplacementEffect,
  type ContinuousEffect,
  type Duration,
} from './schema.ts';
import { CORE_RULES } from './core-rules.ts';
import type { GlobalAnalysis } from './analysis.ts';
import { analyzeRules } from './rules-verifier.ts';

function header(title: string, level = 2) {
  return `${'#'.repeat(level)} ${title}\n\n`;
}

function bullet(items: string[]) { return items.map((s) => `- ${s}`).join('\n') + (items.length ? '\n\n' : '\n'); }

function enumValues(zEnum: any): string[] {
  // zod enum exposes .options
  if (Array.isArray(zEnum?.options)) return zEnum.options as string[];
  // fallback: v4 compat
  if (Array.isArray(zEnum?._def?.values)) return zEnum._def.values as string[];
  return [];
}

function listDiscriminantKinds(zType: any): string[] {
  const resolved = typeof zType?._def?.getter === 'function' ? zType._def.getter() : zType;
  const optMap: Map<string, any> | undefined = resolved?.optionsMap;
  if (optMap && typeof optMap.size === 'number') {
    return Array.from(optMap.keys());
  }
  const opts = resolved?._def?.options ?? resolved?.options ?? [];
  const kinds: string[] = [];
  for (const opt of opts) {
    try {
      const shape = typeof opt?._def?.shape === 'function' ? opt._def.shape() : opt?._def?.shape;
      const kindLit = shape?.kind?._def?.value;
      if (typeof kindLit === 'string') kinds.push(kindLit);
    } catch {}
  }
  return Array.from(new Set(kinds));
}

// Friendly display helpers
const zoneNameJP: Record<string, string> = {
  LIB: 'ライブラリー',
  HAND: '手札',
  BF: '戦場',
  GY: '墓地',
  EXILE: '追放領域',
  STACK: 'スタック',
};

const phaseNameJP: Record<string, string> = {
  UPKEEP: 'アップキープ',
  MAIN: 'メイン',
  COMBAT: '戦闘',
  END: 'エンド',
};

const cardTypeJP: Record<string, string> = {
  Unit: 'ユニット',
  Spell: 'スペル',
  Artifact: 'アーティファクト',
  Enchantment: 'エンチャント',
};

// Typed checklist the rulebook promises to cover
export const RULEBOOK_REQUIRED_KEYS = [
  'turns.phases',
  'turns.drawOnTurnStart',
  'actions.usesStack',
  'actions.simultaneousTriggersOrder',
  'actions.illegalTargetFizzle',
  'build.startingLife',
  'build.startingHand',
  'build.maxHandSize',
  'build.minDeckSize',
  'build.maxCopiesPerName',
  'mulligan.kind',
  'tokens.tokensLeaveTo',
  'resources.mode',
  'resources.name',
  'resources.perTurnGainBase',
  'resources.carryOver',
  'resources.maxPool',
  'resources.payment',
  'resources.colors.policy',
  'resources.colors.symbols',
  'combat.canBlock',
  'combat.summoningSickness',
  'combat.attackerTargets',
  'damage.lethalAt',
  'win.lifeZeroLoss',
  'win.drawFromEmptyLoss',
] as const;
export type RulebookKey = typeof RULEBOOK_REQUIRED_KEYS[number];

export type RulebookBuild = { markdown: string; covered: Set<RulebookKey> };

export function buildRulebook(global?: GlobalAnalysis): RulebookBuild {
  let md = '';
  const covered: Set<RulebookKey> = new Set();
  const cover = (k: RulebookKey) => { covered.add(k); };

  const exhaustive = (x: never): never => { throw new Error(`Unreachable case: ${String(x)}`); };

  // Title
  md += `# 公式ルールブック（自動生成）\n\n`;
  md += `このドキュメントは型情報とプログラム定数から生成された、プレイ用のルールです。\n`;
  md += `ゲームデザイン上の調整値はコードで一貫管理され、カード相互作用の安全性は自動検証されています。\n\n`;

  // What you need
  md += header('ゲームの目的');
  md += bullet([
    CORE_RULES.win.lifeZeroLoss
      ? '対戦相手のライフを0以下にして勝利する' : '勝利条件はシナリオに従う',
  ]);

  md += header('準備');
  md += bullet([
    `各プレイヤーは自分のデッキ（最低${CORE_RULES.build.minDeckSize}枚、同名は最大${CORE_RULES.build.maxCopiesPerName}枚）を用意する`,
    `各プレイヤーの初期ライフは${CORE_RULES.build.startingLife}`,
    `各プレイヤーは初期手札として${CORE_RULES.build.startingHand}枚引く`,
    (() => {
      const m = CORE_RULES.mulligan;
      switch (m.kind) {
        case 'FreeOnce': return 'ムリガン: 最初の引き直しは無料。以降は引く枚数が1枚ずつ減る';
        case 'DrawOneLess': return 'ムリガン: 引き直すたびに初期手札枚数より1枚少なく引く';
        case 'London': return `ムリガン（ロンドン）: 手札を引き直した後、${m.bottomCount}枚をライブラリーの下に置く`;
        default: return exhaustive(m);
      }
    })(),
  ]);
  cover('build.minDeckSize'); cover('build.maxCopiesPerName'); cover('build.startingLife'); cover('build.startingHand'); cover('mulligan.kind');

  md += header('ターンの流れ');
  const phases = enumValues(PhaseZ).map((p) => phaseNameJP[p] || p);
  md += bullet([
    `ターンの開始時に${CORE_RULES.turns.drawOnTurnStart ? 'カードを1枚引く' : 'ドローしない'}`,
    `フェイズ順序: ${phases.join(' → ')}`,
    CORE_RULES.actions.usesStack
      ? 'アクションはスタックで解決（後入れ先出し）。各フェイズ中、プレイヤーは交互に行動できる' : 'アクションは宣言順に即時解決',
    (() => {
      const o = CORE_RULES.actions.simultaneousTriggersOrder;
      switch (o) {
        case 'ControllerChooses': return '同時に誘発した能力の処理順はコントローラーが選ぶ';
        case 'ActivePlayerFirst': return '同時に誘発した能力の処理順はアクティブ・プレイヤーが優先される';
        default: return exhaustive(o);
      }
    })(),
  ]);
  cover('turns.drawOnTurnStart'); cover('turns.phases'); cover('actions.usesStack'); cover('actions.simultaneousTriggersOrder');

  md += header('カードの種類');
  const types = enumValues(CardTypeZ).map((t) => cardTypeJP[t] || t);
  md += bullet([
    `${types.join(' / ')}`,
    'ユニット: 攻撃力/体力（ATK/HP）を持ち、戦場に残る',
    'スペル: 効果を解決して墓地へ置く（特別な記載がない限り）',
    'アーティファクト/エンチャント: 戦場に残り、継続的な効果や能力を与える',
  ]);

  md += header('ゾーン');
  const zones = enumValues(ZoneZ).map((z) => zoneNameJP[z] || z);
  md += bullet([
    `主なゾーン: ${zones.join(' / ')}`,
    '戦場にあるカードは「場に出ている」状態',
    (() => { const t = CORE_RULES.tokens.tokensLeaveTo; switch (t) { case 'GY': return 'トークンが場を離れたら墓地へ'; case 'EXILE': return 'トークンが場を離れたら追放へ'; default: return exhaustive(t); } })(),
  ]);
  cover('tokens.tokensLeaveTo');

  md += header('トークン');
  md += bullet([
    'トークンはカードの効果で生成される一時的なユニット',
    '通常のユニットと同様に攻撃・ダメージ・破壊の影響を受ける',
    '手札やライブラリーには置かれず、戦場から離れると即座に消滅扱い（墓地/追放に置かれたあと存在しなくなる）',
    'このターンに生成されたトークンにも召喚酔いは適用される',
  ]);

  md += header('カードのプレイ');
  md += bullet([
    '自分のメインフェイズにコストを支払ってカードを唱える',
    '対象がある効果は宣言時に対象を選ぶ',
    CORE_RULES.actions.illegalTargetFizzle
      ? '解決時にすべての対象が不適正になった場合、その効果は不発' : '可能な範囲で解決を続行',
  ]);
  cover('actions.illegalTargetFizzle');

  md += header('コストとリソース');
  const R = CORE_RULES.resources;
  md += bullet([
    (() => { const m = R.mode; switch (m) { case 'ActionPoints': return 'リソースモード: アクションポイント方式'; default: return exhaustive(m as never); } })(),
    `${R.name}は各ターン開始時に${R.perTurnGainBase}増える（${R.carryOver ? '未使用分は持ち越す' : '未使用分はターン終了時に失われる'}）`,
    R.maxPool ? `保持できる${R.name}の上限は${R.maxPool}` : `保持できる${R.name}の上限は特にない`,
    (() => { const p = R.payment; switch (p) { case 'GenericOnly': return 'カードのコストは汎用コスト（generic）で支払う'; case 'GenericAndColors': return 'カードの汎用コストに加えて色コストも支払う'; default: return exhaustive(p); } })(),
    (() => { const pol = R.colors.policy; switch (pol) { case 'DeckOnly': return `色（${R.colors.symbols.join(', ')}）はデッキ構築上の所属を示すのみで、支払いには不要`; case 'InGamePayment': return `色（${R.colors.symbols.join(', ')}）のコストを支払うには、対応する色の手段を用意する（カードの効果など）`; default: return exhaustive(pol); } })(),
  ]);
  cover('resources.mode'); cover('resources.name'); cover('resources.perTurnGainBase'); cover('resources.carryOver'); cover('resources.maxPool'); cover('resources.payment'); cover('resources.colors.policy'); cover('resources.colors.symbols');

  md += header('戦闘');
  md += bullet([
    CORE_RULES.combat.canBlock
      ? '防御側はブロッカーを宣言できる' : 'ブロックは存在しない（攻撃は妨げられない）',
    CORE_RULES.combat.summoningSickness
      ? 'このターンに出たユニットは攻撃できない' : '召喚酔いはない',
    (() => { const a = CORE_RULES.combat.attackerTargets; switch (a) { case 'PlayerOrUnit': return '攻撃ユニットは対戦相手か相手のユニットを攻撃対象として選ぶ'; case 'PlayerOnly': return '攻撃は対戦相手のみを対象にする'; case 'UnitOnly': return '攻撃は相手のユニットのみを対象にする'; default: return exhaustive(a); } })(),
    '攻撃力分のダメージを与える。ダメージはそのターン中、ユニットに残る',
    `ユニットの体力が${CORE_RULES.damage.lethalAt}以下になったら破壊される`,
  ]);
  cover('combat.canBlock'); cover('combat.summoningSickness'); cover('combat.attackerTargets'); cover('damage.lethalAt');

  md += header('能力と効果');
  md += bullet([
    '唱えたときの効果: カードを唱えるとただちに解決する効果',
    'トリガー能力: 「～したとき」などの条件で誘発する能力',
    '常在能力: 戦場にある限り継続する効果や修整',
    '置換効果: 「～する代わりに」特定の出来事を置き換える効果（同じ出来事を再発生させる置換は禁止）',
  ]);

  // -- Typed IR reference (exhaustive switch mappers) --
  const labelValueKind = (k: Value['kind']): string => {
    switch (k) {
      case 'Const': return 'Const: 定数値 n を参照する';
      case 'Clamp': return 'Clamp: メトリクスを[min,max]で丸める';
      default: return exhaustive(k);
    }
  };
  const labelMetricKind = (k: Metric['kind']): string => {
    switch (k) {
      case 'Const': return 'Const: 定数値';
      case 'CardStat': return 'CardStat: （対象/自身）のATK/HPを参照する';
      case 'BoardCount': return 'BoardCount: 指定ゾーン/タグの枚数を数える';
      case 'Life': return 'Life: プレイヤーのライフを参照する';
      default: return exhaustive(k);
    }
  };
  const labelPredicateKind = (k: Predicate['kind']): string => {
    switch (k) {
      case 'True': return 'True: 常に真';
      case 'HasTag': return 'HasTag: 指定タグを持つ';
      case 'HasAttribute': return 'HasAttribute: 指定属性（Element/Class/Species）を持つ';
      case 'HasName': return 'HasName: 名称が一致/前方一致/部分一致する';
      case 'IsToken': return 'IsToken: トークンである';
      case 'WasSummonedThisTurn': return 'WasSummonedThisTurn: このターンに登場した';
      case 'HasCounter': return 'HasCounter: 指定カウンターをN個以上持つ';
      case 'ControllerIs': return 'ControllerIs: コントローラーがSELF/OPPである';
      case 'EventOccurred': return 'EventOccurred: 直近(TURN/GAME)でイベントがN回以上起きた';
      case 'Cmp': return 'Cmp: メトリクス間の比較（>=, >, <=, <, ==, !=）';
      case 'And': return 'And: すべての条件が真';
      case 'Or': return 'Or: いずれかの条件が真';
      case 'Not': return 'Not: 条件の否定';
      default: return exhaustive(k);
    }
  };
  const labelEffectKind = (k: Effect['kind']): string => {
    switch (k) {
      case 'DealDamage': return 'DealDamage: 対象にダメージを与える';
      case 'PreventDamage': return 'PreventDamage: 対象へのダメージを軽減/防止（期間）';
      case 'Heal': return 'Heal: 対象を回復する';
      case 'Draw': return 'Draw: カードを引く';
      case 'Mill': return 'Mill: ライブラリーから墓地へ送る';
      case 'LookAtTop': return 'LookAtTop: ライブラリーの上を見て選ぶ';
      case 'CreateToken': return 'CreateToken: トークンを生成する（ATK/HP/タグ）';
      case 'AddCounter': return 'AddCounter: カウンターを置く';
      case 'RemoveCounter': return 'RemoveCounter: カウンターを取り除く';
      case 'Buff': return 'Buff: 一時/永続のATK/HP修整';
      case 'Move': return 'Move: 対象を指定ゾーンに移動';
      case 'ChangeController': return 'ChangeController: コントロールを変更（期間）';
      case 'Transform': return 'Transform: 別の姿に変化';
      case 'CopyStats': return 'CopyStats: 能力値をコピー（クランプ付き）';
      case 'Conditional': return 'Conditional: if/then/else 条件分岐';
      case 'Case': return 'Case: 複数の条件分岐';
      case 'ForEach': return 'ForEach: 複数対象に繰り返し適用';
      case 'Sequence': return 'Sequence: 複数効果を順番に実行';
      case 'Repeat': return 'Repeat: 効果を回数分繰り返し';
      case 'NoOp': return 'NoOp: 何もしない';
      default: return exhaustive(k);
    }
  };
  const labelTriggerWhen = (w: TriggerWhen): string => {
    switch (w) {
      case 'OnCast': return 'OnCast: 呪文を唱えたとき';
      case 'OnEnter': return 'OnEnter: 戦場に出たとき';
      case 'OnAttack': return 'OnAttack: 攻撃したとき';
      case 'OnDamageDealt': return 'OnDamageDealt: ダメージを与えたとき';
      case 'OnDeath': return 'OnDeath: 破壊/死亡したとき';
      case 'OnTokenCreated': return 'OnTokenCreated: トークンが生成されたとき';
      case 'OnDraw': return 'OnDraw: カードを引いたとき';
      case 'OnUpkeepStart': return 'OnUpkeepStart: アップキープ開始時';
      case 'OnNameMatched': return 'OnNameMatched: 指定名に一致したとき';
      default: return exhaustive(w);
    }
  };
  const labelReplacementWhen = (w: ReplacementEffect['when']): string => {
    switch (w) {
      case 'WouldDie': return 'WouldDie: 破壊される代わりに';
      case 'WouldBeDamaged': return 'WouldBeDamaged: ダメージを受ける代わりに';
      case 'WouldDraw': return 'WouldDraw: ドローする代わりに';
      default: return exhaustive(w);
    }
  };
  const labelContinuousKind = (k: ContinuousEffect['kind']): string => {
    switch (k) {
      case 'StaticBuff': return 'StaticBuff: 常在のATK/HP修整';
      case 'CostModifier': return 'CostModifier: コスト修整（下限指定可）';
      default: return exhaustive(k);
    }
  };
  const labelDuration = (d: Duration): string => {
    switch (d) {
      case 'EOT': return 'EOT: ターン終了時まで';
      case 'PERM': return 'PERM: 永続';
      default: return exhaustive(d);
    }
  };

  md += header('IR（型仕様）');
  // Value
  const valueKinds = listDiscriminantKinds(ValueZ) as Value['kind'][];
  md += header('値（Value）', 3);
  md += bullet(valueKinds.sort().map(k => labelValueKind(k)));
  // Metric
  const metricKinds = listDiscriminantKinds(MetricZ) as Metric['kind'][];
  md += header('メトリクス（Metric）', 3);
  md += bullet(metricKinds.sort().map(k => labelMetricKind(k)));
  // Predicate
  const predicateKinds = listDiscriminantKinds(PredicateZ) as Predicate['kind'][];
  md += header('述語（Predicate）', 3);
  md += bullet(predicateKinds.sort().map(k => labelPredicateKind(k)));
  // Selector
  md += header('セレクター（Selector）', 3);
  md += bullet([
    'owner: SELF/OPP を指定',
    'zone: 対象ゾーン（LIB/HAND/BF/GY/EXILE/STACK）',
    'max: 選べる最大数の上限（追加の制約でさらに絞られることあり）',
    'filter: 述語（Predicate）で対象を絞り込み',
  ]);
  // Effect
  const effectKinds = listDiscriminantKinds(EffectZ) as Effect['kind'][];
  md += header('効果（Effect）', 3);
  md += bullet(effectKinds.sort().map(k => labelEffectKind(k)));
  // Trigger
  const triggerKinds = enumValues(TriggerWhenZ) as TriggerWhen[];
  md += header('トリガー（Trigger）', 3);
  md += bullet(triggerKinds.sort().map(k => labelTriggerWhen(k)));
  // Replacement
  const replWhens = enumValues((ReplacementEffectZ as any)._def.shape().when) as ReplacementEffect['when'][];
  md += header('置換効果（Replacement）', 3);
  md += bullet([
    ...replWhens.sort().map(w => labelReplacementWhen(w)),
    'limit: 同一カードにつき期間（TURN/GAME）で回数制限が必要',
    'duration: 効果の持続時間（EOT/PERM）',
  ]);
  // Continuous
  const contKinds = listDiscriminantKinds(ContinuousEffectZ) as ContinuousEffect['kind'][];
  md += header('常在効果（Continuous）', 3);
  md += bullet(contKinds.sort().map(k => labelContinuousKind(k)));
  // Duration
  const durations = enumValues(DurationZ) as Duration[];
  md += header('時間（Duration）', 3);
  md += bullet(durations.sort().map(d => labelDuration(d)));

  md += header('ダメージ・回復・カウンター');
  md += bullet([
    'ダメージはユニットの体力を減らす。ターン終了時にダメージはリセットされる',
    '回復はユニットの現在体力を増やす（最大値を超えない場合がある）',
    'カウンターはカード上に置かれる目印で、能力の条件や修整に使用される',
  ]);

  md += header('勝敗');
  md += bullet([
    CORE_RULES.win.lifeZeroLoss ? 'あなたのライフが0以下になったら敗北' : 'ライフによる敗北は発生しない',
    CORE_RULES.win.drawFromEmptyLoss ? '空のライブラリーから引けない場合は敗北' : 'ライブラリー切れによる敗北は発生しない',
    CORE_RULES.build.maxHandSize != null ? `手札上限は${CORE_RULES.build.maxHandSize}枚（調整を受ける場合あり）` : '手札上限はない',
  ]);
  cover('win.lifeZeroLoss'); cover('win.drawFromEmptyLoss'); cover('build.maxHandSize');

  md += header('付録（品質保証）');
  md += bullet([
    '本ゲームは、カードの相互作用によって無限ループが発生しないよう自動検証を実施しています',
  ]);
  if (global) {
    md += `検証結果: ${global.ok ? 'OK（致命的な循環なし）' : 'NG（循環あり）'}\n\n`;
  }
  const ruleCheck = analyzeRules(CORE_RULES);
  md += `ルール仕様のヌケモレ検査: ${ruleCheck.ok ? 'OK' : 'NG'}\n`;
  if (!ruleCheck.ok || ruleCheck.issues.length) {
    for (const i of ruleCheck.issues) {
      md += `- (${i.level}) ${i.code}: ${i.message}\n`;
    }
    md += '\n';
  }

  md += '\n---\n\nこの文書は `scripts/generate-rulebook.ts` により生成されました。\n';
  return { markdown: md, covered: covered };
}

// Backward-compatible helper used by scripts: returns only markdown
export function buildRulebookMarkdown(global?: GlobalAnalysis): string {
  return buildRulebook(global).markdown;
}
