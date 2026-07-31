# DailyGlance 稳定记录（2026-07-31）

## 发布范围

- 发布版本：`APP_BUILD=2026-07-31-01`，资源参数 `?v=20260731-01`，`SIGNAL_VERSION=v4.2.12`。
- 确认历史日 K 的主源切换为 TickFlow 免费 REST API：请求最近 `1000` 根日线，固定使用 `adjust=forward_additive`，时间戳按北京时间入库。
- 股票、交易所 ETF 和八项指数均使用 TickFlow 标的映射；非北证50回退顺序为腾讯、东方财富，北证50依次回退新浪、东方财富、腾讯。
- TickFlow 失败会沿用既有缓存与来源熔断机制；不使用实时行情补写历史数据。

## 未改变的行为

- `SIGNAL_VERSION`、四套策略、仓位、信号和主图 `B/S` 均未改变。
- 实时行情仍使用腾讯，历史确认与实时 overlay 的数据契约不变。

## 发布验证

- 所有生产 JavaScript 通过 `node --check`。
- `node tests/regression.js` 通过 `207` 项；`node tests/strategy-cache-fetch.js` 与 `node tests/strategy-iteration.js` 均通过。
- 本地 `status-smoke` 通过：资源版本统一为 `20260731-01`，四张图表可见，右侧每日结论与状态条完整，无本地控制台错误。
- 本地 `live-dataflow-smoke` 通过：TickFlow 确认历史至 `2026-07-30`，腾讯 `2026-07-31` 行情作为合法实时 overlay；左中右价格与日期一致，历史拖拽和“最新”恢复正常。

## 发布

- 提交：`0d0dff76a5221709baab1a95530b1aa885f60d63`（`Use TickFlow for historical market data`），已推送至 `origin/main`。
- GitHub Actions：`Deploy DailyGlance` run `30605751639` 为 `completed / success`。
- 远端源码已确认：入口资源参数和 `APP_BUILD` 均为 `20260731-01 / 2026-07-31-01`。

## 已知风险

- TickFlow 是公开免费接口，仍需在真实使用中观察其可用性与频率限制；腾讯、东方财富和北证50新浪回退保留为恢复路径。
- 本次终端 Playwright 和 `curl` 访问 Pages 均为 `ERR_CONNECTION_RESET`，没有新增线上 DOM/canvas 自动化证据；这与既有网络路径问题一致，不影响已确认的远端源码和 GitHub Actions 部署结果。
