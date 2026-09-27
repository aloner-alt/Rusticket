const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePairing, savePairing } = require('../src/pairing.cjs');

const pairing = {
  type: 'server', ip: '185.207.214.233', port: '28017',
  playerId: '76561198000000000', playerToken: '-123456789', name: 'Test server'
};

test('extracts server pairing from an FCM appData JSON value', () => {
  const payload = { appData: [{ key: 'body', value: JSON.stringify(pairing) }] };
  assert.deepEqual(parsePairing(payload), {
    ip: pairing.ip, port: pairing.port, playerId: pairing.playerId,
    playerToken: pairing.playerToken, name: pairing.name
  });
});

test('ignores incomplete or non-server notifications', () => {
  assert.equal(parsePairing({ ...pairing, type: 'entity' }), null);
  assert.equal(parsePairing({ ...pairing, playerToken: '' }), null);
});

test('writes local env while preserving an existing Worker secret', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rusticket-pairing-'));
  try {
    const envPath = path.join(directory, '.env');
    fs.writeFileSync(envPath, 'RUSTPLUS_IP=\nRUSTPLUS_BRIDGE_TOKEN="existing-secret"\n');
    savePairing(envPath, pairing);
    const env = fs.readFileSync(envPath, 'utf8');
    assert.match(env, /RUSTPLUS_IP="185\.207\.214\.233"/);
    assert.match(env, /RUSTPLUS_PLAYER_TOKEN="-123456789"/);
    assert.match(env, /RUSTPLUS_BRIDGE_TOKEN="existing-secret"/);
    assert.match(env, /RUSTPLUS_ONLY_WHEN_SELF_ONLINE="1"/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
