import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, addMinutes, PHASES } from './mock-contract.js';

const baseline = [200, 90, 100, 80, 110];
const slow = [160, 170, 150, 140, 190];
const keypoints = [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.5 }];

function send(state, type, nowMs = 0, fields = {}) {
  return transition(state, { type, ...fields }, nowMs);
}

function signed(policy = 'amend_first', time = '07:00') {
  return send(initialState(), 'SIGN', 0, { time, reason: ' 八点接室友 ', policy });
}

function closeWith({ pose = false, reaction = false } = {}) {
  let state = signed();
  if (pose) state = send(state, 'SIGN_POSE', 0, { keypoints });
  if (reaction) state = send(state, 'BASELINE', 0, { rtMs: baseline });
  return send(send(state, 'RING'), 'REQUEST_CLOSE');
}

test('宽松合同首次直接延后五分钟，第二次要求修订', () => {
  const first = send(send(signed('one_snooze'), 'RING'), 'SNOOZE');
  assert.equal(first.phase, 'snoozed');
  assert.equal(first.currentTime, '07:05');
  assert.equal(first.snoozeCount, 1);
  assert.deepEqual(first.amendments, []);

  const second = send(send(first, 'RING'), 'SNOOZE');
  assert.equal(second.phase, 'amending');
  assert.equal(second.amendTarget, '07:10');
  assert.equal(second.currentTime, '07:05');
  assert.equal(second.snoozeCount, 1);
});

test('严格合同拒绝错误修订，正确修订后保留原合同', () => {
  let state = send(send(signed(), 'RING'), 'SNOOZE');
  assert.equal(state.phase, 'amending');
  assert.equal(state.amendTarget, '07:05');
  for (const [time, error] of [['25:00', 'INVALID_TIME'], ['07:04', 'AMEND_WRONG_TIME']]) {
    state = send(state, 'AMEND', 0, { time });
    assert.equal(state.error, error);
    assert.equal(state.phase, 'amending');
    assert.equal(state.snoozeCount, 0);
    assert.deepEqual(state.amendments, []);
  }
  state = send(state, 'AMEND', 0, { time: '07:05' });
  assert.equal(state.phase, 'snoozed');
  assert.equal(state.currentTime, '07:05');
  assert.equal(state.contract.time, '07:00');
  assert.equal(state.snoozeCount, 1);
  assert.equal(state.amendTarget, null);
  assert.equal(state.error, null);
  assert.deepEqual(state.amendments, [{ from: '07:00', to: '07:05' }]);
});

test('23:58 修订到次日 00:03，加减分钟使用 24 小时制', () => {
  const state = send(send(signed('amend_first', '23:58'), 'RING'), 'SNOOZE');
  assert.equal(state.amendTarget, '00:03');
  assert.equal(addMinutes('00:03', -5), '23:58');
  assert.equal(addMinutes('00:00', 1440), '00:00');
});

test('直接关闭时首题只发操作数和范围，答错可重试，通过后仍需验收', () => {
  const quiz = closeWith();
  assert.equal(quiz.phase, 'quiz');
  assert.deepEqual(quiz.quiz, { a: 17, b: 26, min: 0, max: 100 });
  const wrong = send(quiz, 'ANSWER', 0, { value: 42 });
  assert.equal(wrong.phase, 'quiz');
  assert.equal(wrong.error, 'WRONG_ANSWER');
  assert.equal(wrong.wrongAnswers, 1);
  assert.deepEqual(wrong.quiz, quiz.quiz);
  const passed = send(wrong, 'ANSWER', 0, { value: 43 });
  assert.equal(passed.phase, 'acceptance');
  assert.equal(passed.quiz, null);
  assert.equal(passed.error, null);
  const keep = send(passed, 'KEEP_SUPERVISING');
  assert.equal(keep.phase, 'acceptance');
  assert.equal(keep.keepSupervisingCount, 1);
  const done = send(keep, 'CONFIRM_CLOSE');
  assert.equal(done.phase, 'done');
  assert.deepEqual(done.receipt, {
    outcome: 'completed', originalTime: '07:00', finalTime: '07:00',
    reason: '八点接室友', policy: 'amend_first', snoozeCount: 0, amendments: [],
    taskMs: 0, procedureMs: 0, ringingMs: 0, wrongAnswers: 1, keepSupervisingCount: 1,
    alertness: null, pose: null, pendingPolicyChange: null, forceMajeureNote: null,
  });
});

