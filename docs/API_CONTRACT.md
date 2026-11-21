# 接口契约（代码级）

> 状态：v1，2026-11-21 由成员 1 发布。本文是 [WAKE_CONTRACT_PLAN.md](WAKE_CONTRACT_PLAN.md)「实现约定与联调」的精确版本，**写代码以本文为准**。需要改契约时：先改本文、开 PR、在群里通知相关成员，不能只改代码。
>
> 谁写谁用：`backend/contract.js` 由成员 2 写、成员 1 用；`backend/judge.js` 由成员 3 写、成员 2 用；`frontend/deep/*` 由成员 3 写、成员 1 用；`api/rebut.js` 由成员 3 写，前端只通过 `frontend/deep/rebut.js` 调用。

## 0. 总原则

- 全部是浏览器原生 ES 模块，不用框架，不用构建。导入路径带 `.js` 后缀。
- `transition` 是**纯函数**：不改入参、不读 `Date.now()`、不碰 DOM 和声音、不发网络请求。时间只来自参数 `nowMs`（前端统一传 `performance.now()`）。
- 非法事件**不抛异常**：返回同一阶段，`error` 填上错误码。合法事件会把 `error` 清成 `null`。
- 前端只按 `state.phase` 画界面，能不能前进由 `transition` 决定。

## 1. `backend/contract.js`（成员 2）

```js
export function initialState()                       // → State，phase = 'signing'
export function transition(state, event, nowMs)      // → 新 State（不修改旧对象）
export function addMinutes(hhmm, minutes)            // '23:58', 5 → '00:03'
export const PHASES                                  // 下表全部阶段名的数组
```

### 1.1 阶段 `phase`

| 值 | 中文 | 前端放铃声？ |
| --- | --- | --- |
| `signing` | 签约 | 否 |
| `armed` | 已签约、待响（可在此录基线 / 姿势） | 否 |
| `ringing` | 响铃 | **是** |
| `amending` | 修订合同 | **是** |
| `snoozed` | 延后（模拟睡眠，不计时） | 否 |
| `pose` | 动作签名（深化 4，只在录过姿势时出现） | **是** |
| `alertness` | 清醒测试（深化 1，只在录过基线时出现） | **是** |
| `quiz` | 滑块答题 | **是** |
| `acceptance` | 验收 | **是** |
| `done` | 完成，展示回执 | 否 |

铃声规则：上表"是"的阶段之间切换时，保持同一个声音实例不重启；进入"否"的阶段立即停响。

### 1.2 `State` 字段

```js
{
  phase: 'signing',
  contract: null,          // 签约后：{ time: '07:00', reason: '八点接室友', policy: 'one_snooze' | 'amend_first' }
  currentTime: null,       // 当前约定时间 'HH:mm'，签约时等于 contract.time
  snoozeCount: 0,          // 已获准的贪睡次数（直接贪睡 + 修订后贪睡）
  amendTarget: null,       // 修订页要求改到的时间 = currentTime + 5 分钟；不在修订阶段时为 null
  amendments: [],          // [{ from: '07:05', to: '07:10' }]
  quiz: null,              // 答题阶段：{ a: 17, b: 26, min: 0, max: 100 }。不下发答案
  wrongAnswers: 0,
  keepSupervisingCount: 0, // 验收页点「继续监督」的次数
  baseline: null,          // 深化 1：签约时的 5 次反应时间 rtMs[]
  alertness: null,         // 深化 1：{ attempts: 0, lastMedianMs: null, label: null | '清醒' | '勉强清醒' }
  pose: null,              // 深化 4：{ signed: true, attempts: 0, lastScore: null, fallback: false }
  pendingPolicyChange: null, // 深化 3：'one_snooze'，标注"明日生效"，本次不生效
  forceMajeureNote: null,
  error: null,             // null 或错误码字符串，见 1.4
  receipt: null,           // 进入 done 时生成，见 1.5
  _clock: {}               // 成员 2 内部计时用，前端不要读
}
```

### 1.3 事件（全部是 `{ type, ...payload }` 对象）

