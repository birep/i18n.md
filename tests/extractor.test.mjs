import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSource } from '../lib/extractor.mjs';
import { compileCatalog } from '../lib/compiler.mjs';
import { createI18n } from '../lib/runtime.mjs';

test('extracts visible JSX, attributes, and complete interpolated sentences', () => {
  const input = `"use client";\nexport function Hello({name}) { return <div className="shell"><h1>Hello, {name}!</h1><input placeholder="Your name" aria-label="Name" /><a href="/login">Sign in</a></div> }`;
  const result = extractSource(input, { languageExpression: 'locale' });
  assert.equal(result.catalog.messages.length, 4);
  assert.ok(result.source.startsWith('"use client";\nimport'));
  assert.match(result.source, /className="shell"/);
  assert.match(result.source, /href="\/login"/);
  assert.match(result.source, /i18nmd\.in\(locale\)\("hello", \{ name: name \}\)/);
  assert.match(extractSource('<p>Hi</p>', { namespace: 'knowledge-hub.faq.' }).source, /i18nmd\.knowledgeHub\.faq\("hi"\)/);
  assert.match(extractSource('<p>Hi</p>', { namespace: 'ui.', languageExpression: 'lang' }).source, /i18nmd\.in\(lang\)\.ui\("hi"\)/);
  const message = result.catalog.messages.find(m => m.translations.en === 'Hello, {name}!');
  assert.ok(message);
  assert.equal(createI18n(compileCatalog(result.catalog))(message.key, 'en', { name: 'Alex' }), 'Hello, Alex!');
});
test('retains JSX whitespace, entities, literals, and expression evaluation order', () => {
  const input = '<p>\n  Hello &amp; goodbye{" "}{user.name}!\n</p>';
  const result = extractSource(input);
  assert.equal(result.catalog.messages[0].translations.en, 'Hello & goodbye {name}!');
  assert.match(result.source, /name: user.name/);
  const nested = extractSource('<p>Read <strong className="x">this {doc}</strong> first.</p>');
  assert.deepEqual(nested.catalog.messages.map(m => m.translations.en), ['Read <strong>this {doc}</strong> first.']);
  assert.match(nested.source, /strong: chunks => <strong key="strong" className="x">\{chunks\}<\/strong>/);
  const icon = extractSource('<p>Save <Icon name="x" /></p>');
  assert.deepEqual(icon.catalog.messages.map(m => m.translations.en), ['Save']);
  assert.match(icon.source, /\{i18nmd\("save"\)\}\{" "\}<Icon/);
});
test('extracts opted-in JS strings and leaves machine strings alone', () => {
  const input = 'const key="internal"; const greeting = /* i18n:greeting */ `Hello ${name}`; const done = /* i18n */ "Done";';
  const result = extractSource(input);
  assert.equal(result.catalog.messages.length, 2);
  assert.equal(result.catalog.messages[0].key, 'greeting');
  assert.match(result.source, /key="internal"/);
  assert.match(extractSource('const x=/* i18n */`Hi ${getName(user)}, ${n.toFixed(1)}`').source, /i18nmd\("hi", \{ user: getName\(user\), n: n\.toFixed\(1\) \}\)/);
  assert.throws(() => extractSource('const x=/* i18n */`Hi ${<b/>}`'), /cannot render elements/);
});
test('keeps stable tokens, translations, imports, and idempotent converted source', () => {
  const first = extractSource('<button>Save</button>');
  const catalog = structuredClone(first.catalog); catalog.languages.fr = 'French'; catalog.messages[0].translations.fr = 'Enregistrer';
  const second = extractSource('<button>Save</button>', { existing: catalog });
  assert.equal(second.catalog.messages.length, 1);
  assert.equal(second.catalog.messages[0].translations.fr, 'Enregistrer');
  assert.equal(second.source, first.source);
  const again = extractSource(first.source, { existing: catalog });
  assert.equal(again.replacements, 0);
  assert.equal(again.source, first.source);
});
test('reports unsafe dynamic text and refuses binding or token collisions', () => {
  assert.throws(() => extractSource('function X(i18nmd) {return <p>Hi</p>}'), /shadow/);
  assert.throws(() => extractSource('const i18nmd=1; <p>Hi</p>'), /shadow/);
  assert.equal(extractSource('<p>{"Hello " + name}</p>').diagnostics.length, 1);
  assert.throws(() => extractSource('<p>Hi</p>', { languageExpression: 'getLocale()' }), /language expression/);
  const first = extractSource('const x = /* i18n:greeting */ "Hello";');
  assert.throws(() => extractSource('const x = /* i18n:greeting */ "Goodbye";', { existing: first.catalog }), /different source text/);
});

