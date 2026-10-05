import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog } from '../lib/catalog.mjs';
import { translateLanguage } from '../lib/llm.mjs';

const source = '# English\n\n' + Array.from({ length: 6 }, (_, i) => `## m${i}\n\n\`\`\`icu\nMessage ${i}\n\`\`\`\n`).join('\n');
const reply = user => [...user.matchAll(/^## (\S+)/gm)].map(([, key]) => `## ${key}\n\n\`\`\`icu\n[fr] ${key}\n\`\`\`\n`).join('\n');

test('the whole file goes out in one request', async () => {
  const catalog = parseCatalog(source, { locale: 'en' });
  const calls = [];
  const chatImpl = async (_config, _system, user) => { calls.push(user); return reply(user); };
  const failed = await translateLanguage(catalog, { code: 'fr', name: 'Français' }, catalog.messages.map(m => m.key), {}, { chatImpl });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(failed), []);
});

test('a reply cut off by the output limit splits the file in halves', async () => {
  const catalog = parseCatalog(source, { locale: 'en' });
  const sizes = [];
  const chatImpl = async (_config, _system, user) => {
    const n = (user.match(/^## /gm) ?? []).length;
    sizes.push(n);
    if (n > 3) throw new Error('The reply was cut off; use a smaller --batch.');
    return reply(user);
  };
  const ok = {};
  await translateLanguage(catalog, { code: 'fr', name: 'Français' }, catalog.messages.map(m => m.key), {}, { chatImpl, onBatch: o => Object.assign(ok, o) });
  assert.deepEqual(sizes, [6, 3, 3]);
  assert.equal(Object.keys(ok).length, 6);
});

test('requests are sized to fit the output limit before anything is sent', async () => {
  const long = '# English\n\n' + Array.from({ length: 40 }, (_, i) => `## m${i}\n\n\`\`\`icu\n${'A long sentence of interface text. '.repeat(6)}\n\`\`\`\n`).join('\n');
  const catalog = parseCatalog(long, { locale: 'en' });
  const sizes = [];
  const chatImpl = async (_config, _system, user) => { sizes.push((user.match(/^## /gm) ?? []).length); return reply(user); };
  await translateLanguage(catalog, { code: 'fr', name: 'Français' }, catalog.messages.map(m => m.key), { maxOutput: 1000 }, { chatImpl });
  assert.ok(sizes.length > 1);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 40);
});
