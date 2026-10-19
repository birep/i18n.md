// Rich text stored as spans, the shape most editors save: [{ text, bold: true },
// { text, link: "https://…" }]. Every property of a span other than text with a
// value is a mark. A sentence of spans becomes one ICU message whose marks are
// tags, so a translator can reorder them; the mark values (link targets) stay
// out of the message and come back from the source spans.
import { escapeMessageLiteral, parseMessage } from './messages.mjs';

const marksOf = span => Object.entries(span).filter(([key, value]) => key !== 'text' && value !== undefined && value !== null && value !== false);
const identity = (key, value) => `${key}\u0000${JSON.stringify(value)}`;
const sameMarks = (a, b) => JSON.stringify(marksOf(a).sort()) === JSON.stringify(marksOf(b).sort());

function tagName(key, used) {
  let base = key.replace(/[^\w-]/g, '_');
  if (!/^[a-zA-Z]/.test(base)) base = `m${base}`;
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
  used.add(name);
  return name;
}

/**
 * Spans as one ICU message. Returns { message, tags }: tags maps each tag name
 * to the marks it stands for ({ a: { link: "https://…" } }), which
 * messageToSpans needs to rebuild spans from a translation.
 */
export function spansToMessage(spans) {
  if (!Array.isArray(spans)) throw new Error('Spans must be an array.');
  const names = new Map(), used = new Set(), tags = {};
  const list = spans.map((span, i) => {
    if (!span || typeof span !== 'object' || typeof span.text !== 'string') throw new Error(`Span ${i + 1} needs a text string.`);
    const marks = marksOf(span).map(([key, value]) => {
      const id = identity(key, value);
      if (!names.has(id)) { const name = tagName(key, used); names.set(id, name); tags[name] = { [key]: value }; }
      return names.get(id);
    });
    return { text: span.text, marks };
  }).filter(span => span.text);
  // How many spans from i on carry a mark; longer runs open first, so they
  // enclose shorter ones and tags close in order.
  const run = (i, name) => { let n = 0; while (i + n < list.length && list[i + n].marks.includes(name)) n++; return n; };
  let message = '';
  const open = [];
  list.forEach((span, i) => {
    const keep = open.findIndex(name => !span.marks.includes(name));
    if (keep >= 0) for (const name of open.splice(keep).reverse()) message += `</${name}>`;
    for (const name of span.marks.filter(name => !open.includes(name)).sort((a, b) => run(i, b) - run(i, a))) { message += `<${name}>`; open.push(name); }
    message += escapeMessageLiteral(span.text);
  });
  for (const name of open.reverse()) message += `</${name}>`;
  return { message, tags };
}

/** A message from spansToMessage, or its translation, back as spans. */
export function messageToSpans(message, tags = {}) {
  const spans = [];
  const walk = (nodes, marks) => {
    for (const node of nodes) {
      if (typeof node === 'string') {
        const last = spans.at(-1);
        if (last && sameMarks(last, marks)) last.text += node;
        else spans.push({ text: node, ...marks });
      } else if (node.type === 'tag') {
        if (!Object.hasOwn(tags, node.name)) throw new Error(`Unknown tag <${node.name}>.`);
        walk(node.children, { ...marks, ...tags[node.name] });
      } else throw new Error(`Span text has no placeholders; found {${node.name ?? '#'}}.`);
    }
  };
  walk(parseMessage(message), {});
  return spans;
}
