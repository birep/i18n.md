import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, serializeCatalog, validateCatalog } from '../lib/catalog.mjs';
import { compileCatalog, generateModule, generateModules, runtimeTypes } from '../lib/compiler.mjs';
import { createI18n } from '../lib/runtime.mjs';
import { parseMessage } from '../lib/messages.mjs';

function catalog(en, fr = en, extras = {}) {
  return { title: 'Example', source: 'en', syntax: 'icu', languages: { en: 'English', fr: 'French' }, messages: [{ key: 'example', context: 'An example', optional: [], translations: { en, fr }, ...extras }] };
}
const translate = c => createI18n(compileCatalog(c), { onError: error => { throw error; } });

test('Markdown round trips Unicode, code fences, headings, and newlines', () => {
  const c = catalog('Aloha 🌺\n\n## still text\n```\nʻŌlelo Hawaiʻi\n');
  assert.deepEqual(parseCatalog(serializeCatalog(c)).messages[0].translations.en, c.messages[0].translations.en);
});
test('checks all languages and required variables before compiling', () => {
  assert.throws(() => validateCatalog(catalog('Hello {name}', 'Bonjour')), /missing \{name\}/);
  assert.throws(() => validateCatalog(catalog('Hello', 'Bonjour {name}')), /unknown placeholder/);
  assert.throws(() => validateCatalog(catalog('Hello {a}', 'Bonjour', { optional: ['unknown'] })), /optional/);
  assert.doesNotThrow(() => validateCatalog(catalog('{a} board', 'une planche', { optional: ['a'] })));
  const c = catalog('Hello'); delete c.messages[0].translations.fr;
  assert.throws(() => validateCatalog(structuredClone(c)), /missing fr/);
  assert.equal(createI18n(compileCatalog(c))('example', 'fr'), 'Hello');
  const text = serializeCatalog(c, { allowIncomplete: true });
  assert.throws(() => parseCatalog(text), /missing fr/);
  assert.doesNotThrow(() => parseCatalog(text, { allowIncomplete: true }));
});
test('rejects duplicate tokens, locales, bad locale tags, and malformed syntax', () => {
  const c = catalog('Hello'); c.messages.push({ ...c.messages[0] });
  assert.throws(() => validateCatalog(c), /Duplicate token/);
  assert.throws(() => parseMessage('{count, plural, one {One}}'), /other branch/);
  assert.throws(() => parseMessage('{count, plural, other {x} other {y}}'), /Duplicate branch/);
  assert.throws(() => parseMessage('{x, number, imaginary}'), /Unsupported number/);
  assert.throws(() => parseMessage('{x, unknown}'), /Unsupported message/);
  assert.throws(() => parseCatalog(serializeCatalog(catalog('hello')).replace('```fr', '```en')), /Duplicate en/);
});
test('formats plural, ordinal, offset, nested selects, and localized numbers', () => {
  const t = translate(catalog('{count, plural, =0 {No boards} one {# board} other {# boards}}', '{count, plural, =0 {Aucune planche} one {# planche} other {# planches}}'));
  assert.equal(t('example', 'en', { count: 0 }), 'No boards');
  assert.equal(t('example', 'en', { count: 1 }), '1 board');
  assert.equal(t('example', 'fr', { count: 2 }), '2 planches');
  const ordinal = translate(catalog('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}'));
  assert.equal(ordinal('example', 'en', { n: 22 }), '22nd');
  const offset = translate(catalog('{n, plural, offset:1 =1 {Just you} one {You and one other} other {You and # others}}'));
  assert.equal(offset('example', 'en', { n: 4 }), 'You and 3 others');
  const formal = translate(catalog('{tone, select, formal {Hello {name}} other {Hi {name}}}'));
  assert.equal(formal('example', 'en', { name: 'Taylor', tone: 'formal' }), 'Hello Taylor');
  const nested = translate(catalog('{n, plural, other {{tone, select, formal {# boards, sir} other {# boards}}}}'));
  assert.equal(nested('example', 'en', { n: 4, tone: 'formal' }), '4 boards, sir');
  const money = translate(catalog('{n, number, ::currency/USD}'));
  assert.equal(money('example', 'en', { n: 1234.5 }), new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(1234.5));
});
test('ordinary apostrophes, ICU quoting, and Python escaped braces', () => {
  assert.equal(translate(catalog("I'm Alex. '{name}' and ''"))('example', 'en'), "I'm Alex. {name} and '");
  const c = { ...catalog("I'm {name}: {{literal}}"), syntax: 'python' };
  assert.equal(translate(c)('example', 'en', { name: 'Alex' }), "I'm Alex: {literal}");
});
test('uses language and source fallbacks; rejects bad tokens and missing arguments', () => {
  const t = translate(catalog('Hi {name}', 'Salut {name}'));
  assert.equal(t('example', 'fr-CA', { name: 'Taylor' }), 'Salut Taylor');
  assert.equal(t('example', 'de', { name: 'Taylor' }), 'Hi Taylor');
  assert.throws(() => t('example', 'en'), /Missing value/);
  assert.equal(t('example', 'en', { name: null }), 'Hi ');
  assert.throws(() => t('unknown', 'en'), /Unknown translation/);
  assert.throws(() => t('toString', 'en'), /Unknown translation/);
  assert.throws(() => translate(catalog('{n, number}'))('example', 'en', { n: 'x' }), /finite number/);
});
test('generates token and argument types, and ICU for Python', () => {
  const module = generateModule(catalog('{n, plural, other {# boards}}'));
  assert.match(module, /"n": number/);
  const files = generateModules(catalog('x'));
  assert.deepEqual(Object.keys(files).sort(), ['i18n.ts', 'language.d.mts', 'language.mjs', 'languages/fr.mjs']);
  assert.match(files['language.d.mts'], /export type Language = "en" \| "fr"/);
  assert.match(files['language.mjs'], /"fr": \(\) => import\("\.\/languages\/fr\.mjs"\)/);
  assert.match(module, /export \{ languages \} from "\.\/language\.mjs"/);
  assert.match(generateModule(catalog('Hi'), 'python'), /^def i18nmd\(token: str, language: str \| None = None, \*\*values: Any\) -> str:/m);
});

