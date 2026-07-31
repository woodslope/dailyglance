# DailyGlance 数据契约

本文固定 DailyGlance 的行情数据边界，尤其是历史 K 线 API 与实时行情 API 的职责分工。后续优化实时刷新、缓存、图表最后一根、左侧报价或数据准确性时，先读本文。

## 术语说明

- `confirmedData` / 确认历史：历史 K 线 API 返回，并通过归一化、日期和 OHLC 校验后的 K 线。它可以写入 IndexedDB，是图表、指标、策略和正式结论的基础。
- `liveQuote` / 实时报价：实时行情 API 返回的临时报价。它可以让左侧列表显示最新可用价格，但默认不等于一根可用于策略计算的 K 线。
- `gate` / 准入检查：判断 `liveQuote` 能否进入图表和策略的一组规则，包括行情时间、历史新鲜度、确认日期和价格体系校验。没通过 `gate` 的实时数据只能作为左侧报价。本文中的 `gate` 指行情数据准入检查；页面代码里的 `mobileGate` 是移动端提示层，不属于行情数据规则。
- `liveBar` / 盘中临时 K 线：通过 `gate` 的 `liveQuote`。它可以叠到图表最后一根，并让右侧价格、指标、策略和临时结论跟着当前盘中数据更新。
- `cachedLiveBar` / 缓存盘中 K 线：本地保存的同交易日 last-good `liveBar`。实时接口短暂不可用时，可用于恢复盘中连续性；收盘后只能作为待确认临时展示。
- `displayData` / 当前展示数据：右侧图表和结论实际使用的数据，一般是 `confirmedData + liveBar`。
- `cacheData` / 历史缓存数据：只允许保存 `confirmedData`，不能把实时数据写成历史 K 线。
- `quote-only` / 仅左侧报价：实时价未通过 `gate`，只更新左侧列表价格，不进入图表、指标、策略、B/S 或右侧正式结论。
- `live-overlay` / 盘中临时 K 线：实时价通过 `gate` 后进入图表最后一根，右侧按盘中临时口径展示。
- `cached-live-overlay` / 缓存盘中 K 线：沿用本地同日缓存的 `liveBar`，用于接口短暂不可用时维持右侧盘中视图。
- `post-close-pending` / 盘后待确认：收盘后沿用当天最后一份临时 K 线，但停止滚动更新实时结论，等待历史 K 线 API 返回确认数据。
- `refresh transaction` / 刷新事务：一次前端刷新应用过程，从准备应用数据开始，到对应区域 DOM 和状态写入完成后结束。
- `refresh snapshot` / 刷新快照版本：刷新事务提交后的记录，包含 `id`、`version`、`appliedAt` 和作用域。界面上的“刷新于”读取的是快照提交时间，不等同于交易所原始行情时间。

## 界面对应关系

- 左侧列表显示最新可用报价，优先服务快速扫视；它可以比图表和策略更早拿到实时价格。
- 右侧面板解释当前图表、指标、策略和结论的数据口径；数据状态提示统一放在右侧顶部刷新条，不放在左侧列表或结论卡片标题里制造重复标签，结论卡片标题不重复显示数据状态标签。
- 左侧价格可能比右侧图表/策略更早更新。只有实时数据通过 `gate` 后，右侧图表、指标、策略、B/S 和临时结论才会同步进入盘中口径。
- 如果实时价是 `quote-only`，用户能在左侧看到最新报价，但右侧仍按最后确认历史 K 线给出结论。
- 左侧“列表刷新于”来自 `leftList` 刷新快照，只表示左侧列表价格或列表数据已经应用到界面。
- 右侧“图表及右侧刷新于”来自 `rightPanel` 刷新快照，只表示图表、右侧价格、策略结论或状态已经应用到右侧界面。
- 刷新时间必须在对应区域数据实际应用后提交；状态徽章或提示文字单独渲染时不得推进刷新时间。
- 用户进入应用默认先到大盘页：左侧指数列表会先渲染出来；当缓存或历史数据应用到列表后，先提交 `leftList` 快照；图表、右侧价格和结论完成应用后，再提交 `rightPanel` 快照。后台启动补数会在默认大盘选择完成后重渲染左侧列表，开盘时再触发侧边栏批量实时刷新。
- 左侧固定观察 8 个指数：上证指数、深证成指、沪深300、中证500、中证1000、创业板指、科创50、北证50。八项共用历史/实时数据契约；只有沪深300、中证500、中证1000的数据变化会使当前标的的核心建仓门禁决策失效，其他五项仅刷新观察展示。

