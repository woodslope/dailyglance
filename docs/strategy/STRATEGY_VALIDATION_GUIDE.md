# 策略验证与打磨指南

本文档沉淀 DailyGlance 策略模块的验证方法、样本池规则、生产快照基线、候选信号打磨流程和本地报告边界。它不替代 `docs/strategy/STRATEGY_DECISION_RULES.md` 的信号台账和当前候选池。

## 适用范围

适用于以下任务：

- 调研或评估新增技术信号。
- 判断候选信号是否值得进入正式策略。
- 验证风险预警、离场、买入确认、过滤器是否会影响第一次 `B/S`。
- 验证生产策略、右侧文案或 UI 调整是否无意改变核心结论。
- 管理策略验证样本池、临时行情缓存和本地回测报告。

不适用于以下任务：

- 修改右侧新手解释文案。该类任务优先看 `docs/product/PRODUCT_DECISION_GUIDE.md`。
- 修改渲染、交互、性能或移动端门禁。该类任务优先看 `STABILITY_CHECKLIST.md` 和 `AI_WORKFLOW_NOTES.md`。
- 把本地回测报告当作投资建议。DailyGlance 只用于研究、观察和复盘。

## 文档分工

| 文档 | 负责内容 |
| --- | --- |
| `docs/strategy/STRATEGY_DECISION_RULES.md` | 固定信号语义、状态、分组、B/S 规则、候选池和接入结论 |
| `docs/strategy/STRATEGY_VALIDATION_GUIDE.md` | 固定策略验证方法、生产快照基线、样本池、API 边界和回测输出规则 |
| `docs/history/strategy/STRATEGY_VALIDATION_LOG_*.md` | 存放历史初筛、消融、深挖和已否决方案证据 |
| `STABILITY_CHECKLIST.md` | 固定生产代码验证、版本号、发布和 smoke 规则 |

## 样本池与文件边界

本地工作区保留：

- `strategy-validation-universe.json`：样本池元数据，包含代码、名称、行业、阶段和风格标签。
- `tests/strategy-baseline-snapshots.json`：固定生产策略快照样本和期望输出。
- `.gitignore`：忽略本地缓存和回测报告。

临时生成物：

- `.local/strategy-cache/`：东方财富日 K 缓存。
- `.local/strategy-reports/`：回测明细报告。
- `.local/strategy-fetch-logs/`：行情拉取日志。

原因：

- 原始 K 线数据体积会持续增长，且会随复权和行情源修订而变化。
- 回测报告是本地派生产物，不应污染仓库历史。
- 项目里保留“样本池定义”和“固定快照期望”即可复现验证，不需要上传缓存本体。
- 上述目录只允许在策略验证运行期间临时生成；结论写入正式文档后必须删除，不长期隐藏保留。

## 样本池结构

当前样本池包含：

- 8 个指数：上证指数、深证成指、沪深300、中证500、中证1000、创业板指、科创50、北证50。其中沪深300、中证500、中证1000是生产门禁核心，其余五项只用于观察与指数自身策略样本。
- 97 只股票：覆盖银行、非银、消费、汽车、新能源、光伏、半导体、计算机、医药、有色、煤炭、石油、化工、地产、基建、电力、交运、传媒、农业等。
- 4 个阶段标签：
  - `seed`：当前已经有缓存的核心样本。
  - `phase1`：第一批扩样，优先补齐行业和风格。
  - `phase2`：第二批扩样，补充周期、防守、压力样本。
  - `phase3`：第三批扩样，补充题材、农业、传媒等高波动样本。

趋势标签不在 JSON 中手工固定。后续回测应按行情动态计算趋势状态，例如上升趋势、下降趋势、震荡、突破失败、超跌反弹和高波动，避免主观标签污染验证。

## 生产快照基线

`tests/strategy-baseline-snapshots.json` 用来固定少量代表性样本的生产策略输出，防止后续优化文案、UI 或策略时无意改变核心结论。

它验证的是 `docs/strategy/STRATEGY_DECISION_RULES.md` 固定的当前生产策略链路，不是第二套策略引擎，也不是离线研究脚本的替代品。

当前快照固定在本地缓存交易日 `2026-06-26`，覆盖：

- `sh` 上证指数，稳健趋势型：防守离场样本，主图 `S`。
- `cy` 创业板指，稳健趋势型：趋势持有样本。
- `kc50` 科创50，突破追涨型：趋势抱单但不开新仓样本。
- `600519` 贵州茅台，稳健趋势型：离场冷静期样本。
- `300750` 宁德时代，综合全能型：强离场样本。

