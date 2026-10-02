#!/usr/bin/env node
// Rebuild the March 27 pre-update rules without touching the current data files.
import { spawnSync } from 'node:child_process';
import { copyFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ref = '987b4cd5d89fadc540c88deae222df0c088c4ee3';
const out = join(root, 'data', 'legacy');
const flags = process.argv.slice(2);
if (flags.some((f) => !['--offline','--refresh','--quiet'].includes(f))) throw new Error('Supported options: --offline, --refresh, --quiet');
const result = spawnSync(process.execPath, [join(root, 'tools/build-data.mjs'), '--ref', ref,
  '--cache', join(root, '.cache/legacy-gamedata'), '--out', out,
  '--report', join(root, '.cache/legacy-build-report.json'), ...flags], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
// Artwork manifests refer to shared public assets; game data stays isolated.
for (const name of ['assets.json', 'local-assets.json', 'emotes.json']) {
  if ((await readdir(join(root, 'data'))).includes(name)) await copyFile(join(root, 'data', name), join(out, name));
}
await writeFile(join(out, 'provenance.json'), JSON.stringify({
  ruleset: 'legacy', baseline: '2026-03-27 更新前的二期下半',
  sourceCommit: ref, sourceDate: '2026-03-17',
  officialNotice: 'https://ak.hypergryph.com/news/8584',
  source: `https://github.com/Kengxxiao/ArknightsGameData/tree/${ref}/zh_CN/gamedata`,
  extraStrategies: ['铃兰', '杰西卡', '缪尔赛思', '芬'],
  scope: 'Historical client data plus four newer strategies; shared fan-game engine with current bug fixes. Not an original client rollback.',
}, null, 2));