test('六个响铃阶段都能不可抗力退出，其他阶段拒绝', () => {
  const ringing = send(signed(), 'RING');
  const quiz = closeWith();
  const active = [
    ringing, send(ringing, 'SNOOZE'), closeWith({ pose: true }), closeWith({ reaction: true }),
    quiz, send(quiz, 'ANSWER', 0, { value: 43 }),
  ];
  assert.deepEqual(active.map(s => s.phase), ['ringing', 'amending', 'pose', 'alertness', 'quiz', 'acceptance']);
  for (const state of active) {
    const ended = send(state, 'FORCE_MAJEURE', 35, { note: '身体不适' });
    assert.equal(ended.phase, 'done');
    assert.equal(ended.amendTarget, null);
    assert.equal(ended.receipt.outcome, 'force_majeure');
    assert.equal(ended.receipt.forceMajeureNote, '身体不适');
    assert.equal(ended.receipt.ringingMs + ended.receipt.procedureMs + ended.receipt.taskMs, 35);
  }
  const noNote = send(ringing, 'FORCE_MAJEURE');
  assert.equal(noNote.receipt.forceMajeureNote, '');
  const snoozed = send(send(signed('one_snooze'), 'RING'), 'SNOOZE');
  for (const state of [initialState(), signed(), snoozed, noNote]) {
    const rejected = send(state, 'FORCE_MAJEURE');
    assert.deepEqual(rejected, { ...state, error: 'EVENT_NOT_ALLOWED' });
  }
});

test('签约前的响铃和未知事件都保留阶段并返回错误', () => {
  const initial = initialState();
  for (const event of [{ type: 'RING' }, { type: 'UNKNOWN' }, null, {}]) {
    assert.deepEqual(transition(initial, event, 37), { ...initial, error: 'EVENT_NOT_ALLOWED' });
  }
  assert.deepEqual(PHASES, [
    'signing', 'armed', 'ringing', 'amending', 'snoozed', 'pose', 'alertness', 'quiz', 'acceptance', 'done',
  ]);
});

test('完整回执按时间戳分桶，重试、留在验收页和两段模拟睡眠均不重复计时', () => {
  let state = signed('one_snooze');
  state = send(state, 'BASELINE', 5, { rtMs: baseline });
  state = send(state, 'SIGN_POSE', 10, { keypoints });
  state = send(state, 'RING', 100);
  state = send(state, 'SNOOZE', 110);
  state = send(state, 'RING', 100110);
  state = send(state, 'SNOOZE', 100130);
  state = send(state, 'AMEND', 100140, { time: '07:09' });
  state = send(state, 'AMEND', 100160, { time: '07:10' });
  state = send(state, 'RING', 300000);
  state = send(state, 'REQUEST_CLOSE', 300040);
  assert.equal(state.phase, 'pose');
  state = send(state, 'POSE_ATTEMPT', 300050, { keypoints });
  assert.equal(state.phase, 'alertness');
  state = send(state, 'ALERTNESS', 300060, { rtMs: slow });
  state = send(state, 'ALERTNESS', 300070, { rtMs: [500, 130, 140, 100, 120] });
  state = send(state, 'ANSWER', 300080, { value: 42 });
  state = send(state, 'ANSWER', 300100, { value: 43 });
  state = send(state, 'KEEP_SUPERVISING', 300110);
  state = send(state, 'CONFIRM_CLOSE', 300130);
  assert.deepEqual(state.receipt, {
    outcome: 'completed', originalTime: '07:00', finalTime: '07:10', reason: '八点接室友',
    policy: 'one_snooze', snoozeCount: 2, amendments: [{ from: '07:05', to: '07:10' }],
    taskMs: 60, procedureMs: 60, ringingMs: 70, wrongAnswers: 1, keepSupervisingCount: 1,
    alertness: { baselineMedianMs: 100, morningMedianMs: 130, attempts: 1, label: '清醒' },
    pose: { attempts: 0, lastScore: 1, fallback: false },
    pendingPolicyChange: null, forceMajeureNote: null,
  });
});