## 核心原则

历史 K 线 API 是确认数据源，实时行情 API 是临时报价源。

```text
confirmedData = 历史 K 线 API 返回并归一化/校验通过的数据，允许写 IndexedDB
liveQuote     = 实时行情 API 返回的临时报价，只用于报价和临时显示
liveBar       = 通过合并 gate 的 liveQuote，允许叠到图表最后一根
cachedLiveBar = 通过本地缓存恢复的同交易日 last-good 临时 liveBar，只能恢复盘中连续性或盘后待确认展示
displayData   = confirmedData + liveBar
cacheData     = confirmedData only
```

实时数据不能修复历史缺口。只要历史 K 线没有补齐到可接受的确认日期，实时行情只能作为 quote 显示在左侧列表，不能追加到图表序列，也不能参与指标、策略、B/S 和右侧正式结论。

交易时段、开盘前和午间，历史 API 即使返回当天行，也不能把当天行写入 `confirmedData` 或 IndexedDB。当天行只能通过实时 quote gate 进入 `liveBar`；收盘后才允许历史 API 返回的当天 K 线成为确认历史。

## API 职责

### 外部环境与隔夜主题映射快照

- 外部环境是独立只读数据层，包含五项外部行情（标普500、纳斯达克、恒生科技、A50期指、美元兑离岸人民币）以及八项隔夜主题证据（SOXX、SMH、QQQ、MSFT、NVDA、AMD、TSLA、LI）；两类数据都不进入 `INDEX_CONFIG`、`state.rawData`、`state.liveQuotes`、`state.confirmedStatus`、指标、策略、仓位、`B/S` 或大盘建仓门禁。
- 隔夜主题主源使用东方财富批量行情，一次请求获取八项外盘 ETF/个股；主题按透明固定映射归纳为“半导体与算力”“AI 与云计算”“智能电动车”，并展示 A 股可观察概念与代表标的。代表标的只作观察清单，不自动选股、不跳转、不写入自选。
- 主题状态只有“隔夜偏强 / 隔夜偏弱 / 隔夜分化 / 信息不完整”：至少两项成分同向且主题均值跨越 `±1%` 才显示偏强或偏弱，否则显示分化或信息不完整。所有主题卡必须标记“待 A 股开盘确认”，不得写成必涨、买入或卖出结论。
- 同页进行中请求必须复用，成功或失败请求都受至少 60 秒冷却；外部环境页未激活、页面不可见或当前页没有焦点行情租约时不得发起请求。请求超时固定为 5 秒。
- 五项外部行情只写入独立 `localStorage` 键 `dg_external_market_snapshot_v1`；隔夜主题证据和映射只写入 `dg_external_lead_snapshot_v1`。缓存项必须明确标记，不得被解释为实时或确认历史，也不得影响现有历史 API 熔断、实时 overlay 与刷新快照。
- 页面可以把五项行情归纳为“偏暖、分化、偏压制”等背景线索，但外盘主题只能作为 A 股开盘前的观察线索；不生成统一交易评分，不声称外盘单一变量或短时上涨确定导致 A 股涨跌。

### 历史 K 线 API

- 主源：TickFlow 匿名免费历史 REST API。浏览器直接跨域请求，不在前端保存 API Key；股票、ETF 与八项指数统一请求最近 1000 根日线。
- 复权口径：TickFlow 固定使用 `adjust=forward_additive`（差值前复权），与原东方财富 `fqt=1` 和现有腾讯前复权缓存保持同一价格体系；不得改用 TickFlow 默认的比例前复权。
- 备源：非北证50按腾讯、东方财富顺序回退；北证50按新浪、东方财富、腾讯顺序回退。东方财富历史路由只作为末级恢复来源，不再阻塞正常启动。
- 产出：`state.rawData[id]`、`state.weeklyData[id]`、IndexedDB 缓存。
- 语义：已确认或历史 API 返回的 K 线数据。
- 入库前必须经过 `normalizeConfirmedHistoryData()`：字段数值化、OHLC 合法性、成交量/成交额非负、日期排序去重、剔除确认截止日之后的行。
- TickFlow 时间戳必须按北京时间转换为 `YYYY-MM-DD`；成交量沿用接口的“手”口径，成交额固定使用“元”。腾讯历史 K 线未返回成交额时记为未知，界面显示 `--`；禁止用指数点位乘成交量估算指数成交额。
- 新浪北证50历史使用 `bj899050`，原始成交量单位为“股”，入库前除以 `100` 转为“手”；该接口不提供成交额，`amt` 记为 `0` 并在界面显示 `--`。
- TickFlow 免费服务存在较严格频率限制，前端继续复用 IndexedDB、同页刷新冷却和最多 3 路受控并发；不得为刷新全市场逐只高频循环请求。
- 失败处理：保留旧缓存，标记确认状态为失败或陈旧；不能用实时 API 补写历史。
- 全局熔断：同一历史来源连续 2 次发生超时或脚本加载失败后，暂停请求该来源 5 分钟，并直接尝试下一历史来源或本地缓存；任意一次正常响应会关闭该来源熔断，用户手动更新会重置熔断并主动重试。
- 熔断只统计传输失败。接口可达但单个标的数据不足属于覆盖能力问题，例如腾讯历史接口只为北证50返回 1 根日线时，不得误判为腾讯历史源整体故障。

