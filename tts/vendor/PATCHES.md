# EasySpeech provenance and local patches

- Project: https://github.com/leaonline/easy-speech
- Version: 2.4.0
- Pinned commit: ecc643ec6bfde4709d2b8cacef9313e426086920
- Original file: dist/EasySpeech.js (renamed to easy-speech.mjs for this site)
- License: MIT, reproduced in LICENSE.easy-speech.txt
- SHA-256 of the upstream file: ef04d107425af79967d8b671a1b5d20ddd35c2fca89b4ee8afa358fc7eecee64

Local changes:

1. Call speechSynthesis.speak synchronously instead of through the upstream
   10 ms timeout. This keeps the first utterance within the Play click's call
   stack, as required by Safari's user-activation restriction.
2. Hold a module-level reference to the active utterance, releasing it on end,
   error, and explicit cancellation, to avoid premature garbage collection.

No external JavaScript CDN or paid API is used. The voice and its license belong
to the device/browser provider; EasySpeech is an interface to the Web Speech API,
not an open-source acoustic model.
