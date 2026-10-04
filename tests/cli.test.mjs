import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync, execFile } from 'node:child_process';
import { parseCatalog, serializeCatalog } from '../lib/catalog.mjs';
const cli = fileURLToPath(new URL('../bin/i18nmd.mjs', import.meta.url));
test('installed-style CLI extracts Italian, compiles a directory, and rejects outdated translations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-cli-'));
  try {
    const src = path.join(root, 'src'), translations = path.join(root, 'translations'), converted = path.join(root, 'converted'), generated = path.join(root, 'generated');
    await mkdir(src);
    const original = 'export function Greeting({name}) { return <p>Ciao, {name}!</p>; }';
    await writeFile(path.join(src, 'Greeting.tsx'), original);
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    let result = run('extract', src, '--out', translations, '--locale', 'it', '--language', 'locale', '--dest', converted, '--runtime', path.join(generated, 'i18n'));
    assert.equal(result.status, 0, result.stderr);
    const sourceFile = path.join(translations, 'i18n-it.md');
    const markdown = await readFile(sourceFile, 'utf8');
    assert.ok(!markdown.startsWith('---'));
    assert.equal(await readFile(path.join(src, 'Greeting.tsx'), 'utf8'), original);
    const catalog = parseCatalog(markdown, { filename: sourceFile });
    const token = catalog.messages[0].key;
    catalog.languages.pirate = 'Pirate';
    catalog.messages[0].translations.pirate = 'Ahoy, {name}!';
    await writeFile(path.join(translations, 'i18n-pirate.md'), serializeCatalog(catalog, { locale: 'pirate' }));
    result = run('compile', translations, '--locale', 'it', '--out', generated, '--target', 'js');
    assert.equal(result.status, 0, result.stderr);
    const { i18nmd, loadLanguage } = await import(pathToFileURL(path.join(generated, 'i18n.mjs')));
    await loadLanguage('pirate');
    assert.equal(i18nmd(token, { name: 'Alex' }), 'Ciao, Alex!');
    assert.equal(i18nmd.in('pirate')(token, { name: 'Alex' }), 'Ahoy, Alex!');
    await writeFile(path.join(src, 'Greeting.tsx'), original + '\nconst done=/* i18n */"Finito";');
    result = run('extract', src, '--out', translations, '--locale', 'it', '--dest', converted, '--merge');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseCatalog(await readFile(sourceFile, 'utf8'), { filename: sourceFile }).messages.length, 2);
    result = run('compile', translations, '--locale', 'it', '--out', path.join(root, 'incomplete'));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Pirate \(pirate\): 1\/2 done, 1 missing/);
    assert.doesNotMatch(result.stderr, /token missing/);
    result = run('check', translations, '--source', 'it', '--strict');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /token set must match/);
    result = run('status', translations, '--source', 'it');
    assert.match(result.stdout, /Pirate \(pirate\): 1\/2 done, 1 missing/);
    assert.equal(run('sync', translations, '--source', 'it').status, 0);
    assert.equal(JSON.parse(await readFile(path.join(translations, 'i18nmd.lock.json'), 'utf8')).source, 'it');
    assert.match(run('status', translations).stdout, /Italiano \(it\): 2 tokens, source/);
    const joined = path.join(root, 'all.md'), splitDir = path.join(root, 'split');
    assert.equal(run('join', translations, '--source', 'it', '--out', joined).status, 0);
    assert.equal(run('split', joined, '--out', splitDir).status, 0);
    for (const name of ['i18n-it.md', 'i18n-pirate.md', 'i18nmd.lock.json']) assert.equal(await readFile(path.join(splitDir, name), 'utf8'), await readFile(path.join(translations, name), 'utf8'));
    result = run('rename', translations, token, 'greeting', '--in', converted);
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(converted, 'Greeting.tsx'), 'utf8'), /i18nmd\("greeting", \{ name/);
    assert.match(await readFile(path.join(translations, 'i18n-pirate.md'), 'utf8'), /## greeting\n/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('--add and translate fill languages through Anthropic or OpenAI-compatible endpoints', async () => {
  const { startMockLLM } = await import('./fixtures/mock-llm.mjs');
  const failedOnce = new Set();
  const llm = await startMockLLM({ fail: key => key === 'count' && !failedOnce.has(key) && !!failedOnce.add(key) });
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-llm-'));
  try {
    const translations = path.join(root, 'translations');
    await mkdir(translations);
    await writeFile(path.join(translations, 'i18n-en.md'), '# English\n\n## hello\n\nContext: Greeting.\n\n```icu\nHello <b>{name}</b>\n```\n\n## count\n\n```icu\n{n, plural, one {# file} other {# files}}\n```\n');
    // Async, so this process can keep serving the mock API while the CLI runs.
    const run = (env, ...args) => new Promise(resolve => execFile(process.execPath, [cli, ...args], { cwd: root, env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) => resolve({ status: error ? error.code ?? 1 : 0, stdout, stderr })));
    let result = await run({}, '--top', '3', '--dry-run');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /中文 \(zh\): 2 messages[\s\S]*हिन्दी \(hi\)/);
    assert.equal(llm.requests.length, 0);
    assert.match((await run({}, '--add', 'french')).stderr, /Set I18NMD_API_KEY/);
    result = await run({ I18NMD_BASE_URL: llm.url, I18NMD_API_KEY: 'sk-ant-test' }, '--add', 'french', '--add', 'pirate');
    assert.equal(result.status, 0, result.stderr);
    const anthropic = llm.requests.find(r => r.url === '/v1/messages');
    assert.equal(anthropic.headers['x-api-key'], 'sk-ant-test');
    assert.equal(anthropic.body.model, 'claude-opus-5-5');
    assert.equal(anthropic.body.fallbacks, undefined);
    // The failing message was retried with the validation error and then accepted.
    assert.ok(llm.requests.some(r => /previous attempt had these problems[\s\S]*count: .*missing \{n\}/.test(r.body.messages[0].content)));
    const fr = await readFile(path.join(translations, 'i18n-fr.md'), 'utf8');
    assert.match(fr, /^# Français\n/);
    assert.match(fr, /\[fr\] Hello <b>\{name\}<\/b>/);
    assert.match(await readFile(path.join(translations, 'i18n-pirate.md'), 'utf8'), /^# Pirate\n[\s\S]*\[pirate\] \{n, plural/);
    assert.match((await run({}, 'status')).stdout, /Français \(fr\): 2\/2 done/);
    await writeFile(path.join(translations, 'i18n-en.md'), (await readFile(path.join(translations, 'i18n-en.md'), 'utf8')).replace('Hello <b>', 'Hi <b>'));
    assert.match((await run({}, 'status')).stdout, /Français \(fr\): 1\/2 done, 1 stale/);
    llm.requests.length = 0;
    result = await run({ I18NMD_BASE_URL: `${llm.url}/v1`, I18NMD_API_KEY: 'key', I18NMD_MODEL: 'local-model' }, 'translate', '--only', 'french');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(llm.requests.length, 1);
    assert.equal(llm.requests[0].url, '/v1/chat/completions');
    assert.equal(llm.requests[0].headers.authorization, 'Bearer key');
    assert.match(llm.requests[0].body.messages[1].content, /earlier translation[\s\S]*\[fr\] Hello/);
    assert.match((await run({}, 'status')).stdout, /Français \(fr\): 2\/2 done[\s\S]*Pirate \(pirate\): 1\/2 done, 1 stale/);
    assert.notEqual((await run({}, 'check', '--strict')).status, 0);
  } finally { llm.close(); await rm(root, { recursive: true, force: true }); }
});

test('divisions: translate writes each division back in place, and one division can be worked on alone', async () => {
  const { startMockLLM } = await import('./fixtures/mock-llm.mjs');
  const llm = await startMockLLM();
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-divisions-'));
  try {
    const one = (key, text) => `# English\n\n## ${key}\n\n\`\`\`icu\n${text}\n\`\`\`\n`;
    for (const [division, key, text] of [['ui', 'save', 'Save'], ['marketing', 'hero', 'Ship {product} faster'], ['knowledge-hub', 'search', 'Search articles']]) {
      await mkdir(path.join(root, 'translations', division), { recursive: true });
      await writeFile(path.join(root, 'translations', division, 'i18n-en.md'), one(key, text));
    }
    const run = (...args) => new Promise(resolve => execFile(process.execPath, [cli, ...args], { cwd: root, env: { PATH: process.env.PATH, I18NMD_BASE_URL: llm.url, I18NMD_API_KEY: 'sk-ant-test' } }, (error, stdout, stderr) => resolve({ status: error ? error.code ?? 1 : 0, stdout, stderr })));
    let result = await run('--add', 'french');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(root, 'translations/marketing/i18n-fr.md'), 'utf8'), /## hero\n\n```icu\n\[fr\] Ship \{product\} faster/);
    assert.doesNotMatch(await readFile(path.join(root, 'translations/ui/i18n-fr.md'), 'utf8'), /hero/);
    const lock = JSON.parse(await readFile(path.join(root, 'translations/i18nmd.lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(lock.translations.fr).sort(), ['knowledge-hub.search', 'marketing.hero', 'ui.save']);
    // Editing one division's source and syncing just that division keeps the rest of the lock.
    await writeFile(path.join(root, 'translations/ui/i18n-en.md'), one('save', 'Save changes'));
    result = await run('sync', 'translations/ui');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fr: ui\.save is stale/);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(root, 'translations/i18nmd.lock.json'), 'utf8')).translations.fr).sort(), ['knowledge-hub.search', 'marketing.hero', 'ui.save']);
    result = await run('status', 'translations/ui');
    assert.match(result.stdout, /Français \(fr\): 0\/1 done, 1 stale/);
    result = await run('status');
    assert.match(result.stdout, /Français \(fr\): 2\/3 done, 1 stale/);
    assert.match(result.stdout, /ui: 1 token; fr 0\/1/);
    result = await run('translate', 'translations/ui');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(root, 'translations/ui/i18n-fr.md'), 'utf8'), /\[fr\] Save changes/);
    // A path among --add's languages picks the division instead of naming a language.
    result = await run('--add', 'german', 'translations/marketing');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(root, 'translations/marketing/i18n-de.md'), 'utf8'), /\[de\] Ship/);
    await assert.rejects(readFile(path.join(root, 'translations/ui/i18n-de.md')));
    assert.deepEqual((await readdir(path.join(root, 'translations/marketing'))).filter(f => /translations/.test(f)), []);
    assert.match((await run('--add', 'german', 'translations/ui', 'translations/marketing')).stderr, /at most one path/);
    await rm(path.join(root, 'translations/marketing/i18n-de.md'));
    assert.match((await run('join', '--out', 'all.md')).stderr, /several divisions/);
    assert.equal((await run('join', 'translations/ui', '--out', 'ui.md')).status, 0);
    assert.match((await run('rename', 'ui.save', 'marketing.hero')).stderr, /marketing\.hero already exists in translations\/marketing/);
    assert.match((await run('rename', 'ui.save', 'marketing.save')).stderr, /keep its ui namespace/);
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/App.tsx'), 'i18nmd("ui.save"); i18nmd.ui("save", { n }); i18nmd.in(locale).ui("save"); i18nmd.marketing("save");');
    result = await run('rename', 'ui.save', 'ui.save_changes', '--in', 'src');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(root, 'translations/ui/i18n-fr.md'), 'utf8'), /^## save_changes$/m);
    assert.equal(await readFile(path.join(root, 'src/App.tsx'), 'utf8'), 'i18nmd("ui.save_changes"); i18nmd.ui("save_changes", { n }); i18nmd.in(locale).ui("save_changes"); i18nmd.marketing("save");');
    assert.ok(JSON.parse(await readFile(path.join(root, 'translations/i18nmd.lock.json'), 'utf8')).translations.fr['ui.save_changes']);
    // Extracting into a division writes short names to its file and full names into the code.
    await writeFile(path.join(root, 'src/Kb.tsx'), 'export const Kb = () => <h1>Popular articles</h1>;');
    result = await run('extract', 'src/Kb.tsx', '--out', 'translations/knowledge-hub', '--merge', '--dest', 'converted');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(root, 'translations/knowledge-hub/i18n-en.md'), 'utf8'), /^## popular_articles$/m);
    assert.match(await readFile(path.join(root, 'converted/Kb.tsx'), 'utf8'), /i18nmd\.knowledgeHub\("popular_articles"\)/);
    result = await run('compile', '--out', 'out', '--target', 'js');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3 division modules, 1 language chunk/);
    // Each division ships with the code that imports it; other languages load on demand.
    assert.doesNotMatch(await readFile(path.join(root, 'out/i18n.mjs'), 'utf8'), /Ship \{product\} faster/);
    const { i18nmd, loadLanguage, setLanguage, getLanguage } = await import(pathToFileURL(path.join(root, 'out/i18n.mjs')));
    await import(pathToFileURL(path.join(root, 'out/marketing.mjs')));
    await import(pathToFileURL(path.join(root, 'out/knowledge-hub.mjs')));
    await import(pathToFileURL(path.join(root, 'out/ui.mjs')));
    await loadLanguage('fr');
    assert.equal(i18nmd.in('fr').marketing('hero', { product: 'X' }), '[fr] Ship X faster');
    assert.equal(await setLanguage('fr'), 'fr');
    assert.equal(getLanguage(), 'fr');
    assert.equal(i18nmd.marketing('hero', { product: 'Y' }), '[fr] Ship Y faster');
    await setLanguage('en');
    // --eager puts everything in i18n.mjs, and removes the division modules it no longer writes.
    result = await run('compile', '--out', 'out', '--target', 'js', '--eager');
    assert.equal(result.status, 0, result.stderr);
    const eager = await readFile(path.join(root, 'out/i18n.mjs'), 'utf8');
    assert.match(eager, /Ship \{product\} faster|"Ship ",/);
    // A language that only a skipped division has stays out of the build.
    await mkdir(path.join(root, 'translations/lab'));
    await writeFile(path.join(root, 'translations/lab/i18n-en.md'), one('beta', 'Beta'));
    result = await run('compile', '--out', 'web', '--target', 'js', '--skip', 'marketing,knowledge-hub,ui');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(path.join(root, 'web/language.mjs'), 'utf8'), /languages = \{\s*"en": "English"\s*\}/);
    await writeFile(path.join(root, 'web/old.mjs'), '// Generated from i18n.md. Edit the Markdown source.\n');
    await writeFile(path.join(root, 'web/mine.mjs'), 'export {};\n');
    assert.equal((await run('compile', '--out', 'web', '--target', 'js', '--skip', 'marketing,knowledge-hub,ui')).status, 0);
    assert.deepEqual((await readdir(path.join(root, 'web'))).sort(), ['i18n.mjs', 'lab.mjs', 'language.mjs', 'mine.mjs', 'runtime.d.mts', 'runtime.mjs']);
    assert.match((await run('compile', '--out', 'web', '--skip', 'nope')).stderr, /No division nope/);
    assert.equal(i18nmd.knowledgeHub('search'), 'Search articles');
    assert.equal(i18nmd('ui.save_changes'), 'Save changes');
  } finally { llm.close(); await rm(root, { recursive: true, force: true }); }
});

