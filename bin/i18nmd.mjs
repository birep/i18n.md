#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, stat, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseCatalog, serializeCatalog, parseLanguageFiles, languageFromFilename, renameToken, textOf, divisionOf, namespaceFor, accessorFor } from '../lib/catalog.mjs';
import { generateModule, generateModules, divisionFile, runtimeTypes } from '../lib/compiler.mjs';
import { extractSource, missingDivisionImports } from '../lib/extractor.mjs';
import { lockPathFor, findLock, namedRoot, readLock, serializeLock, report, syncLock, markCurrent } from '../lib/lock.mjs';
import { resolveLanguage, topLanguages, RANKED } from '../lib/languages.mjs';
import { llmConfig, translateLanguage } from '../lib/llm.mjs';
import { importMessages, exportMessages, FORMATS } from '../lib/interop.mjs';

const help = `i18nmd — one Markdown file per language

Translate with an LLM
  i18nmd --add french [--add pirate ...]   Create and translate new languages.
  i18nmd --top 10                          Add the 10 most widely spoken languages.
  i18nmd translate [--only fr,de]          Fill missing and outdated translations.
      Endpoint: I18NMD_BASE_URL + I18NMD_API_KEY (+ I18NMD_MODEL), or ANTHROPIC_API_KEY,
      or OPENAI_API_KEY. Flags: --base-url --model --provider anthropic|openai --batch 40
      --dry-run (list the work without calling the API).

Keep files in shape
  status                                   Progress per language: done, missing, stale.
  sync                                     Update i18nmd.lock.json; drop tokens the source removed.
  check [--strict] [--in src [--fix]]      Validate; --strict fails on anything missing or stale;
                                           --in checks code imports each division it calls and
                                           lists tokens it never calls (--skip division,...).
  rename <old> <new> [--in src]            Rename a token everywhere, including source code calls.
  join --out all.md / split <all.md> --out <dir>
                                           One Markdown file with every language, and back.

Build
  compile [--out src/i18n] [--target ts|js|json|python] [--skip division,...] [--eager]
  extract <src...> [--out translations/<division>] [--in-place] [--runtime src/i18n/i18n]
          [--source en] [--locale-expr locale]

Other tools
  import <files.json...> --from ${FORMATS.join('|')} [--out translations] [--source en]
  export --to ${FORMATS.join('|')} --out <dir>
  import-python <module.py> --out <dir>
  languages                                The ranked language list used by --top.

Commands find the translations directory (translations/, i18n/, locales/ or .) unless
--dir or a path is given. Subdirectories are divisions (ui/, marketing/, ...) with their
own i18n-<language>.md files; pass one to work on that division alone. A joined .md file
works wherever a directory does. The source language is recorded in i18nmd.lock.json;
--source overrides it. i18nmd --version prints the version.
`;

function python(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(error.trim() || `Python exited ${code}.`)));
  });
}

async function filesAt(input) {
  if (!(await stat(input)).isDirectory()) return /\.(?:[cm]?[jt]sx?)$/.test(input) ? [input] : [];
  const files = [];
  for (const entry of (await readdir(input, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'vendor', 'coverage'].includes(entry.name)) continue;
    const file = path.join(input, entry.name);
    if (entry.isDirectory()) files.push(...await filesAt(file));
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(file) && !/\.(test|spec)\.[jt]sx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file)) files.push(file);
  }
  return files;
}

async function save(file, text) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); }
const exists = file => stat(file).then(() => true, () => false);
const isDirectory = file => stat(file).then(s => s.isDirectory(), () => false);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Language files keyed by their path relative to dir; subdirectories are divisions.
async function readLanguageFiles(dir, prefix = '') {
  const files = Object.create(null);
  for (const entry of (await readdir(path.join(dir, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile() && /^i18n-.+\.md$/.test(entry.name)) files[name] = await readFile(path.join(dir, name), 'utf8');
    else if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'build', 'vendor', 'coverage'].includes(entry.name)) Object.assign(files, await readLanguageFiles(dir, name));
  }
  return files;
}
const fileFor = (division, locale) => `${division ? `${division}/` : ''}i18n-${locale}.md`;

