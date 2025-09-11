# Agent Guide: engine.ts 実装の前提と手順

このリポジトリでは、次の指示を安定して実行できるよう情報を整理しています。

- 「rules-verifier.ts と型チェックを使いながら engine.ts を実装してください」

ここに記載の手順・前提・コマンドに従えば、エンジン実装を型安全に進めつつ、最低限の動作確認とルール検証が行えます。

## 対象ファイルと参照関係
- `engine.ts`: ゲームの最小エンジン本体（このファイルを実装対象とする）
- `schema.ts`: カードIR・セレクター・述語・効果などの型定義（Zod スキーマ併記）
- `core-rules.ts`: ルール定数（`CORE_RULES`／`GameRules` 型）
- `rules-verifier.ts`: ルール仕様のヌケモレ検査（`analyzeRules`）
- `scripts/verify-engine-coverage.ts`: エンジン対応状況の可視化（型列挙に対するカバレッジ報告）
- `play.ts`: 簡易CLI。エンジンで実際に1v1をプレイ可能

インポートは NodeNext かつ拡張子付きで行います（`tsconfig.json` の `allowImportingTsExtensions: true`）。例:

```ts
import { CORE_RULES, type GameRules } from './core-rules.ts';
import { analyzeRules } from './rules-verifier.ts';
import type { Card, Effect, Selector, Predicate, Metric, Value, Zone, Phase } from './schema.ts';
```

## 実装ポリシー（最小機能の範囲）
- まずは「対戦やサンプルCLIが動く最小限」を優先します。
- 効果のサブセットのみ対応します（現状の想定）
  - 対応: `DealDamage`, `Heal`, `Draw`, `Move`, `NoOp`
  - 未対応: トリガー、置換効果、常在効果、色コスト、複雑な対象選択 など（未対応は無視またはログ出力）
- スタック／優先権は未実装（`CORE_RULES.actions.usesStack` が true でもエンジン側は未対応）
- 破壊の判定: `damage.lethalAt` に従い HP が閾値以下なら死亡。
- トークンの離脱先: `CORE_RULES.tokens.tokensLeaveTo` を尊重（墓地 or 追放）。
- 不正対象の不発: 解決時に全対象が不正なら「不発」としてログ（`illegalTargetFizzle: true` を尊重）。

## 型安全のための実装規約（重要）
このプロジェクトは discriminated union を広範に利用しており、「switch による厳密な網羅チェック（exhaustiveness）」を徹底します。新しい分岐が `schema.ts` に追加された場合、型エラーで検知できるようにします。

1) 共通の到達不能ガードを用意
```ts
// engine.ts（または共通ユーティリティ）
const exhaustive = (x: never): never => { throw new Error(`Unreachable: ${String(x)}`); };
```

2) 効果（Effect）の解決
```ts
switch (eff.kind) {
  case 'DealDamage': /* ... */ break;
  case 'Heal':       /* ... */ break;
  case 'Draw':       /* ... */ break;
  case 'Move':       /* ... */ break;
  case 'NoOp':       return;
  default: return exhaustive(eff); // ここで未網羅を型エラーとして検出
}
```

3) 述語（Predicate）の評価
```ts
switch (pred.kind) {
  case 'True': /* ... */ return true;
  case 'HasTag': /* ... */ return /* boolean */;
  case 'HasAttribute': /* ... */ return /* boolean */;
  case 'HasName': /* ... */ return /* boolean */;
  case 'IsToken': /* ... */ return /* boolean */;
  case 'WasSummonedThisTurn': /* ... */ return /* boolean */;
  case 'HasCounter': /* 将来対応。現状は未対応 → return false; */ return false;
  case 'ControllerIs': /* ... */ return /* boolean */;
  case 'EventOccurred': /* 将来対応。現状は未対応 → return false; */ return false;
  case 'Cmp': /* ... */ return /* boolean */;
  case 'And': /* ... */ return /* boolean */;
  case 'Or':  /* ... */ return /* boolean */;
  case 'Not': /* ... */ return /* boolean */;
  default: return exhaustive(pred);
}
```

4) 値（Value）・メトリクス（Metric）の評価
```ts
switch (v.kind) {
  case 'Const': return v.n;
  case 'Clamp': return Math.min(v.max, Math.max(v.min, evalMetric(/*...*/)));
  default: return exhaustive(v);
}

switch (m.kind) {
  case 'Const': return m.n;
  case 'CardStat': /* ATK/HP の参照（後述の安全なナローイング参照） */ return /* number */;
  case 'BoardCount': /* ... */ return /* number */;
  case 'Life': /* ... */ return /* number */;
  default: return exhaustive(m);
}
```

5) 列挙（ユニオン）に対する switch を徹底
- `Zone`・`Phase`・`CardType`・`TriggerWhen`・`ContinuousEffect`・`ReplacementEffect.when` に対しても、必要箇所では `switch + exhaustive` を使う。
- 「とりあえず default: break;」は禁止（網羅漏れの検出が不能になるため）。

6) 型ナローイングの徹底と unsafe キャスト禁止
- `if (rc.card.type === 'Unit') { /* rc.card.stats が存在する世界 */ }` のように、カード種別で安全に絞り込む。
- Optional フィールド（例: `stats`）は存在チェック後に参照。存在しない分岐では参照しない。
- `as any` / `as unknown as T` は禁止。どうしても必要な場合は呼び出し元の型設計を見直す。

