import { factoryFact } from './factory-usage.js';
import * as THREE from "three";

const FADE = 0.18;
const MIN_BLEND_SECONDS = 0.1;

const WALK_ON = 0.35;
const RUN_ON = 2.2;
const AIR_UP = 0.6;
const AIR_DOWN = -0.9;
const SPEED_SMOOTH = 0.25;
const NOMINAL_WALK = 1.2;
const NOMINAL_RUN = 3.2;

const registry = [];
const entries = new WeakMap();
const hookedRenderers = new WeakSet();
let ticking = false;
let lastTickAt = 0;

function tail(name) {
  return String(name).split(":").pop().toLowerCase();
}

export function registerAnimated(outer, holder, inner, clips, meta) {
  const mixer = new THREE.AnimationMixer(inner);
  const actions = Object.create(null);
  const sourceClips = Object.create(null);
  const faithful = Object.create(null);
  const faithfulNames = new Set(meta.faithfulClips || []);
  for (const clip of clips || []) {
    actions[tail(clip.name)] = mixer.clipAction(clip);
    sourceClips[tail(clip.name)] = clip;
    faithful[tail(clip.name)] = faithfulNames.has(clip.name);
  }
  const lifts = Object.create(null);
  for (const name of Object.keys(meta.groundLifts || {})) {
    lifts[tail(name)] = Number(meta.groundLifts[name]) || 0;
  }
  for (const key of Object.keys(faithful)) {
    if (faithful[key]) lifts[key] = 0;
  }
  const entry = {
    outer: outer,
    slotId: meta.slotId,
    resource: meta.resource,
    holder: holder,
    mixer: mixer,
    actions: actions,
    sourceClips: sourceClips,
    lifts: lifts,
    faithful: faithful,
    scale: meta.scale > 0 ? meta.scale : 1,
    height: meta.height > 0 ? meta.height : 1,
    baseY: Number(meta.baseY) || 0,
    current: null,
    currentAction: null,
    currentOptions: null,
    playingOnce: false,
    fading: null,
    pinned: null,
    pinnedOptions: null,
    automaticBlendSeconds: FADE,
    once: null,
    onceOptions: null,
    speed: 0,
    lastPosition: new THREE.Vector3(),
    hasLastPosition: false,
    verticalSpeed: 0
  };
  entries.set(outer, entry);
  registry.push(new WeakRef(entry));
  entry.holder.position.y = entry.baseY;
  play(entry, actions["idle"] ? "idle" : Object.keys(actions)[0] || null);
  applyLift(entry);
  ensureTicking();
  return entry;
}

function find(root) {
  return root ? entries.get(root) || null : null;
}

function normalizeOptions(entry, key, options) {
  const clip = entry.sourceClips[key];
  if (!clip || !Number.isFinite(clip.duration) || !(clip.duration > 0)) return null;
  try {
    if (options === undefined) options = {};
    if (!options || typeof options !== "object" || Array.isArray(options)) return null;
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(options);
    if (keys.some(function (key) { return !["startTime", "endTime", "speed", "blendSeconds"].includes(key); })) return null;
    if (keys.some(function (key) { const property = Object.getOwnPropertyDescriptor(options, key); return !property || !Object.hasOwn(property, "value"); })) return null;
    const start = Object.hasOwn(options, "startTime") ? options.startTime : 0;
    const end = Object.hasOwn(options, "endTime") ? options.endTime : clip.duration;
    const speed = Object.hasOwn(options, "speed") ? options.speed : null;
    const blend = Object.hasOwn(options, "blendSeconds") ? options.blendSeconds : FADE;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || !(end > start) || end > clip.duration) return null;
    if (Object.hasOwn(options, "speed") && (!Number.isFinite(speed) || !(speed > 0))) return null;
    if (!Number.isFinite(blend) || blend < 0) return null;
    const wallSeconds = (end - start) / (speed === null ? 1 : speed);
    if (!(wallSeconds > 0) || !Number.isFinite(wallSeconds)) return null;
    return Object.freeze({ startTime: start, endTime: end, speed: speed, blendSeconds: Math.max(MIN_BLEND_SECONDS, blend) });
  } catch { return null; }
}

