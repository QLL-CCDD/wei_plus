import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, shareableInviteLink, alternateRulesetUrl } from '../public/js/multiplayerLinks.js';

test('localhost invitations use a LAN address with the correct version port', () => {
  assert.equal(shareableInviteLink('ABCD', 'http://localhost:3000/?join=OLD#old', ['http://192.168.1.36:3000']), 'http://192.168.1.36:3000/?room=ABCD');
  assert.equal(shareableInviteLink('ABCD', 'http://127.0.0.1:3001/', ['http://192.168.1.36:3001']), 'http://192.168.1.36:3001/?room=ABCD');
  assert.equal(isLoopbackHost('[::1]'), true); assert.equal(isLoopbackHost('127.0.0.2'), true);
});
test('existing LAN, VPN and public invite addresses are preserved', () => {
  for (const origin of ['http://192.168.1.5:3001', 'http://100.64.1.2:3000', 'https://game.example']) {
    assert.equal(shareableInviteLink('ABCD', `${origin}/?room=OLD#x`, ['http://192.168.1.36:3000']), `${origin}/?room=ABCD`);
  }
});
test('direct version switching retains the hostname and clears stale room codes', () => {
  const info = { port: 3000, alternatePort: 3001 };
  assert.equal(alternateRulesetUrl(info, 'http://192.168.1.36:3000/?room=ABCD&join=x#old'), 'http://192.168.1.36:3001/');
  assert.equal(alternateRulesetUrl({ port: 4000, alternatePort: 4001 }, 'http://localhost:4000/'), 'http://localhost:4001/');
});
test('public tunnels cannot turn an internal port into a broken external URL', () => {
  const info = { port: 3000, alternatePort: 3001 };
  assert.equal(alternateRulesetUrl(info, 'https://game.trycloudflare.com/'), null);
  assert.equal(alternateRulesetUrl(info, 'http://game.example/'), null);
  assert.equal(alternateRulesetUrl({ ...info, alternateUrl: 'https://old.example/?room=OLD&join=x' }, 'https://game.example/'), 'https://old.example/');
  assert.equal(alternateRulesetUrl({ ...info, alternateUrl: 'javascript:alert(1)' }, 'https://game.example/'), null);
});
