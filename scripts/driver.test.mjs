import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LABS, baseFrom, labsFrom } from '../driver/targets.mjs';

test('driver: default labs are plain names; DRIVE_LABS overrides and drops anything that is not a plain lab name', () => {
  assert.deepEqual(labsFrom({}), DEFAULT_LABS);
  for (const l of DEFAULT_LABS) assert.match(l, /^[a-z0-9][a-z0-9-]*$/);
  assert.deepEqual(labsFrom({ DRIVE_LABS: 'a-lab, b-lab' }), ['a-lab', 'b-lab']);
  assert.deepEqual(labsFrom({ DRIVE_LABS: 'ok,../etc,http://evil.example,UPPER,a/b,x y' }), ['ok']);
});

test('driver: DRIVE_BASE must be https on the lab-proxy name, nothing else', () => {
  assert.equal(baseFrom({}), 'https://local.ping-devops.com:8443');
  assert.equal(baseFrom({ DRIVE_BASE: 'https://local.ping-devops.com' }), 'https://local.ping-devops.com');
  for (const bad of ['http://local.ping-devops.com:8443', 'https://evil.example', 'https://local.ping-devops.com.evil.example', 'https://x@evil.example/']) {
    assert.throws(() => baseFrom({ DRIVE_BASE: bad }), /DRIVE_BASE/, bad);
  }
});

test('driver: drive.mjs sends no POST, fills nothing and never leaves the base URL', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../driver/drive.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.post\(|method:\s*['"]POST|\.fill\(|\.type\(|\.press\(/i);
  assert.match(src, /baseFrom\(\)/);
});