function sameOptions(a, b) {
  return a && b && a.startTime === b.startTime && a.endTime === b.endTime && a.speed === b.speed;
}

function forgetFading(entry) {
  if (!entry.fading) return;
  const old = entry.fading;
  old.action.stop();
  if (old.derived) entry.mixer.uncacheClip(old.action.getClip());
  entry.fading = null;
}

function rangedAction(entry, key, options) {
  const clip = entry.sourceClips[key];
  if (options.startTime === 0 && options.endTime === clip.duration) return entry.actions[key];
  const start = options.startTime;
  const end = options.endTime;
  const duration = end - start;
  const tracks = clip.tracks.map(function (source) {
    const copy = source.clone();
    const factory = copy.createInterpolant;
    copy.createInterpolant = function (result) {
      const interpolant = factory.call(copy, result);
      const evaluate = interpolant.evaluate;
      interpolant.evaluate = function (time) {
        const sourceTime = time <= 0 ? start : time >= duration ? end : Math.min(end, Math.max(start, start + time));
        return evaluate.call(this, sourceTime);
      };
      return interpolant;
    };
    if (factory.isInterpolantFactoryMethodGLTFCubicSpline) copy.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline = true;
    return copy;
  });
  const range = new THREE.AnimationClip(clip.name, duration, tracks, clip.blendMode);
  return entry.mixer.clipAction(range);
}

function play(entry, name, once, options, restart) {
  if (!entry) return false;
  if (!name) return false;
  const key = tail(name);
  const source = entry.sourceClips[key];
  if (!source) return false;
  const normalized = options || normalizeOptions(entry, key);
  if (!normalized) return false;
  const same = entry.current === key && sameOptions(entry.currentOptions, normalized);
  if (same && entry.playingOnce === (once === true) && !restart) {
    entry.currentOptions = normalized;
    return true;
  }
  const previous = entry.currentAction;
  let next;
  try { next = same && previous ? previous : rangedAction(entry, key, normalized); }
  catch { return false; }
  forgetFading(entry);
  next.reset();
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.setEffectiveTimeScale(normalized.speed === null ? 1 : normalized.speed);
  next.loop = once ? THREE.LoopOnce : THREE.LoopRepeat;
  next.repetitions = once ? 1 : Infinity;
  next.clampWhenFinished = once === true;
  if (previous && previous !== next && entry.current === key) {
    previous.stop();
    if (previous.getClip() !== entry.sourceClips[key]) entry.mixer.uncacheClip(previous.getClip());
  } else if (previous && previous !== next) {
    if (normalized.blendSeconds > 0) {
      next.crossFadeFrom(previous, normalized.blendSeconds, false);
      entry.fading = { action: previous, derived: previous.getClip() !== entry.sourceClips[entry.current], until: entry.mixer.time + normalized.blendSeconds };
    } else {
      previous.stop();
      if (previous.getClip() !== entry.sourceClips[entry.current]) entry.mixer.uncacheClip(previous.getClip());
    }
  }
  next.play();
  try {
    if (entry.outer.parent) {
      const fact = factoryFact('animation', entry.slotId, key, entry.resource);
      if (fact) { fact.loaded = true; fact.used = next.isRunning(); }
    }
  } catch {}
  entry.current = key;
  entry.currentAction = next;
  entry.currentOptions = normalized;
  entry.playingOnce = once === true;
  entry.mixer.update(0);
  return true;
}

function applyLift(entry) {
  try {
    if (entry.outer.parent && entry.current && entry.currentAction?.isRunning()) {
      const fact = factoryFact('animation', entry.slotId, entry.current, entry.resource);
      if (fact) { fact.loaded = true; fact.used = true; }
    }
  } catch {}
  if (entry.faithful[entry.current]) {
    entry.holder.position.y = entry.baseY;
    return;
  }
  let weighted = 0;
  let total = 0;
  const active = [{ action: entry.currentAction, key: entry.current }];
  if (entry.fading) active.push({ action: entry.fading.action, key: tail(entry.fading.action.getClip().name) });
  for (const item of active) {
    const key = item.key;
    const action = item.action;
    if (!action) continue;
    if (!action.isRunning()) continue;
    const weight = action.getEffectiveWeight();
    if (!(weight > 0)) continue;
    weighted += (entry.lifts[key] || 0) * weight;
    total += weight;
  }
  const lift = total > 0 ? weighted / total : (entry.lifts[entry.current] || 0);
  entry.holder.position.y = entry.baseY + lift * entry.scale;
}

