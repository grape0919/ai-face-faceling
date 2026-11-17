import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// 저장소 안의 @redbridge/faceling-* 패키지는 빌드하지 않고 TS 원본을 그대로 쓴다(패키지 exports 의 faceling-source 조건)
const SOURCE = 'faceling-source';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  resolve: { conditions: [SOURCE, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [SOURCE, ...defaultServerConditions], externalConditions: [SOURCE] } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