每个样本都带三项核心宽基上下文：沪深300、中证500、中证1000。这样可以同时锁住 `marketLabel`、`position`、`bsMark`、`simpleAction`、`windowScore` 和关键 B/L/W 信号；观察指数不得影响门禁结果。

快照使用规则：

- 日常验证运行 `tests/regression.js`。
- 如果快照测试失败，先判断是否真的改变了生产策略输出。
- 如果只是展示层文案改动，快照不应该变化。
- 如果确实改了生产策略、信号、仓位、B/S 或 `scoreGroups`，必须同步评估是否提升 `SIGNAL_VERSION`。
- 不允许为了让测试通过而直接改 expected；必须先说明策略变更原因和影响面。
- 当前快照可在验证运行时读取临时 `.local/strategy-cache` K 线；验证结束后删除临时缓存。

只有以下情况允许更新 `tests/strategy-baseline-snapshots.json`：

- 生产策略行为有意改变。
- 信号定义、策略配置、`scoreGroups` 或仓位规则有意改变。
- 固定样本缓存数据被重新拉取且末端历史 K 线发生修订。

更新后必须重新运行完整回归，并在相关策略文档中说明改了哪个样本、`windowScore` / `position` / `bsMark` / `simpleAction` 哪些字段变化、是否影响主图 `B/S`、是否需要提升 `SIGNAL_VERSION`。

## 标准流程

新增或复核候选信号时，默认按五步推进：

1. 定义信号：写清分组、用途、是否允许影响第一次 `B/S`。
2. 批量初筛：只看事件触发后的聚合表现，不改生产代码。
3. 单信号深挖：每轮只深挖一个候选，比较强接入、普通接入和低侵入接入。
4. 接入判断：只有收益、回撤、触发频率、重叠度和 `B/S` 影响都合理，才进入实现。
5. 固化证据：实现或否决都要写回文档，历史证据归档到 `docs/history/strategy/`。

为节省时间、API 调用和对话 token，后续策略打磨按三层推进：

1. 快速筛选：普通信号使用 `scripts/strategy-batch-screen.js`；仓位或防守覆盖候选使用对应脚本的 `--screen`。后者固定保留全部市场指数与 `seed` 阶段股票（当前为 `8 + 16` 个标的），只判断是否有决策变化、方向是否明显回归。它只能输出 `continue_full`、`reject` 或 `insufficient_evidence`，不改代码、不接入策略。
2. 正式准入：只有 `continue_full` 的冻结候选才以同一快照运行全样本回放。这里才检查三段时间窗、成本压力、分层、股票稳定性和 `strategy-validation-policy.json` 的完整门槛；`0.50` 个百分点的收益/回撤规则只属于这一层。
3. 单点实现：只有正式准入通过并经人工确认的候选才进入生产代码、版本升级、回归测试和文档固化。

这个流程的目的是减少“因为常用所以添加”的冲动。常用信号只说明它值得讨论，不说明它适合当前策略模板。

仓位与防守候选的快速筛选示例：

```bash
node scripts/strategy-wave-post-add-defense-lab.js --mode=confirmed-higher-low --screen --progress
node scripts/strategy-wave-position-management-lab.js --target-position=80 --screen --progress
node scripts/strategy-wave-right-confirmation-entry-lab.js --screen --progress
```

不带 `--screen` 才是正式准入。快速筛选通过不代表可接入生产；正式准入已 `reject` 的同一候选/同一快照不得因为筛选通过而重新打开。

## 可持续策略迭代闭环

策略研究采用“自动评估、人工准入”的长期闭环。自动脚本只能输出 `recommend_shadow`、`insufficient_evidence`、`reject` 或基线控制状态，不能自动修改生产 `STRATEGIES`、`SIGNAL_RULES`、仓位、`B/S` 或版本号。

每轮遵守以下约束：

1. 每个候选只处理一个策略的一项原子规则，先写明要减少的错误、候选类别、允许影响的 `B/S` 和风险预算。
2. 基线与候选使用相同确认历史快照、共同截止日和缓存哈希；实时 quote、live overlay、盘后待确认数据不得进入研究。
3. 全历史结果只用于描述，准入同时检查三段 126 交易日时间窗口、股票改善比例、`phase2`、压力、高波动、科技、防守和周期分层。
4. 标准成本保持单边 `0.10%`，并同时检查 `0.20%`、`0.30%` 和延迟一根 K 线成交场景。
5. 候选通过历史门槛后先冻结定义和哈希，进入前向影子观察；至少积累 20 个新交易日和 30 个新增受影响决策日，才允许建议人工复核。
6. 没有候选通过时保持生产不变。否决结论和重启条件写回历史验证记录，避免对旧数据反复调参。

