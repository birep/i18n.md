// Convert between i18nmd catalogs and the JSON message files other libraries use.
//   formatjs  – react-intl / FormatJS: flat {id: "ICU"} or {id: {defaultMessage, description}}
//   next-intl – nested objects of ICU strings
//   i18next   – nested objects, {{placeholders}}, plural suffixes such as key_one / key_other
import { escapeMessageLiteral, parseMessage } from './messages.mjs';

export const FORMATS = ['formatjs', 'next-intl', 'i18next'];
const PLURAL = ['zero', 'one', 'two', 'few', 'many', 'other'];
const TOKEN = /^[a-zA-Z_]\w*(?:[.-]\w+)*$/;

function flatten(object, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(object)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && !('defaultMessage' in value)) flatten(value, name, out);
    else out[name] = value;
  }
  return out;
}

function nest(flat) {
  const root = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] === 'string') throw new Error(`${key} conflicts with the message ${part}; use flat output.`);
      node = node[part] ||= {};
    }
    node[parts.at(-1)] = value;
  }
  return root;
}

function checkToken(key) {
  if (!TOKEN.test(key)) throw new Error(`"${key}" cannot be an i18nmd token. Tokens use letters, digits, _ . and -.`);
  return key;
}

// i18next "Hello {{name}}" → ICU "Hello {name}"; literal text is ICU-escaped.
function fromI18nextText(text, warnings, key, pound) {
  let out = '', last = 0;
  for (const match of text.matchAll(/\{\{\s*-?\s*([\w.]+)\s*(?:,[^}]*)?\}\}|\$t\(([^)]*)\)/g)) {
    out += escapeMessageLiteral(text.slice(last, match.index));
    if (match[2] !== undefined) { warnings.push(`${key}: nested $t(${match[2]}) is kept as text.`); out += escapeMessageLiteral(match[0]); }
    else if (pound && match[1] === 'count') out += '#';
    else { const name = match[1].replace(/\./g, '_'); if (name !== match[1]) warnings.push(`${key}: {{${match[1]}}} renamed {${name}}.`); out += `{${name}}`; }
    last = match.index + match[0].length;
  }
  return out + escapeMessageLiteral(text.slice(last));
}

/** Read one locale's JSON into [{key, context, text}]. */
export function importMessages(json, format, warnings = [], formatters = []) {
  if (!FORMATS.includes(format)) throw new Error(`--from must be one of ${FORMATS.join(', ')}.`);
  const flat = flatten(json);
  const messages = [];
  if (format !== 'i18next') {
    for (const [key, value] of Object.entries(flat)) {
      const text = typeof value === 'string' ? value : value?.defaultMessage;
      if (typeof text !== 'string') { warnings.push(`${key}: not a message; skipped.`); continue; }
      parseMessage(text, 'icu', formatters);
      messages.push({ key: checkToken(key), context: typeof value === 'object' && value.description ? String(value.description) : '', text });
    }
    return messages;
  }
  const groups = new Map();
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string') { warnings.push(`${key}: not a string; skipped.`); continue; }
    const plural = /^(.*)_(zero|one|two|few|many|other|plural)$/.exec(key);
    const base = plural ? plural[1] : key;
    if (!groups.has(base)) groups.set(base, {});
    groups.get(base)[plural ? (plural[2] === 'plural' ? 'other' : plural[2]) : ''] = value;
  }
  for (const [key, forms] of groups) {
    const categories = PLURAL.filter(c => c in forms);
    let text;
    if (!categories.length) text = fromI18nextText(forms[''], warnings, key);
    else {
      if (!('other' in forms)) forms.other = forms.one ?? forms[''] ?? forms[categories[0]];
      // i18next v3 used key (singular) + key_plural; the bare key is then "one".
      if ('' in forms && !('one' in forms)) forms.one = forms[''];
      text = `{count, plural, ${PLURAL.filter(c => c in forms).map(c => `${c === 'zero' ? '=0' : c} {${fromI18nextText(forms[c], warnings, key, true)}}`).join(' ')}}`;
    }
    parseMessage(text, 'icu', formatters);
    messages.push({ key: checkToken(key), context: '', text });
  }
  return messages;
}

// ICU nodes back to i18next text; returns undefined when i18next cannot express it.
function toI18nextText(nodes, pound) {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') out += n;
    else if (n.type === 'argument') out += `{{${n.name}}}`;
    else if (n.type === 'pound' && pound) out += `{{${pound}}}`;
    else if (n.type === 'tag') { const inner = toI18nextText(n.children, pound); if (inner === undefined) return; out += `<${n.name}>${inner}</${n.name}>`; }
    else return;
  }
  return out;
}

/** Turn one language of a catalog into the library's JSON object. */
export function exportMessages(catalog, locale, format, warnings = []) {
  if (!FORMATS.includes(format)) throw new Error(`--to must be one of ${FORMATS.join(', ')}.`);
  const flat = {};
  for (const message of catalog.messages) {
    const text = message.translations[locale];
    if (text === undefined) continue;
    if (format === 'formatjs') { flat[message.key] = text; continue; }
    if (format === 'next-intl') { flat[message.key] = text; continue; }
    const nodes = parseMessage(text, catalog.syntax, catalog.formatters);
    const simple = toI18nextText(nodes);
    if (simple !== undefined) { flat[message.key] = simple; continue; }
    const [only] = nodes;
    if (nodes.length === 1 && only.type === 'plural' && !only.offset) {
      const forms = {};
      for (const [category, branch] of Object.entries(only.options)) {
        const suffix = category === '=0' ? 'zero' : PLURAL.includes(category) ? category : undefined;
        const converted = suffix && toI18nextText(branch, only.name);
        if (converted === undefined) { forms.failed = true; break; }
        forms[suffix] = converted;
      }
      if (!forms.failed) {
        if (only.name !== 'count') warnings.push(`${message.key}: i18next selects plurals by count; pass { count: ${only.name} }.`);
        for (const [suffix, value] of Object.entries(forms)) flat[`${message.key}_${suffix}`] = value.replaceAll(`{{${only.name}}}`, '{{count}}');
        continue;
      }
    }
    warnings.push(`${message.key}: kept as ICU; load it with the i18next-icu plugin.`);
    flat[message.key] = text;
  }
  return format === 'formatjs' ? flat : nest(flat);
}
