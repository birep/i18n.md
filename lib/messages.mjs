// The compiler parses a documented ICU subset. No parsing happens in the app.
// formatters names the argument types the project declares ({len, length}),
// which the application formats itself.
export function parseMessage(text, syntax = 'icu', formatters = []) {
  if (typeof text !== 'string') throw new Error('Messages must be strings.');
  if (syntax === 'python') {
    const nodes = [];
    let literal = '';
    const flush = () => { if (literal) nodes.push(literal); literal = ''; };
    for (let i = 0; i < text.length;) {
      if (text.slice(i, i + 2) === '{{' || text.slice(i, i + 2) === '}}') {
        literal += text[i]; i += 2;
      } else if (text[i] === '{') {
        const end = text.indexOf('}', i);
        const name = text.slice(i + 1, end);
        if (end < 0 || !/^[a-zA-Z_][\w]*$/.test(name)) throw new Error('Python messages support named {placeholders} only.');
        flush(); nodes.push({ type: 'argument', name }); i = end + 1;
      } else if (text[i] === '}') throw new Error('Unmatched closing brace.');
      else literal += text[i++];
    }
    flush(); return nodes;
  }
  if (syntax !== 'icu') throw new Error(`Unknown message syntax: ${syntax}`);
  let pos = 0;
  const fail = message => { throw new Error(`${message} (character ${pos + 1})`); };
  const space = () => { while (/\s/.test(text[pos] || '') && pos < text.length) pos++; };
  const word = () => { const start = pos; while (/[\w.-]/.test(text[pos] || '') && pos < text.length) pos++; return text.slice(start, pos); };
  const expect = char => { space(); if (text[pos++] !== char) fail(`Expected ${char}`); };
  function sequence(nested = false, plural = false, depth = 0, closing) {
    if (depth > 40) fail('Message nesting is too deep');
    const nodes = [];
    let literal = '';
    const flush = () => { if (literal) nodes.push(literal); literal = ''; };
    while (pos < text.length) {
      const c = text[pos];
      if (c === '}') { if (!nested) fail('Unmatched closing brace'); break; }
      // Rich-text tags: <b>chunks</b>. A closing tag ends the enclosing sequence.
      if (c === '<' && syntax === 'icu') {
        const close = /^<\/([a-zA-Z][\w-]*)>/.exec(text.slice(pos));
        if (close) { if (closing !== close[1]) fail(`Unexpected </${close[1]}>`); break; }
        const open = /^<([a-zA-Z][\w-]*)>/.exec(text.slice(pos));
        if (open) {
          if (open[1] === '__proto__') fail('Invalid tag name');
          flush(); pos += open[0].length;
          const children = sequence(nested, plural, depth + 1, open[1]);
          if (text.slice(pos, pos + open[1].length + 3) !== `</${open[1]}>`) fail(`Unclosed <${open[1]}>`);
          pos += open[1].length + 3;
          nodes.push({ type: 'tag', name: open[1], children });
          continue;
        }
      }
      if (c === "'") {
        if (text[pos + 1] === "'") { literal += "'"; pos += 2; continue; }
        if (['{', '}', '<', ...(plural ? ['#'] : [])].includes(text[pos + 1])) {
          pos++;
          while (pos < text.length) {
            if (text[pos] === "'") {
              if (text[pos + 1] === "'") { literal += "'"; pos += 2; }
              else { pos++; break; }
            } else literal += text[pos++];
          }
          continue;
        }
      }
      if (c === '#' && plural) { flush(); nodes.push({ type: 'pound' }); pos++; continue; }
      if (c !== '{') { literal += c; pos++; continue; }
      flush(); pos++; space();
      const name = word();
      if (!/^[a-zA-Z_]\w*$/.test(name) || name === '__proto__') fail('Expected a named placeholder');
      space();
      if (text[pos] === '}') { pos++; nodes.push({ type: 'argument', name }); continue; }
      expect(','); space(); const type = word(); space();
      if (['plural', 'selectordinal', 'select'].includes(type)) {
        expect(','); space();
        let offset = 0;
        if (type !== 'select' && text.slice(pos, pos + 7) === 'offset:') {
          pos += 7; space(); const n = /^\d+/.exec(text.slice(pos));
          if (!n) fail('Expected a nonnegative plural offset');
          offset = Number(n[0]); pos += n[0].length; space();
        }
        const options = Object.create(null);
        while (pos < text.length && text[pos] !== '}') {
          let selector;
          if (text[pos] === '=' && type !== 'select') {
            pos++; const n = /^-?\d+(?:\.\d+)?/.exec(text.slice(pos));
            if (!n) fail('Expected a numeric plural selector');
            selector = '=' + Number(n[0]); pos += n[0].length;
          } else selector = word();
          if (!selector || selector === '__proto__') fail('Expected a branch name');
          if (type !== 'select' && !selector.startsWith('=') && !['zero', 'one', 'two', 'few', 'many', 'other'].includes(selector)) fail(`Unknown plural category ${selector}`);
          if (Object.hasOwn(options, selector)) fail(`Duplicate branch ${selector}`);
          expect('{'); options[selector] = sequence(true, type !== 'select' || plural, depth + 1); expect('}'); space();
        }
        if (!Object.hasOwn(options, 'other')) fail(`${type} needs an other branch`);
        expect('}'); nodes.push({ type, name, offset, options });
      } else if (type === 'list') {
        // {items, list} joins a list the way the language does: "A, B and C".
        let style = 'conjunction';
        if (text[pos] === ',') { pos++; space(); style = word(); space(); }
        if (!['conjunction', 'disjunction', 'unit'].includes(style)) fail(`Unsupported list style ${style}; use conjunction, disjunction or unit`);
        expect('}'); nodes.push({ type, name, style });
      } else if (['number', 'date', 'time'].includes(type)) {
        let style = '';
        if (text[pos] === ',') {
          pos++; const start = pos; while (pos < text.length && text[pos] !== '}') pos++;
          style = text.slice(start, pos).trim();
        }
        if (type === 'number' && !['', 'integer', 'percent'].includes(style) && !/^::currency\/[A-Z]{3}$/.test(style)) fail(`Unsupported number style ${style}`);
        if (type !== 'number' && !['', 'short', 'medium', 'long', 'full'].includes(style)) fail(`Unsupported ${type} style ${style}`);
        expect('}'); nodes.push({ type, name, style });
      } else if (formatters.includes(type)) {
        expect('}'); nodes.push({ type: 'format', name, format: type });
      } else fail(`Unsupported message type ${type}${/^[a-zA-Z_]\w*$/.test(type) ? ` (declare app formatters in i18nmd.lock.json: "formatters": ["${type}"])` : ''}`);
    }
    flush(); return nodes;
  }
  return sequence();
}

