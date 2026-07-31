# DailyGlance 稳定版本记录（2026-07-26）

## 版本与发布

- `APP_BUILD=2026-07-26-02`
- `SIGNAL_VERSION=v4.2.10`
- 资源参数：`?v=20260726-02`
- Git 提交：`e9b738447bae16926e1bb40c286571e9cfd36da5`
- GitHub Actions：`Deploy DailyGlance` run `30188143785`、`pages build and deployment` run `30188143443`，均为 `completed / success`
- GitHub Pages deployment：`5607347907`，状态 `success`

## 本轮生产行为

- 窄屏门禁真实可见时，在全局加载、IndexedDB、业务请求、定时器和桌面监听器之前停止主应用初始化。
- 窗口从门禁宽度恢复到支持的桌面宽度时，只触发一次页面刷新，从干净生命周期启动终端。
- 桌面初始化、数据链、四块图表、策略、仓位、`B/S` 与 `SIGNAL_VERSION` 不变。

## 验证证据

- JavaScript 语法、移动门禁与版本号定向回归、完整 `tests/regression.js` 均通过。
- 本地 `status-smoke` 通过，四块 canvas 均绑定 `sh_daily`，右侧包含每日结论并使用 `20260726-02` 资源。
- 本地 `live-dataflow-smoke` 通过，拖拽进入历史后徽章、右侧日期与“最新”状态一致，恢复最新后回到 `2026-07-24`。
- 390×844 真实浏览器首帧直接显示门禁，加载层未激活、业务请求为 0、控制台错误为 0、页面无横向溢出。
- 同一页面从 390×844 扩至 1440×900 后只发生一次重载，四块图表、右侧每日结论和收盘确认状态恢复，应用自身控制台无错误。

## 线上证据与风险

- 两条 GitHub Actions 和最新 Pages deployment 已确认成功，远端 `main` 的 `index.html` 已引用 `20260726-02`。
- 当前终端访问 `https://woodslope.github.io/dailyglance/` 连续收到 `ERR_CONNECTION_RESET`，未取得本轮新的线上 DOM / canvas smoke；网络恢复后按 README 重跑 `status-smoke` 与 `live-dataflow-smoke`。
- 东方财富历史接口偶发空响应仍由腾讯历史回退恢复，属于既有外部数据源风险。