test('keeps sentences whole around computed values, and skips text without words', () => {
  const result = extractSource('<p>This {LABELS[item.kind].toLowerCase()} is on {names}, kerf {formatLength(kerf, units)}, {rows.length} rows, {a ? " those" : " that one"}.</p>');
  assert.deepEqual(result.catalog.messages.map(m => m.translations.en), ['This {kind} is on {names}, kerf {kerf}, {rowsCount} rows, {a}.']);
  assert.match(result.source, /kind: LABELS\[item\.kind\]\.toLowerCase\(\), names: names, kerf: formatLength\(kerf, units\), rowsCount: rows\.length, a: a \? " those" : " that one"/);
  assert.match(result.diagnostics.join('\n'), /\{a\} is text chosen in code/);
  assert.match(result.diagnostics.join('\n'), /\{rowsCount\} looks like a count/);
  assert.deepEqual(extractSource('<p>Cut {VIDEO[k].label.split(" ·")[0]} with {s.drive ? ` · ${s.drive.size}` : ""}</p>').catalog.messages.map(m => m.translations.en), ['Cut {label} with {drive}']);
  const symbols = extractSource('<div><strong>60</strong><span>⏮</span><span>{a} · ▲ {votes}</span><img alt="5" /><p>Ends {list.map(x => <i>{x}</i>)}</p></div>');
  assert.deepEqual(symbols.catalog.messages.map(m => m.translations.en), ['Ends']);
  assert.equal(extractSource("<p>Google's viewer isn't {x}</p>").catalog.messages[0].translations.en, "Google's viewer isn't {x}");
});
test('turns wording chosen in code into one message per branch', () => {
  const result = extractSource('<div><button>{busy ? "Saving…" : "Save"}</button><h2>{mode === "a" ? `Hi ${user.name}` : sub && " · featured"}</h2><i>{x ? "" : unit}</i></div>');
  assert.deepEqual(result.catalog.messages.map(m => m.translations.en), ['Saving…', 'Save', 'Hi {name}', 'featured']);
  assert.match(result.source, /\{busy \? i18nmd\("saving"\) : i18nmd\("save"\)\}/);
  assert.match(result.source, /sub && ` · \$\{i18nmd\("featured"\)\}`/);
  assert.match(result.source, /\{x \? "" : unit\}/);
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(extractSource('<p>{i + 1}</p>').diagnostics, []);
});
test('names tokens from words, explains context, and flags counts', () => {
  const result = extractSource('<div><h1>Welcome back!</h1><img alt="Welcome back!" /><p>Welcome  back?</p><p>You have {count} items</p></div>', { filename: 'Home.tsx', locale: 'de' });
  assert.deepEqual(result.catalog.messages.map(m => m.key), ['welcome_back', 'welcome_back_2', 'you_have_items']);
  assert.equal(result.catalog.languages.de, 'Deutsch');
  assert.match(result.catalog.messages[0].context, /^Text in <h1> \(Home.tsx:1\)$/);
  assert.match(result.diagnostics.join('\n'), /\{count\} looks like a count/);
});
test('finds and adds the division imports a file needs', async () => {
  const { missingDivisionImports } = await import('../lib/extractor.mjs');
  const options = { accessors: { '.ui': 'ui', '.chat': 'chat', '.knowledgeHub.faq': 'knowledge-hub.faq', '.knowledgeHub': 'knowledge-hub' }, namespaces: { 'ui.': 'ui', 'chat.': 'chat', 'knowledge-hub.faq.': 'knowledge-hub.faq', 'knowledge-hub.': 'knowledge-hub' } };
  const source = 'import { i18nmd } from "../i18n/ui";\nimport x from "y";\nexport const a = [i18nmd.ui("a"), i18nmd.chat("b"), i18nmd.in(l).knowledgeHub.faq("q"), i18nmd("knowledge-hub.c"), i18nmd.chat("d")];\n';
  const { missing, fix } = missingDivisionImports(source, options);
  assert.deepEqual(missing.map(m => [m.division, m.statement]), [['chat', 'import "../i18n/chat";'], ['knowledge-hub.faq', 'import "../i18n/knowledge-hub.faq";'], ['knowledge-hub', 'import "../i18n/knowledge-hub";']]);
  assert.deepEqual(missingDivisionImports(fix, options).missing, []);
  assert.deepEqual(missingDivisionImports('i18nmd.ui("a")', options).missing, []);
});
test('a second division in a file adds an import of its module beside the first', () => {
  const first = extractSource('<p>Hello</p>', { namespace: 'ui.', importPath: '../i18n/ui' }).source;
  const both = extractSource(first + '\nexport const B = () => <b>Bye</b>;', { namespace: 'chat.', importPath: '../i18n/chat' }).source;
  assert.match(both, /^import \{ i18nmd \} from "\.\.\/i18n\/ui";\nimport "\.\.\/i18n\/chat";/);
  assert.match(both, /i18nmd\.chat\("bye"\)/);
  assert.throws(() => extractSource('import { i18nmd } from "elsewhere";\n<p>Hi</p>', { importPath: '../i18n/ui' }), /different module/);
});
test('lists the tokens a file calls by name', async () => {
  const { missingDivisionImports } = await import('../lib/extractor.mjs');
  const options = { accessors: { '.ui': 'ui', '.kb': 'kb', '.kb.faq': 'kb.faq' }, namespaces: { 'ui.': 'ui', 'kb.': 'kb', 'kb.faq.': 'kb.faq' } };
  const { used, dynamic } = missingDivisionImports('i18nmd.ui("a"); i18nmd.kb.faq("q"); i18nmd("kb.x"); i18nmd.in(l).ui("b"); i18nmd.ui(name); i18nmd("top")', options);
  assert.deepEqual([...used].sort(), ['kb.faq.q', 'kb.x', 'top', 'ui.a', 'ui.b']);
  assert.equal(dynamic, 1);
});
