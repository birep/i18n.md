# Changelog

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
