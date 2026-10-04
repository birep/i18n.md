// Static HTML pages: extract marks each translatable element with
// data-i18n="token" and leaves the English in place; render writes one page per
// language from the Markdown files. English is authored in the HTML.
import { posix } from 'node:path';
import { parse } from 'parse5';
import { parse as parseScript } from '@babel/parser';
import { escapeMessageLiteral, parseMessage, isAddress } from './messages.mjs';
import { languageName } from './catalog.mjs';
import { tokenFor } from './extractor.mjs';

// Elements that sit inside a sentence; they become ICU tags.
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var']);
// Empty elements allowed at the start or end of a sentence, such as a logo before a name.
const VOID = new Set(['img', 'br', 'wbr', 'input', 'svg']);
const SKIP = new Set(['script', 'style', 'template', 'svg', 'math', 'noscript', 'pre', 'textarea', 'select', 'iframe', 'object', 'canvas']);
const ATTRIBUTES = ['alt', 'title', 'placeholder', 'aria-label', 'aria-description', 'label'];
const META = new Set(['description', 'og:title', 'og:description', 'og:image:alt', 'og:site_name', 'twitter:title', 'twitter:description', 'twitter:image:alt']);
const URL_ATTRIBUTES = ['href', 'src', 'srcset', 'action', 'poster', 'formaction'];
const WHITESPACE = /[ \t\n\r\f]+/g;

const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const isElement = node => !!node.tagName;
const isText = node => node.nodeName === '#text';
const letters = text => /\p{L}/u.test(text);
const address = isAddress;
const translatable = text => letters(text) && !address(text);
const noTranslate = node => attr(node, 'translate') === 'no';

function describe(node) {
  const tag = node.tagName;
  const kind = /^h[1-6]$/.test(tag) ? 'Heading' : { p: 'Paragraph', li: 'List item', a: 'Link', button: 'Button', label: 'Form label', title: 'Page title', option: 'Choice in a list', caption: 'Table caption', figcaption: 'Figure caption', th: 'Table heading', td: 'Table cell', legend: 'Form section title', summary: 'Disclosure summary', dt: 'Term', dd: 'Definition' }[tag] || `<${tag}>`;
  for (let up = node.parentNode; up; up = up.parentNode) if (isElement(up) && attr(up, 'id')) return `${kind} in #${attr(up, 'id')}`;
  return kind;
}

// A sentence: an element whose content is only text and inline elements, with
// any empty elements at its edges.
function sentence(node) {
  if (!isElement(node) || SKIP.has(node.tagName) || noTranslate(node)) return null;
  const children = node.childNodes.filter(c => c.nodeName !== '#comment');
  let start = 0, end = children.length;
  const blank = c => isText(c) && !c.value.trim();
  const edge = c => blank(c) || (isElement(c) && VOID.has(c.tagName));
  while (start < end && edge(children[start])) start++;
  while (end > start && edge(children[end - 1])) end--;
  const body = children.slice(start, end);
  if (!body.length) return null;
  const phrasing = c => isText(c) || c.nodeName === '#comment' || (isElement(c) && INLINE.has(c.tagName) && c.childNodes.every(phrasing));
  if (!body.every(phrasing)) return null;
  // Links side by side are separate items, not a sentence: a sentence has words of its own.
  if (body.some(isElement) && !body.some(c => isText(c) && letters(c.value))) return null;
  const text = body.map(function all(c) { return isText(c) ? c.value : (c.childNodes || []).map(all).join(''); }).join('');
  return translatable(text) ? { body, lead: children.slice(0, start), trail: children.slice(end) } : null;
}

