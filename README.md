# DailyGlance

DailyGlance 是一个面向 A 股大盘与自选股观察的网页量化终端，用来集中查看指数环境、个股走势、技术指标和辅助交易结论。

> 仅用于观察、研究和复盘，不构成投资建议。

## 版权与归属

DailyGlance 由 LINPO LAB 维护。

© 2026 LINPO LAB. All rights reserved.

项目页面、说明文档、策略表达和视觉资产默认按保留所有权利处理；第三方库、字体和数据源仍遵循各自原始许可与服务条款。

## 本地运行

这是静态网页应用。在项目根目录启动任意静态 HTTP 服务，例如：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000`。

策略查看器：访问 `http://localhost:8000/strategy-inspector.html`，或在主应用“设置”中打开“独立策略页”。该页面直接读取 `assets/js/01-config-ui.js` 的生产配置，用于查看策略结构，不维护独立副本。

## 文档地图

README 只做项目总览、入口索引和目录/发布边界，不承载策略细则、数据契约或历史记录。

| 文档 | 负责内容 | 先看场景 |
| --- | --- | --- |
| `AGENTS.md` | 协作入口、执行边界、任务路由、最小验证和唯一沉淀路由 | 每个开发任务先读；默认只再读相关源码 |
| `CURRENT_STATUS.md` | 当前状态、风险与下一步 | 接续或发布前才读 |
| `STABILITY_CHECKLIST.md` | 版本同步、完整回归、发布 smoke 与 GitHub 发布验证 | 用户明确要求更新并推送 GitHub 时才读 |
| `docs/product/UI_DESIGN_SYSTEM.md` | 全局 Token、共享组件、板块趋势复合组件与规范同步边界 | 改视觉规范、共享组件、组件状态或新增复合组件时先看 |
| `docs/product/PRODUCT_DECISION_GUIDE.md` | 新手展示层和右侧决策面板话术 | 改结论、解释、文案时先看 |
| `docs/data/DATA_CONTRACT.md` | 历史 K 线 API、实时行情 API、缓存和图表 overlay 的数据契约 | 改实时刷新、缓存、图表最后一根或左侧报价时先看 |
| `docs/strategy/STRATEGY_DECISION_RULES.md` | 当前生产策略、仓位、信号、风险门禁和 `B/S` 契约 | 改策略行为时才读 |
| `docs/strategy/STRATEGY_VALIDATION_GUIDE.md` | 策略验证边界、样本/报告最低要求与命令入口 | 真实改变信号、仓位、首次 `B/S`、交易频率或收益主张时才读 |

历史证据的位置与读取边界见 `AGENTS.md` 的“唯一沉淀路由表”。

## 本地工作区与 GitHub Pages

当前项目按“双层边界”维护：

- 本地工作区是完整项目资产，保留生产代码、正式文档、测试、验证脚本、策略样本元数据和接续记录。
- GitHub 的用途只是通过 GitHub Pages 展示和访问这个网页应用。
- GitHub 只保存必要部署文件，不作为完整源码仓库、协作仓库或备份仓库。
- GitHub Pages 采用 `main / root` 直接分支部署；部署包只需要 `index.html`、`assets/` 和 `.gitignore`。
- 本地完整项目在无远端跟踪的 `codex/full-project` 分支维护；`main` 只作为与 `origin/main` 同步的部署分支。
- `.local/`、`.workbuddy/`、缓存、报告和临时备份不进入部署包。

如果以后要把 GitHub 改成标准源码仓库，必须重新评估 `docs/`、`scripts/`、`tests/`、样本夹具和私有/临时数据边界。

## 目录与发布边界

| 路径 | 本地完整项目 | GitHub Pages 部署包 | 说明 |
| --- | --- | --- | --- |
| `index.html` | 保留 | 上传 | 应用入口 |
| `strategy-inspector.html` | 保留 | 上传 | 独立只读策略查看器入口 |
| `assets/` | 保留 | 上传 | 样式、脚本、图标和 vendor 资源 |
| `.github/workflows/` | 按需保留 | 不上传部署包 | 当前不使用自定义 Pages Actions，避免与分支直连重复部署 |
| `.gitignore` | 保留 | 上传 | 忽略本地临时目录和系统文件 |
| `scripts/` | 保留 | 不上传部署包 | 本地离线验证、线上 smoke 和策略辅助脚本；策略研究入口见验证指南 |
| `tests/` | 保留 | 不上传部署包 | 本地回归测试与基线快照 |
| `strategy-validation-universe.json` | 保留 | 不上传部署包 | 本地策略样本池元数据 |
| 根目录说明文档 | 保留 | 可不上传部署包 | 项目入口、协作、状态与阶段检查 |
| `docs/product/`、`docs/strategy/`、`docs/data/` | 保留 | 可不上传部署包 | 当前领域规则 |
| `docs/history/` | 保留 | 可不上传部署包 | 仅作发布和研究证据追溯 |
| `.local/`、`.workbuddy/` | 临时使用 | 不上传 | 缓存、报告、日志、草稿和临时协作记忆，用完删除 |

文档和产物的唯一沉淀位置见 `AGENTS.md` 的“唯一沉淀路由表”。

## 部署

线上地址：

```text
https://woodslope.github.io/dailyglance/
```

GitHub Pages 部署包：

```text
index.html
assets/
.gitignore
```

仓库 Pages 设置固定为 `Deploy from a branch → main / (root)`，当前不维护自定义 Pages Actions；具体发布流程见 `STABILITY_CHECKLIST.md`。

本地文档、测试、验证脚本和策略样本元数据不默认上传到 Pages 仓库。发布触发条件和完整执行流程统一见 `STABILITY_CHECKLIST.md`。

因为 GitHub 不保存完整项目，本地工作区需要单独备份；GitHub Pages 只能恢复线上页面，不能恢复测试、策略文档和接续记录。长期备份放在项目目录之外，至少包含根目录协作入口、`docs/`、`tests/`、`scripts/` 和策略样本元数据，不包含 `.local/`、截图、缓存和临时报告。

## 风险声明

所有结论、信号、仓位建议和回测结果仅用于研究、观察和复盘。工具输出不能替代独立判断，也不构成买卖建议。
