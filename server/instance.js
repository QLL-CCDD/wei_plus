// Identify this checkout and its loaded game code without publishing filesystem paths.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SERVER_FAMILY = 'wei_plus';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TABLES = ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices',
  'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'provenance'];

export function getInstanceIdentity(root = ROOT) {
  const canonical = fs.realpathSync(root);
  const workspace = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const files = [];
  function collect(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    for (const item of fs.readdirSync(absolute, { withFileTypes: true })) {
      const next = path.join(relative, item.name);
      if (item.isDirectory()) collect(next);
      else if (/\.(js|mjs|css)$/.test(item.name)) files.push(next);
    }
  }
  for (const directory of ['server', 'shared', 'public/js', 'public/css']) collect(directory);
  for (const relative of ['public/index.html', 'package.json']) if (fs.existsSync(path.join(root, relative))) files.push(relative);
  for (const prefix of ['data', 'data/legacy']) for (const name of TABLES) {
    const relative = path.join(prefix, `${name}.json`);
    if (fs.existsSync(path.join(root, relative))) files.push(relative);
  }
  const hash = createHash('sha256');
  for (const relative of files.sort()) hash.update(relative.replaceAll('\\', '/') + '\0').update(fs.readFileSync(path.join(root, relative))).update('\0');
  return { workspace, revision: hash.digest('hex') };
}

export function normalizeAlternateUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function isSameServer(health, expected, ruleset, alternatePort, bindHost, alternateUrl) {
  return health?.ok === true && health.family === SERVER_FAMILY && health.ruleset === ruleset &&
    health.instance?.workspace === expected.workspace && health.instance?.revision === expected.revision &&
    (alternatePort === undefined || health.alternatePort === alternatePort) &&
    (bindHost === undefined || health.bindHost === bindHost) &&
    (alternateUrl === undefined || health.alternateUrl === alternateUrl);
}
