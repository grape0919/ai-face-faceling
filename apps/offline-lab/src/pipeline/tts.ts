import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Speaker } from '../shared/types';

const run = promisify(execFile);

// 인자는 환경 변수로 넘긴다. 본문은 인코딩 문제를 피하려고 UTF-8 파일로 넘긴다.
const SAPI_SCRIPT = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($env:FACELING_VOICE)
$synth.SetOutputToWaveFile($env:FACELING_OUT)
$ssml = [System.IO.File]::ReadAllText($env:FACELING_SSML, [System.Text.Encoding]::UTF8)
$synth.SpeakSsml($ssml)
$synth.Dispose()
`;

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Windows 내장 음성 합성으로 턴 음성을 만든다. 전체 경로 시험용이다.
 * 실험에는 실제 대화 녹음이나 실제 서비스의 음성을 audio/ 폴더에 넣어 쓴다.
 * 두 화자를 구분하려고 사용자 쪽은 음높이와 음색을 낮춘다.
 */
export async function synthesizeWithSapi(text: string, speaker: Speaker, outFile: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('sapi 음성 합성은 Windows 에서만 됩니다. audio/ 폴더에 WAV 를 직접 넣어 주세요.');
  }
  const userVoice = process.env.FACELING_SAPI_USER_VOICE;
  const voice = (speaker === 'user' && userVoice) || process.env.FACELING_SAPI_VOICE || 'Microsoft Heami Desktop';
  // 한국어 내장 음성이 하나뿐인 PC 가 많다. 사용자 쪽은 같은 음성을 빠르게 합성한 뒤 느리게 재생되도록 바꿔서
  // 음높이와 음색을 함께 낮춘다. FACELING_SAPI_USER_VOICE 로 다른 음성을 지정하면 그것을 그대로 쓴다.
  const deepen = speaker === 'user' && !userVoice;
  const prosody = deepen ? `rate="+${Math.round((1 / USER_DEEPEN - 1) * 100)}%"` : 'rate="+0%"';
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">` +
    `<prosody ${prosody}>${escapeXml(text)}</prosody></speak>`;

  const dir = await mkdtemp(path.join(os.tmpdir(), 'faceling-tts-'));
  const ssmlFile = path.join(dir, 'in.ssml');
  try {
    await writeFile(ssmlFile, ssml, 'utf8');
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', SAPI_SCRIPT], {
      env: { ...process.env, FACELING_VOICE: voice, FACELING_OUT: outFile, FACELING_SSML: ssmlFile },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  if (deepen) await slowDown(outFile, USER_DEEPEN);
}

/** 사용자 음성의 재생 속도 배율. 1보다 작을수록 낮고 굵은 목소리가 된다. */
const USER_DEEPEN = 0.8;

/** WAV 의 표본화 주파수 표기를 낮춰 느리고 낮게 재생되게 한다. 표본 자체는 건드리지 않는다. */
async function slowDown(file: string, factor: number): Promise<void> {
  const buf = await readFile(file);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      const body = offset + 8;
      const blockAlign = buf.readUInt16LE(body + 12);
      const rate = Math.round(buf.readUInt32LE(body + 4) * factor);
      buf.writeUInt32LE(rate, body + 4);
      buf.writeUInt32LE(rate * blockAlign, body + 8);
      await writeFile(file, buf);
      return;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`WAV 헤더를 찾지 못했습니다: ${file}`);
}