function infer(entry, dt) {
  const position = new THREE.Vector3();
  entry.outer.getWorldPosition(position);
  if (!entry.hasLastPosition) {
    entry.lastPosition.copy(position);
    entry.hasLastPosition = true;
    return entry.actions["idle"] ? "idle" : entry.current || "idle";
  }
  const dx = position.x - entry.lastPosition.x;
  const dy = position.y - entry.lastPosition.y;
  const dz = position.z - entry.lastPosition.z;
  entry.lastPosition.copy(position);
  if (dt <= 0) return entry.current || "idle";
  const horizontal = Math.sqrt(dx * dx + dz * dz) / dt / entry.height;
  const vertical = dy / dt / entry.height;
  entry.speed += (horizontal - entry.speed) * SPEED_SMOOTH;
  entry.verticalSpeed += (vertical - entry.verticalSpeed) * SPEED_SMOOTH;
  if (entry.verticalSpeed > AIR_UP && entry.actions["jump"]) return "jump";
  if (entry.verticalSpeed < AIR_DOWN && entry.actions["fall"]) return "fall";
  if (entry.speed > RUN_ON && entry.actions["run"]) return "run";
  if (entry.speed > WALK_ON) {
    if (entry.actions["walk"]) return "walk";
    if (entry.actions["run"]) return "run";
  }
  return "idle";
}

function retime(entry) {
  const action = entry.currentAction;
  if (!action) return;
  if (entry.currentOptions && entry.currentOptions.speed !== null) {
    action.setEffectiveTimeScale(entry.currentOptions.speed);
    return;
  }
  if (entry.faithful[entry.current]) {
    action.setEffectiveTimeScale(1);
    return;
  }
  const nominal = entry.current === "run" ? NOMINAL_RUN : entry.current === "walk" ? NOMINAL_WALK : 0;
  if (nominal <= 0 || entry.speed <= 0) {
    action.setEffectiveTimeScale(1);
    return;
  }
  const ratio = Math.min(2, Math.max(0.5, entry.speed / nominal));
  action.setEffectiveTimeScale(ratio);
}

function advanceMixer(entry, dt) {
  const restored = [];
  const active = [entry.currentAction, entry.fading && entry.fading.action];
  for (const action of active) {
    if (!action || action.loop === THREE.LoopOnce || action.paused || !(dt > 0)) continue;
    const speed = action.getEffectiveTimeScale();
    const duration = action.getClip().duration;
    if (!(speed > 0) || dt * speed / duration <= Number.MAX_SAFE_INTEGER) continue;
    const cycleSeconds = duration / speed;
    const phase = (dt % cycleSeconds) * speed;
    restored.push({ action: action, speed: speed });
    action.setEffectiveTimeScale(phase / dt);
  }
  entry.mixer.update(dt);
  for (const item of restored) item.action.setEffectiveTimeScale(item.speed);
}

function advance(entry, dt) {
  const action = entry.currentAction;
  if (entry.once && action) {
    const speed = action.getEffectiveTimeScale();
    const remaining = action.time >= action.getClip().duration ? 0 : speed > 0 ? Math.max(0, action.getClip().duration - action.time) / speed : Infinity;
    if (remaining <= dt) {
      advanceMixer(entry, remaining);
      action.time = action.getClip().duration;
      action.paused = true;
      entry.mixer.update(0);
      const completed = entry.once;
      const completedBlend = entry.onceOptions ? entry.onceOptions.blendSeconds : FADE;
      entry.once = null;
      entry.onceOptions = null;
      let wanted = entry.pinned || infer(entry, dt);
      if (!entry.pinned && wanted === completed && !entry.actions["idle"]) wanted = "idle";
      play(entry, wanted, false, entry.pinned ? entry.pinnedOptions : normalizeOptions(entry, wanted, { blendSeconds: completedBlend }));
      retime(entry);
      advanceMixer(entry, Math.max(0, dt - remaining));
    } else advanceMixer(entry, dt);
  } else advanceMixer(entry, dt);
  if (entry.fading && entry.mixer.time >= entry.fading.until) forgetFading(entry);
}

