import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extractHtml, renderHtml } from '../lib/html.mjs';
const cli = fileURLToPath(new URL('../bin/i18nmd.mjs', import.meta.url));

const page = `<!doctype html>
<html lang="en">
<head><title>Liko Labs</title><meta name="description" content="Software from Hilo."><meta property="og:url" content="https://example.com/"></head>
<body>
<nav><a href="#a">Services</a><a href="#b">About</a></nav>
<nav data-i18n-languages></nav>
<h1 class="big">From first leaf to <em class="red">full&nbsp;grown.</em></h1>
<p><img src="logo.png" alt="A red leaf"> Made in <b translate="no">Hilo</b>.</p>
<p>example.com</p>
<p translate="no">Liko Labs</p>
<label for="o">Organization <small>(optional)</small></label><input id="o" placeholder="Your company">
<p id="status"></p>
<script>status.textContent = /* i18n */ 'Sending…'; const id = 'contact-form'; alert('Thanks. Sent.');</script>
</body>
</html>
`;

test('extract marks sentences, attributes and script strings, and keeps the English in place', () => {
  const { source, catalog, diagnostics, replacements } = extractHtml(page);
  const texts = Object.fromEntries(catalog.messages.map(m => [m.key, m.translations.en]));
  assert.deepEqual(Object.values(texts).sort(), ['A red leaf', 'About', 'From first leaf to <em>full grown.</em>', 'Liko Labs', 'Made in <b>Hilo</b>.', 'Organization <small>(optional)</small>', 'Sending…', 'Services', 'Software from Hilo.', 'Your company'].sort());
  assert.equal(replacements, 10);
  assert.match(source, /<h1 class="big" data-i18n="from_first_leaf_to_full_grown">From first leaf to <em class="red">full&nbsp;grown.<\/em><\/h1>/);
  assert.match(source, /<img src="logo.png" alt="A red leaf" data-i18n-alt="a_red_leaf">/);
  assert.match(source, /\/\* i18n:sending \*\/ 'Sending…'/);
  assert.match(source, /<p translate="no">Liko Labs<\/p>/, 'translate="no" is left alone');
  assert.match(source, /<p>example.com<\/p>/, 'addresses are not text to translate');
  assert.match(diagnostics.join('\n'), /"Thanks. Sent."\); mark it \/\* i18n \*\//);
  assert.doesNotMatch(diagnostics.join('\n'), /contact-form/);
  // Repeatable: a marked page changes nothing, and edited English updates the catalog.
  const again = extractHtml(source, { existing: catalog });
  assert.equal(again.source, source);
  assert.equal(again.replacements, 0);
  const edited = extractHtml(source.replace('>Services<', '>What we do<'), { existing: catalog });
  assert.equal(edited.updated, 1);
  assert.equal(edited.catalog.messages.find(m => m.key === 'services').translations.en, 'What we do');
});

