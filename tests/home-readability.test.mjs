import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from '@astrojs/compiler';
import ts from 'typescript';

// Inspect Astro's actual element tree, including ancestors of the masked rotary.
const files = ['components/Bio.astro', 'components/Header.astro', 'components/RotaryLogs.astro', 'pages/index.astro'];
const trees = await Promise.all(files.map(async (file) => {
  const text = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  return { file, text, ast: (await parse(text)).ast };
}));
const attr = (node, name) => node.attributes?.find((attribute) => attribute.name === name);
const classes = (node) => (attr(node, 'class')?.value ?? '').split(/\s+/);
function elements(node, ancestors = []) {
  return [
    ...(node.type === 'element' ? [{ node, ancestors }] : []),
    ...(node.children ?? []).flatMap((child) => elements(child, [...ancestors, node])),
  ];
}

test('only both bio paragraphs join the existing explicit heading and log glyph sources', () => {
  const sources = trees.flatMap(({ file, ast }) => elements(ast)
    .filter(({ node }) => attr(node, 'data-glyph-source')).map(({ node }) => ({ file, node })));
  assert.deepEqual(sources.map(({ file, node }) => [file, node.name]), [
    ['components/Bio.astro', 'p'], ['components/Bio.astro', 'p'],
    ['components/Header.astro', 'h1'], ['components/RotaryLogs.astro', 'a'],
  ]);
  const paragraphs = sources.filter(({ node }) => node.name === 'p');
  assert.deepEqual(paragraphs.map(({ node }) => attr(node, 'set:html')?.value), [
    "renderBioText(enText, 'en')", "renderBioText(jaText, 'ja')",
  ]);
  assert.ok(paragraphs.every(({ node }) => classes(node).includes('dim-text')));
});

test('six local readability owners remain outside opacity animations and the rotary mask', () => {
  const owners = trees.flatMap(({ file, ast }) => elements(ast)
    .filter(({ node }) => classes(node).includes('home-readability'))
    .map((entry) => ({ ...entry, file })));
  assert.equal(owners.length, 6, 'no full-page readability wrapper');
  for (const { file, node, ancestors } of owners) {
    for (const ancestor of [...ancestors, node]) {
      assert.ok(!classes(ancestor).includes('animate-fade-slide'), `${file}: blur must be outside animated opacity`);
      assert.doesNotMatch(attr(ancestor, 'style')?.value ?? '', /mask|filter|opacity/i);
    }
  }
  const bio = owners.find(({ file }) => file === 'components/Bio.astro');
  assert.ok(classes(bio.node).includes('max-w-3xl'), 'bio wash follows text width');
  const rotary = trees.find(({ file }) => file === 'components/RotaryLogs.astro');
  const masked = elements(rotary.ast).find(({ node }) => /mask-image/.test(attr(node, 'style')?.value ?? ''));
  assert.ok(masked.ancestors.some((node) => classes(node).includes('home-readability')));
  assert.ok(!classes(masked.node).includes('home-readability'), 'blur is not inside the backdrop-root mask');
  assert.ok(elements(rotary.ast).some(({ node }) => attr(node, 'id')?.value === 'rotary'
    && classes(node).includes('overflow-y-auto')));
});

test('backplates blur the backdrop, not the sharp foreground, and never intercept input', async () => {
  const css = (await readFile(new URL('../src/styles/home-readability.css', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const owner = css.match(/\.home-readability\s*\{([^}]+)\}/)?.[1] ?? '';
  const plate = css.match(/\.home-readability::before\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(owner, /position:\s*relative/);
  assert.match(owner, /z-index:\s*0/);
  assert.doesNotMatch(owner, /(?:filter|mask|opacity|padding|margin|border|height|width)\s*:/);
  assert.match(plate, /position:\s*absolute/);
  assert.match(plate, /z-index:\s*-1/);
  assert.match(plate, /pointer-events:\s*none/);
  assert.match(plate, /background:\s*rgb\(10 10 10 \/ 55%\)/);
  assert.match(plate, /(?:^|[;\s])backdrop-filter:\s*blur\([1-9][\d.]*px\)/);
  assert.match(plate, /-webkit-backdrop-filter:\s*blur\(/);
  assert.match(plate, /mask-composite:\s*intersect/);
  assert.match(plate, /-webkit-mask-composite:\s*source-in/);
  assert.doesNotMatch(plate, /(?:^|[;\s])filter\s*:/);
  assert.doesNotMatch(css, /(?:body|main|canvas|\*)\s*[{,]/, 'no broad/full-page filter selector');
  assert.match(trees.find(({ file }) => file === 'pages/index.astro').text, /import '\.\.\/styles\/home-readability\.css'/);
});

// Test the real hit-test function without changing its production exports. These
// DOM/Range doubles verify traversal/coordinates, not actual font or browser pixels.
const renderer = await readFile(new URL('../src/scripts/glyph-field.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(`${renderer}\nexport { glyphAtPoint };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace(/from '(\.\.\/lib\/[^']+)'/g,
  (_, path) => `from '${new URL(`${path}.ts`, new URL('../src/scripts/', import.meta.url)).href}'`);
const { glyphAtPoint } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('real glyph hit-test includes English/Japanese prose and nested links but excludes gaps and unmarked text', () => {
  class Element {
    constructor(parent = null, optedIn = false) { this.parent = parent; this.optedIn = optedIn; this.nodes = []; }
    closest(selector) {
      assert.equal(selector, '[data-glyph-source]');
      return this.optedIn ? this : this.parent?.closest(selector) ?? null;
    }
  }
  const en = new Element(null, true);
  const ja = new Element(null, true);
  const enLink = new Element(en);
  const jaLink = new Element(ja);
  const unmarked = new Element();
  const line = (source, textContent, left, top) => {
    const node = { textContent, left, top };
    source.nodes.push(node);
    return node;
  };
  line(en, 'Shishu ', 0, 0);
  line(en, 'CDs', 100, 0); // Descendant link text, not a separate opt-in.
  line(ja, '藤白 詩集', 0, 40);
  line(ja, 'CDs', 100, 40);
  let hit = en;
  let current;
  let start;
  let end;
  const originals = new Map(['document', 'NodeFilter'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, {
    NodeFilter: { SHOW_TEXT: 4 },
    document: {
      elementFromPoint: () => hit,
      createTreeWalker(source) {
        let i = 0;
        return { nextNode: () => source.nodes[i++] ?? null };
      },
      createRange() {
        return {
          setStart(node, index) { current = node; start = index; },
          setEnd(node, index) { assert.equal(node, current); end = index; },
          getClientRects: () => [{ left: current.left + start * 10, right: current.left + end * 10,
            top: current.top, bottom: current.top + 20, width: (end - start) * 10 }],
        };
      },
    },
  });
  try {
    assert.equal(glyphAtPoint(1, 1), 'S');
    assert.equal(glyphAtPoint(61, 1), '', 'space is not a glyph');
    assert.equal(glyphAtPoint(80, 1), '', 'gap before the nested link');
    hit = enLink;
    assert.equal(glyphAtPoint(111, 1), 'D');
    hit = ja;
    assert.equal(glyphAtPoint(1, 41), '藤');
    assert.equal(glyphAtPoint(21, 41), '', 'Japanese inline space');
    assert.equal(glyphAtPoint(1, 30), '', 'inter-paragraph gap');
    hit = jaLink;
    assert.equal(glyphAtPoint(121, 41), 's');
    hit = unmarked;
    assert.equal(glyphAtPoint(1, 1), '');
    hit = null;
    assert.equal(glyphAtPoint(1, 1), '');
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
