// 前端主控：加载合同规则 → 按 state.phase 渲染 → 把用户操作翻译成事件交给 transition。
// 规则见 docs/API_CONTRACT.md，视觉见 docs/DESIGN.md。
//
// 调试参数（演示时不用）：
//   ?contract=mock         强制使用前端替身 frontend/dev/mock-contract.js
//   ?preview=<phase>       用一串合法事件快进到某个阶段，方便检查界面，例如 ?preview=quiz

import { renderScreen, esc } from './screens.js';
import { DESIGN_NOTES } from './design-notes.js';

const RINGING_PHASES = new Set(['ringing', 'amending', 'pose', 'alertness', 'quiz', 'acceptance']);
const params = new URLSearchParams(location.search);

const $screen = document.getElementById('screen');
const $hatch = document.getElementById('escape-hatch');
const $announcer = document.getElementById('announcer');
const $fmDialog = document.getElementById('force-majeure-dialog');
const $notesToggle = document.getElementById('toggle-notes');
const $muteToggle = document.getElementById('toggle-mute');

let contract = null;          // 合同规则模块
let state = null;             // 合同状态，只由 transition 产生
let lastPhase = null;
let unmountDeep = null;       // 当前挂载的深化模块的卸载函数

// 界面本地状态：只影响显示，不影响流程
const ui = {
  draft: { time: '07:00', reason: '', policy: '' },
  notes: false,
  muted: false,
  justSigned: false,
  excuse: '',
  rebuttal: null,
  rebutting: false,
  amendDraft: null,
  slider: null,
  poseAvailable: undefined,
};

// ---------------- 加载 ----------------

// 真实模块必须符合 v1 契约（导出 PHASES 且阶段名一致），否则用替身，避免半成品把演示弄坏。
function conformsToV1(mod) {
  const need = ['signing', 'armed', 'ringing', 'amending', 'snoozed', 'quiz', 'acceptance', 'done'];
  return typeof mod?.initialState === 'function'
    && typeof mod?.transition === 'function'
    && Array.isArray(mod?.PHASES)
    && need.every((p) => mod.PHASES.includes(p));
}

async function loadContract() {
  if (params.get('contract') !== 'mock') {
    try {
      const mod = await import('../backend/contract.js');
      if (conformsToV1(mod)) {
        console.info('[合同] 使用 backend/contract.js');
        return mod;
      }
      console.warn('[合同] backend/contract.js 还不符合 docs/API_CONTRACT.md v1，暂用前端替身');
    } catch {
      // 真实模块不存在或加载失败：静默改用替身
    }
  }
  const mod = await import('./dev/mock-contract.js');
  console.info('[合同] 使用前端替身 frontend/dev/mock-contract.js');
  return mod;
}

const NOOP_RINGER = {
  start() {}, stop() {}, setMuted() {}, isMuted: () => false, isPlaying: () => false,
  setIntensity() {}, getIntensity: () => 0, unlock() {}, dispose() {},
};
let ringer = NOOP_RINGER;

async function loadRinger() {
  try {
    const { createRinger } = await import('./audio.js');
    ringer = createRinger();
  } catch {
    ringer = NOOP_RINGER; // 没有声音也能完整演示
  }
}

async function loadDeep(name) {
  try {
    return await import(`./deep/${name}.js`);
  } catch {
    return null;
  }
}

// ---------------- 事件 ----------------

let fakeClock = 0; // 只给 ?preview 用
const now = () => performance.now();

function dispatch(event, nowMs = now()) {
  try {
    state = contract.transition(state, event, nowMs);
  } catch (err) {
    // 规则模块抛异常算 Bug：保留原状态，提示可以继续
    console.error('[合同] transition 抛出异常', event, err);
    announce('这一步没有生效，请再试一次。');
  }
  render();
}

