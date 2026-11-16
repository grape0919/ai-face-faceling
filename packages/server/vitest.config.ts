import { defineConfig } from 'vitest/config';

// 저장소 안의 @faceling/core 는 빌드된 dist 가 아니라 TS 원본으로 시험한다
export default defineConfig({
  resolve: { conditions: ['faceling-source'] },
  ssr: { resolve: { conditions: ['faceling-source'] } },
});