test('连续三次反应不达标放行，回执记勉强清醒', () => {
  let state = closeWith({ reaction: true });
  for (let i = 1; i <= 3; i++) {
    state = send(state, 'ALERTNESS', i, { rtMs: slow });
    assert.equal(state.phase, i === 3 ? 'quiz' : 'alertness');
    assert.equal(state.alertness.attempts, i);
    assert.equal(state.error, null);
  }
  const ended = send(send(state, 'ANSWER', 4, { value: 43 }), 'CONFIRM_CLOSE', 5);
  assert.deepEqual(ended.receipt.alertness, {
    baselineMedianMs: 100, morningMedianMs: 160, attempts: 3, label: '勉强清醒',
  });
});

test('摄像头不可用时跳到反应测试，未录基线时直接答题', () => {
  for (const reaction of [true, false]) {
    const state = send(closeWith({ pose: true, reaction }), 'POSE_UNAVAILABLE');
    assert.equal(state.phase, reaction ? 'alertness' : 'quiz');
    assert.deepEqual(state.pose, { signed: true, attempts: 0, lastScore: null, fallback: true });
    assert.deepEqual(send(state, 'FORCE_MAJEURE').receipt.pose, { attempts: 0, lastScore: null, fallback: true });
  }
});

test('姿势得分包含 0.8 边界，错误格式得零，第三次失败走降级路径', () => {
  const armed = send(signed(), 'SIGN_POSE', 0, { keypoints: [[0, 0]] });
  const pose = send(send(armed, 'RING'), 'REQUEST_CLOSE');
  const match = send(pose, 'POSE_ATTEMPT', 0, { keypoints: [{ x: 0.2, y: 0.2 }] });
  assert.equal(match.phase, 'quiz');
  assert.equal(match.pose.lastScore, 0.8);
  for (const reaction of [true, false]) {
    let state = closeWith({ pose: true, reaction });
    for (const [i, invalid] of [null, [], [{ x: 1 }, {}]].entries()) {
      state = send(state, 'POSE_ATTEMPT', i, { keypoints: invalid });
      assert.equal(state.pose.lastScore, 0);
      assert.equal(state.pose.attempts, i + 1);
      if (i < 2) assert.equal(state.phase, 'pose');
    }
    assert.equal(state.pose.fallback, true);
    assert.equal(state.phase, reaction ? 'alertness' : 'quiz');
  }
});

test('仅严格合同的响铃和修订可申请明日变更，本次仍要修订', () => {
  for (const policy of ['one_snooze', 'amend_first']) {
    let state = signed(policy);
    assert.equal(send(state, 'REQUEST_POLICY_CHANGE').error, 'EVENT_NOT_ALLOWED');
    state = send(send(state, 'RING'), 'REQUEST_POLICY_CHANGE');
    if (policy === 'one_snooze') {
      assert.equal(state.error, 'EVENT_NOT_ALLOWED');
      assert.equal(state.pendingPolicyChange, null);
      state = send(send(send(state, 'SNOOZE'), 'RING'), 'SNOOZE');
      assert.equal(state.phase, 'amending');
      assert.equal(send(state, 'REQUEST_POLICY_CHANGE').error, 'EVENT_NOT_ALLOWED');
    } else {
      assert.equal(state.error, null);
      assert.equal(state.phase, 'ringing');
      assert.equal(state.pendingPolicyChange, 'one_snooze');
      state = send(send(state, 'SNOOZE'), 'REQUEST_POLICY_CHANGE');
      assert.equal(state.phase, 'amending');
      assert.equal(state.error, null);
      const quiz = send(state, 'REQUEST_CLOSE');
      assert.equal(quiz.phase, 'quiz');
      assert.equal(quiz.amendTarget, null);
      assert.equal(send(quiz, 'REQUEST_POLICY_CHANGE').error, 'EVENT_NOT_ALLOWED');
      const { receipt } = send(quiz, 'FORCE_MAJEURE');
      assert.equal(receipt.policy, 'amend_first');
      assert.equal(receipt.pendingPolicyChange, 'one_snooze');
    }
  }
});

