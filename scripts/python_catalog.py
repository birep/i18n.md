"""Read literal translation tables with ast; never execute an input module."""
import ast
import json
import string
import sys
from pathlib import Path


def read_catalog(filename, table_name="_T", languages_name="LANGS"):
    source = Path(filename).read_text()
    tree = ast.parse(source)
    found = {}
    for node in tree.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name) and target.id in (table_name, languages_name):
                    if target.id in found:
                        raise ValueError(f"Duplicate assignment to {target.id}")
                    found[target.id] = ast.literal_eval(node.value)
    tables = found[table_name]
    languages = found[languages_name]
    if not isinstance(tables, dict) or not isinstance(languages, dict) or set(tables) != set(languages):
        raise ValueError("Translation tables must match the declared languages")
    source_language = "en" if "en" in tables else next(iter(tables))
    keys = set(tables[source_language])
    if any(set(table) != keys for table in tables.values()):
        raise ValueError("Every language must have the same tokens")
    formatter = string.Formatter()
    messages = []
    for key, value in tables[source_language].items():
        translations = {lang: table[key] for lang, table in tables.items()}
        params = {name for _, name, _, _ in formatter.parse(value) if name}
        optional = set()
        for text in translations.values():
            names = {name for _, name, _, _ in formatter.parse(text) if name}
            if not names <= params:
                raise ValueError(f"{key}: a translation introduces unknown placeholders")
            optional |= params - names
        messages.append({"key": key, "context": f"{Path(filename).name}: {key}", "optional": sorted(optional), "translations": translations})
    return {"title": "Application strings", "source": source_language, "syntax": "python", "languages": languages, "messages": messages}


if __name__ == "__main__":
    try:
        print(json.dumps(read_catalog(*sys.argv[1:]), ensure_ascii=False))
    except (ValueError, KeyError, SyntaxError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
