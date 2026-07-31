# DailyGlance 稳定版本说明 - 2026-07-02

## 2026-07-02 发布后线上最小验证

### 结论

- 线上地址：`https://woodslope.github.io/dailyglance/`
- 线上已加载 `APP_BUILD=2026-07-01-02`、`SIGNAL_VERSION=v4.2.3`、资源参数 `?v=20260701-02`。
- 本轮只按轻应用最小流程做发布后验证和记录，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`，不新增提交/tag/CI 流程。

### 验证

- `/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/status-smoke.js --url=https://woodslope.github.io/dailyglance --external-server` 通过。
- `/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/live-dataflow-smoke.js --url=https://woodslope.github.io/dailyglance` 通过。
- 线上当前为收盘确认状态：`rawLatest=activeLatest=2026-07-01 / 4112.45 / isLive=false`，`displayStatus.mode=confirmed`，`confirmedStatus.status=fresh`。
- 左侧 `大盘数据` tab active，`自选股池` tab 不 active；左侧激活行、图表 active 最新行、右侧价格均为 `上证指数 / sh / 4112.45`。
- 刷新条和右侧结论徽章一致：`data-dg-display-mode="confirmed"`，`data-dg-live-cached="false"`，可见文案为 `收盘确认` / `收盘确认结论`。
- 四个 canvas 均为 `sh_daily`，无 `.empty-hint` / “暂无数据”，右侧分析区包含“每日结论”。
- 拖拽验证通过：拖动过程中 `drawViewportCount=0` 且四块图表使用 `translateX(143.28px)` 预览；释放后 `drawViewportCount=1`；点击“最新”后历史徽章隐藏且右侧恢复 `2026-07-01 / 4112.45`。
- 本轮线上 smoke 未记录到外部资源失败。

### 轻应用流程结论

- 当前轻应用的必要发布流程保持为：生产代码改动后做本地语法/回归，发布后跑线上 `status-smoke` + `live-dataflow-smoke`，再写稳定记录。
- 不把 PR、tag、CI、监控平台或每次全量测试作为当前阶段必选项；只有改动范围变大或开始多人协作时再评估引入。

## 2026-07-02 项目收口与新对话接续

### 当前接续状态

- 最新线上稳定状态仍以本文件的“2026-07-02 发布后线上最小验证”为准：线上已加载 `APP_BUILD=2026-07-01-02`、`SIGNAL_VERSION=v4.2.3`、资源参数 `?v=20260701-02`。
- 当时待测池无待修复、无待验证条目；当前待办入口已合并到 `CURRENT_STATUS.md`。
- 本轮收口只更新项目协作文档和小白经验文件，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。
- `README.md` 已记录线上地址、GitHub Pages 最小部署范围和发布后线上验证命令；后续无需再让用户手动提供线上链接。
- `AI_WORKFLOW_NOTES.md` 已记录轻应用最小验证与 smoke 触发规则：按风险跑最小有效验证，smoke 不是每次文档或小改都必须跑。

### 新对话接续提示（历史）

该提示已被 `CURRENT_STATUS.md` 短入口取代。新对话请优先读取 `AGENTS.md`、`AI_WORKFLOW_NOTES.md`、`CURRENT_STATUS.md`。

## 2026-07-02 盘中历史浏览状态徽章修复

### 结论

- 用户盘中检查线上时，线上最新态左侧报价、中间图表最新 K、右侧价格/结论都显示 `2026-07-02` 盘中临时，这是符合数据契约的 `confirmedData + liveBar` 展示层行为。
- 线上实测确认历史没有被污染：`rawLatest=2026-07-01 / 4112.45 / isLive=false`，`activeLatest=2026-07-02 / isLive=true`。
- 发现并修复相邻展示 bug：进入历史浏览选中 `2026-07-01` 确认 K 线时，右侧价格已回到确认历史，但刷新条/右侧结论徽章仍沿用全局 `live-overlay` / `cached-live-overlay`，误显示“盘中临时结论”。
- 本地待发布版本：`APP_BUILD=2026-07-02-02`，`SIGNAL_VERSION=v4.2.3` 不变，`index.html` 静态资源版本参数统一为 `?v=20260702-02`。

