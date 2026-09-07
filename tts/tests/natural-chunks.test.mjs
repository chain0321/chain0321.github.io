import test from 'node:test';
import assert from 'node:assert/strict';

// Load only the exported pure function; replace the browser CDN import for Node.
const source = await (await import('node:fs/promises')).readFile(new URL('../neural-worker.mjs', import.meta.url), 'utf8');
const moduleSource = source.replace(/^import .*?;\n/u, 'const KokoroTTS = {}; const env = {};\n');
const url = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;
globalThis.self = { addEventListener() {}, postMessage() {} };
const { naturalChunks } = await import(url);

test('natural chunks keep words and punctuation in order while merging short sentences', () => {
  const input = '第一句话很短。第二句话也很短！第三句话继续解释认知语言学里的概念隐喻。'.repeat(20);
  const chunks = naturalChunks(input);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.length < 60);
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 130));
  assert.ok(chunks.some(chunk => (chunk.match(/[。！]/gu) || []).length > 1));
});

test('very long text without sentence punctuation is safely split', () => {
  const input = ('这是一段很长的内容，包含自然的逗号停顿，').repeat(100);
  const chunks = naturalChunks(input);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 130));
});

test('emoji and astral characters are never split in half', () => {
  const input = '中文🧠😀𠀀测试'.repeat(100);
  const chunks = naturalChunks(input, 20, 30);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.every(chunk => !/^[\uDC00-\uDFFF]/u.test(chunk) && !/[\uD800-\uDBFF]$/u.test(chunk)));
});