验证窗口、成本场景和默认准入阈值以根目录 `strategy-validation-policy.json` 为单一机器配置。候选类型包括：

### 波段 B 质量标签的例外边界

“金色 B / 强确认买点”不是策略候选：它不改变 `position`、动作、风险、门禁、离场或 `B/S`，因此不能复用依赖决策差异计数的通用 `shadow` 命令。它使用独立的股票范围观察状态：

1. 严格复核只能显式执行预注册组合，当前为 `node scripts/strategy-wave-b-quality-report.js --signals=B8,B17`。`--discover`、特征、积分阈值和质量条件搜索都属于发现研究，永远不能直接启用展示。
2. 严格报告必须使用共同确认截止日、完整市场门禁指数、沪深300的三段 126 日窗口、完整延迟成本期限，以及缓存文件和源码哈希。
3. 运行 `node scripts/strategy-iteration.js quality-shadow` 会冻结规则 ID、信号组合、股票范围、历史门槛、缓存/源码快照和冻结日；它只统计冻结日之后、后续 20 日已成熟的既有首次 B 事件。
4. 至少 20 个新增交易日和 30 个新增匹配 B 后，仍需与同期所有首次 B 比较成功/失败、5/10/20 日收益、延迟成本和标的集中度。历史阶段检查年份与跨期分散；短前向窗口不重复使用“年份集中度”门槛。
5. 即使所有自动检查通过，状态也只能是 `recommend_human_review`。只有人工复核独立证据并明确把前端规则集设为 `approved` 后，页面才可显示金色 B；脚本不得自动批准。

质量状态可用 `node scripts/strategy-iteration.js quality-status` 查看。当前状态、规则 ID 和报告路径应写入 `CURRENT_STATUS.md`，不能只留在 `.local/`。

- `performance`：提高扣费后收益，同时限制回撤和换手恶化。
- `risk_control`：降低回撤，同时限制收益损失。
- `efficiency`：减少调仓或换手，同时保持收益与回撤基本稳定。
- `semantic_correctness`：修复信号生命周期或统一决策契约，性能指标作为风险预算而非唯一目标。
- `control`：生产零漂移控制，不参与候选晋级。

统一研究入口：

```bash
# 收盘后刷新全部本地研究缓存；不写生产 IndexedDB
node scripts/strategy-iteration.js refresh --after-close

# 生成四策略正式基线
node scripts/strategy-iteration.js baseline

# 评估全部候选，或用 --strategy 只评估一个策略
node scripts/strategy-iteration.js evaluate --reuse-baseline
node scripts/strategy-iteration.js evaluate --reuse-baseline --strategy 波段抄底型

# 查看自动准入结论
node scripts/strategy-iteration.js review

# 历史门槛通过后冻结并更新影子观察
node scripts/strategy-iteration.js shadow --strategy 波段抄底型 --variant 候选编号
```

`shadow` 只在 `.local/strategy-shadow/` 保存观察状态，不提供自动发布命令。候选经人工确认后，仍按本文既有接入流程和 `STABILITY_CHECKLIST.md` 修改生产代码、升级版本并完成回归。

### 真实问题观察入口

没有明确原子问题时，不继续在旧快照上扫描或调参。先用统一入口记录真实使用中的误买、过早退出、回撤防守过慢、重复调仓或 `B/S`/仓位/解释不一致：

```bash
node scripts/strategy-iteration.js observe-template
node scripts/strategy-iteration.js observe-add --date 2026-07-27 --symbol 600519 --name 贵州茅台 --strategy 综合全能型 --type duplicate_adjustment --bs B --position 30 --actual "实际表现" --expected "期望动作" --signals B15,B1
node scripts/strategy-iteration.js observe-followup --id obs-20260727-001 --horizon 3 --date 2026-07-30 --return-pct -2.35 --note "三日后表现"
node scripts/strategy-iteration.js observe-list --pending-followup
node scripts/strategy-iteration.js observe-summary
```

观察记录临时保存在 `.local/strategy-observations.json`。同一策略、同一问题类型至少重复出现 2 次时，汇总会列为重复问题，但仍须人工确认是否属于同一原子原因。形成候选结论后把证据写入 `CURRENT_STATUS.md` 或历史策略记录，并删除临时观察文件，不把它长期当作第二套待办池。

## 四个正式策略的打磨目标

