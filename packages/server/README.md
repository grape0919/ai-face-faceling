# @faceling/server

Server-side handlers for [Faceling](https://github.com/grape0919/ai-face-faceling/blob/main/README.md). They keep your OpenAI and Jev keys on the server and give the browser only what it needs.

| Handler | Route it expects | Does |
|---|---|---|
| `createJudgeHandler()` | `POST …/judge` | Asks the analyzer (Jev by default) to judge one clause. Returns `{ judgment, ms }` |
| `createSessionHandler()` | `POST …/session` | Issues an OpenAI Realtime ephemeral key. Returns `{ value, expires_at, model, voice }` |
| `createTranscriptionSessionHandler()` | `POST …/transcription-session` | Issues an ephemeral key for live transcription while the user speaks. Returns `{ value, model }` |
| `createFacelingHandler()` | all three | Routes by the last path segment |

Every handler is a standard `(request: Request) => Promise<Response>`. Wrap it with `toNodeHandler()` for Node `http` or Express.

```ts
import { createServer } from 'node:http';
import { createFacelingHandler, toNodeHandler } from '@faceling/server';

const api = toNodeHandler(createFacelingHandler({ session: { language: 'en' }, transcription: { language: 'en' } }));
createServer((req, res) => (req.url?.startsWith('/api/') ? void api(req, res) : res.writeHead(404).end())).listen(3000);
```

Keys come from the `apiKey` options or the `OPENAI_API_KEY` and `TYPESAFE_API_KEY` environment variables. **There is no authentication.** Add your own before exposing these routes. MIT License.
