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
