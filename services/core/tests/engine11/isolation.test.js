import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modules = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../logic/engine11/rawCandles');
test('isolated modules import only builtins and their own modules', async () => {
  for (const file of await fs.readdir(modules)) {
    if (!file.endsWith('.js')) continue;
    const content = await fs.readFile(path.join(modules, file), 'utf8');
    for (const match of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('node:') || /^\.\/[A-Za-z]+\.js$/.test(match[1]), file + ' imports external consumer');
    assert.ok(!/process\.env|setInterval\(|from\s+['"]express|writeReplaySnapshot\(|buildStrategySnapshot\(/.test(content), file);
  }
});
test('importing isolated provider does not invoke fetch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw Error('import performed network I/O'); };
  try { await import('../../logic/engine11/rawCandles/provider.js'); } finally { globalThis.fetch = original; }
});
