# DailyGlance 稳定记录（2026-07-30-03）

## 发布范围

- 发布版本：`APP_BUILD=2026-07-30-04`，资源参数 `?v=20260730-04`，`SIGNAL_VERSION=v4.2.12`。
- 波段抄底型的股票 `B11` 使用双层防守：信号日低点是局部回踩位，跌破后已有 `30%` 试探仓维持、暂停加仓；最近确认的结构低点才是硬失效和原有离场链的触发位。
- 核心宽基中沪深300、中证500、中证1000至少两项空头时，空仓新建仓按标的自身目标仓位执行，不再被 `20%` 上限截断；已有仓位仍暂停加仓，数据不足、风险、离场和 `B/S` 规则不变。
- `B8+B17` 金色 B 只保留为“金色 B（试用）”展示元数据，不等于正式强确认买点，不改变积分、仓位、动作、风险、门禁、离场、冷静期或 `B/S`。

## 策略边界

| 策略 | 核心机会 | 入场与防守口径 |
| --- | --- | --- |
| 波段抄底型 | 超跌修复、背离、支撑回踩后的反弹 | 有修复佐证时允许 `30%` 试探；B11 以局部回踩防守加结构硬退出保住反弹利润并避免过早卖出。 |
| 稳健趋势型 | 均线趋势、MACD 动能和突破确认 | 未达标只观察；趋势破位和高危组合优先防守。 |
| 突破追涨型 | 放量、平台突破后的右侧参与 | 只在确认突破后建仓，跌破20日线或假突破时防守。 |
| 综合全能型 | 趋势、修复和突破等多类信号的去重聚合 | 低吸/修复可轻仓试探；综合风险和强离场优先，不复用波段 B11 特例。 |

## 历史验证

- `B11` 双层防守正式回放：98 标的、90 股票、共同截止 `2026-07-29`，影响 `1,188` 个决策日 / `84` 只股票；平均收益变化 `+0.3728` 个百分点，平均最大回撤变化 `-0.0507` 个百分点。
- 三段时间窗、单边 `0.20%` 成本压力和主要分层均在既定风险预算内。报告：`.local/strategy-reports/b11-structure-defense-evaluation-20260730.json`。
- 波段修复后的右侧确认新开仓候选没有接入：448 个新增 B 的平均收益 `-0.14` 个百分点、平均最大回撤 `+0.64` 个百分点，三个时间窗与成本压力均不通过。
- 波段转趋势持仓候选同样维持 `reject`；不以延长持仓或增加新 B 换取不可控回撤。

## 验证

- 所有生产 JavaScript 通过 `node --check`。
- `node tests/regression.js`。
- `node tests/strategy-formal-baseline-report.js --reuse-latest`。
- `node scripts/status-smoke.js`。
- `node scripts/live-dataflow-smoke.js --url=http://127.0.0.1:8767 --external-server`。
- 李子园（605337）真实桌面浏览器复验：`2026-07-24` 的局部位 `8.48`、结构位 `8.24`、暂停加仓与结构跌破退出解释均可见，未见文字溢出或本地 console error。

## 发布

- 提交：`6cc208bde4afcaa0771fbac89e3c5a1e02fa7b10`（`Release wave defense and market gate v4.2.12`），已推送到 `origin/main`。
- GitHub Actions：`Deploy DailyGlance` run `30537247652`、`pages build and deployment` run `30537247038`，均为 `completed / success`。
- 远端源码已确认：`APP_BUILD=2026-07-30-04`、`SIGNAL_VERSION=v4.2.12`。

## 已知风险

- 终端 Playwright 到 `https://woodslope.github.io/dailyglance/` 仍可能得到 `ERR_CONNECTION_RESET`，所以本轮没有新的线上 DOM/canvas 自动化证据；远端源码、Actions、Pages workflow 和本地真实浏览器验证均已通过。这是网络路径问题，不是部署失败。
- 东方财富历史接口偶发 `ERR_EMPTY_RESPONSE`；现有腾讯回退可恢复确认历史，后续继续观察公开数据源稳定性。
