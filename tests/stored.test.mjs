import test from 'node:test';
import assert from 'node:assert/strict';
import { spansToMessage, messageToSpans } from '../lib/spans.mjs';
import { estimateMessages, translateMessages } from '../lib/stored.mjs';

// Translates by prefixing each message with the language code, as the mock API does.
const fake = calls => async (_config, system, user) => {
  calls.push({ system, user });
  const code = /\) into .*\(([\w-]+)\)\./.exec(system)[1];
  return [...user.matchAll(/^## (\S+)\n\n(?:Context: .*\n\n)?```icu\n([\s\S]*?)\n```/gm)].map(([, key, text]) => `## ${key}\n\n\`\`\`icu\n[${code}] ${text}\n\`\`\``).join('\n\n');
};

test('spans become one message with tags and come back with their marks', () => {
  const spans = [
    { text: 'Read ' },
    { text: 'the guide', link: 'https://example.com/guide', bold: true },
    { text: ' and ', bold: true },
    { text: 'the FAQ', link: 'https://example.com/faq', bold: true },
    { text: ' before {starting}. It\'s quick.', italic: false },
  ];
  const { message, tags } = spansToMessage(spans);
  assert.equal(message, "Read <bold><link>the guide</link> and <link_2>the FAQ</link_2></bold> before '{'starting'}'. It's quick.");
  assert.deepEqual(tags, { link: { link: 'https://example.com/guide' }, bold: { bold: true }, link_2: { link: 'https://example.com/faq' } });
  assert.deepEqual(messageToSpans(message, tags), [
    { text: 'Read ' },
    { text: 'the guide', bold: true, link: 'https://example.com/guide' },
    { text: ' and ', bold: true },
    { text: 'the FAQ', bold: true, link: 'https://example.com/faq' },
    { text: ' before {starting}. It\'s quick.' },
  ]);
  // A translation may reorder the tags; the link targets follow their tags.
  assert.deepEqual(messageToSpans('Lis <link_2>la FAQ</link_2> puis <link>le guide</link>.', tags), [
    { text: 'Lis ' },
    { text: 'la FAQ', link: 'https://example.com/faq' },
    { text: ' puis ' },
    { text: 'le guide', link: 'https://example.com/guide' },
    { text: '.' },
  ]);
  assert.throws(() => messageToSpans('<em>x</em>', tags), /Unknown tag <em>/);
});

test('overlapping marks still produce tags that close in order', () => {
  const spans = [{ text: 'a', bold: true }, { text: 'b', bold: true, italic: true }, { text: 'c', italic: true }];
  const { message, tags } = spansToMessage(spans);
  assert.equal(message, '<bold>a<italic>b</italic></bold><italic>c</italic>');
  assert.deepEqual(messageToSpans(message, tags), [{ text: 'a', bold: true }, { text: 'b', bold: true, italic: true }, { text: 'c', italic: true }]);
});

test('translateMessages sends only new and changed entries and returns spans for spans', async () => {
  const messages = {
    title: 'Shelf brackets',
    'block-1': { spans: [{ text: 'Cut the ' }, { text: 'two', bold: true }, { text: ' brackets.' }], context: 'Paragraph' },
    'block-2': { spans: [{ text: '42' }] },
  };
  const calls = [];
  const first = await translateMessages(messages, { languages: ['fr', 'German'], kind: 'prose', config: {}, chatImpl: fake(calls) });
  assert.equal(calls.length, 2);
  assert.match(calls[0].system, /published prose/);
  assert.doesNotMatch(calls[0].user, /42/);
  assert.deepEqual(first.failed, {});
  assert.equal(first.translations.fr.title.text, '[fr] Shelf brackets');
  assert.deepEqual(first.translations.de['block-1'].spans, [{ text: '[de] Cut the ' }, { text: 'two', bold: true }, { text: ' brackets.' }]);
  assert.deepEqual(first.translations.fr['block-2'].spans, [{ text: '42' }]);

  // Nothing changed: nothing is sent.
  assert.equal(estimateMessages(messages, { languages: ['fr', 'de'], previous: first.translations }).messages, 0);
  calls.length = 0;
  const again = await translateMessages(messages, { languages: ['fr', 'de'], previous: first.translations, config: {}, chatImpl: fake(calls) });
  assert.equal(calls.length, 0);
  assert.deepEqual(again.translations, first.translations);

  // A changed link target is a change, and the earlier wording is offered as a hint.
  const changed = { ...messages, 'block-1': { spans: [{ text: 'Cut the ' }, { text: 'two', link: 'https://example.com' }, { text: ' brackets.' }] } };
  calls.length = 0;
  const third = await translateMessages(changed, { languages: ['fr'], previous: first.translations, config: {}, chatImpl: fake(calls) });
  assert.equal(calls.length, 1);
  assert.match(calls[0].user, /Translate these 1 messages/);
  assert.match(calls[0].user, /earlier translation[\s\S]*\[fr\] Cut the <bold>two<\/bold>/);
  assert.deepEqual(third.translations.fr['block-1'].spans[1], { text: 'two', link: 'https://example.com' });
  assert.deepEqual(third.translations.fr.title, first.translations.fr.title);
});

test('a translation that drops a tag fails for that entry only', async () => {
  const chatImpl = async () => '## m1\n\n```icu\nSans lien\n```\n\n## m2\n\n```icu\nBonjour\n```';
  const result = await translateMessages({ a: { spans: [{ text: 'With ' }, { text: 'link', link: 'https://example.com' }] }, b: 'Hello' }, { languages: ['fr'], config: {}, chatImpl });
  assert.match(result.failed.fr.a, /missing <link>/);
  assert.deepEqual(result.translations.fr.b, { text: 'Bonjour', fingerprint: result.translations.fr.b.fingerprint });
});

test('bad requests name the entry', async () => {
  await assert.rejects(translateMessages({ a: 'Hello {' }, { languages: ['fr'], config: {} }), /^Error: a: /);
  await assert.rejects(translateMessages({ a: { text: 'x', spans: [] } }, { languages: ['fr'], config: {} }), /a: an entry is/);
  await assert.rejects(translateMessages({ a: 'Hi' }, { languages: ['en'], config: {} }), /en is the source language/);
  await assert.rejects(translateMessages({ a: 'Hi there' }, { languages: ['fr'], config: {}, budget: 1, chatImpl: fake([]) }), /over the 1-token budget/);
});