function resetAll() {
  unmount();
  Object.assign(ui, {
    draft: { time: '07:00', reason: '', policy: '' },
    justSigned: false, excuse: '', rebuttal: null, rebutting: false, amendDraft: null, slider: null,
  });
  dispatch({ type: 'RESET' });
}

// ---------------- 渲染 ----------------

function daypart(phase) {
  if (phase === 'signing' || phase === 'armed') return 'night';
  if (phase === 'done') return 'day';
  return 'dawn';
}

function render() {
  const phaseChanged = state.phase !== lastPhase;
  const focusKey = phaseChanged ? null : document.activeElement?.dataset?.key;

  if (phaseChanged) {
    // 换阶段时清掉上一阶段的界面草稿
    ui.excuse = ''; ui.rebuttal = null; ui.rebutting = false; ui.amendDraft = null; ui.slider = null;
  }

  unmount();
  document.body.dataset.daypart = daypart(state.phase);
  $screen.innerHTML = renderScreen(state, ui);
  $screen.dataset.phase = state.phase;
  $hatch.hidden = !RINGING_PHASES.has(state.phase);
  ui.justSigned = false;

  renderNotes();
  syncSound();
  mountForPhase();

  if (phaseChanged) {
    lastPhase = state.phase;
    const h1 = $screen.querySelector('h1');
    h1?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    announce(h1?.textContent ?? '');
  } else if (state.error) {
    const err = $screen.querySelector('#form-error');
    const field = err?.closest('form')?.querySelector('input:not([type=radio]), textarea');
    (field ?? err)?.focus();
  } else if (focusKey) {
    $screen.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }
}

function renderNotes() {
  document.querySelectorAll('.design-note').forEach((n) => n.remove());
  if (!ui.notes) return;
  document.querySelectorAll('[data-mechanism]').forEach((el) => {
    if (el.closest('[hidden]')) return;
    const note = DESIGN_NOTES[el.dataset.mechanism];
    if (!note) return;
    const aside = document.createElement('aside');
    aside.className = 'design-note';
    aside.setAttribute('aria-label', `设计逻辑：${note.title}`);
    aside.innerHTML = `
      <h4>设计逻辑：${esc(note.title)}</h4>
      <dl>
        <dt>故意违反</dt><dd>${esc(note.principle)}</dd>
        <dt>为什么</dt><dd>${esc(note.why)}</dd>
        <dt>怎么通关</dt><dd>${esc(note.exit)}</dd>
      </dl>`;
    el.after(aside);
  });
}

function syncSound() {
  if (RINGING_PHASES.has(state.phase)) {
    ringer.setIntensity(Math.min(state.snoozeCount ?? 0, 3));
    ringer.start(); // 幂等：放铃声的阶段之间不重启
  } else {
    ringer.stop();
  }
}

function announce(text) {
  $announcer.textContent = '';
  requestAnimationFrame(() => { $announcer.textContent = text; });
}

// ---------------- 深化模块挂载 ----------------

function unmount() {
  if (unmountDeep) {
    try { unmountDeep(); } catch (err) { console.warn('[深化] 卸载出错', err); }
    unmountDeep = null;
  }
}

function showDeepError(id, text) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.hidden = false; }
}

async function mountReaction(slotId, mode, eventType) {
  const mod = await loadDeep('reaction');
  const slot = document.getElementById(slotId);
  if (!slot) return; // 加载期间已经换页
  if (!mod?.mountReactionTest) {
    showDeepError(`deep-error-${slotId.replace('slot-', '')}`, '反应测试模块还没准备好。这一项可以跳过。');
    return;
  }
  unmount();
  unmountDeep = mod.mountReactionTest(slot, {
    mode, trials: 5,
    onDone: (rtMs) => dispatch({ type: eventType, rtMs }),
  });
}

