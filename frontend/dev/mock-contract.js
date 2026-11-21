// 前端开发替身。真实判定在 backend/judge.js，由成员 3 提供。
export const PHASES = Object.freeze([
  'signing', 'armed', 'ringing', 'amending', 'snoozed',
  'pose', 'alertness', 'quiz', 'acceptance', 'done',
]);

const timedPhases = {
  ringing: 'ringingMs',
  amending: 'procedureMs',
  pose: 'taskMs',
  alertness: 'taskMs',
  quiz: 'taskMs',
  acceptance: 'procedureMs',
};

const allowedEvents = {
  signing: ['SIGN'],
  armed: ['BASELINE', 'SIGN_POSE', 'RING'],
  ringing: ['SNOOZE', 'REQUEST_CLOSE', 'REQUEST_POLICY_CHANGE'],
  amending: ['AMEND', 'REQUEST_CLOSE', 'REQUEST_POLICY_CHANGE'],
  snoozed: ['RING'],
  pose: ['POSE_ATTEMPT', 'POSE_UNAVAILABLE'],
  alertness: ['ALERTNESS'],
  quiz: ['ANSWER'],
  acceptance: ['KEEP_SUPERVISING', 'CONFIRM_CLOSE'],
  done: [],
};

const questions = [[17, 26], [38, 19], [24, 48]];
const ALERT_FACTOR = 1.3;
const POSE_THRESHOLD = 0.8;