test('the README quickstart works with every default', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-quickstart-'));
  try {
    await mkdir(path.join(root, 'src/components'), { recursive: true });
    await writeFile(path.join(root, 'src/components/Cart.tsx'), 'export const Cart = ({ count }) => <p>You have {count} items</p>;\n');
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    let result = run('extract', 'src', '--in-place');
    assert.equal(result.status, 0, result.stderr);
    result = run('compile');
    assert.equal(result.status, 0, result.stderr);
    const code = await readFile(path.join(root, 'src/components/Cart.tsx'), 'utf8');
    const specifier = /from "([^"]+)"/.exec(code)[1];
    assert.equal(specifier, '../i18n/i18n');
    assert.ok((await readdir(path.join(root, 'src/i18n'))).includes('i18n.ts'));
    assert.ok((await readFile(path.join(root, 'translations/i18n-en.md'), 'utf8')).includes('You have {count} items'));
    assert.equal(run('check', '--in', 'src').status, 0);
    assert.match(run('--version').stdout, /^\d+\.\d+\.\d+\n$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('import --merge adds source messages to a division without touching translations or the lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-merge-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    const division = path.join(root, 'translations/procedures');
    await mkdir(division, { recursive: true });
    await writeFile(path.join(division, 'i18n-en.md'), '# Translations\n\nLanguage: English\n\n## glue\n\n```icu\nGlue the joint.\n```\n\n## sand\n\n```icu\nSand it.\n```\n');
    await writeFile(path.join(division, 'i18n-fr.md'), '# Traductions\n\nLanguage: Français\n\n## glue\n\n```icu\nCollez le joint.\n```\n\n## sand\n\n```icu\nPoncez.\n```\n');
    assert.equal(run('sync').status, 0);
    const before = [await readFile(path.join(division, 'i18n-fr.md'), 'utf8'), await readFile(path.join(root, 'translations/i18nmd.lock.json'), 'utf8')];
    await writeFile(path.join(root, 'sentences.json'), JSON.stringify({ cut: { defaultMessage: 'Cut the board to {len}.', description: 'Narration; len is a length' }, sand: 'Sand it smooth.', glue: 'Glue the joint.' }));
    let result = run('import', 'sentences.json', '--from', 'formatjs', '--merge', '--out', 'translations/procedures');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Added 1 token and updated 1 token/);
    const source = parseCatalog(await readFile(path.join(division, 'i18n-en.md'), 'utf8'), { locale: 'en' });
    assert.deepEqual(source.messages.map(m => [m.key, m.translations.en]), [['glue', 'Glue the joint.'], ['sand', 'Sand it smooth.'], ['cut', 'Cut the board to {len}.']]);
    assert.equal(source.messages[2].context, 'Narration; len is a length');
    assert.deepEqual([await readFile(path.join(division, 'i18n-fr.md'), 'utf8'), await readFile(path.join(root, 'translations/i18nmd.lock.json'), 'utf8')], before);
    result = run('status');
    assert.match(result.stdout, /stale: procedures\.sand/);
    assert.match(result.stdout, /missing: procedures\.cut/);
    assert.match(run('import', 'sentences.json', '--from', 'formatjs', '--merge', '--out', 'translations/procedures').stdout, /already has every message/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('import into a division records it in the tree\'s lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-import-division-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    await writeFile(path.join(root, 'en.json'), JSON.stringify({ sand: 'Sand it.' }));
    await writeFile(path.join(root, 'fr.json'), JSON.stringify({ sand: 'Poncez.' }));
    assert.equal(run('import', 'en.json', 'fr.json', '--from', 'formatjs', '--out', 'translations/procedures').status, 0);
    assert.deepEqual(await readdir(path.join(root, 'translations/procedures')), ['i18n-en.md', 'i18n-fr.md']);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(root, 'translations/i18nmd.lock.json'), 'utf8')).translations.fr), ['procedures.sand']);
    await writeFile(path.join(root, 'translations/procedures/i18n-en.md'), (await readFile(path.join(root, 'translations/procedures/i18n-en.md'), 'utf8')).replace('Sand it.', 'Sand it smooth.'));
    assert.match(run('status').stdout, /stale: procedures\.sand/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('accept records translations edited before a sync; compile --only picks divisions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'i18nmd-accept-'));
  try {
    const file = (name, entries) => `# ${name}\n\n${entries.map(([key, text]) => `## ${key}\n\n\`\`\`icu\n${text}\n\`\`\`\n`).join('\n')}`;
    const write = (division, locale, name, entries) => mkdir(path.join(root, 'translations', division), { recursive: true }).then(() => writeFile(path.join(root, 'translations', division, `i18n-${locale}.md`), file(name, entries)));
    await write('chat', 'en', 'English', [['hi', 'Hi'], ['bye', 'Bye']]);
    await write('chat', 'fr', 'Français', [['hi', 'Salut'], ['bye', 'Au revoir']]);
    await write('site', 'en', 'English', [['title', 'Welcome']]);
    await write('site', 'fr', 'Français', [['title', 'Bienvenue']]);
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(run('sync').status, 0);
    // The source and its translations change together, with no sync between.
    await write('chat', 'en', 'English', [['hi', 'Hello there'], ['bye', 'Goodbye']]);
    await write('chat', 'fr', 'Français', [['hi', 'Bonjour'], ['bye', 'Au revoir']]);
    let result = run('sync');
    assert.match(result.stdout, /fr: chat\.hi is stale; its source text changed\. Its translation was edited too; if that was for the new text, run i18nmd accept chat\.hi --only fr/);
    assert.match(result.stdout, /fr: chat\.bye is stale; its source text changed\n/);
    result = run('accept', 'chat.hi', '--only', 'fr');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Accepted 1 translation as current/);
    assert.match(run('status').stdout, /Français \(fr\): 2\/3 done, 1 stale\n  stale: chat\.bye/);
    assert.equal(run('accept', 'chat.*').status, 0);
    assert.match(run('status').stdout, /Français \(fr\): 3\/3 done/);
    assert.match(run('accept', 'chat.nope').stderr, /No token chat\.nope/);
    assert.match(run('accept', 'chat.hi', '--only', 'de').stderr, /No de translations/);

    result = run('compile', '--target', 'python', '--only', 'chat', '--out', 'py');
    assert.equal(result.status, 0, result.stderr);
    const python = await readFile(path.join(root, 'py/i18n.py'), 'utf8');
    assert.match(python, /"chat\.hi"/);
    assert.doesNotMatch(python, /site\.title/);
    assert.match(run('compile', '--only', 'chat', '--skip', 'site').stderr, /either --only or --skip/);
    assert.match(run('compile', '--only', 'blog').stderr, /No division blog/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