async function mountPose(slotId, mode) {
  const mod = await loadDeep('pose');
  const slot = document.getElementById(slotId);
  if (!slot) return;
  if (!mod?.mountPoseCapture) {
    if (mode === 'attempt') { dispatch({ type: 'POSE_UNAVAILABLE' }); return; }
    ui.poseAvailable = false;
    render();
    return;
  }
  unmount();
  unmountDeep = mod.mountPoseCapture(slot, {
    mode,
    onDone: (keypoints) => dispatch({ type: mode === 'sign' ? 'SIGN_POSE' : 'POSE_ATTEMPT', keypoints }),
    onUnavailable: () => {
      if (mode === 'attempt') dispatch({ type: 'POSE_UNAVAILABLE' });
      else showDeepError('deep-error-pose', '摄像头不可用，跳过动作签名即可，明早改走反应测试。');
    },
  });
}

function mountForPhase() {
  if (state.phase === 'alertness') mountReaction('slot-alertness', 'morning', 'ALERTNESS');
  if (state.phase === 'pose') mountPose('slot-pose-attempt', 'attempt');
}

// ---------------- AI 甲方 ----------------

async function rebut() {
  const reason = state.contract?.reason ?? '';
  const fallback = { reply: `你昨晚说：${reason}`, source: 'fallback' };
  ui.rebutting = true;
  render();
  const mod = await loadDeep('rebut');
  let result = fallback;
  if (mod?.requestRebuttal) {
    try { result = await mod.requestRebuttal({ reason, excuse: ui.excuse }, { timeoutMs: 8000 }); } catch { result = fallback; }
  }
  if (state.phase !== 'amending') return; // 等待期间已离开修订页
  ui.rebutting = false;
  ui.rebuttal = result?.reply ? result : fallback;
  render();
}

// ---------------- 用户操作 ----------------

const ACTIONS = {
  'next-day': () => dispatch({ type: 'RING' }),
  'ring-again': () => dispatch({ type: 'RING' }),
  snooze: () => dispatch({ type: 'SNOOZE' }),
  close: () => dispatch({ type: 'REQUEST_CLOSE' }),
  'policy-change': () => dispatch({ type: 'REQUEST_POLICY_CHANGE' }),
  keep: () => dispatch({ type: 'KEEP_SUPERVISING' }),
  'confirm-close': () => dispatch({ type: 'CONFIRM_CLOSE' }),
  reset: () => resetAll(),
  rebut: () => rebut(),
  baseline: () => mountReaction('slot-baseline', 'baseline', 'BASELINE'),
  'sign-pose': () => mountPose('slot-pose', 'sign'),
};

// 手机数字键盘没有冒号：把 "705"、"0705"、"7:5" 这类输入整理成 "07:05"。整理不了就原样交给 transition，由它报 INVALID_TIME。
function normalizeTime(raw) {
  const s = String(raw ?? '').trim().replace('：', ':');
  let h, m;
  const parts = s.split(':');
  if (parts.length === 2 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) [h, m] = parts;
  else if (/^\d{3,4}$/.test(s)) [h, m] = [s.slice(0, -2), s.slice(-2)];
  else return s;
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

const FORMS = {
  sign(form) {
    const fd = new FormData(form);
    ui.draft = { time: normalizeTime(fd.get('time')), reason: fd.get('reason') ?? '', policy: fd.get('policy') ?? '' };
    const before = state.phase;
    state = contract.transition(state, { type: 'SIGN', ...ui.draft }, now());
    if (before === 'signing' && state.phase === 'armed') ui.justSigned = true;
    render();
  },
  amend(form) {
    ui.amendDraft = normalizeTime(new FormData(form).get('time'));
    dispatch({ type: 'AMEND', time: ui.amendDraft });
  },
  answer(form) {
    ui.slider = Number(new FormData(form).get('value'));
    dispatch({ type: 'ANSWER', value: ui.slider });
  },
};

function bindEvents() {
  $screen.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    ACTIONS[btn.dataset.action]?.();
  });

  $screen.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    try {
      FORMS[form.dataset.form]?.(form);
    } catch (err) {
      console.error(err);
      announce('这一步没有生效，请再试一次。');
    }
  });

  // 不重新渲染、只记住输入
  $screen.addEventListener('input', (e) => {
    const key = e.target.dataset?.bind;
    if (!key) return;
    ui[key] = key === 'slider' ? Number(e.target.value) : e.target.value;
    if (key === 'slider') {
      const out = document.getElementById('slider-out');
      if (out) out.textContent = e.target.value;
    }
  });

  document.getElementById('reset').addEventListener('click', resetAll);

  $notesToggle.addEventListener('click', () => {
    ui.notes = !ui.notes;
    $notesToggle.setAttribute('aria-pressed', String(ui.notes));
    renderNotes();
  });

  $muteToggle.addEventListener('click', () => {
    ui.muted = !ui.muted;
    $muteToggle.setAttribute('aria-pressed', String(ui.muted));
    ringer.setMuted(ui.muted);
  });

  document.getElementById('open-force-majeure').addEventListener('click', () => {
    $fmDialog.querySelector('form').reset();
    $fmDialog.showModal();
  });
  $fmDialog.addEventListener('close', () => {
    if ($fmDialog.returnValue !== 'confirm') return;
    const note = $fmDialog.querySelector('[name=note]').value.trim();
    dispatch({ type: 'FORCE_MAJEURE', note });
  });

  // 浏览器要求先有一次用户手势才能出声
  const unlock = () => ringer.unlock();
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

