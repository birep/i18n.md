import { parseCatalog, validateCatalog, namespaceFor, divisionProperty, accessorFor } from './catalog.mjs';
import { argumentsFor, parseMessage } from './messages.mjs';
import { numberOptions } from './runtime.mjs';
import PLURAL_RULES from './plural-rules.mjs';

export function compileCatalog(input) {
  const catalog = typeof input === 'string' ? parseCatalog(input, { allowIncomplete: true }) : validateCatalog(input, { allowIncomplete: true });
  const messages = Object.create(null);
  for (const message of catalog.messages) {
    messages[message.key] = Object.fromEntries(Object.entries(message.translations).map(([lang, text]) => [lang, parseMessage(text, catalog.syntax, catalog.formatters)]));
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

// The CLDR plural rules Intl.PluralRules uses for locale, as Python: a function
// of the ICU operands n, i, v, f, t and e. Returns [function name, source].
function pluralFunction(locale, type) {
  let resolved;
  try { resolved = new Intl.PluralRules(locale, { type }).resolvedOptions().locale; } catch { resolved = 'en'; }
  const table = PLURAL_RULES[type];
  const parts = resolved.split('-');
  while (parts.length && !Object.hasOwn(table, parts.join('-'))) parts.pop();
  const key = parts.join('-') || 'root';
  const relation = text => {
    const match = /^([nivwftce])(?:\s*%\s*(\d+))?\s*(!?=)\s*([\d.,\s]+)$/.exec(text.trim());
    if (!match) throw new Error(`Unsupported CLDR plural rule for ${key}: ${text}`);
    const ranges = match[4].split(',').map(r => { const [low, high = low] = r.trim().split('..'); return `(${low}, ${high})`; });
    return `${match[3] === '=' ? '' : 'not '}_in(${match[1]}${match[2] ? ` % ${match[2]}` : ''}, (${ranges.join(', ')},))`;
  };
  const name = `_${type}_${key.replace(/\W/g, '_')}`;
  let source = `def ${name}(n: Decimal, i: int, v: int, f: int, t: int, e: int) -> str:\n`;
  for (const [category, rule] of Object.entries(table[key] || {})) {
    source += `    if ${rule.split(/\s+or\s+/).map(and => and.split(/\s+and\s+/).map(relation).join(' and ')).join(' or ')}:\n        return "${category}"\n`;
  }
  return [name, source + '    return "other"\n'];
}

// How a language writes numbers, from Intl, for the Python formatter:
// [group mark, decimal mark, primary group size, secondary group size,
//  digits before grouping starts, { style: [positive pattern, negative pattern,
//  most fraction digits, fewest fraction digits] }], where {n} in a pattern is
// the grouped digits. styles lists the number styles the catalog uses.
function numberRules(locale, styles) {
  const make = options => { try { return new Intl.NumberFormat(locale, options); } catch { return new Intl.NumberFormat('en', options); } };
  const format = make();
  const parts = format.formatToParts(1234567.891);
  const integers = parts.filter(p => p.type === 'integer').map(p => p.value);
  const primary = integers.length > 1 ? integers.at(-1).length : 0;
  const secondary = integers.length > 2 ? integers.at(-2).length : primary;
  const minimum = format.formatToParts(1234).some(p => p.type === 'group') ? 1 : 2;
  const digits = new Set(['integer', 'group', 'decimal', 'fraction']);
  const pattern = (f, value) => f.formatToParts(value).map((p, i, all) => !digits.has(p.type) ? p.value : digits.has(all[i - 1]?.type) ? '' : '{n}').join('');
  const patterns = Object.fromEntries(styles.map(style => {
    const f = make(numberOptions(style));
    const { maximumFractionDigits, minimumFractionDigits } = f.resolvedOptions();
    return [style, [pattern(f, 1), pattern(f, -1), maximumFractionDigits, minimumFractionDigits]];
  }));
  return [parts.find(p => p.type === 'group')?.value ?? '', parts.find(p => p.type === 'decimal')?.value ?? '.', primary, secondary, minimum, patterns];
}

const PYTHON_RUNTIME = `
_log = logging.getLogger("i18nmd")
_FORMATTERS: dict[str, Callable[[Any, str], str]] = {}
_CONTEXT = Context(prec=1000, rounding=ROUND_HALF_UP)


def _number(value: Any) -> float | None:
    # Numbers are doubles, as in JavaScript, so both runtimes see the same value.
    if isinstance(value, bool):
        return None
    try:
        number = float(value if isinstance(value, (int, float)) else str(value).strip())
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _decimal(number: float) -> Decimal:
    # The shortest decimal that reads back as number, which is what Intl formats.
    return Decimal(repr(float(number)))


def _digits(number: Decimal, most: int, fewest: int = 0) -> tuple[str, str]:
    # Whole and fraction digits of |number|, rounded half away from zero like Intl.
    with localcontext(_CONTEXT):
        rounded = abs(number).quantize(Decimal(1).scaleb(-most))
    whole, _, fraction = format(rounded, "f").partition(".")
    return whole, fraction.rstrip("0").ljust(fewest, "0")


def _number_text(number: float, language: str, style: str = "") -> str:
    group, decimal, primary, secondary, minimum, styles = _NUMBERS[language]
    positive, negative, most, fewest = styles[style]
    value = _decimal(number)
    if style == "percent":
        value = value.scaleb(2)
    whole, fraction = _digits(value, most, fewest)
    if primary and len(whole) >= primary + minimum:
        groups = [whole[-primary:]]
        whole = whole[:-primary]
        while len(whole) > secondary:
            groups.insert(0, whole[-secondary:])
            whole = whole[:-secondary]
        whole = group.join([whole] + groups if whole else groups)
    text = whole + (decimal + fraction if fraction else "")
    return (negative if value.is_signed() else positive).replace("{n}", text)


def _in(value: Any, ranges: tuple[tuple[int, int], ...]) -> bool:
    return value == int(value) and any(low <= value <= high for low, high in ranges)


def _category(rules: Callable[..., str], number: float) -> str:
    # The CLDR operands of number as Intl.PluralRules reads it: rounded to at most
    # 3 decimals; like ICU, n is that value as a double and i keeps 18 digits.
    whole, fraction = _digits(_decimal(number), 3)
    n = Decimal(float(whole + "." + fraction if fraction else whole))
    with localcontext(_CONTEXT):
        return rules(n, int(whole[-18:]), len(fraction), int(fraction or 0), int(fraction or 0), 0)


def _exact(options: dict[str, Any], number: float) -> Any:
    value = _decimal(number)
    return next((branch for key, branch in options.items() if key.startswith("=") and Decimal(key[1:]) == value), None)


def _render(nodes: list[Any], language: str, values: dict[str, Any] | None, pound: Any = None) -> str:
    out: list[str] = []
    for node in nodes:
        if isinstance(node, str):
            out.append(node)
            continue
        kind = node["type"]
        if kind == "pound":
            out.append(_number_text(pound, language))
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
        elif kind == "format":
            fn = _FORMATTERS.get(node["format"])
            if value is None:
                _log.error("Missing value for {%s}.", name)
                out.append("{" + name + "}")
            elif fn is None:
                _log.error("No formatter for {%s, %s}.", name, node["format"])
                out.append(str(value))
            else:
                try:
                    out.append(str(fn(value, language)))
                except Exception:
                    _log.exception("Formatter %s failed for {%s}.", node["format"], name)
                    out.append(str(value))
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
            rules = (_ORDINAL if kind == "selectordinal" else _CARDINAL)[language]
            chosen = _exact(options, number) or options.get(_category(rules, number - node["offset"])) or options["other"]
            out.append(_render(chosen, language, values, number - node["offset"]))
        elif kind == "number":
            number = _number(value)
            out.append(str(value) if number is None else _number_text(number, language, node.get("style", "")))
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


def register_formatter(name: str, fn: Callable[[Any, str], str]) -> None:
    # Supply the function for an argument type the project declares: {len, length}.
    # fn(value, language) returns the text; keep it the same as the JavaScript one.
    _FORMATTERS[name] = fn


def has(token: str) -> bool:
    # Whether the catalog has token, for text written after the last compile.
    return token in _MESSAGES


def template(token: str, language: str | None = None) -> str:
    # The message with each placeholder, plural or select shown as {name}.
    entry = _MESSAGES[token]
    chosen = _match(language)
    return _render(entry[chosen if chosen in entry else SOURCE], SOURCE, None)
`;

// ICU messages as a dependency-free Python module: i18nmd(token, language, **values).
function pythonModule(catalog) {
  const compiled = compileCatalog(catalog);
  const languages = Object.keys(catalog.languages);
  const styles = new Set(['']);
  const visit = nodes => nodes.forEach(n => { if (n.type === 'number') styles.add(n.style); for (const branch of Object.values(n.options || {})) visit(branch); if (n.children) visit(n.children); });
  for (const byLang of Object.values(compiled.messages)) Object.values(byLang).forEach(visit);
  const literal = value => JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ');
  let text = '# Generated from i18n.md. Edit the Markdown source.\n# ruff: noqa\nfrom __future__ import annotations\n\nimport logging\nimport math\nfrom decimal import ROUND_HALF_UP, Context, Decimal, localcontext\nfrom typing import Any, Callable\n\n';
  text += `SOURCE = ${JSON.stringify(catalog.source)}\nLANGS: dict[str, str] = ${literal(catalog.languages)}\n`;
  // Plural rules from CLDR, the data Intl.PluralRules uses, as Python functions.
  const functions = new Map();
  const rules = type => Object.fromEntries(languages.map(l => { const [name, source] = pluralFunction(l, type); functions.set(name, source); return [l, name]; }));
  const cardinal = rules('cardinal'), ordinal = rules('ordinal');
  text += `\n\n${[...functions.values()].join('\n\n')}\n\n`;
  const table = map => `{${Object.entries(map).map(([l, name]) => `${JSON.stringify(l)}: ${name}`).join(', ')}}`;
  text += `_CARDINAL: dict[str, Callable[..., str]] = ${table(cardinal)}\n_ORDINAL: dict[str, Callable[..., str]] = ${table(ordinal)}\n`;
  text += `_NUMBERS: dict[str, list[Any]] = ${JSON.stringify(Object.fromEntries(languages.map(l => [l, numberRules(l, [...styles])])), null, 1)}\n`;
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
    for (const value of Object.values(message.translations)) argumentsFor(parseMessage(value, catalog.syntax, catalog.formatters), params);
    types[message.key] = Object.entries(params).map(([name, type]) => `${JSON.stringify(name)}: ${type === 'number' ? 'number' : type === 'date' ? 'Date | number' : type === 'select' ? 'string' : type === 'tag' ? '(chunks: any[]) => any' : type.startsWith('format:') ? 'any' : 'string | number | null | undefined'}`).join('; ');
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
  text += 'export interface Scope<P extends string> {\n  <S extends Short<P>>(token: S, ...args: Values[Full<P, S>] extends undefined ? [values?: undefined] : [values: Values[Full<P, S>]]): Full<P, S> extends RichToken ? any[] : string;\n  /** Whether the compiled catalog has this token, for text written after the last compile. */\n  has(token: string): token is Short<P>;\n}\n';
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
  const formatters = catalog.formatters || [];
  if (formatters.length) {
    main += 'const formatters = {};\n/** Supply the function for an argument type the project declares: {len, length}. */\n';
    main += target === 'ts'
      ? `export function registerFormatter(name: ${formatters.map(f => JSON.stringify(f)).join(' | ')}, format: (value: any, language: Language) => string): void { formatters[name] = format; }\n`
      : 'export function registerFormatter(name, format) { formatters[name] = format; }\n';
  }
  main += `const translator = createTranslator({ store, getLanguage }, ${JSON.stringify(tree)}${formatters.length ? ', { formatters }' : ''});\n`;
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
export interface I18nOptions { onError?: (error: Error) => void; formatters?: Record<string, (value: any, language: string) => string> }
export interface LanguageOptions { load?: (language: string) => Record<string, (string | MessageNode)[]> | Promise<Record<string, (string | MessageNode)[]>>; divisions?: string[]; storageKey?: string | null; onError?: (error: Error) => void }
export interface LanguageState { store: CompiledCatalog & { add(table: Record<string, (string | MessageNode)[]>, language?: string): void }; ready: Promise<string>; getLanguage(): string; setLanguage(language: string): Promise<string>; loadLanguage(language: string): Promise<void>; onLanguageChange(listener: (language: string) => void): () => void }
export function createI18n(catalog: CompiledCatalog, options?: I18nOptions): ((token: string, language?: string, values?: Record<string, unknown>) => string | any[]) & { has(token: string): boolean };
export function matchLanguage(catalog: { languages: Record<string, string> }, requested: string | null | undefined): string | undefined;
export function createLanguage(languages: Record<string, string>, source: string, options?: LanguageOptions): LanguageState;
export function createTranslator(language: Pick<LanguageState, 'store' | 'getLanguage'>, divisions?: Record<string, unknown>, options?: I18nOptions): any;
`;