async function findTranslations(required = true) {
  for (const dir of ['translations', 'i18n', 'locales', '.']) {
    if (await isDirectory(dir) && Object.keys(await readLanguageFiles(dir)).length) return dir;
  }
  if (required) throw new Error('No i18n-<language>.md files found. Pass a directory, or run i18nmd extract first.');
}

// The division a directory is within the translations tree (the directory with
// the lock, or a translations/, i18n/ or locales/ directory), so its tokens keep
// their full names when it is opened alone: translations/ui → "ui".
async function divisionPrefix(dir, lockFile) {
  for (const root of [path.dirname(lockFile), namedRoot(dir)]) {
    if (!root) continue;
    const relative = path.relative(path.resolve(root), path.resolve(dir));
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
  }
  return '';
}

// The translation files, their lock, and how to write them back.
async function open(input, options) {
  input ||= options.dir || await findTranslations();
  const directory = await isDirectory(input);
  const { file: lockFile, partial } = directory ? await findLock(input) : { file: lockPathFor(input, false), partial: false };
  const lock = await readLock(lockFile);
  const strict = !!options.strict;
  const raw = directory ? await readLanguageFiles(input) : { [input]: await readFile(input, 'utf8') };
  const catalog = directory
    ? parseLanguageFiles(raw, { source: options.source || lock.source, syntax: options.syntax || 'icu', strict, prefix: await divisionPrefix(input, lockFile) })
    : parseCatalog(raw[input], { filename: input, syntax: options.syntax, allowIncomplete: !strict, lenient: !strict });
  catalog.orphans ||= {};
  catalog.divisions ||= [''];
  let queue = Promise.resolve();
  const ws = {
    input, directory, lockFile, partial, lock, catalog, raw,
    rows: () => report(catalog, lock),
    // missing: false leaves out "N tokens missing" lines when a per-language summary follows.
    warn: ({ missing = false } = {}) => { for (const warning of catalog.warnings || []) if (missing || !/ tokens? missing \(falls back/.test(warning)) console.warn(`i18nmd: ${warning}`); },
    // Writes are queued so concurrent translations never interleave.
    write: (locale, { dropOrphans = false } = {}) => queue = queue.then(async () => {
      if (!directory) await save(input, serializeCatalog(catalog, { allowIncomplete: true }));
      else for (const division of catalog.divisions) {
        // Files hold short names; the division's namespace is implied by where they are.
        const namespace = namespaceFor(division, catalog.prefix);
        const local = list => list.filter(m => (m.division || '') === division).map(m => ({ ...m, key: m.key.slice(namespace.length) }));
        const messages = local(catalog.messages);
        const orphans = dropOrphans ? [] : local(catalog.orphans[locale] || []);
        const name = fileFor(division, locale);
        // A division gets a file for this language once it has something in it.
        if (!Object.hasOwn(raw, name) && !orphans.length && !messages.some(m => textOf(m, locale) !== undefined)) continue;
        let text = serializeCatalog({ ...catalog, messages }, { locale, allowIncomplete: true });
        if (orphans.length) text += serializeCatalog({ source: locale, syntax: catalog.syntax, languages: { [locale]: catalog.languages[locale] }, messages: orphans }, { locale }).replace(/^# .*\n\n/, '');
        await save(path.join(input, name), text);
      }
      lock.source = catalog.source;
      await save(lockFile, serializeLock(lock));
    }),
    saveLock: () => queue = queue.then(() => { lock.source = catalog.source; return save(lockFile, serializeLock(lock)); }),
  };
  return ws;
}

function summary(row) {
  const parts = [`${row.done}/${row.total} done`];
  if (row.missing.length) parts.push(`${row.missing.length} missing`);
  if (row.stale.length) parts.push(`${row.stale.length} stale`);
  return `${row.name} (${row.locale}): ${parts.join(', ')}`;
}

async function translate(ws, targets, options) {
  const { catalog, lock } = ws;
  const work = [];
  for (const target of targets) {
    if (target.code === catalog.source) continue;
    const isNew = !Object.hasOwn(catalog.languages, target.code);
    const row = isNew ? undefined : ws.rows().find(r => r.locale === target.code);
    const keys = isNew ? catalog.messages.map(m => m.key) : [...row.missing, ...row.stale];
    if (!isNew) target.name = catalog.languages[target.code];
    if (keys.length) work.push({ target, keys, isNew });
    else console.log(`${target.name} (${target.code}) is up to date.`);
  }
  if (!work.length) return;
  for (const { target, keys, isNew } of work) console.log(`${target.name} (${target.code}): ${plural(keys.length, 'message')} to translate${isNew ? ' (new language)' : ''}`);
  if (options['dry-run']) return;
  const config = llmConfig(options);
  console.log(`Using ${config.model} at ${config.baseUrl}.`);
  const batchSize = Number(options.batch || 40);
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('--batch must be a positive whole number.');
  let failures = 0;
  const run = async ({ target, keys, isNew }) => {
    if (isNew) catalog.languages[target.code] = target.name;
    let done = 0;
    const failed = await translateLanguage(catalog, target, keys, config, {
      batchSize,
      onBatch: async ok => {
        for (const message of catalog.messages) {
          if (!Object.hasOwn(ok, message.key)) continue;
          message.translations[target.code] = ok[message.key];
          if (message.invalid) delete message.invalid[target.code];
          markCurrent(catalog, lock, target.code, message);
          done++;
        }
        if (Object.keys(ok).length) await ws.write(target.code);
        console.log(`  ${target.code}: ${done}/${keys.length}`);
      },
    });
    for (const [key, error] of Object.entries(failed)) { failures++; console.warn(`i18nmd: ${target.code} ${key}: ${error}`); }
    if (isNew && !done) delete catalog.languages[target.code];
  };
  // A few languages at a time keeps within typical rate limits.
  const pending = [...work];
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => { while (pending.length) await run(pending.shift()); }));
  if (failures) { process.exitCode = 1; console.warn(`i18nmd: ${plural(failures, 'message')} could not be translated; they fall back to ${catalog.source}. Run i18nmd translate to retry.`); }
}

