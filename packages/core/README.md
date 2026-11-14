# @faceling/core

The Faceling expression engine. It reads the **text** of a voice-AI conversation, has a judgment model pick an action for each part of the face, times each expression to the moment its words are heard, and outputs ARKit 52 blendshape values every frame. No runtime dependencies.

```ts
import { LiveDirector, LiveFace, createRemoteJudge } from '@faceling/core';

const clock = () => performance.now() / 1000;
const face = new LiveFace();
const director = new LiveDirector(face, { judge: createRemoteJudge(), clock });

// Feed conversation events: director.assistantText(delta), director.assistantAudioStarted(), ...
// Every frame: const { shapes, head, gaze } = face.update(clock(), mouth);
```

- `createRemoteJudge({ url })` asks your server (see `@faceling/server`) for each judgment, so the analyzer key never reaches the browser.
- `createJevAnalyzer({ apiKey })` calls the Jev judgment model directly. Server-side only.
- `MouthAnalyser` (browser only) lives at `@faceling/core/lipsync`.

See the [Faceling README](../../README.md#add-it-to-your-app) for a full server and browser example and the list of events. MIT License.
