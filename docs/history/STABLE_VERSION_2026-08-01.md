# DailyGlance 稳定版本记录 2026-08-01

## 发布结论

- 已发布 `APP_BUILD=2026-07-31-03`、资源版本 `20260731-03`、`SIGNAL_VERSION=v4.2.12`。
- GitHub Pages 部署提交为 `90862c659532c008691b069107fcd437b9cb180e`。
- 远端 `main` 仅保留 `index.html`、`assets/`、`.github/workflows/pages.yml` 和 `.gitignore`；完整项目保留在本地 `codex/full-project` 分支。

## 本轮改动

- 上线「隔夜外盘主题映射」，展示半导体与算力、AI 与云计算、智能电动车的外盘证据、A 股概念和代表标的。
- 恢复 `monotonicSignalLifecycle` 策略边界、同日 `L10 + L3` 高危清仓语义和原有仓位回差规则。
- 修复 JSONP 取消后注册表清理和 Promise 结束，防止长时运行泄漏。
- 修复 `scripts/check.js` 对真实回归失败的误判，并校正 `live-dataflow-smoke` 对无 CSS 位移拖拽实现的旧断言。

## 验证证据

- `scripts/check.js`：43 个 JavaScript 文件语法检查通过，212 项全量回归通过，0 警告、0 失败。
- 本地完整项目和独立部署包的 `status-smoke` 与 `live-dataflow-smoke` 均通过。
- 1440×900 桌面端主界面、外部环境页和 390×844 移动端门禁已做截图复核；无空图、明显遮挡或横向溢出。
- 外部环境本地真实请求成功生成 3 组背景判断、3 组隔夜主题和 5 项行情快照。
- GitHub Actions `30699410088` 和 Pages `30699409823` 成功；线上两套 smoke 均通过并确认加载 `20260731-03`。

## 不变行为与剩余风险

- 隔夜外盘主题只作展示观察，不参与策略、仓位、建仓门禁或 `B/S` 计算；策略基线无漂移。
- TickFlow、腾讯、东方财富和新浪为无 SLA 的公开接口，仍需观察可用性和频率限制。
- 当前终端访问 GitHub Pages 会偶发 `ERR_CONNECTION_RESET`；重试后线上验证成功，暂无证据表明这是应用回归。
