// Translate language files with an Anthropic Messages API or an
// OpenAI-compatible /chat/completions endpoint. Plain fetch keeps the tool
// dependency-free and works with any compatible base URL (proxies, gateways,
// local servers).
import { parseCatalog, serializeCatalog, validateCatalog, textOf } from './catalog.mjs';

const ANTHROPIC = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/**
 * Settings come from flags, then I18NMD_* variables, then the provider's own
 * variables. The key is never printed.
 */
export function llmConfig(options = {}, env = process.env) {
  let baseUrl = options['base-url'] || env.I18NMD_BASE_URL;
  let apiKey = env.I18NMD_API_KEY;
  let provider = options.provider || env.I18NMD_PROVIDER;
  if (!apiKey && !baseUrl && env.ANTHROPIC_API_KEY) { apiKey = env.ANTHROPIC_API_KEY; baseUrl = env.ANTHROPIC_BASE_URL || ANTHROPIC; provider ||= 'anthropic'; }
  if (!apiKey && !baseUrl && env.OPENAI_API_KEY) { apiKey = env.OPENAI_API_KEY; baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1'; provider ||= 'openai'; }
  apiKey ||= env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY;
  if (!baseUrl && !apiKey) throw new Error('Set I18NMD_API_KEY (and I18NMD_BASE_URL for a non-Anthropic endpoint), or ANTHROPIC_API_KEY / OPENAI_API_KEY.');
  baseUrl = (baseUrl || ANTHROPIC).replace(/\/+$/, '');
  provider ||= /anthropic\.com|\/v1\/messages$/.test(baseUrl) || apiKey?.startsWith('sk-ant-') ? 'anthropic' : 'openai';
  if (!['anthropic', 'openai'].includes(provider)) throw new Error('--provider must be anthropic or openai.');
  const model = options.model || env.I18NMD_MODEL || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : undefined);
  if (!model) throw new Error('Choose a model with --model or I18NMD_MODEL for an OpenAI-compatible endpoint.');
  const reasoning = options.reasoning || env.I18NMD_REASONING || undefined;
  const maxOutput = Number(options['max-output'] || env.I18NMD_MAX_OUTPUT || 8000);
  if (!Number.isInteger(maxOutput) || maxOutput < 500) throw new Error('--max-output must be a whole number of tokens, at least 500.');
  return { baseUrl, apiKey, provider, model, reasoning, maxOutput, usage: { input: 0, output: 0, requests: 0 } };
}

