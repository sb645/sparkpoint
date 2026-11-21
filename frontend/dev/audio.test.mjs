import assert from 'node:assert/strict';
import test from 'node:test';
import { createRinger, RINGER_INTENSITY_MAX } from '../audio.js';

function replaceGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

class Param {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}

class Node {
  connect(destination) { this.destination = destination; }
  disconnect() { this.destination = undefined; }
}

class FakeAudioContext {
  currentTime = 1;
  state = 'suspended';
  destination = new Node();
  oscillators = [];
  closeCount = 0;
  createGain() { return Object.assign(new Node(), { gain: new Param() }); }
  createDynamicsCompressor() {
    return Object.assign(new Node(), { threshold: new Param(), ratio: new Param() });
  }
  createOscillator() {
    const osc = Object.assign(new Node(), {
      frequency: new Param(), detune: new Param(), stops: [],
      start(at) { this.startTime = at; },
      stop(at = 0) { this.stops.push(at); },
    });
    this.oscillators.push(osc);
    return osc;
  }
  async resume() { this.state = 'running'; this.onstatechange?.(); }
  async close() { this.state = 'closed'; this.closeCount++; }
}

function fixture(t, options) {
  const contexts = [];
  replaceGlobal(t, 'AudioContext', class extends FakeAudioContext {
    constructor() { super(); contexts.push(this); }
  });
  // Advance the audio clock and fire one JS timer independently.
  const timers = new Set();
  t.mock.method(globalThis, 'setTimeout', (fn) => {
    const handle = { fn };
    timers.add(handle);
    return handle;
  });
  t.mock.method(globalThis, 'clearTimeout', (handle) => timers.delete(handle));
  function tick(at) {
    assert.equal(timers.size, 1);
    const [timer] = timers;
    timers.delete(timer);
    contexts[0].currentTime = at;
    timer.fn();
  }
  const ringer = createRinger(options);
  t.after(() => ringer.dispose());
  return { ringer, contexts, timers, tick };
}

test('缺少 Web Audio 时所有操作均可调用', async (t) => {
  replaceGlobal(t, 'AudioContext', undefined);
  replaceGlobal(t, 'webkitAudioContext', undefined);
  const r = createRinger();
  await r.unlock();
  r.start();
  r.start();
  r.setMuted(true);
  assert.equal(r.isMuted(), true);
  assert.equal(r.isPlaying(), true);
  r.setIntensity(2);
  assert.equal(r.getIntensity(), 2);
  r.stop();
  r.stop();
  assert.equal(r.isPlaying(), false);
  await r.dispose();
  await r.dispose();
});

test('强度默认为 0，越界夹到 0..3，小数取整数', () => {
  const r = createRinger();
  assert.equal(RINGER_INTENSITY_MAX, 3);
  assert.equal(r.getIntensity(), 0);
  for (const [input, expected] of [[17, 3], [-1, 0], [2.8, 2], [NaN, 2]]) {
    r.setIntensity(input);
    assert.equal(r.getIntensity(), expected);
  }
});

test('重复开始、解锁和停止均幂等，停止取消已排程的音符', async (t) => {
  const { ringer: r, contexts, timers, tick } = fixture(t);
  r.start();
  assert.equal(contexts.length, 0);
  await r.unlock();
  const [ctx] = contexts;
  const firstCount = ctx.oscillators.length;
  assert.ok(firstCount > 0);
  const firstAt = ctx.oscillators[0].startTime;
  assert.ok(firstAt > ctx.currentTime);
  await r.unlock();
  r.start();
  assert.equal(contexts.length, 1);
  assert.equal(ctx.oscillators.length, firstCount);
  tick(firstAt + 0.24);
  assert.ok(ctx.oscillators.at(-1).startTime > ctx.currentTime);
  r.stop();
  r.stop();
  assert.equal(timers.size, 0);
  assert.equal(r.isPlaying(), false);
  for (const osc of ctx.oscillators) {
    assert.equal(osc.destination, undefined);
    assert.deepEqual(osc.stops.slice(1), [0]);
  }
  r.start();
  assert.equal(timers.size, 1);
  await r.dispose();
  await r.dispose();
  await r.unlock();
  r.start();
  assert.equal(ctx.closeCount, 1);
  assert.equal(contexts.length, 1);
  assert.equal(r.isPlaying(), false);
  assert.equal(timers.size, 0);
});

test('静音前后延续同一节奏，新强度在下一音符生效，输出增益有上限', async (t) => {
  const { ringer: r, contexts, tick } = fixture(t, { volume: 9 });
  r.setMuted(true);
  await r.unlock();
  r.start();
  const [ctx] = contexts;
  const first = ctx.oscillators[0];
  const compressor = first.destination.destination;
  const master = compressor.destination;
  assert.ok(compressor.ratio.value > 1);
  assert.equal(master.destination, ctx.destination);
  assert.equal(master.gain.value, 0);
  r.setIntensity(3);
  tick(first.startTime + 0.25);
  const second = ctx.oscillators.at(-1);
  assert.equal(second.type, 'square');
  assert.equal(second.startTime, first.startTime + 0.30);
  r.setMuted(false);
  assert.equal(master.gain.value, 0.35);
  assert.equal(r.isPlaying(), true);
  assert.equal(r.isMuted(), false);
  r.setMuted(true);
  assert.equal(r.isPlaying(), true);
  assert.equal(master.gain.value, 0);
});

test('浏览器挂起时暂停调度，恢复后跳过积压的音符', async (t) => {
  const { ringer: r, contexts, timers } = fixture(t);
  await r.unlock();
  r.start();
  const [ctx] = contexts;
  const count = ctx.oscillators.length;
  ctx.state = 'suspended';
  ctx.onstatechange();
  assert.equal(timers.size, 0);
  ctx.currentTime = 60;
  ctx.resume = async () => { throw new Error('blocked'); };
  await r.unlock();
  assert.equal(timers.size, 0);
  assert.equal(r.isPlaying(), true);
  ctx.state = 'running';
  ctx.onstatechange();
  assert.equal(timers.size, 1);
  assert.equal(ctx.oscillators.length, count * 2);
  assert.ok(ctx.oscillators.at(-1).startTime > 60);
});

test('合成中途出错，已创建的节点和定时器均释放', async (t) => {
  const { ringer: r, contexts, timers } = fixture(t);
  await r.unlock();
  const [ctx] = contexts;
  ctx.createGain = () => { throw new Error('audio device lost'); };
  r.start();
  assert.equal(timers.size, 0);
  assert.equal(ctx.closeCount, 1);
  assert.deepEqual(ctx.oscillators[0].stops, [0]);
  assert.equal(ctx.oscillators[0].destination, undefined);
  r.stop();
});
