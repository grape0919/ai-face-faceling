# @redbridge/faceling-server

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
import { createFacelingHandler, toNodeHandler } from '@redbridge/faceling-server';

const api = toNodeHandler(createFacelingHandler({ session: { language: 'en' }, transcription: { language: 'en' } }));
createServer((req, res) => (req.url?.startsWith('/api/') ? void api(req, res) : res.writeHead(404).end())).listen(3000);
```

Keys come from the `apiKey` options or the `OPENAI_API_KEY` and `TYPESAFE_API_KEY` environment variables. `apiKey` may also be a function of the request, e.g. `(request) => request.headers.get('x-openai-key') ?? undefined`, to let each user bring their own key; when it returns nothing the environment variable is used. When there is no TypeSafe key, `createJudgeHandler` falls back to an OpenAI model (`openaiApiKey` option or `OPENAI_API_KEY`); it asks the same questions but is slower than Jev. **There is no authentication.** Add your own before exposing these routes. MIT License.
