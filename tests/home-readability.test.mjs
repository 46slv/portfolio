import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from '@astrojs/compiler';
import ts from 'typescript';

// Inspect Astro's actual element tree, including ancestors of the masked rotary.
const files = ['components/Bio.astro', 'components/Header.astro', 'components/RotaryLogs.astro', 'pages/index.astro', 'layouts/BaseLayout.astro'];
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

test('every visible Home template text leaf and dynamic label has a glyph source ancestor', () => {
  let checked = 0;
  for (const { file, ast } of trees) for (const { node, ancestors } of elements(ast)) {
    if ([...ancestors, node].some((parent) => ['head', 'script', 'style'].includes(parent.name))) continue;
    const literal = node.children?.some((child) => child.type === 'text' && child.value.trim());
    const dynamic = node.children?.some((child) => child.type === 'expression'
      && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(
        child.children?.map((part) => part.value ?? '').join('').trim() ?? ''));
    if (!literal && !dynamic && !attr(node, 'set:html')) continue;
    checked++;
    assert.ok([...ancestors, node].some((parent) => attr(parent, 'data-glyph-source')),
      `${file}:${node.position?.start.line} <${node.name}> text is omitted`);
  }
  assert.ok(checked >= 20, 'inspect actual static and data-backed text, not a fixed opt-in count');
  const bio = trees.find(({ file }) => file === 'components/Bio.astro');
  const paragraphs = elements(bio.ast).filter(({ node }) => attr(node, 'set:html'));
  assert.deepEqual(paragraphs.map(({ node }) => attr(node, 'set:html').value), [
    "renderBioText(enText, 'en')", "renderBioText(jaText, 'ja')",
  ]);
  assert.ok(paragraphs.every(({ node }) => classes(node).includes('dim-text')));
});

test('the shared footer and palette opt in on Home only, including its responsive DOM', async () => {
  const layout = trees.find(({ file }) => file === 'layouts/BaseLayout.astro');
  const home = trees.find(({ file }) => file === 'pages/index.astro');
  assert.match(layout.text, /homeBackground = false/);
  const footer = elements(layout.ast).find(({ node }) => node.name === 'footer').node;
  assert.equal(attr(footer, 'data-glyph-source').value, 'homeBackground || undefined');
  assert.match(attr(footer, 'class:list').value, /'home-readability': homeBackground/);
  assert.match(layout.text, /data-home-background=\{homeBackground \|\| undefined\}/);
  assert.match(home.text, /homeBackground=\{true\}/);
  for (const route of ['clock.astro', 'visualizer.astro', 'gear/index.astro']) {
    const text = await readFile(new URL(`../src/pages/${route}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /homeBackground=\{true\}|home-readability\.css/);
  }
  assert.match(trees.find(({ file }) => file === 'components/Header.astro').text, /md:text-6xl/);
  assert.match(home.text, /lg:grid-cols-2/, 'mobile uses the same covered text tree');
});

test('six existing local readability owners plus the conditional Home footer remain outside opacity animations and the rotary mask', () => {
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
  assert.match(plate, /background:\s*rgb\(10 10 10 \/ 65%\)/);
  assert.match(plate, /(?:^|[;\s])backdrop-filter:\s*blur\([1-9][\d.]*px\)/);
  assert.match(plate, /-webkit-backdrop-filter:\s*blur\(/);
  assert.match(plate, /mask-composite:\s*intersect/);
  assert.match(plate, /-webkit-mask-composite:\s*source-in/);
  assert.doesNotMatch(plate, /(?:^|[;\s])filter\s*:/);
  assert.doesNotMatch(css, /(?:body|main|canvas|\*)\s*[{,]/, 'no broad/full-page filter selector');
  assert.match(trees.find(({ file }) => file === 'pages/index.astro').text, /import '\.\.\/styles\/home-readability\.css'/);
});

test('Home palette remains readable across light/dark field states without replacing hover classes', async () => {
  const css = await readFile(new URL('../src/styles/home-readability.css', import.meta.url), 'utf8');
  const palette = [...css.matchAll(/--color-(white|zinc-\d+|green-500):\s*color-mix\(in srgb, (#[a-f\d]+), (#[a-f\d]+)/gi)];
  assert.equal(palette.length, 7);
  const inherited = css.match(/^\s*color:\s*color-mix\(in srgb, (#[a-f\d]+), (#[a-f\d]+)/mi);
  assert.ok(inherited, 'inherited labels and arrows use the same contrast model');
  palette.push([inherited[0], 'inherited', inherited[1], inherited[2]]);
  const rgb = (hex) => {
    const raw = hex.slice(1);
    const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
    return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
  };
  const luminance = (color) => color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05)
    / (Math.min(luminance(a), luminance(b)) + 0.05);
  const tint = Number(css.match(/background:\s*rgb\(10 10 10 \/ (\d+)%\)/)[1]) / 100;
  const opacity = css.match(/\.opacity-50\s*\{\s*opacity:\s*calc\(([\d.]+) \+ ([\d.]+) \* var/).slice(1).map(Number);
  const pulse = css.match(/@keyframes home-status-pulse\s*\{\s*50%\s*\{\s*opacity:\s*calc\(([\d.]+) \+ ([\d.]+) \* var/).slice(1).map(Number);
  const mix = (a, b, light) => a.map((value, index) => value * (1 - light) + b[index] * light);
  for (let step = 0; step <= 100; step++) {
    const field = step / 100;
    // Conservative model: even allow a 0.2 luminance rise between updates.
    // Production adds 0.2 headroom and resamples immediately on pointer changes.
    const light = Math.max(0, field - 0.2);
    const background = Array(3).fill(10 + (255 - 10) * field * (1 - tint));
    for (const [, name, start, end] of palette) {
      const color = mix(rgb(start), rgb(end), light);
      assert.ok(ratio(color, background) >= 4.5, `${name} at field ${field}`);
      if (name === 'green-500') {
        const alpha = pulse[0] + pulse[1] * light;
        assert.ok(ratio(mix(background, color, alpha), background) >= 4.5,
          `status pulse remains readable at field ${field}`);
      }
      if (name === 'white') {
        const alpha = opacity[0] + opacity[1] * light;
        assert.ok(ratio(mix(background, color, alpha), background) >= 4.5,
          `branding opacity remains readable at field ${field}`);
      }
    }
  }
  const rotary = trees.find(({ file }) => file === 'components/RotaryLogs.astro').text;
  const hover = rotary.match(/group-hover:text-\[(#[a-f\d]+)\]/i)[1];
  assert.ok(ratio(rgb(hover), Array(3).fill(10 + 245 * (1 - tint))) >= 4.5);
  assert.match(css, /@supports \(color: color-mix/);
  assert.doesNotMatch(css, /transition(?:-property)?:/, 'existing hover transitions retain their ownership');
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
