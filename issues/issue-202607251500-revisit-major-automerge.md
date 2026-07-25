---
title: "UI テスト導入を踏まえた major automerge 方針の再検討（ADR 0005）"
status: TODO
created: 2026-07-25T15:00:00+09:00
---

# 課題解決プロンプト: UI テスト導入を踏まえた major automerge 方針の再検討（ADR 0005）

## 1. 役割定義 (Persona)

あなたは本プロジェクトのテスト戦略と Renovate 運用に詳しいエンジニアです。
ADR 0005 の方針（major アップデートは automerge しない）を、UI テスト導入後の現状に照らして再検討し、維持/変更を決定・文書化します。

## 2. 背景・前提条件 (Context)

- ADR 0005（`docs/adr/0005-no-automerge-for-major-updates.md`）は、major を automerge にしない根拠を「**このプロジェクトに UI/コンポーネントのテストがなく**、React・Vite・Tailwind 系の major がもたらす見た目やランタイムの破壊を CI が検知できないため」と明記している。
- ADR 0006（`docs/adr/0006-test-coverage-boundary.md`）と対応 PR により、UI テスト（jsdom + Testing Library）が導入済み:
  - `src/components/__tests__/MemoEditor.test.tsx`（11 件）
  - `src/routes/__tests__/`（index / archive / labels / memoId の配線契約、20 件）
  - Radix Dialog/DropdownMenu・TanStack Router/Query・TipTap を**実体で**動かす統合テスト
- 一方、jsdom ベースのテストでは検知できない破壊も残る: Tailwind のクラス意味変更や shadcn/ui の見た目変化などの**視覚的破壊**（E2E/ビジュアルリグレッションは ADR 0006 で導入しない判断）。

## 3. 解決すべきゴール (Goal & Objective)

次の問いに結論を出し、文書化する:

1. UI テスト導入後も major の手動レビューを続けるか、automerge を有効化するか、あるいはパッケージ群で線引きするか
2. 方針を変更する場合: `renovate.json` の変更と、ADR 0005 の supersede/更新（ADR 0007 新規作成を推奨）
3. 方針を維持する場合: ADR 0005 の根拠文を「UI テストはあるが視覚的破壊は検知できない」へ更新し、前提変化を記録する

## 4. 検討の視点

- **検知できる破壊**: React/Radix/TanStack のランタイム・API 破壊は、現在の UI テストでかなり検知できる（配線契約レベル）
- **検知できない破壊**: 視覚的破壊（Tailwind major のユーティリティクラス意味変更、Radix のスタイル前提変化）は jsdom では検知不能
- **運用コスト**: major PR の週次手動処理 vs automerge 後の視覚確認運用

## 5. 完了条件

- [ ] 方針の結論が ADR（0007 または 0005 更新）として記録されている
- [ ] 方針変更を伴う場合は `renovate.json` が更新され、CI 緑を確認済み
- [ ] ADR 0005 と 0006 の相互参照が最新になっている
