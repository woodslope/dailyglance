#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
    updateQualityShadow,
    listQualityShadowStates
} = require('./strategy-wave-b-quality-shadow');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.local', 'strategy-reports');
const SHADOW_DIR = path.join(ROOT, '.local', 'strategy-shadow');
const CACHE_DIR = path.join(ROOT, '.local', 'strategy-cache');
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-policy.json'), 'utf8'));
const UNIVERSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'strategy-validation-universe.json'), 'utf8'));

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
    return { command: positional[0] || 'status', args };
}

function runNode(script, args = [], options = {}) {
    const output = execFileSync(process.execPath, [script, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'inherit']
    });
    if (output) process.stdout.write(output);
    return output;
}

function latestReport(pattern) {
    if (!fs.existsSync(REPORT_DIR)) return null;
    return fs.readdirSync(REPORT_DIR)
        .filter(file => pattern.test(file))
        .map(file => ({ file, modifiedAt: fs.statSync(path.join(REPORT_DIR, file)).mtimeMs }))
        .sort((left, right) => right.modifiedAt - left.modifiedAt)[0] || null;
}

function readLatestCandidateReport() {
    const latest = latestReport(/^formal-strategy-candidate-lab-.*\.json$/);
    if (!latest) throw new Error('没有候选评估报告，请先运行 evaluate');
    return {
        file: latest.file,
        report: JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latest.file), 'utf8'))
    };
}

function readLatestWaveQualityReport() {
    const latest = latestReport(/^wave-b-quality-report-.*\.json$/);
    if (!latest) throw new Error('没有金色 B 质量报告，请先运行 quality-shadow');
    return {
        file: latest.file,
        report: JSON.parse(fs.readFileSync(path.join(REPORT_DIR, latest.file), 'utf8'))
    };
}

function candidateResults(report) {
    const rows = [];
    for (const [strategy, experiment] of Object.entries(report.experiments || {})) {
        if (experiment.ablations) {
            for (const [variantId, result] of Object.entries(experiment.ablations)) {
                rows.push({
                    strategy,
                    candidateId: experiment.candidate.id,
                    candidateHash: result.hash,
                    variantId,
                    label: result.label,
                    evaluation: result.evaluation,
                    affectedDecisions: result.affectedDecisions,
                    result
                });
            }
        } else {
            rows.push({
                strategy,
                candidateId: experiment.candidate.id,
                candidateHash: experiment.candidate.hash,
                variantId: experiment.candidate.id,
                label: experiment.candidate.question,
                evaluation: experiment.evaluation,
                affectedDecisions: experiment.affectedDecisions,
                result: experiment
            });
        }
    }
    return rows;
}

function printReview(file, report) {
    const rows = candidateResults(report).map(item => ({
        strategy: item.strategy,
        candidateId: item.candidateId,
        variantId: item.variantId,
        status: item.evaluation?.status || 'missing_evaluation',
        affectedDecisionDays: item.affectedDecisions?.total || 0,
        failedChecks: (item.evaluation?.checks || []).filter(check => check.blocking && !check.pass).map(check => check.id)
    }));
    console.log(JSON.stringify({
        report: path.join('.local', 'strategy-reports', file),
        commonAsOf: report.dataSnapshot?.commonAsOf || '',
        policyHash: report.validationPolicy?.policyHash || '',
        results: rows
    }, null, 2));
}

function chunk(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
    return result;
}

function refresh(args) {
    const dryRun = args.has('dry-run');
    if (!dryRun && !args.has('after-close')) {
        throw new Error('真实刷新只允许在确认收盘后执行，请显式传入 --after-close');
    }
    const common = dryRun ? ['--dry-run'] : ['--refresh'];
    const delay = args.get('delay-ms');
    if (delay) common.push('--delay-ms', String(delay));
    const historyStart = args.get('history-start');
    if (historyStart && historyStart !== true) common.push('--history-start', String(historyStart));
    const requestedIndices = args.get('indices') || 'all';
    runNode('scripts/strategy-cache-fetch.js', ['--indices', requestedIndices, ...common]);

    const requestedCodes = args.get('codes')
        ? String(args.get('codes')).split(',').map(value => value.trim()).filter(Boolean)
        : (UNIVERSE.stocks || []).map(stock => stock.code);
    for (const codes of chunk(requestedCodes, 12)) {
        runNode('scripts/strategy-cache-fetch.js', ['--codes', codes.join(','), ...common]);
    }
}

function baseline() {
    runNode('scripts/strategy-formal-baseline.js');
}

function evaluate(args) {
    if (args.get('variant') && !args.get('strategy')) {
        throw new Error('evaluate 使用 --variant 时必须同时指定 --strategy');
    }
    if (!args.has('reuse-baseline')) baseline();
    const command = [];
    if (args.get('strategy')) command.push('--strategy', String(args.get('strategy')));
    if (args.get('variant')) command.push('--variant', String(args.get('variant')));
    if (args.has('progress')) command.push('--progress');
    runNode('scripts/strategy-formal-candidate-lab.js', command);
}

function review() {
    const latest = readLatestCandidateReport();
    printReview(latest.file, latest.report);
}

function readReferenceDates(report) {
    const referenceId = POLICY.temporalWindows.referenceIndex;
    const entry = (report.dataSnapshot?.files || []).find(file => file.id === referenceId);
    if (!entry) throw new Error(`数据快照缺少参考指数：${referenceId}`);
    const rows = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, entry.file), 'utf8'));
    return rows.map(row => row.date).filter(Boolean);
}

