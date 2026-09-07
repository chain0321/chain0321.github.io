import { KokoroTTS, env } from 'https://cdn.jsdelivr.net/npm/@uzen/kokoro-js@1.2.4/dist/kokoro.web.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.1-zh-ONNX';
const VOICE_PATH = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main/voices';
const VOICE = 'zf_001';
const SAMPLE_RATE = 24000;
const MAX_QUEUED = 6;
let tts = null;
let activeRequestId = 0;
let queued = 0;

// Preserve Transformers' version-matched runtime URLs and Safari-specific files.
// Overriding wasmPaths with another ORT build prevents initialization.
env.allowLocalModels = false;

function progressCallback(requestId) {
  return progress => {
    if (requestId !== activeRequestId) return;
    const value = Number(progress?.progress);
    self.postMessage({ status: 'progress', requestId, progress: Number.isFinite(value) ? value : null });
  };
}

async function initialize(requestId, preferWebGPU) {
  activeRequestId = requestId;
  const attempts = preferWebGPU
    ? [{ device: 'webgpu', dtype: 'fp16' }, { device: 'wasm', dtype: 'q8' }]
    : [{ device: 'wasm', dtype: 'q8' }];
  const errors = [];
  for (const attempt of attempts) {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL, {
        ...attempt,
        voicePath: VOICE_PATH,
        progress_callback: progressCallback(requestId),
      });
      if (requestId !== activeRequestId) return;
      self.postMessage({ status: 'ready', requestId, device: attempt.device, dtype: attempt.dtype });
      return;
    } catch (error) {
      errors.push(`${attempt.device}/${attempt.dtype}: ${String(error?.message || error).slice(0, 600)}`);
      tts = null;
    }
  }
  throw new Error(errors.join('\n') || '模型无法加载');
}

self.addEventListener('message', async event => {
  const message = event.data || {};
  if (message.type === 'buffer_processed') {
    if (message.requestId === activeRequestId) queued = Math.max(0, queued - 1);
    return;
  }
  if (message.type === 'stop') {
    activeRequestId++;
    queued = 0;
    return;
  }
  if (message.type === 'init') {
    try { await initialize(message.requestId, message.preferWebGPU); }
    catch (error) {
      if (message.requestId === activeRequestId) self.postMessage({ status: 'error', requestId: message.requestId, error: friendlyError(error) });
    }
    return;
  }
  if (message.type !== 'generate' || !tts) return;
  const { requestId, text } = message;
  activeRequestId = requestId;
  queued = 0;
  try {
    for (const naturalText of naturalChunks(text)) {
      if (requestId !== activeRequestId) return;
      while (queued >= MAX_QUEUED && requestId === activeRequestId) await new Promise(resolve => setTimeout(resolve, 80));
      if (requestId !== activeRequestId) return;
      const audio = await tts.generate(naturalText, { voice: VOICE, speed: 0.94 });
      if (requestId !== activeRequestId) return;
      const samples = audio.audio.slice().buffer;
      queued++;
      self.postMessage({ status: 'chunk', requestId, text: naturalText, samples, sampleRate: SAMPLE_RATE }, { transfer: [samples] });
    }
    if (requestId === activeRequestId) self.postMessage({ status: 'complete', requestId });
  } catch (error) {
    if (requestId === activeRequestId) self.postMessage({ status: 'error', requestId, error: friendlyError(error) });
  }
});

export function naturalChunks(text, target = 72, maximum = 130) {
  const units = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]+|[^。！？!?；;\n]+$/gu) || [];
  const chunks = [];
  let current = '';
  const flush = () => { if (current.trim()) chunks.push(current.trim()); current = ''; };
  for (const unit of units) {
    if (Array.from(current + unit).length <= maximum) {
      current += unit;
      if (Array.from(current).length >= target) flush();
      continue;
    }
    flush();
    let rest = unit.trim();
    while (Array.from(rest).length > maximum) {
      const characters = Array.from(rest);
      const window = characters.slice(0, maximum).join('');
      const boundary = Math.max(window.lastIndexOf('，'), window.lastIndexOf('、'), window.lastIndexOf('：'), window.lastIndexOf(','));
      const cut = boundary >= maximum * 0.4 ? Array.from(window.slice(0, boundary + 1)).length : maximum;
      chunks.push(characters.slice(0, cut).join('').trim());
      rest = characters.slice(cut).join('').trim();
    }
    current = rest;
  }
  flush();
  return chunks.filter(Boolean);
}

export function friendlyError(error) {
  const value = String(error?.message || error || '未知错误').slice(0, 1400);
  let summary = '自然语音加载或生成失败。';
  if (/memory|allocation|out of bounds/iu.test(value)) summary = '运行语音模型时出现内存错误。';
  else if (/fetch|network/iu.test(value)) summary = '下载语音资源失败，请检查网络连接。';
  else if (/backend|wasm|webgpu|instantiate|compile/iu.test(value)) summary = '语音运行组件初始化失败。';
  return `${summary} 错误详情：${value}`;
}