export function argumentsFor(nodes, out = Object.create(null)) {
  for (const n of nodes) {
    if (typeof n === 'string' || n.type === 'pound') continue;
    if (n.type === 'tag') {
      if (out[n.name] && out[n.name] !== 'tag') throw new Error(`<${n.name}> is also used as a placeholder.`);
      out[n.name] = 'tag'; argumentsFor(n.children, out); continue;
    }
    if (out[n.name] === 'tag') throw new Error(`{${n.name}} is also used as a tag.`);
    const type = n.type === 'format' ? `format:${n.format}` : ['number', 'plural', 'selectordinal'].includes(n.type) ? 'number' : ['date', 'time'].includes(n.type) ? 'date' : ['select', 'list'].includes(n.type) ? n.type : 'string';
    const previous = out[n.name];
    // A formatted value may also choose a plural branch: {len, length} … {len, plural, …}.
    const formatted = previous?.startsWith('format:') && type === 'number';
    if (!formatted && previous && previous !== type && previous !== 'string' && type !== 'string' && !(previous === 'number' && type.startsWith('format:'))) throw new Error(`Conflicting types for {${n.name}}.`);
    if (!formatted && (!previous || type !== 'string')) out[n.name] = type;
    if (n.options) for (const branch of Object.values(n.options)) argumentsFor(branch, out);
  }
  return out;
}

// A lone apostrophe is literal (ICU 4.8+), so "isn't" stays readable; only one
// that would start a quote, before a quoted character or another apostrophe, is doubled.
export function escapeMessageLiteral(text) {
  return text.replace(/'(?=['{}#<|])|[{}]|<(?=\/?[a-zA-Z])/g, match => match === "'" ? "''" : `'${match}'`);
}

// Addresses read the same in every language: domains, emails and URLs.
export const isAddress = text => /^(?:[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?)$/i.test(text.trim());