function coordinates(point) {
  const [x, y] = Array.isArray(point) ? point : [point?.x, point?.y];
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

const judge = {
  median(nums) {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },

  isAlert(baseline, morning, factor = ALERT_FACTOR) {
    const baselineMedianMs = judge.median(baseline);
    const morningMedianMs = judge.median(morning);
    return { alert: morningMedianMs <= baselineMedianMs * factor, baselineMedianMs, morningMedianMs };
  },

  poseSimilarity(signed, attempt) {
    if (!Array.isArray(signed) || !Array.isArray(attempt) ||
        !signed.length || signed.length !== attempt.length) return 0;

    // 使用画幅归一化的 x/y。平均位移除以单位画幅对角线，完全重合得 1。
    let totalDistance = 0;
    for (let i = 0; i < signed.length; i++) {
      const from = coordinates(signed[i]);
      const to = coordinates(attempt[i]);
      if (!from || !to) return 0;
      totalDistance += Math.hypot(from[0] - to[0], from[1] - to[1]);
    }
    return Math.max(0, 1 - totalDistance / signed.length / Math.SQRT2);
  },
};

function validTime(time) {
  return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function addMinutes(hhmm, minutes) {
  if (!validTime(hhmm) || !Number.isInteger(minutes)) return null;
  const [hour, minute] = hhmm.split(':').map(Number);
  const total = ((hour * 60 + minute + minutes) % 1440 + 1440) % 1440;
  return [Math.floor(total / 60), total % 60].map(n => String(n).padStart(2, '0')).join(':');
}

export function initialState() {
  return {
    phase: 'signing',
    contract: null,
    currentTime: null,
    snoozeCount: 0,
    amendTarget: null,
    amendments: [],
    quiz: null,
    wrongAnswers: 0,
    keepSupervisingCount: 0,
    baseline: null,
    alertness: null,
    pose: null,
    pendingPolicyChange: null,
    forceMajeureNote: null,
    error: null,
    receipt: null,
    _clock: {},
  };
}

function validReactionSet(rtMs) {
  return Array.isArray(rtMs) && rtMs.length === 5 &&
    Array.from(rtMs).every(ms => Number.isFinite(ms) && ms >= 0);
}

// 仅在阶段切换时结算。错答、重试和继续监督保留原进入时刻。
function enter(next, phase, nowMs) {
  const clock = next._clock;
  const bucket = timedPhases[next.phase];
  if (bucket) clock[bucket] = (clock[bucket] ?? 0) + (nowMs - clock.enteredAt);
  clock.enteredAt = nowMs;
  next.phase = phase;
  next.amendTarget = phase === 'amending' ? addMinutes(next.currentTime, 5) : null;
  next.quiz = null;
  if (phase === 'quiz') {
    const index = clock.nextQuestion ?? 0;
    const [a, b] = questions[index];
    next.quiz = { a, b, min: 0, max: 100 };
    clock.nextQuestion = (index + 1) % questions.length;
  }
  return next;
}

function approveSnooze(next, time, nowMs) {
  next.currentTime = time;
  next.snoozeCount++;
  return enter(next, 'snoozed', nowMs);
}

function finish(next, outcome, nowMs) {
  enter(next, 'done', nowMs);
  const { contract, alertness, pose, _clock } = next;
  next.receipt = {
    outcome,
    originalTime: contract.time,
    finalTime: next.currentTime,
    reason: contract.reason,
    policy: contract.policy,
    snoozeCount: next.snoozeCount,
    amendments: next.amendments.map(entry => ({ ...entry })),
    taskMs: _clock.taskMs ?? 0,
    procedureMs: _clock.procedureMs ?? 0,
    ringingMs: _clock.ringingMs ?? 0,
    wrongAnswers: next.wrongAnswers,
    keepSupervisingCount: next.keepSupervisingCount,
    alertness: alertness && {
      baselineMedianMs: judge.median(next.baseline),
      morningMedianMs: alertness.lastMedianMs,
      attempts: alertness.attempts,
      label: alertness.label,
    },
    pose: pose && { attempts: pose.attempts, lastScore: pose.lastScore, fallback: pose.fallback },
    pendingPolicyChange: next.pendingPolicyChange,
    forceMajeureNote: next.forceMajeureNote,
  };
  return next;
}

export function transition(state, event, nowMs) {
  const type = event?.type;
  if (type === 'RESET') return initialState();

  const { phase } = state;
  const next = structuredClone(state);
  next.error = null;
  const reject = error => ({ ...next, error });

  if (type === 'FORCE_MAJEURE' && timedPhases[phase]) {
    const note = event.note === undefined ? '' : event.note;
    if (typeof note !== 'string') return reject('EVENT_NOT_ALLOWED');
    next.forceMajeureNote = note;
    return finish(next, 'force_majeure', nowMs);
  }
  if (!allowedEvents[phase].includes(type)) return reject('EVENT_NOT_ALLOWED');

  switch (type) {
    case 'SIGN': {
      if (!validTime(event.time)) return reject('INVALID_TIME');
      if (typeof event.reason !== 'string' || !event.reason.trim()) return reject('EMPTY_REASON');
      if (!['one_snooze', 'amend_first'].includes(event.policy)) return reject('INVALID_POLICY');
      next.contract = { time: event.time, reason: event.reason.trim(), policy: event.policy };
      next.currentTime = event.time;
      return enter(next, 'armed', nowMs);
    }
    case 'BASELINE':
      if (!validReactionSet(event.rtMs)) return reject('EVENT_NOT_ALLOWED');
      next.baseline = [...event.rtMs];
      next.alertness = { attempts: 0, lastMedianMs: null, label: null };
      return next;
    case 'SIGN_POSE':
      if (event.keypoints == null) return reject('EVENT_NOT_ALLOWED');
      try {
        // 原样留存于私有状态；关键点格式只由 judge 解释。
        next._clock.signedKeypoints = structuredClone(event.keypoints);
      } catch {
        return reject('EVENT_NOT_ALLOWED');
      }
      next.pose = { signed: true, attempts: 0, lastScore: null, fallback: false };
      return next;
    case 'RING':
      return enter(next, 'ringing', nowMs);
    case 'SNOOZE':
      if (next.contract.policy === 'one_snooze' && next.snoozeCount === 0) {
        return approveSnooze(next, addMinutes(next.currentTime, 5), nowMs);
      }
      return enter(next, 'amending', nowMs);
    case 'AMEND':
      if (!validTime(event.time)) return reject('INVALID_TIME');
      if (event.time !== next.amendTarget) return reject('AMEND_WRONG_TIME');
      next.amendments.push({ from: next.currentTime, to: event.time });
      return approveSnooze(next, event.time, nowMs);
    case 'REQUEST_POLICY_CHANGE':
      if (next.contract.policy !== 'amend_first') return reject('EVENT_NOT_ALLOWED');
      next.pendingPolicyChange = 'one_snooze';
      return next;
    case 'REQUEST_CLOSE':
      if (next.pose?.signed) return enter(next, 'pose', nowMs);
      return enter(next, next.baseline ? 'alertness' : 'quiz', nowMs);
    case 'POSE_ATTEMPT': {
      const pose = next.pose;
      pose.lastScore = judge.poseSimilarity(next._clock.signedKeypoints, event.keypoints);
      if (pose.lastScore < POSE_THRESHOLD) {
        pose.attempts++;
        if (pose.attempts < 3) return next;
        pose.fallback = true;
      }
      return enter(next, next.baseline ? 'alertness' : 'quiz', nowMs);
    }
    case 'POSE_UNAVAILABLE':
      next.pose.fallback = true;
      return enter(next, next.baseline ? 'alertness' : 'quiz', nowMs);
    case 'ALERTNESS': {
      if (!validReactionSet(event.rtMs)) return reject('EVENT_NOT_ALLOWED');
      const result = judge.isAlert(next.baseline, event.rtMs);
      next.alertness.lastMedianMs = result.morningMedianMs;
      if (!result.alert) {
        next.alertness.attempts++;
        if (next.alertness.attempts < 3) return next;
      }
      next.alertness.label = result.alert ? '清醒' : '勉强清醒';
      return enter(next, 'quiz', nowMs);
    }
    case 'ANSWER':
      if (event.value !== next.quiz.a + next.quiz.b) {
        next.wrongAnswers++;
        return reject('WRONG_ANSWER');
      }
      return enter(next, 'acceptance', nowMs);
    case 'KEEP_SUPERVISING':
      next.keepSupervisingCount++;
      return next;
    case 'CONFIRM_CLOSE':
      return finish(next, 'completed', nowMs);
  }
}