### 这轮做了什么

- `assets/js/04-render.js` 增加按当前 item 计算的展示状态：当前选中 item 是确认历史 K 线时，即使全局 active 最新行仍是 live overlay，也渲染为 `confirmed` / `收盘确认结论`。
- `assets/js/02-data.js` 在同日轻量刷新路径补刷状态徽章，避免后台刷新把内存状态切到 `cached-live-overlay` 后 DOM 徽章仍停在 `live-overlay`。
- `tests/regression.js` 新增/扩展回归，覆盖历史确认 item 在 live overlay 环境下必须显示收盘确认，以及同日轻量刷新必须同步刷新状态徽章。
- `scripts/status-smoke.js`、`scripts/live-dataflow-smoke.js` 同步新资源版本断言。

### 验证

- `/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check assets/js/01-config-ui.js assets/js/02-data.js assets/js/04-render.js tests/regression.js scripts/status-smoke.js scripts/live-dataflow-smoke.js` 通过。
- `/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/regression.js` 通过。
- 本地 `scripts/status-smoke.js --url=http://127.0.0.1:8767 --external-server` 通过：实际加载 7 个 `20260702-02` 资源，旧版本资源为 0；四个 canvas 均为 `sh_daily`；刷新条与右侧结论徽章均为 `cached-live-overlay` 且状态属性一致。
- 本地 `scripts/live-dataflow-smoke.js --url=http://127.0.0.1:8767` 通过：`APP_BUILD=2026-07-02-02`、`SIGNAL_VERSION=v4.2.3`、资源版本 `20260702-02`；`rawLatest=2026-07-01`，`activeLatest=2026-07-02 / isLive=true`；左中右盘中最新态一致；拖拽性能和“最新”恢复通过。
- 专门历史浏览复验通过：本地加载 `20260702-02` 后，最新态为 `缓存盘中`；按左方向键选中 `2026-07-01` 后，右侧价格 `4112.45`，刷新条显示 `收盘确认`，右侧结论显示 `收盘确认结论`，两处 `data-dg-display-mode="confirmed"`、`data-dg-item-live="false"`。

### 影响面

- 不改变历史 K 线确认口径、实时 overlay gate、IndexedDB 写入规则、`SIGNAL_RULES`、`STRATEGIES`、仓位规则、主图 `B/S` 或 `SIGNAL_VERSION`。
- 只改变展示层状态徽章与同日轻量刷新 DOM 同步。
- 临时备份已在根目录瘦身时清理；结论保留在本稳定记录。

### 下一步

- 发布到 GitHub Pages 后，运行 `scripts/status-smoke.js --url=https://woodslope.github.io/dailyglance --external-server` 和 `scripts/live-dataflow-smoke.js --url=https://woodslope.github.io/dailyglance`，确认线上实际加载 `20260702-02`。

## 2026-07-02 自选股池动作可见与右侧空白兜底修复

### 结论

- 修复用户截图反馈的两处可见问题：自选股池左侧只显示“待定”不可快速应变；右侧价格区有数据时，分析区刷新期间可能空白。
- 本地待发布版本：`APP_BUILD=2026-07-02-03`，`SIGNAL_VERSION=v4.2.3` 不变，`index.html` 静态资源版本参数统一为 `?v=20260702-03`。

### 这轮做了什么

- `assets/js/05-app.js` 将自选股池待同步状态从“待定”改为“同步”，并在每行第二行展示可见动作短句，例如“信号待同步”“轻仓建仓”“防守减仓”，不再只藏在 tooltip。
- `assets/css/dailyglance.css` 增加自选股池动作短句布局和颜色规则，保持左侧快速扫描且不挤压价格区。
- `assets/js/04-render.js` 增加右侧分析兜底：分析 HTML 临时为空时，同一标的/日期/策略/周期刷新保留已有结论；切换到不同上下文时显示“分析同步中”面板，避免空白或误用旧股票结论。
- `tests/regression.js` 新增两条回归，锁定“自选股池动作必须可见”和“右侧分析区不能被空 HTML 清空”。

