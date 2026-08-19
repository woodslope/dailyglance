# 2026-07-08 稳定与文档整理记录

## 20260708-18 发布状态

- 当前线上目标版本：`APP_BUILD=2026-07-08-18`，`SIGNAL_VERSION=v4.2.3`，资源参数 `?v=20260708-18`。
- 提交：`5a14c8e Release DailyGlance 20260708-18`。
- GitHub Actions：`Deploy DailyGlance` 与 `pages build and deployment` 均已完成且成功。
- GitHub raw：已确认 `main/index.html` 为 `20260708-18`。
- 当前环境缺口：终端访问 Pages 域名曾返回 `ERR_CONNECTION_RESET`，所以脚本版线上 smoke 尚未从本机完成；Codex in-app browser 已接管人工打开的线上页并确认实际资源为 `20260708-18`。

## 本地验证证据

- `node --check` 覆盖 5 个生产 JS、`tests/regression.js`、`scripts/status-smoke.js`、`scripts/live-dataflow-smoke.js`：通过。
- `xmllint --noout assets/icons/logo.svg assets/icons/favicon.svg`：通过。
- 全量 `tests/regression.js`：通过。
- 本地 `scripts/status-smoke.js --url=http://127.0.0.1:8766 --external-server`：通过，实际加载 `20260708-18`，四个 canvas scope 均为 `sh_daily`，右侧结论可见，结论重复状态标签数量为 0。
- 本地 `scripts/live-dataflow-smoke.js --url=http://127.0.0.1:8766`：通过，覆盖左侧/右侧价格一致、刷新条状态、拖拽入历史与恢复最新。
- Eastmoney `ERR_EMPTY_RESPONSE` 仍按非阻塞外部行情接口噪声处理。

## 当天重要发布记录

- `20260708-01`：新增性能基线聚合；实时 `setLiveBar()` 延迟生成周线 live overlay，减少日线侧边栏批量刷新时的无效计算。
- `20260708-02`：自选股左侧状态快照写入 `derivedIndicatorCache`；点击进入图表或恢复图表时可复用指标和决策，减少 1000 根历史 K 线同步重算。
- `20260708-03`：恢复图表时复用当前版本行决策；新增回归覆盖派生缓存缺失时仍避免完整决策重算。
- `20260708-18`：统一刷新事务/快照口径；右侧顶部刷新条承载数据状态；结论卡片去掉重复状态标签；补左侧刷新时间；弱化策略追踪标签；调整证据卡片排版和 logo 白色眼睛尺寸。

## 旧待测池归档

独立待测池已在第二轮文档整理中合并到 `CURRENT_STATUS.md`。归档时无待修复、无待验证项目。

已关闭历史项：

### DG-PENDING-2026-06-29-001：历史浏览快速 mouseleave 后日期状态不一致

- 状态：已关闭。
- 记录日期：2026-06-29。
- 来源：人工截图与描述。
- 相关区域：主图 hover、历史浏览徽章、右侧价格日期、十字线 overlay。
- 现象：进入历史浏览或 hover 到历史 K 线后，鼠标快速向上移出主图区域，可能出现十字线、历史浏览徽章和右侧日期状态不一致。
- 关闭记录：`APP_BUILD=2026-06-29-26` 已修复；`resetHoverSelectionToLatest()` 恢复最新态时同步调用 `updateFreezeBadge()`；新增回归 `main chart mouseleave restores latest badge date and crosshair state together`；全量 `tests/regression.js` 通过。

## 第二轮说明文档整理

本轮只整理说明文档，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。

处理结果：

- `AGENTS.md`：固定唯一规则源和最小阅读入口。
- `AI_WORKFLOW_NOTES.md`：压缩为协作节奏、问答/执行边界、人工确认和收口方式。
- `CURRENT_STATUS.md`：压缩为当前线上状态、待办与风险、文档整理状态和下一步。
- 旧独立待测池：合并到 `CURRENT_STATUS.md` 后删除。
- `STABILITY_CHECKLIST.md`：继续作为版本号、生产验证和 smoke 的唯一规则源。
- `docs/strategy/STRATEGY_DECISION_RULES.md`：当时保留当前规则和候选池；历史验证记录归档到 `docs/history/strategy/STRATEGY_VALIDATION_LOG_2026-06.md`。

后续接续：

- 当前状态看 `CURRENT_STATUS.md`。
- 生产验证和版本号看 `STABILITY_CHECKLIST.md`。
- 需要追溯 2026-07-08 发布证据时再读本文件。

## 第三轮说明文档整理

本轮继续只整理说明文档，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。

处理结果：

- `README.md`：压缩为项目总览、文档地图、目录/发布边界、主要文件和部署说明；数据、交互、设计、性能细节不再放 README。
- `docs/strategy/STRATEGY_VALIDATION_GUIDE.md`：合并原 `STRATEGY_BASELINE_SNAPSHOTS.md` 的生产快照基线说明；保留验证方法、样本池、接入阈值和命令。
- `docs/strategy/STRATEGY_BASELINE_SNAPSHOTS.md`：已删除，职责并入策略验证指南。
- `docs/history/strategy/STRATEGY_VALIDATION_LOG_2026-06.md`：承接 2026-06 候选初筛、`W5` / `L12` 深挖补充记录。
- `docs/data/DATA_CONTRACT.md`：去掉已完成流水，只保留契约正文和年度交易日历维护提醒。

从数据契约迁出的已完成记录：

- 实时 API 的真实行情时间解析已接入；API 时间不是今天时，实时数据只能作为左侧 quote，不能进入图表最后一根 overlay。
- 右侧数据口径已统一到顶部刷新条，区分“盘中临时”“缓存盘中”“盘后待确认”“仅左侧报价”和“收盘确认”；结论卡片标题不重复显示数据状态标签。
- `confirmedStatus/displayStatus` 已通过刷新条状态徽章暴露 `data-dg-*` smoke 属性，浏览器自动化可直接断言 `displayMode`、`confirmedStatus`、确认日期、显示日期和 live overlay 状态是否一致。
- `cached-live-overlay` 允许恢复同交易日 last-good 临时输入，右侧刷新条需明确提示“缓存盘中”；超过短 TTL 后继续保留，hover 说明沿用最近盘中数据，避免空窗。收盘后切为 `post-close-pending` / “盘后待确认”，停止滚动更新临时结论，等待历史 K 线确认后替换。