四个正式策略不以“同一段历史里谁的收益最高”决定优劣。它们共用生产决策链和 `B/S` 契约，但各自解决不同的使用场景；打磨时必须同时比较平均策略收益、最大回撤、持仓比例、调仓次数、完整交易胜率和第一次 `B/S` 的可解释性。

| 策略 | 面向用户的职责 | 优先减少的错误 | 不应为了优化而牺牲的行为 |
| --- | --- | --- | --- |
| 稳健趋势型 | 新手默认入口，跟随中期趋势并控制明显下跌 | 趋势破坏后仍持仓、无趋势时频繁试错 | 清晰的趋势持有与防守切换，且不依赖高频交易 |
| 波段抄底型 | 在超跌修复中小仓试探 | 下跌中继被误判为底部、反弹失败后防守过慢 | 只在修复确认后参与，首次 `B` 仍可解释为小仓试探 |
| 突破追涨型 | 只参与质量较高的突破机会 | 假突破、放量不足或追高后的快速回撤 | 未确认前保持观察，确认后用明确的失效条件防守 |
| 综合全能型 | 在趋势、回踩和修复机会之间提供均衡选择 | 信号重叠累加、过度交易和回撤高于组合价值 | 不把多个相近信号叠成重复加分，保留低吸/修复的小仓语义 |

每次只允许打磨一个策略的一项规则，并与四策略同样本基线比较。候选方案必须说明：改善的是哪一种错误、是否改变第一次 `B/S`、对其他三套策略是否无影响；若收益改善只来自更高回撤、更多调仓或更难解释的 `B/S`，默认不接入。

## 信号接入矩阵

候选信号先放入矩阵，不直接写入 `SIGNAL_RULES` 或策略配置。

| 类型 | 优先验证方式 | 默认接入态度 | 必须证明 |
| --- | --- | --- | --- |
| 买入信号 | 先做过滤器或低权重确认，不直接做独立买点 | 谨慎 | 能提高第一次 `B` 质量，且不会显著增加误买和调仓 |
| 风险预警 | 先做已有持仓内仓位上限或提示 | 低侵入 | 不制造第一次 `S`，不明显牺牲收益 |
| 离场信号 | 区分强离场、普通减仓、持仓内保护 | 谨慎 | 强离场必须有足够收益/回撤边际，且 `B/S` 变化可解释 |
| 观察信号 | 只展示或用于复盘 | 默认不接入 | 不计入 `windowScore`、`position`、`simpleAction` |
| 重复信号 | 与现有信号做重叠率比较 | 合并或否决 | 明确比现有信号多解决了什么问题 |

风险类候选不要一开始就做强卖点。默认先测试：

- 已有持仓且目标仓位较高时限制仓位上限。
- 当日普通减仓观察，而不是清仓冷静期。
- 只作为复盘提示，不进入 `warningSignals` 或 `exitSignals`。

`W4` 的经验：直接作为全局预警会替换部分 `B/S` 日期；改成已有持仓高仓位上限后，能降低侵入性并保留正向边际。

`W5/L12` 的经验：逻辑成立不等于值得接入。若低侵入方案收益边际为负或很小，且与现有风险系数/强离场重复，应保留观察。

## 波段抄底买点与试探止损验证口径

波段抄底型不把“买到最低价”作为可验证目标。可验证目标是：在长期下跌结构中，修复证据出现后及时建立小仓位，同时把快速下跌的损失限制在可解释范围内；`B` 仍表示最终仓位从 `0` 变为大于 `0`，不是底部预测标签。

本轮 H 方案使用 89 只股票 + 7 个指数、`2022-05-19` 至 `2026-07-21` 的本地前复权缓存，长期下跌筛选为 `收盘价 < MA60`、`MA20 < MA60`、`MA60 <= 20 日前 MA60`。首次满足生产波段条件时立即建立最多 `20%` 试探仓，止损价取入场日现有 `risk.stop`，收盘跌破后退出并观察 3 个交易日。

| 方案 | 股票平均收益 | 股票平均最大回撤 | 股票完整交易胜率 | 判断 |
| --- | ---: | ---: | ---: | --- |
| 生产基线 | `6.49%` | `14.92%` | `31.60%` | 买点偏修复确认，未承诺最低价 |
| H：立即试探 + 入场固定风险防守位 | `7.62%` | `12.60%` | `30.41%` | 暂不接入，仅保留候选证据 |

