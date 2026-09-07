import EasySpeech from './vendor/easy-speech.mjs';
import { Reader, chooseChineseVoice } from './reader.mjs';

const $ = id => document.getElementById(id);
const input = $('text');
const play = $('play');
const status = $('status');
let voice = null;
let ready = false;
let loading = false;
let wakeLock = null;
let requestingWakeLock = false;

async function keepScreenAwake() {
  if (wakeLock || requestingWakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  requestingWakeLock = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!['starting', 'playing'].includes(reader.state)) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch { /* Listening still works without screen-wake permission. */ }
  finally { requestingWakeLock = false; }
}

function releaseScreen() {
  if (!wakeLock) return;
  const lock = wakeLock;
  wakeLock = null;
  lock.release().catch(() => {});
}

function render(snapshot) {
  const busy = snapshot.state === 'playing' || snapshot.state === 'starting';
  input.readOnly = busy;
  $('clear').disabled = busy || !input.value;
  play.disabled = !ready || !voice || !input.value.trim();
  if (ready && voice) {
    play.textContent = busy ? '暂停朗读'
      : snapshot.state === 'paused' || snapshot.state === 'error' ? '继续朗读'
        : snapshot.state === 'done' ? '再听一遍' : '开始朗读';
    const messages = {
      idle: '准备好了，粘贴文字后点开始朗读。',
      starting: '正在接上语音…',
      playing: '正在朗读，会自动接着读下一段。',
      paused: '已暂停。继续时会从当前位置附近接着读。',
      done: '全文已读完。',
      error: snapshot.message,
    };
    status.textContent = messages[snapshot.state];
    status.dataset.error = String(snapshot.state === 'error');
  }
  $('playback').hidden = snapshot.total === 0;
  $('reset').hidden = snapshot.total === 0;
  $('position').textContent = snapshot.state === 'done' ? '全文读完' : `第 ${snapshot.index + 1} / ${snapshot.total} 段`;
  $('progress').value = snapshot.progress;
  $('percentage').textContent = `${snapshot.progress}%`;
  $('current-text').textContent = snapshot.current;
  if (busy) queueMicrotask(() => { void keepScreenAwake(); }); else releaseScreen();
}

const reader = new Reader(EasySpeech, render);

function updateCount() {
  $('count').textContent = `${Array.from(input.value).length.toLocaleString('zh-CN')} 字`;
  render(reader.snapshot());
}

function updateVoice() {
  if (reader.state === 'starting' || reader.state === 'playing' || reader.state === 'paused') return;
  voice = chooseChineseVoice(window.speechSynthesis?.getVoices() || []);
  if (voice) {
    $('voice').textContent = `中文 · ${voice.name}${voice.localService ? ' · 设备音色' : ' · 系统在线音色'}`;
    $('privacy').textContent = voice.localService
      ? '免费使用 · 网页不上传或保存你粘贴的文字'
      : '免费使用 · 网页不保存文字，当前音色由系统联网朗读';
    $('retry').hidden = true;
    render(reader.snapshot());
  } else {
    play.disabled = true;
    play.textContent = '暂未找到中文语音';
    status.textContent = '请先在手机系统中下载普通话语音，再点重新检测。iPhone 上建议用 Safari 打开。';
    status.dataset.error = 'true';
    $('retry').hidden = false;
  }
}

async function initialize() {
  if (loading) return;
  loading = true;
  ready = false;
  play.disabled = true;
  play.textContent = '正在准备中文语音…';
  $('retry').hidden = true;
  status.textContent = '正在查找设备上的中文音色…';
  status.dataset.error = 'false';
  try {
    await EasySpeech.init({ maxTimeout: 10000, interval: 250, maxLengthExceeded: 'error' });
    ready = true;
    updateVoice();
  } catch {
    play.textContent = '语音暂时不可用';
    status.textContent = '浏览器没有提供可用的语音。请用 Safari 或 Chrome 打开此页面，再试一次。';
    status.dataset.error = 'true';
    $('retry').hidden = false;
  } finally { loading = false; }
}

play.addEventListener('click', () => {
  if (reader.state === 'playing' || reader.state === 'starting') reader.pause();
  else {
    // Do not put clipboard, voice-loading, wake-lock or any await before speak.
    reader.play(input.value.trim(), voice);
  }
});
$('reset').addEventListener('click', () => reader.reset());
$('clear').addEventListener('click', () => {
  reader.reset();
  input.value = '';
  updateCount();
  input.focus();
});
input.addEventListener('input', () => { reader.reset(false); updateCount(); });
$('retry').addEventListener('click', () => { EasySpeech.reset(); void initialize(); });
window.speechSynthesis?.addEventListener('voiceschanged', () => { if (ready) updateVoice(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ['starting', 'playing'].includes(reader.state)) void keepScreenAwake();
});
window.addEventListener('pagehide', () => { reader.pause(); releaseScreen(); });
void initialize();
