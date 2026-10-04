import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { compileCatalog, generateModule, validateCatalog } from '../lib/index.mjs';
import { parseMessage } from '../lib/messages.mjs';
import { createI18n } from '../lib/runtime.mjs';

const cli = fileURLToPath(new URL('../bin/i18nmd.mjs', import.meta.url));
const catalog = (en, fr, formatters = ['length']) => ({ title: 'T', source: 'en', syntax: 'icu', formatters, languages: { en: 'English', fr: 'Français' },
  messages: [{ key: 'cut', context: '', optional: [], translations: { en, ...(fr && { fr }) } }] });
// The same formatter in both runtimes: inches to the nearest 1/16 in English, millimetres otherwise.
const inches = (value, language) => {
  if (language !== 'en') return `${Math.round(value * 25.4)} mm`;
  const sixteenths = Math.round(value * 16), whole = Math.floor(sixteenths / 16);
  let n = sixteenths % 16, d = 16;
  while (n && n % 2 === 0) { n /= 2; d /= 2; }
  return `${whole || !n ? whole : ''}${whole && n ? '-' : ''}${n ? `${n}/${d}` : ''}"`;
};
const pythonInches = `def inches(value, language):
    if language != "en":
        return f"{round(value * 25.4 + 1e-9)} mm"
    sixteenths = int(value * 16 + 0.5)
    whole, n, d = sixteenths // 16, sixteenths % 16, 16
    while n and n % 2 == 0:
        n, d = n // 2, d // 2
    return f"{whole if whole or not n else ''}{'-' if whole and n else ''}{f'{n}/{d}' if n else ''}\\""`;

test('declared formatters parse; undeclared ones are rejected with a hint', () => {
  assert.deepEqual(parseMessage('Cut {len, length}.', 'icu', ['length']), ['Cut ', { type: 'format', name: 'len', format: 'length' }, '.']);
  assert.throws(() => parseMessage('Cut {len, length}.'), /Unsupported message type length \(declare app formatters in i18nmd.lock.json: "formatters": \["length"\]\)/);
  assert.throws(() => validateCatalog(catalog('Cut {len, length}.', undefined, [])), /Unsupported message type length/);
  assert.throws(() => validateCatalog(catalog('Hi', undefined, ['plural'])), /Formatter names/);
});

test('translators may move a formatted placeholder but not change its type', () => {
  assert.doesNotThrow(() => validateCatalog(catalog('Cut {len, length} from {n, plural, one {# board} other {# boards}}.', 'Coupez {n, plural, one {# planche} other {# planches}} à {len, length}.')));
  assert.doesNotThrow(() => validateCatalog(catalog('{len, length} {len, plural, one {cut} other {cuts}}', '{len, plural, one {coupe} other {coupes}} de {len, length}')));
  assert.throws(() => validateCatalog(catalog('Cut {len, length}.', 'Coupez {len}.')), /incompatible type for \{len\}/);
  assert.throws(() => validateCatalog(catalog('Cut {len, length}.', 'Coupez {len, number}.')), /incompatible type for \{len\}/);
  assert.throws(() => validateCatalog(catalog('Cut {len}.', 'Coupez {len, length}.')), /incompatible type for \{len\}/);
  const lenient = validateCatalog(catalog('Cut {len, length}.', 'Coupez {len}.'), { lenient: true });
  assert.match(lenient.warnings[0], /incompatible type for \{len\}; using the en text/);
});

test('the JavaScript runtime calls app formatters and degrades without them', () => {
  const errors = [];
  const formatters = {};
  const t = createI18n(compileCatalog(catalog('Cut {len, length}.', 'Coupez à {len, length}.')), { formatters, onError: e => errors.push(e.message) });
  assert.equal(t('cut', 'en', { len: 1.5 }), 'Cut 1.5.');
  assert.match(errors.pop(), /No formatter for \{len, length\}/);
  formatters.length = inches;
  assert.equal(t('cut', 'en', { len: 1.5 }), 'Cut 1-1/2".');
  assert.equal(t('cut', 'fr', { len: 1.5 }), 'Coupez à 38 mm.');
  formatters.length = () => { throw new Error('bad length'); };
  assert.equal(t('cut', 'en', { len: 2 }), 'Cut 2.');
  assert.equal(errors.pop(), 'bad length');
  assert.equal(t('cut', 'en', {}), 'Cut {len}.');
  assert.match(errors.pop(), /Missing value for \{len\}/);
});

test('Python registers formatters by name and renders like JavaScript', async t => {
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 is not installed');
  const c = catalog('Cut {n, plural, one {# board} other {# boards}} to {len, length}.', 'Coupez {n, plural, one {# planche} other {# planches}} à {len, length}.');
  const js = createI18n(compileCatalog(c), { formatters: { length: inches } });
  const cases = [['en', 1, 0.75], ['en', 2, 1.5], ['en', 3, 96.125], ['fr', 1.5, 3.5], ['fr', 2, 12]];
  const dir = await mkdtemp(path.join(tmpdir(), 'i18nmd-formatters-'));
  try {
    await writeFile(path.join(dir, 'i18n.py'), generateModule(c, 'python'));
    const run = spawnSync('python3', ['-c', `import json, logging\nfrom i18n import i18nmd, register_formatter\nlogging.disable()\nprint(json.dumps(i18nmd("cut", "en", n=1, len=2)))\n${pythonInches}\nregister_formatter("length", inches)\nprint(json.dumps([i18nmd("cut", l, n=n, len=v) for l, n, v in ${JSON.stringify(cases)}]))`], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const [unregistered, rendered] = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(unregistered, 'Cut 1 board to 2.');
    assert.deepEqual(rendered, cases.map(([l, n, len]) => js('cut', l, { n, len })));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the lock declares formatters for check and compile, and generated code registers them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-formatters-cli-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    await mkdir(path.join(root, 'translations'));
    await writeFile(path.join(root, 'translations/i18n-en.md'), '# Translations\n\nLanguage: English\n\n## cut\n\nContext: len is a length; the app writes its units.\n\n```icu\nCut the board to {len, length}.\n```\n');
    let result = run('check');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /declare app formatters in i18nmd.lock.json/);
    await writeFile(path.join(root, 'translations/i18nmd.lock.json'), JSON.stringify({ source: 'en', formatters: ['length'], translations: {} }));
    result = run('check');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(run('sync').status, 0);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'translations/i18nmd.lock.json'), 'utf8')).formatters, ['length'], 'sync keeps the declaration');
    result = run('compile', '--target', 'js', '--out', 'generated');
    assert.equal(result.status, 0, result.stderr);
    result = run('compile', '--out', 'typed');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(root, 'typed/i18n.ts'), 'utf8'), /export function registerFormatter\(name: "length", format: \(value: any, language: Language\) => string\)/);
    const { i18nmd, registerFormatter } = await import(pathToFileURL(path.join(root, 'generated/i18n.mjs')));
    registerFormatter('length', inches);
    assert.equal(i18nmd('cut', { len: 8.25 }), 'Cut the board to 8-1/4".');
  } finally { await rm(root, { recursive: true, force: true }); }
});