function localeFromJsonPath(file) {
  const base = path.basename(file, '.json');
  try { if (/^[a-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/.test(base)) return { locale: Intl.getCanonicalLocales(base.replace(/_/g, '-'))[0] }; } catch { /* fall through */ }
  return { locale: Intl.getCanonicalLocales(path.basename(path.dirname(file)).replace(/_/g, '-'))[0], namespace: base };
}

async function main() {
  let argv = process.argv.slice(2);
  if (argv[0] === '--add') argv = ['add', ...argv.slice(1)];
  if (argv[0] === '--top') argv = ['top', ...argv.slice(1)];
  const [command, ...rest] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(help); return; }
  if (['--version', '-v', 'version'].includes(command)) { console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version); return; }
  const aliases = { locale: 'source', language: 'locale-expr' };
  const valued = /^(skip|out|source|locale|language|locale-expr|dest|runtime|target|table|languages|syntax|in|from|to|model|base-url|provider|batch|only|dir)$/;
  const options = Object.create(null), positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--add' && command === 'add') continue;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    let flag = arg.slice(2);
    if (!valued.test(flag) && !['merge', 'strict', 'dry-run', 'in-place', 'eager', 'fix'].includes(flag)) throw new Error(`Unknown option: ${arg}`);
    flag = aliases[flag] || flag;
    if (Object.hasOwn(options, flag)) throw new Error(`Duplicate option: ${arg}`);
    if (!valued.test(flag)) options[flag] = true;
    else { if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Supply a value for ${arg}.`); options[flag] = rest[++i]; }
  }
  const one = () => { if (positional.length > 1) throw new Error(`${command} takes at most one path.`); return positional[0]; };

  if (command === 'languages') {
    RANKED.forEach((code, i) => { const l = resolveLanguage(code); console.log(`${String(i + 1).padStart(2)}. ${code.padEnd(4)} ${l.english} — ${l.name}`); });
    return;
  }
  if (command === 'add' || command === 'top') {
    if (!positional.length) throw new Error(command === 'add' ? 'Name a language: i18nmd --add french' : 'Give a number: i18nmd --top 10');
    const ws = await open(undefined, options); ws.warn();
    const targets = command === 'top' ? topLanguages(Number(positional[0])).map(resolveLanguage) : positional.map(resolveLanguage);
    await translate(ws, targets, options); return;
  }
  if (command === 'translate') {
    const ws = await open(one(), options); ws.warn();
    const only = options.only?.split(',').map(s => resolveLanguage(s).code);
    const targets = Object.keys(ws.catalog.languages).filter(l => l !== ws.catalog.source && (!only || only.includes(l))).map(code => ({ ...resolveLanguage(code), code, name: ws.catalog.languages[code] }));
    await translate(ws, targets, options); return;
  }
  if (command === 'check') {
    const ws = await open(one(), options); ws.warn();
    if (options.strict) {
      const pending = ws.rows().filter(row => row.missing.length || row.stale.length);
      if (pending.length) throw new Error(pending.map(summary).join('; ') + '.');
    }
    console.log(`Validated ${ws.catalog.messages.length} tokens in ${Object.keys(ws.catalog.languages).length} languages.`);
    // --in: code that calls a division imports that division's messages.
    if (options.in) {
      const accessors = Object.create(null), namespaces = Object.create(null);
      for (const division of ws.catalog.divisions.filter(Boolean)) {
        const namespace = namespaceFor(division, ws.catalog.prefix || '');
        accessors[accessorFor(namespace)] = namespaces[namespace] = divisionFile(namespace.slice(0, -1).replace(/\./g, '/'));
      }
      let problems = 0, fixed = 0, dynamic = 0;
      const used = new Set();
      for (const file of await filesAt(options.in)) {
        const text = await readFile(file, 'utf8');
        const scan = missingDivisionImports(text, { accessors, namespaces, filename: file });
        scan.used.forEach(token => used.add(token)); dynamic += scan.dynamic;
        const { missing, fix } = scan;
        if (!missing.length) continue;
        if (options.fix) { await save(file, fix); fixed++; continue; }
        problems += missing.length;
        for (const m of missing) console.error(`${file}:${m.line}: uses the ${m.division} division without its messages; add ${m.statement}`);
      }
      if (fixed) console.log(`Added division imports to ${plural(fixed, 'file')}.`);
      // Tokens no code calls by name: left behind when code changed or moved division.
      // --skip: divisions other code uses (a server's replies), as in compile.
      const skipped = (options.skip || '').split(',').map(d => d.trim().replace(/\/+$/, '')).filter(Boolean);
      const unused = ws.catalog.messages.filter(m => !skipped.some(d => m.division === d || m.division?.startsWith(d + '/'))).map(m => m.key).filter(key => !used.has(key));
      if (unused.length) console.warn(`i18nmd: ${plural(unused.length, 'token')} not called under ${options.in}${dynamic ? ` (${plural(dynamic, 'call')} there compute their token, so some may be in use)` : ''}: ${unused.length > 12 ? unused.slice(0, 12).join(', ') + ', …' : unused.join(', ')}`);
      if (problems) throw new Error(`${plural(problems, 'missing division import')}. Run i18nmd check --in ${options.in} --fix to add them.`);
      console.log(`Every i18nmd call under ${options.in} imports its division.`);
    }
    return;
  }
  if (command === 'status') {
    const ws = await open(one(), options);
    const orphans = Object.entries(ws.catalog.orphans).filter(([, list]) => list.length);
    console.log(`${ws.catalog.languages[ws.catalog.source]} (${ws.catalog.source}): ${ws.catalog.messages.length} tokens, source`);
    for (const row of ws.rows()) {
      console.log(summary(row));
      for (const kind of ['stale', 'missing']) if (row[kind].length && row[kind].length <= 10) console.log(`  ${kind}: ${row[kind].join(', ')}`);
    }
    for (const [locale, list] of orphans) console.log(`${locale}: ${list.map(m => m.key).join(', ')} not in the source; sync removes them.`);
    if (ws.catalog.divisions.length > 1) {
      console.log('\nBy division:');
      for (const division of ws.catalog.divisions) {
        const messages = ws.catalog.messages.filter(m => m.division === division);
        const rows = report({ ...ws.catalog, messages }, ws.lock).map(row => `${row.locale} ${row.done}/${row.total}`);
        console.log(`  ${division || './'}: ${plural(messages.length, 'token')}${rows.length ? `; ${rows.join(', ')}` : ''}`);
      }
    }
    return;
  }
  if (command === 'sync') {
    const ws = await open(one(), options);
    const changes = syncLock(ws.catalog, ws.lock, { partial: ws.partial });
    let rewritten = 0;
    for (const locale of Object.keys(ws.catalog.languages)) {
      if (locale === ws.catalog.source) continue;
      const removed = ws.catalog.orphans[locale] || [];
      removed.forEach(m => changes.push(`${locale}: removed ${m.key}; the source no longer has it`));
      const legacy = Object.entries(ws.raw).some(([name, text]) => (!ws.directory || path.basename(name) === `i18n-${locale}.md`) && /^(Status|Source)( [\w-]+)?: /m.test(text));
      if (removed.length || legacy) { await ws.write(locale, { dropOrphans: true }); rewritten++; }
    }
    await ws.saveLock();
    changes.forEach(change => console.log(change));
    console.log(`Synced ${ws.lockFile}${rewritten ? ` and ${plural(rewritten, 'language file')}` : ''}; ${plural(changes.length, 'change')}.`);
    for (const row of ws.rows()) if (row.missing.length || row.stale.length) console.log(summary(row));
    return;
  }
  if (command === 'compile') {
    options.out ||= 'src/i18n';
    const ws = await open(one(), options); ws.warn({ missing: false });
    // --skip leaves out divisions another program uses, such as server-only replies.
    const skipped = (options.skip || '').split(',').map(d => d.trim().replace(/\/+$/, '')).filter(Boolean);
    for (const division of skipped) if (!ws.catalog.divisions.some(d => d === division || d.startsWith(division + '/'))) throw new Error(`No division ${division} to skip.`);
    const messages = ws.catalog.messages.filter(m => !skipped.some(d => m.division === d || m.division?.startsWith(d + '/')));
    // A language ships once it has a translation here; one only skipped divisions have stays out.
    const languages = Object.fromEntries(Object.entries(ws.catalog.languages).filter(([l]) => l === ws.catalog.source || messages.some(m => Object.hasOwn(m.translations, l))));
    const catalog = { ...ws.catalog, languages, messages };
    for (const row of report(catalog, ws.lock)) if (row.missing.length || row.stale.length) console.warn(`i18nmd: ${summary(row)}`);
    const target = options.target || 'ts';
    if (!['ts', 'js'].includes(target)) {
      const filename = { json: 'messages.json', python: 'i18n.py' }[target];
      if (!filename) throw new Error(`Unknown output target: ${target}`);
      await save(path.join(options.out, filename), generateModule(catalog, target));
      console.log(`Compiled ${plural(catalog.messages.length, 'token')} to ${path.join(options.out, filename)}.`); return;
    }
    const files = generateModules(catalog, { target, eager: !!options.eager });
    files['runtime.mjs'] = '/* eslint-disable */\n' + await readFile(new URL('../lib/runtime.mjs', import.meta.url), 'utf8');
    files['runtime.d.mts'] = runtimeTypes;
    // Files an earlier compile wrote that this one does not (a renamed division, a
    // removed language) would linger in the build; generated files say so on line 1.
    const stale = [];
    for (const dir of [options.out, path.join(options.out, 'languages')]) {
      for (const entry of await readdir(dir).catch(() => [])) {
        const file = path.join(dir, entry), name = path.relative(options.out, file).split(path.sep).join('/');
        if (Object.hasOwn(files, name) || !/\.(?:ts|mjs)$/.test(entry)) continue;
        if ((await readFile(file, 'utf8')).startsWith('// Generated from i18n.md.')) stale.push(file);
      }
    }
    for (const [name, text] of Object.entries(files)) await save(path.join(options.out, name), text);
    for (const file of stale) await rm(file);
    const divisions = Object.keys(files).filter(n => !/^(?:i18n|language|runtime)\.|^languages\//.test(n) && !n.endsWith('.d.mts')).length;
    console.log(`Compiled ${plural(catalog.messages.length, 'token')} into ${options.out}: ${plural(divisions, 'division module')}, ${plural(Object.keys(catalog.languages).length - 1, 'language chunk')}${options.eager ? ' (eager)' : ''}.`); return;
  }
  if (command === 'join') {
    if (!options.out || !/\.md$/.test(options.out)) throw new Error('Choose the joined Markdown file with --out, e.g. --out translations.md.');
    const ws = await open(one(), options);
    if (!ws.directory) throw new Error('join reads a directory of i18n-<language>.md files.');
    if (ws.catalog.divisions.length > 1) throw new Error(`${ws.input} has several divisions (${ws.catalog.divisions.map(d => d || './').join(', ')}); join one at a time, e.g. i18nmd join ${path.join(ws.input, ws.catalog.divisions.find(Boolean))} --out all.md.`);
    if (Object.values(ws.catalog.orphans).some(list => list.length)) throw new Error('Some languages have tokens the source lacks. Run sync or rename first so nothing is lost.');
    await save(options.out, serializeCatalog(ws.catalog, { allowIncomplete: true }));
    if (await exists(ws.lockFile)) await copyFile(ws.lockFile, lockPathFor(options.out, false));
    console.log(`Joined ${plural(Object.keys(ws.catalog.languages).length, 'language')} into ${options.out}.`); return;
  }
  if (command === 'split') {
    const input = one();
    if (!input || !options.out) throw new Error('Usage: i18nmd split all.md --out <directory>');
    const text = await readFile(input, 'utf8');
    if (!text.startsWith('---')) throw new Error(`${input} is already a single-language file.`);
    const catalog = parseCatalog(text, { allowIncomplete: true, lenient: true, syntax: options.syntax });
    for (const locale of Object.keys(catalog.languages)) await save(path.join(options.out, `i18n-${locale}.md`), serializeCatalog(catalog, { locale, allowIncomplete: true }));
    if (await exists(lockPathFor(input, false))) await copyFile(lockPathFor(input, false), lockPathFor(options.out, true));
    console.log(`Split ${input} into ${plural(Object.keys(catalog.languages).length, 'file')} in ${options.out}.`); return;
  }
  if (command === 'rename') {
    if (positional.length < 2 || positional.length > 3) throw new Error('Usage: i18nmd rename [dir] <old_token> <new_token>');
    const [from, to] = positional.slice(-2);
    const input = positional.length === 3 ? positional[0] : options.dir || await findTranslations();
    const directory = await isDirectory(input);
    const lockFile = directory ? (await findLock(input)).file : lockPathFor(input, false);
    const prefix = directory ? await divisionPrefix(input, lockFile) : '';
    const targets = [];
    for (const name of directory ? Object.keys(await readLanguageFiles(input)) : [input]) {
      const file = directory ? path.join(input, name) : input;
      const text = await readFile(file, 'utf8');
      const catalog = parseCatalog(text, { filename: file, syntax: options.syntax, allowIncomplete: true, lenient: true });
      const namespace = directory ? namespaceFor(divisionOf(name), prefix) : '';
      const keys = catalog.messages.map(m => namespace + m.key);
      if (keys.includes(to)) throw new Error(`Token ${to} already exists in ${file}.`);
      if (keys.includes(from)) targets.push({ file, text, catalog, namespace });
    }
    let renamed = 0;
    for (const { file, text, catalog, namespace } of targets) {
      if (!to.startsWith(namespace)) throw new Error(`${from} is in ${path.dirname(file)}; a new name must keep its ${namespace.slice(0, -1)} namespace. To move it to another division, move its blocks between files.`);
      const joined = text.startsWith('---');
      renameToken(catalog, from.slice(namespace.length), to.slice(namespace.length));
      await save(file, serializeCatalog(catalog, joined ? { allowIncomplete: true } : { locale: catalog.source }));
      renamed++;
    }
    if (!renamed) throw new Error(`No language file contains ${from}.`);
    if (await exists(lockFile)) {
      const lock = await readLock(lockFile);
      for (const entries of Object.values(lock.translations)) if (Object.hasOwn(entries, from)) { entries[to] = entries[from]; delete entries[from]; }
      await save(lockFile, serializeLock(lock));
    }
    let code = 0;
    if (options.in) {
      // Calls name the token by its full name, i18nmd("ui.save"), or by its short name
      // on the division, i18nmd.ui("save") or i18nmd.in(locale).ui("save").
      const { namespace } = targets[0];
      const escape = text => text.replace(/[.\-$()]/g, '\\$&');
      const forms = [['', from, to]];
      if (namespace) forms.push([accessorFor(namespace), from.slice(namespace.length), to.slice(namespace.length)]);
      const calls = forms.map(([accessor, old, renamed]) => [new RegExp(`(\\bi18nmd(?:\\.in\\([^()]*\\))?${escape(accessor)}\\(\\s*)(['"\`])${escape(old)}\\2`, 'g'), renamed]);
      for (const file of await filesAt(options.in)) {
        const source = await readFile(file, 'utf8');
        let updated = source;
        for (const [call, renamed] of calls) updated = updated.replace(call, (_, prefix, quote) => { code++; return `${prefix}${quote}${renamed}${quote}`; });
        if (updated !== source) await save(file, updated);
      }
    }
    console.log(`Renamed ${from} to ${to} in ${plural(renamed, 'language file')}${options.in ? ` and ${plural(code, 'source call')}` : ''}.`); return;
  }
  if (command === 'import') {
    if (!positional.length) throw new Error(`Usage: i18nmd import <files.json...> --from ${FORMATS.join('|')}`);
    if (!options.from) throw new Error(`Choose the format with --from ${FORMATS.join('|')}.`);
    const out = options.out || 'translations';
    const warnings = [];
    const byLocale = new Map();
    const files = positional.map(file => ({ file, ...localeFromJsonPath(file) }));
    const namespaces = new Set(files.map(f => f.namespace).filter(Boolean));
    for (const { file, locale, namespace } of files) {
      const prefix = namespaces.size > 1 && namespace ? `${namespace}.` : '';
      const list = byLocale.get(locale) || [];
      for (const message of importMessages(JSON.parse(await readFile(file, 'utf8')), options.from, warnings)) list.push({ ...message, key: prefix + message.key });
      byLocale.set(locale, list);
    }
    const source = options.source || (byLocale.has('en') ? 'en' : [...byLocale.keys()][0]);
    if (!byLocale.has(source)) throw new Error(`No ${source} file among the inputs; pick one with --source.`);
    const languages = Object.fromEntries([source, ...[...byLocale.keys()].filter(l => l !== source)].map(l => [l, resolveLanguage(l).name]));
    const messages = byLocale.get(source).map(m => ({ key: m.key, context: m.context, optional: [], translations: { [source]: m.text } }));
    const index = new Map(messages.map(m => [m.key, m]));
    for (const [locale, list] of byLocale) {
      if (locale === source) continue;
      for (const m of list) {
        const target = index.get(m.key);
        if (!target) warnings.push(`${locale}: ${m.key} is not in ${source}; skipped.`);
        else { target.translations[locale] = m.text; target.context ||= m.context; }
      }
    }
    const catalog = { title: 'Translations', source, syntax: 'icu', languages, messages };
    const { validateCatalog } = await import('../lib/catalog.mjs');
    validateCatalog(catalog, { allowIncomplete: true, lenient: true });
    for (const locale of Object.keys(languages)) {
      const file = path.join(out, `i18n-${locale}.md`);
      if (await exists(file)) throw new Error(`${file} exists; import into an empty directory.`);
    }
    for (const locale of Object.keys(languages)) await save(path.join(out, `i18n-${locale}.md`), serializeCatalog(catalog, { locale, allowIncomplete: true }));
    const lock = { source, translations: {} };
    syncLock(catalog, lock);
    await save(lockPathFor(out, true), serializeLock(lock));
    [...warnings, ...(catalog.warnings || [])].forEach(w => console.warn(`i18nmd: ${w}`));
    console.log(`Imported ${plural(messages.length, 'token')} in ${plural(Object.keys(languages).length, 'language')} into ${out}.`); return;
  }
  if (command === 'export') {
    if (!options.to || !options.out) throw new Error(`Usage: i18nmd export --to ${FORMATS.join('|')} --out <directory>`);
    const ws = await open(one(), options); ws.warn();
    const warnings = [];
    for (const locale of Object.keys(ws.catalog.languages)) {
      const json = exportMessages(ws.catalog, locale, options.to, locale === ws.catalog.source ? warnings : []);
      const file = options.to === 'i18next' ? path.join(options.out, locale, 'translation.json') : path.join(options.out, `${locale}.json`);
      await save(file, JSON.stringify(json, null, 2) + '\n');
    }
    warnings.forEach(w => console.warn(`i18nmd: ${w}`));
    console.log(`Exported ${plural(Object.keys(ws.catalog.languages).length, 'language')} for ${options.to} into ${options.out}.`); return;
  }
  if (command === 'import-python') {
    if (!options.out) throw new Error('Choose the output directory with --out.');
    const input = one();
    const imported = JSON.parse(await python([fileURLToPath(new URL('../scripts/python_catalog.py', import.meta.url)), input, options.table || '_T', options.languages || 'LANGS']));
    for (const locale of Object.keys(imported.languages)) await save(path.join(options.out, `i18n-${locale}.md`), serializeCatalog(imported, { locale }));
    console.log(`Imported ${imported.messages.length} tokens in ${Object.keys(imported.languages).length} languages into ${options.out}.`); return;
  }
  if (command === 'extract') {
    if (!positional.length) throw new Error('Usage: i18nmd extract <src...> [--out translations/<division>] [--in-place]');
    options.out ||= (await findTranslations(false)) || 'translations';
    const locale = options.source || (/\.md$/.test(options.out) ? languageFromFilename(options.out) : 'en');
    const sourceFile = /\.md$/.test(options.out) ? options.out : path.join(options.out, `i18n-${locale}.md`);
    const outDir = path.dirname(sourceFile);
    const namespace = namespaceFor(await divisionPrefix(outDir, (await findLock(outDir)).file));
    if (languageFromFilename(sourceFile) !== locale) throw new Error('The output filename must match --source.');
    const files = [...new Set((await Promise.all(positional.map(filesAt))).flat())];
    if (!files.length) throw new Error('No JavaScript or TypeScript source files found.');
    // The deepest directory holding every input; converted copies keep their paths below it.
    const dirs = await Promise.all(positional.map(async input => (await isDirectory(input)) ? path.resolve(input) : path.dirname(path.resolve(input))));
    let root = dirs[0];
    while (!dirs.every(dir => dir === root || dir.startsWith(root + path.sep))) root = path.dirname(root);
    // --in-place rewrites the sources themselves, for code under version control.
    if (options['in-place'] && options.dest) throw new Error('Use either --in-place or --dest.');
    const destination = options['in-place'] ? root : path.resolve(options.dest || '.i18n/src');
    if (!options['in-place'] && (destination === root || destination.startsWith(root + path.sep))) throw new Error('The destination must be outside the input tree so repeated extraction cannot read its own output. Use --in-place to rewrite the sources.');
    // Code imports i18nmd from its division's generated module (src/i18n/ui), or from
    // src/i18n/i18n for top-level tokens; --runtime names the latter.
    // The default matches compile's default --out, src/i18n.
    const main = path.resolve(options.runtime || 'src/i18n/i18n');
    const runtime = namespace ? path.join(path.dirname(main), divisionFile(namespace.slice(0, -1).replace(/\./g, '/'))) : main;
    // Existing tokens are always kept, so extraction can be repeated as code changes.
    let catalog = await exists(sourceFile) ? parseCatalog(await readFile(sourceFile, 'utf8'), { filename: sourceFile }) : undefined;
    const outputs = [];
    let replacements = 0;
    for (const file of files) {
      const relative = path.relative(root, path.resolve(file));
      const output = path.join(destination, relative);
      let importPath = path.relative(path.dirname(output), runtime).split(path.sep).join('/');
      if (!importPath.startsWith('.')) importPath = './' + importPath;
      const result = extractSource(await readFile(file, 'utf8'), { filename: path.relative(process.cwd(), file), locale, languageExpression: options['locale-expr'], existing: catalog, importPath, namespace });
      catalog = result.catalog; replacements += result.replacements;
      result.diagnostics.forEach(message => console.warn(message));
      if (result.replacements) outputs.push([output, result.source]);
    }
    // The lock marks the top of the translations tree, so divisions keep their names.
    const lockFile = (await findLock(outDir)).file;
    if (!(await exists(lockFile))) await save(lockFile, serializeLock({ source: locale, translations: {} }));
    if (!replacements) { console.log(`Nothing new to extract from ${plural(files.length, 'file')}. Mark other display strings with /* i18n */.`); return; }
    const markdown = serializeCatalog(catalog, { locale });
    for (const [file, text] of outputs) await save(file, text);
    await save(sourceFile, markdown);
    console.log(`Extracted ${plural(replacements, 'string')} into ${sourceFile}; ${options['in-place'] ? `rewrote ${plural(outputs.length, 'file')}` : `converted copies are in ${destination}`}.\nRun i18nmd translate to fill the other languages, or i18nmd status to see what changed.`); return;
  }
  throw new Error(`Unknown command: ${command}. Run i18nmd --help.`);
}

main().catch(error => { console.error(`i18nmd: ${error.message}`); process.exitCode = 1; });
