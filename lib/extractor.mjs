import { parse, parseExpression } from '@babel/parser';
import { escapeMessageLiteral } from './messages.mjs';
import { languageName, accessorFor } from './catalog.mjs';

const attributes = new Set(['alt', 'title', 'placeholder', 'aria-label', 'aria-description', 'label']);
const sourcePlugins = ['jsx', 'typescript'];

// Readable tokens from the words of the message; a numeric suffix resolves collisions.
// Tokens never encode the text, so editing the source message keeps the token.
export function tokenFor(text, taken) {
  const words = text.toLowerCase().replace(/\{[^}]+\}|<\/?[\w-]+>/g, ' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  let slug = '';
  for (const word of words) { if (slug && slug.length + word.length >= 40) break; slug += (slug ? '_' : '') + word; }
  slug = slug.slice(0, 40) || 'message';
  if (/^\d/.test(slug)) slug = 'n' + slug;
  let key = slug;
  for (let n = 2; taken.has(key); n++) key = `${slug}_${n}`;
  return key;
}

const countLike = /^(?:n|num|count|total|qty|quantity|amount|size|length|\w*count|num\w*|\w*total)$/i;
const inlineAttributes = new Set(['className', 'class', 'href', 'to', 'target', 'rel', 'style', 'id', 'key', 'lang', 'dir']);

// A short element such as <b>, <a href>, or <Link to> inside a sentence becomes an ICU tag.
function inlineElement(child) {
  if (child.type !== 'JSXElement' || child.openingElement.selfClosing || child.openingElement.name.type !== 'JSXIdentifier') return false;
  if (!child.openingElement.attributes.every(a => a.type === 'JSXAttribute' && inlineAttributes.has(a.name?.name))) return false;
  return child.children.length > 0 && child.children.every(c => c.type === 'JSXText' || c.type === 'JSXExpressionContainer' && (c.expression.type === 'StringLiteral' || valueExpression(c.expression)));
}

function describe(node) {
  const name = node?.type === 'JSXOpeningElement' ? node.name : node?.openingElement?.name;
  return name?.type === 'JSXIdentifier' ? `<${name.name}>` : name ? 'element' : 'fragment';
}

// React's JSX line whitespace rules, applied before moving text to a catalog.
function jsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let last = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) last = i;
  return lines.map((line, i) => {
    let text = line.replace(/\t/g, ' ');
    if (i !== 0) text = text.replace(/^ +/, '');
    if (i !== lines.length - 1) text = text.replace(/ +$/, '');
    return text ? text + (i !== last ? ' ' : '') : '';
  }).join('');
}

function safeExpression(node) {
  return node?.type === 'Identifier' || node?.type === 'MemberExpression' && !node.computed && safeExpression(node.object) && node.property.type === 'Identifier';
}

function containsJsx(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key.endsWith('Comments')) continue;
    if (Array.isArray(value) ? value.some(containsJsx) : value && typeof value.type === 'string' && containsJsx(value)) return true;
  }
  return false;
}

// An expression inside a sentence that renders a value, not markup: it becomes a
// placeholder so the sentence stays whole. Anything that renders elements ends the sentence.
function valueExpression(node) {
  return node && node.type !== 'JSXEmptyExpression' && node.type !== 'StringLiteral' && !containsJsx(node);
}

const formatting = /^(?:to(?:Lower|Upper|Locale(?:Lower|Upper)?)Case|toString|toFixed|toPrecision|toLocaleString|trim\w*|padStart|padEnd|join|format)$/;

// A placeholder name a translator can understand, from the expression that fills it:
// item.name → name, formatLength(kerf) → kerf, LABELS[item.kind].toLowerCase() → kind,
// rows.length → rowsCount.
function placeholderName(node) {
  switch (node?.type) {
    case 'Identifier': return node.name;
    case 'MemberExpression': case 'OptionalMemberExpression':
      // LABELS[item.kind] → kind; parts.split(" ")[0] → parts.
      if (node.computed) return placeholderName(node.property) || placeholderName(node.object);
      if (node.property.name === 'length' && placeholderName(node.object)) return `${placeholderName(node.object)}Count`;
      return node.property.name;
    case 'CallExpression': case 'OptionalCallExpression': {
      const callee = node.callee;
      if (callee.type?.endsWith('MemberExpression') && !callee.computed && (formatting.test(callee.property.name) || /^(?:split|slice|substring|replace\w*|at|get|find)$/.test(callee.property.name))) return placeholderName(callee.object);
      if (node.arguments.length && placeholderName(node.arguments[0])) return placeholderName(node.arguments[0]);
      return callee.type?.endsWith('MemberExpression') ? callee.property.name : placeholderName(callee);
    }
    case 'TSNonNullExpression': case 'TSAsExpression': case 'ParenthesizedExpression': return placeholderName(node.expression);
    case 'LogicalExpression': return placeholderName(node.left);
    case 'ConditionalExpression': return placeholderName(['StringLiteral', 'TemplateLiteral'].includes(node.consequent.type) ? node.test : node.consequent);
    case 'BinaryExpression': return placeholderName(node.left);
    case 'UnaryExpression': return placeholderName(node.argument);
    default: return undefined;
  }
}