test('rich-text tags render through functions, nest in plurals, and are type-checked', () => {
  const t = translate(catalog('Read <b>the {doc}</b> first.', 'Lisez <b>le {doc}</b> d’abord.'));
  assert.deepEqual(t('example', 'fr', { doc: 'guide', b: chunks => ({ bold: chunks }) }), ['Lisez ', { bold: ['le guide'] }, ' d’abord.']);
  assert.equal(t('example', 'en', { doc: 'guide', b: chunks => `*${chunks.join('')}*` }), 'Read *the guide* first.');
  const plural = translate(catalog('{n, plural, one {<b>#</b> file} other {<b>#</b> files}}'));
  assert.deepEqual(plural('example', 'en', { n: 3, b: c => c[0] + '!' }), '3! files');
  assert.equal(translate(catalog("a '<b>' tag and 1 < 2"))('example', 'en'), 'a <b> tag and 1 < 2');
  assert.throws(() => validateCatalog(catalog('<b>Hi</b>', 'Salut')), /missing <b>/);
  assert.throws(() => parseMessage('<b>Hi</i>'), /Unexpected <\/i>|Unclosed/);
  assert.throws(() => parseMessage('<b>Hi'), /Unclosed <b>/);
  assert.match(generateModule(catalog('<b>Hi</b>')), /"b": \(chunks: Any\[\]\) => Any[\s\S]*RichToken = "example"/);
});
test('degrades instead of crashing by default', () => {
  const errors = [];
  const t = createI18n(compileCatalog(catalog('Hi {name}')), { onError: e => errors.push(e.message) });
  assert.equal(t('missing_token', 'en'), 'missing_token');
  assert.equal(t('example', 'en'), 'Hi {name}');
  assert.equal(errors.length, 2);
  assert.equal(t.has('example'), true);
  assert.equal(t.has('missing_token'), false);
  assert.equal(t.has('__proto__'), false);
  assert.equal(errors.length, 2, 'has() reports nothing');
});