### 验证

- `/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check assets/js/01-config-ui.js assets/js/02-data.js assets/js/04-render.js assets/js/05-app.js tests/regression.js scripts/status-smoke.js scripts/live-dataflow-smoke.js` 通过。
- `/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/regression.js` 通过。
- 本地 `scripts/status-smoke.js --url=http://127.0.0.1:8768 --external-server` 通过：实际加载 7 个 `20260702-03` 资源，旧版本资源为 0；右侧分析区显示 `flex` 且包含“每日结论”。
- 本地自选股池定向浏览器检查通过：`APP_BUILD=2026-07-02-03`、资源版本 `20260702-03`；左侧自选行可见“同步 / 信号待同步”；手动模拟空 `analysisHtml` 后，右侧 `cardAnalysis` 仍为 `flex` 且显示“新手每日结论 / 分析同步中”，控制台无本地应用错误。
- 本地 `scripts/live-dataflow-smoke.js --url=http://127.0.0.1:8768` 通过：左中右盘中最新态一致，右侧每日结论存在，拖拽历史浏览和“最新”恢复通过。

### 影响面

- 不改变历史 K 线确认口径、实时 overlay gate、IndexedDB 写入规则、`SIGNAL_RULES`、`STRATEGIES`、仓位规则、主图 `B/S` 或 `SIGNAL_VERSION`。
- 只改变左侧自选池展示层和右侧分析区空内容兜底。
- 临时备份已在根目录瘦身时清理；结论保留在本稳定记录。

### 下一步

- 发布到 GitHub Pages 后，运行 `scripts/status-smoke.js --url=https://woodslope.github.io/dailyglance --external-server` 和 `scripts/live-dataflow-smoke.js --url=https://woodslope.github.io/dailyglance`，确认线上实际加载 `20260702-03`。

## 2026-07-02 同交易日 last-good 临时结论保留

### 结论

- 本轮按用户确认的盘中方案调整临时 API 数据规则：同交易日 last-good 临时 liveBar 不再因短 TTL 过期被清空；新数据未完整生成前继续沿用上一份临时结论，避免左侧动作和右侧结论空窗。
- 收盘后不再滚动生成新的实时结论；当天最后一份临时结论会冻结为 `post-close-pending` / “盘后待确认”，等历史 K 线 API 返回当天确认数据并通过校验后，再替换为 `confirmed` / “收盘确认”。
- 本地待发布版本：`APP_BUILD=2026-07-02-05`，`SIGNAL_VERSION=v4.2.3` 不变，`index.html` 静态资源版本参数统一为 `?v=20260702-05`。

### 这轮做了什么

- `assets/js/02-data.js` 移除 cached live overlay 的硬 TTL 清空：缓存仍必须通过实时 overlay gate、日期、历史新鲜度和价格体系校验，但同交易日过短 TTL 后保留 liveBar，并把 `displayStatus.reason` 改为“沿用盘中”。
- `assets/js/02-data.js` 新增 `post-close-pending` 状态：收盘后同交易日缓存 liveBar 继续展示，但标记“盘后待确认”，停止滚动更新临时结论。
- `assets/js/04-render.js` 扩展刷新条和右侧结论徽章，支持“沿用盘中”“盘后待确认结论”，并继续暴露 `data-dg-*` smoke 属性。
- `scripts/status-smoke.js`、`scripts/live-dataflow-smoke.js` 接受并校验 `post-close-pending`。
- `docs/data/DATA_CONTRACT.md` 同步新契约：短 TTL 只改变提示，不制造空窗；不得写 `rawData` / IndexedDB；历史 API 确认当天 K 线后才替换为收盘确认。

### 验证

