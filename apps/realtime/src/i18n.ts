/**
 * 화면 글의 한국어·영어 전환.
 * - 코드가 만드는 글은 t('키') 로 꺼낸다.
 * - index.html 에 적힌 글은 한국어가 원본이다. 아래 STATIC 표에 있는 자리만 영어로 바꿔 끼우고,
 *   한국어로 돌아갈 때는 처음 읽어 둔 원본을 되돌린다.
 */
export type Lang = 'ko' | 'en';

const KO = {
  'avatar.faceling': '페이스링',
  'avatar.faceling.desc': '로고와 같은 얼굴. 눈과 입만으로 표정을 지어요',
  'avatar.robot': '로봇',
  'avatar.robot.desc': '화면에 눈과 입이 그려지는 작은 로봇',
  'avatar.dog': '강아지',
  'avatar.dog.desc': '동그란 눈과 큰 귀를 가진 강아지',
  'avatar.arm': '로봇팔',
  'avatar.arm.desc': '얼굴 없는 작업대 로봇팔. 몸짓으로 감정을 보여 줘요',
  'avatar.vrm': '3D 모델',
  'avatar.vrm.desc': 'VRM 3D 모델. 처음 고르면 예제 모델을 내려받아요',

  'vrm.loading': '3D 모델을 불러오는 중입니다 ({label})',
  'vrm.loaded': '3D 모델을 불러왔습니다 ({label})',
  'vrm.notVrm': 'VRM 모델이 아닙니다',
  'vrm.sample': 'three-vrm 예제 모델',
  'vrm.failed': '3D 모델을 불러오지 못했어요: {message}',
  'vrm.arkit': 'ARKit 표정 {n}개를 가진 모델입니다. 표정이 모두 반영됩니다.',
  'vrm.preset': '표준 표정(기쁨, 슬픔, 놀람 등)만 가진 모델이라 표정이 단순하게 보입니다. ARKit 표정을 가진 VRM 을 넣으면 로봇·강아지처럼 세밀하게 움직입니다.',
  'vrm.info': '"3D 모델"을 고르면 예제 모델을 불러옵니다. 내 VRM 파일을 넣을 수도 있습니다.',

  'notice.judgeFailed': '표정 판단 요청이 실패했어요',
  'notice.noMic': '마이크를 쓸 수 없어 글로만 대화해요. 브라우저 주소창의 사이트 설정에서 마이크를 허용하면 다음 연결부터 쓸 수 있어요.',
  'notice.dropped': '연결이 끊겼어요.',
  'notice.noJev': '표정 판단에 쓸 키가 없어요. 위쪽 "API 키"에 TypeSafe 키(Jev)나 OpenAI 키를 넣거나 루트의 .env 에 넣으세요.',

  'log.empty': '아직 나눈 말이 없어요.',
  'status.ended': '연결을 끊었습니다',
  'status.demoRunning': '예시 대화를 재생하는 중입니다. 소리는 나지 않습니다.',
  'status.demoDone': '예시 대화가 끝났습니다.',
  'status.voiceNext': '목소리는 다음에 대화를 시작할 때 바뀝니다.',
  'status.ready': '준비됨 ({model})',
  'status.noOpenai': 'OpenAI 키가 없어 음성 대화는 할 수 없습니다.',
  'status.static': '녹화된 판단을 재생하는 페이지입니다.',
  'status.openaiJudge': '표정 판단은 OpenAI 모델이 대신합니다.',
  'notice.openaiJudgeFailed': 'OpenAI 에 표정 판단을 묻지 못했어요. "API 키"에 넣은 키가 맞는지, 인터넷이 연결돼 있는지 확인해 주세요.',

  'mode.off': '연결 전',
  'mode.connecting': '연결하는 중…',
  'mode.waiting': '듣고 있어요',
  'mode.listening': '듣고 있어요',
  'mode.thinking': '생각 중…',
  'mode.speaking': '말하는 중',
  'mode.muted': '마이크가 꺼져 있어요',
  'mode.text': '메시지를 기다려요',
  'mode.demo': '예시 대화',
  'mode.error': '연결하지 못했어요',

  'hint.vrm': '3D 모델을 불러오는 중이에요…',
  'hint.waiting': '“오늘 하루 어땠어?”처럼 편하게 말해 보세요',
  'hint.muted': '마이크를 켜거나 메시지를 입력하세요',
  'hint.text': '메시지를 입력해 말을 걸어 보세요',
  'hint.connecting': '연결하고 있어요. 마이크 허용 창이 뜨면 허용해 주세요.',
  'hint.error': '연결 상태를 확인하고 다시 시도해 주세요',
  'hint.noOpenai': 'OpenAI 키가 없어 음성 대화는 할 수 없어요. 위쪽 "API 키"에 넣으면 대화할 수 있어요. 지금은 예시 대화로 표정이 움직이는 모습을 볼 수 있어요.',
  'hint.static': '녹화된 대화를 재생해요. 위쪽 "API 키"에 내 OpenAI 키를 넣으면 직접 실시간으로 대화할 수 있어요.',
  'hint.ended': '대화를 마쳤어요. 언제든 다시 시작할 수 있어요.',
  'hint.off': '대화를 시작하면 얼굴이 듣고, 생각하고, 표정으로 반응해요',

  'start.connecting': '연결하는 중…',
  'start.demoStop': '예시 대화 멈춤',
  'start.demo': '예시 대화 보기',
  'start.retry': '다시 시도',
  'start.go': '대화 시작',

  'mic.none': '마이크 없이 연결했어요. 종료한 뒤 다시 시작하면 켤 수 있어요.',
  'mic.off': '마이크 끄기',
  'mic.on': '마이크 켜기',
  'say.placeholder': '메시지 입력',
  'say.disabled': '대화를 시작하면 글로도 말할 수 있어요',

  'timer.off': '연결 전',
  'timer.connecting': '연결하는 중',
  'timer.demo': '● 예시 대화',

  'onb.pick': '{name}{ro} 할게요',
  'onb.switch': '{name}{ro} 바꿀게요',
  'onb.cancel': '취소',
  'onb.back': '이전',
  'onb.voiceTitle': '목소리로 대화하려면',
  'onb.voiceDesc': '마이크만 있으면 돼요. 음성과 대화 내용은 OpenAI(음성 대화)와 Jev(표정 판단)로 전송돼요. 이 예제 서버는 표정 판단 기록을 내 PC 의 logs 폴더에 남겨요.',
  'onb.noKeyTitle': '음성 대화 키가 없어요',
  'onb.noKeyDesc': '아래 "API 키 입력"에 OpenAI 키를 넣으면 목소리로 대화할 수 있어요. 지금은 예시 대화로 표정이 움직이는 모습을 볼 수 있어요. 예시 대화의 글은 표정 판단을 위해 Jev 로 전송돼요.',
  'onb.staticTitle': '녹화된 대화를 보여 드려요',
  'onb.staticDesc': '이 페이지는 서버 없이 돌아가요. 미리 받아 둔 표정 판단을 그대로 재생하고, 소리는 나지 않아요. 대화 내용은 어디에도 전송하지 않아요. 아래 "API 키 입력"에 내 OpenAI 키를 넣으면 이 페이지에서 실시간으로 대화할 수 있어요(음성 대화 1분에 약 0.1~0.15달러, 추정).',
  'onb.staticLiveDesc': '마이크만 있으면 돼요. 음성과 대화 내용은 내 키로 OpenAI 에 직접 전송돼요(음성 대화와 표정 판단). 이 페이지에는 서버가 없어 다른 곳으로는 보내지 않아요.',
  'onb.startVoice': '마이크 허용하고 대화 시작',

  'perm.granted': '허용됨',
  'perm.denied': '거부됨',
  'perm.prompt': '대기',
  'perm.blocked': '막혀 있어요 · 주소창의 사이트 설정에서 허용해 주세요',
  'perm.needed': '필수 · 말하면 바로 반응해요',
  'perm.noJudge': '표정 판단 키 없음',
  'perm.noJudgeDesc': '아래 "API 키 입력"에 TypeSafe 키(Jev)나 OpenAI 키를 넣으세요. 없으면 얼굴이 기본 동작만 해요.',
  'perm.openaiJudge': '표정 판단 · OpenAI 모델',
  'perm.openaiJudgeDesc': 'Jev 키가 없어 OpenAI 모델이 대신 판단해요. Jev 보다 느려서 표정이 조금 늦을 수 있어요.',

  'stats.judged': '판단한 절',
  'stats.missed': '놓친 절',
  'stats.latency': 'Jev 응답 시간(평균)',
  'stats.lead': '판단이 소리보다(평균)',
  'stats.firstDelay': '응답 첫 절의 표정 지연(평균)',
  'stats.rate': '말 빠르기 추정',
  'stats.count': '{n}개',
  'stats.early': '{ms} 먼저',
  'stats.late': '{ms} 늦게',
  'stats.perChar': '글자당 {ms}',

  'debug.react': '듣는 반응',
  'debug.speak': '말하는 표정',
  'debug.channels': '부위별 수치',
  'debug.still': '움직임 없음',
  'debug.reset': '쉬는 자세로',
  'dur.instant': '순간',
  'dur.brief': '잠깐',
  'dur.line': '말하는 동안',
  'dur.stay': '머무름',
  'dur.until_told': '시킬 때까지',

  'keys.onServer': '비워 두면 서버 .env 의 키를 써요',
  'keys.empty': '키를 붙여 넣으세요',
  'keys.descStatic': '내 OpenAI 키를 넣으면 이 페이지에서 바로 대화할 수 있어요. 키는 이 브라우저에만 저장되고 OpenAI 로만 직접 보내져요(이 페이지에는 서버가 없어요). 표정 판단도 OpenAI 모델이 해요. 사용 요금은 내 OpenAI 계정에 청구돼요. 음성 대화 1분에 약 0.1~0.15달러로 추정해요(음성 약 0.05~0.08, 받아쓰기 약 0.02, 표정 판단 약 0.02~0.04).',
  'lang.switch': 'English',
  'lang.label': '화면 언어를 영어로 바꾸기',
} as const;

