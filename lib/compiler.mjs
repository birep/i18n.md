import { parseCatalog, validateCatalog, namespaceFor, divisionProperty, accessorFor } from './catalog.mjs';
import { argumentsFor, parseMessage } from './messages.mjs';

export function compileCatalog(input) {
  const catalog = typeof input === 'string' ? parseCatalog(input, { allowIncomplete: true }) : validateCatalog(input, { allowIncomplete: true });
  const messages = Object.create(null);
  for (const message of catalog.messages) {
    messages[message.key] = Object.fromEntries(Object.entries(message.translations).map(([lang, text]) => [lang, parseMessage(text, catalog.syntax)]));
  }
  return { source: catalog.source, languages: catalog.languages, messages };
}

// The division tree, { property: [directory segment, children] }, from the
// namespace of every message.
function divisionTree(catalog) {
  const tree = {};
  for (const message of catalog.messages) {
    const namespace = namespaceFor(message.division || '', catalog.prefix || '');
    let node = tree;
    for (const segment of namespace.split('.').slice(0, -1)) {
      const property = divisionProperty(segment);
      if (node[property] && node[property][0] !== segment) throw new Error(`Divisions ${node[property][0]} and ${segment} would both be i18nmd.${property}. Rename one.`);
      node = (node[property] ||= [segment, {}])[1];
    }
  }
  return tree;
}

// Plural categories for 0–199 as one letter each. CLDR rules depend on n, n % 10
// and n % 100, so 100 + n % 100 stands in for any larger whole number.
function pluralTable(locale, type) {
  let rules;
  try { rules = new Intl.PluralRules(locale, { type }); } catch { rules = new Intl.PluralRules('en', { type }); }
  const letter = { zero: 'z', one: 'o', two: 't', few: 'f', many: 'm', other: 'x' };
  return Array.from({ length: 200 }, (_, n) => letter[rules.select(n)]).join('');
}

const PYTHON_RUNTIME = `
_CATEGORY = {"z": "zero", "o": "one", "t": "two", "f": "few", "m": "many", "x": "other"}
_log = logging.getLogger("i18nmd")


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        text = str(value).strip()
        return float(text) if "." in text else int(text)
    except (TypeError, ValueError):
        return None


def _show(number: int | float) -> str:
    return str(int(number)) if float(number).is_integer() else f"{number:g}"


def _category(table: str, number: int | float) -> str:
    if not float(number).is_integer():
        return "other"
    n = abs(int(number))
    return _CATEGORY[table[n if n < 200 else 100 + n % 100]]


def _render(nodes: list[Any], language: str, values: dict[str, Any] | None, pound: Any = None) -> str:
    out: list[str] = []
    for node in nodes:
        if isinstance(node, str):
            out.append(node)
            continue
        kind = node["type"]
        if kind == "pound":
            out.append(_show(pound))
            continue
        if kind == "tag":
            inner = _render(node["children"], language, values, pound)
            wrap = values.get(node["name"])
            out.append(str(wrap(inner)) if callable(wrap) else inner)
            continue
        name = node["name"]
        if values is None:  # template(): show the placeholder itself
            out.append("{" + name + "}")
            continue
        if name not in values:
            _log.error("Missing value for {%s}.", name)
            out.append("{" + name + "}")
            continue
        value = values[name]
        if kind == "argument":
            out.append("" if value is None else str(value))
        elif kind == "select":
            options = node["options"]
            out.append(_render(options.get(str(value), options["other"]), language, values, pound))
        elif kind in ("plural", "selectordinal"):
            number = _number(value)
            if number is None:
                _log.error("{%s} must be a number.", name)
                out.append(str(value))
                continue
            options = node["options"]
            exact = options.get("=" + _show(number))
            table = (_ORDINAL if kind == "selectordinal" else _CARDINAL)[language]
            chosen = exact or options.get(_category(table, number - node["offset"])) or options["other"]
            out.append(_render(chosen, language, values, number - node["offset"]))
        elif kind == "number":
            number = _number(value)
            out.append(str(value) if number is None else f"{number * 100:g}%" if node.get("style") == "percent" else _show(number))
        else:
            out.append(str(value))
    return "".join(out)


def _match(language: str | None) -> str:
    if not language:
        return SOURCE
    code = language.replace("_", "-")
    if code in LANGS:
        return code
    base = code.split("-")[0].lower()
    return next((lang for lang in LANGS if lang.split("-")[0] == base), SOURCE)


def i18nmd(token: str, language: str | None = None, **values: Any) -> str:
    # The message for token in language (or the closest one it has), with values filled in.
    entry = _MESSAGES.get(token)
    if entry is None:
        _log.error("Unknown translation token: %s", token)
        return token
    chosen = _match(language)
    used = chosen if chosen in entry else SOURCE
    return _render(entry[used], used, values)


def template(token: str, language: str | None = None) -> str:
    # The message with each placeholder, plural or select shown as {name}.
    entry = _MESSAGES[token]
    chosen = _match(language)
    return _render(entry[chosen if chosen in entry else SOURCE], SOURCE, None)
`;