### 实时行情 API

- 来源：腾讯实时 quote。
- 产出：`state.liveQuotes[id]`；通过 gate 后才写入 `state.liveBars[id]`。
- 语义：盘中或延迟临时报价，不等于收盘确认 K 线。
- 日期口径：优先解析实时 API 返回的 14 位行情时间（如 `YYYYMMDDHHMMSS`），写入 `date`、`quoteTime` 和 `quoteDateSource='api'`；只有字段缺失或非法时才回退本地北京时间日期，并标记 `quoteDateSource='local-fallback'`。
- 缓存规则：永远不写入 IndexedDB 历史 K 线缓存。
- 腾讯实时行情的成交额原始字段为“万元”，进入 `liveQuote` 前必须乘以 `10000` 转为“元”，与历史数据和右侧格式化口径保持一致。
- 同交易日 last-good 恢复：当实时 API 暂时没有返回时，可恢复当天最后一份通过 gate 的 `cached-live-overlay`，让盘中看盘不中断；超过短 TTL 后不清空，刷新条仍显示“缓存盘中”，hover 说明沿用最近盘中数据。收盘后不再滚动生成新的实时结论，冻结当天最后一份缓存 liveBar，显示 `post-close-pending` / “盘后待确认”，直到历史 K 线确认后替换。
- 左侧列表：可以显示实时价，涨跌幅优先使用实时 API 的 `prevClose`。

## 状态对象

当前生产状态分层：

```js
state.rawData[id]          // 历史 API 确认数据
state.weeklyData[id]       // 由 rawData 转换的确认周线
state.liveQuotes[id]       // 实时 quote，可能只用于列表
state.liveBars[id]         // 通过 gate 的图表 live overlay
state.liveWeeklyData[id]   // live overlay 下的临时周线视图
state.liveOverlayCache[id] // 短 TTL 本地临时 overlay 缓存，只存实时输入
state.confirmedStatus[id]  // 历史数据来源、状态、确认日期
state.displayStatus[id]    // 当前显示是 confirmed / live-overlay / cached-live-overlay / post-close-pending / quote-only 等
```

读取入口：

- 图表和右侧面板：`getActiveData()`，只合并通过 gate 的 `liveBars`。
- 左侧报价：`getVisibleQuoteData()`，可读取 `liveQuotes`。
- 左侧涨跌基准：`getVisibleQuoteChangeBase()`，优先用实时 `prevClose`。
- 右侧数据口径提示：只有 `live-overlay` / `cached-live-overlay` / `post-close-pending` 或 `_isLive` 最后一根参与 `getActiveData()` 时，顶部刷新条标记为临时口径；`post-close-pending` 必须显示“盘后待确认”，表示收盘后已停止滚动更新实时结论，正在等待历史 K 线确认。`quote-only` 只影响左侧报价，右侧仍按最后确认 K 线结论展示。

## 实时合并 gate

实时行情只有满足以下条件，才能从 `liveQuote` 升级为 `liveBar`，进入图表 overlay：

1. 实时价格有效。
2. 实时日期是今天；实时日期优先来自 API 行情时间，不用本地日期硬推。
3. 实时日期不早于确认历史最后日期。
4. 确认历史已经新到可接受日期。
   - 工作日收盘后：确认历史至少到今天。
   - 工作日收盘前、周末或当前只靠周末推断时：确认历史至少到上一交易日。
