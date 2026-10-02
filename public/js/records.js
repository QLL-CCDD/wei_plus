// Browser-local, append-only match records. Stable ruleset ids keep future modes separate.
export const RECORDS_KEY = 'sp.records.v1';
import { chessAvatarUrl, enemyIconUrl } from './ui/assetUrls.js';

const count = (n) => Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
const text = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
const list = (v) => Array.isArray(v) ? v : [];
const localImage = (v) => typeof v === 'string' && v.startsWith('/assets/') ? v.slice(0, 500) : '';
const stats = (v) => Object.fromEntries(Object.entries(v || {}).filter(([k, n]) => /^[a-zA-Z]+$/.test(k) && Number.isFinite(n)).map(([k, n]) => [k, count(n)]));
const bonds = (v) => list(v).filter((b) => b && text(b.bondId)).slice(0, 100).map((b) => ({ bondId: text(b.bondId), name: text(b.name), active: b.active === true, layers: count(b.layers) }));
const lineup = (v) => list(v).filter((u) => u && text(u.id)).slice(0, 100).map((u) => ({ id: text(u.id), name: text(u.name), avatarUrl: localImage(u.avatarUrl), golden: u.golden === true, tier: count(u.tier), row: count(u.row), col: count(u.col), items: list(u.items).map((i) => text(i)).filter(Boolean).slice(0, 20) }));
const title = (v) => v && typeof v === 'object' ? { id: text(v.id), name: text(v.name), picId: text(v.picId), text: text(v.text, 1000) } : text(v);

function cleanSettlement(r) {
  const boss = (b) => b && typeof b === 'object' ? { id: text(b.id), name: text(b.name), enemyKey: text(b.enemyKey), iconUrl: localImage(b.iconUrl) } : null;
  return {
    victory: r.victory === true, roundsPassed: count(r.roundsPassed), lastRound: Number.isFinite(r.lastRound) ? count(r.lastRound) : 14,
    bossRound: count(r.bossRound), hiddenRound: count(r.hiddenRound), hiddenReached: r.hiddenReached === true, hiddenCleared: r.hiddenCleared === true,
    teamLp: Number.isFinite(r.teamLp) ? count(r.teamLp) : null, modeId: text(r.modeId), difficulty: text(r.difficulty),
    stageId: text(r.stageId), bossId: text(r.bossId), hiddenBossId: text(r.hiddenBossId), seed: count(r.seed),
    durationMs: count(r.durationMs), reason: text(r.reason), bossInfo: boss(r.bossInfo), hiddenBossInfo: boss(r.hiddenBossInfo),
    players: list(r.players).filter((p) => p && text(p.playerId)).slice(0, 4).map((p) => ({
      playerId: text(p.playerId), seat: count(p.seat), name: text(p.name, 80), isBot: p.isBot === true, left: p.left === true,
      alive: p.alive !== false, victory: p.victory === true, roundsPassed: count(p.roundsPassed), lp: Number.isFinite(p.lp) ? count(p.lp) : null,
      bandId: text(p.bandId), bandName: text(p.bandName), title: title(p.title), lineup: lineup(p.lineup), bonds: bonds(p.bonds),
      stats: stats(p.stats), trophies: count(p.trophies), reward: count(p.reward),
    })),
  };
}

function snapshotResult(result, context) {
  const boss = (id) => { const b = context.boss?.(id); return b ? { ...b, iconUrl: enemyIconUrl(context.m, b.enemyKey) } : null; };
  return cleanSettlement({ ...result, bossInfo: boss(result.bossId), hiddenBossInfo: boss(result.hiddenBossId),
    players: list(result.players).map((p) => ({ ...p, bandName: context.band?.(p.bandId)?.name,
      lineup: list(p.lineup).map((u) => { const c = context.chess?.(u.id); return { ...u, name: c?.name, avatarUrl: chessAvatarUrl(context.m, c) }; }),
      bonds: list(p.bonds).map((b) => ({ ...b, name: context.bond?.(b.bondId)?.name })),
    })),
  });
}

function cleanRecord(r) {
  if (!r || typeof r !== 'object' || !text(r.id) || !text(r.rulesetId, 64) || !Number.isFinite(r.endedAt)) {
    throw new Error('战绩文件包含无效记录');
  }
  return {
    id: text(r.id), rulesetId: text(r.rulesetId, 64), rulesetName: text(r.rulesetName),
    endedAt: count(r.endedAt), name: text(r.name, 80), modeId: text(r.modeId, 80),
    playerId: text(r.playerId), seat: count(r.seat), alive: r.alive !== false, lp: Number.isFinite(r.lp) ? count(r.lp) : null,
    difficulty: text(r.difficulty, 32), victory: r.victory === true, teamVictory: r.teamVictory === true,
    roundsPassed: count(r.roundsPassed), durationMs: count(r.durationMs), trophies: count(r.trophies), reward: count(r.reward),
    bandId: text(r.bandId, 100), title: text(typeof r.title === 'object' ? r.title?.name : r.title),
    bonds: bonds(r.bonds), lineup: lineup(r.lineup), stats: stats(r.stats),
    result: r.result && typeof r.result === 'object' ? cleanSettlement(r.result) : null,
  };
}

