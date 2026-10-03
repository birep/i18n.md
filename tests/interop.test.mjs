import test from 'node:test';
import assert from 'node:assert/strict';
import { importMessages, exportMessages } from '../lib/interop.mjs';
import { resolveLanguage, topLanguages } from '../lib/languages.mjs';
import { readReply } from '../lib/llm.mjs';

const catalogOf = (messages, locale = 'en') => ({ source: locale, syntax: 'icu', languages: { [locale]: 'x' }, messages: messages.map(m => ({ key: m.key, context: m.context, optional: [], translations: { [locale]: m.text } })) });

test('i18next JSON converts to ICU and back', () => {
  const json = { nav: { home: 'Home', hi: "Hi {{name}}, it's {raw}" }, cart_one: '{{count}} item', cart_other: '{{count}} items', old: 'One file', old_plural: '{{count}} files' };
  const warnings = [];
  const messages = importMessages(json, 'i18next', warnings);
  assert.deepEqual(messages.map(m => [m.key, m.text]), [
    ['nav.home', 'Home'], ['nav.hi', "Hi {name}, it's '{'raw'}'"],
    ['cart', '{count, plural, one {# item} other {# items}}'],
    ['old', '{count, plural, one {One file} other {# files}}'],
  ]);
  const out = exportMessages(catalogOf(messages), 'en', 'i18next', warnings);
  assert.deepEqual(out, { nav: { home: 'Home', hi: "Hi {{name}}, it's {raw}" }, cart_one: '{{count}} item', cart_other: '{{count}} items', old_one: 'One file', old_other: '{{count}} files' });
  const complex = exportMessages(catalogOf([{ key: 'g', text: '{who, select, a {A} other {B}}' }]), 'en', 'i18next', warnings);
  assert.equal(complex.g, '{who, select, a {A} other {B}}');
  assert.match(warnings.join('\n'), /i18next-icu/);
});
test('FormatJS and next-intl messages keep ICU and descriptions', () => {
  const messages = importMessages({ 'app.title': { defaultMessage: 'Welcome, {name}!', description: 'Heading' }, plain: 'Hi' }, 'formatjs');
  assert.deepEqual(messages, [{ key: 'app.title', context: 'Heading', text: 'Welcome, {name}!' }, { key: 'plain', context: '', text: 'Hi' }]);
  assert.deepEqual(exportMessages(catalogOf(messages), 'en', 'formatjs'), { 'app.title': 'Welcome, {name}!', plain: 'Hi' });
  assert.deepEqual(exportMessages(catalogOf(messages), 'en', 'next-intl'), { app: { title: 'Welcome, {name}!' }, plain: 'Hi' });
  assert.throws(() => importMessages({ 'has space': 'x' }, 'formatjs'), /cannot be an i18nmd token/);
});
test('resolves language names, native names, codes, and custom languages', () => {
  assert.deepEqual(['french', 'Français', 'fr', 'Klingon', 'brazilian portuguese'].map(n => resolveLanguage(n).code), ['fr', 'fr', 'fr', 'tlh', 'pt-BR']);
  assert.equal(resolveLanguage('german').name, 'Deutsch');
  assert.deepEqual(resolveLanguage('pirate'), { code: 'pirate', name: 'Pirate', english: 'pirate', custom: true });
  assert.deepEqual(topLanguages(5), ['en', 'zh', 'hi', 'es', 'fr']);
  assert.throws(() => topLanguages(0), /positive/);
});
test('LLM replies are validated message by message', () => {
  const catalog = { source: 'en', syntax: 'icu', languages: { en: 'English' }, messages: [] };
  const messages = [{ key: 'a', optional: [], translations: { en: 'Hi {name}' } }, { key: 'b', optional: [], translations: { en: 'Bye' } }, { key: 'c', optional: [], translations: { en: 'Go' } }];
  const { ok, errors } = readReply('```md\n## a\n\n```icu\nSalut {nom}\n```\n\n## b\n\n```icu\nAu revoir\n```\n```', catalog, { code: 'fr', name: 'Français' }, messages);
  assert.deepEqual({ ...ok }, { b: 'Au revoir' });
  assert.match(errors.a, /missing \{name\}/);
  assert.equal(errors.c, 'missing from the reply');
});
