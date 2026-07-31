#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'strategy-wave-right-confirmation-entry-lab.js'), 'utf8');

assert.ok(source.includes("id: 'wave_right_confirmation_entry_v1'"), '缺少右侧确认新开仓候选定义');
assert.ok(source.includes("state.strategy !== '波段抄底型' || state.mode !== 'stock'"), '候选必须限定股票波段策略');
assert.ok(source.includes("rawSignals.includes('B3') || rawSignals.includes('B15')"), '候选必须由B3或B15右侧确认触发');
assert.ok(source.includes('findWaveRightConfirmationRepair(idx, full)'), '候选必须要求近期波段修复背景');
assert.ok(source.includes('prevPos === 0 && decision.position === 0'), '候选只能从空仓建立新仓');
assert.ok(source.includes('decision.position = 30;'), '候选新开仓必须限制为30%试探仓');
assert.ok(source.includes("decision.bsMark = 'B';"), '候选新开仓必须显式记录B标记');
assert.ok(source.includes('hasAnyExitOrWarning'), '候选必须排除当日离场和预警');
assert.ok(source.includes('!meta.inCooldown'), '候选必须排除冷静期');
assert.ok(source.includes('marketAllowsAdd'), '候选必须服从市场门禁');
assert.ok(source.includes('entryQuality: summarizeEntryQuality(entries)'), '候选必须单独输出新增B后验质量');
assert.ok(source.includes('standardCostFailureRate'), '候选必须输出成本后的失败率');
assert.ok(source.includes('explicitRightConfirmationOnly'), '候选必须审计新增B的触发归因');
assert.ok(!/\bfetch\s*\(|https?:\/\//.test(source), '候选研究脚本不得访问网络');

console.log('波段右侧确认新开仓研究脚本契约通过');
