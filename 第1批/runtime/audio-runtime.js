import { factoryFact } from './factory-usage.js';
let context = null;
let manifest = { schemaVersion: 1, slots: {} };
let initializing = null;
let buses = null;
const decoded = new Map();
const loops = new Map();
const oneShots = new Map();
const diagnostics = Object.create(null);
const busLevels = { master: 1, sfx: 1, bgm: 1 };
const MAX_ONESHOTS_PER_SLOT = 4;

function dbToGain(db) {
  return Math.pow(10, Number(db || 0) / 20);
}

function ensureBuses(ctx) {
  if (buses) return buses;
  const master = ctx.createGain(), sfx = ctx.createGain(), bgm = ctx.createGain();
  sfx.connect(master); bgm.connect(master); master.connect(ctx.destination);
  buses = { master, sfx, bgm };
  return buses;
}

function ensureContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio API");
    context = new AudioContextClass();
    ensureBuses(context);
  }
  return context;
}

async function init() {
  if (initializing) return initializing;
  initializing = (async () => {
    ensureContext();
    try {
      const response = await fetch(new URL("../audio-manifest.json", import.meta.url));
      if (response.ok) manifest = await response.json();
    } catch (error) {
      diagnostics.__manifest = { status: "fallback", error: String(error) };
    }
    return audio;
  })();
  return initializing;
}

async function resume() {
  const ctx = ensureContext();
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

function positionOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value.x || 0, value.y || 0, value.z || 0];
  return [0, 0, 0];
}

function connectOutput(ctx, slot, options, applyProcessing = true) {
  const gain = ctx.createGain();
  const processingGain = applyProcessing ? dbToGain(slot && slot.processing && slot.processing.gainDb) : 1;
  gain.gain.value = Math.max(0, Number(options.volume ?? 1)) * processingGain;
  const output = slot && slot.type === "bgm" ? ensureBuses(ctx).bgm : ensureBuses(ctx).sfx;
  if (slot && slot.spatial) {
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = Math.max(0.01, Number(options.refDistance ?? 1));
    panner.maxDistance = Math.max(panner.refDistance, Number(options.maxDistance ?? 100));
    const [x, y, z] = positionOf(options.position);
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
    gain.connect(panner).connect(output);
  } else {
    gain.connect(output);
  }
  return gain;
}

async function loadBuffer(slotId, slot) {
  const resource = slot && slot.generated && slot.generated.status === "ready"
    ? slot.generated.resource
    : null;
  if (!resource) return null;
  if (!decoded.has(resource)) {
    decoded.set(resource, (async () => {
      const response = await fetch(new URL("../" + resource, import.meta.url));
      if (!response.ok) throw new Error("音频加载失败：" + response.status);
      const bytes = await response.arrayBuffer();
      return ensureContext().decodeAudioData(bytes.slice(0));
    })().catch((error) => {
      decoded.delete(resource);
      diagnostics[slotId] = { status: "fallback", error: String(error) };
      return null;
    }));
  }
  return decoded.get(resource);
}

function fallback(ctx, slotId, slot, options, looping) {
  if (slot && slot.type === "bgm") {
    diagnostics[slotId] = { status: "unavailable", reason: "licensed BGM retrieval unavailable" };
    return { stop: () => {} };
  }
  const now = ctx.currentTime;
  const gain = connectOutput(ctx, slot, options, false);
  const category = slot ? slot.category : "ui";
  const osc = ctx.createOscillator();
  const noiseLike = category === "impact" || category === "weapon" || category === "movement";
  osc.type = noiseLike ? "sawtooth" : category === "warning" ? "square" : "sine";
  osc.frequency.value = category === "reward" ? 660 : category === "warning" ? 180 : noiseLike ? 110 : 440;
  osc.connect(gain);
  gain.gain.setValueAtTime(Math.min(gain.gain.value, 0.12), now);
  if (!looping) gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  osc.start(now);
  if (!looping) osc.stop(now + 0.18);
  diagnostics[slotId] = { status: "fallback", reason: "generated audio unavailable" };
  return { stop: () => { try { osc.stop(); } catch {} } };
}