// Spaces and list separators (" · ", " | ", " — ") at a message's edges are layout,
// not wording: they stay in the code so translations need not reproduce them.
function splitEdges(text) {
  const [, lead, body, trail] = /^(\s*(?:[·•|—–-]\s+)?)([\s\S]*?)((?:\s+[·•|—–-])?\s*)$/.exec(text);
  return [lead, body, trail];
}

// Concatenation is text only when a string takes part; {index + 1} is arithmetic.
const concatenatesText = node => node.type === 'BinaryExpression' && node.operator === '+' && [node.left, node.right].some(n => n.type === 'StringLiteral' || n.type === 'TemplateLiteral' || concatenatesText(n));
const textChoice = node => node.type === 'ConditionalExpression' && [node.consequent, node.alternate].some(n => n.type === 'StringLiteral' || n.type === 'TemplateLiteral') || node.type === 'TemplateLiteral' || concatenatesText(node);

export function extractSource(source, options = {}) {
  const { filename = 'Component.tsx', locale = 'en', importPath = './i18n', languageExpression, existing, namespace = '' } = options;
  // Without a language expression, calls use the current language (setLanguage).
  if (languageExpression !== undefined) {
    const languageNode = parseExpression(languageExpression, { plugins: sourcePlugins });
    if (!safeExpression(languageNode) && languageNode.type !== 'StringLiteral') throw new Error('The language expression must be a string, variable, or property access.');
  }
  const callee = `i18nmd${languageExpression === undefined ? '' : `.in(${languageExpression})`}${accessorFor(namespace)}`;
  const ast = parse(source, { sourceType: 'unambiguous', plugins: sourcePlugins });
  const catalog = existing ? structuredClone(existing) : { title: 'Application strings', source: locale, syntax: 'icu', languages: { [locale]: languageName(locale) }, messages: [] };
  if (catalog.syntax !== 'icu' || catalog.source !== locale) throw new Error('JSX extraction needs an ICU catalog with the matching source language.');
  const byText = new Map(catalog.messages.map(m => [m.translations[locale], m]));
  const byKey = new Map(catalog.messages.map(m => [m.key, m]));
  const edits = [], diagnostics = [];
  let needsImport = false;
  const consumed = new WeakSet();
  const covered = node => consumed.has(node);
  const callFor = (text, params, node, explicit, where) => {
    // /* i18n:ui.save */ in code is ## save in the ui division's file.
    if (namespace && explicit?.startsWith(namespace)) explicit = explicit.slice(namespace.length);
    let message = explicit ? byKey.get(explicit) : byText.get(text);
    if (message && message.translations[locale] !== text) throw new Error(`Token ${message.key} already has different source text.`);
    if (!message) {
      const key = explicit || tokenFor(text, byKey);
      if (byKey.has(key)) throw new Error(`Token collision for ${key}. Set an explicit token with /* i18n:token_name */.`);
      message = { key, context: `${where} (${filename}:${node.loc.start.line})`, optional: [], translations: { [locale]: text } };
      catalog.messages.push(message); byText.set(text, message); byKey.set(key, message);
    }
    needsImport = true;
    for (const [name] of params) if (countLike.test(name) && !/\{\s*\w+\s*,\s*(plural|number|selectordinal)/.test(text)) diagnostics.push(`${filename}:${node.loc.start.line}: {${name}} looks like a count; consider {${name}, plural, one {…} other {…}} in ${message.key}.`);
    const values = params.length ? `, { ${params.map(([name, value]) => `${name}: ${value}`).join(', ')} }` : '';
    return `${callee}(${JSON.stringify(message.key)}${values})`;
  };
  // A template literal as a message: each ${…} becomes a named placeholder.
  const templateMessage = node => {
    const params = [];
    const text = node.quasis.map((q, i) => {
      if (q.value.cooked == null) throw new Error(`${filename}:${node.loc.start.line}: invalid template escape.`);
      let part = escapeMessageLiteral(q.value.cooked);
      if (i < node.expressions.length) {
        const expression = node.expressions[i];
        if (containsJsx(expression)) throw new Error(`${filename}:${node.loc.start.line}: a template placeholder cannot render elements.`);
        let name = /^[a-zA-Z_]\w*$/.test(placeholderName(expression) || '') ? placeholderName(expression) : 'value';
        while (params.some(p => p[0] === name)) name += '_';
        params.push([name, source.slice(expression.start, expression.end)]);
        part += `{${name}}`;
      }
      return part;
    }).join('');
    return { text, params };
  };
  // Wording chosen in code, {busy ? "Saving…" : "Save"}, becomes one message per
  // branch; the condition stays in code. Returns false for text it cannot convert.
  const convertText = (node, where) => {
    switch (node.type) {
      case 'StringLiteral': case 'TemplateLiteral': {
        const literal = node.type === 'StringLiteral' ? node.value : node.quasis.map(q => q.value.cooked ?? '').join('');
        if (!/\p{L}/u.test(literal)) return true;
        let { text, params } = node.type === 'StringLiteral' ? { text: escapeMessageLiteral(node.value), params: [] } : templateMessage(node);
        const [lead, body, trail] = splitEdges(text);
        const call = callFor(body, params, node, undefined, where);
        edits.push({ start: node.start, end: node.end, text: lead || trail ? `\`${lead}\${${call}}${trail}\`` : call });
        consumed.add(node);
        return true;
      }
      case 'ConditionalExpression': return [convertText(node.consequent, where), convertText(node.alternate, where)].every(Boolean);
      case 'LogicalExpression': return node.operator === '&&' ? convertText(node.right, where) : [convertText(node.left, where), convertText(node.right, where)].every(Boolean);
      case 'TSAsExpression': case 'ParenthesizedExpression': return convertText(node.expression, where);
      case 'BinaryExpression': return !concatenatesText(node);
      default: return true;
    }
  };
  function walk(node, parent) {
    if (!node || typeof node.type !== 'string' || covered(node)) return;
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      const children = node.children;
      for (let i = 0; i < children.length;) {
        const start = i;
        let text = '', literalText = '', params = [], used = new Map();
        const unique = base => { let name = /^[a-zA-Z_]\w*$/.test(base || '') && base !== '__proto__' ? base : 'value'; while (params.some(p => p[0] === name)) name += '_'; return name; };
        const choices = [];
        const piece = child => {
          if (child.type === 'JSXText') { const value = jsxText(child.value); literalText += value; return escapeMessageLiteral(value); }
          const expr = child.expression;
          if (expr.type === 'StringLiteral') { literalText += expr.value; return escapeMessageLiteral(expr.value); }
          const value = source.slice(expr.start, expr.end);
          let name = used.get(value);
          if (!name) {
            name = unique(placeholderName(expr)); used.set(value, name); params.push([name, value]);
            if (textChoice(expr)) choices.push(`${filename}:${expr.loc.start.line}: {${name}} is text chosen in code; move the wording into the message as {${name}, select, …} or a plural.`);
          }
          return `{${name}}`;
        };
        let outside = '';
        while (i < children.length) {
          const child = children[i];
          if (child.type === 'JSXText' || child.type === 'JSXExpressionContainer' && (child.expression.type === 'StringLiteral' || valueExpression(child.expression))) {
            const before = literalText.length; text += piece(child); outside += literalText.slice(before); i++; continue;
          }
          if (inlineElement(child)) {
            const opening = child.openingElement, tag = unique(opening.name.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'tag');
            const inner = child.children.map(piece).join('');
            const open = source.slice(opening.start, opening.name.end) + (opening.attributes.some(a => a.name.name === 'key') ? '' : ` key=${JSON.stringify(tag)}`) + source.slice(opening.name.end, opening.end);
            params.push([tag, `chunks => ${open}{chunks}${source.slice(child.closingElement.start, child.closingElement.end)}`]);
            text += `<${tag}>${inner}</${tag}>`; i++; continue;
          }
          break;
        }
        // Text with no letters (numbers, symbols, punctuation between values) is not translated.
        if (i > start && /\p{L}/u.test(outside)) {
          const first = children[start], last = children[i - 1];
          // Spaces at the edges separate the message from neighbouring elements; they stay in the code.
          const [lead, body, trail] = splitEdges(text);
          const space = ws => ws ? `{${JSON.stringify(ws)}}` : '';
          edits.push({ start: first.start, end: last.end, text: `${space(lead)}{${callFor(body, params, first, undefined, `Text in ${describe(node)}`)}}${space(trail)}` });
          diagnostics.push(...choices);
          for (let index = start; index < i; index++) consumed.add(children[index]);
        }
        // Wording chosen in code with nothing around it: each branch becomes its own message.
        else if (choices.length) {
          for (let index = start; index < i; index++) {
            const child = children[index];
            if (child.type !== 'JSXExpressionContainer' || !textChoice(child.expression)) continue;
            if (!convertText(child.expression, `Text in ${describe(node)}`)) diagnostics.push(`${filename}:${child.loc.start.line}: dynamic JSX text needs an explicit /* i18n */ message.`);
          }
        }
        if (i === start) {
          const child = children[i];
          if (child.type === 'JSXExpressionContainer' && child.expression.type !== 'JSXEmptyExpression' && !safeExpression(child.expression) && !['JSXElement', 'JSXFragment'].includes(child.expression.type)) {
            // Existing translation calls and structural expressions need no conversion.
            if (child.expression.type === 'TemplateLiteral' || child.expression.type === 'BinaryExpression') diagnostics.push(`${filename}:${child.loc.start.line}: dynamic JSX text needs an explicit /* i18n */ message.`);
          }
          i++;
        }
      }
    }
    if (node.type === 'JSXAttribute' && attributes.has(node.name?.name) && node.value?.type === 'StringLiteral' && /\p{L}/u.test(node.value.value)) {
      edits.push({ start: node.value.start, end: node.value.end, text: `{${callFor(escapeMessageLiteral(node.value.value), [], node, undefined, `${node.name.name} attribute of ${describe(parent)}`)}}` });
      consumed.add(node.value);
    }
    const comment = node.leadingComments?.find(c => /^\s*i18n(?:\s|:|$)/.test(c.value));
    if (comment && ['StringLiteral', 'TemplateLiteral'].includes(node.type) && parent?.type !== 'JSXAttribute' && parent?.type !== 'JSXExpressionContainer') {
      const { text, params } = node.type === 'StringLiteral' ? { text: escapeMessageLiteral(node.value), params: [] } : templateMessage(node);
      const explicit = /i18n:\s*([\w.-]+)/.exec(comment.value)?.[1];
      edits.push({ start: node.start, end: node.end, text: callFor(text, params, node, explicit, 'Annotated string') });
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) for (const child of value) walk(child, node);
      else if (value && typeof value === 'object') walk(value, node);
    }
  }
  walk(ast);
  const pieces = [];
  let cursor = 0;
  edits.sort((a, b) => a.start - b.start);
  for (const edit of edits) {
    pieces.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  pieces.push(source.slice(cursor));
  let rewritten = pieces.join('');
  if (needsImport) {
    // i18nmd may already come from another division's module beside ours; this
    // division's messages then need a plain import of its module.
    const sibling = source => source.replace(/[^/]*$/, '') === importPath.replace(/[^/]*$/, '');
    let hasImport = false, otherDivision = false;
    const imported = new Set(ast.program.body.filter(node => node.type === 'ImportDeclaration').map(node => node.source.value));
    for (const node of ast.program.body) {
      if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) {
        if (specifier.local.name !== 'i18nmd') continue;
        if (specifier.type !== 'ImportSpecifier' || specifier.imported.name !== 'i18nmd' || (node.source.value !== importPath && !sibling(node.source.value))) throw new Error('i18nmd is already imported from a different module.');
        hasImport = true;
        otherDivision = node.source.value !== importPath;
      }
    }
    if (otherDivision && !imported.has(importPath)) {
      const last = ast.program.body.filter(node => node.type === 'ImportDeclaration').at(-1);
      rewritten = rewritten.slice(0, last.end) + `\nimport ${JSON.stringify(importPath)};` + rewritten.slice(last.end);
    }
    // Refuse a local binding collision instead of silently changing its meaning.
    function checkBindings(node) {
      if (!node || typeof node !== 'object') return;
      const declarations = node.type === 'VariableDeclarator' ? [node.id] : /Function/.test(node.type || '') ? [node.id, ...(node.params || [])] : node.type === 'ClassDeclaration' ? [node.id] : [];
      const containsName = value => value && (value.type === 'Identifier' ? value.name === 'i18nmd' : Object.values(value).some(v => Array.isArray(v) ? v.some(containsName) : v && typeof v === 'object' && containsName(v)));
      if (declarations.some(containsName)) throw new Error('A local i18nmd binding would shadow the generated translation import. Rename it first.');
      for (const [key, value] of Object.entries(node)) if (!key.includes('Comments') && key !== 'loc') {
        if (Array.isArray(value)) value.forEach(checkBindings); else if (value && typeof value === 'object') checkBindings(value);
      }
    }
    checkBindings(ast.program);
    if (!hasImport) {
      const position = ast.program.directives.at(-1)?.end ?? ast.program.interpreter?.end ?? 0;
      rewritten = rewritten.slice(0, position) + `${position ? '\n' : ''}import { i18nmd } from ${JSON.stringify(importPath)};\n` + rewritten.slice(position);
    }
  }
  // Parse the result too; transformations must always produce valid TSX.
  parse(rewritten, { sourceType: 'unambiguous', plugins: sourcePlugins });
  return { source: rewritten, catalog, diagnostics, replacements: edits.length };
}

