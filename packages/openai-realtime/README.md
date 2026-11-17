# @redbridge/faceling-openai-realtime

Browser adapter that connects [Faceling](https://github.com/grape0919/ai-face-faceling/blob/main/README.md) to the OpenAI Realtime API over WebRTC. It turns Realtime events into `LiveDirector` calls, plays the AI's voice, and measures mouth shapes for lip sync.

```ts
import { LiveDirector, LiveFace, createRemoteJudge } from '@redbridge/faceling-core';
import { RealtimeConnection } from '@redbridge/faceling-openai-realtime';

const clock = () => performance.now() / 1000;
const face = new LiveFace();
const director = new LiveDirector(face, { judge: createRemoteJudge(), clock });
const connection = new RealtimeConnection(director, {
  onStatus: console.log,
  onCaption: (who, text, final) => final && console.log(who, text),
  onError: console.error,
});
await connection.connect({ greet: true }); // call from a user gesture
// Every frame: face.update(clock(), connection.mouth())
```

It fetches ephemeral keys from `/api/session` and `/api/transcription-session` (served by `@redbridge/faceling-server`). Change them with the third constructor argument: `{ sessionUrl, transcriptionSessionUrl, headers, greeting }`. Status messages are in Korean for now. MIT License.