5. 指数允许同价系合并；股票若跨日追加，必须用实时 `prevClose` 与确认历史最后收盘价校验价格体系。
6. 股票价格体系偏差超过 `EX_RIGHT_TOLERANCE` 时，拒绝图表 overlay，等待历史 API 返回复权后的 K 线。

拒绝 overlay 时：

- `state.liveQuotes[id]` 仍可保存 quote。
- `state.liveBars[id]` 必须清理或保持不存在。
- 左侧报价可以更新。
- 图表、指标、策略、B/S 和右侧结论保持基于历史确认数据。

## 久未登录启动规则

几天没打开应用时，正确顺序是：

1. 先读 IndexedDB 缓存，快速恢复首屏。
2. 后台优先同步历史 K 线 API，补齐中间缺失交易日。
3. 历史确认足够新后，再允许实时 API 叠加图表最后一根。
4. 如果历史 API 失败，实时 API 只能更新左侧 quote，图表仍停在最后确认日期。
5. 收盘后不能把实时 quote 写成历史 K 线，必须等历史 API 返回确认数据。

## 准确性风险

以下情况会导致图表或数据被拒绝实时 overlay，或需要 UI 标注：

- 历史 API 失败或返回空。
- 历史缓存落后多个交易日。
- 历史 API 尚未返回今天 K 线。
- 实时 API 没有可信 `prevClose`。
- 实时 API 没有可信行情时间时，会退回本地北京时间日期；这种情况下左侧 quote 可继续显示，但图表 overlay 仍要通过历史新鲜度、日期和价格体系 gate。
- 股票除权除息或前复权价格体系与实时 quote 不一致。
- 交易日历只内置当前维护年份；未来年份休市安排发布后需要更新年度休市表，否则会回退到周末规则。
- 周线 live overlay 是由日线临时聚合，收盘前会变化。

## 指标口径

- MACD 采用 `DIF = EMA12 - EMA26`，`DEA = EMA(DIF, 9)`。
- MACD 柱显示口径固定为 A 股常见口径：`MACD = 2 * (DIF - DEA)`。
- KDJ 采用 9 日 RSV，初始 `K=50`、`D=50`，平滑公式为 `K = 2/3 * prevK + 1/3 * RSV`、`D = 2/3 * prevD + 1/3 * K`、`J = 3K - 2D`。
- 指标只能基于 `getActiveData()` 计算；被拒绝的 `quote-only` 实时数据不得进入 MACD、KDJ、策略、B/S 或右侧正式结论。

## 维护提醒

年度交易日历需要持续维护。当前已接入 2026 A 股休市表，来源为上交所 2026 年部分节假日休市安排通知（https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml）。未来年份休市安排发布后，应更新年度休市表并补回归。

## 回归要求

修改数据合并或刷新路径时，至少覆盖：

- 同日实时 overlay 不写入 IndexedDB。
- 交易时段历史 API 返回当天行时，当天行不得进入 `rawData` 或 IndexedDB，只能通过实时 overlay 显示。
- 历史缺口时拒绝图表 overlay，但左侧 quote 可显示。
- 左侧 quote 涨跌幅使用实时 `prevClose`。
- MACD 柱口径固定为 `2 * (DIF - DEA)`。
- 后台 `cachedFetch()` 命中活动内存数据时仍能应用合法 live overlay。
- 手动更新与自动刷新共用同一合并 gate。
- 官方节假日休市期间，`getExpectedConfirmedDate()` 应回退到上一交易日；官方恢复开市日不得被误判为休市。
- 本地日期是今天但实时 API 行情时间不是今天时，应拒绝图表 overlay，同时保留左侧 quote。
- 顶部刷新条必须标明 live overlay 下的盘中临时口径；quote-only 状态不得误标为盘中临时。
- 刷新条状态徽章的 `data-dg-display-mode`、`data-dg-confirmed-status`、`data-dg-confirmed-date`、`data-dg-item-date`、`data-dg-item-live` 必须与可见标签一致；缓存首屏恢复确认历史时也必须补齐 confirmed 状态，不能显示 `unknown`。
- cached-live overlay 只应恢复实时输入，不得写回 `confirmedData`、IndexedDB 或永久结论缓存；同交易日过短 TTL 后不得清空，应保留 last-good 临时视图，刷新条继续显示“缓存盘中”并通过 hover 说明沿用最近盘中数据；收盘后应显示 `post-close-pending` / “盘后待确认”；只有历史 API 返回当天确认 K 线并通过校验后，才替换为 confirmed 视图。
