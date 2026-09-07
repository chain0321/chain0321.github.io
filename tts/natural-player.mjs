export class NaturalAudioPlayer {
  constructor({ onChunkStart = () => {}, onChunkEnd = () => {}, onDrained = () => {} } = {}) {
    this.onChunkStart = onChunkStart;
    this.onChunkEnd = onChunkEnd;
    this.onDrained = onDrained;
    this.queue = [];
    this.sources = new Set();
    this.playing = false;
    this.scheduledUntil = 0;
  }

  unlock() {
    if (!this.context || this.context.state === 'closed') {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is unavailable');
      this.context = new AudioContextClass({ latencyHint: 'playback', sampleRate: 24000 });
    }
    const silent = this.context.createBuffer(1, 1, this.context.sampleRate);
    const source = this.context.createBufferSource();
    source.buffer = silent;
    source.connect(this.context.destination);
    source.start();
    void this.context.resume();
  }

  enqueue(chunk) {
    this.queue.push(chunk);
    if (this.playing) this.schedule();
  }

  get bufferedSeconds() {
    return this.queue.reduce((total, chunk) => total + chunk.samples.length / chunk.sampleRate, 0);
  }

  get isDrained() { return this.queue.length === 0 && this.sources.size === 0; }

  start() {
    if (!this.context) this.unlock();
    this.playing = true;
    this.scheduledUntil = Math.max(this.context.currentTime + 0.08, this.scheduledUntil);
    this.schedule();
  }

  schedule() {
    if (!this.playing || !this.context) return;
    // Bounded look-ahead keeps pause responsive and limits memory use.
    while (this.queue.length && this.scheduledUntil - this.context.currentTime < 35) {
      const chunk = this.queue.shift();
      const buffer = this.context.createBuffer(1, chunk.samples.length, chunk.sampleRate);
      buffer.copyToChannel(chunk.samples, 0);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      const startsAt = Math.max(this.context.currentTime + 0.04, this.scheduledUntil);
      source.start(startsAt);
      this.scheduledUntil = startsAt + buffer.duration;
      this.sources.add(source);
      let started = false;
      const startTimer = setTimeout(() => {
        if (!this.sources.has(source)) return;
        started = true;
        this.onChunkStart(chunk);
      }, Math.max(0, (startsAt - this.context.currentTime) * 1000));
      source.onended = () => {
        clearTimeout(startTimer);
        this.sources.delete(source);
        if (!started) this.onChunkStart(chunk);
        this.onChunkEnd(chunk);
        this.schedule();
        if (this.isDrained) this.onDrained();
      };
    }
  }

  async pause() {
    this.playing = false;
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume() {
    if (!this.context) return;
    this.playing = true;
    await this.context.resume();
    this.schedule();
  }

  stop() {
    this.playing = false;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
    }
    this.sources.clear();
    this.queue.length = 0;
    this.scheduledUntil = 0;
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = null;
  }
}