function parseRecords(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.matches)) throw new Error('战绩文件格式或版本不受支持');
  const unique = new Map();
  for (const entry of raw.matches) {
    const r = cleanRecord(entry);
    const key = `${r.rulesetId}:${r.id}`;
    if (!unique.has(key)) unique.set(key, r);
  }
  return { version: 1, matches: [...unique.values()].sort((a, b) => b.endedAt - a.endedAt) };
}

export function loadRecords(storage = globalThis.localStorage) {
  const raw = storage?.getItem(RECORDS_KEY);
  return raw == null ? { version: 1, matches: [] } : parseRecords(JSON.parse(raw));
}

function saveRecords(value, storage) {
  if (!storage?.setItem) throw new Error('浏览器不允许保存战绩');
  storage.setItem(RECORDS_KEY, JSON.stringify(value));
}

/** Save only this human player's settlement; repeated reconnect pushes cannot count twice. */
export function recordResult(result, playerId, storage = globalThis.localStorage, context = {}) {
  const p = list(result?.players).find((row) => row?.playerId === playerId);
  if (!p || p.isBot || !result?.matchId) return false;
  const record = cleanRecord({
    ...p, id: `${result.matchId}:${playerId}`, rulesetId: result.rulesetId || 'current',
    rulesetName: result.rulesetName || '卫戍协议：盟约', endedAt: result.endedAt || Date.now(),
    modeId: result.modeId, difficulty: result.difficulty, durationMs: result.durationMs,
    victory: typeof p.victory === 'boolean' ? p.victory : result.victory === true && p.alive !== false,
    teamVictory: result.victory === true,
    result: snapshotResult(result, context),
  });
  const saved = loadRecords(storage);
  const existing = saved.matches.find((r) => r.id === record.id && r.rulesetId === record.rulesetId);
  if (existing) {
    // A resumed settlement can enrich an old record without changing its statistics.
    if (!existing.result) { existing.result = record.result; existing.playerId = playerId; saveRecords(saved, storage); }
    return false;
  }
  saved.matches.unshift(record);
  saveRecords(saved, storage);
  return true;
}

export function summarizeRecords(matches) {
  const bands = new Map(), bonds = new Map();
  const out = { games: 0, wins: 0, trophies: 0, reward: 0 };
  const add = (map, id, win) => {
    if (!id) return;
    const row = map.get(id) || { id, games: 0, wins: 0 };
    row.games++; if (win) row.wins++; map.set(id, row);
  };
  for (const r of matches) {
    out.games++; if (r.victory) out.wins++;
    out.trophies += count(r.trophies); out.reward += count(r.reward);
    add(bands, r.bandId, r.victory);
    for (const id of new Set(list(r.bonds).filter((b) => b.active).map((b) => b.bondId))) add(bonds, id, r.victory);
  }
  const rows = (map) => [...map.values()].sort((a, b) => b.wins - a.wins || b.games - a.games || a.id.localeCompare(b.id));
  return { ...out, bands: rows(bands), bonds: rows(bonds) };
}

export function exportRecords(storage = globalThis.localStorage) {
  return JSON.stringify(loadRecords(storage), null, 2);
}

/** A backup is merged, never replaces records of existing or future modes. */
export function importRecords(json, storage = globalThis.localStorage) {
  const incoming = parseRecords(JSON.parse(json));
  const saved = loadRecords(storage);
  const keys = new Set(saved.matches.map((r) => `${r.rulesetId}:${r.id}`));
  let added = 0;
  let enriched = false;
  for (const r of incoming.matches) {
    const key = `${r.rulesetId}:${r.id}`;
    if (keys.has(key)) {
      const existing = saved.matches.find((entry) => `${entry.rulesetId}:${entry.id}` === key);
      if (!existing.result && r.result) { existing.result = r.result; existing.playerId = r.playerId; enriched = true; }
      continue;
    }
    saved.matches.push(r); keys.add(key); added++;
  }
  if (added || enriched) {
    saved.matches.sort((a, b) => b.endedAt - a.endedAt);
    saveRecords(saved, storage);
  }
  return added;
}
