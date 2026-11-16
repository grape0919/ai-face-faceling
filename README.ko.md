# Faceling

[English](README.md) · **한국어**

**내 AI의 얼굴.** 음성으로 대화하는 AI에게 얼굴을 붙이고, 그 표정을 실시간으로 본다.

> 목소리가 아니라, 말의 뜻으로 짓는 표정.

Faceling 은 AI 가 하는 말과 사용자가 하는 말의 **텍스트**를 보고 얼굴 부위별 동작을 정해, ARKit 52 blendshape 값으로 내보내는 표정 엔진이다. 그리는 쪽은 그 값을 받아 로봇이든 강아지든 원하는 얼굴을 움직이면 된다. 로고와 같은 모양의 기본 얼굴(페이스링)도 들어 있다.

## 무엇을 하나

- **말하는 표정.** AI 응답의 텍스트가 조금씩 도착하는 대로 절 단위로 끊어 판단하고, 그 절이 소리로 나오는 시각에 맞춰 표정을 건다.
- **듣는 반응.** 사용자가 말하는 도중에도 들리는 대로 반응한다. 따라 하는 표정이 아니라 듣는 사람의 표정이다.
- **맥락 반영.** 같은 "그랬군요."도 앞말이 좋은 소식이면 미소, 슬픈 소식이면 걱정하는 얼굴이 된다.
- **부위별 판단.** 눈썹, 눈, 시선, 볼·코, 입, 머리 6곳에 대해 판단 모델이 동작을 직접 고른다. 평범한 말에는 얼굴이 쉰다.
- **얼굴은 자유.** 출력이 ARKit 52 값이라 어떤 렌더러에도 붙는다. 코드로 그린 얼굴 세 가지(로고 모양의 페이스링, 로봇, 강아지)가 들어 있고, VRM 모델도 쓸 수 있다.
- **얼굴이 아니어도.** ARKit 값 아래에는 몸과 상관없는 표현 프레임이 있다. 얼굴 없는 작업대 로봇팔이 함께 들어 있어, 똑같은 판단으로 미안할 땐 축 처지고, 기쁠 땐 번쩍 들리고, 놀라면 움찔하고, 갸우뚱할 땐 손목을 기울인다.
- **가볍다.** 서버에서 영상을 만들지 않는다. 표정 판단은 절마다 0.2~0.3초짜리 API 호출 한 번이다.

## 움직이는 모습 보기

