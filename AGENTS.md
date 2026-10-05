# Working on i18nmd

This repository is an independent open-source library. Keep changes useful to any consumer.

Never include private consumer names, domains, paths, source excerpts, project details, screenshots or internal requirements in committed files, issues, pull requests, release notes or package contents. Investigate consumer code outside this repository and reproduce problems here with synthetic, product-neutral examples. Before committing or publishing, inspect the staged diff and the package file list for private material.

Extraction and hard-coded text checking share `extractSource` in `lib/extractor.mjs`. Trace the CLI entry points in `bin/i18nmd.mjs` and the existing extractor and CLI tests before extending detection. Reuse that path instead of adding a second scanner. Test both extraction and checking, preserve expression evaluation and short-circuit behavior, and respect translation opt-outs and machine strings.
