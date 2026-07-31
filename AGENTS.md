# AI 协作入口

本项目使用 engineering-skills 包，以 `start` 为路由入口。用户只描述目标，AI 负责按任务选择技能和补读文档。

## 唯一规则源

- `AGENTS.md`：唯一阅读入口和任务路由。
- `AI_WORKFLOW_NOTES.md`：协作节奏、问答/执行边界、人工问题确认和收口方式。
- `CURRENT_STATUS.md`：唯一当前状态、待办、待验证和下一步来源。
- `STABILITY_CHECKLIST.md`：唯一生产代码影响面、版本号、发布验证和 smoke 清单来源。
- `README.md`：项目总览、文档地图、目录边界和 GitHub Pages 部署边界。

其他领域文档只负责各自业务规则，不重复改写上述流程规则。

## 默认阅读顺序

开发迭代期默认先读最小入口：

1. `AGENTS.md`
2. `AI_WORKFLOW_NOTES.md`
3. `CURRENT_STATUS.md`（需要接续状态、发布状态、待办或下一步时）

再按任务补读相关文件：

- 涉及生产代码、版本号、发布或 smoke：读 `STABILITY_CHECKLIST.md`
- 涉及数据源、缓存、实时/历史边界：读 `docs/data/DATA_CONTRACT.md`
- 涉及右侧结论、展示话术：读 `docs/product/PRODUCT_DECISION_GUIDE.md`
- 涉及策略、仓位、`B/S` 或信号：读 `docs/strategy/STRATEGY_DECISION_RULES.md`
- 涉及策略验证、候选信号或样本池：读 `docs/strategy/STRATEGY_VALIDATION_GUIDE.md`
- 涉及目录、上传或本地保留：读 `README.md` 的“目录与发布边界”

阶段测试、发布收口或需要追溯验证证据时，再补读最新的 `docs/history/STABLE_VERSION_*.md`、`STABILITY_CHECKLIST.md` 和相关代码。

## 规则

- 生产代码、版本号、发布或 smoke 相关改动必须遵循 `STABILITY_CHECKLIST.md`；普通文档/流程/说明改动不默认展开 smoke 清单。
- 当前待修复、待验证和下一步只写入 `CURRENT_STATUS.md`，不再维护独立待测池文件。
- `CURRENT_STATUS.md` 只保留当前状态、风险和下一步；已结束的长篇复盘写入 `docs/history/`，避免把历史细节重复带入每次协作。
- 目录分类和 GitHub 上传边界以 `README.md` 的“目录与发布边界”为准；GitHub 只用于通过 Pages 展示/访问应用，不是完整源码仓库。
- 技能和经验库按任务触发，不因为普通开发迭代默认展开多技能、经验沉淀或经验审核。
- 产品核心目标：围绕“新手每天看一眼就知道股票状态、动作、风险和失效条件”优化，不要重新造一套策略引擎。
- 终端以电脑端使用为主；移动端只显示“请使用电脑端打开”的提示层，不做完整交易终端适配。