7) 型の単一出所（Single Source of Truth）
- 文字列リテラルを直書きせず、必ず `schema.ts` からユニオン型を import して参照（新設項目の型崩れを防ぐ）。
- エンジンの「対応済み効果一覧」は `scripts/verify-engine-coverage.ts` の `implEffects` を更新し、スキーマとの差分を可視化。

8) 関数の戻り値にも型注釈
- 例: `canCastFromHand` は `{ ok: boolean; reason?: string }` を返す、とあえて注釈して将来の破壊的変更を検知。

9) ゾーン操作の安全性
- `getZoneArray(p, zone)` は `switch(zone)` で網羅し、未知のゾーンは `exhaustive(zone)` で検知。
- 移動時は「元ゾーンから完全に除去→目的ゾーンへ追加」を一貫実施。`id` をキーにして重複を防止。

10) 例外は「開発時のみ」：ランタイムはログ中心
- 未対応分岐は `exhaustive` で検知（開発時）し、リリース想定のランタイムでは「ログ出力＋安全にスキップ」ポリシーを維持（現在は最小機能のため）。


## 型チェックの活用ポイント
- Discriminated Union を `switch` で分岐し、未対応はデフォルトで `NoOp` 相当のログに留めます。
- `import type` を用い、型だけを参照する箇所で不要なランタイム依存を避けます。
- 述語・メトリクス・値の評価は必要最小限のみ実装し、`schema.ts` の型に合わせます。
- ゾーンやフェイズは `Zone`/`Phase` のユニオンから外れないようにします。

## rules-verifier.ts の使い方
- `initGame` 内で `analyzeRules(CORE_RULES)` を呼び、エラー／警告をログに残します（ゲームを止める必要はありません）。
- 目的は「ルール定数の整合性チェック」であり、エンジンの分岐条件の是正に役立てます。

## 実装が提供すべき主なエクスポート（目安）
- セットアップ: `loadDeck`, `validateDeck`, `initGame`
- ターン進行: `startTurn`, `advancePhase`, `endTurn`
- 基本アクション: `canCastFromHand`, `castFromHand`, `canAttack`, `attack`
- 効果解決: `resolveEffect`
- ユーティリティ: `listBattlefield`, `snapshotPublic`, `gameOver`, `currentPlayer`, `opponentOf`

これらの関数は `play.ts` や将来的なAI/テストから呼ばれる想定です。命名や引数の形は既存呼び出しに合わせてください。

## 実行・検証コマンド
- 型チェック: `npm run typecheck`
  - `tsconfig.json` は `strict: true`／`noEmit: true`。型エラーを0に保ちます。
- 簡易プレイ: `npm run play`
  - `decks/` のサンプルで1v1を開始できます。最低限の効果とターン進行が動くことを確認します。
- カバレッジ可視化: `npm run verify:engine`
  - スキーマに対する「エンジンが現状どこまで対応しているか」を一覧表示します。
  - 現段階では「未対応がある」前提のため失敗終了します（レポートは実装方針の指針として参照）。

## 実装手順の推奨フロー
1) `schema.ts` と `core-rules.ts` をざっと把握（効果の種別・フェイズ・ゾーン・ルール定数）。
2) `engine.ts` の骨組みを用意（状態型、デッキ/カードのロード、ゾーン移動、ログ関数）。
3) `initGame` で `CORE_RULES` をセットし、`analyzeRules` の結果をログへ。
4) 値/メトリクス/述語の最小評価を実装（`Const` など基本から）。
5) `resolveEffect` を最小サブセットで実装（`DealDamage`/`Heal`/`Draw`/`Move`/`NoOp`）。
6) ターン/フェイズ進行と基本アクション（手札から唱える・戦闘）を実装。
7) `npm run typecheck` で型を通し、`npm run play` で手動確認。
8) 必要に応じて `npm run verify:engine` のレポートを確認し、対応範囲を拡張。

### 新しい種別がスキーマに追加された場合の流れ
1. `npm run typecheck` でエラー箇所（未網羅 `switch`）を特定。
2. `engine.ts` の該当 `switch` に `case` を追加し、正しい実装または安全な未対応ハンドリングを記述。
3. `scripts/verify-engine-coverage.ts` の `implEffects` など対応一覧を更新。
4. `npm run verify:engine` で差分レポートを確認し、必要に応じて他の一覧（トリガー/置換/常在/カード種別）も更新。

## 実装上の注意
- すべての import は相対パス＋`.ts` 拡張子で行います（NodeNext/ESM）。
- 乱数はテスト容易性のためシード可能な関数を使うか、簡易 xorshift などをローカル定義します。
- ゾーン移動は「所属プレイヤーの全ゾーンから除去→目的ゾーンへ追加」を徹底し、一意な `id` をキーに管理します。
- 不正対象の再チェックは「解決時」に行い、全対象不正なら不発（`illegalTargetFizzle`）。
- 将来の拡張（トリガー/置換/常在）に備え、`switch` の `default` でログを残しつつ安全にスキップしてください。

このガイドに従えば、「rules-verifier.ts と型チェックを使いながら engine.ts を実装する」作業を再現性高く進められます。必要があれば本ファイルに追記してください。
