# DailyGlance 稳定记录（2026-07-30-02）

## 范围

- 将波段 B 的“金色 B / 强确认买点”从历史筛选后的直接展示，收紧为预注册、严格复核和独立前向观察后的展示层标签。
- 当前前端 `WAVE_B_QUALITY_RULESET` 保持 `status: 'shadow'`；页面不显示金色 B 或“强确认买点”。
- 本轮没有修改波段策略的积分、仓位、动作、风险、门禁、离场、冷静期或四套正式策略的 `B/S` 语义。

## 冻结状态

- 预注册规则：`wave-b-quality-20260730-02-b8-b17`，仅股票模式、波段抄底型、既有首次 B，同时要求 `B8+B17`。
- 严格报告：`.local/strategy-reports/wave-b-quality-report-20260730T043241Z.json`；90 只股票，统一截止 `2026-07-29`，数据快照哈希 `c50eb4e01a5a3d04f2b7de7bdbe56f456290bd9a02e8d7ebc48d26d4c7900ace`。
- 候选为 `76` 个样本、`45` 个标的、成功率 `50.00%`；普通 B 成功率 `35.19%`，优势约 `+14.81` 个百分点，未达到 `+15` 门槛。三个独立 126 日窗口样本为 `12 / 2 / 2`，也未达到至少两个窗口各 `5` 个样本的要求。
- 因此历史结论为 `historicalQualified=false`，不具备正式展示资格。
- 已冻结 `.local/strategy-shadow/wave-b-quality-20260730-02-b8-b17.json`：`frozenAsOf=2026-07-29`，新增交易日与成熟匹配 B 均为 `0`，状态为 `shadow_observe`。

## 机制约束

- 严格报告只接受 `--signals=B8,B17`；发现型信号、特征、积分阈值或质量条件搜索不能进入影子状态。
- 报告固定股票范围、完整市场门禁指数、沪深300的三段时间窗、完整延迟成本期限，并记录缓存和源码哈希。
- `quality-shadow` 只计算冻结后的成熟 B 事件；达到 20 个新增交易日和 30 个成熟匹配 B 后仍须通过前向的成功/失败、收益、延迟成本和标的集中度检查。
- 自动流程最多输出 `recommend_human_review`，不会把规则改为 `approved`。

## 验证

- `node --check scripts/strategy-wave-b-quality-report.js`
- `node --check scripts/strategy-wave-b-quality-shadow.js`
- `node --check scripts/strategy-iteration.js`
- `TEST_GROUP=strategy-decision node tests/regression.js`
- `TEST_GROUP=presentation-state node tests/regression.js`
- `node tests/strategy-iteration.js`
- `node scripts/strategy-wave-b-quality-report.js --signals=B8,B17 --event-details`
- `node scripts/strategy-iteration.js quality-shadow --reuse-report --refreeze`

完整 `node tests/regression.js` 已在本记录创建后复跑确认。

## 后续

只在出现新的确认交易日后执行 `node scripts/strategy-iteration.js quality-shadow`。没有完成冻结后的前向观察和人工复核，不得恢复金色 B 展示、提高仓位或放宽 B 的准入条件。
