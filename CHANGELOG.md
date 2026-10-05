# Changelog

## 0.6.0

Less hand work after `extract`, and a check that keeps new text out of code.

- **`check --hardcoded <dir>`** lists text people read that is still written in code, with file and line. `--baseline f.json` fails only when a file gains more than the baseline records, so a project can adopt i18nmd gradually; `--write-baseline` records the current counts; `--skip` leaves out paths.
- **Labels in objects become getters.** `{ label: "Drill" }`, including one-word labels, becomes `get label() { return i18nmd("drill"); }`, so a language switch reaches it. A map named for labels (`STATUS_LABELS`) has every value converted.
- **Choices in a sentence become `select`,** with the code passing `"yes"`/`"no"`; on their own they still become two messages.
- **Counts chosen in code become plurals.** `{n} file{n === 1 ? "" : "s"}` becomes `{n, plural, one {# file} other {# files}}`.
- **`/* i18n-ignore */`** keeps a string or property as written (brand names, codes).
- **Fixed:** SVG path data in arrays was reported as interface text.

## 0.5.1

- **Requests fit the model's output limit before they are sent.** 0.5.0 sent each language as one request, and when the reply ran past the model's limit (8,000 tokens on DeepSeek) the cut-off reply was paid for, thrown away and split; a run estimated at 250,000 tokens used 710,000. Messages are now grouped so each reply fits within 60% of `--max-output` (8,000 by default, also sent as `max_tokens`), and the estimate counts those requests. Splitting a cut-off reply stays as a fallback.

## 0.5.0

Translation cost far more than it should have: one run of about 1,650 strings into nine languages used over a million input tokens.

- **The whole file in one request.** A language's missing messages now go out as one Markdown file instead of batches of 40, so the instructions are sent once per language rather than once per 40 messages. A reply cut off by the model's output limit is split in halves and retried. `--batch <n>` still caps a request.
- **No glossary.** Every request used to carry 40 existing translations; with the whole file in one request the model sees all the terms together.
- **A price before the run.** `translate` prints its estimated requests and tokens, and stops above `--budget` (200,000 tokens by default) unless `--yes` is passed. It prints the tokens actually used afterwards.
- **Reasoning is off unless asked for.** `--reasoning low|medium|high` (or `I18NMD_REASONING`) sends `reasoning_effort` to OpenAI-compatible endpoints.
- **All languages and requests run at once,** instead of four languages at a time with each language's batches one after another.

## 0.4.0

Findings from moving a real app (about 550 strings in 12 languages) onto i18nmd.

- **Fixed: JSX extraction honours `translate="no"`** and skips addresses such as `example.com`, as HTML extraction does. A `translate="no"` element inside a sentence, such as a URL in `<code>`, becomes a placeholder so the sentence stays whole.
- **Fixed: `--add zh translations/site`** treated the path as a language and wrote `i18n-translations-site.md` everywhere. A path among the languages now picks the directory or division to work on, as it does for `translate`, and a path is never accepted as a language name.
- **Fixed: generated Python passes `mypy --strict`.** `template()` crashed on a message with a tag; it now shows the tag, `<b>{name}</b>`. The plain (`syntax: python`) target is typed too.
- **Fixed: generated files carry no `eslint-disable` comments,** which failed lint in projects that report unused directives. The types that must be `any` are spelled `ReturnType<typeof JSON.parse>`, which lint rules accept.
- **`i18nmd accept <token…> [--only fr]`** records reviewed translations as current. A translation edited together with its source, with no `sync` between, is still marked stale, because the files can't show which came first; `sync` now says which stale translations were edited and suggests `accept`. `ui.*` accepts a whole division.
- **`compile --only <division,…>`** compiles just the divisions one program uses, such as a server's replies for `--target python`, so new divisions no longer leak into it. `.` is the top level.
- **Element placeholders:** a placeholder can take a React element (or any object), and the call then returns an array to render. TypeScript infers this from the values passed: a call with only text values still returns `string`.
- **Lists:** `{models, list}`, `{models, list, disjunction}` and `{models, list, unit}` join an array the way each language does ("A, B and C", "A, B o C"), with elements kept in place. The Python module matches `Intl.ListFormat` in every language, including ICU's contextual Spanish and Hebrew forms, checked by a new parity test.
- **Extractor diagnostics:** an element whose text became several messages that read as one sentence, and strings in object properties and arrays that look like interface text.
- **Context lines** name the component and the nearest heading, label or `aria-label` instead of a file and line number, which went stale on the next edit.
- **Import placement:** extract adds its import after the file's other imports, or below its leading comments, instead of above them.
- **README:** a `useSyncExternalStore(onLanguageChange, getLanguage)` hook re-renders components on a language switch and keeps their state; remounting the app is now the alternative for apps without state.
- **Language files say apostrophes are ordinary text** in a line under the title, so translators who know ICU stop writing around them. Existing files gain the line the next time i18nmd writes them.

