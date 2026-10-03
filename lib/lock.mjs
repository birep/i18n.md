// i18nmd.lock.json keeps bookkeeping out of the Markdown. For every translation
// it records a fingerprint of the source text it was written against and of the
// translation itself. A translation is stale when its source text changed and
// the translation has not been edited since; editing it accepts it.
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { hashMessage, textOf } from './catalog.mjs';

export const LOCK_FILE = 'i18nmd.lock.json';

export function lockPathFor(input, isDirectory) {
  return isDirectory ? path.join(input, LOCK_FILE) : input.replace(/\.md$/, '') + '.lock.json';
}

/** The nearest enclosing directory named translations, i18n or locales, if any. */
export function namedRoot(dir) {
  const parts = path.resolve(dir).split(path.sep);
  const index = parts.findLastIndex(part => ['translations', 'i18n', 'locales'].includes(part));
  return index < 0 ? undefined : parts.slice(0, index + 1).join(path.sep) || path.sep;
}

/**
 * The lock for a directory: its own, or one in an enclosing directory when the
 * directory is a division of a larger tree. The search stops at the working
 * directory or a translations/, i18n/ or locales/ directory; a new lock goes in
 * the latter, so every division shares one.
 */
export async function findLock(dir) {
  const start = path.resolve(dir), named = namedRoot(dir), cwd = path.resolve('.');
  const stops = [named, start.startsWith(cwd + path.sep) ? cwd : undefined].filter(Boolean);
  for (let current = start; ; current = path.dirname(current)) {
    const file = path.join(current, LOCK_FILE);
    try { await access(file); return { file: path.relative('.', file) || LOCK_FILE, partial: current !== start }; } catch { /* keep looking */ }
    if (stops.includes(current) || current === path.dirname(current) || !stops.length) break;
  }
  const home = named || start;
  return { file: path.relative('.', path.join(home, LOCK_FILE)), partial: home !== start };
}

export async function readLock(file) {
  try {
    const lock = JSON.parse(await readFile(file, 'utf8'));
    return { source: lock.source, translations: lock.translations || {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { source: undefined, translations: {} };
    throw new Error(`${file}: ${error.message}`);
  }
}

export function serializeLock(lock) {
  const sorted = Object.fromEntries(Object.keys(lock.translations).sort().map(locale => [locale, Object.fromEntries(Object.entries(lock.translations[locale]).sort(([a], [b]) => a.localeCompare(b)))]));
  return JSON.stringify({ source: lock.source, translations: sorted }, null, 2) + '\n';
}

const fingerprint = (message, catalog, locale) => `${hashMessage(message.translations[catalog.source])}:${hashMessage(textOf(message, locale))}`;

function stale(message, catalog, locale, entry) {
  if (!Object.hasOwn(message.translations, locale) && message.invalid?.[locale] !== undefined) return true;
  if (!entry) return false;
  const [source, translation] = entry.split(':');
  return source !== hashMessage(message.translations[catalog.source]) && translation === hashMessage(textOf(message, locale));
}

/** Per-language progress: tokens missing, stale, and done. */
export function report(catalog, lock) {
  return Object.keys(catalog.languages).filter(l => l !== catalog.source).map(locale => {
    const row = { locale, name: catalog.languages[locale], total: catalog.messages.length, missing: [], stale: [] };
    for (const message of catalog.messages) {
      if (textOf(message, locale) === undefined) row.missing.push(message.key);
      else if (stale(message, catalog, locale, lock.translations[locale]?.[message.key])) row.stale.push(message.key);
    }
    row.done = row.total - row.missing.length - row.stale.length;
    return row;
  });
}

/**
 * Bring the lock up to date with the files; returns human-readable changes.
 * partial: the catalog is one division of a larger tree, so entries for other
 * tokens and languages are kept.
 */
export function syncLock(catalog, lock, { partial = false } = {}) {
  const changes = [];
  const keys = new Set(catalog.messages.map(message => message.key));
  const next = partial ? { ...lock.translations } : {};
  for (const locale of Object.keys(catalog.languages)) {
    if (locale === catalog.source) continue;
    const previous = lock.translations[locale] || {};
    const entries = next[locale] = partial ? Object.fromEntries(Object.entries(previous).filter(([key]) => !keys.has(key))) : {};
    for (const message of catalog.messages) {
      if (textOf(message, locale) === undefined) continue;
      const entry = previous[message.key];
      if (stale(message, catalog, locale, entry)) {
        entries[message.key] = entry || fingerprint(message, catalog, locale);
        if (!message.invalid?.[locale]) changes.push(`${locale}: ${message.key} is stale; its source text changed`);
        continue;
      }
      const current = fingerprint(message, catalog, locale);
      if (entry && entry.split(':')[0] !== current.split(':')[0]) changes.push(`${locale}: ${message.key} accepted; the translation was updated after its source changed`);
      entries[message.key] = current;
    }
  }
  lock.source = catalog.source;
  lock.translations = next;
  return changes;
}

/** Record that a translation now matches the current source text. */
export function markCurrent(catalog, lock, locale, message) {
  (lock.translations[locale] ||= {})[message.key] = fingerprint(message, catalog, locale);
}