function shadow(args) {
    const strategy = String(args.get('strategy') || '');
    const variantId = String(args.get('variant') || '');
    if (!strategy || !variantId) throw new Error('shadow 需要 --strategy 和 --variant');
    if (args.has('refresh-evaluation')) evaluate(new Map([['strategy', strategy]]));
    const latest = readLatestCandidateReport();
    const selected = candidateResults(latest.report).find(item => item.strategy === strategy && item.variantId === variantId);
    if (!selected) throw new Error(`候选报告中不存在 ${strategy} / ${variantId}`);
    if (selected.evaluation?.status === 'reject') throw new Error('历史准入已否决，不能进入影子观察');
    if (selected.evaluation?.status !== 'recommend_shadow' && !args.has('allow-insufficient')) {
        throw new Error('候选历史证据不足；如只想冻结观察，可显式传入 --allow-insufficient');
    }

    fs.mkdirSync(SHADOW_DIR, { recursive: true });
    const safeName = `${selected.candidateId}-${variantId}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
    const statePath = path.join(SHADOW_DIR, `${safeName}.json`);
    const commonAsOf = latest.report.dataSnapshot?.commonAsOf || '';
    const affectedTotal = selected.affectedDecisions?.total || 0;
    const now = new Date().toISOString();
    let state;

    if (!fs.existsSync(statePath)) {
        state = {
            schemaVersion: 1,
            strategy,
            candidateId: selected.candidateId,
            variantId,
            candidateHash: selected.candidateHash,
            frozenAt: now,
            frozenAsOf: commonAsOf,
            frozenAffectedDecisionDays: affectedTotal,
            observations: []
        };
    } else {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (state.candidateHash !== selected.candidateHash) {
            throw new Error('候选定义已经变化，必须以新候选重新冻结');
        }
    }

    const referenceDates = readReferenceDates(latest.report);
    const newTradingDays = referenceDates.filter(date => date > state.frozenAsOf && date <= commonAsOf).length;
    const newAffectedDecisionDays = Math.max(0, affectedTotal - state.frozenAffectedDecisionDays);
    const readyForReview = newTradingDays >= POLICY.gates.minimumShadowTradingDays
        && newAffectedDecisionDays >= POLICY.gates.minimumAffectedDecisionDays
        && selected.evaluation?.status !== 'reject';
    const observation = {
        observedAt: now,
        report: latest.file,
        commonAsOf,
        newTradingDays,
        newAffectedDecisionDays,
        historicalStatus: selected.evaluation?.status || 'missing_evaluation',
        status: readyForReview ? 'recommend_human_review' : 'shadow_observe'
    };
    const previous = state.observations.at(-1);
    if (!previous || previous.commonAsOf !== observation.commonAsOf || previous.historicalStatus !== observation.historicalStatus) {
        state.observations.push(observation);
    }
    state.latest = observation;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(JSON.stringify({ statePath: path.relative(ROOT, statePath), ...observation }, null, 2));
}

function qualityShadow(args) {
    if (args.has('signals') || args.has('discover') || args.has('with-features') || args.has('with-scores')
        || args.has('quality-feature') || args.has('quality-only')) {
        throw new Error('quality-shadow 只跟踪已预注册的金色 B 规则，不接受搜索或自定义信号参数。');
    }
    if (!args.has('reuse-report')) {
        const command = ['--signals=B8,B17', '--event-details'];
        if (args.has('progress')) command.push('--progress');
        runNode('scripts/strategy-wave-b-quality-report.js', command);
    }
    const latest = readLatestWaveQualityReport();
    const result = updateQualityShadow(latest.report, {
        root: ROOT,
        reportFile: latest.file,
        allowEmptyRefreeze: args.has('refreeze')
    });
    console.log(JSON.stringify({
        statePath: result.statePath,
        ruleId: result.state.ruleId,
        frozenAsOf: result.state.frozenAsOf,
        historicalQualified: result.state.frozenHistorical?.qualified === true,
        latest: result.observation
    }, null, 2));
}

function qualityStatus() {
    console.log(JSON.stringify({
        qualityShadowStates: listQualityShadowStates(ROOT)
    }, null, 2));
}

function status() {
    const latest = latestReport(/^formal-strategy-candidate-lab-.*\.json$/);
    const shadowStates = fs.existsSync(SHADOW_DIR)
        ? fs.readdirSync(SHADOW_DIR).filter(file => file.endsWith('.json')).map(file => {
            const state = JSON.parse(fs.readFileSync(path.join(SHADOW_DIR, file), 'utf8'));
            return { file, strategy: state.strategy, candidateId: state.candidateId, variantId: state.variantId, latest: state.latest || null };
        })
        : [];
    console.log(JSON.stringify({
        latestCandidateReport: latest ? path.join('.local', 'strategy-reports', latest.file) : null,
        shadowStates,
        qualityShadowStates: listQualityShadowStates(ROOT)
    }, null, 2));
}

function observation(command, args) {
    const action = command.replace(/^observe-/, '');
    const commandArgs = [action];
    for (const [key, value] of args.entries()) {
        commandArgs.push(`--${key}`);
        if (value !== true) commandArgs.push(String(value));
    }
    runNode('scripts/strategy-observation.js', commandArgs);
}

function main() {
    const { command, args } = parseArgs(process.argv.slice(2));
    if (command === 'refresh') return refresh(args);
    if (command === 'baseline') return baseline();
    if (command === 'evaluate') return evaluate(args);
    if (command === 'review') return review();
    if (command === 'shadow') return shadow(args);
    if (command === 'quality-shadow') return qualityShadow(args);
    if (command === 'quality-status') return qualityStatus();
    if (command === 'status') return status();
    if (command.startsWith('observe-')) return observation(command, args);
    throw new Error(`未知命令：${command}`);
}

try {
    main();
} catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
}