test('the generated translator follows the current language, loads languages, and exposes divisions', async () => {
  const { createTranslator, createLanguage } = await import('../lib/runtime.mjs');
  const loads = [];
  const errors = [];
  const language = createLanguage({ en: 'English', 'pt-BR': 'Português' }, 'en', {
    divisions: ['ui', 'kb/faq'], onError: e => errors.push(e.message),
    load: async code => { loads.push(code); return { 'ui.save': ['Salvar'] }; } });
  language.store.add({ top: ['Top'], 'kb.faq.q': ['Question'] });
  const i18nmd = createTranslator(language, { ui: ['ui', {}], kb: ['kb', { faq: ['faq', {}] }] }, { onError: e => errors.push(e.message) });
  assert.equal(await language.ready, 'en');
  assert.equal(i18nmd.ui('save'), 'ui.save');
  assert.match(errors.pop(), /ui\.save is in the ui division, which this page has not imported/);
  language.store.add({ 'ui.save': ['Save'] });
  assert.equal(i18nmd.ui('save'), 'Save');
  const seen = [];
  const stop = language.onLanguageChange(code => seen.push(code));
  const switching = language.setLanguage('pt');
  assert.equal(language.getLanguage(), 'en', 'the switch waits for the language to load');
  assert.equal(await switching, 'pt-BR');
  assert.equal(i18nmd.ui('save'), 'Salvar');
  assert.equal(i18nmd.kb.faq('q'), 'Question');
  assert.equal(i18nmd('top'), 'Top');
  assert.equal(i18nmd.in('en').ui('save'), 'Save');
  assert.deepEqual([i18nmd.has('top'), i18nmd.has('ui.save'), i18nmd.ui.has('save'), i18nmd.kb.faq.has('q'), i18nmd.ui.has('later'), i18nmd.in('pt-BR').ui.has('save')], [true, true, true, true, false, true]);
  stop(); await language.setLanguage('en'); await language.setLanguage('pt-BR');
  assert.deepEqual(seen, ['pt-BR']);
  assert.deepEqual(loads, ['pt-BR'], 'each language loads once');
  assert.equal(await language.setLanguage('xx'), 'pt-BR');
  assert.match(errors.pop(), /Unknown language: xx/);
  assert.deepEqual(Object.keys(i18nmd), ['ui', 'kb']);
});