function endpoint({ baseUrl, provider }) {
  if (provider === 'anthropic') return /\/messages$/.test(baseUrl) ? baseUrl : /\/v1$/.test(baseUrl) ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
  return /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One system + user exchange; returns the reply text. */
export async function chat(config, system, user, { fetchImpl = fetch, retries = 4 } = {}) {
  const anthropic = config.provider === 'anthropic';
  const official = anthropic && config.baseUrl.startsWith(ANTHROPIC);
  const headers = { 'content-type': 'application/json' };
  let body;
  if (anthropic) {
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: config.model, max_tokens: config.maxOutput ?? 8000, system, messages: [{ role: 'user', content: user }] };
    // On Anthropic's API, let a declined request continue on a fallback model.
    if (official) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
  } else {
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    body = { model: config.model, max_tokens: config.maxOutput ?? 8000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    // Only when asked: reasoning tokens bill as output and a translation rarely needs them.
    if (config.reasoning) body.reasoning_effort = config.reasoning;
  }
  for (let attempt = 0; ; attempt++) {
    let response;
    try { response = await fetchImpl(endpoint(config), { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (error) { if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; } throw new Error(`Could not reach ${endpoint(config)}: ${error.message}`); }
    if (response.status === 429 || response.status >= 500) {
      if (attempt < retries) { await sleep(Number(response.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt); continue; }
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${config.provider} API ${response.status}: ${data.error?.message || response.statusText}`);
    if (config.usage) config.usage.requests++;
    if (config.usage && data.usage) {
      config.usage.input += data.usage.input_tokens ?? data.usage.prompt_tokens ?? 0;
      config.usage.output += data.usage.output_tokens ?? data.usage.completion_tokens ?? 0;
    }
    if (anthropic) {
      if (data.stop_reason === 'refusal') throw new Error('The model declined to translate this batch.');
      if (data.stop_reason === 'max_tokens') throw new Error('The reply was cut off; use a smaller --batch.');
      return (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('The reply was cut off; use a smaller --batch.');
    return choice?.message?.content ?? '';
  }
}

function systemPrompt(catalog, target) {
  const source = catalog.languages[catalog.source];
  return [
    `You localize software interface strings from ${source} (${catalog.source}) into ${target.english || target.name} (${target.code}).`,
    target.custom ? `"${target.english}" is not a standard language. Write in that style or variety consistently, keeping the text understandable.` : 'Write natural, idiomatic text a native speaker would expect in a polished product, using the conventional register for software in that language.',
    'Each message is ICU MessageFormat. Keep placeholder names such as {name}, placeholder types such as {len, length} (the app formats those), tag names such as <b>…</b>, and the plural/select/selectordinal keywords and select branch names exactly as they are; translate only the human text, including the text inside branches and tags. For plurals, provide the CLDR plural categories the target language needs and always keep "other". Keep # inside plural branches. Keep {name, list} and its style; the app joins the list in each language. Write a literal apostrophe as \'\' only when it sits next to { or }. Preserve leading and trailing spaces.',
    'Use the Context line to choose the right meaning and length. Interface text should be concise. Keep terminology consistent across the messages.',
    'Reply with Markdown only, in exactly the input format: for each token, a "## token" heading followed by an ```icu fenced block. Include every token you were given, in the same order, and nothing else.',
  ].join('\n\n');
}

function userPrompt(catalog, target, messages, previous) {
  let text = '';
  const subset = { ...catalog, messages: messages.map(m => ({ ...m, translations: { [catalog.source]: m.translations[catalog.source] }, invalid: undefined })) };
  text += `Translate these ${messages.length} messages:\n\n${serializeCatalog(subset, { locale: catalog.source }).replace(/^# .*\n\n/, '')}`;
  const outdated = messages.filter(m => previous[m.key]);
  if (outdated.length) text += `\nThese tokens had an earlier translation for older source text; reuse its wording where it still fits:\n\n${outdated.map(m => `- ${m.key}: ${JSON.stringify(previous[m.key])}`).join('\n')}\n`;
  return text;
}

/** Parse a reply and check each message against its source; returns { ok, errors }. */
export function readReply(reply, catalog, target, messages) {
  const body = reply.trim().replace(/^````?(?:md|markdown)?\n([\s\S]*?)\n````?$/, '$1');
  const ok = Object.create(null), errors = Object.create(null);
  // Parse the reply as a whole; if one message in it is malformed, parse each
  // "## token" section alone, so one bad message doesn't discard the rest.
  const replies = new Map();
  const read = text => parseCatalog(`# ${target.name}\n\n${text}\n`, { locale: target.code, allowIncomplete: true }).messages;
  try { for (const m of read(body)) replies.set(m.key, m.translations[target.code]); }
  catch (error) {
    for (const section of body.split(/^(?=## )/m)) {
      try { for (const m of read(section)) replies.set(m.key, m.translations[target.code]); }
      catch (sectionError) {
        const key = /^## (\S+)/.exec(section)?.[1];
        if (key) errors[key] = `unreadable reply: ${sectionError.message}`;
      }
    }
    if (!replies.size) { for (const m of messages) errors[m.key] ??= `unreadable reply: ${error.message}`; return { ok, errors }; }
  }
  for (const message of messages) {
    const text = replies.get(message.key);
    if (text === undefined) { errors[message.key] ??= 'missing from the reply'; continue; }
    try {
      validateCatalog({ source: catalog.source, syntax: catalog.syntax, languages: { [catalog.source]: 'source', [target.code]: 'target' }, messages: [{ key: message.key, optional: message.optional, translations: { [catalog.source]: message.translations[catalog.source], [target.code]: text } }] });
      ok[message.key] = text;
    } catch (error) { errors[message.key] = error.message; }
  }
  return { ok, errors };
}

/**
 * Translate the given tokens into one language, in batches, retrying invalid
 * messages once with the validation error. Calls onBatch(results) after each
 * batch so callers can save progress. Returns the keys that still failed.
 */
export async function translateLanguage(catalog, target, keys, config, { batchSize = Infinity, onBatch = () => {}, chatImpl = chat } = {}) {
  const messages = catalog.messages.filter(m => keys.includes(m.key));
  const previous = Object.fromEntries(messages.map(m => [m.key, textOf(m, target.code)]).filter(([, t]) => t !== undefined));
  const failed = Object.create(null);
  const system = systemPrompt(catalog, target);
  let applied = Promise.resolve();
  // The whole file in one request. Only a reply cut off by the model's
  // output limit splits it, in halves, as far as needed.
  const send = async batch => {
    let reply;
    try { reply = await chatImpl(config, system, userPrompt(catalog, target, batch, previous)); }
    catch (error) {
      if (!/cut off/.test(error.message) || batch.length < 2) throw error;
      const half = Math.ceil(batch.length / 2);
      await Promise.all([send(batch.slice(0, half)), send(batch.slice(half))]);
      return;
    }
    let { ok, errors } = readReply(reply, catalog, target, batch);
    const retry = batch.filter(m => errors[m.key]);
    if (retry.length) {
      const feedback = `\n\nA previous attempt had these problems; fix them:\n${retry.map(m => `- ${m.key}: ${errors[m.key]}`).join('\n')}`;
      const second = readReply(await chatImpl(config, system, userPrompt(catalog, target, retry, previous) + feedback), catalog, target, retry);
      Object.assign(ok, second.ok);
      errors = second.errors;
    }
    Object.assign(failed, errors);
    applied = applied.then(() => onBatch(ok));
    await applied;
  };
  await Promise.all(batches(messages, batchSize, config.maxOutput, catalog).map(send));
  return failed;
}

/** Tokens one translated message takes in a reply, generously: its heading,
 * fence and text, with room for languages that run longer than the source. */
const replyTokens = (m, catalog) => (m.key.length + 24 + m.translations[catalog.source].length * 1.5) / 3;

/** Messages grouped so each reply fits well inside the model's output limit
 * (60% of it, since the count is an estimate). A reply that is cut off is
 * paid for and thrown away, so it is cheaper to split before sending. */
function batches(messages, size = Infinity, maxOutput = 8000, catalog) {
  const out = [];
  let batch = [], tokens = 0;
  for (const m of messages) {
    const t = catalog ? replyTokens(m, catalog) : 0;
    if (batch.length && (batch.length >= size || tokens + t > maxOutput * 0.6)) { out.push(batch); batch = []; tokens = 0; }
    batch.push(m); tokens += t;
  }
  if (batch.length) out.push(batch);
  return out;
}

/** Rough tokens a translate run will use (about 4 characters a token), so a
 * run can be priced before it starts. */
export function estimateTokens(catalog, work, batchSize = Infinity, maxOutput = 8000) {
  let input = 0, output = 0, requests = 0;
  for (const { target, keys } of work) {
    const messages = catalog.messages.filter(m => keys.includes(m.key));
    const system = systemPrompt(catalog, target).length;
    for (const batch of batches(messages, batchSize, maxOutput, catalog)) {
      const source = batch.reduce((n, m) => n + m.key.length + (m.context?.length ?? 0) + m.translations[catalog.source].length + 30, 0);
      input += (system + source) / 4;
      output += batch.reduce((n, m) => n + replyTokens(m, catalog), 0);
      requests++;
    }
  }
  return { input: Math.round(input), output: Math.round(output), requests };
}
