import { languageName } from './catalog.mjs';

// Written interface languages ranked by total (first + second language) speakers,
// after Ethnologue estimates. Approximate; varieties that are rarely written in
// software interfaces are left out. Used by `i18nmd --top <n>`.
export const RANKED = [
  'en', 'zh', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'ru', 'ur',
  'id', 'de', 'ja', 'pcm', 'mr', 'te', 'tr', 'ta', 'vi', 'fil',
  'ko', 'fa', 'ha', 'sw', 'jv', 'it', 'pa', 'gu', 'th', 'kn',
  'am', 'pl', 'yo', 'ml', 'or', 'my', 'uk', 'uz', 'ig', 'nl',
  'ro', 'ne', 'si', 'az', 'ms', 'el', 'cs', 'hu', 'sv', 'zu',
];

const EXTRA = ['zh-Hans', 'zh-Hant', 'pt-BR', 'pt-PT', 'es-419', 'fr-CA', 'en-GB', 'yue', 'haw', 'nv', 'chr', 'tlh', 'mi', 'sm', 'to', 'qu', 'gn', 'ay', 'yi', 'eo', 'la'];
const fold = text => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let index;
function names() {
  if (index) return index;
  index = new Map();
  const english = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
  const codes = new Set([...RANKED, ...EXTRA]);
  for (let a = 97; a <= 122; a++) for (let b = 97; b <= 122; b++) codes.add(String.fromCharCode(a, b));
  for (const code of codes) {
    let name;
    try { name = english.of(code); } catch { continue; }
    if (!name || name === code) continue;
    for (const key of [name, languageName(code)]) if (!index.has(fold(key))) index.set(fold(key), code);
  }
  // Common shorthand that Intl spells differently.
  for (const [alias, code] of [['chinese', 'zh'], ['mandarin', 'zh'], ['cantonese', 'yue'], ['farsi', 'fa'], ['tagalog', 'fil'], ['filipino', 'fil'], ['brazilian portuguese', 'pt-BR'], ['latin american spanish', 'es-419'], ['nigerian pidgin', 'pcm'], ['hawaiian', 'haw'], ['navajo', 'nv'], ['klingon', 'tlh']]) index.set(alias, code);
  return index;
}

/**
 * Resolve "french", "Français", "fr" or "pt-BR" to a language code and a name in
 * that language. Anything unrecognized, such as "pirate", becomes a custom
 * language whose code is its slug; the translator is asked to write in that style.
 */
export function resolveLanguage(input) {
  const raw = input.trim();
  if (/[\\/]|\.md$/.test(raw)) throw new Error(`"${input}" is a path, not a language.`);
  try {
    const [canonical] = Intl.getCanonicalLocales(raw);
    const name = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(canonical);
    if (name && name !== canonical && /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(raw)) return { code: canonical, name: languageName(canonical), english: name, custom: false };
  } catch { /* Not a language tag; try names. */ }
  const code = names().get(fold(raw));
  if (code) return { code, name: languageName(code), english: new Intl.DisplayNames(['en'], { type: 'language' }).of(code), custom: false };
  const slug = fold(raw).replace(/ /g, '-');
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error(`Cannot name a language file for "${input}".`);
  return { code: slug, name: raw[0].toUpperCase() + raw.slice(1), english: raw, custom: true };
}

export function topLanguages(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('--top needs a positive whole number.');
  if (n > RANKED.length) throw new Error(`--top supports up to ${RANKED.length} languages.`);
  return RANKED.slice(0, n);
}
