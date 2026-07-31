# DailyGlance 稳定版本记录（2026-07-26 第二轮）

## 版本与发布

- `APP_BUILD=2026-07-26-03`
- `SIGNAL_VERSION=v4.2.10`
- 资源参数：`?v=20260726-03`
- Git 提交：`64e5e9b5274da808a63ac3296eb0ee72277ea477`
- GitHub Actions：`Deploy DailyGlance` run `30200508433`、`pages build and deployment` run `30200508113`，均为 `completed / success`
- GitHub Pages deployment：`5609815282`，状态 `success`

## 本轮生产行为

- 自选股上限由 10 只调整为 15 只，左侧标题显示当前数量和 `15` 只上限。
- 侧边栏历史同步并发仍为 `3`，没有因自选股数量增加而提高单页并发。
- 同源多页面通过本地租约选出唯一行情刷新页面；焦点切换时转移刷新权，其他页面只读取 IndexedDB 和本地实时 overlay 缓存。
- 多页面的自选股增删通过同源 storage 通知同步，避免旧页面继续持有过期列表。
- 四套策略、仓位、`B/S`、数据准入规则和 `SIGNAL_VERSION` 不变。

## 验证证据

- JavaScript 语法、15 只上限、租约接管、非主页面只读缓存、自选列表跨页同步和版本号定向回归均通过。
- 完整 `tests/regression.js` 在补齐本记录和当前状态指针后通过。
- 本地 `status-smoke` 通过，四块 canvas 正常、右侧包含每日结论，资源版本均为 `20260726-03`。
- 本地 `live-dataflow-smoke` 通过，确认历史、三栏状态、拖拽历史和恢复最新路径正常。
- 真实双页面 Playwright 验证确认：新焦点页面独占刷新租约，原页面被拦截；焦点切回后租约正确转移；自选列表可跨页面同步为 `1/15`。
- 用户已完成浏览器人工验收并确认通过。

## 线上证据与风险

- 远端 `main`、两条 GitHub Actions 和最新 Pages deployment 均已确认为本轮提交；远端 `index.html` 已引用 `20260726-03`。
- 终端 Playwright 的 `status-smoke`、`live-dataflow-smoke` 与独立应用内浏览器访问线上地址均收到 `ERR_CONNECTION_RESET`，未取得新的线上 DOM / canvas 证据。该现象与上一版本记录一致，而 GitHub 部署证据完整；网络恢复后按 README 重跑两条线上 smoke。
- 多页面保护依赖同源 `localStorage`；不同域名、协议或端口不共享租约。浏览器完全禁用 storage 时会回退为原有单页请求行为。
- 东方财富历史接口偶发空响应仍由腾讯历史回退恢复，属于既有外部数据源风险。
