# DailyGlance 稳定期检查清单

> 生产代码、版本号、发布或 smoke 相关改动前阅读。普通开发迭代按 `AI_WORKFLOW_NOTES.md` 的效率优先模式执行。
> 工程流程按风险选择：简单可见问题可直接最小修复；复杂、复发、数据或策略问题再进入 `diagnose` / `zoom-out` / `review`。

---

## 问题分诊（Triage）

| 标签 | 标准 | 处理策略 |
|------|------|----------|
| Blocker | 功能完全不可用 | 直接修 |
| Visible | 可看到但体验差 | 排一个修一个 |
| Silent | 看不见但会积累 | 每 5 个批处理 |

---

## 影响面分析（生产代码改动前）

改动任一文件前，列出影响清单。本项目关键依赖关系：

```
改 04-render.js 的 getYScale()
  → 成交量 y 轴？  [是/否]
  → 主图 y 轴？    [是/否]
  → MACD y 轴？    [是/否]
  → KDJ y 轴？     [是/否]
  → volumeBarPlugin？ [是/否]（依赖 y.getPixelForValue）
  → macdBarPlugin？   [是/否]
  → localAlignPlugin？[是/否]
  → bsMarkerPlugin？  [是/否]

改 04-render.js 的 plugin 绘制逻辑
  → 4 个 plugin (volumeBar/MACDBar/localAlign/bsMarker)
  → 必须同步加 chartArea / scale / isNaN 安全检查

改 02-data.js 的 setRawData() / scheduleCachedFetchRefreshApply()
  → renderCache 清空时机？
  → clearDerivedCaches vs clearLookupCacheOnly？
  → 同日价格 / 新日 K 线 / 冻结浏览三条路径
  → 后台刷新和手动更新是否共用 applyActiveDataRefresh？
  → 同日轻量路径是否避免 draw() / safeUpdateSidebar() 全量重建？
  → 分析区 cardAnalysis 是否保持可见且内容不空？

改 index.html
  → ?v= 版本号 + APP_BUILD 同步更新
  → 脚本加载顺序不可改
```

---

## Smoke Test（仅在阶段测试 / 发布收口后启动）

问题确认、修复优先级和阶段测试节奏见 `AI_WORKFLOW_NOTES.md`。只有用户明确说“可以阶段测试”或“准备发布”后，才可启动本节；先查 `CURRENT_STATUS.md` 的“待办与风险”，把未关闭待办合并进本轮验证清单。

`scripts/status-smoke.js`、`scripts/live-dataflow-smoke.js`、Playwright 浏览器检查和人工桌面视觉复验均属于本节完整 smoke。普通开发迭代不得因“生产代码已改”或“需要额外本地证据”提前执行；开发期仅做与改动直接相关的最小确认。

```
□ 图表渲染
  □ 主 K 线蜡烛正常显示（涨红跌绿）
  □ 成交量柱子正常显示 + y 轴数值可见
  □ MACD 柱子 + diff/dea 线正常显示
  □ KDJ 线正常显示
  □ 页面没有残留 `.empty-hint` / “暂无数据”
  □ canvas 已绑定当前标的与周期 scope，不能只用右侧面板有数据代替图表成功

□ 柱子对齐
  □ 成交量柱子中心 = 蜡烛中心 = MACD 柱子中心

□ 十字线交互
  □ 鼠标悬浮：白色虚线跟随（竖线 + 主图横线）
  □ 图表点击 K 线不进入锁定/冻结历史浏览
  □ 历史浏览只通过上一天 / 下一天 / 最新、键盘方向键和主图拖拽进入或退出

□ 右侧面板
  □ 价格区不闪烁（同日价格刷新时）
  □ 分析区不空白（新日 K 线 / 周期切换时）
  □ 同日价格刷新后分析区仍显示，且包含“每日结论”
  □ 涨跌颜色正确（涨红跌绿）

□ 开盘刷新性能
  □ 后台同日刷新走轻量路径，不触发 draw()
  □ 手动“更新数据”同日刷新也走轻量路径，不触发 draw()
  □ 新日 K 线 / 首次加载 / 历史浏览仍走对应全量或历史路径
  □ 浏览器复验前确认实际加载的是最新 ?v= 版本

□ 日期导航
  □ ◀ ▶ 按钮正常切换日期
  □ "最新"按钮回到最新 bar
  □ 主图拖拽到历史窗口后点“最新”，右侧日期、历史徽章、按钮 active/is-history 必须一起恢复最新态
  □ 键盘左/右方向键正常
  □ 键盘右方向键回到最后一根 K 线时，“历史浏览”徽章自动消失
  □ 按钮路径和键盘路径的日期、冻结状态、右侧面板文案一致
  □ 点击任意 K 线不会进入历史浏览；通过按钮/键盘/拖拽进入历史后再点"最新"，徽章隐藏且"最新"按钮恢复 active
  □ "最新"按钮 active/is-history 必须同时匹配 lockIdx 和 isFrozen，不能只按索引判断
  □ 刷新数据时不丢失当前浏览位置
```

## 浏览器 smoke 深度规则