// ICU messages as a dependency-free Python module: i18nmd(token, language, **values).
function pythonModule(catalog) {
  const compiled = compileCatalog(catalog);
  const tables = kind => Object.fromEntries(Object.keys(catalog.languages).map(l => [l, pluralTable(l, kind)]));
  const literal = value => JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ');
  let text = '# Generated from i18n.md. Edit the Markdown source.\n# ruff: noqa\nfrom __future__ import annotations\n\nimport logging\nfrom typing import Any\n\n';
  text += `SOURCE = ${JSON.stringify(catalog.source)}\nLANGS: dict[str, str] = ${literal(catalog.languages)}\n`;
  text += `_CARDINAL: dict[str, str] = ${JSON.stringify(tables('cardinal'), null, 1)}\n_ORDINAL: dict[str, str] = ${JSON.stringify(tables('ordinal'), null, 1)}\n`;
  // Compiled messages are JSON of strings, objects and integers, which is also Python.
  text += `_MESSAGES: dict[str, dict[str, list[Any]]] = {\n${Object.entries(compiled.messages).map(([key, byLang]) => ` ${JSON.stringify(key)}: ${literal(byLang)},`).join('\n')}\n}\n`;
  text += 'TOKENS: frozenset[str] = frozenset(_MESSAGES)\n';
  return text + PYTHON_RUNTIME;
}

// Output files a division may not be named after.
const RESERVED_FILES = new Set(['i18n', 'language', 'runtime', 'languages']);

