import { defaultClientConditions, defineConfig } from 'vite';

/**
 * 정적 페이지 빌드용 설정(npm run build:pages). 개발 서버(server.ts)는 이 파일을 읽지 않는다.
 * GitHub Pages 는 저장소 이름 아래 경로에서 열리므로 주소를 상대 경로로 만든다.
 */
export default defineConfig({
  base: './',
  // 저장소 안의 @redbridge/faceling-* 패키지는 빌드하지 않고 TS 원본을 그대로 쓴다
  resolve: { conditions: ['faceling-source', ...defaultClientConditions] },
  build: { outDir: 'dist', emptyOutDir: true },
});
