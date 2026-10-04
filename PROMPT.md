# Move an app's interface strings into i18nmd

Give these instructions to a coding agent in the application's repository. They work as an agent skill too.

1. **Look first.** Find any existing translation setup and reuse what fits. Note the language the product is written in; it becomes the source language (`--source it` for Italian). Commit or stash work in progress, because extraction rewrites files.

2. **Choose divisions.** If different people own different areas (the app, help articles, marketing pages), give each a directory under `translations/`. Divisions also split the bundle, so put strings that every page loads, such as sign-in, loading screens and the router, in a small division of their own. Skip areas that won't be translated, such as admin pages. Keep a script that maps divisions to source files, so extraction can be repeated:

   ```sh
   npx i18nmd extract src/routes.tsx src/components/Login.tsx --out translations/account --in-place
   npx i18nmd extract src/components --out translations/ui --in-place
   ```

   For a site of plain HTML pages, extract the pages (`npx i18nmd extract site --in-place`) and build each language with `npx i18nmd render site --out dist`.

3. **Review the extractor's work.** Read the diff. Then work through every diagnostic it printed:
   - *looks like a count*: make the message an ICU plural, `{count, plural, one {# item} other {# items}}`.
   - *text chosen in code*: move the wording into the message as an ICU `select` or plural, instead of passing English through a placeholder.
   - *dynamic JSX text*: text built by concatenation or `charAt(0).toUpperCase()`. Give it a message of its own; an internal id shown as text is a bug to fix.
   - *became N messages*: one element's text was cut into pieces around buttons or links. If the pieces form one sentence, make the elements tags (`<button>…</button>`) or placeholders (an element or a `{models, list}` value) and give the sentence one message.
   - *looks like text people read* in an object property or array: see step 4.

   Mark code samples, commands, URLs and names `translate="no"`; the extractor leaves them as written.

4. **Find what the extractor can't see**: strings in object properties (`{ label: "Save" }`), plain `.ts` files, validation errors, notifications, `document.title`, and server responses shown to users. Mark simple ones with `/* i18n */` and run extraction again, or write the call yourself. Leave identifiers, URLs, log messages, and anything sent to a machine.

5. **Write calls the way the extractor does.** Call `i18nmd.<division>(token, values)` and import `i18nmd` from that division's module. Pass values by name, and keep each sentence whole, with tags such as `<b>…</b>` for markup inside it. Never translate at module load: wrap constants in a function so a language change reaches them. Text sent to a server as the user's own words, such as suggested prompts for a chatbot, must be something the server understands in each language. Say so in its Context line.

6. **Write context.** Each message's `Context:` line says where it appears and anything ambiguous: whether "Close" is a verb, tone or formality, length limits, names not to translate.

7. **Compile and check.**

   ```sh
   npx i18nmd check --in src --fix     # adds missing division imports, lists unused tokens
   npx i18nmd compile
   ```

   Add `i18nmd compile` to the build. Run the type checker, linter and tests. Tests that search source files for wording should search `translations/` too.

8. **Report.** List changed files, strings left untranslated and why, and diagnostics you did not resolve. Don't claim complete coverage unless you checked every user-facing screen.

Keep everything in the repository. Don't send project strings or source code to outside services unless the user asked for LLM translation (`i18nmd translate`).
