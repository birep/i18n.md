# i18n.md

[English](README.md) · **ʻŌlelo Hawaiʻi**

**[E hoʻāʻo i ka hōʻike ola ma i18n.md](https://i18n.md)** · Hana ʻia e **[Liko Labs](https://likolabs.com)** ma Hilo, Hawaiʻi

E mālama i nā kikokikona o kāu polokalamu (app) a me kāu kahua pūnaewele ma Markdown: hoʻokahi waihona no kēlā me kēia ʻōlelo, i hiki i nā mea unuhi, nā mea nānā, a me nā LLM ke heluhelu a hoʻoponopono pololei. Nānā ka polokalamu hōʻuluʻulu (compiler) i nā ʻōlelo a pau, a hana i ke code i hoʻopaʻa ʻia nā ʻano (typed code) e hoʻohana ʻia e kāu polokalamu.

Ua hana ʻo [Liko Labs](https://likolabs.com) iā i18nmd a hāʻawi manuahi aku me ka manaʻolana e maʻalahi ka hoʻolako ʻana i ka ʻōlelo Hawaiʻi no kēlā me kēia ʻoihana a me nā hui kaiāulu ma Hawaiʻi. ʻEkolu wale nō kauoha no ke kahua pūnaewele ma ka ʻōlelo Pelekānia a me ka ʻōlelo Hawaiʻi, ʻo `extract`, `--add haw` a me `render` (e nānā i [Nā kahua pūnaewele HTML](#nā-kahua-pūnaewele-html)), a noho kēlā me kēia māmalaʻōlelo Hawaiʻi i loko o kekahi waihona maʻalahi e hiki ai i ka mea mākaukau ke nānā a hoʻoponopono. No ke kōkua i ka lawe ʻana mai i ka ʻōlelo Hawaiʻi i kāu kahua pūnaewele a i ʻole polokalamu, e kelepona aku iā [Liko Labs](https://likolabs.com).

````md
# Français

## cart_items

Context: Item count in the cart header.

```icu
{count, plural, one {# article} other {# articles}}
```
````

```tsx
<p>{i18nmd('cart_items', { count })}</p>
```

ʻO nā waihona ke kumu o ka ʻoiaʻiʻo. ʻIke ʻia nā loli i loko o nā pull request, a hiki i kekahi ke hāʻawi i kekahi waihona i ke kanaka a i ʻole ka LLM e unuhi. ʻO nā mea a pau a i18nmd e hana ai, he loli ia i ia mau waihona, a i ʻole he code i hana ʻia mai ia mau waihona.

- [Hoʻokomo](#hoʻokomo)
- [Hoʻomaka wikiwiki](#hoʻomaka-wikiwiki)
- [Nā kahua pūnaewele HTML](#nā-kahua-pūnaewele-html)
- [Nā waihona ʻōlelo](#nā-waihona-ʻōlelo)
- [Nā māhele](#nā-māhele)
- [Ka hoʻohana ʻana i ke code i hana ʻia](#ka-hoʻohana-ʻana-i-ke-code-i-hana-ʻia)
- [Ka huki ʻana i nā kikokikona mai kāu code](#ka-huki-ʻana-i-nā-kikokikona-mai-kāu-code)
- [Ka unuhi ʻana me ka LLM](#ka-unuhi-ʻana-me-ka-llm)
- [Ka mālama ʻana i nā unuhina i ke au](#ka-mālama-ʻana-i-nā-unuhina-i-ke-au)
- [Python](#python)
- [Nā ʻano waihona ʻē aʻe](#nā-ʻano-waihona-ʻē-aʻe)
- [Nā kauoha](#nā-kauoha)
- [Nā palena o kēia manawa](#nā-palena-o-kēia-manawa)

## Hoʻokomo

Pono ʻo i18nmd iā Node.js 22 a i ʻole ka mana hou aku.

```sh
npm install --save-dev @likolabs/i18nmd
npx i18nmd --version
```

## Hoʻomaka wikiwiki

**1. E huki i nā kikokikona** mai kekahi polokalamu React a i ʻole JSX/TSX. Me `--in-place`, kākau hou ʻo i18nmd i kāu mau waihona code, no laila e commit mua a nānā i nā loli.

```sh
npx i18nmd extract src --in-place
```

Pae kāu mau kikokikona i `translations/i18n-en.md` (e hoʻohana iā `--source it` inā ma ka ʻōlelo ʻĪkālia kāu polokalamu), a kāhea kāu code i nā unuhina ma kahi o ka kikokikona:

```tsx
// before
<p>Welcome back, {user.name}!</p>
// after
import { i18nmd } from '../i18n/i18n';
<p>{i18nmd('welcome_back', { name: user.name })}</p>
```

Hōʻike ka mea huki (extractor) i nā mea ʻaʻole hiki iā ia ke hoʻololi, e like me ke kikokikona i kūkulu ʻia ma ke code a i ʻole nā helu e pono ai ke ʻano lehulehu (plural). Aʻo ʻo [ka paipai huki](PROMPT.md) (extraction prompt) i kekahi coding agent pehea e hoʻopau ai i ka hana.

**2. E hoʻohui i nā ʻōlelo.** E noi i kekahi LLM ma o ka CLI, a i ʻole e kākau iho i nā waihona iā ʻoe iho:

```sh
export ANTHROPIC_API_KEY=…    # or OPENAI_API_KEY, or I18NMD_* (see below)
npx i18nmd --add french --add german
```

**3. E hōʻuluʻulu (compile)** i `src/i18n`. E hoʻohui iā ia i kāu kūkulu ʻana (build) i hoʻohana kēlā me kēia kūkulu ʻana i nā unuhina hou loa:

```sh
npx i18nmd compile
```

```json
{ "scripts": { "prebuild": "i18nmd compile" } }
```

**4. E ʻae i ka mea heluhelu e koho i ka ʻōlelo.** Unuhi nā kāhea i ka ʻōlelo o kēia manawa, ʻo ia hoʻi ka ʻōlelo o ka polokalamu kele pūnaewele (browser) o ka mea heluhelu ma ka hoʻomaka ʻana:

```tsx
import { useSyncExternalStore } from 'react';
import { languages, getLanguage, setLanguage, onLanguageChange } from './i18n/language.mjs';

export function LanguagePicker() {
  const language = useSyncExternalStore(onLanguageChange, getLanguage);
  return (
    <select value={language} onChange={e => void setLanguage(e.target.value)}>
      {Object.entries(languages).map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
    </select>
  );
}
```

**5. E mālama i ke au.** Ma hope o ka hoʻoponopono ʻana i ke kikokikona kumu, hōʻike ʻo `npx i18nmd status` i nā mea e pono ai ka unuhi, a hoʻopiha ʻo `npx i18nmd translate` iā lākou.

## Nā kahua pūnaewele HTML

ʻAʻole pono ke JavaScript no ke kahua pūnaewele i kūkulu ʻia me nā ʻaoʻao HTML. Kākau ʻo i18nmd i kope o kēlā me kēia ʻaoʻao ma kēlā me kēia ʻōlelo:

```sh
npx i18nmd extract site --in-place                            # site/*.html → translations/i18n-en.md
npx i18nmd --add haw                                          # or write translations/i18n-haw.md yourself
npx i18nmd render site --out dist --url https://example.com   # dist/ and dist/haw/
```

Kau ʻo `extract` i ka hōʻailona `data-i18n` ma kēlā me kēia ʻāpana kikokikona, a waiho i ka ʻōlelo Pelekānia ma kona wahi, no laila wehe a hoʻoponopono ʻia ka ʻaoʻao e like me ma mua:

```html
<h1 data-i18n="from_first_leaf_to_full_grown">From first leaf to <em class="red">full grown.</em></h1>
```

Mālama ka memo i ka māmalaʻōlelo holoʻokoʻa, me kona mau hōʻailona HTML i loko (inline markup) ma ke ʻano he mau tag: `From first leaf to <em>full grown.</em>`. Hoʻoneʻe ka mea unuhi i ka tag; noho kona class a me kona mau ʻano ʻē aʻe (attributes) ma ka ʻaoʻao. Lawe pū ʻo `extract` i ka `<title>` o ka ʻaoʻao, nā hōʻailona `<meta>` no ka wehewehe a me ka hōʻike loulou, nā attribute `alt`, `title`, `placeholder` a me `aria-label`, a me nā kikokikona i loko o nā script i kaha ʻia me `/* i18n */`:

```js
statusEl.textContent = /* i18n */ 'Sending…';
```

Lele ʻo ia ma luna o nā helu wahi (address) e like me `example.com`, a me nā mea a pau i loko o kekahi element me `translate="no"`, ka attribute maʻamau no nā inoa a me ke code. Papa inoa ʻo ia i ke kikokikona ʻaʻole hiki iā ia ke hoʻonoho, e like me nā huaʻōlelo ma ka ʻaoʻao o kekahi element poloka, a me nā kikokikona script e like ana me nā mea e heluhelu ai ke kanaka.

Noho ka ʻōlelo Pelekānia i kāu HTML. E hoʻoponopono i kekahi ʻaoʻao, e holo hou iā `extract`, a hahai ka waihona ʻōlelo kumu; lilo nā mana o ia kikokikona ma nā ʻōlelo ʻē aʻe i **kahiko** (stale), no ka `translate` e hoʻohou ai.

Kākau ʻo `render` i ka ʻōlelo kumu ma kahi o nā ʻaoʻao, a me kēlā me kēia ʻōlelo ʻē aʻe i loko o kekahi waihona i kapa ʻia ma kona inoa, `/haw/`, me ke kope pū ʻana i nā mea ʻē aʻe a pau o ke kahua pūnaewele. Loaʻa i kēlā me kēia kope:

- ke kikokikona i unuhi ʻia, a noho ke kikokikona i unuhi ʻole ʻia ma ka ʻōlelo kumu
- `<html lang>`, a me `dir="rtl"` no nā ʻōlelo i kākau ʻia mai ka ʻākau a i ka hema
- `<link rel="alternate" hreflang>` i ke kope o kēlā me kēia ʻōlelo, i hōʻiliʻili nā mīkini huli i kēlā me kēia
- me `--url`, kuhikuhi nā loulou `og:url` a me canonical i ia kope
- hoʻoponopono ʻia nā loulou pili (relative links) no ka waihona o ka ʻōlelo

E kau iā `<nav data-i18n-languages></nav>` ma kekahi wahi o ka ʻaoʻao, a hoʻopiha ʻo `render` iā ia me ka loulou i kēlā me kēia ʻōlelo, i kapa ʻia ma ia ʻōlelo. E hoʻolaha (deploy) iā `dist/`.

## Nā waihona ʻōlelo

Paʻa ʻo `translations/i18n-fr.md` i ka ʻōlelo Palani wale nō. Hāʻawi ka inoa waihona i ke code ʻōlelo (`fr`, `pt-BR`, a i ʻole kekahi inoa i haku ʻia e like me `pirate`). Kapa ke poʻo inoa mua i ka ʻōlelo ma ia ʻōlelo nō, a he inoa memo (token) kēlā me kēia poʻo inoa `##`:

````md
# Français

## cart_items

Context: Item count in the cart header.

```icu
{count, plural, one {# article} other {# articles}}
```

## greeting

Optional: a

```icu
Bonjour {name} !
```
````

- Wehewehe ʻo **Context** (pōʻaiapili) i kahi e ʻike ʻia ai ka kikokikona a me nā mea e pono ai ka mea unuhi: ke ʻano o ka leo, nā palena o ka lōʻihi, nā mea ʻaʻole e unuhi ʻia.
- Papa inoa ʻo **Optional** i nā hakahaka (placeholders) e hiki ke haʻalele ʻia e ka unuhina, e like me ka ʻatikala Pelekānia (`{a}` no "a" a i ʻole "an") ʻaʻole pono i nā ʻōlelo ʻē aʻe.
- ʻO ka memo he [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/): nā hakahaka me ka inoa `{name}`, `plural`, `selectordinal`, `select`, `number` (`integer`, `percent`, `::currency/EUR`), `date` a me `time` me kekahi ʻano, a me nā tag e like me `<b>…</b>`.
- He ʻokina wale nō ka ʻokina, a pēlā nō ka apostrophe. No ka kākau ʻana i ka kahakaha (brace) maoli, a i ʻole `<` ma mua o kekahi hua palapala, e hoʻopuni iā ia me ka apostrophe: `'{'`, `'<'`.

ʻO ia ke ʻano holoʻokoʻa. Noho ka moʻokāki ma ka ʻaoʻao o nā waihona ma `i18nmd.lock.json`, e hoʻopaʻa ana i ka ʻōlelo kumu a me nā unuhina e kūpono ana i ke au.

Hoʻohana kēlā me kēia waihona ʻōlelo i nā inoa memo a me nā hakahaka like me ke kumu. Nānā ʻo `i18nmd check` iā lākou a pau: hōʻike ʻia ka unuhina me ka hakahaka nalo a i ʻole ʻike ʻole ʻia, ka plural haki, a i ʻole ka tag kūlike ʻole, a hoʻohana ke kūkulu ʻana i ke kikokikona kumu a hoʻoponopono ʻia. ʻAʻole hāʻule ke kūkulu ʻana ma muli o nā unuhina nalo a kahiko paha.

## Nā māhele

Hiki i ka polokalamu nui ke hoʻokaʻawale i kona mau kikokikona i nā māhele, hoʻokahi waihona (directory) no kēlā me kēia, ma ke ʻano e kūpono ai i ka poʻe e hoʻoponopono ana:

```
translations/
  i18nmd.lock.json
  account/i18n-en.md     account/i18n-fr.md
  ui/i18n-en.md          ui/i18n-fr.md
  marketing/i18n-en.md   marketing/i18n-fr.md
  marketing/landing/i18n-en.md
```

He waihona kumu a me nā unuhina ko kēlā me kēia māhele, a hoʻokumu ʻia nā inoa memo ma kona ala. ʻO `## hero` i loko o `marketing/i18n-en.md` ka inoa memo `marketing.hero`:

```tsx
import { i18nmd } from './i18n/marketing';
import './i18n/marketing.landing';
import './i18n/knowledge-hub';

i18nmd.marketing('hero')            // or i18nmd('marketing.hero')
i18nmd.marketing.landing('save')    // marketing/landing/
i18nmd.knowledgeHub('search')       // knowledge-hub/ becomes camelCase
```

Mālama nā waihona i nā inoa pōkole, no laila hiki i nā māhele ʻelua ke loaʻa he `save`. E kapa i nā waihona māhele me nā hua palapala, nā helu, `_` a me `-`; hōʻole ʻia nā inoa i loaʻa i nā function a pau (`name`, `length`, `call`, …) a me `in`.

Hoʻokaʻawale pū nā māhele i kāu pūʻolo (bundle): hōʻuluʻulu ʻia kēlā me kēia i kona module ponoʻī, a hoʻouna kāu bundler iā ia me ke code e hoʻohana ana iā ia. E kau i nā kikokikona e pono ai kēlā me kēia ʻaoʻao, e like me ke komo ʻana (sign-in) a me nā ʻaoʻao hoʻouka, i loko o kekahi māhele liʻiliʻi ponoʻī, i lawe ka hoʻoili mua i kēlā mau mea wale nō.

Pili nā kauoha ma `translations/` i nā māhele a pau, a hōʻike ʻo `status` i ka holomua ma kēlā me kēia māhele. E hāʻawi i ka waihona o kekahi māhele e hana ma luna ona wale nō, e like me `i18nmd translate translations/marketing`. Noho ka lock ma luna a kaʻana like ʻia.

## Ka hoʻohana ʻana i ke code i hana ʻia

```sh
npx i18nmd compile                  # translations/ → src/i18n
npx i18nmd compile --out lib/i18n   # elsewhere
```

### Ke kāhea ʻana i nā unuhina

```tsx
import { i18nmd } from './i18n/i18n';

i18nmd('cart_items', { count: 3 })       // top-level token
i18nmd.ui('save')                        // a division's token
i18nmd.in('fr').ui('save')               // a fixed language
```

Nānā ʻo TypeScript i kēlā me kēia inoa memo a me kona mau waiwai: he hewa compile ka waiwai nalo, ke ʻano hewa, a i ʻole ka inoa memo mai kekahi māhele ʻē. ʻAe pū ka hakahaka maʻamau iā `null` a i ʻole `undefined` a hōʻike ʻole i kekahi mea, e like me JSX.

Lawe mai (import) ke code e kāhea ana i kekahi māhele iā `i18nmd` mai ka module o ia māhele (`./i18n/ui`). Lawe mai pū ka waihona e kāhea ana i ka māhele ʻelua i kona module, `import './i18n/marketing'`. Kākau ʻo `extract` i kēia mau import. Hāʻule ʻo `npx i18nmd check --in src` me ka laina e hoʻohui ai inā nalo kekahi, a hoʻohui ʻo `--fix` iā ia.

Unuhi ʻia nā kikokikona i loko o ke code e holo hoʻokahi wale nō, e like me ka constant ma ka pae module, i ia manawa nō. E hoʻopuni iā lākou i loko o kekahi function i hiki aku ka loli ʻōlelo iā lākou:

```ts
export const steps = () => [i18nmd.ui('measure'), i18nmd.ui('cut')];
```

### Ka ʻōlelo o kēia manawa

Hoʻomaka ka ʻōlelo o kēia manawa me ka koho mua o ka mea heluhelu, a laila nā ʻōlelo o kona polokalamu kele pūnaewele, a laila ka ʻōlelo kumu. Mālama ʻo `language.mjs` iā ia a paʻa ʻole i nā memo, no laila hiki i kāu code komo (entry code) ke lawe mai iā ia me ke kaumaha ʻole:

| Export | Hana |
| --- | --- |
| `languages` | Kēlā me kēia code ʻōlelo a me kona inoa ma ia ʻōlelo, no ka papa koho. |
| `getLanguage()` | Ka ʻōlelo o kēia manawa. |
| `setLanguage(code)` | Hoʻouka i ka ʻōlelo, hoʻololi iā ia a hoʻomanaʻo. ʻAe ʻia ka like kokoke: koho ʻo `pt` iā `pt-BR`. |
| `onLanguageChange(listener)` | Kāhea i ka listener ma hope o kēlā me kēia loli; hoʻihoʻi i ka function e hoʻōki ai. |
| `ready` | Hoʻoholo ʻia ke hoʻouka ʻia ka ʻōlelo o ka mea heluhelu. |
| `loadLanguage(code)` | Hoʻouka i kekahi ʻōlelo no `i18nmd.in(code)`, ma ke kikowaena (server) a i ʻole nā hoʻāʻo. |

He ʻāpana ponoʻī kēlā me kēia unuhina, no laila hoʻoili ka mea heluhelu i kāna ʻōlelo wale nō. E hōʻike ma hope o `ready` i ʻike ka mea heluhelu i koho i ka ʻōlelo Palani i ka ʻōlelo Palani mai ka hōʻike mua loa; no ka ʻōlelo kumu, hoʻoholo koke ʻia:

```tsx
import { ready, getLanguage, onLanguageChange } from './i18n/language.mjs';

function Localized() {
  const language = useSyncExternalStore(onLanguageChange, getLanguage);
  return <App key={language} />;    // re-render everything in the new language
}
ready.then(() => createRoot(root).render(<Localized />));
```

Huli ka ʻimi ʻōlelo i ke code pololei (`fr-CA`), a laila ka ʻōlelo kumu o ia code (`fr`), a laila ka ʻōlelo kumu o ka polokalamu. I loko o ka memo, hoʻi ka unuhina nalo i ke kikokikona kumu.

### Ke kikokikona waiwai (rich text)

Noho nā hōʻailona i loko o ka māmalaʻōlelo, i hiki i nā mea unuhi ke hoʻonohonoho hou iā lākou:

```icu
Read <link>the guide</link> before <b>{date, date, long}</b>.
```

```tsx
i18nmd('read_the_guide', {
  date,
  link: chunks => <a key="link" href="/guide">{chunks}</a>,
  b: chunks => <b key="b">{chunks}</b>,
})
```

Hoʻihoʻi nā memo me nā tag i kekahi array, a hōʻike pololei ʻo React iā ia.

### Nā mea a `compile` e kākau ai

| Waihona | Paʻa |
| --- | --- |
| `i18n.ts` | Nā ʻano (types), `i18nmd`, a me nā inoa memo ma ka pae kiʻekiʻe. |
| `<division>.ts` | Nā memo ʻōlelo kumu o hoʻokahi māhele. |
| `language.mjs` | Ka ʻōlelo o kēia manawa a me nā mea hoʻouka, me ka memo ʻole. |
| `languages/<code>.mjs` | Nā memo a pau ma hoʻokahi ʻōlelo ʻē. |
| `runtime.mjs` | Ka mea hoʻonohonoho (formatter), e hoʻohana ana i ka `Intl` o ka polokalamu kele pūnaewele no nā plural, nā helu a me nā lā. |

E commit iā lākou a i ʻole e hana iā lākou i kāu kūkulu ʻana; holoi ʻo `compile` i nā waihona āna i hana ai ma mua akā ʻaʻole e kākau hou. Kau ʻo `--eager` i nā memo a me nā ʻōlelo a pau i loko o `i18n.ts`, no nā kikowaena, nā hoʻāʻo a me nā polokalamu liʻiliʻi. Kākau ʻo `--target js` i nā waihona like ma JavaScript, kākau ʻo `--target json` i hoʻokahi waihona JSON o ke kikokikona memo, a haʻalele ʻo `--skip <division>` i nā māhele e hoʻohana ʻia e kekahi polokalamu ʻē.

### Nā hewa i ka holo ʻana

ʻAʻole e hāʻule ka ʻaoʻao ma muli o ka inoa memo ʻike ʻole ʻia a i ʻole ka waiwai nalo. Kākau ka runtime iā ia i ka moʻolelo (log) a hōʻike i ka inoa memo a i ʻole `{placeholder}` ma kahi ona. Haʻi ka inoa memo mai kekahi māhele i lawe ʻole ʻia mai e ka ʻaoʻao i ka import e hoʻohui ai.

## Ka huki ʻana i nā kikokikona mai kāu code

```sh
npx i18nmd extract src --in-place                                   # everything → translations/
npx i18nmd extract src/account src/routes.tsx --out translations/account --in-place
```

Heluhelu ʻo `extract` i JavaScript a me TypeScript, me JSX a i ʻole me ka ʻole, a hoʻoneʻe i kēia mau mea i ka waihona ʻōlelo kumu:

- Ke kikokikona JSX, me ka mālama ʻana i kēlā me kēia māmalaʻōlelo holoʻokoʻa. Lilo nā waiwai i loko o ka māmalaʻōlelo i mau hakahaka me ka inoa: lilo ʻo `{formatLength(kerf)}` iā `{kerf}`, a lilo ʻo `{items.length}` iā `{itemsCount}`.
- Nā element i loko o ka laina e like me `<b>`, `<a href>` a me `<Link to>`, e lilo ana i mau tag.
- Nā huaʻōlelo i koho ʻia ma ke code: lilo ʻo `{busy ? "Saving…" : "Save"}` i ʻelua memo.
- Nā attribute i ʻike ʻia: `alt`, `title`, `placeholder`, `label`, `aria-label`, `aria-description`.
- Kēlā me kēia kikokikona i kaha ʻia me `/* i18n */`, a i ʻole `/* i18n:token_name */` e koho ai i kona inoa memo.

Waiho ʻo ia i nā helu, nā hōʻailona a me ke kikokikona hua palapala ʻole, a me nā mea ʻaʻole hiki iā ia ke hoʻololi me ka palekana; papa inoa ʻia kēlā mau mea me ko lākou waihona a me ka laina. Hōʻailona pū ʻo ia i nā helu e pono ai ke ʻano plural a me nā huaʻōlelo i kūkulu ʻia ma ke code e pono ai ke lilo i ICU `select`.

Hele mai nā inoa memo mai nā huaʻōlelo o ka memo, e like me `welcome_back`, a ʻaʻole loli ke hoʻoponopono ʻoe i ke kikokikona. Ke holo hou ʻia ʻo `extract`, mālama ʻia nā inoa memo a me nā unuhina a pau, a hoʻohui ʻia nā kikokikona hou wale nō. Me ka ʻole o `--in-place`, kākau ʻo ia i nā kope i hoʻololi ʻia i `--dest` (ʻo `.i18n/src` ma ka maʻamau) a waiho i kāu mau waihona kumu. Huki ʻo `--out translations/<division>` i loko o kekahi māhele.

Mālama ka mea huki i ka hana mīkini. He paipai ʻo [PROMPT.md](PROMPT.md) no kekahi coding agent e hana i ke koena: nā kikokikona i loko o nā waihona `.ts` maʻamau a me nā object, nā māmalaʻōlelo i kūkulu ʻia ma ke code, a me ka nānā ʻana i kēlā me kēia ʻaoʻao.

## Ka unuhi ʻana me ka LLM

```sh
npx i18nmd --add french               # also: Français, fr, pt-BR, "brazilian portuguese", klingon
npx i18nmd --add pirate               # anything unrecognized becomes a custom style
npx i18nmd --top 10                   # the 10 most widely spoken languages (i18nmd languages lists them)
npx i18nmd translate                  # fill every missing or outdated translation
npx i18nmd translate --only fr,de --dry-run
```

E hoʻonoho i kekahi o kēia:

```sh
export ANTHROPIC_API_KEY=…                        # Claude
export OPENAI_API_KEY=… OPENAI_BASE_URL=…         # OpenAI or any compatible API
export I18NMD_BASE_URL=… I18NMD_API_KEY=… I18NMD_MODEL=…   # overrides both
```

ʻIke ʻia ka mea hoʻolako (provider) mai ka URL a i ʻole ke kī; hoʻololi ʻo `--provider`, `--base-url`, `--model` a me `--batch` iā ia no kēlā me kēia holo.

Hele nā memo ma nā pūʻulu, me ka laina pōʻaiapili o kēlā me kēia, nā unuhina i loaʻa ma ke ʻano he papa huaʻōlelo, a me ka unuhina mua o ka memo i loli. Nānā ʻia kēlā me kēia pane e like me ka unuhina i kākau ʻia e ka lima. Hoʻāʻo hou ʻia ka memo i hāʻule hoʻokahi manawa me ka hewa, a hōʻike ʻia nā mea e hāʻule mau ana a hoʻi i ka ʻōlelo kumu. Mālama ʻia ka holomua ma hope o kēlā me kēia pūʻulu, no laila ʻaʻohe mea e nalo ke ʻoki ʻia ka holo ʻana.

## Ka mālama ʻana i nā unuhina i ke au

```sh
npx i18nmd status
```

```
English (en): 1847 tokens, source
Français (fr): 1790/1847 done, 40 missing, 17 stale
```

Lilo ka unuhina i **kahiko** (stale) ke loli kona kikokikona kumu ma hope o kona kākau ʻia ʻana. E hoʻoponopono i ka unuhina, a helu ʻo i18nmd iā ia he mea i hoʻohou ʻia; ʻaʻohe hōʻailona e holoi ai. Hoʻopiha ʻo `translate` i nā unuhina nalo a kahiko.

| Kauoha | Hana |
| --- | --- |
| `status` | Ka holomua no kēlā me kēia ʻōlelo a me kēlā me kēia māhele. |
| `check` | Nānā i kēlā me kēia waihona. Hāʻule pū ʻo `--strict` ma nā mea nalo a kahiko paha, no CI ma mua o ka hoʻopuka ʻana. Nānā ʻo `--in src` inā lawe mai kāu code i nā māhele āna e kāhea ai, a papa inoa i nā inoa memo i kāhea ʻole ʻia. |
| `sync` | Hoʻohou iā `i18nmd.lock.json` a holoi i nā inoa memo ʻaʻole i loaʻa hou ma ke kumu mai nā ʻōlelo ʻē aʻe. |
| `rename <old> <new> --in src` | Kapa hou i kekahi inoa memo ma nā ʻōlelo a pau, ka lock, a me nā kāhea i kāu code. |
| `join --out all.md` | Kākau i nā ʻōlelo a pau i hoʻokahi waihona Markdown, e nānā ai ma ka ʻaoʻao kekahi i kekahi a i ʻole e hāʻawi ai i ka LLM. |
| `split all.md --out translations` | Hoʻokaʻawale hou i ka waihona i hui ʻia i nā waihona ʻōlelo. |

ʻImi nā kauoha iā `translations/`, `i18n/`, `locales/` a i ʻole ka waihona o kēia manawa iā lākou iho; e hāʻawi i ke ala a i ʻole `--dir` no nā wahi ʻē aʻe. ʻAe pū kēlā me kēia kauoha i ka waihona i hui ʻia ma kahi o ka waihona (directory).

## Python

```sh
npx i18nmd compile translations/server --target python --out app/i18n
```

```python
from app.i18n.i18n import i18nmd, template, LANGS

i18nmd("server.parts", "de", n=3)   # "3 Teile"
```

ʻAʻohe mea e pili ai (dependencies) ka module Python. Hoʻonohonoho ʻo ia i nā hakahaka, nā plural, nā helu kaʻina (ordinal), nā select a me nā helu, me nā lula plural a me ke ʻano helu o kēlā me kēia ʻōlelo (`1.234,5` ma ka ʻōlelo Kelemānia, `12,34,567` ma ka ʻōlelo Hindi) i lawe ʻia mai ka `Intl` o kāu Node.js i ka manawa compile. Hoʻihoʻi ʻo `template(token, language)` i ka memo me nā hakahaka i hōʻike ʻia e like me `{name}`. Hoʻololi ʻo `import-python <module.py> --out translations` i kekahi papa unuhina Python i loaʻa.

## Nā ʻano waihona ʻē aʻe

```sh
npx i18nmd import locales/*/translation.json --from i18next
npx i18nmd import lang/en.json lang/fr.json --from formatjs
npx i18nmd export --to next-intl --out messages      # messages/fr.json
npx i18nmd export --to formatjs --out lang           # lang/fr.json, for react-intl
npx i18nmd export --to i18next --out locales         # locales/fr/translation.json
```

Hoʻohana mua ʻo FormatJS a me next-intl iā ICU, no laila ʻaʻohe mea e nalo i ka hoʻololi ʻana, a lilo nā wehewehe FormatJS i mau laina pōʻaiapili. No i18next, lilo ʻo `{{name}}` iā `{name}`, lilo nā hope plural i nā ICU plural, a lilo nā kī i hoʻopūnana ʻia i nā inoa memo me ke kiko. Mālama ʻia nā memo ʻaʻole hiki iā i18next ke hōʻike ma ke ʻano he kikokikona ICU no ka plugin i18next-icu, me ka ʻōlelo aʻo. Hiki iā ʻoe ke hoʻoponopono ma i18nmd a hoʻouna i nā mea a kāu polokalamu e hoʻouka nei.

## Nā kauoha

| Kauoha | |
| --- | --- |
| `render <site>` | `--out dist`, `--url https://example.com` |
| `extract <src…>` | `--in-place`, `--out translations/<division>`, `--source en`, `--runtime src/i18n/i18n`, `--dest .i18n/src`, `--locale-expr locale` (calls use `i18nmd.in(locale)`) |
| `compile` | `--out src/i18n`, `--target ts\|js\|json\|python`, `--eager`, `--skip <division,…>` |
| `--add <language>`, `--top <n>`, `translate` | `--only fr,de`, `--dry-run`, `--provider`, `--base-url`, `--model`, `--batch 40` |
| `status`, `check`, `sync` | `--strict`, `--in src`, `--fix`, `--skip` |
| `rename <old> <new>` | `--in src` |
| `join`, `split` | `--out` |
| `import`, `export`, `import-python` | `--from`, `--to`, `--out` |
| `languages` | Ka papa inoa a `--top` e hoʻohana ai. |

Lawe kēlā me kēia kauoha iā `--dir`, a me `--source` e hoʻololi ai i ka ʻōlelo kumu i hoʻopaʻa ʻia ma ka lock. Papa inoa ʻo `npx i18nmd --help` i nā mea a pau.

## Nā palena o kēia manawa

- Heluhelu ka mea huki i HTML, JavaScript a me TypeScript. Pono nā kikokikona i loko o nā object (`{ label: "Save" }`) a me nā waihona `.ts` maʻamau iā `/* i18n */` a i ʻole ka paipai huki.
- Hoʻouka ka hoʻololi ʻana i ka ʻōlelo i ka ʻōlelo holoʻokoʻa i ka manawa hoʻokahi, ʻaʻole ma kēlā me kēia māhele.
- Kākau ka pahuhopu Python i nā lā e like me ka mea i hāʻawi ʻia, a me ke kikokikona o ka tag me ka hōʻailona ʻole, ke hāʻawi ʻole ʻoe i kekahi function nona.

## Ka hoʻomohala ʻana

```sh
npm ci --ignore-scripts
npm test
```

Hoʻohana nā hoʻāʻo i kekahi mea pani kūloko no nā API LLM ʻelua, no laila ʻaʻole pono lākou i nā kī a ʻaʻole hoʻopili i ka pūnaewele.

## Laikini

MIT © [Liko Labs](https://likolabs.com)
