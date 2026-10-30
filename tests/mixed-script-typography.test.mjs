import test from 'node:test';
import assert from 'node:assert/strict';

import { scriptFontForCharacter } from '../src/lib/mixed-script-typography.ts';

test('mixed-script typography classifies Japanese scripts and leaves Latin alone', () => {
  assert.equal(scriptFontForCharacter('あ'), 'hiragana');
  assert.equal(scriptFontForCharacter('ア'), 'katakana');
  assert.equal(scriptFontForCharacter('ー'), 'katakana');
  assert.equal(scriptFontForCharacter('・'), 'katakana');
  assert.equal(scriptFontForCharacter('映'), 'han');
  assert.equal(scriptFontForCharacter('々'), 'han');
  assert.equal(scriptFontForCharacter('。'), 'punctuation');
  assert.equal(scriptFontForCharacter('「'), 'punctuation');
  assert.equal(scriptFontForCharacter('A'), null);
  assert.equal(scriptFontForCharacter('1'), null);
  assert.equal(scriptFontForCharacter('/'), null);
  assert.equal(scriptFontForCharacter('🎥'), null);
});
