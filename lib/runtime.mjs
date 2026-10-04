/** Intl.NumberFormat options for a {n, number, style} style. */
export function numberOptions(style = '') {
  return style === 'integer' ? { maximumFractionDigits: 0 } : style === 'percent' ? { style: 'percent' } : style.startsWith('::currency/') ? { style: 'currency', currency: style.slice(11) } : {};
}

/**
 * Format a compiled catalog using the host's Intl implementation.
 * Messages without tags return strings. Messages with rich-text tags call the
 * matching function with the tag's rendered chunks and return an array, which
 * frameworks such as React render directly.
 * onError receives problems such as an unknown token or a missing value. By
 * default they are logged and the message degrades instead of crashing the UI;
 * pass `error => { throw error; }` to fail fast in tests.
 * formatters supplies the project's own argument types: { length: (value,
 * language) => string } formats {len, length}. It is read on each call, so
 * formatters may be added to the object later.
 */
export function createI18n(catalog, { onError = error => console.error(`i18nmd: ${error.message}`), formatters = {} } = {}) {
  function value(values, name) {
    if (!Object.hasOwn(values, name)) { onError(new Error(`Missing value for {${name}}.`)); return undefined; }
    return values[name];
  }
  function render(nodes, locale, values, pound) {
    const parts = [];
    const push = part => { if (typeof part === 'string' && typeof parts.at(-1) === 'string') parts[parts.length - 1] += part; else if (part !== '') parts.push(part); };
    const pushAll = rendered => Array.isArray(rendered) ? rendered.forEach(push) : push(rendered);
    for (const n of nodes) {
      if (typeof n === 'string') { push(n); continue; }
      if (n.type === 'pound') { push(new Intl.NumberFormat(locale).format(pound)); continue; }
      if (n.type === 'tag') {
        const children = render(n.children, locale, values, pound);
        const fn = value(values, n.name);
        if (typeof fn !== 'function') { if (fn !== undefined) onError(new Error(`<${n.name}> needs a function.`)); pushAll(children); continue; }
        push(fn(Array.isArray(children) ? children : [children]));
        continue;
      }
      if (!Object.hasOwn(values, n.name)) { value(values, n.name); push(`{${n.name}}`); continue; }
      const v = values[n.name];
      // Like JSX, a plain placeholder renders null or undefined as nothing, and an
      // element (a React node, an array of them) stays an element.
      if (n.type === 'argument') { push(v == null ? '' : typeof v === 'object' && !(v instanceof Date) ? v : String(v)); continue; }
      if (v == null) { onError(new Error(`Missing value for {${n.name}}.`)); push(`{${n.name}}`); continue; }
      if (['number', 'plural', 'selectordinal'].includes(n.type) && (typeof v !== 'number' || !Number.isFinite(v))) { onError(new Error(`{${n.name}} must be a finite number.`)); push(String(v)); continue; }
      if (n.type === 'number') {
        push(new Intl.NumberFormat(locale, numberOptions(n.style)).format(v)); continue;
      }
      if (n.type === 'format') {
        const format = Object.hasOwn(formatters, n.format) ? formatters[n.format] : undefined;
        if (typeof format !== 'function') { onError(new Error(`No formatter for {${n.name}, ${n.format}}.`)); push(String(v)); continue; }
        try { push(String(format(v, locale))); } catch (error) { onError(error); push(String(v)); }
        continue;
      }
      if (n.type === 'date' || n.type === 'time') {
        const date = v instanceof Date ? v : typeof v === 'number' ? new Date(v) : null;
        if (!date || Number.isNaN(date.getTime())) { onError(new Error(`{${n.name}} must be a Date or a timestamp.`)); push(String(v)); continue; }
        push(new Intl.DateTimeFormat(locale, { [n.type + 'Style']: n.style || 'medium' }).format(date)); continue;
      }
      if (n.type === 'list') {
        if (!Array.isArray(v)) { onError(new Error(`{${n.name}} must be a list.`)); push(String(v)); continue; }
        const items = v.map(item => typeof item === 'object' && item !== null ? item : String(item));
        // Elements keep their place: format stand-ins, then put each item back.
        let k = 0;
        for (const part of new Intl.ListFormat(locale, { type: n.style }).formatToParts(items.map(item => typeof item === 'string' ? item : '\uE000'))) push(part.type === 'element' ? items[k++] : part.value);
        continue;
      }
      if (n.type === 'select') { pushAll(render(Object.hasOwn(n.options, String(v)) ? n.options[String(v)] : n.options.other, locale, values, pound)); continue; }
      const adjusted = v - n.offset;
      const category = new Intl.PluralRules(locale, { type: n.type === 'selectordinal' ? 'ordinal' : 'cardinal' }).select(adjusted);
      pushAll(render(n.options['=' + v] || n.options[category] || n.options.other, locale, values, adjusted));
    }
    return parts.length === 0 ? '' : parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
  }
  function i18nmd(token, language = catalog.source, values = {}) {
    if (!Object.hasOwn(catalog.messages, token)) { onError(new Error(`Unknown translation token: ${token}`)); return token; }
    let requested = language;
    try { requested = Intl.getCanonicalLocales(language)[0]; } catch { /* Custom language names use source formatting. */ }
    const entry = catalog.messages[token];
    const base = requested.split('-')[0];
    const languageUsed = Object.hasOwn(entry, requested) ? requested : Object.hasOwn(entry, base) ? base : catalog.source;
    // Fallback content is formatted with its actual language's plural rules.
    let formattingLocale = languageUsed;
    try { Intl.getCanonicalLocales(formattingLocale); } catch { formattingLocale = catalog.source; }
    try { Intl.getCanonicalLocales(formattingLocale); } catch { formattingLocale = 'en'; }
    return render(entry[languageUsed], formattingLocale, values || {});
  }
  /** Whether the catalog has token, for text written after the last compile. */
  i18nmd.has = token => Object.hasOwn(catalog.messages, token);
  return i18nmd;
}

