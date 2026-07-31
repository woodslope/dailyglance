# DailyGlance 稳定版本记录（2026-07-28）

## 版本与发布

- `APP_BUILD=2026-07-28-01`
- `SIGNAL_VERSION=v4.2.10`
- 资源参数：`?v=20260728-01`
- Git 提交：`ec1d32688931146a1fbf7aa15edfed603c173aaa`
- GitHub Actions：`Deploy DailyGlance` run `30290790083`、`pages build and deployment` run `30290788543`，均为 `completed / success`
- GitHub Pages deployment：`5627215984`，状态 `success`

## 本轮生产行为

- 桌面端左侧选择区固定为 `260px`、右侧结论区固定为 `350px`，页头使用同一三列网格，主导航与中间图表区保持对齐。
- 信号硬失效解释按最终仓位输出建仓、增仓、持仓、减仓或空仓，不再固定写“当前空仓观察”。
- 只有积分真实下降时才写“由 X 降至 Y”；失效当日最终仍建仓或增仓时，主状态不再覆盖真实动作。
- 四套策略、仓位、`B/S`、`simpleAction`、策略信号计算和 `SIGNAL_VERSION` 不变。

## 验证证据

- JavaScript 语法检查通过。
- 完整 `node tests/regression.js` 通过；回归覆盖硬失效当日仍由空仓转为 20% 建仓、维持 30% 持仓，以及 `position`、`bsMark`、`simpleAction` 零变化。
- 本地 `status-smoke` 通过：资源版本均为 `20260728-01`，右侧包含每日结论，四块 canvas 非空，确认日期为 `2026-07-27`。
- 本地 `live-dataflow-smoke` 通过：`APP_BUILD` 与 `SIGNAL_VERSION` 正确，左中右日期和价格一致，历史拖拽与恢复最新状态正常。
- 三栏与页头布局已在追加解释修复前完成 1440/1100/1024/900px 正式浏览器验收；本轮追加 JS 不修改布局，发布前 1440px 页面 smoke 再次通过。

## 线上证据与风险

- 远端 `main`、两条 GitHub Actions 和最新 Pages deployment 均已确认为本轮提交；远端原始 `index.html` 与配置脚本已确认为 `20260728-01 / 2026-07-28-01 / v4.2.10`。
- 终端 Playwright 的线上 `status-smoke` 与 `live-dataflow-smoke` 均收到 `ERR_CONNECTION_RESET`，未取得新的线上 DOM/canvas 证据。该现象与此前版本一致；网络恢复后按 README 重跑两条线上 smoke。
- 东方财富历史接口在本地 smoke 中偶发 `ERR_EMPTY_RESPONSE`，腾讯历史回退后页面与数据流完整，属于既有外部数据源风险。