// The message for a sentence, and the element each tag name stands for. Names
// come from the element (em, a, a_2) and are rebuilt the same way when rendering.
function messageFor(body) {
  const tags = new Map(), counts = new Map();
  const walk = nodes => nodes.map(node => {
    if (isText(node)) return escapeMessageLiteral(node.value.replace(WHITESPACE, ' '));
    if (!isElement(node)) return '';
    const n = (counts.get(node.tagName) || 0) + 1;
    counts.set(node.tagName, n);
    const name = n === 1 ? node.tagName : `${node.tagName}_${n}`;
    tags.set(name, node);
    return `<${name}>${walk(node.childNodes)}</${name}>`;
  }).join('');
  return { text: walk(body).trim(), tags };
}

/** Every translatable spot in a page: sentences, attributes and annotated script strings. */
function units(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const found = [], diagnostics = [];
  const attributes = node => {
    for (const name of ATTRIBUTES) if (translatable(attr(node, name) || '')) found.push({ kind: 'attribute', node, name, text: escapeMessageLiteral(attr(node, name).replace(WHITESPACE, ' ').trim()), context: `${name} text of ${describe(node)}` });
  };
  const visit = node => {
    if (!isElement(node)) { (node.childNodes || []).forEach(visit); return; }
    if (noTranslate(node)) return;
    const meta = node.tagName === 'meta' && (attr(node, 'name') || attr(node, 'property'));
    if (meta && META.has(meta) && translatable(attr(node, 'content') || '')) found.push({ kind: 'attribute', node, name: 'content', text: escapeMessageLiteral(attr(node, 'content')), context: `Page ${meta.replace(/^(og|twitter):/, '')} for search and link previews` });
    attributes(node);
    if (node.tagName === 'input' && ['submit', 'button', 'reset'].includes(attr(node, 'type')) && letters(attr(node, 'value') || '')) found.push({ kind: 'attribute', node, name: 'value', text: escapeMessageLiteral(attr(node, 'value')), context: `Button in ${describe(node)}` });
    if (node.tagName === 'script' && !attr(node, 'src')) { scriptStrings(node, found, diagnostics, html); return; }
    if (SKIP.has(node.tagName)) return;
    const unit = sentence(node);
    if (unit) {
      const { text, tags } = messageFor(unit.body);
      found.push({ kind: 'sentence', node, ...unit, text, tags, context: describe(node) });
      // Elements inside a sentence keep their own attributes, such as an icon's alt text.
      const inside = n => { for (const c of n.childNodes || []) if (isElement(c) && !noTranslate(c)) { attributes(c); inside(c); } };
      inside(node);
      return;
    }
    for (const child of node.childNodes || []) {
      if (isText(child) && translatable(child.value)) diagnostics.push(`line ${child.sourceCodeLocation?.startLine}: text beside other elements in <${node.tagName}> ("${child.value.trim().slice(0, 40)}"); wrap it in an element such as <span> to translate it.`);
      else visit(child);
    }
  };
  visit(document);
  return { document, found, diagnostics };
}

// Script strings that read like words for people: a capitalised word and a space or
// sentence punctuation, unlike ids, selectors, URLs and JSON keys.
const shown = text => /^\s*[\p{Lu}]/u.test(text) && /[\p{L}][\s.…!?]|[.…!?]$/u.test(text.trim()) && !address(text) && !/^[\w-]+$/.test(text.trim());