## 0.3.1

- **Fixed:** the compiler loaded its plural rules through `node:module`, so bundling it for the browser (as the i18n.md demo does) failed. The rules are now a plain JavaScript module.

## 0.3.0

- **Fixed: Python plurals now match JavaScript.** The Python module used a table of whole numbers, so decimals always took `other` (French `1.5` is `one`) and large numbers could pick the wrong form (French `1000000` is `many`). It now evaluates CLDR's plural rules, the data behind `Intl.PluralRules`, with the same operands and rounding, and rounds numbers half away from zero as `Intl` does. Python numbers are read as doubles, like JavaScript's. A new cross-runtime test renders plurals, ordinals and every number style in 20 languages over 160 values and requires identical output.
- **Currencies in Python:** `{n, number, ::currency/EUR}` now writes the currency as `Intl` does.
- **App formatters:** `{len, length}` passes a value to a function the app supplies, for text ICU can't write, such as fractional inches. Declare the names in `i18nmd.lock.json` (`"formatters": ["length"]`), then `registerFormatter` (generated JavaScript), `createI18n(catalog, { formatters })`, or `register_formatter` (Python).
- **`has(token)`:** `i18nmd.has(token)`, `i18nmd.<division>.has(token)` and Python's `has(token)` say whether a token is compiled. A division can no longer be called `has`.
- **Fixed:** `import --out translations/<division>` wrote its own lock inside the division with unprefixed tokens, so `status` from the root never saw its translations. It now records them in the tree's lock.
- **`import --merge`** adds source-language messages to an existing source file without touching other languages or the lock. The README describes how to translate sentences stored in a database this way.

## 0.2.1

- **Python numbers follow each language:** grouping and decimal marks, Indian-style grouping, minus signs and percent signs come from `Intl` at compile time, so `{n, number}` and `#` match the JavaScript runtime.
- **README in ʻōlelo Hawaiʻi:** [README.haw.md](README.haw.md).
- **Fixed:** a translation edited before its source text changed was counted as updated for the new text, so the change went unnoticed. Now an edit only counts once `sync` (or `status`) has seen the source change; if both changed in between, the translation is marked stale for review. Existing lock files keep working.

## 0.2.0

- **Static websites.** `extract` reads `.html` pages: it marks each sentence, the title and description, image text and form labels with a `data-i18n` attribute and leaves the English in place, and takes `/* i18n */` strings from inline scripts. `render <site> --out dist --url …` writes a copy of every page in every language (`/haw/…`) with `lang`, `hreflang` links, `og:url`, adjusted relative links, and a language switcher wherever a page has `<nav data-i18n-languages>`. No JavaScript needed.

## 0.1.1

- Published to npm as `@likolabs/i18nmd` (`npm install --save-dev @likolabs/i18nmd`); the command is still `i18nmd`. npm 12 refuses GitHub and tarball URLs by default, so the 0.1.0 install instructions failed there.
- The `i18nmd` command is kept when publishing; npm 12 dropped the `./bin/…` form.

## 0.1.0

The first release.

- **Language files**: one Markdown file per language, with context lines, optional placeholders and ICU messages. `i18nmd.lock.json` tracks which translations are current.
- **Divisions**: subdirectories of `translations/` with namespaced tokens (`i18nmd.marketing('hero')`), each compiled to its own module so bundlers split strings by page.
- **Compiler**: typed TypeScript or JavaScript with lazy-loaded languages, `--eager` for servers and tests, JSON, and a dependency-free Python module with ICU plurals.
- **Runtime**: a current language that follows the reader's choice and browser, `setLanguage`, `onLanguageChange` and `ready`, rich-text tags, and fallbacks that never crash the page.
- **Extraction** from JavaScript and TypeScript: whole sentences with named placeholders, wording chosen in code, attributes, and `/* i18n */` strings, repeatable and in place.
- **LLM translation** through Anthropic or any OpenAI-compatible API, checked like hand-written translations.
- **Maintenance**: `status`, `check` (including `--in src` for division imports and unused tokens), `sync`, `rename`, `join` and `split`.
- **Interop**: import and export for FormatJS, next-intl and i18next, and import of Python translation tables.
