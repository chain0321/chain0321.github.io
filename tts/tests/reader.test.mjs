import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader, splitText, chooseChineseVoice } from '../reader.mjs';

const voice = { name: 'Tingting', lang: 'zh-CN', voiceURI: 'test-cn', localService: true };
const flush = () => new Promise(resolve => setImmediate(resolve));

class Clock {
  jobs = new Map();
  counter = 0;
  setTimeout(fn) { const id = ++this.counter; this.jobs.set(id, fn); return id; }
  clearTimeout(id) { this.jobs.delete(id); }
  expire() { const jobs = [...this.jobs.values()]; this.jobs.clear(); jobs.forEach(fn => fn()); }
}

class Engine {
  calls = [];
  cancelled = 0;
  speak(options) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.calls.push({ options, resolve, reject });
    options.start();
    return promise;
  }
  cancel() { this.cancelled++; }
}

function setup(engine = new Engine()) {
  const clock = new Clock();
  const snapshots = [];
  const reader = new Reader(engine, s => snapshots.push(s), clock);
  return { reader, engine, clock, snapshots };
}

test('Long Chinese, punctuation, newlines, emoji and no-punctuation text retain every character', () => {
  for (const input of [
    '认知语言学研究语言与认知的关系。概念隐喻让我们借助熟悉的经验理解抽象事物。\n\n'.repeat(800),
    '中文🧠😀𠀀测试'.repeat(800),
    '连贯的中文内容'.repeat(1000),
    '  \n'.repeat(500),
    'A sentence, with punctuation. '.repeat(1000),
  ]) {
    const chunks = splitText(input);
    assert.equal(chunks.map(c => c.text).join(''), input);
    chunks.forEach((c, i) => {
      assert.ok(Array.from(c.text).length <= 120);
      assert.ok(new TextEncoder().encode(c.text).length < 4096);
      assert.equal(c.start, i ? chunks[i - 1].end : 0);
      assert.equal(c.text, input.slice(c.start, c.end));
      assert.ok(!/^[\uDC00-\uDFFF]/u.test(c.text));
      assert.ok(!/[\uD800-\uDBFF]$/u.test(c.text));
    });
  }
});

test('Prefers complete sentences and rejects invalid chunk limits', () => {
  assert.equal(splitText('第一句话。第二句话非常长需要继续。', 8)[0].text, '第一句话。');
  assert.deepEqual(splitText(''), []);
  assert.throws(() => splitText('中文', 0), RangeError);
});

test('Chooses one Mandarin voice; does not fall back to English or Cantonese', () => {
  const english = { name: 'Samantha', lang: 'en-US', localService: true, default: true };
  const cantonese = { name: 'Sin-ji', lang: 'zh-HK', localService: true };
  const online = { name: 'Xiaoxiao', lang: 'zh-CN', localService: false };
  assert.equal(chooseChineseVoice([english, cantonese]), null);
  assert.equal(chooseChineseVoice([english, online, voice]), voice);
  assert.equal(chooseChineseVoice([{ ...voice, lang: 'zh_CN' }]).lang, 'zh_CN');
  assert.equal(chooseChineseVoice([{ ...voice, lang: 'zh-TW' }]).lang, 'zh-TW');
});

test('Starts in the click call stack and reads every chunk once, in order', async () => {
  const { reader, engine, clock } = setup();
  const text = '把长文章分成短句，然后连续朗读。'.repeat(20);
  reader.play(text, voice);
  assert.equal(engine.calls.length, 1); // No asynchronous delay before first speak.
  const chunks = splitText(text);
  for (let i = 0; i < chunks.length; i++) {
    assert.equal(engine.calls[i].options.text, chunks[i].text);
    assert.equal(engine.calls[i].options.voice, voice);
    engine.calls[i].resolve();
    await flush();
  }
  assert.equal(reader.state, 'done');
  assert.equal(reader.snapshot().progress, 100);
  assert.equal(engine.calls.length, chunks.length);
  assert.equal(clock.jobs.size, 0);
});

test('Pause cancels the current audio; stale completion never skips the next chunk', async () => {
  const { reader, engine } = setup();
  const text = '暂停后继续听这一段。'.repeat(30);
  reader.play(text, voice);
  const previous = engine.calls[0];
  previous.options.boundary({ charIndex: 4 });
  reader.pause();
  assert.equal(reader.state, 'paused');
  reader.play(text, voice);
  const resumed = engine.calls[1];
  assert.equal(resumed.options.text, splitText(text)[0].text.slice(4));
  previous.resolve();
  await flush();
  assert.equal(reader.index, 0);
  assert.equal(engine.calls.length, 2);
  resumed.resolve();
  await flush();
  assert.equal(reader.index, 1);
  reader.reset();
});

test('Errors and a silent engine give a retryable state, preserving unread content', async () => {
  const { reader, engine, clock } = setup();
  reader.play('这是需要继续听完的文字。', voice);
  engine.calls[0].options.boundary({ charIndex: 2 });
  engine.calls[0].reject({ error: 'not-allowed' });
  await flush();
  assert.equal(reader.state, 'error');
  assert.equal(reader.offset, 2);
  assert.match(reader.message, /继续朗读/u);
  reader.play(reader.text, voice);
  clock.expire();
  assert.equal(reader.state, 'error');
  assert.equal(clock.jobs.size, 0);
});

test('An engine that never emits start cannot leave the UI stuck indefinitely', () => {
  const { reader, clock } = setup({ speak: () => new Promise(() => {}), cancel() {} });
  reader.play('中文测试。', voice);
  assert.equal(reader.state, 'starting');
  clock.expire();
  assert.equal(reader.state, 'error');
  assert.match(reader.message, /未能启动/u);
});

test('Editing/resetting and old rejection cannot restart or corrupt a new reading', async () => {
  const { reader, engine } = setup();
  reader.play('第一篇。', voice);
  const previous = engine.calls[0];
  reader.reset();
  reader.play('第二篇。', voice);
  previous.reject({ error: 'interrupted' });
  await flush();
  assert.equal(reader.state, 'playing');
  assert.equal(reader.text, '第二篇。');
  assert.equal(reader.index, 0);
  reader.reset();
});

test('Long blank runs are skipped without losing the following text', async () => {
  const { reader, engine } = setup();
  reader.play('开头。' + '\n'.repeat(300) + '结尾。', voice);
  engine.calls[0].resolve();
  await flush();
  assert.ok(engine.calls[1].options.text.endsWith('结尾。'));
  assert.equal(engine.calls.length, 2);
  reader.reset();
});

test('Vendored EasySpeech invokes the native speech API synchronously', async () => {
  const calls = [];
  const native = {
    getVoices: () => [voice],
    speak: utterance => calls.push(utterance),
    cancel() {}, pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  };
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  globalThis.speechSynthesis = native;
  globalThis.SpeechSynthesisUtterance = class extends EventTarget {};
  try {
    const { default: EasySpeech } = await import('../vendor/easy-speech.mjs');
    await EasySpeech.init({ maxTimeout: 100, interval: 10 });
    const result = EasySpeech.speak({ text: '中文测试。', voice, noStop: true, infiniteResume: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].lang, 'zh-CN');
    calls[0].dispatchEvent(new Event('end'));
    await result;
    EasySpeech.reset();
  } finally {
    for (const key of ['speechSynthesis', 'SpeechSynthesisUtterance']) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  }
});