// Strings in an inline script marked /* i18n */ or /* i18n:token */.
function scriptStrings(node, found, diagnostics, html) {
  const text = node.childNodes[0];
  if (!text?.sourceCodeLocation) return;
  const offset = text.sourceCodeLocation.startOffset;
  let ast;
  try { ast = parseScript(text.value, { sourceType: 'unambiguous', errorRecovery: true }); } catch { return; }
  const visit = n => {
    if (!n || typeof n.type !== 'string') return;
    const comment = n.leadingComments?.findLast(c => /^\s*i18n(?:\s*$|:)/.test(c.value));
    if (comment && (n.type === 'StringLiteral' || (n.type === 'TemplateLiteral' && !n.expressions.length))) {
      const value = n.type === 'StringLiteral' ? n.value : n.quasis[0].value.cooked;
      found.push({ kind: 'script', start: offset + n.start, end: offset + n.end, commentStart: offset + comment.start, commentEnd: offset + comment.end, explicit: /i18n:\s*([\w.-]+)/.exec(comment.value)?.[1], text: escapeMessageLiteral(value), context: 'Text a script on the page shows' });
    } else if (!comment && (n.type === 'StringLiteral' || n.type === 'TemplateLiteral') && shown(n.value ?? n.quasis.map(q => q.value.cooked).join(''))) {
      diagnostics.push(`line ${node.sourceCodeLocation.startLine + (n.loc?.start.line || 1) - 1}: a script string looks like text people read ("${(n.value ?? n.quasis[0].value.cooked).slice(0, 40)}"); mark it /* i18n */ to translate it.`);
    } else if (comment) diagnostics.push(`line ${node.sourceCodeLocation.startLine + (n.loc?.start.line || 1) - 1}: /* i18n */ marks a string that isn't plain; use a string without \${…}.`);
    for (const [key, value] of Object.entries(n)) {
      if (key === 'loc' || key.endsWith('Comments')) continue;
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value.type === 'string') visit(value);
    }
  };
  visit(ast.program);
}

const markerOf = unit => unit.kind === 'sentence' ? 'data-i18n' : unit.kind === 'attribute' ? `data-i18n-${unit.name}` : null;

/**
 * Mark a page's translatable text with data-i18n attributes (and /* i18n:token *\/
 * comments in scripts), adding new messages to the catalog. An element already
 * marked keeps its token, and the page's English replaces the catalog's.
 */
export function extractHtml(html, { existing, locale = 'en', namespace = '', filename = 'index.html' } = {}) {
  const catalog = existing ? structuredClone(existing) : { title: 'Site', source: locale, syntax: 'icu', languages: { [locale]: languageName(locale) }, messages: [] };
  const byKey = new Map(catalog.messages.map(m => [m.key, m]));
  const byText = new Map(catalog.messages.map(m => [m.translations[locale], m]));
  const { found, diagnostics } = units(html);
  const edits = [];
  let marked = 0, updated = 0;
  for (const unit of found) {
    const marker = markerOf(unit);
    const given = unit.kind === 'script' ? unit.explicit : attr(unit.node, marker);
    const short = given?.startsWith(namespace) ? given.slice(namespace.length) : given;
    let message = short ? byKey.get(short) : byText.get(unit.text);
    if (message && short && message.translations[locale] !== unit.text) {
      // The page is where the English is written: take its text.
      if (byText.get(message.translations[locale]) === message) byText.delete(message.translations[locale]);
      message.translations[locale] = unit.text; byText.set(unit.text, message); updated++;
    }
    if (!message) {
      const key = short || tokenFor(unit.text, byKey);
      message = { key, context: unit.context, optional: [], translations: { [locale]: unit.text } };
      catalog.messages.push(message); byKey.set(key, message); byText.set(unit.text, message);
    }
    if (given) continue;
    const token = namespace + message.key;
    marked++;
    if (unit.kind === 'script') edits.push({ start: unit.commentStart, end: unit.commentEnd, text: `/* i18n:${token} */` });
    else {
      const tag = unit.node.sourceCodeLocation.startTag;
      const close = html[tag.endOffset - 2] === '/' ? tag.endOffset - 2 : tag.endOffset - 1;
      edits.push({ start: close, end: close, text: ` ${marker}="${token}"` });
    }
  }
  let source = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return { source, catalog, diagnostics: diagnostics.map(d => `${filename}:${d.replace(/^line /, '')}`), replacements: marked, updated };
}