- `/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check assets/js/01-config-ui.js assets/js/02-data.js assets/js/04-render.js tests/regression.js scripts/status-smoke.js scripts/live-dataflow-smoke.js` 通过。
- `/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/regression.js` 通过。
- 本地 `scripts/status-smoke.js --url=http://127.0.0.1:8769 --external-server` 通过：实际加载 7 个 `20260702-05` 资源，旧版本资源为 0；当前历史 API 已确认 `2026-07-02`，页面为 `confirmed` / “收盘确认”。
- 本地 `scripts/live-dataflow-smoke.js --url=http://127.0.0.1:8769` 通过：`APP_BUILD=2026-07-02-05`、`SIGNAL_VERSION=v4.2.3`、资源版本 `20260702-05`；当前为 `confirmed`，右侧每日结论存在，拖拽历史浏览和“最新”恢复通过。
- 浏览器定向盘中验证通过：固定北京时间 `2026-07-02 14:03`，注入 420 秒前同日 cached liveBar，刷新条显示“沿用盘中”，右侧显示“沿用盘中临时结论”，`data-dg-display-mode="cached-live-overlay"`，不清空结论。
- 浏览器定向盘后验证通过：固定北京时间 `2026-07-02 15:45`，同一 cached liveBar 显示“盘后待确认” / “盘后待确认结论”，`data-dg-display-mode="post-close-pending"`，仍不写确认历史。
- 新增回归 `post-close cached live overlay restores from local cache while confirmed history waits for today` 覆盖刷新页面后只剩 localStorage cached liveBar 的盘后恢复路径：历史 API 未确认当天时恢复为 `post-close-pending`，历史 API 确认当天后仍由确认历史替换。
- 补充回归 `cached live overlay recomputes cache age from cachedAt after page reload` 覆盖页面重载后 localStorage 里 `cacheAgeMs` 仍为旧值的情况：UI 应按 `cachedAt` 重新计算实际年龄，超过短 TTL 时显示“沿用盘中”。
- `2026-07-02 17:13 CST` 运行线上 `scripts/status-smoke.js --url=https://woodslope.github.io/dailyglance --external-server`：按预期失败，因为线上仍加载资源版本 `20260702-03`，不是本地待发布的 `20260702-05`；线上当时数据状态为 `confirmed` / “收盘确认”，失败点只是不满足本轮新版本资源断言。

### 影响面

- 不改变历史 K 线确认口径、实时 overlay gate、IndexedDB 写入规则、`SIGNAL_RULES`、`STRATEGIES`、仓位规则、主图 `B/S` 或 `SIGNAL_VERSION`。
- 只改变同交易日临时 overlay 的保留与状态展示规则。
- 临时备份已在根目录瘦身时清理；结论保留在本稳定记录。

### 下一步

- 发布到 GitHub Pages 后，运行 `scripts/status-smoke.js --url=https://woodslope.github.io/dailyglance --external-server` 和 `scripts/live-dataflow-smoke.js --url=https://woodslope.github.io/dailyglance`，确认线上实际加载 `20260702-05`。

## 2026-07-02 项目收口与新对话接续

### 当前接续状态

- 当前工作区本地待发布版本为 `APP_BUILD=2026-07-02-05`、`SIGNAL_VERSION=v4.2.3`、资源参数 `?v=20260702-05`。
- 本地已完成同交易日 last-good 临时结论保留：盘中过短 TTL 后显示“沿用盘中”；收盘后同日缓存 liveBar 显示 `post-close-pending` / “盘后待确认”，等待历史 K 线确认后替换为 `confirmed`。
- 当时待测池无待修复、无待验证条目；当前待办入口已合并到 `CURRENT_STATUS.md`。
- 线上 `https://woodslope.github.io/dailyglance/` 在 `2026-07-02 17:13 CST` 仍加载 `20260702-03`，尚未发布本地 `20260702-05`；线上当时数据本身为 `confirmed` / “收盘确认”，失败点是资源版本未更新。
- 当前目录不是 git 仓库；本轮未提交、未推送、未直接发布。发布 GitHub Pages 的最小范围仍是 `index.html` + `assets/`，不要上传临时备份、缓存、报告、协作记忆或系统文件。

### 新对话接续提示（历史）

