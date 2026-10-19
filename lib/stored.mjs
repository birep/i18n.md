// Translate text an app stores itself, such as articles or narration in a
// database, without language files. The caller keeps each translation with the
// fingerprint it was made against and passes them back next time; only entries
// whose source changed, or that were never translated, are sent to the model.
import { hashMessage, validateCatalog } from './catalog.mjs';
import { resolveLanguage } from './languages.mjs';
import { estimateTokens, llmConfig, translateLanguage } from './llm.mjs';
import { messageToSpans, spansToMessage } from './spans.mjs';

const KINDS = ['interface', 'prose'];

function language(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Languages are codes or names, such as "fr" or "French".');
  return resolveLanguage(input);
}

function prepare(messages, { source = 'en', languages, previous = {}, kind = 'interface', formatters = [] } = {}) {
  if (!messages || typeof messages !== 'object' || Array.isArray(messages)) throw new Error('messages must be an object of keyed entries.');
  if (!KINDS.includes(kind)) throw new Error(`kind must be ${KINDS.join(' or ')}.`);
  if (!Array.isArray(languages) || !languages.length) throw new Error('Name the languages to translate into.');
  const from = language(source);
  const catalog = { source: from.code, syntax: 'icu', formatters, languages: { [from.code]: from.english || from.name }, messages: [] };
  const entries = Object.entries(messages).map(([key, raw], i) => {
    if (key === '__proto__') throw new Error('__proto__ cannot be a key.');
    const entry = typeof raw === 'string' ? { text: raw } : raw;
    if (!entry || typeof entry !== 'object' || Object.hasOwn(entry, 'spans') === Object.hasOwn(entry, 'text')) throw new Error(`${key}: an entry is a message string, { text } or { spans }.`);
    if (entry.context !== undefined && typeof entry.context !== 'string') throw new Error(`${key}: context must be a string.`);
    const rich = Object.hasOwn(entry, 'spans');
    let message, tags;
    try { ({ message, tags } = rich ? spansToMessage(entry.spans) : { message: entry.text }); }
    catch (error) { throw new Error(`${key}: ${error.message}`); }
    if (typeof message !== 'string') throw new Error(`${key}: text must be a string.`);
    // Link targets and other mark values are part of what a translation carries.
    const fingerprint = hashMessage(rich ? `${message}\u0000${JSON.stringify(tags)}` : message);
    const id = `m${i + 1}`;
    const blank = !/\p{L}/u.test(message);
    if (!blank) {
      const translations = { [from.code]: message };
      try { validateCatalog({ ...catalog, messages: [{ key: id, translations }] }); }
      catch (error) { throw new Error(`${key}: ${error.message.replace(`${id} [${from.code}]: `, '')}`); }
      catalog.messages.push({ key: id, context: entry.context, translations });
    }
    return { key, id, rich, tags, source: entry, fingerprint, blank };
  });
  const work = [];
  for (const target of [...new Map(languages.map(input => [language(input).code, { input, ...language(input) }])).values()]) {
    if (target.code === from.code) throw new Error(`${target.code} is the source language.`);
    catalog.languages[target.code] = target.name;
    const stored = previous[target.code] ?? previous[target.input] ?? {};
    const keep = {}, keys = [];
    for (const entry of entries) {
      const earlier = stored[entry.key];
      const value = entry.rich ? earlier?.spans : earlier?.text;
      if (entry.blank) keep[entry.key] = entry.rich ? { spans: entry.source.spans, fingerprint: entry.fingerprint } : { text: entry.source.text, fingerprint: entry.fingerprint };
      else if (value !== undefined && earlier.fingerprint === entry.fingerprint) keep[entry.key] = { ...(entry.rich ? { spans: value } : { text: value }), fingerprint: entry.fingerprint };
      else {
        keys.push(entry.id);
        // An earlier translation of older text guides the wording of the new one.
        const hint = value === undefined ? undefined : entry.rich ? (() => { try { return spansToMessage(value).message; } catch { return undefined; } })() : value;
        const message = catalog.messages.find(m => m.key === entry.id);
        if (typeof hint === 'string' && hint.trim()) message.translations[target.code] = hint;
      }
    }
    work.push({ target, keys, keep });
  }
  return { catalog, entries, work };
}

/**
 * Rough tokens a translateMessages call would use, and how many entries it
 * would send: { input, output, requests, messages }.
 */
export function estimateMessages(messages, options = {}) {
  const { catalog, work } = prepare(messages, options);
  const config = options.config ?? {};
  const estimate = estimateTokens(catalog, work.filter(w => w.keys.length), options.batchSize, config.maxOutput, options.kind);
  return { ...estimate, messages: work.reduce((n, w) => n + w.keys.length, 0) };
}

/**
 * Translate keyed entries into each of `languages`. An entry is an ICU message
 * string, { text, context } or { spans, context }. `previous` holds what an
 * earlier call returned, { fr: { key: { text | spans, fingerprint } } }; an
 * entry whose fingerprint still matches is returned as it was without a
 * request. Returns { translations, failed, usage }: translations has the same
 * shape as previous, and failed maps language and key to the reason, for
 * entries that should stay in the source language until the next call.
 */
export async function translateMessages(messages, options = {}) {
  const { catalog, entries, work } = prepare(messages, options);
  const config = options.config ?? llmConfig();
  config.usage ??= { input: 0, output: 0, requests: 0 };
  const sending = work.filter(w => w.keys.length);
  if (options.budget !== undefined && sending.length) {
    const estimate = estimateTokens(catalog, sending, options.batchSize, config.maxOutput, options.kind);
    if (estimate.input + estimate.output > options.budget) throw new Error(`Translating would take about ${(estimate.input + estimate.output).toLocaleString('en')} tokens, over the ${options.budget.toLocaleString('en')}-token budget.`);
  }
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const translations = {}, failed = {};
  await Promise.all(work.map(async ({ target, keys, keep }) => {
    const out = translations[target.code] = keep;
    if (!keys.length) return;
    const errors = await translateLanguage(catalog, target, keys, config, {
      batchSize: options.batchSize,
      chatImpl: options.chatImpl,
      kind: options.kind,
      onBatch: ok => {
        for (const [id, text] of Object.entries(ok)) {
          const entry = byId.get(id);
          try { out[entry.key] = { ...(entry.rich ? { spans: messageToSpans(text, entry.tags) } : { text }), fingerprint: entry.fingerprint }; }
          catch (error) { (failed[target.code] ??= {})[entry.key] = error.message; }
        }
      },
    });
    for (const [id, error] of Object.entries(errors)) (failed[target.code] ??= {})[byId.get(id).key] = error;
  }));
  return { translations, failed, usage: config.usage };
}
