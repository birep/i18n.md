# i18n.md

**[Try the live demo at i18n.md](https://i18n.md)** · Made by **[Liko Labs](https://likolabs.com)** in Hilo, Hawaiʻi · [ʻŌlelo Hawaiʻi](README.haw.md)

Keep your interface strings in Markdown, for apps and for plain HTML sites: one file per language, readable and editable by translators, reviewers and LLMs. A compiler checks every language and generates typed code your app imports.

[Liko Labs](https://likolabs.com) created i18nmd and makes it freely available in the hope of making ʻōlelo Hawaiʻi easy to offer for any business or community group in Hawaiʻi. A website in English and Hawaiian is three commands, `extract`, `--add haw` and `render` (see [Static websites](#static-websites)), and every Hawaiian sentence stays in a plain file a fluent speaker can review and correct. For help bringing ʻōlelo Hawaiʻi to your site or app, contact [Liko Labs](https://likolabs.com).

````md
# Français

## cart_items

Context: Item count in the cart header.

```icu
{count, plural, one {# article} other {# articles}}
```
````

```tsx
<p>{i18nmd('cart_items', { count })}</p>
```

The files are the source of truth. They diff in pull requests, and anyone can hand one to a person or an LLM to translate. Everything i18nmd does is a change to those files or code generated from them.

- [Install](#install)
- [Quick start](#quick-start)
- [Static websites](#static-websites)
- [Language files](#language-files)
- [Divisions](#divisions)
- [Using the generated code](#using-the-generated-code)
- [Extracting strings from your code](#extracting-strings-from-your-code)
- [Translating with an LLM](#translating-with-an-llm)
- [Keeping translations current](#keeping-translations-current)
- [Text from a database](#text-from-a-database)
- [Python](#python)
- [Other formats and libraries](#other-formats-and-libraries)
- [Command reference](#command-reference)
- [Current limits](#current-limits)

## Install

i18nmd needs Node.js 22 or newer.

```sh
npm install --save-dev @likolabs/i18nmd
npx i18nmd --version
```

## Quick start

**1. Extract the strings** from a React or other JSX/TSX codebase. With `--in-place`, i18nmd rewrites your sources, so commit first and review the diff.

```sh
npx i18nmd extract src --in-place
```

Your strings land in `translations/i18n-en.md` (use `--source it` if your app is in Italian), and your code calls the translations instead:

```tsx
// before
<p>Welcome back, {user.name}!</p>
// after
import { i18nmd } from '../i18n/i18n';
<p>{i18nmd('welcome_back', { name: user.name })}</p>
```

The extractor prints what it could not convert, such as text built in code or counts that should be plurals. [The extraction prompt](PROMPT.md) tells a coding agent how to finish the job.

**2. Add languages.** Ask an LLM through the CLI, or write the files yourself:

```sh
export ANTHROPIC_API_KEY=…    # or OPENAI_API_KEY, or I18NMD_* (see below)
npx i18nmd --add french --add german
```

**3. Compile** into `src/i18n`. Add it to your build so every build uses the latest translations:

```sh
npx i18nmd compile
```

```json
{ "scripts": { "prebuild": "i18nmd compile" } }
```

**4. Let readers choose a language.** Calls translate into the current language, which starts as the reader's browser language:

```tsx
import { useSyncExternalStore } from 'react';
import { languages, getLanguage, setLanguage, onLanguageChange } from './i18n/language.mjs';

export function LanguagePicker() {
  const language = useSyncExternalStore(onLanguageChange, getLanguage);
  return (
    <select value={language} onChange={e => void setLanguage(e.target.value)}>
      {Object.entries(languages).map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
    </select>
  );
}
```

**5. Keep it current.** After editing source text, `npx i18nmd status` shows what needs translating and `npx i18nmd translate` fills it in.

## Static websites

A site made of HTML pages needs no JavaScript at all. i18nmd writes a copy of each page in each language:

```sh
npx i18nmd extract site --in-place                            # site/*.html → translations/i18n-en.md
npx i18nmd --add haw                                          # or write translations/i18n-haw.md yourself
npx i18nmd render site --out dist --url https://example.com   # dist/ and dist/haw/
```

`extract` marks each piece of text with a `data-i18n` attribute and leaves the English where it is, so the page still opens and edits as before:

```html
<h1 data-i18n="from_first_leaf_to_full_grown">From first leaf to <em class="red">full grown.</em></h1>
```

The message keeps the sentence whole, with its inline markup as tags: `From first leaf to <em>full grown.</em>`. Translators move the tag; its class and other attributes stay in the page. Extract also takes the page `<title>`, the description and link-preview `<meta>` tags, `alt`, `title`, `placeholder` and `aria-label` attributes, and strings in inline scripts marked `/* i18n */`:

```js
statusEl.textContent = /* i18n */ 'Sending…';
```

It skips addresses such as `example.com`, and anything inside an element with `translate="no"`, the standard attribute for names and code. It lists text it can't place, such as words beside a block element, and script strings that look like text people read.

The English lives in your HTML. Edit a page, run `extract` again, and the source language file follows; the other languages' versions of that text become stale for `translate` to update.

`render` writes the source language where the pages are and every other language in a directory named for it, `/haw/`, copying everything else in the site alongside. Each copy gets:

- the translated text, with untranslated text left in the source language
- `<html lang>`, and `dir="rtl"` for right-to-left languages
- `<link rel="alternate" hreflang>` to every language's copy, so search engines index each one
- with `--url`, `og:url` and canonical links pointing at that copy
- relative links adjusted for the language directory

Put `<nav data-i18n-languages></nav>` anywhere on a page, and render fills it with a link to each language, named in that language. Deploy `dist/`.

## Language files

`translations/i18n-fr.md` holds French and nothing else. The filename gives the language code (`fr`, `pt-BR`, or a custom name such as `pirate`). The first heading names the language in that language, and each `##` heading is a token:

````md
# Français

## cart_items

Context: Item count in the cart header.

```icu
{count, plural, one {# article} other {# articles}}
```

## greeting

Optional: a

```icu
Bonjour {name} !
```
````

- **Context** explains where a string appears and anything a translator needs: tone, length limits, what not to translate.
- **Optional** lists placeholders a translation may leave out, such as an English article (`{a}` for "a" or "an") that other languages don't need.
- The message is [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/): named placeholders `{name}`, `plural`, `selectordinal`, `select`, `number` (`integer`, `percent`, `::currency/EUR`), `date` and `time` with a style, `list` (`{models, list}` for "A, B and C", `{models, list, disjunction}` for "A, B or C", or `unit`), and tags such as `<b>…</b>`.
- **App formatters** cover values ICU can't write, such as `1-1/2"`: `{len, length}` passes `len` to a function your app supplies. Declare the names once in `i18nmd.lock.json`, `"formatters": ["length"]`, and `check` and `compile` reject any other type. Translators may move the placeholder but not change its type; put unit notes in the context line. The same value can also choose a plural branch, `{len, plural, …}`.
- An apostrophe is just an apostrophe; every language file says so at the top, because translators who know ICU otherwise write around them. To write a literal brace, or `<` before a letter, quote it: `'{'`, `'<'`.

That is the whole format. Bookkeeping lives beside the files in `i18nmd.lock.json`, which records the source language and which translations are current.

Every language file uses the same tokens and placeholders as the source. `i18nmd check` validates all of them: a translation with a missing or unknown placeholder, a broken plural or a tag that doesn't match is reported, and the build uses the source text until it is fixed. Builds never fail on missing or outdated translations.

## Divisions

A large app can split its strings into divisions, one subdirectory each, divided however suits the people editing them:

```
translations/
  i18nmd.lock.json
  account/i18n-en.md     account/i18n-fr.md
  ui/i18n-en.md          ui/i18n-fr.md
  marketing/i18n-en.md   marketing/i18n-fr.md
  marketing/landing/i18n-en.md
```

Each division has its own source file and translations, and its tokens are namespaced by its path. `## hero` in `marketing/i18n-en.md` is the token `marketing.hero`:

```tsx
import { i18nmd } from './i18n/marketing';
import './i18n/marketing.landing';
import './i18n/knowledge-hub';

i18nmd.marketing('hero')            // or i18nmd('marketing.hero')
i18nmd.marketing.landing('save')    // marketing/landing/
i18nmd.knowledgeHub('search')       // knowledge-hub/ becomes camelCase
```

Files keep the short names, so two divisions can both have a `save`. Name division directories with letters, digits, `_` and `-`; names every function already has (`name`, `length`, `call`, …) and `in` are refused.

Divisions also split your bundle: each one compiles to its own module, which your bundler ships with the code that uses it. Put the strings every page needs, such as sign-in and loading screens, in a small division of their own, so the first download carries only those.

Commands on `translations/` cover every division, and `status` breaks progress down by division. Pass a division's directory to work on it alone, such as `i18nmd translate translations/marketing`. The lock stays at the top and is shared.

## Using the generated code

```sh
npx i18nmd compile                  # translations/ → src/i18n
npx i18nmd compile --out lib/i18n   # elsewhere
```

### Calling translations

```tsx
import { i18nmd } from './i18n/i18n';

i18nmd('cart_items', { count: 3 })       // top-level token
i18nmd.ui('save')                        // a division's token
i18nmd.in('fr').ui('save')               // a fixed language
```

TypeScript checks every token name and its values: a missing value, a wrong type or a token from another division is a compile error. A plain placeholder also accepts `null` or `undefined` and renders nothing, as JSX does.

A placeholder can also take an element, and a list placeholder takes an array, which the runtime joins the way each language does. With an element among the values, the call returns an array, which React renders directly:

```tsx
// Paired with frontier models like {models}, the assistant can …
i18nmd.site('pitch', { models: <ModelLinks /> })
// Works with {models, list, disjunction}.  →  "Works with Claude, GPT or Gemini."
i18nmd.site('works_with', { models: [<a href={claude}>Claude</a>, 'GPT', 'Gemini'] })
```

Code that calls a division imports `i18nmd` from that division's module (`./i18n/ui`). A file that calls a second division also imports its module, `import './i18n/marketing'`. `extract` writes these imports. `npx i18nmd check --in src` fails with the line to add when one is missing, and `--fix` adds it.

Strings in code that runs once, such as a module-level constant, are translated at that moment. Wrap them in a function so a language change reaches them:

```ts
export const steps = () => [i18nmd.ui('measure'), i18nmd.ui('cut')];
```

### The current language

The current language starts as the reader's earlier choice, then their browser's languages, then the source language. `language.mjs` manages it and holds no messages, so your entry code can import it cheaply:

| Export | Does |
| --- | --- |
| `languages` | Every language code and its name in that language, for a picker. |
| `getLanguage()` | The current language. |
| `setLanguage(code)` | Loads the language, switches to it and remembers it. Accepts a close match: `pt` picks `pt-BR`. |
| `onLanguageChange(listener)` | Calls the listener after each switch; returns an unsubscribe function. |
| `ready` | Resolves once the reader's language has loaded. |
| `loadLanguage(code)` | Loads a language for `i18nmd.in(code)`, on a server or in tests. |

Each translation is its own chunk, so readers download only their language. Render after `ready` so a reader who chose French sees French from the first paint; for the source language it resolves at once. `onLanguageChange` and `getLanguage` are exactly what React's `useSyncExternalStore` takes, so a one-line hook re-renders a component when the language changes and keeps its state:

```tsx
import { useSyncExternalStore } from 'react';
import { ready, getLanguage, onLanguageChange } from './i18n/language.mjs';

export const useLanguage = () => useSyncExternalStore(onLanguageChange, getLanguage);

function Toolbar() {
  useLanguage();                    // re-render here in the new language
  return <button>{i18nmd.ui('save')}</button>;
}
ready.then(() => createRoot(root).render(<App />));
```

Call it in components that show text, or at the top of a tree whose children re-render with it. An app with no state worth keeping can instead remount everything, `<App key={useLanguage()} />`; in an editor that would throw away the user's work.

Language lookup tries the exact code (`fr-CA`), then the base language (`fr`), then the source language. Inside a message, a missing translation falls back to the source text.

### Rich text

Inline markup stays inside the sentence, so translators can reorder it:

```icu
Read <link>the guide</link> before <b>{date, date, long}</b>.
```

```tsx
i18nmd('read_the_guide', {
  date,
  link: chunks => <a key="link" href="/guide">{chunks}</a>,
  b: chunks => <b key="b">{chunks}</b>,
})
```

Messages with tags return an array, which React renders directly.

### App formatters

Register each formatter the lock declares before rendering. It receives the value and the language being written, and returns text:

```ts
import { registerFormatter } from './i18n/i18n';

registerFormatter('length', (inches, language) => language === 'en' ? toFractionalInches(inches) : `${Math.round(inches * 25.4)} mm`);
```

i18nmd ships no formatters; your app decides what `length` means. A missing or failing formatter is reported like other runtime errors and the raw value is shown.

### What compile writes

| File | Holds |
| --- | --- |
| `i18n.ts` | Types, `i18nmd`, and top-level tokens. |
| `<division>.ts` | One division's source-language messages. |
| `language.mjs` | The current language and loaders, without messages. |
| `languages/<code>.mjs` | Every message in one other language. |
| `runtime.mjs` | The formatter, which uses the browser's `Intl` for plurals, numbers and dates. |

Commit these or generate them in your build; compile removes files it generated earlier but no longer writes. `--eager` puts every message and language in `i18n.ts` instead, for servers, tests and small apps. `--target js` writes the same files as JavaScript, `--target json` writes one JSON file of message text. `--only <division,…>` compiles just the divisions this program shows (`.` is the top level), such as a server's replies for `--target python`; `--skip <division,…>` instead leaves out divisions another program uses.

### Errors at runtime

An unknown token or a missing value never crashes the page. The runtime logs it and shows the token name or `{placeholder}` instead. A token from a division the page never imported says which import to add.

`i18nmd.has('cart_items')`, or `i18nmd.ui.has('save')` for a division, says whether a token is in the compiled catalog without logging anything, so code can tell text added since the last compile from a mistake.

## Extracting strings from your code

```sh
npx i18nmd extract src --in-place                                   # everything → translations/
npx i18nmd extract src/account src/routes.tsx --out translations/account --in-place
```

`extract` reads JavaScript and TypeScript, with or without JSX, and moves these into the source language file:

- JSX text, keeping each sentence whole. Values inside a sentence become named placeholders: `{formatLength(kerf)}` becomes `{kerf}`, and `{items.length}` becomes `{itemsCount}`.
- Inline elements such as `<b>`, `<a href>` and `<Link to>`, which become tags.
- Wording chosen in code: `{busy ? "Saving…" : "Save"}` becomes two messages.
- Visible attributes: `alt`, `title`, `placeholder`, `label`, `aria-label`, `aria-description`.
- Any string marked `/* i18n */`, or `/* i18n:token_name */` to choose its token.

It leaves alone numbers, symbols and text without letters, addresses such as `example.com`, anything inside an element with `translate="no"` (code samples, commands, names), and anything it can't convert safely; those are listed with their file and line. A `translate="no"` element inside a sentence, such as a URL in `<code>`, becomes a placeholder, so the sentence stays whole.

It also flags:

- counts that should be plurals, and wording built in code that should become an ICU `select`;
- an element whose text became several messages that read as one sentence, such as "Want to see it?", a button, "or": make the elements tags or placeholders so translators get the whole sentence;
- strings in object properties and arrays that look like interface text (`{ label: "Miter saw" }`), which a language switch can't reach until they are built in a function.

Each message's context names its component and the nearest heading, label or `aria-label`: `Text in <p> in Pitch, under the heading "Bring your own agent"`. Edit it to say what a translator needs; extract never rewrites context. The import goes after the file's other imports, or below its leading comments.

Token names come from the words of the message, such as `welcome_back`, and never change when you edit the text. Running extract again keeps every token and translation, and only adds new strings. Without `--in-place` it writes converted copies to `--dest` (default `.i18n/src`) and leaves your sources alone. `--out translations/<division>` extracts into a division.

The extractor handles the mechanical part. [PROMPT.md](PROMPT.md) is a prompt for a coding agent to do the rest: strings in plain `.ts` files and objects, sentences built in code, and checking every screen.

## Translating with an LLM

```sh
npx i18nmd --add french               # also: Français, fr, pt-BR, "brazilian portuguese", klingon
npx i18nmd --add pirate               # anything unrecognized becomes a custom style
npx i18nmd --top 10                   # the 10 most widely spoken languages (i18nmd languages lists them)
npx i18nmd translate                  # fill every missing or outdated translation
npx i18nmd translate --only fr,de --dry-run
```

Set one of these:

```sh
export ANTHROPIC_API_KEY=…                        # Claude
export OPENAI_API_KEY=… OPENAI_BASE_URL=…         # OpenAI or any compatible API
export I18NMD_BASE_URL=… I18NMD_API_KEY=… I18NMD_MODEL=…   # overrides both
```

The provider is detected from the URL or key; `--provider`, `--base-url`, `--model` and `--batch` override it per run.

Messages go in batches, each with its context line, existing translations as a glossary, and any earlier translation of a changed message. Every reply is checked like a hand-written translation. A message that fails is retried once with the error, and anything still failing is reported and falls back to the source language. Progress is saved after every batch, so an interrupted run loses nothing.

## Keeping translations current

```sh
npx i18nmd status
```

```
English (en): 1847 tokens, source
Français (fr): 1790/1847 done, 40 missing, 17 stale
```

A translation is **stale** when its source text changed after it was written. Edit the translation and i18nmd counts it as updated; there are no markers to remove. `translate` fills missing and stale translations.

The files can't show whether a translation was edited before or after its source changed, so an edit counts once `sync` has seen the source change. If you changed the source and its translations together, `sync` says which stale translations were also edited; after reviewing them, `npx i18nmd accept chat.greeting [--only fr]` records them as current (`chat.*` accepts a whole division).

| Command | Does |
| --- | --- |
| `status` | Progress per language and division. |
| `check` | Validates every file. `--strict` also fails on anything missing or stale, for CI before a release. `--in src` checks your code imports the divisions it calls and lists tokens no code calls. |
| `sync` | Updates `i18nmd.lock.json` and removes tokens the source no longer has from other languages. |
| `accept <token…>` | Records reviewed translations as current for their source text. `--only fr,de`; a prefix such as `ui.*` covers a division. |
| `rename <old> <new> --in src` | Renames a token in every language, the lock, and the calls in your code. |
| `join --out all.md` | Writes every language into one Markdown file, to review side by side or hand to an LLM. |
| `split all.md --out translations` | Splits a joined file back into language files. |

Commands find `translations/`, `i18n/`, `locales/` or the current directory on their own; pass a path or `--dir` for anywhere else. Every command also accepts a joined file in place of a directory.

## Text from a database

Sentences stored in a database, such as narration written by people or agents, are translated through the same files. i18nmd has no database adapter and never translates at request time; the Markdown files and the lock are the cache, so each sentence is translated once.

1. A job in your app writes new or changed sentences as FormatJS JSON, `{"step_42": {"defaultMessage": "Cut the board to {len, length}.", "description": "Narration for step 42"}}`, and merges them into a division's source file:

   ```sh
   npx i18nmd import sentences.json --from formatjs --merge --out translations/procedures
   ```

   `--merge` appends new tokens and replaces changed text. It removes nothing and leaves other languages and the lock alone, so `status` lists new sentences as missing and changed ones as stale.
2. `npx i18nmd translate` fills the other languages, and `npx i18nmd compile` builds the catalog.
3. Until a sentence is translated, the runtime shows it in the source language. Until it is compiled, `i18nmd.has(token)` is false and the app shows its own copy of the text.

## Python

```sh
npx i18nmd compile translations/server --target python --out app/i18n
```

```python
from app.i18n.i18n import i18nmd, template, LANGS

i18nmd("server.parts", "de", n=3)   # "3 Teile"
```

The Python module has no dependencies, and it renders every message exactly as the JavaScript runtime does: placeholders, plurals, ordinals, selects, lists and numbers, including decimals such as French `1,5`, which takes the `one` form. Plural rules come from CLDR, the data `Intl` uses, and each language's number style (`1.234,5` in German, `12,34,567` in Hindi, currencies) from your Node.js's `Intl` at compile time. Python numbers are read as doubles, as JavaScript reads them. A test renders a spread of languages and values in both runtimes and requires identical output. That parity holds against CLDR 48 (Node.js 26); a browser with older CLDR data can differ from the Python rules in rare cases, which is a difference in `Intl` versions, not a bug in i18nmd.

`template(token, language)` returns the message with placeholders shown as `{name}`, `has(token)` says whether a token is in the module, and `register_formatter("length", fn)` supplies an app formatter, where `fn(value, language)` returns text. Keep each formatter the same in both languages; i18nmd can only promise identical output for its own formatting. `import-python <module.py> --out translations` converts an existing literal Python translation table.

## Other formats and libraries

```sh
npx i18nmd import locales/*/translation.json --from i18next
npx i18nmd import lang/en.json lang/fr.json --from formatjs
npx i18nmd export --to next-intl --out messages      # messages/fr.json
npx i18nmd export --to formatjs --out lang           # lang/fr.json, for react-intl
npx i18nmd export --to i18next --out locales         # locales/fr/translation.json
```

FormatJS and next-intl already use ICU, so conversion is lossless, and FormatJS descriptions become context lines. For i18next, `{{name}}` becomes `{name}`, plural suffixes become ICU plurals, and nested keys become dotted tokens. Messages i18next can't express are kept as ICU strings for the i18next-icu plugin, with a warning. You can edit in i18nmd and ship whatever your app already loads.

## Command reference

| Command | |
| --- | --- |
| `render <site>` | `--out dist`, `--url https://example.com` |
| `extract <src…>` | `--in-place`, `--out translations/<division>`, `--source en`, `--runtime src/i18n/i18n`, `--dest .i18n/src`, `--locale-expr locale` (calls use `i18nmd.in(locale)`) |
| `compile` | `--out src/i18n`, `--target ts\|js\|json\|python`, `--eager`, `--only <division,…>` or `--skip <division,…>` |
| `--add <language>`, `--top <n>`, `translate` | `--only fr,de`, `--dry-run`, `--provider`, `--base-url`, `--model`, `--batch 40`; a path picks a division: `--add zh translations/site` |
| `accept <token…>` | `--only fr,de` |
| `status`, `check`, `sync` | `--strict`, `--in src`, `--fix`, `--skip` |
| `rename <old> <new>` | `--in src` |
| `join`, `split` | `--out` |
| `import`, `export`, `import-python` | `--from`, `--to`, `--out`, `--merge` |
| `languages` | The ranked list `--top` uses. |

Every command takes `--dir`, and `--source` to override the source language recorded in the lock. `npx i18nmd --help` lists everything.

## Current limits

- The extractor reads HTML, JavaScript and TypeScript. Strings in object properties (`{ label: "Save" }`) and plain `.ts` files need `/* i18n */` or the extraction prompt; extract lists the ones that look like interface text.
- Switching language loads that whole language at once, not per division.
- The Python target writes dates as given, and a tag's text without its markup unless you pass a function for it. Its placeholders and lists take text, not elements.
- App formatters are yours to keep identical in JavaScript and Python.

## Development

```sh
npm ci --ignore-scripts
npm test
```

The tests use a local stand-in for both LLM APIs, so they need no keys and make no network calls.

## License

MIT © [Liko Labs](https://likolabs.com)
