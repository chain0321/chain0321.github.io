# 中文自然朗读

把长篇中文粘贴到页面，点「准备自然语音并播放」。页面用开源 Kokoro 中文神经语音模型在浏览器内生成音频，并预缓冲后连续播放。

线上地址：<https://chain0321.github.io/tts/>

## 为什么改用神经语音

第一版通过 EasySpeech 调用浏览器的 `speechSynthesis`。用户在 iPhone 上实测后反馈声音机械、分段之间卡顿、缺少真人节奏。网页无法改变系统内置发声模型，因此 2.0 版改为浏览器本地神经语音：

- `@uzen/kokoro-js` 1.2.4，Apache-2.0；
- `onnx-community/Kokoro-82M-v1.1-zh-ONNX`，Apache-2.0；
- 固定一个中文女声 `zf_001`，舒缓语速 0.94；
- 参考完整句子合并短句，长句优先在中文逗号处分段；
- 音频预缓冲约 8 秒，使用 Web Audio 提前排期，段与段连续播放；
- iOS 26 Safari 优先使用 WebGPU，失败时降级到 WASM。

## 使用

1. 推荐使用 iOS 26 的 Safari，并连接 Wi-Fi。
2. 粘贴文字，点「准备自然语音并播放」。
3. 首次使用会下载约 170MB 模型；以后由浏览器缓存。
4. 等待模型加载和开头约 8 秒的音频缓冲，随后边生成边播放。

模型运行需要较多内存。若 iPhone 提示内存不足，关闭其他 Safari 标签页再重试。朗读期间保持页面打开；锁屏或切到后台仍可能暂停。

## 隐私和费用

无账号、广告、分析脚本、API key、后台服务或应用内收费。文字和合成音频在浏览器内处理。首次加载会从 jsDelivr 下载开源 JavaScript、从 Hugging Face 下载开源模型和音色；这些服务会像普通网站一样接收网络请求，但页面不会把粘贴的文本发送给它们。

## 开发与验证

站点是纯静态文件，不需要构建。运行纯逻辑测试：

```sh
npm test
```

当前自动检查覆盖 13 项：自然分段的逐字还原、标点合并、无标点长文、Unicode 字符，以及第一版兼容逻辑的长文、暂停、超时和竞态行为。`app.mjs`、`natural-player.mjs` 和 `neural-worker.mjs` 也通过 Node.js 语法检查。

自动测试无法评价音色的自然度，也无法模拟 iPhone 的 WebGPU 性能；这两项需要在实际设备上试听。

## 开源来源

- [uzen-zone/kokoro-js](https://github.com/uzen-zone/kokoro-js)，版本 1.2.4，Apache-2.0。
- [Kokoro-82M-v1.1-zh-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX)，Apache-2.0。
- 第一版保留的 [EasySpeech](https://github.com/leaonline/easy-speech) 2.4.0 代码和 MIT 许可仍在 `vendor/`，2.0 页面不再加载它。

本目录中新写的界面、播放队列和控制逻辑采用 MIT 许可，见 [LICENSE](./LICENSE)。
