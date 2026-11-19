import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/** 영어 공유 미리보기. 크롤러는 스크립트를 돌리지 않으므로 영어 OG 태그를 가진 페이지가 따로 있어야 한다. */
const EN_META: Record<string, string> = {
  description: 'Faceling — a face for your voice AI. Watch a voice AI change its expression in real time.',
  'og:title': 'Faceling — A face for your voice AI',
  'og:description': 'AI reads the conversation, picks the expression, and moves a face, robot or VRM model in real time. Open-source demo.',
  'og:url': 'https://grape0919.github.io/ai-face-faceling/en/',
  'og:image': 'https://grape0919.github.io/ai-face-faceling/og-en.png',
  'og:image:alt': 'The Faceling logo and a smiling face character',
  'og:locale': 'en_US',
};

/**
 * 빌드한 index.html 을 본떠 en/index.html 을 만든다. 같은 앱을 처음부터 영어로 띄우고, OG 태그만 영어로 바꾼다.
 * <base href="../"> 를 넣어 자산·녹음 파일 같은 상대 주소가 모두 한 단계 위(사이트 뿌리)를 가리키게 한다.
 */
function englishPage(): Plugin {
  let outDir = '';
  return {
    name: 'faceling-english-page',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      let html = readFileSync(join(outDir, 'index.html'), 'utf8')
        .replace('<html lang="ko">', '<html lang="en" data-lang="en">')
        .replace('<head>', '<head>\n    <base href="../" />');
      for (const [key, value] of Object.entries(EN_META)) {
        const attr = key.startsWith('og:') ? 'property' : 'name';
        const pattern = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
        if (!pattern.test(html)) throw new Error(`en/index.html: ${key} 태그가 index.html 에 없습니다`);
        html = html.replace(pattern, (_, a: string, b: string) => a + value.replace(/"/g, '&quot;') + b);
      }
      mkdirSync(join(outDir, 'en'), { recursive: true });
      writeFileSync(join(outDir, 'en', 'index.html'), html);
    },
  };
}

/**
 * 정적 페이지 빌드용 설정(npm run build:pages). 개발 서버(server.ts)는 이 파일을 읽지 않는다.
 * GitHub Pages 의 저장소 이름 아래 경로에서 열리므로 주소를 상대 경로로 만든다.
 */
export default defineConfig({
  base: './',
  // 저장소 안의 @redbridge/faceling-* 패키지는 빌드하지 않고 TS 원본을 그대로 쓴다
  resolve: { conditions: ['faceling-source', ...defaultClientConditions] },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [englishPage()],
});