function tick(now) {
  if (now === lastTickAt) return;
  const dt = lastTickAt > 0 ? Math.min(0.1, (now - lastTickAt) / 1000) : 0;
  lastTickAt = now;
  for (let index = registry.length - 1; index >= 0; index -= 1) {
    const entry = registry[index].deref();
    if (!entry) {
      registry.splice(index, 1);
      continue;
    }
    if (!entry.outer.parent) {
      entry.hasLastPosition = false;
      entry.speed = 0;
      entry.verticalSpeed = 0;
      continue;
    }
    const wanted = entry.once || entry.pinned || infer(entry, dt);
    const options = entry.once ? entry.onceOptions : entry.pinned ? entry.pinnedOptions : normalizeOptions(entry, wanted, { blendSeconds: entry.automaticBlendSeconds });
    play(entry, wanted, entry.once !== null, options);
    retime(entry);
    advance(entry, dt);
    applyLift(entry);
  }
}

function ensureTicking() {
  if (ticking) return;
  ticking = true;
  const loop = function (now) {
    tick(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function setState(root, action, options) {
  const entry = find(root);
  if (!entry) return false;
  if (action === null || action === undefined) {
    let blend = FADE;
    try {
      if (options !== undefined) {
        if (!options || typeof options !== "object" || Array.isArray(options) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(options))) return false;
        const keys = Reflect.ownKeys(options);
        if (keys.some(function (key) { return key !== "blendSeconds"; })) return false;
        if (keys.length) {
          const property = Object.getOwnPropertyDescriptor(options, "blendSeconds");
          if (!property || !Object.hasOwn(property, "value")) return false;
          blend = property.value;
        }
        if (!Number.isFinite(blend) || blend < 0) return false;
      }
    } catch { return false; }
    entry.pinned = null;
    entry.pinnedOptions = null;
    entry.automaticBlendSeconds = Math.max(MIN_BLEND_SECONDS, blend);
    return true;
  }
  const key = tail(action);
  if (!entry.actions[key]) return false;
  const normalized = normalizeOptions(entry, key, options);
  if (!normalized) return false;
  if (entry.once) {
    entry.pinned = key;
    entry.pinnedOptions = normalized;
    return true;
  }
  if (!play(entry, key, false, normalized)) return false;
  entry.pinned = key;
  entry.pinnedOptions = normalized;
  return true;
}

export function playOnce(root, action, options) {
  const entry = find(root);
  if (!entry) return false;
  const key = tail(action);
  if (!entry.actions[key]) return false;
  const normalized = normalizeOptions(entry, key, options);
  if (!normalized || !play(entry, key, true, normalized, true)) return false;
  entry.once = key;
  entry.onceOptions = normalized;
  return true;
}

export function isAnimated(root) {
  return find(root) !== null;
}

export function clipsOf(root) {
  const entry = find(root);
  return entry ? Object.keys(entry.actions) : [];
}

export function attachRenderer(renderer) {
  if (!renderer || typeof renderer.render !== "function") return false;
  if (hookedRenderers.has(renderer)) return true;
  hookedRenderers.add(renderer);
  const original = renderer.render.bind(renderer);
  renderer.render = function () {
    tick(performance.now());
    return original.apply(null, arguments);
  };
  return true;
}

export function animatedCount() {
  let count = 0;
  for (const reference of registry) {
    if (reference.deref()?.outer.parent) count += 1;
  }
  return count;
}

export function debugState(root) {
  const entry = find(root);
  if (!entry) return null;
  const action = entry.currentAction;
  return {
    current: entry.current,
    pinned: entry.pinned,
    once: entry.once,
    timeSeconds: action && entry.currentOptions ? entry.currentOptions.startTime + action.time : null,
    startTime: entry.currentOptions ? entry.currentOptions.startTime : null,
    endTime: entry.currentOptions ? entry.currentOptions.endTime : null,
    speed: action ? action.getEffectiveTimeScale() : null,
    liftY: entry.holder.position.y,
    loopOnce: action ? action.loop === THREE.LoopOnce : false,
    clamped: action ? action.clampWhenFinished === true : false,
    running: action ? action.isRunning() : false
  };
}
