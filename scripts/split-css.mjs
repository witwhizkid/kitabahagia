// Build step: give each public page a copy of css/style.css without the rules that can never
// match it. Many rules are scoped to a body/main class such as `.registration-page` or
// `.home-page`; those classes are static in the HTML (JS never adds them), so a rule whose every
// selector requires a page class the page does not have is dead weight there. Only whole rules are
// dropped and the order of the rest is untouched, so the cascade on each page stays identical.
// Usage: node scripts/split-css.mjs <dist dir>
import fs from 'node:fs';
import path from 'node:path';

const dist = process.argv[2] || 'dist';
const SCOPES = /\.((?:registration|home|program|kisah|about|collaboration|schedule|detail|contact|status|volunteer|kisah-detail)-page|home-document)(?![\w-])/g;
const source = fs.readFileSync(path.join(dist, 'css/style.css'), 'utf8');

// Split CSS text into top-level items: { prelude, body } for blocks, { text } for statements.
const parse = (css) => {
  const items = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  let bodyStart = -1;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 2; continue; }
    if (c === '"' || c === "'") { i += 1; while (i < css.length && css[i] !== c) i += css[i] === '\\' ? 2 : 1; i += 1; continue; }
    if (c === '{') { if (depth === 0) bodyStart = i; depth += 1; }
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) { items.push({ prelude: css.slice(start, bodyStart), body: css.slice(bodyStart + 1, i) }); start = i + 1; }
    } else if (c === ';' && depth === 0) { items.push({ text: css.slice(start, i + 1) }); start = i + 1; }
    i += 1;
  }
  return items;
};

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

// Top-level commas only (not inside :is(), :not(), attribute selectors).
const splitSelectors = (prelude) => {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of prelude) {
    if (c === '(' || c === '[') depth += 1;
    if (c === ')' || c === ']') depth -= 1;
    if (c === ',' && depth === 0) { parts.push(current); current = ''; } else current += c;
  }
  parts.push(current);
  return parts;
};

// Only the part outside parentheses must match (inside :not()/:is() a class does not have to exist).
const outsideParens = (selector) => {
  let flat = '';
  let depth = 0;
  for (const c of selector) {
    if (c === '(') depth += 1;
    if (depth === 0) flat += c;
    if (c === ')') depth -= 1;
  }
  return flat;
};
const requiredScopes = (selector) => [...outsideParens(selector).matchAll(SCOPES)].map((match) => match[1]);

// Second filter: a class that appears nowhere in the public HTML or JS cannot be on any element.
// JS builds a few names from templates (`loading-line-${size}`, `payment_${key}`), so any class
// starting with such a prefix counts as used.
const publicFiles = [
  ...fs.readdirSync(dist).filter((name) => name.endsWith('.html')),
  ...fs.readdirSync(path.join(dist, 'js')).filter((name) => name.endsWith('.js')).map((name) => `js/${name}`),
].map((name) => fs.readFileSync(path.join(dist, name), 'utf8'));
const knownWords = new Set(publicFiles.flatMap((text) => text.match(/[A-Za-z_][\w-]*/g) || []));
const dynamicPrefixes = [...new Set(publicFiles.flatMap((text) => [...text.matchAll(/([A-Za-z][\w-]*[-_])\$\{/g)].map((m) => m[1])))];
const classExists = (name) => knownWords.has(name) || dynamicPrefixes.some((prefix) => name.startsWith(prefix));
const unknownClass = (selector) => [...outsideParens(selector).matchAll(/\.([A-Za-z_][\w-]*)/g)].some((m) => !classExists(m[1]));

const BLOCK_AT_RULES = /^@(media|supports|layer|container|document)\b/;

const prune = (items, present) => items.map((item) => {
  if (item.text !== undefined) return stripComments(item.text).trim();
  const prelude = stripComments(item.prelude).trim();
  if (BLOCK_AT_RULES.test(prelude)) {
    const inner = prune(parse(item.body), present);
    return inner ? `${prelude}{${inner}}` : '';
  }
  if (!prelude.startsWith('@')) {
    const alive = splitSelectors(prelude).some((selector) => !unknownClass(selector)
      && requiredScopes(selector).every((scope) => present.has(scope)));
    if (!alive) return '';
  }
  return `${prelude}{${stripComments(item.body).trim()}}`;
}).filter(Boolean).join('\n');

const tree = parse(source);
const written = new Map();
for (const file of fs.readdirSync(dist).filter((name) => name.endsWith('.html'))) {
  const htmlPath = path.join(dist, file);
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('css/style.css')) continue;
  const present = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/)));
  const key = [...present].filter((name) => /-page$|^home-document$/.test(name)).sort().join('+') || 'base';
  if (!written.has(key)) {
    const css = prune(tree, present);
    const name = `css/style.${key.replace(/[^a-z+-]/g, '')}.css`;
    fs.writeFileSync(path.join(dist, name), `${css}\n`);
    written.set(key, { name, bytes: css.length });
  }
  fs.writeFileSync(htmlPath, html.replace(/css\/style\.css/g, written.get(key).name));
}
for (const [key, { name, bytes }] of written) console.log(`${name}: ${Math.round(bytes / 1024)} KB (${key})`);
console.log(`style.css: ${Math.round(source.length / 1024)} KB`);
