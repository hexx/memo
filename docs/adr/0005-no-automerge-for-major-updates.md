# major アップデートは automerge しない

Renovate で minor/patch は automerge しているが、major だけは手動レビューの PR のまま流す（`renovate.json` のデフォルト挙動を維持する）。理由は、このプロジェクトに UI/コンポーネントのテストがなく、React・Vite・Tailwind 系の major がもたらす見た目やランタイムの破壊を CI（oxlint + vitest + build）が検知できないため。利便性のために major を automerge にすると、CI 緑のまま本番の UI が壊れる経路ができる。

## Considered Options

- **major も automerge**: 完全に放置できるが、UI 系 major の破壊を検知できない。
- **低リスク major だけ automerge（二階建て）**: 設定は綺麗だが「どのパッケージが高リスクか」のリスト管理が新たな負債になる。パッケージは増減するため。
- **major は手動 PR（採用）**: major PR は溜めずに週次で処理する運用ルールと組み合わせる。今回 major が積み上がった原因は automerge 設定ではなく PR の放置だったため、効く対策は設定より頻度。
