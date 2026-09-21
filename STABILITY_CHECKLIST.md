# DailyGlance 发布与稳定期检查清单

> 本文是版本号、完整回归、发布 smoke 和 GitHub Pages 发布流程的唯一详细规则源。仅在用户明确要求“更新并推送 GitHub”“发布到 GitHub Pages”或等效发布指令后阅读和执行。

## 发布范围与准备

- 先刷新 `origin/main`，比较 `index.html`、`assets/`、`.github/workflows/pages.yml` 和 `.gitignore` 的实际差异；发布范围以远端与 Pages 路径事实为准，不以完整工作区的脏文件数量推断。
- 从 `origin/main` 建立独立 worktree 处理发布，只同步 Pages 所需的 `index.html`、`assets/` 和 `.gitignore`；`.github/workflows/pages.yml` 只在核对或清理旧自定义工作流时进入范围。
- 本地文档、测试、策略工具、样本元数据、缓存和其他未提交修改不进入部署包，也不因存在而扩大验证范围。
- `CURRENT_STATUS.md` 只提供背景；若与 Git 差异、远端提交或 Pages 状态不一致，以可验证事实为准，并在发布完成后修正当前状态。

## 生产影响面

- 图表比例尺或 plugin：检查四个 canvas、刻度、对齐和空值保护。
- 数据刷新或缓存：检查同日轻量刷新、新日全量刷新、历史浏览和右侧结论不空白；数据口径以 `docs/data/DATA_CONTRACT.md` 为准。
- 历史导航：按钮、键盘和拖拽必须有一致的最新/冻结状态，图表点击不得进入历史锁定。
- 入口资源：保持脚本加载顺序；准备 GitHub 发布时再同步资源版本。

## GitHub 发布验证

只有用户明确要求更新并推送 GitHub 后，先读取 `CURRENT_STATUS.md`，再统一完成版本同步、受影响回归和一次必要 smoke；只有跨模块影响或用户明确要求时才升级为完整回归：

- 图表、成交量、MACD、KDJ 和右侧结论均有有效内容，控制台无新增错误。
- 同日刷新不重绘整图；新日、首次加载和历史浏览走对应路径。
- 历史导航的按钮、键盘、拖拽与“最新”状态一致。
- 数据改动覆盖空数据、最小数据、历史缺口、quote-only 与 live overlay 边界。
- 发布前确认实际加载新资源版本；发布后再运行必要的本地或线上 smoke。

`scripts/status-smoke.js`、`scripts/live-dataflow-smoke.js`、Playwright 和多入口桌面复验均属于发布 smoke，不在普通开发期提前运行。

### 发布快速车道

确认发布范围后，统一完成必要的版本同步、受影响回归和一次桌面状态 smoke；以下检查只按实际影响追加：

- 纯文案、HTML/CSS 或局部渲染改动：补变更 JS 语法检查和对应回归分组。
- 状态、事件或历史导航改动：增加对应交互路径检查；只有数据刷新、缓存或实时行情链路变化时才运行 `live-dataflow-smoke`。
- 信号、积分、仓位、`B/S` 或跨模块公共契约变化：在统一完整回归之外，增加必要的策略专项验证或更广 smoke。
- `node scripts/check.js --full` 不是发布默认项，只用于确有跨模块影响或用户明确要求的完整发布检查。
- 同一份相关源码未变化时不重复运行已经通过的检查；只递增版本号时运行版本同步检查即可。
- 发布状态查询只保留提交号、状态和结论。Pages 直连若已知受网络重置影响，最多重试一次；Actions 成功且远端部署文件版本正确时记录网络风险，不循环等待。
- 回归分组通过 `scripts/check.js` 合并为单进程执行；成功输出摘要，失败再展开失败用例和堆栈。
- Pages 发布优先使用 `node scripts/release-pages.js` 准备隔离 worktree；确认允许列表和提交无误后，才显式增加 `--push`，需要清理临时 worktree 时再增加 `--cleanup`。

## 版本号规则

- 根目录 `version.json` 是当前版本唯一来源，包含 `appBuild`、资源参数和 `signalVersion`。
- 修改版本时先改 `version.json`，再运行 `node scripts/sync-version.js` 同步浏览器配置和 `index.html`；`node scripts/sync-version.js --check` 用于阻止漏同步。
- `APP_BUILD` 与资源参数用于应用构建和缓存追溯，不得作为策略基线快照的失效条件；策略快照只与 `signalVersion` 和实际决策结果绑定。
- `APP_BUILD` 格式：`2026-06-26-XX`（日期-序号）
- 只改文档、测试、协作规则、说明文件，不提升 `APP_BUILD`，也不改 `index.html` 的 `?v=`
- 开发迭代期的本地生产 JS/CSS/HTML 和策略修复不单独升版本号，只用最小相关验证确认改动有效
- 用户明确要求更新并推送 GitHub 后，再统一递增 `APP_BUILD`，并同步 `index.html` 中所有 `?v=`；策略行为实际变化时同时评估并递增 `signalVersion`
- 已经用某个 `?v=` 做过正式浏览器复验、发布验证或线上 smoke 后，继续追加修改同一生产资源时，必须继续递增版本号，不复用刚刚验证过的旧 `?v=`
- 版本号严格递增，方便追溯。
