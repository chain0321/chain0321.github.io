import { NaturalAudioPlayer } from './natural-player.mjs';

const $ = id => document.getElementById(id);
const input = $('text');
const play = $('play');
const status = $('status');
let worker = null;
let requestId = 0;
let modelState = 'cold';
let readerState = 'idle';
let generationDone = false;
let generatedCharacters = 0;
let finishedCharacters = 0;
let totalCharacters = 0;
let wakeLock = null;

const player = new NaturalAudioPlayer({
  onChunkStart(chunk) {
    readerState = 'playing';
    $('current-text').textContent = chunk.text;
    render();
  },
  onChunkEnd(chunk) {
    finishedCharacters += Array.from(chunk.text).length;
    worker?.postMessage({ type: 'buffer_processed', requestId });
    render();
    finishIfComplete();
  },
  onDrained() { finishIfComplete(); },
});

function progressPercent() {
  if (!totalCharacters) return 0;
  return Math.min(100, Math.round(finishedCharacters / totalCharacters * 100));
}

function setMessage(message, { error = false, warn = false } = {}) {
  status.textContent = message;
  status.dataset.error = String(error);
  status.dataset.warn = String(warn);
}

function render() {
  const active = ['loading', 'buffering', 'playing', 'paused'].includes(readerState);
  input.readOnly = active;
  $('clear').disabled = active || !input.value;
  play.disabled = !input.value.trim() || readerState === 'loading' || readerState === 'buffering';
  const labels = {
    idle: modelState === 'ready' ? '开始自然朗读' : '准备自然语音并播放',
    loading: '正在下载自然语音…',
    buffering: '正在准备开头…',
    playing: '暂停朗读',
    paused: '继续朗读',
    done: '再听一遍',
    error: '重新加载',
  };
  play.textContent = labels[readerState] || labels.idle;
  $('playback').hidden = !active && readerState !== 'done';
  $('reset').hidden = !active && readerState !== 'done';
  const percent = progressPercent();
  $('progress').value = percent;
  $('percentage').textContent = `${percent}%`;
  $('position').textContent = readerState === 'done' ? '全文读完'
    : generatedCharacters ? `已生成 ${Math.min(generatedCharacters, totalCharacters)} / ${totalCharacters} 字`
      : '准备自然语音';
  if (readerState === 'playing') setMessage(generationDone ? '自然语音已生成，正在连续播放。' : '正在边生成边播放，请保持页面打开。');
  if (readerState === 'paused') setMessage('已暂停，点继续朗读即可接着听。');
  if (readerState === 'done') setMessage('全文已读完。');
  if (active) void keepScreenAwake(); else releaseScreen();
}

async function keepScreenAwake() {
  if (wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch { /* Audio remains usable without wake lock. */ }
}

function releaseScreen() {
  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});
}

function createWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL('./neural-worker.mjs', import.meta.url), { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', () => fail('自然语音组件加载失败。请检查网络后重新加载。'));
}

function begin() {
  const text = input.value.trim();
  if (!text) return;
  try {
    // Unlock Web Audio during the direct tap on iOS, before any model awaits.
    player.unlock();
  } catch {
    fail('当前浏览器不支持音频播放。请用 iOS 26 的 Safari 打开。');
    return;
  }
  requestId++;
  totalCharacters = Array.from(text).length;
  generatedCharacters = 0;
  finishedCharacters = 0;
  generationDone = false;
  readerState = modelState === 'ready' ? 'buffering' : 'loading';
  $('current-text').textContent = '';
  render();
  if (!worker) createWorker();
  if (modelState === 'ready') worker.postMessage({ type: 'generate', requestId, text });
  else worker.postMessage({ type: 'init', requestId, preferWebGPU: 'gpu' in navigator });
}

function handleWorkerMessage(event) {
  const message = event.data || {};
  if (message.requestId && message.requestId !== requestId) return;
  if (message.status === 'progress') {
    const progress = Number.isFinite(message.progress) ? Math.round(message.progress) : null;
    setMessage(progress == null ? '正在载入自然语音模型，第一次需要稍等…' : `正在下载自然语音模型：${progress}%（约 170MB）`);
  } else if (message.status === 'ready') {
    modelState = 'ready';
    readerState = 'buffering';
    $('voice').textContent = `Kokoro 中文女声 · ${message.device === 'webgpu' ? '手机 GPU' : '兼容模式'}`;
    if (message.device !== 'webgpu') setMessage('当前浏览器未启用 GPU，生成会比较慢。建议使用 iOS 26 的 Safari。', { warn: true });
    worker.postMessage({ type: 'generate', requestId, text: input.value.trim() });
    render();
  } else if (message.status === 'chunk') {
    generatedCharacters += Array.from(message.text).length;
    player.enqueue({ text: message.text, samples: new Float32Array(message.samples), sampleRate: message.sampleRate });
    if (readerState === 'buffering' && player.bufferedSeconds >= 8) {
      player.start();
      readerState = 'playing';
    }
    render();
  } else if (message.status === 'complete') {
    generationDone = true;
    if (readerState === 'buffering') {
      player.start();
      readerState = 'playing';
    }
    render();
    finishIfComplete();
  } else if (message.status === 'error') fail(message.error || '自然语音生成失败。');
}

function finishIfComplete() {
  if (!generationDone || !player.isDrained) return;
  readerState = 'done';
  finishedCharacters = totalCharacters;
  render();
}

function fail(message) {
  modelState = 'cold';
  readerState = 'error';
  player.stop();
  worker?.terminate();
  worker = null;
  setMessage(`${message} 首次模型约 170MB，请连接稳定的 Wi-Fi 后重试。`, { error: true });
  $('retry').hidden = false;
  render();
}

function stop() {
  requestId++;
  worker?.postMessage({ type: 'stop' });
  player.stop();
  generationDone = false;
  readerState = 'idle';
  generatedCharacters = 0;
  finishedCharacters = 0;
  render();
}

play.addEventListener('click', async () => {
  if (readerState === 'playing') {
    await player.pause();
    readerState = 'paused';
    render();
  } else if (readerState === 'paused') {
    await player.resume();
    readerState = 'playing';
    render();
  } else begin();
});
$('reset').addEventListener('click', stop);
$('retry').addEventListener('click', () => { $('retry').hidden = true; begin(); });
$('clear').addEventListener('click', () => { stop(); input.value = ''; updateCount(); input.focus(); });
input.addEventListener('input', updateCount);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && readerState === 'playing') void keepScreenAwake();
});
window.addEventListener('pagehide', () => { void player.pause(); releaseScreen(); });

function updateCount() {
  $('count').textContent = `${Array.from(input.value).length.toLocaleString('zh-CN')} 字`;
  $('clear').disabled = !input.value;
  play.disabled = !input.value.trim();
}
updateCount();
