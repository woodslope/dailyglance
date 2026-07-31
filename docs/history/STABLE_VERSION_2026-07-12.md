# 2026-07-12 稳定发布记录

## `20260712-01 / v4.2.7`

- 发布提交：`2de3113 Release DailyGlance 20260712-01`，已推送至 `origin/main`。
- GitHub Actions：`Deploy DailyGlance`（run `29192517681`）及 `pages build and deployment`（run `29192517284`）均为 `completed / success`。
- 生产改动：右侧“风控/防守”不再把近窗历史离场信号误写成当前“降低仓位”。只有当前策略动作或当前离场等级明确要求减仓时才显示降低仓位；其他状态明确提示重点盯防守位和强离场信号。
- 策略边界：仓位、`B/S`、信号积分和 `SIGNAL_VERSION=v4.2.7` 均未改变。

## 验证证据

- 完整 `tests/regression.js`：通过；新增“历史离场上下文不能把当前持有状态翻译成减仓指令”回归。
- 本地 `scripts/status-smoke.js`：通过；资源版本、四张图、右侧结论和数据状态正常。
- 浏览器真实路径：完成“大盘数据 -> 自选股池 -> 贵州茅台”复核；贵州茅台保持“趋势转强 / 可继续观察 / 50%”，冲突的“降低仓位”已消失。
- GitHub raw `main/index.html`：确认资源参数统一为 `20260712-01`，且不含 `fonts.googleapis` / `fonts.gstatic`。

## 线上补充验证

- 用户 Chrome 已直接打开 `https://woodslope.github.io/dailyglance/`，确认实际资源版本为 `20260712-01`；四图、右侧结论、失效条件、历史前一天和“最新”恢复均正常，控制台无页面错误。

## 已知边界

- 终端 Playwright、In-app Browser 与 `curl` 的网络路径仍返回 `ERR_CONNECTION_RESET`；线上 `status-smoke` 与 `live-dataflow-smoke` 仍在 `page.goto` 失败。该问题只影响当前自动化执行路径，不代表 Pages 或其他设备不可访问。
- 东方财富历史接口仍可能返回 `ERR_EMPTY_RESPONSE`；本地 smoke 中缓存回退成功，未造成页面失败。

当前状态和下一步看 `CURRENT_STATUS.md`；生产验证和版本号规则看 `STABILITY_CHECKLIST.md`。