该提示已被 `CURRENT_STATUS.md` 短入口取代。新对话请优先读取 `AGENTS.md`、`AI_WORKFLOW_NOTES.md`、`CURRENT_STATUS.md`。

## 2026-07-02 开发流程效率简化记录

### 结论

- 本轮只更新协作流程记录，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。
- 后续用户明确要求加快节奏时，默认采用“记录先行、最小自检、人工收敛后集中测试”。

### 新流程口径

- 小问题先最小修复和最小自检，不把每个反馈都展开成完整诊断、全量回归或线上 smoke。
- 暂不展开的回归、线上 smoke、跨入口验证、视觉复查，必须记录清楚，等人工判断明显问题基本结束后再集中安排阶段测试。
- 如果改动会污染数据、改变策略、破坏页面加载、影响发布版本号或线上稳定链路，仍在当轮提高验证强度。

### 影响面

- `AI_WORKFLOW_NOTES.md` 新增“效率优先执行模式”。
- 当时待测池仍无待修复、无待验证条目；当前待办入口已合并到 `CURRENT_STATUS.md`。

## 2026-07-02 两阶段开发流程补充

### 结论

- 本轮继续只更新协作流程记录，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。
- 为解决规则引入后开发节奏变慢的问题，`AI_WORKFLOW_NOTES.md` 补充“两阶段执行”：开发迭代期快修快验，阶段测试 / 发布收口期再集中补测试、稳定记录和接续信息。

### 新流程口径

- 开发迭代期不默认跑完整 smoke、线上验证、全量回归、多入口浏览器复验、经验沉淀或文档重组。
- 开发迭代期不默认每个小修都更新稳定版本说明；只在交付说明里记录改动和未测风险。
- 只有明确需要后续阶段覆盖的风险，才写入当前状态入口。
- 用户明确说“人工看完了 / 可以阶段测试 / 准备发布 / 准备开新对话”时，再集中安排阶段验证和收口记录。

## 2026-07-02 低效规则审计与修正

### 结论

- 本轮只修正协作文档和小白经验规则，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。
- 已删除或改写导致开发效率降低的硬规则：全量默认阅读、每次改完必跑 smoke、改 1 行也升版本号、每个小修都更新稳定记录、经验沉淀必须跑不存在的 `quick_validate.py`。

### 修正范围

- `AGENTS.md`：默认阅读顺序改为最小入口，按风险补读数据、策略、产品或稳定性文档。
- `AI_WORKFLOW_NOTES.md`：固定协作入口、待测池入池、最小验证、版本号、备份和稳定记录规则均改为开发迭代/阶段收口分层触发。
- `STABILITY_CHECKLIST.md`：从“每次改完必过”改为“阶段测试 / 发布收口前”；版本号从“每次改代码必须升”改为“生产资源准备复验、发布或收口时升”。
- `README.md`：同步文档地图，避免新对话重新按旧规则读全套文档。
- `xiaobai-coding`：经验沉淀改为按重叠风险审计；`quick_validate.py` 仅在技能包实际提供脚本时运行。
- `dailyglance-lessons.md`：DailyGlance overlay 改为开发迭代期最小确认，阶段测试/发布/稳定声明时再跑回归、线上 smoke 和写稳定记录。

### 保留的安全边界

- 数据污染、策略变化、历史/实时边界、IndexedDB 写入、发布版本号和线上稳定声明仍按高风险处理。
- 阶段测试、发布或新对话收口时仍需要检查当前状态入口和最近稳定记录。

## 2026-07-02 接续与工作流瘦身优化

### 结论

- 本轮只优化协作文档和小白经验规则，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。
- 新增 `CURRENT_STATUS.md` 作为短接续入口，避免新对话为了知道当前状态反复读取长稳定记录。
- `AI_WORKFLOW_NOTES.md` 进一步瘦身：新对话优先读 `CURRENT_STATUS.md`，长浏览器 smoke 细节下沉到 `STABILITY_CHECKLIST.md`。

### 修正范围

