# AI 协作入口

用户只描述目标，AI 按任务补读必要文档并执行；不依赖额外的通用技能路由。

## 唯一规则源

- `AGENTS.md`：唯一协作入口，统一维护问答/执行边界、任务路由、最小验证和沉淀路由。
- `CURRENT_STATUS.md`：唯一当前状态、待办、待验证和下一步来源。
- `STABILITY_CHECKLIST.md`：唯一版本号、完整回归、发布 smoke 和 GitHub Pages 发布流程来源。
- `README.md`：项目总览、文档地图、目录边界和 GitHub Pages 部署边界。
- `docs/product/`、`docs/data/`、`docs/strategy/`：只维护各自领域契约，不重复协作、沉淀或发布流程。

## 默认阅读顺序

开发迭代期默认只读最小入口：

1. `AGENTS.md`
2. 与任务直接相关的源码或测试

以下信息按需补读，不作为每次开发的默认上下文：

- 需要接续状态、待办或下一步：读 `CURRENT_STATUS.md`
- 用户明确要求“更新并推送 GitHub”“发布到 GitHub Pages”或等效发布指令：读 `STABILITY_CHECKLIST.md`
- 涉及 Design Token、共享组件、组件变体/状态、新增可复用组件或页面级复合组件：读 `docs/product/UI_DESIGN_SYSTEM.md`；实际改变设计契约时必须同步该规范，纯局部修复不强制更新
- 涉及数据源、缓存、实时/历史边界：读 `docs/data/DATA_CONTRACT.md`
- 涉及右侧结论、展示话术：读 `docs/product/PRODUCT_DECISION_GUIDE.md`
- 涉及策略、仓位、`B/S` 或信号：读 `docs/strategy/STRATEGY_DECISION_RULES.md`
- 真实改变信号、仓位、首次 `B/S`、交易频率或收益主张：再读 `docs/strategy/STRATEGY_VALIDATION_GUIDE.md`
- 涉及目录、上传或本地保留：读 `README.md` 的“目录与发布边界”

历史文件默认不读；只有追溯证据时，才按“唯一沉淀路由表”读取相关 `docs/history/` 记录。

## 问答与执行边界

- 用户在问“为什么、是否如此、该不该”时，只解释和审计，不改文件、不跑测试、不执行 Git 或发布。
- 用户明确要求实施且范围清楚时直接执行；只有产品方向、数据结构、交付范围或成功标准不明确时才做最小确认。
- 开始执行前，用一句话说明改动范围、保持不变的边界和最低验证。用户不需要填写任务卡、选择测试或安排 Agent。
- 用户说“按建议执行”“继续”“修复”或“执行”，只授权当前本地修改和定向验证，不代表同意版本同步、完整回归、smoke、提交、推送或发布。
- 简单任务不建复杂计划、不派 Agent。只有用户已确认的复杂任务可独立拆分时，主 Agent 才按需使用 Team Mode，并保留关键决策和最终验收。

## 四类任务路由

| 任务类型 | 最小读取 | 最低验证 |
| --- | --- | --- |
| 视觉 | 相关 HTML/CSS/渲染代码；命中设计契约时补读 `docs/product/UI_DESIGN_SYSTEM.md` | 界面路径检查；涉及 JS 时再做语法检查 |
| 交互 | 相关状态、事件和生命周期代码 | 对应回归分组与关键操作路径检查 |
| 功能/数据 | 相关实现与 `docs/data/DATA_CONTRACT.md` | 对应回归或单点数据路径检查 |
| 策略 | `docs/strategy/STRATEGY_DECISION_RULES.md`；真实改变策略契约时再读验证指南 | 先分类为展示翻译、语义修正、信号时机修正或核心策略变更，再执行对应定向验证 |

实际改动触及更高风险边界时，按最高风险车道升级；不因任务描述里同时出现多个关键词而重复走流程。开发迭代期按用户逐个反馈连续修复，每个问题只做与当前改动直接相关的定向验证。

## 变更影响矩阵

先按实际改动文件定位验证范围，不按整个工作区的文件数量扩大任务。以下命令均为最低检查；只有跨越多个边界或收到明确发布指令时才升级。

