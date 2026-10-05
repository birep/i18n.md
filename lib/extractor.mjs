import { parse, parseExpression } from '@babel/parser';
import { escapeMessageLiteral, isAddress } from './messages.mjs';
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

// A string attribute's value: translate="no" or translate={"no"}.
function attributeValue(element, name) {
  const value = element?.openingElement?.attributes.find(a => a.type === 'JSXAttribute' && a.name?.name === name)?.value;
  return value?.type === 'StringLiteral' ? value.value : value?.type === 'JSXExpressionContainer' && value.expression.type === 'StringLiteral' ? value.expression.value : undefined;
}

// translate="no" content stays as written, as in HTML.
const noTranslate = node => node?.type === 'JSXElement' && attributeValue(node, 'translate') === 'no';
// Text a reader reads: it has letters and isn't an address such as example.com.
const wording = text => /\p{L}/u.test(text) && !isAddress(text);

// Strings in object properties and arrays that look like text people read
// ("Miter saw", "Save changes."), for the diagnostic that lists them.
const looksShown = text => /\p{L}{3,}/u.test(text) && /^\s*\p{Lu}/u.test(text) && /\p{L}[\s.…!?]|[.…!?]$/u.test(text.trim()) && !isAddress(text) && !/^[\w-]+$/.test(text.trim()) && !/[{}<>\\/=]|^[A-Z_\d]+$/.test(text);
// Properties that hold interface text even when it is one word: { label: "Drill" }.
// Also camelCase names ending in one: idleTitle, commitLabel, sawName, emptyHint.
const labelKeys = /^(?:label|title|heading|subheading|subtitle|description|desc|blurb|hint|tooltip|caption|placeholder|summary|empty|help|note|ariaLabel)$|^[a-z]\w*(?:Label|Title|Name|Heading|Hint|Tooltip|Caption|Placeholder|Description|Blurb|Message)$/;
// Maps named for labels, { furniture: "Furniture" }: every value is interface text.
const labelMapName = /(?:LABELS?|NAMES|TITLES|HEADINGS|CAPTIONS)$|(?:Labels|Names|Titles)$/;
const shortLabel = text => /\p{L}{2,}/u.test(text) && !/\p{Ll}\p{Lu}/u.test(text) && /^\s*\p{Lu}[\p{L}'’ -]*$/u.test(text) && !/^[A-Z_\d]+$/.test(text.trim()) && !isAddress(text);
const machineKeys = /^(?:id|key|type|kind|href|url|src|path|to|icon|className|class|style|value|name|slug|variant|role|method|mime|format|pattern|event|color|testId|data\w*)$/;

// The visible text of an element, as written: a heading's or a label's words.
function plainText(node) {
  if (node.type === 'JSXText') return jsxText(node.value);
  if (node.type === 'JSXExpressionContainer') return node.expression.type === 'StringLiteral' ? node.expression.value : '';
  return node.type === 'JSXElement' || node.type === 'JSXFragment' ? node.children.map(plainText).join('') : '';
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
// /* i18n-ignore */ before a string or property: deliberately not translated (a brand, a code).
const ignored = node => [node, node?.value].some(n => n?.leadingComments?.some(c => /^\s*i18n-ignore\b/.test(c.value)));
const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;
// A condition choosing between two literals: a plural when it compares a count
// with 1 (n === 1, n !== 1, n > 1), otherwise a yes/no select.
function literalChoice(node) {
  if (node?.type !== 'ConditionalExpression' || node.consequent.type !== 'StringLiteral' || node.alternate.type !== 'StringLiteral') return null;
  const [a, b] = [node.consequent.value, node.alternate.value];
  if (!wording(a) && !wording(b)) return null;
  const t = node.test;
  if (t.type === 'BinaryExpression') {
    const one = n => n.type === 'NumericLiteral' && n.value === 1;
    const count = one(t.right) ? t.left : one(t.left) ? t.right : null;
    if (count && ['===', '=='].includes(t.operator)) return { count, one: a, other: b };
    if (count && ['!==', '!=', '>'].includes(t.operator) && t.right.type === 'NumericLiteral') return { count, one: b, other: a };
  }
  return { yes: a, no: b };
}
const textChoice = node => node.type === 'ConditionalExpression' && [node.consequent, node.alternate].some(n => n.type === 'StringLiteral' || n.type === 'TemplateLiteral') || node.type === 'TemplateLiteral' || concatenatesText(node);

export function extractSource(source, options = {}) {
  const { filename = 'Component.tsx', locale = 'en', importPath = './i18n', languageExpression, existing, namespace = '', analyze = false } = options;
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
  // The nodes from the program down to the one being visited.
  const ancestors = [];
  const basename = filename.split(/[\\/]/).pop();
  // Where a message appears, in words a translator can use: the component, and
  // the nearest heading, label or aria-label. Line numbers would go stale.
  const contextFor = where => {
    let component, under;
    for (let k = ancestors.length - 1; k >= 0; k--) {
      const node = ancestors[k], next = ancestors[k + 1];
      const name = ['FunctionDeclaration', 'ClassDeclaration'].includes(node.type) ? node.id?.name : node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && /Function|Call|Class/.test(node.init?.type || '') ? node.id.name : undefined;
      if (name && !component && /^[A-Z][a-z]/.test(name)) component = name;
      if (under || node.type !== 'JSXElement' || !next) continue;
      const label = ['aria-label', 'title'].map(n => node.openingElement.attributes.find(a => a.type === 'JSXAttribute' && a.name?.name === n)).find(a => a && !ancestors.includes(a));
      const labelText = label && attributeValue(node, label.name.name);
      if (labelText && wording(labelText)) { under = `in the part labelled "${labelText.trim()}"`; continue; }
      const index = node.children.indexOf(next);
      for (let j = index - 1; j >= 0 && !under; j--) {
        const sibling = node.children[j], tag = sibling.type === 'JSXElement' && sibling.openingElement.name.name;
        if (!/^(?:h[1-6]|label|legend)$/.test(tag || '')) continue;
        const text = plainText(sibling).replace(/\s+/g, ' ').trim();
        if (wording(text)) under = `${tag === 'label' ? 'beside the label' : tag === 'legend' ? 'in the section' : 'under the heading'} "${text.length > 60 ? text.slice(0, 59) + '…' : text}"`;
      }
    }
    return `${where} in ${component || basename}${under ? `, ${under}` : ''}`;
  };
  const callFor = (text, params, node, explicit, where) => {
    // /* i18n:ui.save */ in code is ## save in the ui division's file.
    if (namespace && explicit?.startsWith(namespace)) explicit = explicit.slice(namespace.length);
    let message = explicit ? byKey.get(explicit) : byText.get(text);
    if (message && message.translations[locale] !== text) throw new Error(`Token ${message.key} already has different source text.`);
    if (!message) {
      const key = explicit || tokenFor(text, byKey);
      if (byKey.has(key)) throw new Error(`Token collision for ${key}. Set an explicit token with /* i18n:token_name */.`);
      message = { key, context: contextFor(where), optional: [], translations: { [locale]: text } };
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
        if (!wording(literal)) return true;
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
    if (!node || typeof node.type !== 'string' || covered(node) || noTranslate(node)) return;
    ancestors.push(node);
    try { visit(node, parent); } finally { ancestors.pop(); }
  }
  function visit(node, parent) {
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      const children = node.children;
      // The messages this element's text became, to spot a sentence cut in pieces.
      const fragments = [];
      // A choice between literals becomes a select or plural only inside a
      // sentence; standing alone, each branch stays its own message.
      const inSentence = children.some(c => c.type === 'JSXText' && wording(c.value));
      for (let i = 0; i < children.length;) {
        const start = i;
        let text = '', literalText = '', params = [], used = new Map();
        const unique = base => { let name = /^[a-zA-Z_]\w*$/.test(base || '') && base !== '__proto__' ? base : 'value'; while (params.some(p => p[0] === name)) name += '_'; return name; };
        const choices = [];
        const piece = child => {
          if (child.type === 'JSXText') { const value = jsxText(child.value); literalText += value; return escapeMessageLiteral(value); }
          const expr = child.expression;
          if (expr.type === 'StringLiteral') { literalText += expr.value; return escapeMessageLiteral(expr.value); }
          // {n === 1 ? "" : "s"} and {busy ? "Saving" : "Save"}: the wording moves into the message.
          const choice = inSentence && literalChoice(expr);
          if (choice) {
            const branch = t => escapeMessageLiteral(t);
            if (choice.count) {
              const countSource = source.slice(choice.count.start, choice.count.end);
              // "{n} file{n === 1 ? '' : 's'}" is one plural: {n, plural, one {# file} other {# files}}.
              const merged = /\{(\w+)\} (\p{L}+)$/u.exec(text);
              if (merged && params.find(p => p[0] === merged[1])?.[1] === countSource) {
                text = text.slice(0, merged.index) + `{${merged[1]}, plural, one {# ${merged[2]}${branch(choice.one)}} other {# ${merged[2]}${branch(choice.other)}}}`;
                literalText += choice.other;
                return '';
              }
              let name = used.get(countSource);
              if (!name) { name = unique(placeholderName(choice.count)); used.set(countSource, name); params.push([name, countSource]); }
              literalText += choice.other;
              return `{${name}, plural, one {${branch(choice.one)}} other {${branch(choice.other)}}}`;
            }
            const name = unique(placeholderName(expr.test) || 'choice');
            params.push([name, `${source.slice(expr.test.start, expr.test.end)} ? "yes" : "no"`]);
            literalText += choice.yes + choice.no;
            return `{${name}, select, yes {${branch(choice.yes)}} other {${branch(choice.no)}}}`;
          }
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
            const before = literalText.length; const part = piece(child); text += part; outside += literalText.slice(before); i++; continue;
          }
          // translate="no" inside a sentence (a URL in <code>, a brand) is a
          // placeholder: the sentence stays whole and the element stays as written.
          if (noTranslate(child) && child.openingElement.name.type === 'JSXIdentifier') {
            const name = unique(child.openingElement.name.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'value');
            params.push([name, source.slice(child.start, child.end)]);
            text += `{${name}}`; i++; continue;
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
        if (i > start && wording(outside)) {
          const first = children[start], last = children[i - 1];
          // Spaces at the edges separate the message from neighbouring elements; they stay in the code.
          const [lead, body, trail] = splitEdges(text);
          fragments.push({ body, start, end: i, line: first.loc.start.line });
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
      // Fragments of one element that read as one sentence: "Want to see …?",
      // <button>, "or", <a>. A translator needs the whole sentence to reorder it.
      for (let f = 1; f < fragments.length; f++) {
        const before = fragments[f - 1], after = fragments[f];
        if (/[.!?…:;]["')\]»”]*$/u.test(before.body) && !/^\p{Ll}/u.test(after.body) && fragments.length < 3) continue;
        const between = children.slice(before.end, after.start).filter(c => c.type !== 'JSXText' || c.value.trim()).map(c => c.type === 'JSXElement' ? describe(c) : 'an expression');
        diagnostics.push(`${filename}:${before.line}: ${describe(node)} became ${fragments.length} messages around ${[...new Set(between)].join(', ') || 'other elements'} ("${fragments.map(x => x.body.length > 24 ? x.body.slice(0, 23) + '…' : x.body).join('" | "')}"); if they form one sentence, make the elements tags (<b>…</b>) or placeholders and mark it /* i18n */ so it is one message.`);
        break;
      }
    }
    // Strings in object properties and arrays (tool labels, preset names) that read
    // like interface text: the extractor leaves them, but a language switch can't reach them.
    // { label: "Drill" } and maps named for labels become getters, so a
    // language switch reaches them: get label() { return i18nmd(…); }.
    if (node.type === 'ObjectProperty' && !node.computed && node.value.type === 'StringLiteral' && !node.value.leadingComments?.length && !ignored(node) && !covered(node.value)) {
      const key = node.key.name ?? node.key.value;
      const owner = ancestors.at(-3);
      const mapNamed = parent?.type === 'ObjectExpression' && owner?.type === 'VariableDeclarator' && owner.id.type === 'Identifier' && labelMapName.test(owner.id.name)
        && parent.properties.every(p => p.type === 'ObjectProperty' && p.value.type === 'StringLiteral' && (ignored(p) || looksShown(p.value.value) || shortLabel(p.value.value)));
      const text = node.value.value;
      if (typeof key === 'string' && /^[A-Za-z_$][\w$]*$/.test(key) && !machineKeys.test(key) && key !== 'displayName' && (labelKeys.test(key) && (looksShown(text) || shortLabel(text)) || mapNamed)) {
        const call = callFor(escapeMessageLiteral(text), [], node, undefined, `${key} of ${owner?.id?.name ?? 'an object'}`);
        edits.push({ start: node.start, end: node.end, text: `get ${key}() { return ${call}; }` });
        consumed.add(node.value);
      }
    }
    if (node.type === 'StringLiteral' && !covered(node) && !node.leadingComments?.some(c => /^\s*i18n/.test(c.value)) && !(parent?.type === 'ObjectProperty' && ignored(parent)) && looksShown(node.value)
      && (parent?.type === 'ArrayExpression' || parent?.type === 'ObjectProperty' && parent.value === node && !parent.computed && !machineKeys.test(parent.key.name ?? parent.key.value ?? ''))) {
      diagnostics.push(`${filename}:${node.loc.start.line}: "${node.value.length > 40 ? node.value.slice(0, 39) + '…' : node.value}" in ${parent.type === 'ArrayExpression' ? 'an array' : `the ${parent.key.name ?? parent.key.value} property`} looks like text people read; mark it /* i18n */ and build the object in a function so a language change reaches it.`);
    }
    if (node.type === 'JSXAttribute' && attributes.has(node.name?.name) && node.value?.type === 'StringLiteral' && wording(node.value.value)) {
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
  // check --hardcoded: what extract would convert, without touching imports.
  if (analyze) {
    const shown = diagnostics.filter(d => d.includes('looks like text people read'));
    const findings = [
      ...edits.map(e => ({ line: lineAt(source, e.start), text: source.slice(e.start, e.end).replace(/\s+/g, ' ').slice(0, 60) })),
      ...shown.map(d => ({ line: Number(/:(\d+):/.exec(d)?.[1] ?? 0), text: /"(.*?)" in/.exec(d)?.[1] ?? d })),
    ].sort((a, b) => a.line - b.line);
    return { findings };
  }
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
      // With the file's other imports, or else after its directives and leading comments.
      const statement = `import { i18nmd } from ${JSON.stringify(importPath)};`;
      const lastImport = ast.program.body.filter(node => node.type === 'ImportDeclaration').at(-1);
      const firstCode = ast.program.body[0]?.start ?? source.length;
      const leading = ast.comments.filter(c => c.end <= firstCode).at(-1)?.end ?? 0;
      const position = lastImport ? lastImport.end : Math.max(ast.program.directives.at(-1)?.end ?? 0, ast.program.interpreter?.end ?? 0, leading);
      // No edit comes before position: imports, directives and comments hold no text.
      rewritten = lastImport || position ? rewritten.slice(0, position) + `\n${statement}` + (lastImport ? '' : '\n') + rewritten.slice(position) : `${statement}\n` + rewritten;
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