**[데모 열기](https://grape0919.github.io/ai-face-faceling/)** — 설치도 키도 필요 없다. 실제 판단 모델에서 받아 둔 표정 판단으로 예시 대화를 재생해, 같은 대화에 얼굴과 강아지, 얼굴 없는 로봇팔이 어떻게 반응하는지 볼 수 있다. 재생에는 소리가 없고, 그 페이지에서 한 일은 서버로 가지 않는다.

그 페이지에서 바로 말을 걸어 보려면 "API 키"에 내 OpenAI 키를 넣는다. 페이지에는 서버가 없어서 브라우저가 내 키로 OpenAI 에 직접 붙고, 표정 판단도 OpenAI 모델이 한다(Jev 는 브라우저에서 부를 수 없다). Jev 보다 느리므로 제대로 보려면 아래대로 내 PC 에서 실행한다.

## 바로 해 보기

Node.js 22 이상이 필요하다.

```bash
npm install
```

루트의 `.env.example` 을 `.env` 로 복사해 키를 넣는다.

| 키 | 용도 |
|---|---|
| `TYPESAFE_API_KEY` | 표정 판단([Jev](https://docs.typesafe.ai/introduction)). 없으면 `OPENAI_API_KEY` 로 OpenAI 모델이 대신 판단한다(느리다: 절 하나에 약 1.1초, Jev 는 0.2~0.3초) |
| `OPENAI_API_KEY` | 음성 대화(OpenAI Realtime API). 없으면 소리 없는 모의 대화만 된다 |

`.env` 대신 데모 화면의 "API 키"에 내 키를 넣어도 된다. 키는 브라우저에만 저장되고 내 PC 의 서버로만 보내진다.

```bash
npm run rt:dev
```

http://localhost:5174 를 열면 얼굴과 목소리를 고르는 안내가 나오고, 마지막에 "마이크 허용하고 대화 시작"을 누른다. 화면은 한국어와 영어로 볼 수 있다(오른쪽 위의 언어 버튼, 또는 주소에 `?lang=en`). 자세한 내용은 [실시간 예제](apps/realtime/README.md)에 있다.

얼굴은 안내 화면이나 대화 화면의 "캐릭터 변경"에서 고른다. 페이스링(기본), 로봇, 강아지, 로봇팔(얼굴 없음), 3D 모델이 있다. 3D 는 pixiv 의 예제 모델 [VRM1_Constraint_Twist_Sample](https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/models)(© 2022 pixiv Inc., [VRM Public License 1.0](https://vrm.dev/licenses/1.0/))을 실행 중에 인터넷에서 불러오며, 이 저장소에는 들어 있지 않다. 이 모델은 VRM 표준 표정(기쁨, 슬픔, 놀람 등)만 가지고 있어 로봇·강아지보다 표정이 단순하게 보인다. ARKit 표정을 가진 VRM 을 개발자 패널(`` ` `` 키) → "내 VRM 불러오기"로 넣으면 모든 표정이 반영된다.

## 내 앱에 붙이기

Faceling 은 패키지 네 개로 나뉘어 있다. 필요한 것만 쓰면 된다.

| 패키지 | 도는 곳 | 하는 일 |
|---|---|---|
| [`@faceling/core`](packages/core) | 어디서나 | 표정 엔진. `LiveDirector`(대화 사건을 받아 절마다 판단하고 표정을 예약)와 `LiveFace`(부를 때마다 ARKit 52 값 한 장). 의존성 없음 |
| [`@faceling/server`](packages/server) | Node 20 이상 | 키를 서버에만 두는 요청 처리기. Jev 판단 중계, OpenAI Realtime 임시 키 발급 |
| [`@faceling/openai-realtime`](packages/openai-realtime) | 브라우저 | OpenAI Realtime API 에 WebRTC 로 붙어 사건을 엔진에 넘기는 어댑터 |
| [`@faceling/rigs`](packages/rigs) | 브라우저 | 바로 쓸 수 있는 three.js 캐릭터. 페이스링, 로봇, 강아지, 얼굴 없는 로봇팔, VRM 연결. `three` 는 peer 의존성 |

```bash
npm install @faceling/core @faceling/server @faceling/openai-realtime @faceling/rigs three
```

> 아직 npm 에 올리지 않았다. 그전까지는 이 저장소에서 `npm run build` 로 빌드하고 `npm pack -w @faceling/core -w @faceling/server -w @faceling/openai-realtime -w @faceling/rigs` 로 만든 `.tgz` 파일을 설치한다.

### 서버

키는 여기에만 둔다. 환경 변수 `OPENAI_API_KEY`, `TYPESAFE_API_KEY` 를 쓰거나 `apiKey` 옵션으로 넘긴다.

```ts
// server.ts (Node 20 이상)
import { createServer } from 'node:http';
import { createFacelingHandler, toNodeHandler } from '@faceling/server';

// POST /api/session, /api/transcription-session, /api/judge 를 받는다
const api = toNodeHandler(
  createFacelingHandler({
    session: {
      instructions: '당신은 다정하고 표정이 풍부한 대화 상대입니다. 두세 문장으로 짧게 답하세요.',
      language: 'ko',
    },
    transcription: { language: 'ko' },
  }),
);

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) return void api(req, res);
  res.writeHead(404).end(); // 내 웹 앱은 여기서 내준다
}).listen(3000);
```

처리기는 평범한 `Request → Response` 함수라서 다른 프레임워크에도 그대로 들어간다. Express 에서는 `app.use('/api', toNodeHandler(createFacelingHandler()))`, Next.js 에서는 `app/api/[route]/route.ts` 에 `export const POST = createFacelingHandler()`. 하나씩 걸려면 `createJudgeHandler()`, `createSessionHandler()`, `createTranscriptionSessionHandler()` 를 쓴다. **인증이 들어 있지 않다.** 외부에 열기 전에 로그인과 요청 제한을 앞에 넣어야 한다. 그대로 열면 누구나 내 키로 호출할 수 있다.

### 브라우저

```ts
import { LiveDirector, LiveFace, createRemoteJudge } from '@faceling/core';
import { RealtimeConnection } from '@faceling/openai-realtime';
import { FacelingRig } from '@faceling/rigs';
import * as THREE from 'three';

// 엔진: 절마다 내 서버(/api/judge)에 판단을 묻고, 소리에 맞춰 표정을 건다
const clock = () => performance.now() / 1000;
const face = new LiveFace();
const director = new LiveDirector(face, { judge: createRemoteJudge(), clock });

// 어댑터: /api/session 의 임시 키로 OpenAI Realtime 에 WebRTC 로 붙는다
const connection = new RealtimeConnection(director, {
  onStatus: (text) => console.log(text),
  onCaption: (who, text, final) => final && console.log(`${who}: ${text}`),
  onError: (message) => console.error(message),
});
document.querySelector('#start')!.addEventListener('click', () => connection.connect({ greet: true }));

// 얼굴: ARKit 52 값을 받는 렌더러면 무엇이든 된다. 여기서는 기본 얼굴(페이스링).
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas')!, antialias: true });
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 1.3), new THREE.DirectionalLight(0xffffff, 2.2));
const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
camera.position.set(0, 1.45, 1.35);
camera.lookAt(0, 1.45, 0);
const rig = new FacelingRig();
scene.add(rig.object);

renderer.setAnimationLoop(() => {
  rig.apply(face.update(clock(), connection.mouth())); // 한 장: ARKit 52 + 머리 + 시선
  renderer.render(scene, camera);
});
```

서버 주소가 다르면 넘겨 준다. `createRemoteJudge({ url })`, `new RealtimeConnection(director, callbacks, { sessionUrl, transcriptionSessionUrl, headers })`. AI 가 먼저 인사할 때 받는 지시는 `greeting` 옵션으로 바꾼다.

기본 얼굴 대신 내 얼굴을 움직이려면 프레임을 직접 읽는다. `face.update(now, mouth)` 는 `{ shapes, head, gaze }` 를 돌려준다. `shapes` 는 ARKit 52 blendshape 이름별 0~1 값, `head` 는 라디안 단위의 `pitch`, `yaw`, `roll`, `gaze` 는 -1~1 의 `x`, `y` 다. VRM 모델은 `@pixiv/three-vrm` 으로 불러와 `@faceling/rigs` 의 `VrmRig` 에 넣는다.

### 얼굴이 아닌 몸

입력과 판단은 무엇이 보여 주든 상관이 없다. 마지막 단계만 다르다. 그래서 프레임마다 출력이 두 가지다.

![엔진 하나, 몸은 무엇이든](docs/images/bodies.ko.svg)

`face.update()` 는 ARKit 값과 **함께** 그 바탕이 된 몸과 상관없는 표현 `expression` 을 돌려준다.

| 값 | 뜻 |
|---|---|
| `weights` | 판단한 동작마다 지금 세기 0~1. 키는 `"부위.동작"` (한쪽 동작은 `"@L"`/`"@R"`). 이름은 얼굴 부위지만 감정으로 읽으면 된다. `brows.inner_up` 은 안쓰러움, `head.tilt` 는 갸웃, `mouth.grin` 은 신남 |
| `turn` | AI 가 쉬는지(`idle`), 듣는지(`listening`), 생각하는지(`thinking`), 말하는지(`speaking`). 부드럽게 섞인 값 |
| `gesture` | 지금 순간 동작. `nod`, `shake` (라디안), `flash` (눈썹을 번쩍 올리는 세기) |
| `mouth` | 말하는 동안의 립싱크 세기(`jaw`, `funnel`, `stretch`). 말하지 않으면 0 |
| `blink`, `energy`, `t` | 깜빡임, 지금 가장 강한 동작의 세기, 시각 |

들어 있는 `ArmRig` 가 그 예다. ARKit 값은 전혀 보지 않고 `expression` 을 어깨, 팔꿈치, 손목, 집게 각도로 옮긴다.

```ts
import { ArmRig } from '@faceling/rigs';

const arm = new ArmRig();
scene.add(arm.object);
renderer.setAnimationLoop(() => {
  arm.apply(face.update(clock(), connection.mouth())); // frame.expression 을 읽는다
  renderer.render(scene, camera);
});
```

내 몸을 움직이려면 `frame.expression` 을 같은 식으로 읽는다. 옮기기 편하도록 `@faceling/core` 의 `bodyFeelings(expression)` 가 동작들을 몇 가지 느낌(`happy`, `excited`, `sad`, `surprised`, `tense`, `tilt`, `lookAside`, `lookUp`, `lookDown`, `playful`)으로 묶어 준다. 계수는 초안이다.

`@faceling/rigs` 의 리그는 모두 같은 형태 `Rig` 다: `body` (할 수 있는 것), `object` (장면에 넣을 물체), `view` (카메라를 둘 곳), `apply(frame)`, 그리고 있으면 `update(dt)`. 예제는 얼굴, 로봇팔, VRM 모델을 이 형태 하나로 다루고, 몸의 종류에 따른 분기가 없다. 내 몸도 이 형태로 만들면 그대로 끼워 넣을 수 있다.

#### 부탁한 동작 하기

"윙크해 봐", "팔을 오른쪽으로 움직여 봐" 같은 부탁에 도구 호출은 필요 없다. 판단 모델은 원래 말을 보고 부위마다 할 일을 고르므로, 일부러 하는 동작도 선택지 하나일 뿐이다. AI 가 "좋아요, 찡긋!"이나 "네, 오른쪽으로 쭉!"이라고 답하면 같은 구절 판단이 `eyes.wink` 나 `arm.right` 를 고르고, 그 구절이 들리는 순간에 동작이 나온다. "윙크는 못 해요", "오른쪽은 밥 먹는 손 쪽이에요"처럼 동작을 말하기만 하는 문장에는 움직이지 않는다.

- **의도는 하나, 몸은 무엇이든.** 일부러 하는 움직임은 몸과 상관없는 의도로, 부위 `move` 하나에 있다: `up`, `down`, `left`, `right`, `forward`, `wave`, `home`. 판단은 `move.left` 라고만 하고, 얼굴은 고개를 왼쪽으로 돌리고 로봇팔은 팔을 왼쪽으로 뻗는다. 로봇팔에게 "고개 들어 봐"라고 해도 팔을 든다. 왼쪽과 오른쪽은 보는 사람 기준이다.
- **감정보다 엄격하게.** 일부러 하는 동작은 확률 50 % 를 넘어야 시작하고 85 % 에서 온전히 하며, 표정 세기와는 상관없다. 윙크도 50 % 를 넘어야 하고 한 응답에 한 번만 한다. 윙크한 것을 설명하는 뒷말에 또 하지 않는다.
- **자세는 남는다.** 부탁받은 고개나 팔 자세는 말이 끝난 뒤에도 5초 동안 유지되고, 다른 동작이 오거나 AI 가 제자리로 돌아간다고 하면(`home`) 그때 바뀐다. 그렇지 않으면 한마디 답에 나갔다가 바로 돌아온다.
- **몸이 할 수 있는 것을 스스로 선언한다.** 몸 명세 `BodySpec` (`@faceling/core/body`)에 몸의 이름, 한 문장 설명, 할 수 있는 움직임과 그 몸에서의 뜻을 적는다. 다른 동작의 설명도 바꿀 수 있다(로봇팔은 눈이 없으므로 `eyes.wink` 를 "손목의 불빛이 깜빡인다"로 묻는다). 엔진은 몸의 종류를 모른다. 명세로 질문을 만들고, 적힌 움직임만, AI 가 말하는 구간에만 묻는다. `@faceling/rigs` 에 `FACE_BODY` 와 `ARM_BODY` 가 들어 있고, 리그마다 `rig.body` 로 자기 명세를 내놓는다. 연결은 두 곳이다: 브라우저에서 `director.body = rig.body`, 서버에서 `createJudgeHandler({ bodies: [FACE_BODY, ARM_BODY] })` (브라우저는 몸의 이름만 보낸다). 새 몸은 명세 하나와, `move.*` 와 감정을 자기 관절로 옮기는 리그 하나면 된다. 엔진은 고치지 않는다.
- **AI 가 자기 몸을 알아야 한다.** 모르면 "저는 움직일 수 없어요"라고 답한다. `createSessionHandler({ characters: { [ARM_BODY.name]: '…' } })` 는 브라우저가 보낸 `character` (`connect({ character: rig.body.name })`)에 맞는 몸 설명을, 대화하는 언어로, 지시 뒤에 붙인다. 예제는 로봇팔에게 할 수 있는 동작과 "한마디로 해 보이기"를 알려 주고, 얼굴 캐릭터에게는 고개는 움직일 수 있지만 팔은 없다고 알려 준다.

#### 부위별 수치 판단 (실험)

선택지에서 동작을 고르는 대신, 몸이 움직일 수 있는 부위마다 **얼마나**, **얼마 동안** 움직일지를 판단 모델에게 직접 물을 수 있다. 몸은 부위를 이름과 설명 한 줄로 적기만 하면 된다.

```ts
export const DOG_BODY: BodySpec = {
  ...FACE_BODY,
  name: 'dog',
  describe: 'a dog face with two big floppy ears. …',
  channels: [
    ...FACE_CHANNELS, // ARKit 표정 근육 44개, 시선 4개, 머리 7개
    { name: 'earsUp', describe: 'the ears perk up', opposite: 'earsDown' },
    { name: 'earsDown', describe: 'the ears droop down or flatten back' },
  ],
};
```

![부위별 수치 판단](docs/images/channels.ko.svg)

부위를 넣고 빼는 것은 한 줄이다. 엔진은 채널이 무엇인지 모른다. 채널마다 묻고, 답을 정리해서 프레임에 실어 넘긴다(`frame.expression.channels`, 그리고 ARKit 이름을 읽는 리그를 위해 `frame.shapes`). 그 부위를 가진 리그가 읽어 움직인다. 감정, 부탁받은 동작("귀 움직여 봐"), 유지 시간이 모두 같은 판단에서 나오고, 동작 목록을 따로 관리하지 않는다.

| 채널마다 | 답 |
|---|---|
| 얼마나 | 0~1. 반대 채널끼리는 빼고, 바닥 아래는 버리고, 나머지를 0~1 로 다시 편다 |
| 얼마 동안 | `instant` 순간(윙크, 끄덕임), `brief` 잠깐(1~2초), `line` 말하는 동안(감정), `stay` 머무름(말이 끝난 뒤 몇 초), `until_told` 시킬 때까지 |

절마다 질문 하나를 더 해서 AI 가 쉬는 자세로 돌아가는 중인지 묻고, 그렇다면 붙잡아 둔 자세를 푼다.

`director.mode = 'channels'` 로 켠다(예제에서는 개발자 패널의 "부위별 수치로 판단", 또는 주소에 `?mode=channels`). `channels` 가 없는 몸은 선택지 판단을 그대로 쓴다. 쓰기 전에 알아 둘 것:

- **질문이 훨씬 많다.** 얼굴은 채널이 55개라, 말하는 절 하나에 질문이 7개에서 약 110개로 늘어난다. 응답은 0.22초에서 0.4초쯤으로 늘었다. 판단 모델의 요금이 질문 수에 따른다면 비용을 확인할 것.
- **짧은 답은 늦게 걸린다.** 한마디 답은 절반쯤 말한 뒤에야 판단이 도착할 수 있다.
- **표정이 덜 세밀하다.** 한쪽 미소처럼 이름 붙은 동작은 손으로 맞춘 모양인데, 여기서는 모델이 근육을 직접 조합한다. 또렷한 감정에서는 세기가 비슷했지만, 조합된 얼굴은 숫자로만 확인했고 눈으로는 보지 못했다.
- **좌우는 거의 같게 나온다.** 글에는 어느 쪽인지가 없다. 윙크는 왼쪽 눈이라고 채널 설명에 적어 두었다.
- 한국어 문장 스무 개쯤으로 본 결과다. 기준값(`CHANNEL_FLOOR`, `CHANNEL_FULL`)과 채널별 바닥은 초안이다.

### 다른 음성 대화 서비스

`@faceling/openai-realtime` 은 어댑터일 뿐이다. 다른 음성 대화 서비스에 붙이려면, 그 서비스의 사건이 올 때 `LiveDirector` 의 아래 메서드를 부르는 어댑터를 쓰면 된다. 이것이 전부다.

| 메서드 | 언제 부르나 |
|---|---|
| `assistantStarted()` | AI 응답이 만들어지기 시작 |
| `assistantText(delta)` | 응답 텍스트 조각 도착 |
| `assistantTextDone()` | 응답 텍스트 끝 |
| `assistantAudioStarted()` | AI 음성이 실제로 재생되기 시작 |
| `assistantAudioStopped()` | AI 음성 재생 끝 |
| `assistantInterrupted()` | 사용자가 끼어들어 음성이 끊김 |
| `userSpeechStarted()` / `userSpeechStopped()` | 사용자 말 시작·끝 |
| `userPartial(text)` | 말하는 도중에 들린 글자(이번 발화의 처음부터 지금까지). 없어도 된다 |
| `userTranscript(text)` | 사용자 말의 최종 전사 도착 |

입 모양은 `face.update()` 의 두 번째 인자로 넣는다. `@faceling/core/lipsync` 의 `MouthAnalyser` 가 Web Audio `AnalyserNode` 에서 읽어 준다. 소리가 없으면 `null` 을 넣는다.

## 구성

| 폴더 | 내용 |
|---|---|
| [`packages/core`](packages/core) | 표정 엔진. 부위 정의, 판단 모델에 던지는 질문, 동작 → ARKit 52 대응, 레이어 합성, 실시간 예약 |
| [`packages/rigs`](packages/rigs) | 페이스링·로봇·강아지 얼굴, 얼굴 없는 로봇팔, VRM 연결(three.js) |
| [`packages/openai-realtime`](packages/openai-realtime) | OpenAI Realtime API 브라우저 어댑터 |
| [`packages/server`](packages/server) | Node 처리기. Jev 중계, 임시 키 발급 |
| [`apps/realtime`](apps/realtime) | 위 패키지로 만든 실시간 예제 |
| [`apps/offline-lab`](apps/offline-lab) | 녹음된 대화로 표정을 미리 만들어 돌려 보는 실험 도구. 표정 대응을 다듬을 때 쓴다 |

## 동작 방식

바깥에서 안쪽으로, 그림 다섯 장이다.

| # | 그림 | 무엇을 보여 주나 |
|---|---|---|
| 1 | [전체 구조](#전체-구조) | 어느 서비스가 어디와 통하고, 키는 어디에 있는가 |
| 2 | [표정 판단](#표정-판단) | 글이 어떻게 부위별 판단이 되는가 |
| 3 | [시각 맞추기와 합성](#시각-맞추기와-합성) | 판단이 어떻게 그 순간에 맞춰 프레임 한 장이 되는가 |
| 4 | [엔진 하나, 몸은 무엇이든](#엔진-하나-몸은-무엇이든) | 얼굴, 귀 달린 강아지, 얼굴 없는 팔이 어떻게 엔진 하나를 쓰는가 |
| 5 | [부위별 수치 판단](#부위별-수치-판단) | 부위마다 세기와 유지 시간을 받는 실험 방식 |

코드도 같은 층으로 나뉜다.

| 층 | 위치 | 아는 것 |
|---|---|---|
| 음성 어댑터 | `packages/openai-realtime` | 음성 대화 서비스의 사건. 얼굴은 모른다 |
| 엔진 | `packages/core` | 절, 시각, 판단 질문, 프레임. 어떤 몸인지는 모른다 |
| 몸 명세 | `packages/rigs/src/bodies.ts` | 그 몸이 무엇이고 무엇을 할 수 있는지. 데이터일 뿐이다 |
| 리그 | `packages/rigs/src/*.ts` | 프레임을 받아 그 몸을 그리는 방법 |
| 서버 | `packages/server` | 키, 그리고 이름으로 찾는 몸 명세 |

### 전체 구조

![전체 구조](docs/images/architecture.ko.svg)

브라우저가 OpenAI 에 **직접** 붙는다. 서버는 진짜 키를 숨긴 채 몇 분짜리 임시 키만 내주고, Jev 호출만 대신한다. 음성은 서버를 거치지 않는다. 마이크 소리는 두 곳으로 간다. 하나는 대화 상대(OpenAI Realtime)이고, 다른 하나는 사용자가 말하는 도중에 글자를 받기 위한 전사 연결이다.

### 표정 판단

![표정 판단 흐름](docs/images/judgment.ko.svg)

**무엇을 할지는 판단 모델이 고르고, 코드는 고르지 않는다.** 판단 모델에는 부위마다 "이 말을 하는(또는 듣는) 동안 눈썹은 무엇을 해야 하나"를 선택지와 함께 묻고, 선택지별 확률을 그대로 받는다.

- AI 가 말할 때와 사용자 말을 들을 때는 질문 문구와 선택지 설명이 따로다. 그래서 힘든 이야기를 들을 때 따라서 울상이 되지 않고, 안쓰러워하는 얼굴이 나온다.
- 구절 하나만 보내지 않는다. 앞 대화와 바로 뒤에 이어질 말을 함께 넘긴다. 같은 "정말요?"도 뒤에 "강아지가 아프다니…"가 오면 걱정하며 놀라는 얼굴, "와, 축하드려요!"가 오면 기뻐하며 놀라는 얼굴이 된다.
- 4글자 이하의 짧은 구절은 뒷말을 들어야 뜻이 정해지므로, 뒷말이 12글자쯤 도착할 때까지 판단을 미룬다.

### 시각 맞추기와 합성

![표정 시각 맞추기와 레이어 합성](docs/images/timing.ko.svg)

AI 응답의 글은 소리보다 1~2초 먼저 도착하므로, 대부분의 구절은 소리가 나기 전에 판단이 끝나 정확히 그 소리에 맞춰 표정이 걸린다. 늦기 쉬운 응답의 첫 구절은 앞머리 몇 글자만 보고 먼저 판단해 두고, 사용자가 방금 말했다면 그때의 듣는 반응을 이어 둔다. 사용자가 말을 끊으면 예약된 표정을 모두 거둔다.

같은 표정이라도 부위마다 따라오는 속도가 다르다. 눈썹과 눈은 빠르게 반응하고, 입꼬리와 볼은 늦게 생겨 오래 남는다. 소리는 입 모양(립싱크)에만 쓰고, 감정은 글에서만 읽는다.

다른 음성 대화 서비스에 붙이려면 그 서비스의 사건을 엔진에 넘기는 어댑터만 쓰면 된다. 엔진이 받는 사건은 [다른 음성 대화 서비스](#다른-음성-대화-서비스)에 정리되어 있다.

### 엔진 하나, 몸은 무엇이든

![엔진 하나, 몸은 무엇이든](docs/images/bodies.ko.svg)

엔진은 자기가 어떤 몸을 움직이는지 모른다. 리그마다 **몸 명세**를 선언한다: 이름, 그 몸을 설명하는 한 문장, 일부러 할 수 있는 움직임, 그리고 필요하면 움직일 수 있는 부위 전부의 목록. 명세는 두 가지 일을 한다. 엔진이 이것으로 판단 질문을 만들고, 서버가 이 이름으로 대화 AI 에게 자기 몸을 알려 준다. 그래야 AI 가 "저는 움직일 수 없어요" 대신 "네, 오른쪽으로 쭉!"이라고 답한다.

판단은 몸과 상관없는 이름으로 돌아와 **표현 프레임** 한 장에 실린다. 리그마다 그 프레임을 자기 움직임으로 옮긴다. 얼굴은 ARKit 52 값과 머리 각도를 읽고, 강아지는 거기에 귀를 더 읽고, 로봇팔은 감정과 움직임을 관절 각도로 읽는다. 자세한 내용과 코드는 [얼굴이 아닌 몸](#얼굴이-아닌-몸)에 있다.

### 부위별 수치 판단

![부위별 수치 판단](docs/images/channels.ko.svg)

기본 판단은 부위마다 선택지에서 동작 하나를 고른다. 실험 방식은 그 대신 몸이 적어 둔 부위마다 얼마나, 얼마 동안 움직일지를 묻는다. 답을 정리한 뒤 유지 시간대로 재생하므로, 윙크는 한 번 치고 빠지고, 감정은 그 말과 함께 사라지고, 부탁받은 자세는 남는다. 자세한 내용과 수치, 주의할 점은 [부위별 수치 판단 (실험)](#부위별-수치-판단-실험)에 있다.

| | 선택지 (기본) | 부위별 수치 (실험) |
|---|---|---|
| 부위 추가 | 엔진의 선택지 목록을 고친다 | 몸 명세에 한 줄 |
| 부탁받은 동작 | 선택지를 미리 만들어야 한다 | 적어 둔 부위면 그냥 된다 |
| 말하는 절 하나의 질문 수 | 7~8개 | 부위마다 둘. 얼굴은 약 110개 |
| 응답 시간 (우리 실험) | 약 0.22초 | 얼굴 약 0.4초, 로봇팔 약 0.27초 |
| 세밀한 표정 | 손으로 맞춘 이름 붙은 모양 | 모델이 근육을 직접 조합 |

그림은 `docs/diagrams/build.mjs` 에서 만든다. 고친 뒤 `node docs/diagrams/build.mjs` 로 다섯 장의 한국어·영어판을 함께 다시 만든다.

## 알아 둘 점

- **판단 모델로 Jev 를 쓴다.** 유료 API 이고 키가 필요하다. 분석기는 갈아 끼울 수 있게 되어 있고, 비교용 LLM 분석기 코드가 `apps/offline-lab` 에 있다(실제 키로 돌려 보지는 않았다).
- **말투는 읽지 않는다.** 글자로는 칭찬인데 비꼬는 말투인 경우처럼 소리에만 있는 정보는 반영되지 않는다. 앞뒤 맥락으로 드러나는 반어는 잡는다.
- **대화 텍스트가 판단 모델로 전송된다.** 사용자 말의 전사도 포함된다. 서비스에 넣을 때는 사용자에게 알려야 한다.
- **실험 단계다.** 한국어 대화로만 시험했고, 표정 대응의 계수는 초안이다. 확인하지 못한 것은 각 폴더의 README 에 적어 두었다.
- **예제 서버는 내 PC 전용이다.** 인증이 없으므로 그대로 외부에 열면 안 된다.

## 라이선스

- 코드: [MIT](LICENSE)
- 기본 캐릭터 네 가지(페이스링, 로봇, 강아지, 로봇팔)의 디자인: [CC BY-NC 4.0](packages/rigs/LICENSE.md). 비상업 용도로는 자유롭게 쓸 수 있고, 상업 제품에 쓰려면 허락이 필요하다. 직접 만든 캐릭터에는 이 조건이 적용되지 않는다.

© 2026 RED BRIDGE DEV