| 改动范围 | 典型文件 | 最低检查 |
| --- | --- | --- |
| 每日一览展示 | `index.html`、`assets/css/dailyglance.css`、`assets/js/01-config-ui.js`、`assets/js/04-render.js`、`assets/js/06-settings.js`、策略查看器页面与样式 | `node scripts/check.js --files=...`，对应 `presentation-state` |
| 正式策略配置 | `assets/js/00-strategy-config.js` | `node scripts/check.js --files=...`，对应 `strategy-decision`；真实改变参数时再补策略专项验证 |
| 主应用交互 | `assets/js/05-app.js`、自选股/设置/刷新事件 | `node scripts/check.js --files=...`，对应 `chart-navigation`、`watchlist-lifecycle` |
| 数据与缓存 | `assets/js/02-data.js`、`docs/data/` | `node scripts/check.js --files=...`，对应 `data-cache` |
| 策略决策 | `assets/js/03-calculations.js`、`docs/strategy/`、策略脚本和策略用例 | `node scripts/check.js --group=strategy-decision`，必要时补专项验证 |
| 仅文档或协作规则 | `AGENTS.md`、`README.md`、`CURRENT_STATUS.md`、`docs/` | `git diff --check` 和 Markdown 结构/链接检查 |
| 跨层或正式发布 | 同时触及两类及以上，或明确要求发布 | 先跑各自定向检查；发布时再读 `STABILITY_CHECKLIST.md` 执行完整回归和 smoke |

`node scripts/check.js --changed` 只适合改动边界已经清晰的工作区；当工作区混有研究、界面和文档修改时，优先使用 `--files` 或 `--group`，避免把无关改动自动带入验证。

## 最小验证

- 普通任务只验证本次改动相关的语法、渲染、回归或数据路径，不默认扩大到全量回归、浏览器 smoke 或线上检查。
- 文档改动只做引用、Markdown 结构和 diff 检查；“未跑全量测试”不单独成为长期待办。
- 展示翻译和语义澄清不做收益研究。真实改变信号、仓位、首次 `B/S`、交易频率或收益主张时，遵循 `docs/strategy/STRATEGY_VALIDATION_GUIDE.md`。
- 策略快筛不自动升级为全量基线或全量回放；只有核心策略变更、收益/回撤优势主张或确有跨样本不确定性时，才进入全量研究。
- 同一份相关源码没有再次变化时，已经通过的检查继续有效；是否进入发布验证只由明确发布指令决定。

## 唯一沉淀路由表

| 内容 | 唯一位置 | 边界 |
| --- | --- | --- |
| 协作入口、执行边界、任务路由、最小验证 | `AGENTS.md` | 其他文档只引用，不复述 |
| 当前状态、真实风险、待办、待验证、下一步 | `CURRENT_STATUS.md` | 只保留仍有效内容；结束内容及时归档 |
| 版本号、完整回归、发布 smoke、GitHub Pages 发布流程 | `STABILITY_CHECKLIST.md` | 仅在明确发布指令后读取和执行 |
| 项目总览、文档索引、目录与部署边界 | `README.md` | 不承载协作、策略或发布步骤 |
| UI Token、共享组件和设计契约 | `docs/product/UI_DESIGN_SYSTEM.md` | 只维护当前设计契约 |
| 右侧结论与展示话术 | `docs/product/PRODUCT_DECISION_GUIDE.md` | 只维护当前产品表达规则 |
| 数据源、缓存、实时/历史边界 | `docs/data/DATA_CONTRACT.md` | 只维护当前数据契约 |
| 当前生产策略、仓位、信号和 `B/S` 契约 | `docs/strategy/STRATEGY_DECISION_RULES.md` | 不记录候选过程或发布步骤 |
| 策略研究方法、准入边界和命令入口 | `docs/strategy/STRATEGY_VALIDATION_GUIDE.md` | 不记录当前候选结果或发布步骤 |
| 已结束的阶段、发布和研究证据 | `docs/history/` 对应领域 | 只作追溯，不作为当前规则或默认上下文 |
| 缓存、临时报告、日志、草稿和对照文件 | `.local/`、`.workbuddy/` | 不进入长期文档、部署包或流程入口 |

## 交付与长期边界

- 最终交付只说明完成内容、使用或预览方式、实际验证、建议检查点和剩余风险。
- 目录分类和 GitHub 上传边界以 `README.md` 的“目录与发布边界”为准；GitHub 只用于通过 Pages 展示/访问应用，不是完整源码仓库。
- 技能和经验库按任务触发，不因为普通开发迭代默认展开多技能、经验沉淀或经验审核。
- 产品核心目标：围绕“新手每天看一眼就知道股票状态、动作、风险和失效条件”优化，不重新造一套策略引擎。
- 终端以电脑端使用为主；移动端只显示“请使用电脑端打开”的提示层，不做完整交易终端适配。
