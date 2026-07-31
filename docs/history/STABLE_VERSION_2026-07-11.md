# 2026-07-11 稳定发布记录

## `20260711-03 / v4.2.7`

- 发布提交：`95987d3 Release DailyGlance 20260711-03`，已推送至 `origin/main`。
- GitHub Actions：`Deploy DailyGlance`（run `29150520377`）及 `pages build and deployment` 均为 `completed / success`。
- 生产改动：波段抄底型的 `B8 KDJ 金叉` 只有在最近三个交易日存在 `B5/B6/B9/B11/B16/B17` 任一修复证据时，才计入买入窗口；原始 `B8` 展示、其他三套正式策略、离场、仓位档位与统一 `B/S` 契约保持不变。

## 验证证据

- `tests/regression.js`：通过，覆盖四个正式策略的统一决策与 `B/S` 契约，以及孤立 `B8` 不计分、有近期修复证据时可计分。
- `tests/strategy-formal-baseline-report.js`、`scripts/strategy-formal-baseline.js`：通过，完成 93 标的正式策略链路回放。
- `scripts/performance-budget.js`：通过。
- 系统 Chrome 下本地 `scripts/status-smoke.js`、`scripts/live-dataflow-smoke.js`：通过；四张图、右侧结论、拖拽历史和恢复最新均正常。
- 东方财富历史接口出现 `ERR_EMPTY_RESPONSE` 时，缓存回退成功，未造成页面失败。

## 已知边界

- 当前终端网络访问 `https://woodslope.github.io/dailyglance/` 持续返回 `ERR_CONNECTION_RESET`，因此未能在本机完成发布后的线上浏览器 smoke；GitHub Pages 部署工作流成功，GitHub raw 的 `main/index.html` 已确认引用 `20260711-03` 资源。