/** The catalog language that best matches a requested one: exact, then base language. */
export function matchLanguage(catalog, requested) {
  if (!requested) return undefined;
  let canonical = requested;
  try { canonical = Intl.getCanonicalLocales(requested)[0]; } catch { /* custom identifiers */ }
  if (Object.hasOwn(catalog.languages, canonical)) return canonical;
  const base = canonical.split('-')[0];
  return Object.keys(catalog.languages).find(l => l === base || l.split('-')[0] === base);
}

/**
 * The current language and the messages loaded so far, shared by everything that
 * translates. Source-language messages arrive with each division's module
 * (store.add); another language arrives whole from load(language) before
 * setLanguage switches to it, so a page never mixes languages mid-render.
 * The language starts as the reader's remembered choice, then the browser's best
 * match, then the source; in a browser the choice is remembered under
 * options.storageKey ("i18nmd:language"; null to not remember). divisions lists
 * the division names, for clearer errors.
 */
export function createLanguage(languages, source, { load, divisions = [], storageKey = 'i18nmd:language', onError = e => console.error(`i18nmd: ${e.message}`) } = {}) {
  const store = { source, languages, messages: Object.create(null), divisions, loaded: new Set([source]) };
  store.add = (table, language = source) => {
    for (const [token, nodes] of Object.entries(table)) (store.messages[token] ||= Object.create(null))[language] = nodes;
  };
  const fetchLanguage = language => {
    if (store.loaded.has(language)) return Promise.resolve();
    if (!load) return Promise.reject(new Error(`No loader for ${language}.`));
    return Promise.resolve(load(language)).then(table => { store.add(table, language); store.loaded.add(language); });
  };
  const catalog = { languages };
  const browser = typeof document !== 'undefined' && typeof navigator !== 'undefined';
  const storage = (action, value) => {
    if (!browser || !storageKey) return null;
    try { return action === 'get' ? localStorage.getItem(storageKey) : localStorage.setItem(storageKey, value); } catch { return null; }
  };
  // Only a browser's languages say what the reader wants; Node also has a navigator,
  // whose language is the server's.
  const preferred = browser ? [storage('get'), ...(navigator.languages || [navigator.language])] : [];
  const wanted = preferred.map(l => matchLanguage(catalog, l)).find(Boolean) || source;
  let current = source;
  const listeners = new Set();
  const switchTo = next => {
    if (next === current) return;
    current = next;
    if (browser) document.documentElement.lang = next;
    for (const listener of listeners) listener(next);
  };
  if (browser) document.documentElement.lang = source;
  // Until the reader's language has loaded, pages render in the source language.
  const ready = fetchLanguage(wanted).then(() => { switchTo(wanted); return current; }, error => { onError(error); return current; });
  return {
    store,
    ready,
    getLanguage: () => current,
    /** Load a language's messages, for i18nmd.in(language) on a server or in tests. */
    loadLanguage: language => fetchLanguage(matchLanguage(catalog, language) || source),
    /** Load a language, switch every later call to it and remember it; resolves to the language chosen. */
    async setLanguage(language) {
      const next = matchLanguage(catalog, language);
      if (!next) { onError(new Error(`Unknown language: ${language}`)); return current; }
      try { await fetchLanguage(next); } catch (error) { onError(error); return current; }
      storage('set', next);
      switchTo(next);
      return current;
    },
    /** Call listener with the new language after each change; returns an unsubscribe function. */
    onLanguageChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/**
 * The generated i18nmd function over a language's store. Divisions are
 * properties: i18nmd.support("contact_us") is the token support.contact_us.
 * i18nmd.in("fr") translates into a given (loaded) language instead, for
 * servers, emails and tests. i18nmd.has(token) (or i18nmd.support.has("contact_us"))
 * says whether a token is among the messages loaded. divisions maps each property to [segment, children].
 */
export function createTranslator(language, divisions = {}, options = {}) {
  const { store } = language;
  const onError = options.onError || (error => console.error(`i18nmd: ${error.message}`));
  const translate = createI18n(store, { ...options, onError: error => {
    // A token from a division whose module this code never imported.
    const token = /^Unknown translation token: (.+)$/.exec(error.message)?.[1];
    const division = token && store.divisions.filter(d => token.startsWith(d.replace(/\//g, '.') + '.')).sort((a, b) => b.length - a.length)[0];
    onError(division ? new Error(`${token} is in the ${division} division, which this page has not imported. Import i18nmd from its module (i18nmd check --in <src> --fix adds it).`) : error);
  } });
  const build = (prefix, tree, fixed) => {
    const scoped = (token, values) => translate(prefix + token, fixed ?? language.getLanguage(), values);
    Object.defineProperty(scoped, 'has', { value: token => translate.has(prefix + token) });
    for (const [property, [segment, children]] of Object.entries(tree)) {
      Object.defineProperty(scoped, property, { value: build(`${prefix}${segment}.`, children, fixed), enumerable: true });
    }
    return scoped;
  };
  const i18nmd = build('', divisions);
  Object.defineProperty(i18nmd, 'in', { value: fixed => build('', divisions, fixed), enumerable: false });
  return i18nmd;
}
