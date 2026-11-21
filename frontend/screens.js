// 每个阶段一个渲染函数：输入合同状态 state 和界面本地状态 ui，返回 HTML 字符串。
// 这里不做判断“能不能前进”，那是 contract.js 的事；这里只负责把状态画出来。
// 按钮用 data-action，表单用 data-form，事件统一在 app.js 里处理。

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const POLICY_TEXT = {
  one_snooze: {
    name: '宽松条款',
    rule: '允许直接贪睡一次。',
    morning: '明早第一次点「再睡五分钟」直接批准；第二次起要修订合同。',
  },
  amend_first: {
    name: '严格条款',
    rule: '每次改时间都必须先修订合同。',
    morning: '明早点「再睡五分钟」，要先看到你今晚写的理由，再亲手改约定时间。',
  },
};

export function median(nums) {
  if (!Array.isArray(nums) || nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 秒';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

function errorText(state, ui) {
  switch (state.error) {
    case null: case undefined: return '';
    case 'INVALID_TIME': return '时间格式不对，请用 24 小时制，例如 07:00。';
    case 'EMPTY_REASON': return '写一句明早必须起床的理由。早上拦住你的，就是这句话。';
    case 'INVALID_POLICY': return '选一种贪睡条款：宽松或严格。';
    case 'AMEND_WRONG_TIME':
      return `修订时间应为当前约定 ${state.currentTime} 加 5 分钟，也就是 ${state.amendTarget}。`;
    case 'WRONG_ANSWER':
      return `答案不对，再算一遍。已答错 ${state.wrongAnswers} 次，题目不变。`;
    case 'EVENT_NOT_ALLOWED': return '这一步现在不能做，请按页面上的按钮继续。';
    default: return `操作没有生效（${esc(state.error)}），请重试。`;
  }
}

function errorBlock(state, ui) {
  const text = errorText(state, ui);
  return text ? `<p class="notice-error" role="alert" id="form-error">${text}</p>` : '';
}

function contractNo(state) {
  const c = state.contract;
  if (!c) return '合同编号：签约后生成';
  return `合同编号：ZW-${c.time.replace(':', '')}-${c.policy === 'amend_first' ? 'S' : 'L'}`;
}

function head(title, state) {
  return `
    <header class="doc-head">
      <h1 class="doc-title" tabindex="-1">${title}</h1>
      <p class="doc-no">${contractNo(state)}</p>
    </header>`;
}

const PARTIES = `
  <div class="parties">
    <p><b>甲方</b>昨晚的我</p>
    <p><b>乙方</b>今早的我</p>
  </div>`;

export function seal(bottom = '合同专用章', { stamping = false, party = '甲方（签章）', signer = '昨晚的我' } = {}) {
  return `
    <div class="signoff">
      <p class="signoff-line">${esc(party)}<span class="signoff-name">${esc(signer)}</span></p>
      <svg class="seal${stamping ? ' is-stamping' : ''}" viewBox="0 0 120 120" role="img" aria-label="昨晚的我有限公司 ${esc(bottom)}">
        <defs><path id="seal-arc" d="M 20 62 A 40 40 0 1 1 100 62" /></defs>
        <circle cx="60" cy="60" r="55" fill="none" stroke="currentColor" stroke-width="4" />
        <text fill="currentColor" font-size="12.5" style="font-family: var(--font-print); font-weight: 700">
          <textPath href="#seal-arc" startOffset="50%" text-anchor="middle" letter-spacing="2">昨晚的我有限公司</textPath>
        </text>
        <polygon fill="currentColor" points="60,44 63.29,53.47 73.31,53.67 65.33,59.73 68.23,69.33 60,63.6 51.77,69.33 54.67,59.73 46.69,53.67 56.71,53.47" />
        <text x="60" y="91" fill="currentColor" font-size="10.5" text-anchor="middle" style="font-family: var(--font-print); font-weight: 700">${esc(bottom)}</text>
      </svg>
    </div>`;
}

function signedTerms(state) {
  const c = state.contract;
  const p = POLICY_TEXT[c.policy];
  return `
    <section class="clause">
      <h2 class="clause-title"><span class="no">第一条</span>起床时间</h2>
      <p class="hand" style="font-size: var(--step-2); margin: 0">${esc(c.time)}</p>
    </section>
    <section class="clause">
      <h2 class="clause-title"><span class="no">第二条</span>明早必须起床的理由</h2>
      <p class="hand" style="font-size: var(--step-2); margin: 0">${esc(c.reason)}</p>
    </section>
    <section class="clause">
      <h2 class="clause-title"><span class="no">第三条</span>贪睡条款</h2>
      <p style="margin: 0">${p.name}：${p.rule}</p>
    </section>`;
}

// ---------------- 签约 ----------------
function signing(state, ui) {
  const d = ui.draft;
  const policy = (key) => {
    const p = POLICY_TEXT[key];
    return `
      <label class="policy">
        <input type="radio" name="policy" value="${key}" ${d.policy === key ? 'checked' : ''} data-key="policy-${key}">
        <span class="policy-name">${p.name}</span>
        <span class="policy-rule">${p.rule}</span>
        <span class="policy-morning">${p.morning}</span>
      </label>`;
  };
  return `
    ${head('起床合同', state)}
    ${PARTIES}
    <p class="lede">趁现在还清醒，替明早的自己做决定。明早想反悔的人，也是你。</p>
    <form data-form="sign" novalidate>
      <section class="clause">
        <h2 class="clause-title"><span class="no">第一条</span>起床时间</h2>
        <label class="field">
          <span class="field-label">明早几点起床（24 小时制，例如 07:00）</span>
          <input class="input input-time" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" name="time" value="${esc(d.time)}" required data-key="time">
        </label>
      </section>
      <section class="clause">
        <h2 class="clause-title"><span class="no">第二条</span>明早必须起床的理由</h2>
        <label class="field">
          <span class="field-label">写一句话。明早想贪睡时，你会再看到它。</span>
          <input class="input hand" type="text" name="reason" value="${esc(d.reason)}" maxlength="40" autocomplete="off" placeholder="八点去接室友" required data-key="reason">
        </label>
      </section>
      <section class="clause">
        <fieldset class="policies">
          <legend class="clause-title"><span class="no">第三条</span>贪睡条款（二选一）</legend>
          ${policy('one_snooze')}
          ${policy('amend_first')}
        </fieldset>
      </section>
      ${errorBlock(state, ui)}
      <div class="actions">
        <button class="btn btn-primary" type="submit" data-key="sign">签字并盖章</button>
      </div>
    </form>`;
}

// ---------------- 已签约，待响 ----------------
function armed(state, ui) {
  const base = median(state.baseline);
  const baselineLine = base
    ? `<p class="notice-ok">已记录清醒基线：反应时间中位数 ${Math.round(base)} 毫秒。明早要达到 ${Math.round(base * 1.3)} 毫秒以内。</p>`
    : `<p class="muted" style="margin: 0 0 .5rem">花 10 秒做 5 次反应测试，记下你现在清醒时的速度。明早拿它当标准。</p>
       <button class="btn btn-secondary" type="button" data-action="baseline" data-key="baseline">做反应测试</button>`;
  const poseLine = state.pose?.signed
    ? `<p class="notice-ok">已记录起床暗号姿势。明早关闭闹钟前要复现它。</p>`
    : `<p class="muted" style="margin: 0 0 .5rem">对着摄像头摆一个自己的起床暗号姿势。画面只在本机处理，不上传、不保存。</p>
       <button class="btn btn-secondary" type="button" data-action="sign-pose" data-key="sign-pose">录动作签名</button>`;
  return `
    ${head('起床合同', state)}
    ${PARTIES}
    ${signedTerms(state)}
    ${seal('合同专用章', { stamping: ui.justSigned })}
    <section class="clause" data-deep="attachments">
      <h2 class="clause-title">附件（可选）</h2>
      <div data-mechanism="alertness-test">
        ${baselineLine}
        <div class="deep-slot" id="slot-baseline"></div>
        <p class="notice-error" id="deep-error-baseline" hidden></p>
      </div>
      ${ui.poseAvailable === false ? '' : `
      <div data-mechanism="pose-signature" style="margin-top: 1.25rem">
        ${poseLine}
        <div class="deep-slot" id="slot-pose"></div>
        <p class="notice-error" id="deep-error-pose" hidden></p>
      </div>`}
    </section>
    <div class="actions">
      <button class="btn btn-primary" type="button" data-action="next-day" data-key="next-day">合同生效，进入第二天早上</button>
    </div>`;
}

// ---------------- 响铃 ----------------
function ringing(state, ui) {
  const c = state.contract;
  const policyChange = c.policy === 'amend_first'
    ? (state.pendingPolicyChange
        ? `<p class="notice-ok">条款变更已受理：明日起改为宽松条款。本次仍按严格条款执行。</p>`
        : `<p style="margin-top: 1.5rem"><button class="btn-text" type="button" data-action="policy-change" data-key="policy-change">申请改为宽松条款</button></p>`)
    : '';
  return `
    ${head('履约通知', state)}
    <p class="ring-flag">闹钟响铃中</p>
    <p class="clock">
      <span class="clock-time">${esc(state.currentTime)}</span>
      <span class="clock-label">${state.snoozeCount ? `约定起床时间（原定 ${esc(c.time)}，已贪睡 ${state.snoozeCount} 次）` : '约定起床时间'}</span>
    </p>
    <div class="ring-actions" data-mechanism="close-intent">
      <button class="btn btn-secondary" type="button" data-action="snooze" data-key="snooze">再睡五分钟</button>
      <button class="btn btn-primary" type="button" data-action="close" data-key="close">关闭闹钟</button>
    </div>
    ${policyChange}`;
}

// ---------------- 修订 ----------------
function amending(state, ui) {
  const c = state.contract;
  const why = c.policy === 'amend_first'
    ? '按你签的严格条款，改时间要先修订合同。'
    : `宽松条款只允许直接贪睡一次，这是第 ${state.snoozeCount + 1} 次，需要修订合同。`;
  const reply = ui.rebuttal
    ? `<div class="quote" aria-live="polite">
         <p class="quote-label">${ui.rebuttal.source === 'ai' ? '昨晚的你回复' : '昨晚的你没空回复，只留下这句话'}</p>
         <p class="quote-text">${esc(ui.rebuttal.reply)}</p>
       </div>`
    : '';
  return `
    ${head('合同修订单', state)}
    <p class="ring-flag">闹钟响铃中</p>
    <p class="lede">你申请再睡五分钟。${why}</p>
    <div class="quote">
      <p class="quote-label">你昨晚写下的理由</p>
      <p class="quote-text">${esc(c.reason)}</p>
    </div>
    <section class="clause" data-mechanism="ai-counterparty">
      <label class="field">
        <span class="field-label">有什么想对昨晚的自己说？（可不填）</span>
        <textarea class="input hand" name="excuse" maxlength="80" placeholder="今天下雨，路上肯定堵" data-key="excuse" data-bind="excuse">${esc(ui.excuse)}</textarea>
      </label>
      <button class="btn btn-secondary" type="button" data-action="rebut" data-key="rebut" ${ui.rebutting ? 'disabled' : ''}>${ui.rebutting ? '甲方正在回复……' : '交给甲方'}</button>
      ${reply}
    </section>
    <form data-form="amend" data-mechanism="amend-contract" novalidate>
      <label class="field">
        <span class="field-label">新的起床时间（规则：当前约定 ${esc(state.currentTime)} 加 5 分钟）</span>
        <input class="input input-time" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" name="time" value="${esc(ui.amendDraft ?? state.currentTime)}" required data-key="amend-time" data-bind="amendDraft">
      </label>
      ${errorBlock(state, ui)}
      <div class="actions">
        <button class="btn btn-primary" type="submit" data-key="amend">确认修订并再睡五分钟</button>
        <button class="btn btn-secondary" type="button" data-action="close" data-key="close">不睡了，关闭闹钟</button>
      </div>
    </form>`;
}

// ---------------- 延后（模拟睡眠） ----------------
function snoozed(state, ui) {
  const last = state.amendments?.[state.amendments.length - 1];
  const note = last && last.to === state.currentTime
    ? `合同已修订：${esc(last.from)} 改为 ${esc(last.to)}。`
    : '宽松条款的一次贪睡，直接批准。';
  return `
    ${head('贪睡已批准', state)}
    <p class="lede">${note}闹钟已停。</p>
    <p class="clock">
      <span class="clock-time">${esc(state.currentTime)}</span>
      <span class="clock-label">新的起床时间</span>
    </p>
    <p class="muted">演示里不用真等五分钟。</p>
    <div class="actions">
      <button class="btn btn-primary" type="button" data-action="ring-again" data-key="ring-again">模拟五分钟后</button>
    </div>`;
}

// ---------------- 动作签名（深化 4） ----------------
function pose(state, ui) {
  const attempts = state.pose?.attempts ?? 0;
  return `
    ${head('本人履约确认', state)}
    <p class="ring-flag">闹钟响铃中</p>
    <p class="lede">已收到关闭申请。先确认是你本人起床了：复现昨晚录下的起床暗号姿势。</p>
    ${attempts ? `<p class="notice-error">姿势还不像。已尝试 ${attempts} 次，第 3 次不通过会改走反应测试。</p>` : ''}
    <div data-mechanism="pose-signature">
      <div class="deep-slot" id="slot-pose-attempt"></div>
      <p class="notice-error" id="deep-error-pose-attempt" hidden></p>
    </div>`;
}

// ---------------- 清醒测试（深化 1） ----------------
function alertness(state, ui) {
  const base = median(state.baseline);
  const a = state.alertness ?? {};
  const fallback = state.pose?.fallback ? '<p class="muted">动作签名没有完成，改走反应测试。</p>' : '';
  return `
    ${head('清醒认证', state)}
    <p class="ring-flag">闹钟响铃中</p>
    <p class="lede">已收到关闭申请。在模糊的画面里做 5 次反应测试。你昨晚的中位反应是 ${base ? Math.round(base) : '—'} 毫秒，今天要在 ${base ? Math.round(base * 1.3) : '—'} 毫秒以内。</p>
    ${fallback}
    ${a.attempts ? `<p class="notice-error">这一轮中位数 ${Math.round(a.lastMedianMs ?? 0)} 毫秒，还没达标。已尝试 ${a.attempts} 次，第 3 次仍不达标也会放行。</p>` : ''}
    <div data-mechanism="alertness-test">
      <div class="deep-slot" id="slot-alertness"></div>
      <p class="notice-error" id="deep-error-alertness" hidden></p>
    </div>`;
}

// ---------------- 滑块答题 ----------------
function quiz(state, ui) {
  const q = state.quiz ?? { a: 0, b: 0, min: 0, max: 100 };
  const value = ui.slider ?? Math.round((q.min + q.max) / 2);
  return `
    ${head('已收到关闭申请', state)}
    <p class="ring-flag">闹钟响铃中</p>
    <p class="lede">闹钟不会马上停。先证明你醒了：把滑块拖到正确答案。</p>
    <form data-form="answer" data-mechanism="slider-quiz" novalidate>
      <p class="problem" id="problem">${q.a} + ${q.b} = ?</p>
      <output class="slider-value" id="slider-out" for="slider">${value}</output>
      <input class="slider" id="slider" type="range" name="value" min="${q.min}" max="${q.max}" step="1" value="${value}"
        aria-describedby="problem slider-hint" data-key="slider" data-bind="slider">
      <p class="muted" id="slider-hint">拖动滑块，或聚焦后用方向键一格一格微调。</p>
      ${errorBlock(state, ui)}
      <div class="actions">
        <button class="btn btn-primary" type="submit" data-key="answer">提交答案</button>
      </div>
    </form>`;
}

// ---------------- 验收 ----------------
function acceptance(state, ui) {
  const label = state.alertness?.label ? `清醒认证结果：${esc(state.alertness.label)}。` : '';
  const kept = state.keepSupervisingCount
    ? `<p class="notice-ok" role="status">监督继续（第 ${state.keepSupervisingCount} 次）。认证仍然有效，你随时可以完成验收。</p>`
    : '';
  return `
    ${head('履约验收', state)}
    <p class="ring-flag">闹钟响铃中</p>
    <p class="notice-ok">清醒认证已通过。${label}</p>
    <p class="lede">最后一步：确认你已经起床。为防止关掉以后又睡着，甲方建议再监督一会儿。</p>
    ${kept}
    <div class="actions">
      <button class="btn btn-primary btn-wide" type="button" data-action="keep" data-key="keep">继续监督（推荐）</button>
    </div>
    <div class="acceptance-exit" data-mechanism="acceptance-exit">
      <button class="btn-text" type="button" data-action="confirm-close" data-key="confirm-close">完成验收并关闭</button>
    </div>`;
}

// ---------------- 履约报告 ----------------
function done(state, ui) {
  const r = state.receipt ?? {};
  const fm = r.outcome === 'force_majeure';
  const rows = [
    ['合同修订', r.amendments?.length ? r.amendments.map((a) => `${esc(a.from)} 改为 ${esc(a.to)}`).join('<br>') : '无'],
    ['清醒任务耗时', formatDuration(r.taskMs)],
    ['手续耗时', formatDuration(r.procedureMs)],
    ['响铃时长', formatDuration(r.ringingMs)],
    ['答错次数', `${r.wrongAnswers ?? 0} 次`],
    ['选择继续监督', `${r.keepSupervisingCount ?? 0} 次`],
  ];
  if (r.alertness) {
    rows.push(['清醒认证', `${esc(r.alertness.label)}：昨晚 ${Math.round(r.alertness.baselineMedianMs)} 毫秒，今早 ${Math.round(r.alertness.morningMedianMs)} 毫秒，测了 ${r.alertness.attempts} 次`]);
  }
  if (r.pose) {
    rows.push(['动作签名', r.pose.fallback ? `未通过，改走反应测试（尝试 ${r.pose.attempts} 次）` : `通过（尝试 ${r.pose.attempts} 次）`]);
  }
  if (r.pendingPolicyChange) rows.push(['条款变更', '明日起改为宽松条款']);
  if (fm) rows.push(['不可抗力说明', esc(r.forceMajeureNote) || '未填写']);

  return `
    ${head('履约报告', state)}
    <p class="lede">${fm ? '本次按不可抗力豁免，闹钟已停止。' : '合同履行完毕，闹钟已停止。'}</p>
    <div class="compare">
      <div>
        <h3>昨晚的你约定</h3>
        <p class="hand" style="font-size: var(--step-3)">${esc(r.originalTime)}</p>
        <p class="hand">${esc(r.reason)}</p>
      </div>
      <div>
        <h3>今早的你实际</h3>
        <p style="font-family: var(--font-print); font-size: var(--step-3)">${esc(r.finalTime)}</p>
        <p>${r.snoozeCount ? `贪睡 ${r.snoozeCount} 次` : '没有贪睡'}</p>
      </div>
    </div>
    <table class="receipt">
      <caption class="sr-only">履约明细</caption>
      <tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody>
    </table>
    ${seal(fm ? '不可抗力豁免' : '履约完毕', { party: '甲方（验收）', signer: '昨晚的我' })}
    <div class="actions">
      <button class="btn btn-primary" type="button" data-action="reset" data-key="again">换一份合同，再来一轮</button>
    </div>`;
}

const SCREENS = { signing, armed, ringing, amending, snoozed, pose, alertness, quiz, acceptance, done };

export function renderScreen(state, ui) {
  const fn = SCREENS[state.phase];
  if (!fn) {
    return `${head('合同状态异常', state)}<p class="lede">遇到了未知阶段“${esc(state.phase)}”。点右上角「重新开始」回到签约页。</p>`;
  }
  return fn(state, ui);
}
