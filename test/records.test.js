import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORDS_KEY, recordResult, loadRecords, summarizeRecords, exportRecords, importRecords } from '../public/js/records.js';
import { makeMatch, DATA } from './match/harness.js';

function storage() {
  const values = new Map([['sp.pref.loadout', '{"v":1,"entries":[]}']]);
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}
function result(id = 'match-1', patch = {}) {
  return { matchId: id, endedAt: 1700000000000, rulesetId: 'current', rulesetName: '盟约', modeId: 'mode_multi_hard', difficulty: 'HARD', victory: true, durationMs: 600000,
    players: [{ playerId: 'p0', name: '博士', victory: true, trophies: 20, reward: 100, roundsPassed: 14, bandId: 'band_1',
      bonds: [{ bondId: 'bond_1', active: true, layers: 80 }, { bondId: 'bond_1', active: true, layers: 80 }, { bondId: 'bond_2', active: false, layers: 5 }],
      lineup: [{ id: 'chess_1', golden: true, items: ['item_1'] }], title: { name: '卫戍之星' }, stats: { kills: 5 } }], ...patch };
}

test('personal wins, active covenant wins, trophies and lineup persist; reconnect is idempotent', () => {
  const s = storage();
  assert.equal(recordResult(result(), 'p0', s), true);
  assert.equal(recordResult(result(), 'p0', s), false);
  const lost = result('match-2'); lost.players[0].victory = false;
  assert.equal(recordResult(lost, 'p0', s), true, 'team victory does not count for an eliminated player');
  const saved = loadRecords(s);
  assert.equal(saved.matches.length, 2);
  assert.equal(saved.matches[0].lineup[0].golden, true);
  assert.equal(saved.matches[0].title, '卫戍之星');
  assert.deepEqual(summarizeRecords(saved.matches), { games: 2, wins: 1, trophies: 40, reward: 200, bands: [{ id: 'band_1', games: 2, wins: 1 }], bonds: [{ id: 'bond_1', games: 2, wins: 1 }] });
  assert.equal(s.getItem('sp.pref.loadout'), '{"v":1,"entries":[]}', 'existing preferences are untouched');
});

test('backups merge current, legacy and a future ruleset without resetting or double counting', () => {
  const s = storage(); recordResult(result(), 'p0', s);
  const incoming = storage();
  recordResult(result(), 'p0', incoming);
  recordResult(result('old', { rulesetId: 'legacy' }), 'p0', incoming);
  recordResult(result('season1', { rulesetId: 'season1', rulesetName: '一期' }), 'p0', incoming);
  assert.equal(importRecords(exportRecords(incoming), s), 2);
  assert.equal(importRecords(exportRecords(incoming), s), 0);
  assert.equal(summarizeRecords(loadRecords(s).matches).wins, 3);
  assert.equal(loadRecords(s).matches.filter((r) => r.rulesetId === 'current').length, 1);
  const moved = storage(); assert.equal(importRecords(exportRecords(s), moved), 3);
  assert.deepEqual(loadRecords(moved), loadRecords(s));
});