export type Key = keyof typeof KO;

const EN: Record<Key, string> = {
  'avatar.faceling': 'Faceling',
  'avatar.faceling.desc': 'The face from the logo. Eyes and a mouth are all it needs',
  'avatar.robot': 'Robot',
  'avatar.robot.desc': 'A small robot with eyes and a mouth drawn on its screen',
  'avatar.dog': 'Dog',
  'avatar.dog.desc': 'A dog with round eyes and big ears',
  'avatar.arm': 'Robot arm',
  'avatar.arm.desc': 'A workbench arm with no face. It shows feelings with its body',
  'avatar.vrm': '3D model',
  'avatar.vrm.desc': 'A VRM 3D model. The sample model downloads on first use',

  'vrm.loading': 'Loading the 3D model ({label})',
  'vrm.loaded': '3D model loaded ({label})',
  'vrm.notVrm': 'This file is not a VRM model',
  'vrm.sample': 'three-vrm sample model',
  'vrm.failed': 'Could not load the 3D model: {message}',
  'vrm.arkit': 'This model has {n} ARKit shapes, so every expression shows.',
  'vrm.preset': 'This model only has the standard expressions (joy, sorrow, surprise…), so its face looks simpler. A VRM with ARKit shapes moves in as much detail as the robot and the dog.',
  'vrm.info': 'Pick “3D model” to load the sample model. You can also load your own VRM file.',

  'notice.judgeFailed': 'The expression request failed',
  'notice.noMic': 'The microphone is unavailable, so this conversation is text only. Allow the microphone in the site settings to use it next time.',
  'notice.dropped': 'The connection dropped.',
  'notice.noJev': 'There is no key for judging expressions. Enter a TypeSafe key (Jev) or an OpenAI key under "API keys" above, or add one to the root .env.',

  'log.empty': 'Nothing said yet.',
  'status.ended': 'Disconnected',
  'status.demoRunning': 'Playing the sample conversation. There is no sound.',
  'status.demoDone': 'The sample conversation has ended.',
  'status.voiceNext': 'The voice changes the next time a conversation starts.',
  'status.ready': 'Ready ({model})',
  'status.noOpenai': 'The OpenAI key is missing, so voice conversation is off.',
  'status.static': 'This page replays recorded judgments.',
  'status.openaiJudge': 'An OpenAI model is judging the expressions in place of Jev.',
  'notice.openaiJudgeFailed': 'Could not ask OpenAI to judge the expression. Check that the key under "API keys" is correct and that you are online.',

  'mode.off': 'Not connected',
  'mode.connecting': 'Connecting…',
  'mode.waiting': 'Listening',
  'mode.listening': 'Listening',
  'mode.thinking': 'Thinking…',
  'mode.speaking': 'Speaking',
  'mode.muted': 'Microphone is off',
  'mode.text': 'Waiting for a message',
  'mode.demo': 'Sample conversation',
  'mode.error': 'Could not connect',

  'hint.vrm': 'Loading the 3D model…',
  'hint.waiting': 'Just talk. Try “How was your day?”',
  'hint.muted': 'Turn the microphone on or type a message',
  'hint.text': 'Type a message to start talking',
  'hint.connecting': 'Connecting. Allow the microphone if your browser asks.',
  'hint.error': 'Check your connection and try again',
  'hint.noOpenai': 'The OpenAI key is missing, so voice conversation is off. Enter it under "API keys" above to talk. For now, the sample conversation shows the face moving.',
  'hint.static': 'This replays a recorded conversation. Enter your own OpenAI key under "API keys" above to talk to it live.',
  'hint.ended': 'The conversation has ended. Start again whenever you like.',
  'hint.off': 'Start a conversation and the face listens, thinks and reacts',

  'start.connecting': 'Connecting…',
  'start.demoStop': 'Stop the sample',
  'start.demo': 'Play the sample conversation',
  'start.retry': 'Try again',
  'start.go': 'Start talking',

  'mic.none': 'Connected without a microphone. End and start again to turn it on.',
  'mic.off': 'Turn microphone off',
  'mic.on': 'Turn microphone on',
  'say.placeholder': 'Type a message',
  'say.disabled': 'Start a conversation to type as well',

  'timer.off': 'Not connected',
  'timer.connecting': 'Connecting',
  'timer.demo': '● Sample',

  'onb.pick': 'Go with {name}',
  'onb.switch': 'Switch to {name}',
  'onb.cancel': 'Cancel',
  'onb.back': 'Back',
  'onb.voiceTitle': 'To talk by voice',
  'onb.voiceDesc': 'A microphone is all you need. Your voice and the conversation are sent to OpenAI (voice) and Jev (expression judgment). This example server keeps a log of the judgments in the logs folder on your computer.',
  'onb.noKeyTitle': 'No voice key yet',
  'onb.noKeyDesc': 'Enter your OpenAI key under "Enter API keys" below to talk by voice. For now, the sample conversation shows the face moving. Its text is sent to Jev to judge the expressions.',
  'onb.staticTitle': 'This is a recorded conversation',
  'onb.staticDesc': 'This page runs without a server. It replays expression judgments recorded in advance, with no sound, and no conversation is sent anywhere. Enter your own OpenAI key under "Enter API keys" below to talk to it live on this page (roughly $0.10–0.15 per minute of voice, estimated).',
  'onb.staticLiveDesc': 'A microphone is all you need. Your voice and the conversation go straight to OpenAI with your key (voice and expression judgment). This page has no server, so nothing is sent anywhere else.',
  'onb.startVoice': 'Allow microphone and start',

  'perm.granted': 'Allowed',
  'perm.denied': 'Blocked',
  'perm.prompt': 'Waiting',
  'perm.blocked': 'Blocked · allow it in the site settings in the address bar',
  'perm.needed': 'Required · it reacts as soon as you speak',
  'perm.noJudge': 'No expression key',
  'perm.noJudgeDesc': 'Enter a TypeSafe key (Jev) or an OpenAI key under "Enter API keys" below. Without one the face only does its idle motion.',
  'perm.openaiJudge': 'Expression judgment · OpenAI model',
  'perm.openaiJudgeDesc': 'There is no Jev key, so an OpenAI model judges instead. It is slower than Jev, so expressions may come a little late.',

  'stats.judged': 'Clauses judged',
  'stats.missed': 'Clauses missed',
  'stats.latency': 'Jev response time (mean)',
  'stats.lead': 'Judgment vs. sound (mean)',
  'stats.firstDelay': 'Delay on a reply’s first clause (mean)',
  'stats.rate': 'Estimated speaking rate',
  'stats.count': '{n}',
  'stats.early': '{ms} early',
  'stats.late': '{ms} late',
  'stats.perChar': '{ms} per character',

  'debug.react': 'Listening reaction',
  'debug.speak': 'Speaking expression',
  'debug.channels': 'per-part values',
  'debug.still': 'no movement',
  'debug.reset': 'back to rest',
  'dur.instant': 'instant',
  'dur.brief': 'brief',
  'dur.line': 'while speaking',
  'dur.stay': 'stays',
  'dur.until_told': 'until told',

  'keys.onServer': 'Leave empty to use the key in the server .env',
  'keys.empty': 'Paste your key',
  'keys.descStatic': 'Enter your own OpenAI key to talk right on this page. It is stored only in this browser and sent straight to OpenAI and nowhere else (this page has no server). An OpenAI model judges the expressions too. Usage is billed to your OpenAI account: an estimated $0.10–0.15 per minute of voice conversation (voice about $0.05–0.08, transcription about $0.02, expression judgment about $0.02–0.04).',
  'lang.switch': '한국어',
  'lang.label': 'Switch the page to Korean',
};

