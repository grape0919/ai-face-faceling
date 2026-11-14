import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FetchHandler } from './handlers.js';

/** Node http 의 요청 처리기 모양. Express·Connect 미들웨어 자리에도 그대로 들어간다. */
export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface NodeHandlerOptions {
  /** 본문을 읽을 최대 크기(바이트). 넘으면 413. */
  maxBodyBytes?: number;
}

/** Express 의 express.json() 등이 본문을 이미 읽어 req.body 에 넣어 둔 경우 */
interface ParsedBodyRequest extends IncomingMessage {
  body?: unknown;
  originalUrl?: string;
}

async function readBody(req: ParsedBodyRequest, limit: number): Promise<string | null> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    return JSON.stringify(req.body);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > limit) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Request→Response 처리기를 Node 의 (req, res) 처리기로 바꾼다.
 *
 * ```ts
 * http.createServer(toNodeHandler(createFacelingHandler()))
 * app.use('/api', toNodeHandler(createFacelingHandler()))   // Express
 * ```
 */
export function toNodeHandler(handler: FetchHandler, options: NodeHandlerOptions = {}): NodeHandler {
  const limit = options.maxBodyBytes ?? 64_000;
  return async (req, res) => {
    const r = req as ParsedBodyRequest;
    try {
      const method = req.method ?? 'GET';
      const url = new URL(r.originalUrl ?? req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
      }
      let body: string | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const read = await readBody(r, limit);
        if (read === null) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '요청이 너무 큽니다' }));
          return;
        }
        body = read;
        // 본문을 문자열로 다시 넣으므로 원래 길이·인코딩 헤더는 맞지 않을 수 있다
        headers.delete('content-length');
        headers.delete('transfer-encoding');
      }

      const response = await handler(new Request(url, { method, headers, body }));
      const outHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => (outHeaders[name] = value));
      res.writeHead(response.status, outHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  };
}
