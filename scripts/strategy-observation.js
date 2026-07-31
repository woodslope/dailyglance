#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STORE_PATH = process.env.DG_STRATEGY_OBSERVATIONS_FILE
    ? path.resolve(process.env.DG_STRATEGY_OBSERVATIONS_FILE)
    : path.join(ROOT, '.local', 'strategy-observations.json');
const STRATEGIES = ['稳健趋势型', '波段抄底型', '突破追涨型', '综合全能型'];
const ISSUE_TYPES = {
    false_buy: '误买或下跌中继',
    early_exit: '过早退出',
    drawdown_defense: '回撤防守过慢',
    duplicate_adjustment: '重复信号或调仓噪音',
    decision_explanation_mismatch: 'B/S、仓位与解释不一致'
};
const FOLLOWUP_HORIZONS = [3, 5];

function parseArgs(argv) {
    const args = new Map();
    const positional = [];
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (!value.startsWith('--')) {
            positional.push(value);
            continue;
        }
        const key = value.slice(2);
        const next = argv[index + 1];
        if (next && !next.startsWith('--')) {
            args.set(key, next);
            index++;
        } else {
            args.set(key, true);
        }
    }
    return { action: positional[0] || 'summary', args };
}

function emptyStore() {
    return { schemaVersion: 1, observations: [] };
}

function readStore() {
    if (!fs.existsSync(STORE_PATH)) return emptyStore();
    const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (store.schemaVersion !== 1 || !Array.isArray(store.observations)) {
        throw new Error('策略观察文件格式不受支持');
    }
    return store;
}

function writeStore(store) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const temporaryPath = `${STORE_PATH}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`);
    fs.renameSync(temporaryPath, STORE_PATH);
}

function required(args, key) {
    const value = String(args.get(key) || '').trim();
    if (!value) throw new Error(`缺少 --${key}`);
    return value;
}