async function start(slotId, options = {}, forceLoop = false) {
  try {
    await init();
    const ctx = await resume();
    const slot = manifest.slots[slotId];
    if (!slot) {
      diagnostics[slotId] = { status: "error", reason: "undeclared_slot" };
      return { stop: () => {} };
    }
    const looping = forceLoop;
    const buffer = await loadBuffer(slotId, slot);
    if (!buffer) {
      try { const fact = factoryFact(slot.type, slotId, 'audio', null); if (fact) fact.error = 'audio_unavailable'; } catch {}
      return fallback(ctx, slotId, slot, options, looping);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = looping;
    source.connect(connectOutput(ctx, slot, options));
    const trimStart = looping ? 0 : Math.max(0, Number(slot.processing && slot.processing.trimStartSeconds || 0));
    source.start(0, Math.min(trimStart, Math.max(0, buffer.duration - 0.001)));
    diagnostics[slotId] = { status: "ready", resource: slot.generated.resource };
    try {
      const fact = factoryFact(slot.type, slotId, 'audio', slot.generated.resource);
      if (fact) { fact.loaded = true; fact.used ||= ctx.state === 'running'; if (!fact.used) fact.error = 'audio_context_suspended'; }
    } catch {}
    const handle = { stop: () => { try { source.stop(); } catch {} } };
    if (!looping) {
      const active = oneShots.get(slotId) || [];
      while (active.length >= MAX_ONESHOTS_PER_SLOT) active.shift().stop();
      active.push(handle); oneShots.set(slotId, active);
      source.onended = () => {
        const current = oneShots.get(slotId) || [];
        const index = current.indexOf(handle);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) oneShots.delete(slotId);
      };
    }
    return handle;
  } catch (error) {
    try {
      const slot = manifest.slots[slotId];
      const fact = factoryFact(slot?.type || 'audio', slotId, 'audio', slot?.generated?.resource);
      if (fact) fact.error = 'audio_start_failed';
    } catch {}
    diagnostics[slotId] = { status: "fallback", error: String(error) };
    return { stop: () => {} };
  }
}

async function play(slotId, options = {}) {
  return start(slotId, options, false);
}

async function startLoop(slotId, options = {}) {
  const existing = loops.get(slotId);
  if (existing) existing.stop();
  const handle = await start(slotId, options, true);
  loops.set(slotId, handle);
  return handle;
}

function stopLoop(slotId) {
  const handle = loops.get(slotId);
  if (!handle) return false;
  handle.stop();
  loops.delete(slotId);
  return true;
}

function setListener(position, forward = [0, 0, -1], up = [0, 1, 0]) {
  const ctx = ensureContext();
  const [x, y, z] = positionOf(position);
  ctx.listener.positionX.value = x;
  ctx.listener.positionY.value = y;
  ctx.listener.positionZ.value = z;
  if (ctx.listener.forwardX) {
    ctx.listener.forwardX.value = forward[0]; ctx.listener.forwardY.value = forward[1]; ctx.listener.forwardZ.value = forward[2];
    ctx.listener.upX.value = up[0]; ctx.listener.upY.value = up[1]; ctx.listener.upZ.value = up[2];
  }
}

function setVolumes(levels = {}) {
  const ctx = ensureContext(), output = ensureBuses(ctx);
  for (const key of ["master", "sfx", "bgm"]) {
    if (levels[key] !== undefined) busLevels[key] = Math.max(0, Number(levels[key]));
    output[key].gain.setValueAtTime(busLevels[key], ctx.currentTime);
  }
  return { ...busLevels };
}

export const audio = { init, play, startLoop, stopLoop, setListener, setVolumes, diagnostics: () => ({ ...diagnostics }) };
window.__hmAudioDiagnostics = diagnostics;
