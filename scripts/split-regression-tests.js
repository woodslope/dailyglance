#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const regressionPath = path.join(root, 'tests', 'regression.js');
const source = fs.readFileSync(regressionPath, 'utf8');
const firstTest = source.indexOf("runTest('regression suite exposes focused business group entrypoints'");

if (firstTest < 0) {
    throw new Error('Regression cases were already moved or the expected first case is missing.');
}

const prefix = source.slice(0, firstTest).trimEnd();
const blocks = source.slice(firstTest).split(/(?=^runTest\()/m).filter(block => block.trim());
const groups = {
    'data-cache': [],
    'strategy-decision': [],
    'presentation-state': [],
    'chart-navigation': [],
    'watchlist-lifecycle': []
};

function groupFor(name) {
    if (/watchlist|sidebar|startup|search|stock display|left list|active memory/i.test(name)) return 'watchlist-lifecycle';
    if (/chart|canvas|hover|drag|panning|viewport|range preset|period switch|next day|latest button|mouse|wheel|crosshair/i.test(name)) return 'chart-navigation';
    if (/strategy|signal|position|B\/S|MACD|B8|B13|B17|B18|L5|L7|L8|L12|W2|W3|W4|backtest|baseline/i.test(name)) return 'strategy-decision';
    if (/cache|cached|realtime|quote|history|refresh|data contract|trading calendar|ETF/i.test(name)) return 'data-cache';
    return 'presentation-state';
}

for (const block of blocks) {
    const name = block.match(/^runTest\((['"`])([\s\S]*?)\1/)?.[2];
    if (!name) throw new Error(`Unable to read test name from: ${block.slice(0, 80)}`);
    groups[groupFor(name)].push(block.trimEnd());
}

for (const [group, cases] of Object.entries(groups)) {
    const target = path.join(root, 'tests', 'regression', `${group}.cases.js`);
    fs.writeFileSync(target, `${cases.join('\n\n')}\n`);
}

const loader = `

const REGRESSION_GROUPS = ${JSON.stringify(Object.keys(groups))};
const selectedRegressionGroups = process.env.TEST_GROUP
    ? process.env.TEST_GROUP.split(',').filter(group => REGRESSION_GROUPS.includes(group))
    : REGRESSION_GROUPS;

for (const group of selectedRegressionGroups) {
    const groupSource = read(\`tests/regression/\${group}.cases.js\`);
    eval(groupSource);
}
`;

fs.writeFileSync(regressionPath, `${prefix}${loader}`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([group, cases]) => [group, cases.length])), null, 2));
