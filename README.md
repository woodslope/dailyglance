# DailyGlance

DailyGlance 是一个面向 A 股大盘与自选股观察的网页量化终端，用来集中查看指数环境、个股走势、技术指标和辅助交易结论。

> 仅用于观察、研究和复盘，不构成投资建议。

## 版权与归属

DailyGlance 由 LINPO LAB 维护。

© 2026 LINPO LAB. All rights reserved.

项目页面、说明文档、策略表达和视觉资产默认按保留所有权利处理；第三方库、字体和数据源仍遵循各自原始许可与服务条款。

## 功能

- 大盘：上证指数、深证成指、沪深300、中证500、中证1000、创业板指、科创50、北证50
- 自选：搜索股票并加入本地自选
- 图表：K 线、成交量、MACD、KDJ
- 周期：日线 / 周线
- 区间：90 天 / 180 天 / 360 天
- 均线：MA5、MA10、MA20、MA30、MA60、MA120、MA250
- 策略：稳健趋势、波段抄底、突破追涨、综合全能
- 输出：交易结论、建议仓位、防守位、压力区、三条关键依据
- 工具：手动更新、回测、清缓存、设置、帮助、性能诊断

## 页面结构

- 左侧：大盘列表 / 自选股列表
- 中间：主图和指标图
- 右侧：价格、结论、依据、风险提示

## 文档地图

README 只做项目总览、入口索引和目录/发布边界，不承载策略细则、数据契约或历史记录。

| 文档 | 负责内容 | 先看场景 |
| --- | --- | --- |
| `AGENTS.md` | 当前工程协作总入口和约束 | 开发迭代期先看最小入口，按风险补读其他文档 |
| `CURRENT_STATUS.md` | 当前版本、线上状态、未完成下一步和轻量接续摘要 | 新对话接续、发布前后、想快速知道下一步时先看 |
| `STABILITY_CHECKLIST.md` | 生产代码影响面分析、版本号规则与阶段 smoke 清单 | 改生产代码、版本号、发布或 smoke 前先看 |
| `AI_WORKFLOW_NOTES.md` | AI 协作节奏、问答/执行边界、人工确认和收口方式 | 开发迭代、接手、交接或收口时先看 |
| `docs/product/PRODUCT_DECISION_GUIDE.md` | 新手展示层和右侧决策面板话术 | 改结论、解释、文案时先看 |
| `docs/data/DATA_CONTRACT.md` | 历史 K 线 API、实时行情 API、缓存和图表 overlay 的数据契约 | 改实时刷新、缓存、图表最后一根或左侧报价时先看 |
| `docs/strategy/STRATEGY_DECISION_RULES.md` | 策略信号、仓位和主图 `B/S` 规则 | 改策略行为时先看 |
| `docs/strategy/STRATEGY_VALIDATION_GUIDE.md` | 策略验证、生产快照基线、样本池、候选信号打磨流程和本地报告规则 | 评估新信号、验证策略漂移或复用方法时先看 |

历史发布、验证证据和旧实验记录放在 `docs/history/`，只有追溯证据、阶段测试或发布收口时再读。

## 本地工作区与 GitHub Pages

当前项目按“双层边界”维护：

- 本地工作区是完整项目资产，保留生产代码、正式文档、测试、验证脚本、策略样本元数据和接续记录。
- GitHub 的用途只是通过 GitHub Pages 展示和访问这个网页应用。
- GitHub 只保存必要部署文件，不作为完整源码仓库、协作仓库或备份仓库。
- GitHub Pages 部署包只需要 `index.html`、`assets/`、`.github/workflows/pages.yml`、`.gitignore`。
- `.local/`、`.workbuddy/`、缓存、报告和临时备份不进入部署包。

如果以后要把 GitHub 改成标准源码仓库，必须重新评估 `docs/`、`scripts/`、`tests/`、样本夹具和私有/临时数据边界。

## 目录与发布边界