/** index.html 의 글 가운데 영어로 바꿔 끼울 자리. [선택자, 무엇을 바꾸는지, 영어] */
type Slot = 'text' | 'html' | 'title' | 'aria-label' | 'placeholder' | 'content' | 'value';
const STATIC: Array<[string, Slot, string]> = [
  ['meta[name="description"]', 'content', 'Faceling — a face for your AI. Watch a voice AI’s expressions in real time.'],
  ['#step-1-title', 'text', 'A conversation you can see'],
  ['#step-1 .head p', 'text', 'Talk to it and the AI listens, thinks and reacts with its face. The expressions come from what the words mean, not from the sound of the voice.'],
  ['#step-1 [data-go]', 'text', 'Get started'],
  ['#step-1 .repo-link span', 'html', '<b>Open source</b> · View the code on GitHub'],
  ['#step-2-title', 'text', 'Who would you like to talk to?'],
  ['#step-2 .head p', 'text', 'Only the looks change. The same engine reads what the words mean and makes the expression. The faceless robot arm shows the same judgment with its body. You can switch at any time.'],
  ['#avatar-cards', 'aria-label', 'Character'],
  ['#voice-title', 'text', 'Voice'],
  ['#perm-mic b', 'text', 'Microphone'],
  ['#keys-open-onb', 'text', 'Enter API keys'],
  ['#keys-open-chat .label', 'text', 'API keys'],
  ['#keys-title', 'text', 'API keys'],
  ['#keys-desc', 'text', 'Use your own keys instead of the ones in .env. They are stored only in this browser and sent only to the server on your PC, which passes them to OpenAI and TypeSafe. They are never written to a file or a log. Without a TypeSafe key, an OpenAI model judges the expressions instead.'],
  ['#l-key-openai', 'html', '<b>OpenAI API key</b> · voice conversation'],
  ['#l-key-jev', 'html', '<b>TypeSafe API key</b> · expression judgment (Jev)'],
  ['#keys-note', 'text', 'Changes apply from the next connection. Expression judgment switches right away.'],
  ['#keys-clear', 'text', 'Clear'],
  ['#keys-cancel', 'text', 'Close'],
  ['#keys-save', 'text', 'Save'],
  ['#start-text', 'text', 'Text only, please'],
  ['#step-3-back', 'text', 'Back'],
  ['#log-toggle .label', 'text', 'Transcript'],
  ['#change .label', 'text', 'Change character'],
  ['#repo', 'title', 'GitHub repository (open source)'],
  ['#chat .stage', 'aria-label', 'Conversation'],
  ['#canvas', 'aria-label', 'The AI’s face'],
  ['#start-text-2', 'text', 'Text only, please'],
  ['#end', 'aria-label', 'End conversation'],
  ['#end', 'title', 'End conversation'],
  ['#log', 'aria-label', 'Transcript'],
  ['#log .title', 'text', 'Transcript'],
  ['#suggestions button:nth-child(1)', 'text', 'How are you feeling today?'],
  ['#suggestions button:nth-child(2)', 'text', 'Tell me something funny'],
  ['#suggestions button:nth-child(3)', 'text', 'I could use some cheering up'],
  ['#say-text', 'aria-label', 'Message'],
  ['#say', 'text', 'Send'],
  ['#dev', 'aria-label', 'Under the hood'],
  ['#dev .top span', 'text', 'Under the hood · press ` to close'],
  ['#dev-close', 'text', 'Close'],
  ['#dev-h-face', 'text', 'Face now · what the judge picked → applied strength'],
  ['#dev-h-timing', 'text', 'Timing'],
  ['#dev-h-conn', 'text', 'Connection'],
  ['#speak-first', 'text', 'AI speaks first'],
  ['#interrupt', 'text', 'Interrupt'],
  ['#dev-h-vrm', 'text', '3D face · VRM'],
  ['#dev-h-sim', 'text', 'Try one sentence · no connection, no sound'],
  ['#sim-text', 'aria-label', 'Sentence for the AI to say'],
  ['#sim-text', 'value', 'Really? Wow, congratulations! All that hard work paid off.'],
  ['#sim-say', 'text', 'Have the AI say this'],
  ['#sim-demo', 'text', 'Play the sample conversation'],
  ['#sim-stop', 'text', 'Stop'],
  ['#l-voice', 'text', 'Voice '],
  ['#l-live-reactions', 'text', ' React while the user is still talking'],
  ['#l-channel-mode', 'text', ' Judge per-part values (experimental)'],
  ['#l-greet', 'text', ' AI greets first on connect'],
  ['#l-vrm-file', 'text', 'Load my VRM'],
];

