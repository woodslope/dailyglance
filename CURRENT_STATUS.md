# DailyGlance 当前接续状态

更新时间：2026-08-24

上一阶段完整记录：`docs/history/CURRENT_STATUS_ARCHIVE_2026-08-09.md`

## 当前状态

- 当前线上与本地生产策略版本均为 `v4.2.32`；Pages `main=a2db6ca`，应用构建 `2026-08-24-01`，资源版本 `20260824-01`。本次发布完成项目级 UI 治理：统一 1024px 桌面边界、行情与板块错误生命周期、策略浏览上下文、空态职责、深色视觉 Token、交互语义和减少动态支持；没有改变行情契约、策略参数、仓位或 `B/S`。发布前 249 项完整回归和隔离部署包桌面状态 smoke 均通过，Pages API 已确认对应提交构建完成。
- 四个正式策略继续共用 `0% / 30% / 50% / 80%` 四档仓位和统一 `B/S` 契约；当前生产细则以 `docs/strategy/STRATEGY_DECISION_RULES.md` 为准。
- “板块趋势”仍是独立只读扫描层，行业趋势、概念热点、活跃个股和外部环境推测均不进入核心宽基门禁、个股策略、仓位、`B/S` 或收益计算。
- 本地维护边界已进一步收敛：`assets/js/07-refresh-controller.js` 独立承载刷新调度，`assets/js/02-observation-data.js` 独立承载外部环境与板块趋势观察；本次拆分未改变策略参数、历史/实时数据契约或 `B/S` 行为。
- 本地完整源码在 `codex/full-project`；UI 治理完整项目提交为 `72267df`，GitHub 仍只保存 Pages 必要部署文件。

## 工作区分层

当前 UI 治理提交（`72267df`）作为已提交对照基线；后续任务继续按以下职责分层，跨层改动必须明确说明：

- **界面调整**：`index.html`、`assets/css/`、`assets/js/01-config-ui.js`、`assets/js/04-render.js`、`assets/js/06-settings.js`、`strategy-inspector.html`、`assets/css/strategy-inspector.css`、`assets/js/strategy-inspector.js`。
- **主应用交互**：`assets/js/05-app.js`、`assets/js/07-refresh-controller.js` 及自选股、设置、刷新生命周期。
- **正式策略配置**：`assets/js/00-strategy-config.js`。该文件独立承载正式策略、信号分数、统一仓位档位和策略版本；普通界面任务不再读取或修改它。
- **生产数据与策略**：`assets/js/02-data.js` 负责核心历史、缓存与实时行情，`assets/js/02-observation-data.js` 负责独立的外部环境与板块趋势观察；策略决策位于 `assets/js/03-calculations.js`、`docs/strategy/STRATEGY_DECISION_RULES.md` 和 `strategy-validation-policy.json`。
- **策略研究与验证**：`scripts/strategy-*.js`、`tests/strategy-*.js`、`tests/regression/strategy-decision.cases.js`、`tests/strategy-baseline-snapshots.json`、`docs/history/strategy/`。
- **协作与工具链**：`AGENTS.md`、`README.md`、`STABILITY_CHECKLIST.md`、`CURRENT_STATUS.md`、`scripts/check.js`、`scripts/sync-version.js`、`version.json` 及相关归档清理。

未提交删除项暂按“归档清理”处理，不自动恢复，也不并入 Pages 部署包；只有明确要整理稳定基线时，才单独审核这组删除差异。上述分层先用于日常任务隔离，不代表现有改动已被提交或物理拆到独立分支。

## 当前风险

- 行情源均为公开接口，无 SLA；线上访问仍可能受到网络重置或 CDN 传播延迟影响，发布结论以 Pages 构建状态、远端提交和部署文件版本共同确认。
- 本次发布后两次 Pages HTML 直连仍命中旧 CDN 入口版本；Pages API 已显示 `a2db6ca` 构建完成，按发布规则视为传播延迟，不继续循环查询。
- 第二阶段行业板块门禁缺少稳定的股票—行业指数映射和历史数据契约，现阶段不得直接混入三项核心宽基投票。
- `wave_expiry_b11_takeover_add_v2` 全量只命中 2 次事件，现有证据只支持已冻结的产品取舍，不构成收益优势证明，也不支持继续扩大例外。
- 已拒绝或冻结的弱市 80%、波段冲高回落扩展、失败短交易再入等候选，不在当前快照继续调参或复活；详细证据见 `docs/history/strategy/`。

## 下一步

- 如继续第二阶段行业板块门禁，先补齐稳定映射与历史数据契约，再注册独立候选验证。
- 只有出现新的确认样本、稳定行业相对强弱数据或新的独立案例时，才重启已冻结研究问题。
- 当前没有待发布生产改动；后续只有收到明确发布指令时，才读取并执行 `STABILITY_CHECKLIST.md`。