| 路径 | 本地完整项目 | GitHub Pages 部署包 | 说明 |
| --- | --- | --- | --- |
| `index.html` | 保留 | 上传 | 应用入口 |
| `assets/` | 保留 | 上传 | 样式、脚本、图标和 vendor 资源 |
| `.github/workflows/pages.yml` | 保留 | 上传 | GitHub Pages 自动部署配置 |
| `.gitignore` | 保留 | 上传 | 忽略本地临时目录和系统文件 |
| `scripts/` | 保留 | 不上传部署包 | 本地离线验证、线上 smoke 和策略辅助脚本 |
| `tests/` | 保留 | 不上传部署包 | 本地回归测试与基线快照 |
| `strategy-validation-universe.json` | 保留 | 不上传部署包 | 本地策略样本池元数据 |
| `README.md`、`AGENTS.md`、`CURRENT_STATUS.md`、`AI_WORKFLOW_NOTES.md`、`STABILITY_CHECKLIST.md` | 保留 | 可不上传部署包 | 项目总览、AI 协作入口、当前状态和阶段验证规则 |
| `docs/product/`、`docs/strategy/`、`docs/data/`、`docs/history/` | 保留 | 可不上传部署包 | 产品、策略、数据契约和历史稳定记录 |
| `.local/`、`.workbuddy/` | 临时使用 | 不上传 | 缓存、报告、日志、草稿和临时协作记忆，用完删除 |

本地轻应用根目录只保留运行入口、当前状态和协作入口。产品、数据、策略细则和历史稳定记录放入 `docs/`；临时缓存、报告、备份、协作记忆、旧历史记录和旧评审用完即删。

需要长期保留的结论写入 `CURRENT_STATUS.md`、`docs/history/STABLE_VERSION_*.md` 或对应 `docs/` 文档。不通过“移动到隐藏目录”假装清理。

## 主要文件

- `index.html`：入口
- `assets/css/dailyglance.css`：样式
- `assets/js/01-config-ui.js`：全局配置、UI 工具
- `assets/js/02-data.js`：数据、缓存、同步
- `assets/js/03-calculations.js`：指标、信号、仓位推导
- `assets/js/04-render.js`：图表和右侧渲染
- `assets/js/05-app.js`：初始化、交互、生命周期
- `tests/regression.js`：策略、数据契约和 UI 状态回归
- `strategy-validation-policy.json`：策略持续迭代的时间窗口、成本场景和准入阈值
- `scripts/strategy-iteration.js`：刷新研究缓存、生成基线、评估候选、查看结论和维护影子观察的统一入口
- `scripts/strategy-observation.js`：本地记录真实误买、过早退出、回撤防守、重复调仓和解释不一致案例，并补 3/5 日后验
- `scripts/strategy-evaluator.js`：正式基线与候选实验共用的资金曲线、盈亏结构、时间窗口和准入评估器
- `scripts/status-smoke.js`：桌面端状态 smoke，验证资源版本、四个图表、右侧结论和 `data-dg-*` 状态属性
- `scripts/live-dataflow-smoke.js`：线上实时数据流 smoke，验证确认历史、实时 overlay、左侧标签页、三栏一致性和拖拽性能

## 部署

线上地址：

```text
https://woodslope.github.io/dailyglance/
```

GitHub Pages 部署包：

```text
index.html
assets/
.github/workflows/pages.yml
.gitignore
```

本地文档、测试、验证脚本和策略样本元数据不默认上传到 Pages 仓库；发布前仍在本地使用它们完成验证。

阶段测试与发布时注意：

- 改了 CSS 或 JS 后，按 `STABILITY_CHECKLIST.md` 判断何时同步更新 `APP_BUILD` 和 `index.html` 里的 `?v=...`
- 当前采用普通 `<script>` 顺序加载，5 个脚本顺序不要改
- 只有用户明确进入“可以阶段测试”或“准备发布”后，才按 `STABILITY_CHECKLIST.md` 在本地跑 `tests/regression.js`、相关过滤测试和必要 smoke；开发迭代期不提前运行浏览器 smoke。
- `tests/strategy-baseline-snapshots.json` 的固定样本规则见 `docs/strategy/STRATEGY_VALIDATION_GUIDE.md`；缺失 `.local/strategy-cache/` 临时夹具时，应先临时重建或有意识地更新快照来源。
- 发布到 GitHub Pages 后，按最小线上验证跑：

```bash
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/status-smoke.js --url=https://woodslope.github.io/dailyglance --external-server
/Users/wulinpo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/live-dataflow-smoke.js --url=https://woodslope.github.io/dailyglance
```

smoke 触发节奏和版本号规则以 `STABILITY_CHECKLIST.md` 为准；不要把 PR、tag、CI 或监控平台作为当前轻应用的默认发布门槛。

因为 GitHub 不保存完整项目，本地工作区需要单独备份；GitHub Pages 只能恢复线上页面，不能恢复测试、策略文档和接续记录。长期备份放在项目目录之外，至少包含根目录协作入口、`docs/`、`tests/`、`scripts/` 和策略样本元数据，不包含 `.local/`、截图、缓存和临时报告。

## 风险声明

所有结论、信号、仓位建议和回测结果仅用于研究、观察和复盘。工具输出不能替代独立判断，也不构成买卖建议。