const read = (el: Element, slot: Slot): string => {
  if (slot === 'text') return el.textContent ?? '';
  if (slot === 'html') return el.innerHTML;
  if (slot === 'value') return (el as HTMLTextAreaElement).value;
  return el.getAttribute(slot) ?? '';
};
const write = (el: Element, slot: Slot, value: string): void => {
  if (slot === 'text') el.textContent = value;
  else if (slot === 'html') el.innerHTML = value;
  else if (slot === 'value') (el as HTMLTextAreaElement).value = value;
  else el.setAttribute(slot, value);
};

const originals = new Map<string, string>();
const isLang = (value: string | null | undefined): value is Lang => value === 'ko' || value === 'en';

let current: Lang = 'ko';
export const lang = (): Lang => current;

/** 처음 쓸 언어: 주소의 ?lang= → 지난번에 고른 것 → 브라우저 언어(한국어가 아니면 영어) */
export function initialLang(fromUrl: string | null, saved: string | null): Lang {
  if (isLang(fromUrl)) return fromUrl;
  if (isLang(saved)) return saved;
  return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const text: string = (current === 'en' ? EN : KO)[key];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''));
}

/** 언어를 바꾸고 index.html 에 적힌 글을 갈아 끼운다. 코드가 만드는 글은 부른 쪽이 다시 그린다. */
export function setLang(next: Lang): void {
  current = next;
  document.documentElement.lang = next;
  for (const [selector, slot, english] of STATIC) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const id = `${selector}|${slot}`;
    if (!originals.has(id)) originals.set(id, read(el, slot));
    write(el, slot, next === 'en' ? english : originals.get(id)!);
  }
}
