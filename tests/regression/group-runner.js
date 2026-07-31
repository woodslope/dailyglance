const path = require('path');

const GROUP_FILTERS = {
    'data-cache': 'cache|cached|realtime|quote|history|refresh|data contract|trading calendar|ETF',
    'strategy-decision': 'strategy|signal|position|B/S|MACD|B8|B13|B17|B18|L5|L7|L8|L12|W2|W3|W4|backtest|baseline',
    'presentation-state': 'right panel|decision evidence|novice|display|badge|copyright|ownership|mobile|build version|status copy',
    'chart-navigation': 'chart|canvas|hover|drag|panning|viewport|range preset|period switch|next day|latest button|mouse|wheel|crosshair',
    'watchlist-lifecycle': 'watchlist|sidebar|startup|search|stock display|left list|strategy switch|active memory'
};

function runGroup(group) {
    const filter = GROUP_FILTERS[group];
    if (!filter) throw new Error(`Unknown regression group: ${group}`);
    process.env.TEST_GROUP = group;
    require(path.join(__dirname, '..', 'regression.js'));
}

module.exports = { GROUP_FILTERS, runGroup };
