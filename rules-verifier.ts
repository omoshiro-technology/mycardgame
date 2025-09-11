// Formal-ish checker for core game rules completeness & consistency

import type { GameRules } from './core-rules.ts';

export type RuleIssue = { level: 'error' | 'warning'; code: string; message: string; path?: string[] };
export type RuleAnalysis = { ok: boolean; issues: RuleIssue[] };

export function analyzeRules(r: GameRules): RuleAnalysis {
  const issues: RuleIssue[] = [];
  const err = (code: string, message: string, path?: string[]) => issues.push({ level: 'error', code, message, path });
  const warn = (code: string, message: string, path?: string[]) => issues.push({ level: 'warning', code, message, path });

  if (!Array.isArray(r.turns?.phases) || r.turns.phases.length === 0) err('TURN_PHASES_EMPTY', 'ターンのフェイズ順序が未定義', ['turns','phases']);
  if (r.build.startingHand <= 0) err('START_HAND_ZERO', '初期手札が0以下', ['build','startingHand']);
  if (r.build.minDeckSize < r.build.startingHand) warn('DECK_LT_HAND', 'デッキ最小枚数が初期手札より小さい可能性', ['build','minDeckSize']);
  if (r.build.maxHandSize != null && r.build.maxHandSize < r.build.startingHand) warn('HAND_MAX_LT_START', '最大手札が初期手札より小さい', ['build','maxHandSize']);

  // Actions
  if (r.actions.usesStack == null) err('STACK_UNSPECIFIED', 'スタックの有無が未定義', ['actions','usesStack']);

  // Damage
  if (r.damage.lethalAt > 0) warn('LETHAL_POSITIVE', '致死判定が体力<=0を想定していない', ['damage','lethalAt']);

  // Combat consistency
  if (!r.combat.canBlock && r.combat.attackerTargets === 'UnitOnly') {
    warn('NO_BLOCK_UNIT_ONLY', 'ブロック不可で攻撃対象がユニット限定は直感的でない可能性', ['combat','attackerTargets']);
  }

  // Tokens rule clarity
  if (!r.tokens || (r.tokens.tokensLeaveTo !== 'GY' && r.tokens.tokensLeaveTo !== 'EXILE')) {
    err('TOKEN_LEAVE_UNSPEC', 'トークンが戦場を離れたときの扱いが未定義', ['tokens']);
  }

  // Resources
  if (!r.resources) {
    err('RES_UNSPEC', 'コスト/リソースのルールが未定義', ['resources']);
  } else {
    const res = r.resources;
    if (res.mode !== 'ActionPoints') warn('RES_MODE', '未知のリソースモード', ['resources','mode']);
    if (res.perTurnGainBase < 0) err('RES_GAIN_NEG', 'ターンごとのリソース獲得が負数', ['resources','perTurnGainBase']);
    if (res.payment === 'GenericAndColors' && res.colors.policy !== 'InGamePayment') {
      err('COLOR_POLICY_MISMATCH', '色コストを支払う設定だが、色の扱いがデッキ専用になっている', ['resources','colors','policy']);
    }
    if (res.payment === 'GenericOnly' && res.colors.policy === 'InGamePayment') {
      warn('COLOR_UNUSED', '色の扱いが支払い用になっているが、色コストを使わない設定', ['resources','payment']);
    }
    if (!Array.isArray(res.colors.symbols) || res.colors.symbols.length === 0) {
      warn('COLOR_SYMBOLS_EMPTY', '色記号が未指定', ['resources','colors','symbols']);
    }
  }

  // Win conditions
  if (!r.win?.lifeZeroLoss && !r.win?.drawFromEmptyLoss) {
    warn('WIN_CONDS_WEAK', '明確な敗北条件が少ない', ['win']);
  }

  return { ok: issues.filter(i => i.level === 'error').length === 0, issues };
}