H 相对基线少 `26` 笔完整交易，识别到 `1191` 次长期下跌试探机会，错过 `3` 次快速反弹，同时避免 `38` 次快速下跌。聚合回撤有价值，但 89 只股票中收益改善 `42`、变差 `46`，中位收益下降 `0.14` 个百分点；科技类样本 `9/9` 收益变差，并且没有样本外验证。因此不进入生产，只有新增独立时间段或新标的后，才重启评估。

当前候选状态和下一步以 `docs/strategy/STRATEGY_DECISION_RULES.md` 的候选池为准。

## API、缓存与报告规则

补缓存时遵守：

- 可以临时生成 `.local/strategy-cache/`，同一轮已有缓存不重复拉取。
- 每轮新增不超过 12 个标的。
- 串行或小批量执行，推荐单标的间隔不少于 1200ms。
- 不把原始 K 线输出到对话，只写临时缓存；验证结束后删除缓存。
- 对话里只汇总：新增数量、失败数量、行业覆盖、样本日期范围。

回测候选信号时遵守：

- 批量初筛阶段可以一次验证多个候选信号，但只输出聚合排序；深挖和代码实现阶段每轮只处理一个候选信号。
- 不输出逐笔交易明细到对话。
- 不输出每只股票完整 K 线。
- 对话只展示按策略聚合后的收益、胜率、最大回撤、调仓、主图 B/S 变化和结论。
- 明细报告可临时写入 `.local/strategy-reports/`，人工复盘和结论固化后删除。

新增验证脚本时，回归测试至少约束：

- 只在运行期间读写临时 `.local/strategy-cache/` / `.local/strategy-reports/`。
- 结束后不要求保留 `.local/` 文件。
- 不包含 `fetch()` 或 `http/https` 网络调用。

## 接入阈值

候选信号进入策略前至少满足：

- 说明属于趋势、突破、回踩、超跌、预警还是离场。
- 说明是否允许影响第一次 `B/S`。
- 在扩样池上比较当前基线和候选规则。
- 若改变第一次 `B/S`，必须补回归测试。
- 若只改善单一策略但显著恶化综合或稳健策略，默认不直接接入全局。

被否决的信号必须记录原因，否则后续会重复评估。否决记录至少包含：

- 候选名称和分组。
- 验证样本和报告路径。
- 触发频率和重叠度。
- 对收益、回撤、调仓和主图 `B/S` 的影响。
- 不接入原因。
- 后续若要重启评估，需要满足什么新条件。

不要只写“无用”。应区分重复、噪音、滞后、数据不稳定、边际不足和侵入性过高。

## 验证命令

批量初筛命令：

```bash
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/strategy-batch-screen.js
```

若需要覆盖 `phase2` 已缓存样本，使用：

```bash
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/strategy-batch-screen.js --include-phase2
```

低侵入仓位层深挖命令：

```bash
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/strategy-w5-deep-dive.js
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/strategy-l12-deep-dive.js
```

版本号、生产发布和 smoke 触发口径以 `STABILITY_CHECKLIST.md` 为唯一规则源。本文只补充策略验证判断：修改 `SIGNAL_RULES`、`STRATEGIES`、`scoreGroups`、权重、阈值、`calculateAllSignals()`、`getSignalMeta()` 或 `computeDecisionForIndex()` 时，必须评估 `SIGNAL_VERSION`；只改文档或本地验证记录不等于生产策略行为变化。

常用验证命令：

```bash
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check scripts/strategy-batch-screen.js scripts/strategy-l12-deep-dive.js scripts/strategy-w5-deep-dive.js tests/regression.js
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/regression.js
```

四个正式策略的同样本横向基线命令：

```bash
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/strategy-formal-baseline-report.js
```

该命令只读取 `.local/strategy-cache/`，逐一回放稳健趋势、波段抄底、突破追涨和综合全能的生产决策链，并在 `.local/strategy-reports/` 生成报告。比较时以平均策略收益、平均最大回撤、持仓比例、调仓和主图 `B/S` 为准；样本覆盖不足时只建立基线，不据此调阈值或新增信号。

补充缓存与正式策略候选实验命令：

```bash
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/strategy-cache-fetch.js --codes 代码1,代码2
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/strategy-formal-candidate-lab.js --strategy 波段抄底型
```

缓存拉取一次最多新增 12 个标的，按“东方财富前复权优先、腾讯前复权回退、串行间隔至少 1200ms”执行。候选实验只在 VM 内临时覆盖信号或策略配置；候选必须同时输出整体、股票、`phase2`、压力样本的收益、回撤、持仓、调仓及 `B/S` 差分，不能以单一分组改善作为接入依据。

涉及具体候选时，再运行对应深挖脚本。