| 事件 | 允许的阶段 | 结果 |
| --- | --- | --- |
| `{ type: 'SIGN', time, reason, policy }` | `signing` | 校验通过 → `armed`，`currentTime = time`。`time` 须为 `HH:mm`，`reason` 去掉首尾空格后非空，`policy` 只能是两个值之一 |
| `{ type: 'BASELINE', rtMs: number[] }` | `armed` | 记 `baseline`。之后的关闭流程会加入 `alertness` |
| `{ type: 'SIGN_POSE', keypoints }` | `armed` | 记签名姿势。之后的关闭流程会加入 `pose`。`keypoints` 格式由成员 3 定，`contract.js` 只存不解析 |
| `{ type: 'RING' }` | `armed`、`snoozed` | → `ringing` |
| `{ type: 'SNOOZE' }` | `ringing` | `one_snooze` 且 `snoozeCount === 0`：→ `snoozed`，`currentTime += 5`，`snoozeCount++`。其他情况：→ `amending`，`amendTarget = currentTime + 5` |
| `{ type: 'AMEND', time }` | `amending` | `time === amendTarget`：→ `snoozed`，`currentTime = time`，`snoozeCount++`，记入 `amendments`。否则留在 `amending`，`error = 'AMEND_WRONG_TIME'` |
| `{ type: 'REQUEST_CLOSE' }` | `ringing`、`amending` | 录过姿势 → `pose`；否则录过基线 → `alertness`；否则 → `quiz` |
| `{ type: 'POSE_ATTEMPT', keypoints }` | `pose` | 调用 `judge.poseSimilarity`。达到 `POSE_THRESHOLD` → 下一步（录过基线进 `alertness`，否则进 `quiz`）。不达标 `attempts++`，第 3 次失败时 `fallback = true`，转 `alertness`（没有基线就转 `quiz`） |
| `{ type: 'POSE_UNAVAILABLE' }` | `pose` | 没有摄像头或拒绝授权：`fallback = true`，处理同上面的第 3 次失败 |
| `{ type: 'ALERTNESS', rtMs: number[] }` | `alertness` | 调用 `judge.isAlert(baseline, rtMs)`。达标 → `quiz`，`label = '清醒'`。不达标 `attempts++`；第 3 次仍不达标 → `quiz`，`label = '勉强清醒'` |
| `{ type: 'ANSWER', value: number }` | `quiz` | `value === a + b` → `acceptance`；否则留在 `quiz`，`wrongAnswers++`，`error = 'WRONG_ANSWER'` |
| `{ type: 'KEEP_SUPERVISING' }` | `acceptance` | 留在 `acceptance`，`keepSupervisingCount++`（前端回到验收说明） |
| `{ type: 'CONFIRM_CLOSE' }` | `acceptance` | → `done`，生成 `receipt`，`outcome = 'completed'` |
| `{ type: 'FORCE_MAJEURE', note }` | 所有放铃声的阶段 | → `done`，生成 `receipt`，`outcome = 'force_majeure'`，`note` 可为空字符串 |
| `{ type: 'REQUEST_POLICY_CHANGE' }` | `ringing`、`amending`，且当前是 `amend_first` | `pendingPolicyChange = 'one_snooze'`，阶段不变，本次仍按严格执行 |
| `{ type: 'RESET' }` | 任意 | 返回 `initialState()` |

题目：第一次进入 `quiz` 固定为 17 + 26（联调用例）。之后可以从题库按顺序取，但必须是确定的（同样的事件序列得到同样的题），不要用 `Math.random()`。

### 1.4 错误码

| 码 | 什么时候 |
| --- | --- |
| `INVALID_TIME` | `SIGN` / `AMEND` 的时间不是合法 `HH:mm` |
| `EMPTY_REASON` | 签约理由为空 |
| `INVALID_POLICY` | `policy` 不是两个合法值之一 |
| `AMEND_WRONG_TIME` | 修订时间不等于 `amendTarget` |
| `WRONG_ANSWER` | 滑块答案错误 |
| `EVENT_NOT_ALLOWED` | 当前阶段不接受这个事件 |

提示文案由成员 1 在前端按错误码写，`contract.js` 只给码。

### 1.5 回执 `receipt`

```js
{
  outcome: 'completed' | 'force_majeure',
  originalTime: '07:00',
  finalTime: '07:10',
  reason: '八点接室友',
  policy: 'amend_first',
  snoozeCount: 2,
  amendments: [{ from: '07:05', to: '07:10' }],
  taskMs: 0,          // 清醒任务耗时：pose + alertness + quiz 阶段的时长
  procedureMs: 0,     // 手续耗时：amending + acceptance 阶段的时长
  ringingMs: 0,       // 响铃阶段本身的时长
  wrongAnswers: 0,
  keepSupervisingCount: 0,
  alertness: null,    // 深化 1：{ baselineMedianMs, morningMedianMs, attempts, label }
  pose: null,         // 深化 4：{ attempts, lastScore, fallback }
  pendingPolicyChange: null,
  forceMajeureNote: null
}
```

`snoozed` 阶段（模拟睡眠）不计入任何耗时。

## 2. `backend/judge.js`（成员 3 写，成员 2 导入）

只放纯函数，不碰 DOM、摄像头和网络。**成员 3 先推一个能导入的空实现**（函数签名正确、返回合理默认值），成员 2 就不会被卡住。