- `AGENTS.md` / `AI_WORKFLOW_NOTES.md`：接续状态改为读 `CURRENT_STATUS.md`；`STABLE_VERSION_*.md` 只在追溯证据、阶段测试或发布收口时读取。
- `README.md` 及当时的目录边界说明：登记 `CURRENT_STATUS.md` 的职责和上传边界。
- `STABILITY_CHECKLIST.md`：承接浏览器 smoke 深度规则，避免 workflow 主文件过长。
- `AI_WORKFLOW_NOTES.md`：问题确认改成“复述后直接处理，只有不明确时才等待确认”。
- `xiaobai-coding` 全局与 DailyGlance overlay：同步为按风险和阶段选择验证；DailyGlance overlay 不再要求编码前读全套项目文档。

### 后续优化候选（已在后续记录完成）

- P1：拆分 2026-07-02 当前稳定记录，减少单文件长度。
- P2：把 `AI_WORKFLOW_NOTES.md` 的五个旧会话收口场景压缩成短表格；不再保留多段长模板。

## 2026-07-02 稳定记录拆分与收口规则压缩

### 结论

- 本轮只优化协作文档，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。
- 已将原 2026-07-02 记录拆到 `STABLE_VERSION_2026-07-02.md`，后续又删除旧历史稳定记录，只保留当前稳定记录。
- 已将 `AI_WORKFLOW_NOTES.md` 的五个旧会话收口长提示压缩成决策表，减少新对话和收尾时的阅读成本。

### 修正范围

- 旧历史稳定记录：已在后续根目录清理中删除。
- `STABLE_VERSION_2026-07-02.md`：承接 2026-07-02 发布验证、修复、流程优化和当前拆分记录。
- `AI_WORKFLOW_NOTES.md`：旧会话收口规则改为场景表；项目接续信息优先写 `CURRENT_STATUS.md`，阶段测试、发布或追溯证据再写 `STABLE_VERSION_*.md`。
- `CURRENT_STATUS.md`：同步最新稳定记录为 `STABLE_VERSION_2026-07-02.md`。

### 影响面

- 不改变当时待测状态；当前仍无待修复、无待验证条目。
- 不改变发布边界；下一步仍是发布最小范围 `index.html` + `assets/` 到 GitHub Pages 后跑线上最小验证。

## 2026-07-02 根目录瘦身与无效文件清理

### 结论

- 本轮只整理文档和本地协作文件，不改生产 JS/CSS/HTML，不提升 `APP_BUILD` 或 `SIGNAL_VERSION`。
- 清理前根目录有 25 个文件，且 `backups/` 下累计 582 个本地备份文件；主要原因是 AI 工作流把备份、历史稳定记录、评审报告、技能总览和领域细则都堆在项目根目录。
- 清理后根目录保留运行入口、当前状态和高频协作入口；产品、数据、策略归档到 `docs/`；旧历史记录、旧评审、旧技能总览、旧备份、缓存、报告和协作记忆删除，不再隐藏保留。

### 移动与清理

- 删除无效系统文件：根目录和 `assets/` 下的 `.DS_Store`。
- 删除旧 AI 过程备份、策略缓存/报告/日志和 `.workbuddy` 协作记忆；不再用隐藏目录长期保留这类垃圾。
- 删除旧历史稳定记录、旧历史汇总、旧 UI review 和旧技能总览；当前只保留 `CURRENT_STATUS.md` 与 `STABLE_VERSION_2026-07-02.md` 作为接续证据。
- `PRODUCT_DECISION_GUIDE.md` 移至 `docs/product/PRODUCT_DECISION_GUIDE.md`，`DATA_CONTRACT.md` 移至 `docs/data/DATA_CONTRACT.md`。
- 策略规则、策略复用方法、基线快照和样本池说明按当时结构移至 `docs/strategy/`；后续已继续合并为当前策略文档结构。

### 教训

- 轻应用不应该让 AI 协作资料膨胀成项目文档系统。
- 根目录只能放高频入口；历史证据、评审和领域细则必须归档；临时备份、缓存、报告和协作记忆用完即删。
- 新增文档前先问：它是否会被频繁读取、是否替代了重复解释、是否比写进现有文件更低成本。否则不要新增。
