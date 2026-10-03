# Changelog

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
