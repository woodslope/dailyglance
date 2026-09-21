'use strict';

// DailyGlance 唯一路由源：改动文件 → 回归分组的映射。
// check.js（验证入口）和 map.js（导航入口）都引用这里，避免两份路由漂移。
// AGENTS.md 的“变更影响矩阵”是这份逻辑的人读镜像；以本文件为准。

const REGRESSION_GROUPS = ['data-cache', 'strategy-decision', 'presentation-state', 'chart-navigation', 'watchlist-lifecycle'];

function groupsForFile(file) {
    if (file === 'tests/regression.js') return REGRESSION_GROUPS;
    const match = file.match(/^tests\/regression\/([\w-]+)(?:\.cases)?\.js$/);
    if (match && REGRESSION_GROUPS.includes(match[1])) return [match[1]];
    if (file.startsWith('assets/js/00-')) return ['strategy-decision'];
    if (file.startsWith('assets/js/01-')) return ['presentation-state'];
    if (file.startsWith('assets/js/02-') || file.includes('data-contract')) return ['data-cache'];
    if (file.startsWith('assets/js/03-') || file.startsWith('scripts/strategy-')) return ['strategy-decision'];
    if (file.startsWith('assets/js/04-')) return ['chart-navigation', 'presentation-state'];
    if (file.startsWith('assets/js/05-')) return ['chart-navigation', 'watchlist-lifecycle'];
    if (file.startsWith('assets/js/07-')) return ['chart-navigation', 'watchlist-lifecycle'];
    if (file === 'index.html' || file === 'strategy-inspector.html' || file.startsWith('assets/js/strategy-inspector.js') || file.startsWith('assets/js/06-') || file.startsWith('assets/css/')) return ['presentation-state'];
    if (file === 'scripts/status-smoke.js' || file === 'scripts/live-dataflow-smoke.js' || file === 'scripts/performance-budget.js' || file === 'scripts/stability-governance.js' || file === 'scripts/ui-governance-smoke.js') return ['chart-navigation', 'presentation-state'];
    return [];
}

module.exports = { REGRESSION_GROUPS, groupsForFile };