test('the Python target formats ICU plurals, ordinals and selects without dependencies', async t => {
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 is not installed');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const compiled = { title: 'T', source: 'en', syntax: 'icu', languages: { en: 'English', pl: 'Polski' }, messages: [
    { key: 'chat.parts', context: '', optional: [], translations: { en: '{n, plural, =0 {no parts} one {# part} other {# parts}} for {who}, {k, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}', pl: '{n, plural, one {# część} few {# części} many {# częściM} other {# częściO}} dla {who}, {k}' } },
    { key: 'pick', context: '', optional: [], translations: { en: "{x, select, a {Alpha} other {Other}} isn't {y}" } } ] };
  const dir = await mkdtemp(path.join(tmpdir(), 'i18nmd-py-'));
  try {
    await writeFile(path.join(dir, 'i18n.py'), generateModule(compiled, 'python'));
    const run = spawnSync('python3', ['-c', `from i18n import i18nmd
print(i18nmd("chat.parts", "en", n=0, who="Al", k=22)); print(i18nmd("chat.parts", "en-GB", n="1", who="Al", k=112))
print(i18nmd("chat.parts", "pl", n=22, who=None, k=1)); print(i18nmd("chat.parts", "pl", n=25, who="A", k=1))
print(i18nmd("pick", "fr", x="a", y=None))
from i18n import template, TOKENS, has
print(template("chat.parts", "en"), sorted(TOKENS), has("pick"), has("later"))`], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.replace(/\n$/, '').split('\n'), ['no parts for Al, 22nd', '1 part for Al, 112th', '22 części dla , 1', '25 częściM dla A, 1', "Alpha isn't ", "{n} for {who}, {k} ['chat.parts', 'pick'] True False"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the Python target writes numbers the way each language does', async t => {
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 is not installed');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const languages = ['en', 'de', 'fr', 'es', 'hi'];
  const text = '{v, number} | {p, number, percent} | {c, plural, other {# x}}';
  const compiled = { title: 'T', source: 'en', syntax: 'icu', languages: Object.fromEntries(languages.map(l => [l, l])), messages: [{ key: 'n', context: '', optional: [], translations: Object.fromEntries(languages.map(l => [l, text])) }] };
  const cases = [[1234567.891, 0.256, 12345], [1234, 0.5, 1], [-9876.5, -0.07, 1000000]];
  const dir = await mkdtemp(path.join(tmpdir(), 'i18nmd-py-numbers-'));
  try {
    await writeFile(path.join(dir, 'i18n.py'), generateModule(compiled, 'python'));
    const run = spawnSync('python3', ['-c', `from i18n import i18nmd\nfor l in ${JSON.stringify(languages)}:\n  for v, p, c in ${JSON.stringify(cases)}: print(i18nmd("n", l, v=v, p=p, c=c))`], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const expected = languages.flatMap(l => cases.map(([v, p, c]) => `${new Intl.NumberFormat(l).format(v)} | ${new Intl.NumberFormat(l, { style: 'percent' }).format(p)} | ${new Intl.NumberFormat(l).format(c)} x`));
    assert.deepEqual(run.stdout.replace(/\n$/, '').split('\n'), expected);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('generated Python shows tags in template() and passes mypy --strict and ruff when installed', async t => {
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('python3 is not installed');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'i18nmd-py-'));
  try {
    await writeFile(path.join(dir, 'i18n.py'), generateModule(catalog('Hi <b>{name}</b>, {n, plural, one {# cut} other {# cuts}} {p, number, percent}'), 'python'));
    await writeFile(path.join(dir, 'plain.py'), generateModule({ ...catalog('Hi {name}'), syntax: 'python' }, 'python'));
    const run = spawnSync('python3', ['-c', 'from i18n import template\nprint(template("example"))'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'Hi <b>{name}</b>, {n} {p}\n');
    for (const [tool, args] of [['mypy', ['--strict', 'i18n.py', 'plain.py']], ['ruff', ['check', 'i18n.py', 'plain.py']]]) {
      if (spawnSync(tool, ['--version']).status !== 0) { t.diagnostic(`${tool} is not installed; skipped`); continue; }
      const result = spawnSync(tool, args, { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('generated JavaScript and TypeScript carry no lint directives', () => {
  for (const target of ['ts', 'js']) {
    for (const [name, text] of Object.entries(generateModules({ ...catalog('Hi <b>x</b>'), formatters: [] }, { target }))) assert.doesNotMatch(text, /eslint/, `${target} ${name}`);
  }
  assert.doesNotMatch(runtimeTypes, /eslint|\bany\b/);
});

test('placeholders take elements, and {x, list} joins lists for each language', () => {
  const link = { type: 'a', props: { children: 'Claude' } };
  const c = { title: 'T', source: 'en', syntax: 'icu', languages: { en: 'English', es: 'Español' }, messages: [
    { key: 'pitch', context: '', optional: [], translations: { en: 'Paired with {models}, it builds.', es: 'Con {models}, construye.' } },
    { key: 'with', context: '', optional: [], translations: { en: 'Works with {names, list, disjunction}.', es: 'Funciona con {names, list, disjunction}.' } },
    { key: 'all', context: '', optional: [], translations: { en: '{names, list}', es: '{names, list}' } }] };
  const t = translate(c);
  assert.deepEqual(t('pitch', 'en', { models: link }), ['Paired with ', link, ', it builds.']);
  assert.equal(t('pitch', 'en', { models: 'Claude' }), 'Paired with Claude, it builds.');
  assert.equal(t('with', 'en', { names: ['Claude', 'GPT', 'Gemini'] }), 'Works with Claude, GPT, or Gemini.');
  assert.equal(t('with', 'es', { names: ['siete', 'ocho'] }), 'Funciona con siete u ocho.');
  assert.deepEqual(t('with', 'es', { names: [link, 'GPT'] }), ['Funciona con ', link, ' o GPT.']);
  assert.equal(t('all', 'en', { names: [] }), '');
  assert.throws(() => t('all', 'en', { names: 'Claude' }), /must be a list/);
  assert.throws(() => parseMessage('{x, list, sometimes}'), /Unsupported list style/);
  assert.throws(() => translate(catalog('{x, list}', '{x, number}')), /incompatible type/);
  assert.match(generateModule(catalog('{x, list} {y}', '{x, list} {y}')), /"x": readonly \(string \| number \| object\)\[\]; "y": string \| number \| null \| undefined \| object/);
});