/** The module for a division: ui → ui, marketing/landing → marketing.landing. */
export function divisionFile(division) {
  const file = division.replace(/\//g, '.');
  if (RESERVED_FILES.has(file)) throw new Error(`A division cannot be called ${division}: the compiler writes ${file}.* itself. Rename the directory.`);
  return file;
}

function typesFor(catalog, tree) {
  const types = Object.create(null), rich = [];
  for (const message of catalog.messages) {
    // Merge argument types across translations so a numeric source placeholder
    // can acquire plural/number formatting in a translation without weakening types.
    const params = Object.create(null);
    for (const value of Object.values(message.translations)) argumentsFor(parseMessage(value, catalog.syntax), params);
    types[message.key] = Object.entries(params).map(([name, type]) => `${JSON.stringify(name)}: ${type === 'number' ? 'number' : type === 'date' ? 'Date | number' : type === 'select' ? 'string' : type === 'tag' ? '(chunks: any[]) => any' : 'string | number | null | undefined'}`).join('; ');
    if (Object.values(params).includes('tag')) rich.push(message.key);
  }
  let text = 'import type { Language } from "./language.mjs";\nexport type { Language };\n';
  text += `export interface Values {\n${Object.entries(types).map(([key, fields]) => `  ${JSON.stringify(key)}: ${fields ? `{ ${fields} }` : 'undefined'};`).join('\n')}\n}\n`;
  text += 'export type Token = keyof Values;\n';
  // Messages with <tags> return an array of strings and whatever the tag functions return.
  text += `export type RichToken = ${rich.length ? rich.map(k => JSON.stringify(k)).join(' | ') : 'never'};\n`;
  // A division function takes the tokens under its prefix by their short names.
  text += 'type Short<P extends string> = Token extends infer K ? (K extends `${P}${infer S}` ? S : never) : never;\n';
  text += 'type Full<P extends string, S extends string> = `${P}${S}` & Token;\n';
  text += 'export interface Scope<P extends string> {\n  <S extends Short<P>>(token: S, ...args: Values[Full<P, S>] extends undefined ? [values?: undefined] : [values: Values[Full<P, S>]]): Full<P, S> extends RichToken ? any[] : string;\n}\n';
  const scopeType = (prefix, node) => `Scope<${JSON.stringify(prefix)}>${Object.keys(node).length ? ` & { ${Object.entries(node).map(([property, [segment, children]]) => `readonly ${property}: ${scopeType(`${prefix}${segment}.`, children)}`).join('; ')} }` : ''}`;
  text += `export type Translator = ${scopeType('', tree)};\n\n`;
  return text;
}

/**
 * Every file the TypeScript or JavaScript target writes, by name:
 *   i18n.ts        types, the i18nmd function, and top-level messages
 *   <division>.ts  a division's source-language messages; code that calls
 *                  i18nmd.<division>(…) imports i18nmd from here, so a bundler
 *                  ships each division with the code that uses it
 *   language.mjs   the current language and the loaders, with no messages, for
 *                  an app's entry code (+ language.d.mts)
 *   languages/<code>.mjs  every message in one other language, loaded by
 *                  setLanguage before it switches
 * eager: put every message in i18n.ts and load no languages lazily, for
 * servers, tests and small apps.
 */
export function generateModules(input, { target = 'ts', eager = false } = {}) {
  const catalog = typeof input === 'string' ? parseCatalog(input, { allowIncomplete: true }) : validateCatalog(input, { allowIncomplete: true });
  if (!['ts', 'js'].includes(target)) throw new Error(`Unknown output target: ${target}`);
  const compiled = compileCatalog(catalog);
  const tree = divisionTree(catalog);
  // Only i18n.ts needs lint turned off (its types use any); a disable comment
  // with nothing to disable is itself a lint error in strict setups.
  const head = '// Generated from i18n.md. Edit the Markdown source.\n';
  const ext = target === 'ts' ? 'ts' : 'mjs';
  const i18nImport = target === 'ts' ? './i18n' : './i18n.mjs';
  const others = Object.keys(catalog.languages).filter(l => l !== catalog.source);
  const divisions = [...new Set(catalog.messages.map(m => m.division || ''))].filter(Boolean).sort();
  const table = (messages, language) => JSON.stringify(Object.fromEntries(messages.filter(m => Object.hasOwn(compiled.messages[m.key], language)).map(m => [m.key, compiled.messages[m.key][language]])), null, 1);
  const files = {};

  let language = head + 'import { createLanguage } from "./runtime.mjs";\n';
  if (eager) others.forEach((code, i) => { language += `import language${i} from "./languages/${code}.mjs";\n`; });
  language += `\nexport const languages = ${JSON.stringify(catalog.languages, null, 2)};\n`;
  language += eager
    ? `const tables = { ${others.map((code, i) => `${JSON.stringify(code)}: language${i}`).join(', ')} };\nconst load = code => tables[code];\n`
    : `// Each language is its own chunk, fetched when someone switches to it.\nconst load = code => ({\n${others.map(code => `  ${JSON.stringify(code)}: () => import("./languages/${code}.mjs"),`).join('\n')}\n})[code]().then(module => module.default);\n`;
  language += `/** The current language; ready resolves once the reader's language has loaded. store is internal. */\nexport const { store, ready, getLanguage, setLanguage, loadLanguage, onLanguageChange } = createLanguage(languages, ${JSON.stringify(catalog.source)}, { load, divisions: ${JSON.stringify(divisions)} });\n`;
  if (eager) language += 'for (const code of Object.keys(tables)) void loadLanguage(code);\n';
  files['language.mjs'] = language;
  if (target === 'ts') {
    let types = head + `export type Language = ${Object.keys(catalog.languages).map(l => JSON.stringify(l)).join(' | ')};\n`;
    types += `export declare const languages: ${JSON.stringify(catalog.languages)};\n`;
    types += '/** Resolves once the reader\'s language has loaded; render after it to avoid a flash of the source language. */\nexport declare const ready: Promise<Language>;\n';
    types += 'export declare function getLanguage(): Language;\n';
    types += '/** Load a language, switch the interface to it (or its closest match) and remember it. */\nexport declare function setLanguage(language: Language | (string & {})): Promise<Language>;\n';
    types += '/** Load a language for i18nmd.in(language), on a server or in tests. */\nexport declare function loadLanguage(language: Language | (string & {})): Promise<void>;\n';
    types += 'export declare function onLanguageChange(listener: (language: Language) => void): () => void;\n';
    types += '/** Internal: the messages loaded so far, which the generated modules add to. */\nexport declare const store: import("./runtime.mjs").LanguageState["store"];\n';
    files['language.d.mts'] = types;
  }
  for (const code of others) files[`languages/${code}.mjs`] = head + `export default ${table(catalog.messages, code)};\n`;

  let main = head + '/* eslint-disable */\nimport { createTranslator } from "./runtime.mjs";\nimport { store, ready, getLanguage, setLanguage, loadLanguage, onLanguageChange } from "./language.mjs";\n';
  if (target === 'ts') main += typesFor(catalog, tree);
  const own = eager ? catalog.messages : catalog.messages.filter(m => !m.division);
  if (own.length) main += `store.add(${table(own, catalog.source)});\n`;
  main += `const translator = createTranslator({ store, getLanguage }, ${JSON.stringify(tree)});\n`;
  main += '/** Translate into the current language: i18nmd("token"), i18nmd.division("token", values), or i18nmd.in("fr")… for a given language. */\n';
  main += target === 'ts' ? 'export const i18nmd = translator as Translator & { in(language: Language | (string & {})): Translator };\n' : 'export const i18nmd = translator;\n';
  main += 'export { languages } from "./language.mjs";\nexport { ready, getLanguage, setLanguage, loadLanguage, onLanguageChange };\n';
  files[`i18n.${ext}`] = main;

  for (const division of divisions) {
    const messages = catalog.messages.filter(m => m.division === division);
    let text = head + `// The ${division} division: import i18nmd from here to call i18nmd${accessorFor(namespaceFor(division, catalog.prefix || ''))}(…).\nimport { store } from "./language.mjs";\n`;
    if (!eager) text += `store.add(${table(messages, catalog.source)});\n`;
    text += `export { i18nmd } from "${i18nImport}";\n`;
    files[`${divisionFile(division)}.${ext}`] = text;
  }
  return files;
}

export function generateModule(input, target = 'ts') {
  const catalog = typeof input === 'string' ? parseCatalog(input, { allowIncomplete: true }) : validateCatalog(input, { allowIncomplete: true });
  if (target === 'json') return JSON.stringify(Object.fromEntries(Object.keys(catalog.languages).map(lang => [lang, Object.fromEntries(catalog.messages.map(m => [m.key, m.translations[lang]]))])), null, 2) + '\n';
  if (target === 'python' && catalog.syntax === 'icu') return pythonModule(catalog);
  if (target === 'python') {
    // These dictionaries contain strings only; JSON's quoted strings and object
    // syntax are valid Python literals, with no true/false/null conversion needed.
    const tables = generateModule(catalog, 'json');
    return `# Generated from i18n.md. Edit the Markdown source.\n\nLANGS = ${JSON.stringify(catalog.languages, null, 2)}\n_T = ${tables}\ndef i18nmd(token_name, language_code="${catalog.source}", **values):\n    table = _T.get(language_code) or _T["${catalog.source}"]\n    message = table.get(token_name) or _T["${catalog.source}"][token_name]\n    return message.format(**values) if values else message\n`;
  }
  return generateModules(catalog, { target })[`i18n.${target === 'ts' ? 'ts' : 'mjs'}`];
}

export const runtimeTypes = `/* eslint-disable */
export interface MessageNode { type: string; name?: string; style?: string; offset?: number; options?: Record<string, (string | MessageNode)[]>; children?: (string | MessageNode)[] }
export interface CompiledCatalog { source: string; languages: Record<string, string>; messages: Record<string, Record<string, (string | MessageNode)[]>> }
export interface I18nOptions { onError?: (error: Error) => void }
export interface LanguageOptions { load?: (language: string) => Record<string, (string | MessageNode)[]> | Promise<Record<string, (string | MessageNode)[]>>; divisions?: string[]; storageKey?: string | null; onError?: (error: Error) => void }
export interface LanguageState { store: CompiledCatalog & { add(table: Record<string, (string | MessageNode)[]>, language?: string): void }; ready: Promise<string>; getLanguage(): string; setLanguage(language: string): Promise<string>; loadLanguage(language: string): Promise<void>; onLanguageChange(listener: (language: string) => void): () => void }
export function createI18n(catalog: CompiledCatalog, options?: I18nOptions): (token: string, language?: string, values?: Record<string, unknown>) => string | any[];
export function matchLanguage(catalog: { languages: Record<string, string> }, requested: string | null | undefined): string | undefined;
export function createLanguage(languages: Record<string, string>, source: string, options?: LanguageOptions): LanguageState;
export function createTranslator(language: Pick<LanguageState, 'store' | 'getLanguage'>, divisions?: Record<string, unknown>, options?: I18nOptions): any;
`;
