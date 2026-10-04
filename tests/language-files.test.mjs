import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, parseLanguageFiles, serializeCatalog, renameToken, APOSTROPHES } from '../lib/catalog.mjs';
import { report, syncLock, markCurrent } from '../lib/lock.mjs';
import { compileCatalog } from '../lib/compiler.mjs';
import { createI18n } from '../lib/runtime.mjs';
const file = (name, text) => `# ${name}\n\n## greeting\n\nContext: Greeting.\n\n\`\`\`icu\n${text}\n\`\`\`\n`;
test('combines independent language files and formats custom language identifiers', () => {
  const files = { 'i18n-en.md': file('English', 'Hello, {name}!'), 'i18n-haw.md': file('ʻŌlelo Hawaiʻi', 'Aloha, {name}!'), 'i18n-pirate.md': file('Pirate', 'Ahoy, {name}!') };
  const catalog = parseLanguageFiles(files);
  const t = createI18n(compileCatalog(catalog));
  assert.equal(t('greeting', 'haw', { name: 'Alex' }), 'Aloha, Alex!');
  assert.equal(t('greeting', 'pirate', { name: 'Alex' }), 'Ahoy, Alex!');
  const markdown = serializeCatalog(catalog, { locale: 'haw' });
  assert.ok(!markdown.includes('---'));
  assert.equal(parseCatalog(markdown, { filename: 'i18n-haw.md' }).messages[0].translations.haw, 'Aloha, {name}!');
});
test('rejects absent source, extra/missing tokens, invalid placeholders, and duplicate language files', () => {
  const en = file('English', 'Hello, {name}!');
  assert.equal(parseLanguageFiles({ 'i18n-it.md': file('Italiano', 'Ciao') }).source, 'it');
  assert.equal(parseLanguageFiles({ 'i18n-haw.md': file('Hawaiian', 'Aloha'), 'i18n-it.md': file('Italiano', 'Ciao') }, { source: 'it' }).source, 'it');
  assert.throws(() => parseLanguageFiles({ 'i18n-haw.md': file('Hawaiian', 'Aloha') }, { source: 'en' }), /source file/);
  assert.throws(() => parseLanguageFiles({ 'i18n-en.md': en, 'i18n-fr.md': file('French', 'Bonjour') }, { strict: true }), /missing \{name\}/);
  assert.throws(() => parseLanguageFiles({ 'i18n-en.md': en, 'i18n-fr.md': file('French', 'Bonjour {other}') }, { strict: true }), /missing|unknown/);
  assert.match(parseLanguageFiles({ 'i18n-en.md': en, 'i18n-fr.md': file('French', 'Bonjour') }).warnings.join('\n'), /greeting \[fr\]: missing \{name\}; using the en text/);
  const wrong = { 'i18n-en.md': en, 'i18n-fr.md': file('French', 'Bonjour {name}').replace('## greeting', '## wrong') };
  assert.throws(() => parseLanguageFiles(wrong, { strict: true }), /unknown token/);
  assert.match(parseLanguageFiles(wrong).warnings.join('\n'), /wrong is not in en[\s\S]*1 token missing/);
  assert.throws(() => parseLanguageFiles({ 'i18n-en.md': en, 'i18n-en.md ': en }), /Name language files/);
  assert.equal(parseLanguageFiles({ 'i18n-en.md': en, 'a/i18n-en.md': en }).messages[1].key, 'a.greeting');
  assert.throws(() => parseLanguageFiles({ 'i18n-en.md': en.replace('## greeting', '## a.greeting'), 'a/i18n-en.md': en }), /a\.greeting is defined in both \.\/ and a\//);
});
test('preserves fenced content, whitespace and Unicode in independent files', () => {
  const message = 'ʻŌlelo Hawaiʻi\n```js\n## inside a message\n```\n';
  const catalog = parseLanguageFiles({ 'i18n-en.md': file('English', 'Hello') });
  catalog.messages[0].translations.en = message;
  const markdown = serializeCatalog(catalog, { locale: 'en' });
  assert.equal(parseCatalog(markdown, { filename: 'i18n-en.md' }).messages[0].translations.en, message);
});

test('the lock marks translations stale when the source changes, and accepts edited translations', () => {
  const two = (a, b) => `# X\n\n## a\n\n\`\`\`icu\n${a}\n\`\`\`\n` + (b ? `\n## b\n\n\`\`\`icu\n${b}\n\`\`\`\n` : '');
  const lock = { translations: {} };
  let catalog = parseLanguageFiles({ 'i18n-en.md': two('Hi {name}', 'Bye'), 'i18n-fr.md': two('Salut {name}') }, { source: 'en' });
  assert.deepEqual(syncLock(catalog, lock), []);
  assert.equal(lock.source, 'en');
  assert.deepEqual(report(catalog, lock).map(r => [r.done, r.missing, r.stale]), [[1, ['b'], []]]);
  catalog = parseLanguageFiles({ 'i18n-en.md': two('Hello {name}', 'Bye'), 'i18n-fr.md': two('Salut {name}') }, { source: 'en' });
  assert.deepEqual(report(catalog, lock)[0].stale, ['a']);
  assert.deepEqual(syncLock(catalog, lock), ['fr: a is stale; its source text changed']);
  assert.deepEqual(report(catalog, lock)[0].stale, ['a']);
  catalog = parseLanguageFiles({ 'i18n-en.md': two('Hello {name}', 'Bye'), 'i18n-fr.md': two('Bonjour {name}') }, { source: 'en' });
  assert.deepEqual(report(catalog, lock)[0].stale, []);
  assert.match(syncLock(catalog, lock)[0], /fr: a accepted/);
  // An outdated translation that lacks a new placeholder falls back but is kept on disk.
  catalog = parseLanguageFiles({ 'i18n-en.md': two('Hello {name} from {city}', 'Bye'), 'i18n-fr.md': two('Bonjour {name}') }, { source: 'en' });
  assert.equal(catalog.messages[0].translations.fr, undefined);
  assert.deepEqual(report(catalog, lock)[0].stale, ['a']);
  assert.match(serializeCatalog(catalog, { locale: 'fr' }), /Bonjour \{name\}/);
  assert.match(catalog.warnings.join('\n'), /missing \{city\}; using the en text/);
  catalog.messages[0].translations.fr = 'Bonjour {name} de {city}';
  markCurrent(catalog, lock, 'fr', catalog.messages[0]);
  assert.deepEqual(report(catalog, lock)[0].stale, []);
  // Markdown stays free of bookkeeping; older Status/Source lines are ignored.
  assert.doesNotMatch(serializeCatalog(catalog, { locale: 'fr' }), /Status|Source/);
  assert.equal(parseCatalog('# Français\n\n## a\n\nStatus: stale\nSource: abc\n\n```icu\nSalut\n```\n', { filename: 'i18n-fr.md' }).messages[0].translations.fr, 'Salut');
});
test('joined files round-trip, and rename keeps translations', () => {
  const catalog = parseLanguageFiles({ 'i18n-en.md': file('English', 'Hello, {name}!'), 'i18n-fr.md': file('Français', 'Bonjour, {name} !') }, { source: 'en' });
  const back = parseCatalog(serializeCatalog(catalog));
  assert.equal(serializeCatalog(back, { locale: 'fr' }), serializeCatalog(catalog, { locale: 'fr' }));
  renameToken(back, 'greeting', 'welcome');
  assert.equal(parseCatalog(serializeCatalog(back)).messages[0].key, 'welcome');
  assert.throws(() => renameToken(back, 'welcome', 'bad token'), /Invalid token/);
});

test('divisions namespace their tokens and write back in place', () => {
  const one = (name, key, text) => `# ${name}\n\n## ${key}\n\n\`\`\`icu\n${text}\n\`\`\`\n`;
  const files = {
    'ui/i18n-en.md': one('English', 'save', 'Save'), 'ui/i18n-fr.md': one('Français', 'save', 'Enregistrer'),
    'marketing/i18n-en.md': one('English', 'hero', 'Ship faster'),
    'marketing/landing/i18n-en.md': one('English', 'save', 'Save 20%'),
    'knowledge-hub/i18n-en.md': one('English', 'search', 'Search articles'), 'knowledge-hub/i18n-fr.md': one('Français', 'hero', 'Livrez plus vite'),
  };
  const catalog = parseLanguageFiles(files);
  assert.deepEqual(Object.fromEntries(catalog.messages.map(m => [m.key, m.division])), { 'knowledge-hub.search': 'knowledge-hub', 'marketing.hero': 'marketing', 'marketing.landing.save': 'marketing/landing', 'ui.save': 'ui' });
  assert.match(catalog.warnings.join('\n'), /knowledge-hub\/fr: knowledge-hub\.hero is not in en/);
  assert.match(catalog.warnings.join('\n'), /marketing\/fr: 1 token missing/);
  assert.throws(() => parseLanguageFiles(files, { strict: true }), /unknown token knowledge-hub\.hero/);
  assert.throws(() => parseLanguageFiles({ 'docs v2/i18n-en.md': files['ui/i18n-en.md'] }), /Name division directories/);
  assert.throws(() => parseLanguageFiles({ 'ui/i18n-en.md': files['ui/i18n-en.md'], 'docs/i18n-fr.md': files['ui/i18n-fr.md'] }), /Include docs\/i18n-en.md/);
  const t = createI18n(compileCatalog(catalog));
  assert.equal(t('ui.save', 'fr'), 'Enregistrer');
  assert.equal(t('marketing.landing.save', 'fr'), 'Save 20%');
  // A division read on its own keeps its full token names.
  assert.equal(parseLanguageFiles({ 'i18n-en.md': files['ui/i18n-en.md'] }, { prefix: 'ui' }).messages[0].key, 'ui.save');
  const lock = { translations: {} };
  syncLock(catalog, lock);
  syncLock(parseLanguageFiles({ 'i18n-en.md': files['marketing/i18n-en.md'] }, { prefix: 'marketing' }), lock, { partial: true });
  assert.ok(lock.translations.fr['ui.save'], 'a partial sync keeps other divisions');
});
test('division directories map to properties, and reserved or clashing names are refused', async () => {
  const { accessorFor } = await import('../lib/catalog.mjs');
  const { generateModule } = await import('../lib/compiler.mjs');
  assert.equal(accessorFor('knowledge-hub.faq.'), '.knowledgeHub.faq');
  const one = key => `# English\n\n## ${key}\n\n\`\`\`icu\nX\n\`\`\`\n`;
  assert.throws(() => parseLanguageFiles({ 'name/i18n-en.md': one('a') }), /cannot be called name/);
  assert.throws(() => parseLanguageFiles({ 'in/i18n-en.md': one('a') }), /cannot be called in/);
  assert.throws(() => generateModule(parseLanguageFiles({ 'a-b/i18n-en.md': one('x'), 'a_b/i18n-en.md': one('y') })), /a-b and a_b would both be i18nmd\.aB/);
});
test('an optional placeholder may be absent from a translation file read on its own', () => {
  const it = '# Italiano\n\n' + APOSTROPHES + '\n\n## guess\n\nOptional: a\n\n```icu\nImmagino {size}\n```\n';
  const parsed = parseCatalog(it, { filename: 'i18n-it.md' });
  assert.equal(serializeCatalog(parsed, { locale: 'it' }), it);
  const en = '# English\n\n## guess\n\nOptional: a\n\n```icu\nI guess {a} {size}\n```\n';
  assert.equal(parseLanguageFiles({ 'i18n-en.md': en, 'i18n-it.md': it }, { strict: true }).messages[0].translations.it, 'Immagino {size}');
  assert.throws(() => parseLanguageFiles({ 'i18n-en.md': en.replace('{a} ', ''), 'i18n-it.md': it }), /optional \{a\} is absent from the source/);
});
test('a hand edit made before the source changed does not hide the change', () => {
  const one = text => `# X\n\n## a\n\n\`\`\`icu\n${text}\n\`\`\`\n`;
  const at = (en, fr) => parseLanguageFiles({ 'i18n-en.md': one(en), 'i18n-fr.md': one(fr) }, { source: 'en' });
  const lock = { translations: {} };
  syncLock(at('Hello', 'Salut'), lock);
  // Someone corrects the French, then the English changes, all before the next sync.
  let catalog = at('Hello there', 'Bonjour');
  assert.deepEqual(report(catalog, lock)[0].stale, ['a'], 'both changed: the order is unknown, so it needs review');
  assert.deepEqual(syncLock(catalog, lock), ['fr: a is stale; its source text changed. Its translation was edited too; if that was for the new text, run i18nmd accept a --only fr']);
  assert.deepEqual(syncLock(catalog, lock), [], 'a repeated sync reports nothing new');
  assert.deepEqual(report(catalog, lock)[0].stale, ['a'], 'still stale until the translation is edited');
  // Now the translator updates it for the new English: accepted.
  catalog = at('Hello there', 'Bonjour à toi');
  assert.deepEqual(report(catalog, lock)[0].stale, []);
  assert.match(syncLock(catalog, lock)[0], /fr: a accepted/);
  assert.equal(lock.translations.fr.a.split(':').length, 2, 'accepted entries go back to source:translation');
  // The English changes again before that edit is synced: stale again.
  assert.deepEqual(report(at('Hi there', 'Bonjour à toi'), lock)[0].stale, ['a']);
  // Entries written by 0.1 (no third part) still work.
  const old = { translations: { fr: { a: lock.translations.fr.a } } };
  assert.deepEqual(report(at('Hi there', 'Bonjour à toi'), old)[0].stale, ['a']);
});