function validateDate(value, key = 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--${key} 必须使用 YYYY-MM-DD`);
    return value;
}

function parsePosition(args) {
    if (!args.has('position')) return null;
    const value = Number(args.get('position'));
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('--position 必须在 0 到 100 之间');
    return value;
}

function makeId(store, date) {
    const prefix = `obs-${date.replaceAll('-', '')}-`;
    const sequence = store.observations
        .map(item => String(item.id || ''))
        .filter(id => id.startsWith(prefix))
        .map(id => Number(id.slice(prefix.length)))
        .filter(Number.isInteger)
        .reduce((max, value) => Math.max(max, value), 0) + 1;
    return `${prefix}${String(sequence).padStart(3, '0')}`;
}

function addObservation(args) {
    const date = validateDate(required(args, 'date'));
    const strategy = required(args, 'strategy');
    if (!STRATEGIES.includes(strategy)) throw new Error(`--strategy 仅支持：${STRATEGIES.join('、')}`);
    const issueType = required(args, 'type');
    if (!ISSUE_TYPES[issueType]) throw new Error(`--type 仅支持：${Object.keys(ISSUE_TYPES).join('、')}`);
    const bsMark = String(args.get('bs') || '').trim().toUpperCase();
    if (bsMark && !['B', 'S', 'NONE'].includes(bsMark)) throw new Error('--bs 仅支持 B、S、none');
    const store = readStore();
    const now = new Date().toISOString();
    const observation = {
        id: makeId(store, date),
        createdAt: now,
        updatedAt: now,
        date,
        symbol: required(args, 'symbol'),
        name: String(args.get('name') || '').trim(),
        strategy,
        issueType,
        issueLabel: ISSUE_TYPES[issueType],
        bsMark: bsMark === 'NONE' ? '' : bsMark,
        position: parsePosition(args),
        actual: required(args, 'actual'),
        expected: required(args, 'expected'),
        signals: String(args.get('signals') || '').split(',').map(value => value.trim()).filter(Boolean),
        note: String(args.get('note') || '').trim(),
        followups: []
    };
    store.observations.push(observation);
    writeStore(store);
    console.log(JSON.stringify({ store: path.relative(ROOT, STORE_PATH), observation }, null, 2));
}

function addFollowup(args) {
    const store = readStore();
    const id = required(args, 'id');
    const observation = store.observations.find(item => item.id === id);
    if (!observation) throw new Error(`不存在观察记录：${id}`);
    const horizon = Number(required(args, 'horizon'));
    if (!FOLLOWUP_HORIZONS.includes(horizon)) throw new Error('--horizon 仅支持 3 或 5');
    if (observation.followups.some(item => item.horizon === horizon)) throw new Error(`${id} 已有 ${horizon} 日后验`);
    const returnPct = Number(required(args, 'return-pct'));
    if (!Number.isFinite(returnPct)) throw new Error('--return-pct 必须是数字，例如 -2.35');
    observation.followups.push({
        horizon,
        date: validateDate(required(args, 'date')),
        returnPct,
        note: String(args.get('note') || '').trim(),
        recordedAt: new Date().toISOString()
    });
    observation.followups.sort((left, right) => left.horizon - right.horizon);
    observation.updatedAt = new Date().toISOString();
    writeStore(store);
    console.log(JSON.stringify({ store: path.relative(ROOT, STORE_PATH), id, followups: observation.followups }, null, 2));
}

function filteredObservations(args) {
    return readStore().observations.filter(item => {
        if (args.get('strategy') && item.strategy !== args.get('strategy')) return false;
        if (args.get('type') && item.issueType !== args.get('type')) return false;
        if (args.get('symbol') && item.symbol !== args.get('symbol')) return false;
        if (args.has('pending-followup') && FOLLOWUP_HORIZONS.every(horizon => item.followups.some(value => value.horizon === horizon))) return false;
        return true;
    });
}

function listObservations(args) {
    const observations = filteredObservations(args);
    console.log(JSON.stringify({ store: path.relative(ROOT, STORE_PATH), count: observations.length, observations }, null, 2));
}

function increment(target, key) {
    target[key] = (target[key] || 0) + 1;
}

function summarizeObservations() {
    const observations = readStore().observations;
    const byStrategy = {};
    const byIssueType = {};
    const groups = new Map();
    const pendingFollowups = [];
    for (const item of observations) {
        increment(byStrategy, item.strategy);
        increment(byIssueType, item.issueType);
        const key = `${item.strategy}::${item.issueType}`;
        const group = groups.get(key) || { strategy: item.strategy, issueType: item.issueType, issueLabel: item.issueLabel, count: 0, symbols: new Set() };
        group.count++;
        group.symbols.add(item.symbol);
        groups.set(key, group);
        const missing = FOLLOWUP_HORIZONS.filter(horizon => !item.followups.some(value => value.horizon === horizon));
        if (missing.length) pendingFollowups.push({ id: item.id, date: item.date, symbol: item.symbol, missingHorizons: missing });
    }
    const recurringIssues = [...groups.values()]
        .map(item => ({ ...item, symbols: [...item.symbols], uniqueSymbols: item.symbols.size }))
        .filter(item => item.count >= 2)
        .sort((left, right) => right.count - left.count || right.uniqueSymbols - left.uniqueSymbols);
    console.log(JSON.stringify({
        store: path.relative(ROOT, STORE_PATH),
        total: observations.length,
        byStrategy,
        byIssueType,
        recurringIssues,
        pendingFollowups
    }, null, 2));
}

function printTemplate() {
    console.log(JSON.stringify({
        issueTypes: ISSUE_TYPES,
        strategies: STRATEGIES,
        addExample: 'node scripts/strategy-iteration.js observe-add --date 2026-07-27 --symbol 600519 --name 贵州茅台 --strategy 综合全能型 --type duplicate_adjustment --bs B --position 30 --actual "实际表现" --expected "期望动作" --signals B15,B1',
        followupExample: 'node scripts/strategy-iteration.js observe-followup --id obs-20260727-001 --horizon 3 --date 2026-07-30 --return-pct -2.35 --note "三日后仍下跌"'
    }, null, 2));
}

function main() {
    const { action, args } = parseArgs(process.argv.slice(2));
    if (action === 'add') return addObservation(args);
    if (action === 'followup') return addFollowup(args);
    if (action === 'list') return listObservations(args);
    if (action === 'summary') return summarizeObservations();
    if (action === 'template') return printTemplate();
    throw new Error(`未知观察动作：${action}`);
}

try {
    main();
} catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
}