```js
export const ALERT_FACTOR = 1.3;
export const POSE_THRESHOLD = 0.8;                // 成员 3 实测后可调，改了在群里说
export function median(nums)                     // → number
export function isAlert(baselineRtMs, morningRtMs, factor = ALERT_FACTOR)
                                                 // → { alert: boolean, baselineMedianMs, morningMedianMs }
export function poseSimilarity(signedKeypoints, attemptKeypoints)
                                                 // → 0..1
```

## 3. `frontend/deep/*`（成员 3 写，成员 1 挂载）

每个深化模块是一个独立文件，导出挂载函数。成员 1 在对应阶段调用一次，拿到结果后自己发事件给 `transition`；深化模块**不导入** `contract.js`。模块没写完时，成员 1 用 `import()` 动态加载，加载失败就跳过这一层。

```js
// frontend/deep/reaction.js（深化 1）
export function mountReactionTest(container, {
  mode,           // 'baseline'（签约时，画面清晰）| 'morning'（早上，模糊晃动）
  trials = 5,
  onDone          // (rtMs: number[]) => void
})                // → unmount(): void

// frontend/deep/rebut.js（深化 2）
export async function requestRebuttal({ reason, excuse }, { timeoutMs = 8000 } = {})
                  // → { reply: string, source: 'ai' | 'fallback' }，永不 reject
                  // 失败或超时时 reply = `你昨晚说：${reason}`

// frontend/deep/pose.js（深化 4，21:00 决定做不做）
export function mountPoseCapture(container, {
  mode,           // 'sign' | 'attempt'
  onDone,         // (keypoints) => void
  onUnavailable   // (reason: 'no_camera' | 'denied' | 'model_failed') => void
})                // → unmount(): void
```

前端收到 `onDone` 后发对应事件：`baseline` → `BASELINE`；`morning` → `ALERTNESS`；`sign` → `SIGN_POSE`；`attempt` → `POSE_ATTEMPT`；`onUnavailable` → `POSE_UNAVAILABLE`。AI 回复只显示，不发给 `transition`。

## 4. `api/rebut.js`（成员 3）

```
POST /api/rebut
请求：{ "reason": "签约理由", "excuse": "早上的借口" }
响应：200 { "reply": "...", "source": "ai" | "fallback" }
```

服务端自己也要兜底：缺密钥、上游报错或超时，都返回 200 和 `source: "fallback"`，不返回 5xx。密钥只从 `process.env.AIHUBMIX_API_KEY` 读。

## 5. 「查看设计逻辑」卡片

成员 1 在每个机制的容器上加 `data-mechanism="<id>"`，打开开关后在旁边显示卡片。卡片文案由成员 4 写在 `pitch/design-notes.md`，按下面的 id 分节；成员 1 搬进 `frontend/design-notes.js`。

| id | 机制 |
| --- | --- |
| `close-intent` | 关闭只登记意向 |
| `slider-quiz` | 滑块提交算术答案 |
| `acceptance-exit` | 认证后仍需验收 |
| `amend-contract` | 严格合同修订 |
| `alertness-test` | 个性化清醒认证（深化 1） |
| `ai-counterparty` | AI 甲方（深化 2） |
| `pose-signature` | 动作签名（深化 4） |
| `force-majeure` | 不可抗力 |

每张卡片 3 行：**故意违反的 UX 原则** / **为什么这样设计** / **用户怎么通关**。内容和 [ENGINEERING.md](ENGINEERING.md) 第 8 节保持一致。

## 6. 联调用例（成员 2 写进 `contract.test.js`，成员 1 手动跑一遍）

1. 宽松：`SIGN 07:00 one_snooze` → `RING` → `SNOOZE` 得 `snoozed`、`07:05` → `RING` → `SNOOZE` 得 `amending`、`amendTarget = '07:10'`。
2. 严格：`SIGN 07:00 amend_first` → `RING` → `SNOOZE` 得 `amending`、`amendTarget = '07:05'`；`AMEND 07:04` 得 `AMEND_WRONG_TIME`；`AMEND 07:05` 得 `snoozed`。
3. 跨日：`SIGN 23:58 amend_first` → `RING` → `SNOOZE` 得 `amendTarget = '00:03'`。
4. 直接关闭：`REQUEST_CLOSE` 得 `quiz {a:17,b:26}`；`ANSWER 42` 留在 `quiz`；`ANSWER 43` 得 `acceptance`；`KEEP_SUPERVISING` 仍在 `acceptance`；`CONFIRM_CLOSE` 得 `done`，回执 `outcome = 'completed'`。
5. 不可抗力：任一放铃声的阶段 `FORCE_MAJEURE` 得 `done`，回执 `outcome = 'force_majeure'`。
6. 非法事件：`signing` 阶段发 `RING` 得 `EVENT_NOT_ALLOWED`，阶段不变。
7. 计时：给定 `nowMs` 序列，`snoozed` 期间的时长不计入 `taskMs` 和 `procedureMs`。