// ---------------- 预览快进（只用于检查界面） ----------------

const KEYPOINTS = Array.from({ length: 17 }, (_, i) => ({ x: 0.3 + (i % 5) * 0.1, y: 0.2 + Math.floor(i / 5) * 0.15 }));
const SIGN = { type: 'SIGN', time: '07:00', reason: '八点去接室友', policy: 'amend_first' };
const PREVIEW = {
  signing: [],
  armed: [SIGN],
  ringing: [SIGN, { type: 'RING' }],
  amending: [SIGN, { type: 'RING' }, { type: 'SNOOZE' }],
  snoozed: [SIGN, { type: 'RING' }, { type: 'SNOOZE' }, { type: 'AMEND', time: '07:05' }],
  pose: [SIGN, { type: 'SIGN_POSE', keypoints: KEYPOINTS }, { type: 'RING' }, { type: 'REQUEST_CLOSE' }],
  alertness: [SIGN, { type: 'BASELINE', rtMs: [300, 320, 310, 290, 305] }, { type: 'RING' }, { type: 'REQUEST_CLOSE' }],
  quiz: [SIGN, { type: 'RING' }, { type: 'REQUEST_CLOSE' }],
  acceptance: [SIGN, { type: 'RING' }, { type: 'REQUEST_CLOSE' }, { type: 'ANSWER', value: 43 }],
  done: [SIGN, { type: 'RING' }, { type: 'SNOOZE' }, { type: 'AMEND', time: '07:05' }, { type: 'RING' },
    { type: 'REQUEST_CLOSE' }, { type: 'ANSWER', value: 42 }, { type: 'ANSWER', value: 43 },
    { type: 'KEEP_SUPERVISING' }, { type: 'CONFIRM_CLOSE' }],
};

function applyPreview(name) {
  const events = PREVIEW[name];
  if (!events) return;
  for (const ev of events) {
    fakeClock += 7300;
    state = contract.transition(state, ev, fakeClock);
  }
}

// ---------------- 启动 ----------------

async function boot() {
  try {
    [contract] = await Promise.all([loadContract(), loadRinger()]);
  } catch (err) {
    console.error(err);
    $screen.innerHTML = '<p class="lede">合同规则没有加载成功。请用本地服务器打开：在仓库根目录运行 python3 -m http.server 8000，再访问 /frontend/。</p>';
    return;
  }
  state = contract.initialState();
  applyPreview(params.get('preview'));
  bindEvents();
  render();
}

boot();
