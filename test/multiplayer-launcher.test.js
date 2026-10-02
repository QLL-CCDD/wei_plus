import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { SERVER_FAMILY, getInstanceIdentity, isSameServer } from '../server/instance.js';
import { probePort } from '../tools/doctor.mjs';
import { startServer, localOrigins, alternateUrl, ROOT } from '../server/index.js';

test('checkout/code identity rejects original, other copies and stale code without depending on downloaded art or local state', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wei-plus-identity-'));
  const root = path.join(temporary, 'a');
  try {
    fs.mkdirSync(path.join(root, 'server'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'server/main.js'), 'export const value=1;');
    fs.writeFileSync(path.join(root, 'data/config.json'), '{"mode":1}');
    const expected = getInstanceIdentity(root);
    const health = { ok: true, family: SERVER_FAMILY, ruleset: 'current', instance: expected };
    assert.equal(isSameServer(health, expected, 'current'), true);
    assert.equal(isSameServer(health, expected, 'current', 3001), false, 'single-version servers cannot be reused as dual-version launchers');
    assert.equal(isSameServer({ ...health, alternatePort: 3001 }, expected, 'current', 3001), true);
    assert.equal(isSameServer({ ...health, alternatePort: 4001 }, expected, 'current', 3001), false);
    assert.equal(isSameServer({ ...health, alternatePort: 3001, bindHost: '127.0.0.1' }, expected, 'current', 3001, '0.0.0.0'), false);
    assert.equal(isSameServer({ ok: true, app: '0.1.0', uptimeSec: 1 }, expected, 'current'), false);
    assert.equal(isSameServer(health, expected, 'legacy'), false);
    for (const relative of ['.local/state.json', '.cache/x.json', 'public/assets/a.png', 'logs/run.log',
      'data/local-assets.json', 'data/assets.json', 'data/emotes.json', 'data/legacy/local-assets.json', 'data/legacy/assets.json', 'data/legacy/emotes.json']) {
      const absolute = path.join(root, relative); fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, 'unrelated');
    }
    assert.deepEqual(getInstanceIdentity(root), expected);
    const copy = path.join(temporary, 'b'); fs.cpSync(root, copy, { recursive: true });
    const other = getInstanceIdentity(copy);
    assert.equal(other.revision, expected.revision);
    assert.notEqual(other.workspace, expected.workspace);
    assert.equal(isSameServer({ ...health, instance: other }, expected, 'current'), false);
    fs.writeFileSync(path.join(root, 'server/main.js'), 'export const value=2;');
    const updated = getInstanceIdentity(root);
    assert.notEqual(updated.revision, expected.revision);
    assert.equal(isSameServer(health, updated, 'current'), false);
    fs.writeFileSync(path.join(root, 'data/config.json'), '{"mode":2}');
    assert.notEqual(getInstanceIdentity(root).revision, updated.revision);
  } finally {
    const resolved = fs.realpathSync(temporary);
    assert.ok(resolved.startsWith(path.join(fs.realpathSync(os.tmpdir()), 'wei-plus-identity-')));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('health probing uses the specified bind host instead of always probing 127.0.0.1', async () => {
  const server = http.createServer((req, res) => res.end(JSON.stringify({ ok: true, uptimeSec: 1 })));
  await new Promise((resolve) => server.listen(0, '127.0.0.2', resolve));
  try { assert.equal((await probePort(server.address().port, '127.0.0.2')).state, 'ours'); }
  finally { await new Promise((resolve) => server.close(resolve)); }
});

test('launcher refuses occupied original/other/stale servers and leaves them running', async () => {
  const expected = getInstanceIdentity();
  for (const health of [
    { ok: true, app: '0.1.0', uptimeSec: 1 },
    { ok: true, uptimeSec: 1, family: SERVER_FAMILY, ruleset: 'current', instance: { ...expected, workspace: 'other' } },
    { ok: true, uptimeSec: 1, family: SERVER_FAMILY, ruleset: 'current', instance: { ...expected, revision: 'old' } },
  ]) {
    const server = http.createServer((req, res) => res.end(JSON.stringify(health)));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const child = spawn(process.execPath, ['tools/start-versions.mjs', '--no-setup', '--no-open', '--port', String(server.address().port), '--legacy-port', '65534'],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stderr = ''; child.stderr.on('data', (b) => { stderr += b; });
      const [code] = await once(child, 'exit'); assert.equal(code, 1); assert.match(stderr, /先在原窗口停止/);
      assert.deepEqual(await (await fetch(`http://127.0.0.1:${server.address().port}/healthz`)).json(), health);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  }
});

test('launcher can safely reuse matching versions bound to a specific host', async () => {
  const expected = getInstanceIdentity();
  const servers = [];
  const healths = [];
  try {
    for (const ruleset of ['current', 'legacy']) {
      const health = { ok: true, uptimeSec: 1, family: SERVER_FAMILY, ruleset, instance: expected, bindHost: '127.0.0.2', alternateUrl: null };
      healths.push(health);
      const server = http.createServer((req, res) => res.end(JSON.stringify(health)));
      await new Promise((resolve) => server.listen(0, '127.0.0.2', resolve)); servers.push(server);
    }
    healths.forEach((health, index) => { health.alternatePort = servers[1-index].address().port; });
    const child = spawn(process.execPath, ['tools/start-versions.mjs', '--no-setup', '--no-open', '--host', '127.0.0.2',
      '--port', String(servers[0].address().port), '--legacy-port', String(servers[1].address().port)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = ''; child.stderr.on('data', (b) => { stderr += b; });
    const [code] = await once(child, 'exit'); assert.equal(code, 0, stderr);
  } finally { for (const server of servers) await new Promise((resolve) => server.close(resolve)); }
});

test('dual-version launchers validate separate public URLs and refuse stale entry configuration', async () => {
  const expected = getInstanceIdentity();
  const servers = [], healths = [];
  const urls = ['https://old.example/game', 'https://current.example/game'];
  try {
    for (const [index, ruleset] of ['current', 'legacy'].entries()) {
      const health = { ok: true, uptimeSec: 1, family: SERVER_FAMILY, ruleset, instance: expected,
        bindHost: '127.0.0.2', alternateUrl: urls[index] };
      healths.push(health);
      const server = http.createServer((req, res) => res.end(JSON.stringify(health)));
      await new Promise((resolve) => server.listen(0, '127.0.0.2', resolve)); servers.push(server);
    }
    healths.forEach((health, index) => { health.alternatePort = servers[1-index].address().port; });
    async function launch(extra) {
      const child = spawn(process.execPath, ['tools/start-versions.mjs', '--no-setup', '--no-open', '--host', '127.0.0.2',
        '--port', String(servers[0].address().port), '--legacy-port', String(servers[1].address().port)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, SP_ALTERNATE_URL: '', SP_CURRENT_ALTERNATE_URL: '', SP_LEGACY_ALTERNATE_URL: '', ...extra } });
      let stderr = ''; child.stderr.on('data', (b) => { stderr += b; });
      const [code] = await once(child, 'exit'); return { code, stderr };
    }
    const configured = { SP_CURRENT_ALTERNATE_URL: 'HTTPS://OLD.EXAMPLE:443/game', SP_LEGACY_ALTERNATE_URL: urls[1] };
    assert.equal((await launch(configured)).code, 0, 'each version must use its own normalized external entry');
    const changed = await launch({ ...configured, SP_LEGACY_ALTERNATE_URL: 'https://changed.example/' });
    assert.equal(changed.code, 1); assert.match(changed.stderr, /旧代码\/配置服务/);
    assert.equal((await fetch(`http://127.0.0.2:${servers[1].address().port}/healthz`)).status, 200, 'rejection must not stop the existing server');
    healths.forEach((health) => { health.alternateUrl = null; });
    const shared = await launch({ SP_ALTERNATE_URL: 'https://old.example/' });
    assert.equal(shared.code, 0); assert.match(shared.stderr, /本次忽略/);
  } finally { for (const server of servers) await new Promise((resolve) => server.close(resolve)); }
});

test('Windows stop ownership requires Node main script, not a path substring or another script argument', { skip: process.platform !== 'win32' }, () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/manage-versions.ps1'), 'utf8');
  const functionSource = source.match(/function Test-OwnedServerProcess[\s\S]*?(?=\r?\nfunction Show-GameStatus)/)?.[0];
  assert.ok(functionSource);
  const script = functionSource + String.raw`
$node = 'C:\Node Runtime\node.exe'
$main = 'C:\Game Root\server\index.js'
$cases = @(
  @{ CommandLine='"C:\Node Runtime\node.exe" "C:\Game Root\server\index.js"'; Owned=$true },
  @{ CommandLine='"C:\Node Runtime\node.exe" "c:\game root\server\INDEX.js" --flag'; Owned=$true },
  @{ CommandLine='"C:\Node Runtime\node.exe" "C:\Game Root\server\index.js.other"'; Owned=$false },
  @{ CommandLine='"C:\Node Runtime\node.exe" other.js "C:\Game Root\server\index.js"'; Owned=$false },
  @{ CommandLine='"C:\Node Runtime\node.exe" --eval "C:\Game Root\server\index.js"'; Owned=$false },
  @{ CommandLine='"C:\Node Runtime\node.exe" "C:\Game Root\server\index.js-old\main.js"'; Owned=$false }
)
foreach ($case in $cases) {
  $process = [pscustomobject]@{ ExecutablePath=$node; CommandLine=$case.CommandLine }
  if ((Test-OwnedServerProcess $process $node $main) -ne $case.Owned) { throw ('Incorrect ownership: ' + $case.CommandLine) }
}
$wrongExecutable = [pscustomobject]@{ ExecutablePath='C:\Other\node.exe'; CommandLine='node.exe "C:\Game Root\server\index.js"' }
if (Test-OwnedServerProcess $wrongExecutable $node $main) { throw 'Another runtime must not count as owned.' }
Write-Output 'ownership passed'
`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  assert.match(output, /ownership passed/);
});

test('health identity and ruleset expose usable actual ports and safe configured external entry', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const health = await (await fetch(server.url + '/healthz')).json();
    assert.equal(health.family, SERVER_FAMILY);
    assert.equal(health.bindHost, '127.0.0.1');
    assert.equal(health.alternateUrl, null);
    assert.match(health.instance.workspace, /^[a-f0-9]{64}$/);
    assert.match(health.instance.revision, /^[a-f0-9]{64}$/);
    const ruleset = await (await fetch(server.url + '/ruleset')).json();
    assert.equal(ruleset.port, server.port); assert.ok(Array.isArray(ruleset.localOrigins));
    assert.deepEqual(ruleset.localOrigins, [], 'loopback-only services must not advertise unusable LAN invites');
    assert.equal(alternateUrl('https://old.example.com/game'), 'https://old.example.com/game');
    for (const value of ['javascript:alert(1)', 'not a url', 'https://user:pass@example.com', 'ftp://example.com']) assert.equal(alternateUrl(value), null);
    assert.deepEqual(localOrigins(3001, {
      'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.1.1', internal: false }],
      Ethernet: [{ family: 'IPv4', address: '10.0.0.2', internal: false }],
      WLAN: [{ family: 'IPv4', address: '192.168.1.36', internal: false }],
      public: [{ family: 'IPv4', address: '1.2.3.4', internal: false }],
    }), ['http://192.168.1.36:3001', 'http://10.0.0.2:3001', 'http://172.20.1.1:3001']);
  } finally { await server.close(); }
});
