// All positions use UTF-16 offsets, matching SpeechSynthesisEvent.charIndex.
export function splitText(text, limit = 120) {
  if (!Number.isInteger(limit) || limit < 8) throw new RangeError('Invalid chunk limit');
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    let count = 0;
    let sentence = 0;
    let phrase = 0;
    for (const character of text.slice(start)) {
      end += character.length;
      count++;
      if (/[。！？!?；;\n]/u.test(character)) sentence = end;
      if (/[，,、：:\s]/u.test(character) && count >= limit / 3) phrase = end;
      if (count >= limit) break;
    }
    if (end < text.length) end = sentence || phrase || end;
    chunks.push({ text: text.slice(start, end), start, end });
    start = end;
  }
  return chunks;
}

export function chooseChineseVoice(voices) {
  return voices.map((voice, order) => {
    const lang = (voice.lang || '').replaceAll('_', '-').toLowerCase();
    const mandarin = /^(zh($|-cn$|-sg$|-tw$|-hans($|-)|-hant-tw$)|cmn($|-))/u.test(lang);
    if (!mandarin) return null;
    let score = voice.localService ? 1000 : 0;
    if (/^(zh(-cn|-sg|-hans.*)?|cmn(-cn)?)$/u.test(lang)) score += 200;
    if (/premium|enhanced|高质量|优质|增强/u.test(voice.name.toLowerCase())) score += 80;
    if (/ting.?ting|婷婷|晓晓|xiaoxiao|xiaoyi/u.test(voice.name.toLowerCase())) score += 40;
    if (voice.default) score += 5;
    return { voice, score, order };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.order - b.order)[0]?.voice || null;
}

export class Reader {
  constructor(engine, onChange, clock = globalThis) {
    this.engine = engine;
    this.onChange = onChange;
    this.clock = clock;
    this.state = 'idle';
    this.text = '';
    this.chunks = [];
    this.index = 0;
    this.offset = 0;
    this.run = 0;
    this.timer = null;
    this.message = '';
  }

  snapshot() {
    const current = this.chunks[this.index];
    const position = this.state === 'done' ? this.text.length : (current?.start || 0) + this.offset;
    return {
      state: this.state, message: this.message,
      index: this.index, total: this.chunks.length,
      current: current?.text || '',
      progress: this.text.length ? Math.min(100, Math.floor(position / this.text.length * 100)) : 0,
    };
  }

  notify() { this.onChange(this.snapshot()); }

  play(text, voice) {
    if (!voice || !text.trim()) return;
    if (this.state === 'playing' || this.state === 'starting') return;
    if (text !== this.text || this.state === 'done' || !this.chunks.length) {
      this.reset(false);
      this.text = text;
      this.chunks = splitText(text);
    }
    this.voice = voice;
    this.message = '';
    this.speakChunk(); // Stay in the click's call stack for Safari user activation.
  }

  clearTimer() { this.clock.clearTimeout(this.timer); this.timer = null; }

  armTimeout(milliseconds, run) {
    this.clearTimer();
    this.timer = this.clock.setTimeout(() => {
      if (run !== this.run) return;
      this.fail(this.state === 'starting'
        ? '语音未能启动。请检查媒体音量，再点继续朗读。'
        : '语音似乎中断了。回到这个页面后，点继续朗读。');
    }, milliseconds);
  }

  speakChunk() {
    // A long run of blank lines can become its own chunk. Skip silent chunks
    // without asking the speech engine to pronounce an empty utterance.
    while (this.index < this.chunks.length && !this.chunks[this.index].text.trim()) {
      this.index++;
      this.offset = 0;
    }
    if (this.index >= this.chunks.length) {
      this.state = 'done';
      this.clearTimer();
      this.notify();
      return;
    }
    const run = ++this.run;
    const base = this.offset;
    const text = this.chunks[this.index].text.slice(base);
    this.state = 'starting';
    this.notify();
    this.armTimeout(12000, run);
    try {
      const result = this.engine.speak({
        text, voice: this.voice, rate: 1, pitch: 1, volume: 1,
        noStop: true, infiniteResume: false,
        start: () => {
          if (run !== this.run) return;
          this.state = 'playing';
          this.armTimeout(Math.max(25000, Array.from(text).length * 700 + 12000), run);
          this.notify();
        },
        boundary: event => {
          if (run !== this.run || !Number.isInteger(event.charIndex)) return;
          // Resume repeats at most the current word; engines without boundaries
          // repeat the current short chunk rather than losing unread text.
          const candidate = Math.max(0, Math.min(event.charIndex, text.length - 1));
          this.offset = base + candidate;
          if (/^[\uDC00-\uDFFF]$/u.test(this.text[this.chunks[this.index].start + this.offset] || '')) this.offset--;
          this.notify();
        },
      });
      Promise.resolve(result).then(() => {
        if (run !== this.run) return;
        this.clearTimer();
        this.index++;
        this.offset = 0;
        this.speakChunk();
      }, error => {
        if (run !== this.run) return;
        const code = error?.error || '';
        const messages = {
          'not-allowed': '浏览器暂停了语音。请直接点继续朗读；手机上建议在 Safari 中打开。',
          'language-unavailable': '设备暂时无法使用这个中文音色。请下载系统的普通话语音，再刷新页面。',
          'voice-unavailable': '这个中文音色暂时不可用。请检查系统语音是否下载完成，再刷新页面。',
          'network': '系统语音连接失败。请检查网络，或下载设备上的普通话音色后重试。',
          'audio-busy': '音频正被其他应用占用。结束其他音频后，点继续朗读。',
          'audio-hardware': '音频输出暂时不可用。请检查耳机和媒体音量，再点继续朗读。',
        };
        this.fail(messages[code] || '朗读中断了。请保持页面打开，点继续朗读接着听。');
      });
    } catch {
      this.fail('语音未能启动。请点继续朗读重试，或重新打开页面。');
    }
  }

  cancel() {
    ++this.run;
    this.clearTimer();
    try { this.engine.cancel(); } catch { /* Also safe before initialization. */ }
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'starting') return;
    this.cancel();
    this.state = 'paused';
    this.notify();
  }

  fail(message) {
    this.cancel();
    this.state = 'error';
    this.message = message;
    this.notify();
  }

  reset(emit = true) {
    this.cancel();
    this.state = 'idle';
    this.index = 0;
    this.offset = 0;
    this.text = '';
    this.chunks = [];
    this.message = '';
    if (emit) this.notify();
  }
}