const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
const escapeAttribute = text => escapeHtml(text).replace(/"/g, '&quot;');
// The text of a message without markup, for attributes and scripts.
const plain = nodes => nodes.map(n => typeof n === 'string' ? n : n.type === 'tag' ? plain(n.children) : `{${n.name}}`).join('');

/**
 * One page in one language. messages maps tokens to this language's message
 * text (missing ones keep the page's English). pages lists every language's URL
 * for this page, for hreflang links and the language switcher. relative: the
 * path from this copy's directory to the original's ("../" for a page moved into
 * haw/), put before the page's relative links. absolute: pages' URLs are full
 * URLs, so og:url and canonical links can name this copy.
 */
export function renderHtml(html, { language, source, messages = {}, pages = {}, languages = {}, relative = '', absolute = false } = {}) {
  // Two passes, since a sentence's content holds tags whose attributes change too:
  // first every tag and attribute edit, then each sentence rebuilt from those tags.
  const first = renderAttributes(html, { language, source, messages, pages, languages, relative, absolute });
  return renderSentences(first, { language, source, messages });
}

function translationFor(language, source, messages, token) {
  if (language === source || !token || !Object.hasOwn(messages, token)) return null;
  try { return parseMessage(messages[token]); } catch { return null; }
}

function applyEdits(html, edits) {
  // From the end; insertions at one spot keep their order.
  let out = html;
  edits.map((edit, index) => ({ ...edit, index })).sort((a, b) => b.start - a.start || b.end - a.end || b.index - a.index)
    .forEach(edit => { out = out.slice(0, edit.start) + edit.text + out.slice(edit.end); });
  return out;
}

function attributeRemover(html, edits) {
  return (node, name) => {
    const loc = node.sourceCodeLocation.attrs?.[name];
    if (!loc) return;
    let start = loc.startOffset;
    while (start > 0 && /\s/.test(html[start - 1])) start--;
    edits.push({ start, end: loc.endOffset, text: '' });
  };
}

function renderSentences(html, { language, source, messages }) {
  const { found } = units(html);
  const edits = [], removeAttribute = attributeRemover(html, edits);
  for (const unit of found) {
    if (unit.kind !== 'sentence') continue;
    const token = attr(unit.node, 'data-i18n');
    if (token === undefined) continue;
    removeAttribute(unit.node, 'data-i18n');
    const nodes = translationFor(language, source, messages, token);
    if (!nodes) continue;
    const outer = node => html.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset);
    const inner = node => html.slice(node.sourceCodeLocation.startTag.endOffset, node.sourceCodeLocation.endTag?.startOffset ?? node.sourceCodeLocation.startTag.endOffset);
    const write = list => list.map(n => {
      if (typeof n === 'string') return escapeHtml(n);
      if (n.type !== 'tag') return escapeHtml(`{${n.name}}`);
      const element = unit.tags.get(n.name);
      if (!element) return write(n.children);
      const loc = element.sourceCodeLocation;
      // translate="no" content stays as written.
      return html.slice(loc.startOffset, loc.startTag.endOffset) + (noTranslate(element) ? inner(element) : write(n.children)) + (loc.endTag ? html.slice(loc.endTag.startOffset, loc.endTag.endOffset) : '');
    }).join('');
    // The sentence's own spacing at its edges, such as the space after a leading icon.
    const body = unit.body.map(outer).join('');
    const [, before, after] = /^([ \t\n\r\f]*)[\s\S]*?([ \t\n\r\f]*)$/.exec(body);
    const loc = unit.node.sourceCodeLocation;
    edits.push({ start: loc.startTag.endOffset, end: loc.endTag.startOffset, text: unit.lead.map(outer).join('') + before + write(nodes) + after + unit.trail.map(outer).join('') });
  }
  return applyEdits(html, edits);
}