/**
 * The divisions a file's i18nmd calls use but whose generated modules it does not
 * import. accessors maps each division's property chain (".knowledgeHub.faq") to
 * its module name ("knowledge-hub.faq"); namespaces maps token prefixes
 * ("knowledge-hub.faq.") to the same. fix: the source with the missing imports
 * added. used: the full tokens the file calls by name; dynamic: calls whose token
 * is computed, so used may be incomplete.
 */
export function missingDivisionImports(source, { accessors, namespaces, filename = 'file.tsx' }) {
  let ast;
  try { ast = parse(source, { sourceType: 'unambiguous', plugins: sourcePlugins }); }
  catch (error) { throw new Error(`${filename}: ${error.message}`); }
  const imports = ast.program.body.filter(node => node.type === 'ImportDeclaration');
  const from = imports.find(node => node.specifiers.some(s => s.local.name === 'i18nmd'));
  const dir = from ? from.source.value.replace(/[^/]*$/, '') : '';
  const present = new Set(imports.filter(node => dir && node.source.value.startsWith(dir)).map(node => node.source.value.slice(dir.length).replace(/\.(?:[cm]?[jt]s|tsx?)$/, '')));
  const needed = new Map(), used = new Set();
  let dynamic = 0;
  const prefixOf = Object.fromEntries(Object.entries(namespaces).map(([prefix, file]) => [file, prefix]));
  const visit = node => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression') {
      // i18nmd.a.b(…) or i18nmd.in(x).a.b(…): the chain after i18nmd (and .in(x)).
      const chain = [];
      let callee = node.callee;
      while (callee?.type === 'MemberExpression' && !callee.computed) { chain.unshift(callee.property.name); callee = callee.object; }
      if (callee?.type === 'CallExpression' && callee.callee.type === 'MemberExpression' && callee.callee.property.name === 'in') callee = callee.callee.object;
      // i18nmd.in(locale) itself picks a language; the call on its result translates.
      if (callee?.type === 'Identifier' && callee.name === 'i18nmd' && !(chain.length === 1 && chain[0] === 'in')) {
        let division, prefix = '';
        const first = node.arguments[0];
        if (chain.length && chain[0] !== 'in') {
          // The chain names the whole division only when every property is one.
          division = accessors['.' + chain.join('.')];
          prefix = division ? prefixOf[division] : '';
          for (let n = chain.length - 1; n > 0 && !division; n--) division = accessors['.' + chain.slice(0, n).join('.')];
        } else if (!chain.length && first?.type === 'StringLiteral') {
          division = Object.keys(namespaces).filter(p => first.value.startsWith(p)).sort((a, b) => b.length - a.length).map(p => namespaces[p])[0];
        }
        if (first?.type === 'StringLiteral') used.add(prefix + first.value); else if (first) dynamic++;
        if (division && !needed.has(division)) needed.set(division, node.loc.start.line);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key.endsWith('Comments')) continue;
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value.type === 'string') visit(value);
    }
  };
  visit(ast.program);
  const missing = !from ? [] : [...needed].filter(([division]) => !present.has(division)).map(([division, line]) => ({ division, line, statement: `import ${JSON.stringify(dir + division)};` }));
  const last = imports.at(-1);
  const fix = missing.length ? source.slice(0, last.end) + missing.map(m => `\n${m.statement}`).join('') + source.slice(last.end) : source;
  return { missing, fix, used, dynamic };
}
