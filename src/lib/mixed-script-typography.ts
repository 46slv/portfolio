export type ScriptFont = 'hiragana' | 'katakana' | 'han' | 'punctuation' | null;

const HIRAGANA = /\p{Script=Hiragana}/u;
const KATAKANA = /\p{Script=Katakana}/u;
const HAN = /\p{Script=Han}/u;
const JAPANESE_PUNCTUATION = /[\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/u;
const SKIP_SELECTOR = 'script, style, noscript, textarea, pre, code, svg, canvas, [data-script-font], [data-mixed-script-ignore]';

export function scriptFontForCharacter(character: string): ScriptFont {
  if (!character) return null;

  // These common-script marks visually belong with katakana in ordinary Japanese.
  if (character === 'ー' || character === '・' || character === '゠') return 'katakana';

  // Treat ideographic iteration/number marks with the kanji face.
  if (character === '々' || character === '〆' || character === '〇' || character === '〻') return 'han';

  if (HIRAGANA.test(character)) return 'hiragana';
  if (KATAKANA.test(character)) return 'katakana';
  if (HAN.test(character)) return 'han';
  if (JAPANESE_PUNCTUATION.test(character)) return 'punctuation';
  return null;
}

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent || !node.data.trim()) return true;
  return Boolean(parent.closest(SKIP_SELECTOR));
}

export function applyMixedScriptTypography(root: ParentNode = document.body): number {
  const ownerDocument = root instanceof Document ? root : root.ownerDocument ?? document;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipTextNode(node as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) textNodes.push(current as Text);

  let changed = 0;
  for (const textNode of textNodes) {
    const characters = Array.from(textNode.data);
    if (!characters.some((character) => scriptFontForCharacter(character) !== null)) continue;

    const fragment = ownerDocument.createDocumentFragment();
    let run = '';
    let runFont: ScriptFont = scriptFontForCharacter(characters[0]);

    const flush = () => {
      if (!run) return;
      if (runFont === null) {
        fragment.append(run);
      } else {
        const span = ownerDocument.createElement('span');
        span.dataset.scriptFont = runFont;
        span.textContent = run;
        fragment.append(span);
      }
      run = '';
    };

    for (const character of characters) {
      const font = scriptFontForCharacter(character);
      if (font !== runFont) {
        flush();
        runFont = font;
      }
      run += character;
    }
    flush();

    textNode.replaceWith(fragment);
    changed += 1;
  }

  return changed;
}
