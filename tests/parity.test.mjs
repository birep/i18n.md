// The contract between the two runtimes: the generated Python module renders
// every message byte for byte like the JavaScript runtime. Keep this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileCatalog, generateModule } from '../lib/index.mjs';
import { createI18n } from '../lib/runtime.mjs';

const languages = ['en', 'fr', 'de', 'it', 'es', 'pt', 'pt-PT', 'ru', 'pl', 'cs', 'lt', 'cy', 'ar', 'he', 'ja', 'hi', 'haw', 'ga', 'sl', 'mt'];
const values = [0, 1, 1.5, 2, 3, 5, 11, 12, 21, 22, 23, 101, 111, 1000, 1000000, 2000000, 1e21, 1.5e18, 999999999999999999, 123456789012345678901, 1e300, -1, -2.5, -21, 0.1, 0.25, 1.005, 1.0001, 1.0005, 2.0005, 3.14159, 22.5, 1234567.891, 0.07, 0.5, 2.5, 99.999, 0.001, 1.2, 10.5, 101.5, 1000000.5];
// Plus a fixed pseudo-random spread over magnitudes, signs and 0–4 decimals.
let seed = 42;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let k = 0; k < 120; k++) values.push(Number(((random() < 0.2 ? -1 : 1) * random() * 10 ** Math.floor(random() * 9)).toFixed(Math.floor(random() * 5))));
const messages = {
  cardinal: '{n, plural, =0 {zero!} =1.5 {one and a half!} zero {# zero} one {# one} two {# two} few {# few} many {# many} other {# other}}',
  offset: '{n, plural, offset:1 one {# one} few {# few} many {# many} other {# other}}',
  ordinal: '{n, selectordinal, zero {# zero} one {# one} two {# two} few {# few} many {# many} other {# other}}',
  number: '{n, number}',
  integer: '{n, number, integer}',
  percent: '{n, number, percent}',
  usd: '{n, number, ::currency/USD}',
  eur: '{n, number, ::currency/EUR}',
  jpy: '{n, number, ::currency/JPY}',
};

test('Python renders plurals, ordinals and numbers exactly like JavaScript', async t => {
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 is not installed');
  const catalog = { title: 'T', source: 'en', syntax: 'icu', languages: Object.fromEntries(languages.map(l => [l, l])),
    messages: Object.entries(messages).map(([key, text]) => ({ key, context: '', optional: [], translations: Object.fromEntries(languages.map(l => [l, text])) })) };
  const i18nmd = createI18n(compileCatalog(catalog), { onError: error => { throw error; } });
  const cases = languages.flatMap(l => Object.keys(messages).flatMap(key => values.map(n => [key, l, n])));
  const expected = cases.map(([key, l, n]) => i18nmd(key, l, { n }));
  const dir = await mkdtemp(path.join(tmpdir(), 'i18nmd-parity-'));
  try {
    await writeFile(path.join(dir, 'i18n.py'), generateModule(catalog, 'python'));
    await writeFile(path.join(dir, 'cases.json'), JSON.stringify(cases));
    const run = spawnSync('python3', ['-c', 'import json\nfrom i18n import i18nmd\nprint(json.dumps([i18nmd(k, l, n=n) for k, l, n in json.load(open("cases.json"))]))'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const actual = JSON.parse(run.stdout);
    const differences = cases.map((c, i) => [c, expected[i], actual[i]]).filter(([, js, py]) => js !== py);
    assert.deepEqual(differences.slice(0, 20).map(([[key, l, n], js, py]) => `${key} ${l} ${n}: JS ${JSON.stringify(js)}, Python ${JSON.stringify(py)}`), [], `${differences.length} of ${cases.length} differ`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Python joins lists exactly like Intl.ListFormat', async t => {
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 is not installed');
  const list = [...languages, 'zh', 'ko', 'th', 'es-419', 'he-IL'];
  const styles = { and: '{items, list}', or: '{items, list, disjunction}', unit: '{items, list, unit}' };
  const catalog = { title: 'T', source: 'en', syntax: 'icu', languages: Object.fromEntries(list.map(l => [l, l])),
    messages: Object.entries(styles).map(([key, text]) => ({ key, context: '', optional: [], translations: Object.fromEntries(list.map(l => [l, text])) })) };
  const i18nmd = createI18n(compileCatalog(catalog), { onError: error => { throw error; } });
  // Words that trigger ICU's contextual forms: Spanish y/e and o/u, Hebrew ו/ו-.
  const words = ['Ignacio', 'hielo', 'hiato', 'Hidalgo', 'hi', 'ocho', 'Hora', '8', '11', '11 gatos', '110', 'iOS', 'Íñigo', 'בית', 'B', '1', 'Claude', 'GPT'];
  const items = [[], ['Solo'], ...words.flatMap(w => [['A', w], ['A', 'B', w], ['A', w, 'C', 'D', w]])];
  const cases = list.flatMap(l => Object.keys(styles).flatMap(key => items.map(i => [key, l, i])));
  const expected = cases.map(([key, l, i]) => i18nmd(key, l, { items: i }));
  const dir = await mkdtemp(path.join(tmpdir(), 'i18nmd-parity-'));
  try {
    await writeFile(path.join(dir, 'i18n.py'), generateModule(catalog, 'python'));
    await writeFile(path.join(dir, 'cases.json'), JSON.stringify(cases));
    const run = spawnSync('python3', ['-c', 'import json\nfrom i18n import i18nmd\nprint(json.dumps([i18nmd(k, l, items=i) for k, l, i in json.load(open("cases.json"))]))'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const actual = JSON.parse(run.stdout);
    const differences = cases.map((c, i) => [c, expected[i], actual[i]]).filter(([, js, py]) => js !== py);
    assert.deepEqual(differences.slice(0, 20).map(([[key, l, i], js, py]) => `${key} ${l} ${JSON.stringify(i)}: JS ${JSON.stringify(js)}, Python ${JSON.stringify(py)}`), [], `${differences.length} of ${cases.length} differ`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