test('invalid backups, corrupt storage and quota errors cannot overwrite existing records', () => {
  const s = storage(); recordResult(result(), 'p0', s); const before = s.getItem(RECORDS_KEY);
  assert.throws(() => importRecords('{"version":2,"matches":[]}', s));
  assert.throws(() => importRecords('{"version":1,"matches":[{}]}', s));
  assert.equal(s.getItem(RECORDS_KEY), before);
  const broken = { getItem: () => '{bad', setItem: () => assert.fail('must not overwrite') };
  assert.throws(() => recordResult(result(), 'p0', broken));
  const full = { getItem: s.getItem, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.throws(() => recordResult(result('new'), 'p0', full), /Quota/);
  assert.equal(s.getItem(RECORDS_KEY), before);
});

test('AI, spectators and pre-feature result messages cannot produce fictitious records', () => {
  const s = storage();
  assert.equal(recordResult(result(), 'spectator', s), false);
  const bot = result(); bot.players[0].isBot = true;
  assert.equal(recordResult(bot, 'p0', s), false);
  assert.equal(recordResult(result(undefined, { matchId: null }), 'p0', s), false);
  assert.equal(loadRecords(s).matches.length, 0);
});

test('full settlement preserves all teammates, boss medals, stats and historical art through backup', () => {
  const s = storage();
  const r = result('full', { lastRound: 14, bossRound: 14, hiddenRound: 15, hiddenReached: true, hiddenCleared: true,
    teamLp: 16, bossId: 'boss_1', hiddenBossId: 'hidden_1', stageId: 'stage_1', seed: 7 });
  r.players.push({ playerId: 'ai', name: 'AI 队友', isBot: true, seat: 1, alive: true, lp: 8, victory: true, bandId: 'band_2',
    stats: { dmgDealt: 3060000, bossDamage: 1100000, activatedLayers: 623 }, title: { id: 'comment_1', name: '卫戍之星', picId: 'icon_1', text: '评语文本' },
    lineup: [{ id: 'old_chess', tier: 4, golden: true, items: ['gear'] }], bonds: [{ bondId: 'bond_1', active: true, layers: 559 }] });
  const context = { m: { chars: { char_old: { avatar: '/assets/chars/old.png' } }, enemies: { enemy: '/assets/enemies/boss.png' } },
    chess: () => ({ name: '旧版干员', charId: 'char_old' }), band: () => ({ name: '贾维' }), bond: () => ({ name: '炎' }),
    boss: (id) => ({ id, name: '领袖', enemyKey: 'enemy' }) };
  assert.equal(recordResult(r, 'p0', s, context), true);
  const full = loadRecords(s).matches[0].result;
  assert.equal(full.players.length, 2); assert.equal(full.hiddenCleared, true); assert.equal(full.teamLp, 16);
  assert.equal(full.players[1].isBot, true); assert.equal(full.players[1].stats.dmgDealt, 3060000);
  assert.equal(full.players[1].title.name, '卫戍之星'); assert.equal(full.players[1].lineup[0].name, '旧版干员');
  assert.equal(full.players[1].lineup[0].avatarUrl, '/assets/chars/old.png'); assert.equal(full.players[1].bonds[0].layers, 559);
  assert.equal(full.bossInfo.name, '领袖');
  const restored = storage(); importRecords(exportRecords(s), restored);
  assert.deepEqual(loadRecords(restored).matches[0].result, full);
  assert.equal(summarizeRecords(loadRecords(restored).matches).games, 1, 'AI is saved for display, not counted as another game');
});

test('old brief records can gain full detail without resetting or counting them again', () => {
  const old = storage(); recordResult(result(), 'p0', old);
  const brief = JSON.parse(old.getItem(RECORDS_KEY)); delete brief.matches[0].result;
  old.setItem(RECORDS_KEY, JSON.stringify(brief));
  assert.equal(loadRecords(old).matches[0].result, null);
  assert.equal(recordResult(result(), 'p0', old), false);
  assert.ok(loadRecords(old).matches[0].result); assert.equal(summarizeRecords(loadRecords(old).matches).wins, 1);
  const another = storage(); another.setItem(RECORDS_KEY, JSON.stringify(brief));
  assert.equal(importRecords(exportRecords(old), another), 0);
  assert.ok(loadRecords(another).matches[0].result); assert.equal(loadRecords(another).matches.length, 1);
});

test('real current and legacy settlements carry stable ids and keep trophy rules on reconnect', () => {
  for (const rulesetId of ['current', 'legacy']) {
    const data = { ...DATA, config: { ...DATA.config, ruleset: { id: rulesetId, name: rulesetId } } };
    const h = makeMatch({ data, humans: 1, bots: 1, fake: true }).start().autoHumans();
    try {
      assert.equal(h.drive(() => h.ended != null), true);
      const r = h.ended;
      assert.equal(r.rulesetId, rulesetId); assert.ok(r.matchId); assert.ok(r.endedAt > 0);
      const s = storage(); assert.equal(recordResult(r, 'p_0', s), true);
      h.m.onReconnect('p_0');
      const resent = h.lastTo('p_0', 'm.result');
      assert.equal(resent.matchId, r.matchId); assert.equal(resent.endedAt, r.endedAt);
      assert.equal(recordResult(resent, 'p_0', s), false);
      assert.equal(loadRecords(s).matches[0].trophies, r.players.find((p) => p.playerId === 'p_0').trophies);
    } finally { h.m.dispose(); }
  }
});
