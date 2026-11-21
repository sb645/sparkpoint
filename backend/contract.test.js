import assert from "node:assert/strict";
import test from "node:test";
import { initialState, transition } from "./contract.js";
import { sampleContracts } from "./samples.js";

function ring(contract = sampleContracts.amend_first) {
  const signed = transition(initialState(), contract, 0);
  return transition(signed, { type: "RING" }, 100);
}

test("相同的贪睡请求：宽松延后，严格进入修订；重复操作不重复计数", () => {
  const request = { type: "SNOOZE" };
  const loose = transition(ring(sampleContracts.one_snooze), request, 200);
  const strict = transition(ring(), request, 200);
  assert.equal(loose.phase, "snoozed");
  assert.equal(loose.currentTime, "07:05");
  assert.equal(loose.snoozeCount, 1);
  assert.strictEqual(transition(loose, request, 210), loose);
  assert.equal(strict.phase, "amending");
  assert.equal(strict.currentTime, "07:00");
  assert.equal(strict.snoozeCount, 0);
  assert.equal(strict.originalContract.reason, "八点接室友");

  const secondRing = transition(loose, { type: "RING" }, 300);
  const secondRequest = transition(secondRing, request, 350);
  assert.equal(secondRequest.phase, "amending");
  const approved = transition(secondRequest, { type: "AMEND", time: "07:10" }, 400);
  assert.equal(approved.currentTime, "07:10");
  assert.equal(approved.snoozeCount, 2);
});

test("跨午夜修订可纠错；回执还原合同并排除模拟睡眠和等待响铃的时间", () => {
  const contract = { ...sampleContracts.amend_first, time: "23:58", reason: "去接站" };
  const amending = transition(ring(contract), { type: "SNOOZE" }, 200);
  const invalid = transition(amending, { type: "AMEND", time: "00:02" }, 400);
  assert.equal(invalid.phase, "amending");
  assert.ok(invalid.error);
  assert.equal(invalid.snoozeCount, 0);
  const approved = transition(invalid, { type: "AMEND", time: "00:03" }, 700);
  assert.equal(approved.error, null);
  assert.equal(approved.phase, "snoozed");
  const ringing = transition(approved, { type: "RING" }, 300700);
  const answering = transition(ringing, { type: "REQUEST_CLOSE" }, 305000);
  const wrong = transition(answering, { type: "ANSWER", value: 42 }, 305100);
  assert.equal(wrong.phase, "answering");
  assert.ok(wrong.error);
  const review = transition(wrong, { type: "ANSWER", value: "43" }, 306200);
  assert.equal(review.phase, "review");
  assert.equal(review.error, null);
  const done = transition(review, { type: "CONFIRM_CLOSE" }, 306500);
  assert.deepEqual(done.receipt, {
    originalContract: { time: "23:58", reason: "去接站", policy: "amend_first" },
    finalTime: "00:03", dayOffset: 1, snoozeCount: 1,
    taskMs: 1200, paperworkMs: 800, outcome: "履约完成", note: "",
  });
  assert.strictEqual(transition(done, { type: "CONFIRM_CLOSE" }, 307000), done);
});

test("直接关闭必须先答题再验收；留在验收页不会丢失认证", () => {
  const ringing = ring();
  assert.strictEqual(transition(ringing, { type: "CONFIRM_CLOSE" }, 100), ringing);
  const answering = transition(ringing, { type: "REQUEST_CLOSE" }, 200);
  assert.strictEqual(transition(answering, { type: "CONFIRM_CLOSE" }, 300), answering);
  const review = transition(answering, { type: "ANSWER", value: 43 }, 450);
  assert.strictEqual(transition(review, { type: "REQUEST_CLOSE" }, 800), review);
  const done = transition(review, { type: "CONFIRM_CLOSE" }, 1000);
  assert.equal(done.phase, "done");
  assert.equal(done.receipt.finalTime, "07:00");
  assert.equal(done.receipt.snoozeCount, 0);
  assert.equal(done.receipt.taskMs, 250);
  assert.equal(done.receipt.paperworkMs, 550);
});

test("任一仍响铃阶段均可豁免，结算截至豁免时的用时", () => {
  const ringing = ring();
  const amending = transition(ringing, { type: "SNOOZE" }, 200);
  const answering = transition(ringing, { type: "REQUEST_CLOSE" }, 200);
  const review = transition(answering, { type: "ANSWER", value: 43 }, 350);
  for (const [state, taskMs, paperworkMs] of [
    [ringing, 0, 0], [amending, 0, 300], [answering, 300, 0], [review, 150, 150],
  ]) {
    const done = transition(state, { type: "FORCE_MAJEURE", note: "生病" }, 500);
    assert.equal(done.phase, "done");
    assert.equal(done.receipt.outcome, "不可抗力豁免");
    assert.equal(done.receipt.note, "生病");
    assert.equal(done.receipt.taskMs, taskMs);
    assert.equal(done.receipt.paperworkMs, paperworkMs);
    assert.equal(done.receipt.snoozeCount, 0);
  }
});

test("签约拒绝非法输入；相同输入可重复得出同一结果", () => {
  const empty = Object.freeze(initialState());
  for (const invalid of [
    { time: "24:00" }, { time: "08:60" }, { time: "7:00" }, { reason: " " }, { policy: "unknown" },
  ]) {
    const state = transition(empty, { ...sampleContracts.one_snooze, ...invalid }, 0);
    assert.equal(state.phase, "signing");
    assert.equal(state.originalContract, null);
    assert.ok(state.error);
  }
  const event = Object.freeze({ ...sampleContracts.one_snooze });
  assert.deepEqual(transition(empty, event, 10), transition(empty, event, 10));
});

test("在进行中和完成后重置，都能立即签下一份新合同", () => {
  const amending = transition(ring(), { type: "SNOOZE" }, 200);
  const done = transition(amending, { type: "FORCE_MAJEURE" }, 400);
  for (const previous of [amending, done]) {
    const clean = transition(previous, { type: "RESET" }, 500);
    assert.deepEqual(clean, initialState());
    const signed = transition(clean, sampleContracts.one_snooze, 600);
    assert.equal(signed.phase, "armed");
    assert.equal(signed.originalContract.policy, "one_snooze");
  }
});