test('render writes each language with its markup, links, and language metadata', () => {
  const { source } = extractHtml(page);
  const pages = { en: 'https://example.com/', haw: 'https://example.com/haw/' };
  const messages = { from_first_leaf_to_full_grown: 'Mai ka liko a i ka <em>oʻo.</em>', a_red_leaf: 'He lau ʻulaʻula', made_in_hilo: 'Hana ʻia ma <b>Hilo-translated</b>.', sending: 'Ke hoʻouna nei…', software_from_hilo: 'Polokalamu mai Hilo.' };
  const haw = renderHtml(source, { language: 'haw', source: 'en', messages, pages, languages: { en: 'English', haw: 'ʻŌlelo Hawaiʻi' }, relative: '../', absolute: true });
  assert.match(haw, /<html lang="haw">/);
  assert.match(haw, /<h1 class="big">Mai ka liko a i ka <em class="red">oʻo.<\/em><\/h1>/);
  assert.match(haw, /<p><img src="..\/logo.png" alt="He lau ʻulaʻula"> Hana ʻia ma <b translate="no">Hilo<\/b>.<\/p>/, 'translate="no" keeps its words; relative links go up');
  assert.match(haw, /'Ke hoʻouna nei…'|"Ke hoʻouna nei…"/);
  assert.match(haw, /content="Polokalamu mai Hilo."/);
  assert.match(haw, /<meta property="og:url" content="https:\/\/example.com\/haw\/">/);
  assert.match(haw, /<link rel="alternate" hreflang="en" href="https:\/\/example.com\/">\n<link rel="alternate" hreflang="haw" href="https:\/\/example.com\/haw\/">\n<link rel="alternate" hreflang="x-default" href="https:\/\/example.com\/">/);
  assert.match(haw, /<nav><a href="https:\/\/example.com\/" hreflang="en" lang="en">English<\/a> <a href="https:\/\/example.com\/haw\/" hreflang="haw" lang="haw" aria-current="page">ʻŌlelo Hawaiʻi<\/a><\/nav>/);
  assert.match(haw, /<a href="#a">Services<\/a>/, 'untranslated text stays in the source language');
  assert.doesNotMatch(haw, /data-i18n/);
  const en = renderHtml(source, { language: 'en', source: 'en', messages: {}, pages, languages: { en: 'English', haw: 'ʻŌlelo Hawaiʻi' } });
  assert.match(en, /<h1 class="big">From first leaf to <em class="red">full&nbsp;grown.<\/em><\/h1>/);
  assert.doesNotMatch(en, /data-i18n/);
});

test('extract and render a site from the command line', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-html-'));
  try {
    await mkdir(path.join(root, 'site/blog'), { recursive: true });
    await writeFile(path.join(root, 'site/index.html'), page);
    await writeFile(path.join(root, 'site/blog/post.html'), '<!doctype html><html><head><title>A post</title></head><body><p>Hello <a href="../index.html">home</a>.</p><img src="pic.png" alt=""></body></html>');
    await writeFile(path.join(root, 'site/logo.png'), 'png');
    await writeFile(path.join(root, 'site/_headers'), '/*\n  X: y\n');
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    let result = run('extract', 'site', '--in-place');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Thanks. Sent./);
    const english = await readFile(path.join(root, 'translations/i18n-en.md'), 'utf8');
    assert.match(english, /## hello_home\n\nContext: Paragraph\n\n```icu\nHello <a>home<\/a>.\n```/);
    await writeFile(path.join(root, 'translations/i18n-haw.md'), '# ʻŌlelo Hawaiʻi\n\n## hello_home\n\n```icu\nAloha <a>ka home</a>.\n```\n');
    assert.equal(run('sync').status, 0);
    result = run('render', 'site', '--out', 'dist', '--url', 'https://example.com/');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Rendered 4 pages in 2 languages into dist/);
    assert.deepEqual((await readdir(path.join(root, 'dist'))).sort(), ['_headers', 'blog', 'haw', 'index.html', 'logo.png']);
    const post = await readFile(path.join(root, 'dist/haw/blog/post.html'), 'utf8');
    assert.match(post, /<p>Aloha <a href="..\/..\/index.html">ka home<\/a>.<\/p>/);
    assert.match(post, /<img src="..\/..\/blog\/pic.png" alt="">/);
    assert.match(post, /hreflang="haw" href="https:\/\/example.com\/haw\/blog\/post.html"/);
    assert.match(await readFile(path.join(root, 'dist/blog/post.html'), 'utf8'), /<p>Hello <a href="..\/index.html">home<\/a>.<\/p>/);
    assert.match(result.stderr, /ʻŌlelo Hawaiʻi \(haw\): 1\/\d+ done/);
    // Editing a page's English and extracting again updates the source file only.
    await writeFile(path.join(root, 'site/blog/post.html'), (await readFile(path.join(root, 'site/blog/post.html'), 'utf8')).replace('Hello', 'Aloha'));
    result = run('extract', 'site', '--in-place');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Updated 1 string/);
    assert.match(run('status').stdout, /1 stale/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