test('校验签约字段和五次反应样本，错误输入不覆盖已录数据', () => {
  const fields = { time: '07:00', reason: '早八', policy: 'one_snooze' };
  for (const [invalid, error] of [
    [{ time: '7:00' }, 'INVALID_TIME'], [{ time: '24:00' }, 'INVALID_TIME'],
    [{ time: '07:60' }, 'INVALID_TIME'], [{ reason: '  ' }, 'EMPTY_REASON'],
    [{ reason: null }, 'EMPTY_REASON'], [{ policy: 'other' }, 'INVALID_POLICY'],
  ]) {
    assert.deepEqual(send(initialState(), 'SIGN', 0, { ...fields, ...invalid }), { ...initialState(), error });
  }
  const armed = send(signed(), 'BASELINE', 0, { rtMs: baseline });
  const morning = closeWith({ reaction: true });
  for (const rtMs of [[1], [0, 10, NaN, 20, 30], new Array(5)]) {
    assert.deepEqual(send(armed, 'BASELINE', 2, { rtMs }), { ...armed, error: 'EVENT_NOT_ALLOWED' });
    assert.deepEqual(send(morning, 'ALERTNESS', 2, { rtMs }), { ...morning, error: 'EVENT_NOT_ALLOWED' });
  }
});

test('RESET 从任何阶段返回完整的独立初态，新合同仍以 17 + 26 开始', () => {
  const ringing = send(signed(), 'RING');
  const quiz = closeWith();
  const acceptance = send(quiz, 'ANSWER', 0, { value: 43 });
  const states = [
    initialState(), signed(), ringing, send(ringing, 'SNOOZE'), send(send(signed('one_snooze'), 'RING'), 'SNOOZE'),
    closeWith({ pose: true }), closeWith({ reaction: true }), quiz, acceptance, send(acceptance, 'CONFIRM_CLOSE'),
  ];
  assert.deepEqual(states.map(s => s.phase), PHASES);
  for (const state of states) {
    const reset = send(state, 'RESET', 4000);
    assert.deepEqual(reset, initialState());
    assert.notEqual(reset.amendments, state.amendments);
    const armed = send(reset, 'SIGN', 5000, signed().contract);
    assert.deepEqual(send(send(armed, 'RING', 5100), 'REQUEST_CLOSE', 5200).quiz, quiz.quiz);
  }
});

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('冻结状态和事件后可确定性重放，录入的数组与调用方隔离', () => {
  let state = initialState();
  const events = [
    { type: 'SIGN', ...signed().contract }, { type: 'BASELINE', rtMs: [...baseline] },
    { type: 'SIGN_POSE', keypoints: structuredClone(keypoints) }, { type: 'RING' },
    { type: 'SNOOZE' }, { type: 'AMEND', time: '07:05' }, { type: 'RING' },
    { type: 'REQUEST_CLOSE' }, { type: 'POSE_ATTEMPT', keypoints: structuredClone(keypoints) },
    { type: 'ALERTNESS', rtMs: [...baseline] }, { type: 'ANSWER', value: 43 }, { type: 'CONFIRM_CLOSE' },
  ];
  for (const [nowMs, event] of events.entries()) {
    deepFreeze(state);
    deepFreeze(event);
    const next = transition(state, event, nowMs);
    assert.notEqual(next, state);
    assert.deepEqual(next, transition(state, event, nowMs));
    state = next;
  }
  assert.equal(state.receipt.outcome, 'completed');

  const points = [[0, 0]];
  const samples = [...baseline];
  const armed = send(send(signed(), 'SIGN_POSE', 0, { keypoints: points }), 'BASELINE', 0, { rtMs: samples });
  samples.fill(500);
  points[0][0] = 1;
  assert.deepEqual(armed.baseline, baseline);
  const pose = send(send(armed, 'RING'), 'REQUEST_CLOSE');
  assert.equal(send(pose, 'POSE_ATTEMPT', 0, { keypoints: [[0, 0]] }).pose.lastScore, 1);
});