function renderAttributes(html, { language, source, messages, pages, languages, relative, absolute }) {
  const { document, found } = units(html);
  const edits = [];
  const replace = (start, end, text) => edits.push({ start, end, text });
  const removeAttribute = attributeRemover(html, edits);
  for (const unit of found) {
    if (unit.kind === 'sentence') continue;
    const marker = markerOf(unit);
    const token = unit.kind === 'script' ? unit.explicit : attr(unit.node, marker);
    const nodes = translationFor(language, source, messages, token);
    if (unit.kind === 'script') { if (nodes) replace(unit.start, unit.end, JSON.stringify(plain(nodes))); continue; }
    if (token) removeAttribute(unit.node, marker);
    if (nodes) { const loc = unit.node.sourceCodeLocation.attrs[unit.name]; replace(loc.startOffset, loc.endOffset, `${unit.name}="${escapeAttribute(plain(nodes))}"`); }
  }
  const root = document.childNodes.find(n => n.tagName === 'html');
  const head = root?.childNodes.find(n => n.tagName === 'head');
  const all = function* (node) { yield node; for (const child of node.childNodes || []) yield* all(child); };
  let direction = 'ltr';
  try { direction = new Intl.Locale(language).getTextInfo?.().direction || new Intl.Locale(language).textInfo?.direction || 'ltr'; } catch { /* custom languages */ }
  if (root?.sourceCodeLocation?.startTag) {
    const tag = root.sourceCodeLocation.startTag;
    for (const name of ['lang', 'dir']) removeAttribute(root, name);
    replace(tag.endOffset - 1, tag.endOffset - 1, ` lang="${language}"${direction === 'rtl' ? ' dir="rtl"' : ''}`);
  }
  for (const node of all(document)) {
    if (!isElement(node) || !node.sourceCodeLocation) continue;
    // Pages in a language directory sit deeper: relative links go up to the same files.
    if (relative) for (const name of URL_ATTRIBUTES) {
      const value = attr(node, name);
      if (value === undefined || node.sourceCodeLocation.attrs?.[name] === undefined) continue;
      const fix = part => {
        if (!part || /^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(part)) return part;
        const [, file, rest] = /^([^?#]*)(.*)$/.exec(part);
        return posix.normalize(relative + file) + rest;
      };
      const next = name === 'srcset' ? value.split(',').map(s => s.trim().replace(/^\S+/, fix)).join(', ') : fix(value);
      if (next !== value) { const loc = node.sourceCodeLocation.attrs[name]; replace(loc.startOffset, loc.endOffset, `${name}="${escapeAttribute(next)}"`); }
    }
    // Links that name this page's own address point at this language's copy.
    if (absolute && ((node.tagName === 'meta' && attr(node, 'property') === 'og:url') || (node.tagName === 'link' && attr(node, 'rel') === 'canonical'))) {
      const name = node.tagName === 'meta' ? 'content' : 'href';
      const loc = node.sourceCodeLocation.attrs[name];
      if (loc) replace(loc.startOffset, loc.endOffset, `${name}="${escapeAttribute(pages[language])}"`);
    }
    if (attr(node, 'data-i18n-languages') !== undefined) {
      removeAttribute(node, 'data-i18n-languages');
      const loc = node.sourceCodeLocation;
      const links = Object.keys(pages).map(code => `<a href="${escapeAttribute(pages[code])}" hreflang="${code}" lang="${code}"${code === language ? ' aria-current="page"' : ''}>${escapeHtml(languages[code] || code)}</a>`).join(' ');
      if (loc.endTag) replace(loc.startTag.endOffset, loc.endTag.startOffset, links);
    }
  }
  if (head?.sourceCodeLocation?.endTag && Object.keys(pages).length > 1) {
    const alternates = Object.keys(pages).map(code => `<link rel="alternate" hreflang="${code}" href="${escapeAttribute(pages[code])}">`);
    alternates.push(`<link rel="alternate" hreflang="x-default" href="${escapeAttribute(pages[source])}">`);
    replace(head.sourceCodeLocation.endTag.startOffset, head.sourceCodeLocation.endTag.startOffset, alternates.join('\n') + '\n');
  }
  return applyEdits(html, edits);
}
