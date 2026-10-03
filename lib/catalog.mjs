import { argumentsFor, parseMessage } from './messages.mjs';

/** Short, stable fingerprint of a source message, recorded beside each translation. */
export function hashMessage(text) {
  let hash = 2166136261;
  for (const c of text) { hash ^= c.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/** A readable name for a language code, in that language when the host knows it. */
export function languageName(locale) {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(locale);
    if (name) return name[0].toLocaleUpperCase(locale) + name.slice(1);
  } catch { /* Custom identifiers such as pirate have no display name. */ }
  return locale;
}

export function parseCatalog(markdown, options = {}) {
  markdown = markdown.replace(/\r\n/g, '\n');
  if (!markdown.startsWith('---')) {
    const locale = options.locale || (options.filename && languageFromFilename(options.filename));
    if (!locale) throw new Error('Supply the i18n-<language>.md filename for a language file.');
    const name = /^# (.+)$/m.exec(markdown)?.[1] || locale;
    const syntax = options.syntax || 'icu';
    let open;
    markdown = markdown.split('\n').map(line => {
      if (open) { if (line === open) open = undefined; return line; }
      const fence = /^(`{3,}|~{3,})([^\s]*)[ \t]*$/.exec(line);
      if (!fence) return line;
      if (fence[2] !== syntax && fence[2] !== locale) throw new Error(`Use a ${syntax} message block in ${locale}.`);
      open = fence[1];
      return open + locale;
    }).join('\n');
    // One file can't tell whether it is the source, so optional placeholders are checked once files are merged.
    return parseCatalog(`---\nsource: ${locale}\nsyntax: ${syntax}\nlanguages: ${JSON.stringify({ [locale]: name })}\n---\n${markdown}`, { ...options, single: true });
  }
  const lines = markdown.split('\n');
  if (lines[0] !== '---') throw new Error('Start the file with the i18n.md metadata block.');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('The metadata block is not closed.');
  const metadata = Object.create(null);
  for (const line of lines.slice(1, end)) {
    const match = /^(source|syntax|languages):\s*(.+)$/.exec(line);
    if (!match || Object.hasOwn(metadata, match[1])) throw new Error(`Invalid or duplicate metadata: ${line}`);
    metadata[match[1]] = match[1] === 'languages' ? JSON.parse(match[2]) : match[2].trim();
  }
  const catalog = { ...metadata, title: 'Translations', messages: [] };
  let message;
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^# /.test(line)) { catalog.title = line.slice(2); continue; }
    if (/^## /.test(line)) {
      const key = line.slice(3).trim();
      if (!/^[a-zA-Z_]\w*(?:[.-]\w+)*$/.test(key)) throw new Error(`Invalid token: ${key}`);
      message = { key, context: '', optional: [], translations: Object.create(null) }; catalog.messages.push(message); continue;
    }
    if (/^Context: /.test(line) && message) { message.context = line.slice(9); continue; }
    if (/^Optional: /.test(line) && message) { message.optional = line.slice(10).split(',').map(v => v.trim()).filter(Boolean); continue; }
    // Status/Source lines from earlier versions now live in i18nmd.lock.json; ignore them.
    if (message && /^(Status|Source)(?: [\w-]+)?: \S+\s*$/.test(line)) continue;
    const fence = /^(`{3,}|~{3,})([\w-]+)\s*$/.exec(line);
    if (fence) {
      if (!message) throw new Error('A translation needs a ## token heading.');
      const locale = fence[2];
      if (Object.hasOwn(message.translations, locale)) throw new Error(`Duplicate ${locale} translation for ${message.key}.`);
      const content = [];
      while (++i < lines.length && lines[i] !== fence[1]) content.push(lines[i]);
      if (i === lines.length) throw new Error(`Unclosed translation fence for ${message.key}.`);
      message.translations[locale] = content.join('\n');
    } else if (/^(`{3,}|~{3,})/.test(line)) throw new Error(`Invalid translation fence: ${line}`);
  }
  validateCatalog(catalog, options); return catalog;
}

/**
 * Check every translation against the source message.
 * allowIncomplete: other languages may lack tokens (the runtime falls back).
 * lenient: a translation whose placeholders no longer match the source (usually
 * because the source changed) is set aside with a warning and the source text is
 * used, so an outdated translation never blocks a build. Its text is kept in
 * message.invalid so it is written back unchanged.
 */
export function validateCatalog(catalog, { allowIncomplete = false, lenient = false, single = false } = {}) {
  catalog.warnings ||= [];
  if (!['icu', 'python'].includes(catalog.syntax)) throw new Error('syntax must be icu or python.');
  if (!catalog.languages || typeof catalog.languages !== 'object' || Array.isArray(catalog.languages)) throw new Error('languages must be a JSON object mapping codes to names.');
  const locales = Object.keys(catalog.languages);
  if (!locales.length || !Object.hasOwn(catalog.languages, catalog.source)) throw new Error('Declare the source language in languages.');
  for (const locale of locales) {
    if (!/^[a-z][a-z0-9]*(?:-[a-zA-Z0-9]+)*$/.test(locale) || locale === '__proto__') throw new Error(`Invalid language identifier: ${locale}`);
    try {
      if (Intl.getCanonicalLocales(locale)[0] !== locale) throw new Error(`Use a canonical BCP 47 language code: ${locale}`);
    } catch (error) { if (!(error instanceof RangeError)) throw error; }
    if (typeof catalog.languages[locale] !== 'string' || !catalog.languages[locale].trim()) throw new Error(`Give ${locale} a language name.`);
  }
  if (!Array.isArray(catalog.messages) || !catalog.messages.length) throw new Error('The catalog has no messages.');
  const keys = new Set();
  for (const message of catalog.messages) {
    if (!/^[a-zA-Z_]\w*(?:[.-]\w+)*$/.test(message.key) || message.key === '__proto__') throw new Error(`Invalid token: ${message.key}`);
    if (keys.has(message.key)) throw new Error(`Duplicate token: ${message.key}`);
    keys.add(message.key);
    const table = message.translations;
    if (!table || typeof table !== 'object') throw new Error(`${message.key}: missing translations.`);
    for (const locale of Object.keys(table)) if (!Object.hasOwn(catalog.languages, locale)) throw new Error(`${message.key}: undeclared language ${locale}.`);
    const parsed = Object.create(null);
    for (const locale of locales) {
      if (!Object.hasOwn(table, locale) && allowIncomplete && locale !== catalog.source) continue;
      if (!Object.hasOwn(table, locale) || typeof table[locale] !== 'string' || !table[locale].trim()) throw new Error(`${message.key}: missing ${locale} translation.`);
      try { parsed[locale] = argumentsFor(parseMessage(table[locale], catalog.syntax)); }
      catch (error) { throw new Error(`${message.key} [${locale}]: ${error.message}`); }
    }
    const sourceArgs = parsed[catalog.source];
    const optional = message.optional || [];
    if (!single) for (const name of optional) if (!Object.hasOwn(sourceArgs, name)) throw new Error(`${message.key}: optional {${name}} is absent from the source.`);
    for (const locale of locales) {
      if (!parsed[locale]) continue;
      let problem;
      for (const name of Object.keys(sourceArgs)) if (!problem && !Object.hasOwn(parsed[locale], name) && !optional.includes(name)) problem = `missing ${sourceArgs[name] === 'tag' ? `<${name}>` : `{${name}}`}`;
      for (const [name, type] of Object.entries(parsed[locale])) {
        if (problem) break;
        const base = sourceArgs[name];
        if (!base) problem = `unknown placeholder ${type === 'tag' ? `<${name}>` : `{${name}}`}`;
        else if (base !== type && (base === 'tag' || type === 'tag' || (base !== 'string' && type !== 'string'))) problem = `incompatible type for {${name}}`;
      }
      if (!problem) continue;
      if (lenient && locale !== catalog.source) {
        (message.invalid ||= Object.create(null))[locale] = table[locale];
        delete table[locale];
        catalog.warnings.push(`${message.key} [${locale}]: ${problem}; using the ${catalog.source} text until it is updated.`);
      } else throw new Error(`${message.key} [${locale}]: ${problem}.`);
    }
  }
  return catalog;
}

export function serializeCatalog(catalog, options = {}) {
  validateCatalog(catalog, { allowIncomplete: true, single: Object.keys(catalog.languages || {}).length === 1, ...options });
  const locale = options.locale;
  if (locale && !Object.hasOwn(catalog.languages, locale)) throw new Error(`Unknown language: ${locale}`);
  let text = locale ? `# ${catalog.languages[locale]}\n\n` : `---\nsource: ${catalog.source}\nsyntax: ${catalog.syntax}\nlanguages: ${JSON.stringify(catalog.languages)}\n---\n\n# ${catalog.title || 'Translations'}\n\n`;
  if (!locale) text += 'Translate the language blocks below. Keep token names and placeholders intact. To add a language, add it to the metadata and add a block for every token. Context explains where each string appears. Optional placeholders may be omitted when the target language does not need them.\n\n';
  for (const message of catalog.messages) {
    const texts = Object.keys(catalog.languages).map(lang => [lang, textOf(message, lang)]).filter(([lang, value]) => value !== undefined && (!locale || lang === locale));
    if (locale && !texts.length) continue;
    text += `## ${message.key}\n\n`;
    if (message.context) text += `Context: ${message.context.replace(/\r?\n/g, ' ')}\n\n`;
    if (message.optional?.length) text += `Optional: ${message.optional.join(', ')}\n\n`;
    for (const [lang, value] of texts) {
      const max = Math.max(2, ...[...value.matchAll(/`+/g)].map(m => m[0].length));
      const fence = '`'.repeat(max + 1);
      text += `${fence}${locale ? catalog.syntax : lang}\n${value}\n${fence}\n\n`;
    }
  }
  return text.replace(/\n+$/, '\n');
}

/** The text written for a language, including one set aside as outdated. */
export function textOf(message, locale) {
  return Object.hasOwn(message.translations, locale) ? message.translations[locale] : message.invalid?.[locale];
}

export function languageFromFilename(filename) {
  const match = /^i18n-([a-z][a-zA-Z0-9-]*)\.md$/.exec(filename.split(/[\\/]/).pop());
  if (!match) throw new Error('Name language files i18n-<language>.md.');
  return match[1];
}

/** The division a language file belongs to: its directory, '' at the top level. */
export function divisionOf(filename) {
  return filename.split(/[\\/]/).slice(0, -1).join('/');
}

const where = division => division ? `${division}/` : '';

// Properties a division function cannot take: they exist on every function,
// or (in) is i18nmd's own.
const RESERVED = new Set(['in', 'name', 'length', 'call', 'apply', 'bind', 'prototype', 'caller', 'arguments', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']);

/** knowledge-hub → knowledgeHub: the property for a division directory. */
export function divisionProperty(segment) {
  const property = segment.replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
  if (RESERVED.has(property)) throw new Error(`A division cannot be called ${segment}: i18nmd.${property} is taken. Rename the directory.`);
  return property;
}

/** The call for a namespace: "knowledge-hub.faq." → ".knowledgeHub.faq", so i18nmd.knowledgeHub.faq("…"). */
export function accessorFor(namespace) {
  return namespace ? namespace.slice(0, -1).split('.').map(segment => '.' + divisionProperty(segment)).join('') : '';
}

/**
 * The token prefix for a division: ui/settings → "ui.settings.". prefix is the
 * division of the directory being read, when it is part of a larger tree.
 */
export function namespaceFor(division, prefix = '') {
  const full = [prefix, division].filter(Boolean).join('/');
  if (!full) return '';
  for (const part of full.split('/')) {
    if (!/^[a-zA-Z_]\w*(?:-\w+)*$/.test(part)) throw new Error(`Name division directories with letters, digits, _ and -: ${full}`);
    divisionProperty(part);
  }
  return full.replace(/\//g, '.') + '.';
}

/**
 * Merge one-language files into a catalog. Files may sit in subdirectories,
 * one per division (ui/i18n-fr.md, marketing/i18n-fr.md); each division has its
 * own source file, and its tokens are namespaced by its path: ## save in
 * ui/i18n-en.md is the token ui.save. Every message records its division so it
 * is written back to the same place, without the namespace. By default a
 * language may lack tokens (it falls back to the source) and tokens the source
 * no longer has are set aside in catalog.orphans with a warning. strict: every
 * file must match its source exactly.
 */
export function parseLanguageFiles(files, { source, syntax = 'icu', strict = false, prefix = '' } = {}) {
  const divisions = new Map();
  for (const [filename, markdown] of Object.entries(files)) {
    const locale = languageFromFilename(filename);
    const division = divisionOf(filename);
    if (!divisions.has(division)) divisions.set(division, new Map());
    const byLocale = divisions.get(division);
    if (byLocale.has(locale)) throw new Error(`Duplicate language file: ${where(division)}${locale}`);
    const parsed = parseCatalog(markdown, { locale, syntax });
    const namespace = namespaceFor(division, prefix);
    for (const message of parsed.messages) message.key = namespace + message.key;
    if (parsed.source !== locale || parsed.syntax !== syntax || Object.keys(parsed.languages).length !== 1) throw new Error(`Expected a single-language ${syntax} file for ${where(division)}i18n-${locale}.md.`);
    byLocale.set(locale, parsed);
  }
  const all = [...divisions.values()].flatMap(byLocale => [...byLocale.keys()]);
  source ||= all.includes('en') ? 'en' : all[0];
  if (!source) throw new Error('Include at least one i18n-<language>.md file.');
  const catalog = { source, syntax, title: 'Translations', languages: Object.create(null), messages: [], orphans: Object.create(null), divisions: [...divisions.keys()], prefix };
  const owner = new Map();
  for (const [division, byLocale] of divisions) {
    const base = byLocale.get(source);
    if (!base) throw new Error(`Include ${where(division)}i18n-${source}.md as the source file.`);
    catalog.languages[source] ||= base.languages[source];
    for (const message of base.messages) {
      if (owner.has(message.key)) throw new Error(`Token ${message.key} is defined in both ${where(owner.get(message.key)) || './'} and ${where(division) || './'}.`);
      owner.set(message.key, division);
      message.division = division;
      catalog.messages.push(message);
    }
  }
  const warnings = [];
  const messages = new Map(catalog.messages.map(message => [message.key, message]));
  for (const [division, byLocale] of divisions) {
    const local = [...messages.values()].filter(message => message.division === division);
    for (const [locale, parsed] of byLocale) {
      if (locale === source) continue;
      catalog.languages[locale] ||= parsed.languages[locale];
      const label = `${where(division)}${locale}`;
      const seen = new Set();
      for (const message of parsed.messages) {
        const target = messages.get(message.key);
        if (!target || target.division !== division) {
          const hint = target ? `belongs in ${where(target.division) || './'}` : `is not in ${source}`;
          if (strict) throw new Error(target ? `${label}: token ${message.key} ${hint}.` : `${label}: unknown token ${message.key}.`);
          message.division = division;
          (catalog.orphans[locale] ||= []).push(message);
          warnings.push(`${label}: ${message.key} ${hint}; ignored. Run sync to remove it, or move or rename it to keep it.`);
          continue;
        }
        seen.add(message.key);
        target.translations[locale] = message.translations[locale];
      }
      const missing = local.filter(message => !seen.has(message.key)).map(message => message.key);
      if (missing.length) {
        if (strict) throw new Error(`${label}: token set must match ${source}; missing ${missing.join(', ')}.`);
        warnings.push(`${label}: ${missing.length} token${missing.length === 1 ? '' : 's'} missing (falls back to ${source}).`);
      }
    }
  }
  // A language with no file in some division is simply untranslated there.
  for (const locale of Object.keys(catalog.languages)) {
    for (const [division, byLocale] of divisions) {
      if (byLocale.has(locale)) continue;
      const count = catalog.messages.filter(message => message.division === division).length;
      if (strict) throw new Error(`${where(division)}i18n-${locale}.md is missing.`);
      warnings.push(`${where(division)}${locale}: ${count} token${count === 1 ? '' : 's'} missing (falls back to ${source}).`);
    }
  }
  catalog.warnings = warnings;
  return validateCatalog(catalog, { allowIncomplete: !strict, lenient: !strict });
}

/** Rename a token in every language, keeping its translations. */
export function renameToken(catalog, from, to) {
  if (!/^[a-zA-Z_]\w*(?:[.-]\w+)*$/.test(to)) throw new Error(`Invalid token: ${to}`);
  const message = catalog.messages.find(m => m.key === from);
  if (!message) throw new Error(`Unknown token: ${from}`);
  if (catalog.messages.some(m => m.key === to)) throw new Error(`Token ${to} already exists.`);
  message.key = to;
  return catalog;
}