桌面端 smoke 不只看首屏截图。阶段测试、发布验证或线上稳定声明时，按改动风险覆盖：

- DOM 文案：右侧价格日期、每日结论、失效条件和关键推导依据不能空白。
- 视觉状态：历史浏览徽章、最新按钮 active/is-history、十字线 frozen class 要和当前日期状态一致。
- 等价入口：按钮点击、键盘左/右方向键和主图拖拽要保持同一状态语义；图表 hover 只做预览，图表 click 不进入历史锁定。
- 控制台：初始化噪声隔离后记录 console error/warn。

历史浏览 / 最新状态有多条入口时，重点确认：

- 右方向键到最后一根、点“最新”、拖拽回最新窗口都退出历史浏览。
- 徽章隐藏且“最新”按钮恢复 `active`。
- 如果 `generateSidebarBundle()`、`updateNavCapsuleVisuals()`、`resetLatest()` 等多条路径写按钮 class，必须共用判定或补回归覆盖生成 HTML 与后续 class 更新。
- “最新”恢复要清理 pending hover / `hoverRAF`，防止旧 hover 覆盖刚恢复的右侧日期。

高频数据刷新有多个入口时，优先验证共用“应用刷新结果”的分流函数。后台缓存刷新和手动“更新数据”同日最新 K 线应走轻量路径，只更新指标/决策、右侧价格 DOM、分析区可见性和“最新”按钮状态，不重绘 4 块图表；新日 K 线、首次加载、历史冻结浏览再走全量或历史路径。

图表区 smoke 必须证明四个 canvas 自身恢复，而不是只看右侧面板有数据。复验时检查实际 `?v=`、`.empty-hint` 数量、canvas scope/尺寸或非空渲染状态、右侧 `cardAnalysis` 可见性和 console。

历史 K 线 API 与实时行情 API 的职责边界以 `docs/data/DATA_CONTRACT.md` 为准。实时 quote 不能修复历史缺口；历史 API 未确认到可接受日期时，实时行情只能用于左侧报价，不能拼到图表最后一根、不能写 IndexedDB、不能驱动正式指标、策略或主图 `B/S`。

---

## 边界数据验证

| 边界 | 数据场景 | 验证点 |
|------|----------|--------|
| 空数据 | `rawData = {}` | clearCharts 正常、无报错 |
| 最小数据 | 1 根 K 线 | draw() 不崩、十字线不越界 |
| 最大数据 | 1000 根 K 线 | volMax 不溢出、绘图不卡 |
| 全 null 数据集 | 手绘 plugin 的 data 全 null | plugin 安全跳过 |
| 同日价格刷新 | 定时器推送到同一日期 | updateSidebarPriceOnly 正常、cardAnalysis 可见、drawCount=0 |
| 新日 K 线 | 定时器推送到新日期 | safeUpdateSidebar 正常、cache 覆盖 |

---

## 版本号规则

- `APP_BUILD` 格式：`2026-06-26-XX`（日期-序号）
- 只改文档、测试、协作规则、说明文件，不提升 `APP_BUILD`，也不改 `index.html` 的 `?v=`
- 开发迭代期的小范围生产 JS/CSS/HTML 改动，尤其是纯文案、轻量样式和正在人工连续复核的 UI 细节，不要求每次单独升版本号；先用最小相关验证确认改动有效
- 同一轮相关 UI/交互改动收敛后，如果准备浏览器复验、阶段测试、发布验证或收口，再统一递增 `APP_BUILD`，并同步 `index.html` 中所有 `?v=`
- 已经用某个 `?v=` 做过正式浏览器复验、发布验证或线上 smoke 后，继续追加修改同一生产资源时，必须继续递增版本号，不复用刚刚验证过的旧 `?v=`
- 版本号严格递增，方便 `git bisect` 定位

---

## 已知陷阱（不要重蹈覆辙）

1. **xScale.width ≠ xScale.right**：边界判断用 left/right，不用 width
2. **c.update('none') 在 onHover 回调中会永久破坏交互**：只能用于非高频场景
3. **手绘 plugin 的 data 必须填 null 但 y 轴需手动设 min/max**：成交量 + MACD
4. **getYScale(true) 改 display/grid 会波及用户可见的数值刻度**
5. **NA安全**：所有 plugin 的 getPixelForValue() 调用必须 isNaN 保护
6. **侧栏 HTML 生成和后续 class 更新必须共用状态判定**：例如“最新”按钮不能在 `generateSidebarBundle()` 按索引 active、在 `updateNavCapsuleVisuals()` 按冻结状态 is-history，否则缓存命中或早退会留下旧 UI 状态
7. **预加载内存数据 + clearCharts 会制造空图表竞态**：活动标的已有 `state.rawData[id]` 时，`cachedFetch()` 不能无条件早退；如果图表实例已被清空，必须用内存数据补一次首屏绘制。
8. **最新态恢复要清理异步 hover**：拖拽/hover 可能留下 `hoverRAF` 或旧鼠标位置事件，`resetLatest()` 必须取消 pending hover，并用回归覆盖“点击最新后旧 hover 覆盖右侧日期”的时序。
