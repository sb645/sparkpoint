// 浏览器直接导入此模块。每次点击传入 { type, ...字段 } 和 performance.now()。
// phase: signing → armed → ringing；按合同进入 amending / snoozed，
// 或经 answering → review → done。选择「继续监督」时留在 review。
export function initialState() {
  return {
    phase: "signing",
    originalContract: null,
    currentTime: null,
    dayOffset: 0,
    snoozeCount: 0,
    taskMs: 0,
    paperworkMs: 0,
    phaseStartedAtMs: null,
    error: null,
    receipt: null,
  };
}

function enter(state, phase, nowMs) {
  const elapsed = state.phaseStartedAtMs === null ? 0 : nowMs - state.phaseStartedAtMs;
  return {
    ...state,
    phase,
    phaseStartedAtMs: nowMs,
    error: null,
    taskMs: state.taskMs + (state.phase === "answering" ? elapsed : 0),
    paperworkMs: state.paperworkMs + (["amending", "review"].includes(state.phase) ? elapsed : 0),
  };
}

function fiveMinutesLater(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = (hours * 60 + minutes + 5) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return hh + ":" + mm;
}

function approveSnooze(state, time, nowMs) {
  return {
    ...enter(state, "snoozed", nowMs),
    currentTime: time,
    // HH:mm 固定为两位；加五分钟后时间变小，表示跨过了午夜。
    dayOffset: state.dayOffset + (time < state.currentTime ? 1 : 0),
    snoozeCount: state.snoozeCount + 1,
  };
}

function finish(state, nowMs, outcome, note = "") {
  const done = enter(state, "done", nowMs);
  return {
    ...done,
    receipt: {
      originalContract: { ...done.originalContract },
      finalTime: done.currentTime,
      dayOffset: done.dayOffset,
      snoozeCount: done.snoozeCount,
      taskMs: done.taskMs,
      paperworkMs: done.paperworkMs,
      outcome,
      note,
    },
  };
}

// 返回新状态；点错阶段时保持原状，表单输入有误时用 error 提示。
export function transition(state, event, nowMs) {
  if (event?.type === "RESET") return initialState();
  if (!Number.isFinite(nowMs) || nowMs < (state.phaseStartedAtMs ?? 0)) return state;

  switch (event?.type) {
    case "SIGN": {
      if (state.phase !== "signing") return state;
      const { time, reason, policy } = event;
      if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return { ...state, error: "请输入 24 小时制起床时间（HH:mm）。" };
      }
      if (typeof reason !== "string" || !reason.trim()) {
        return { ...state, error: "请写下明早起床的理由。" };
      }
      if (!["one_snooze", "amend_first"].includes(policy)) {
        return { ...state, error: "请选择一份合同条款。" };
      }
      return {
        ...enter(state, "armed", nowMs),
        originalContract: { time, reason, policy },
        currentTime: time,
      };
    }
    case "RING":
      if (state.phase !== "armed" && state.phase !== "snoozed") return state;
      return enter(state, "ringing", nowMs);

    case "SNOOZE":
      if (state.phase !== "ringing") return state;
      if (state.originalContract.policy === "one_snooze" && state.snoozeCount === 0) {
        return approveSnooze(state, fiveMinutesLater(state.currentTime), nowMs);
      }
      return enter(state, "amending", nowMs);

    case "AMEND":
      if (state.phase !== "amending") return state;
      if (event.time !== fiveMinutesLater(state.currentTime)) {
        return { ...state, error: "请将当前约定时间推迟五分钟。" };
      }
      return approveSnooze(state, event.time, nowMs);

    case "REQUEST_CLOSE":
      if (state.phase !== "ringing") return state;
      return enter(state, "answering", nowMs);

    case "ANSWER":
      if (state.phase !== "answering") return state;
      // 首次联调固定题为 17 + 26。HTML range 的 value 是字符串。
      if (event.value !== 43 && event.value !== "43") {
        return { ...state, error: "答案不对，请调整滑块后重试。" };
      }
      return enter(state, "review", nowMs);

    case "CONFIRM_CLOSE":
      if (state.phase !== "review") return state;
      return finish(state, nowMs, "履约完成");

    case "FORCE_MAJEURE":
      if (!["ringing", "amending", "answering", "review"].includes(state.phase)) return state;
      return finish(state, nowMs, "不可抗力豁免", typeof event.note === "string" ? event.note : "");

    default:
      return state;
  }
}
