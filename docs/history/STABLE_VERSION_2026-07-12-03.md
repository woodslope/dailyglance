# 2026-07-12 稳定发布记录

## `20260712-03 / v4.2.7`

- 发布提交：`ae50972 Fix strategy switch performance tracing`，已推送至 `origin/main`。
- GitHub Actions：`Deploy DailyGlance`（run `29196820321`）及 `pages build and deployment`（run `29196820032`）均为 `completed / success`。
- 生产改动：`switchStrategy()` 的性能 trace 改为在确认弹窗完成后开始，排除用户等待确认的时间，避免把交互等待误报为指标计算耗时。
- 工程整理：回归用例正文已迁移到五个 `.cases.js` 分组文件，统一入口和分组入口保持可用；刷新事务和关键全局状态写入口沿用 `20260712-02` 的整理结果。
- 策略边界：策略规则、仓位、`B/S`、信号积分和 `SIGNAL_VERSION=v4.2.7` 均未改变。

## 验证证据

- 完整 `tests/regression.js`：通过。
- 五个分组入口：`data-cache`、`strategy-decision`、`presentation-state`、`chart-navigation`、`watchlist-lifecycle` 均通过。
- 本地 `scripts/status-smoke.js`：通过；资源版本、四张图、右侧结论和数据状态正常。
- 本地 `scripts/live-dataflow-smoke.js`：通过；实时覆盖、左侧标签页、历史拖拽和恢复正常。
- 性能预算：新增首次切换 / 再次切换场景；本地首次切换 trace P95 为 `125.1ms`，再次切换 P95 为 `76.4ms`，未放宽原 `120ms` trace 预算。
- 真实 Chrome 线上复核：资源版本为 `20260712-03`；首次策略切换 `87.9ms`，再次切换 `39.3ms`；策略结论和积分阈值同步正确，控制台无警告或错误。

## 已知边界

- 后台 `cachedFetchRefresh` 曾记录约 `4567ms` 的网络等待，但前台策略切换和图表绘制仍在预算内，暂不处理。
- 东方财富历史接口仍可能返回 `ERR_EMPTY_RESPONSE`；缓存和备源回退未造成页面失败。
- 终端自动化访问 Pages 的网络路径仍可能返回 `ERR_CONNECTION_RESET`；真实 Chrome 已证明线上页面可访问。

当前状态和下一步看 `CURRENT_STATUS.md`；生产验证和版本号规则看 `STABILITY_CHECKLIST.md`。
