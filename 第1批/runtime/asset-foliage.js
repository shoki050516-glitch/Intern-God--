import * as THREE from "three";
import { applyLitMaterial } from "../src/visual.js";


const WIND_GLSL = "\nattribute vec3 foliageAnchor;\nattribute vec3 foliageAxis;\nuniform float uWindTime;\nuniform float uWindStrength;\nuniform float uWindSpeed;\nuniform float uWindNoiseScale;\nuniform vec2 uWindDirection;\nuniform float uWindFlex;\n\n// Inverse transpose, including non-uniform instance scaling.\nmat3 foliageNormalMatrix(mat3 m) {\n  vec3 a = cross(m[1], m[2]);\n  vec3 b = cross(m[2], m[0]);\n  vec3 c = cross(m[0], m[1]);\n  float d = dot(m[0], a);\n  return abs(d) > 0.000001 ? mat3(a, b, c) / d : mat3(1.0);\n}\n\nfloat hmpWindHash(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);\n}\nfloat hmpWindNoise(vec2 p) {\n  vec2 cell = floor(p), f = fract(p);\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  return mix(mix(hmpWindHash(cell), hmpWindHash(cell + vec2(1.0, 0.0)), u.x),\n             mix(hmpWindHash(cell + vec2(0.0, 1.0)), hmpWindHash(cell + vec2(1.0, 1.0)), u.x), u.y);\n}\n\nvoid foliageWind(inout vec3 p, inout vec3 n) {\n  mat4 placement = modelMatrix;\n  #ifdef USE_INSTANCING\n    placement = modelMatrix * instanceMatrix;\n  #endif\n  vec3 anchorWorld = (placement * vec4(foliageAnchor, 1.0)).xyz;\n  float t = uWindTime * uWindSpeed;\n  vec2 fieldPosition = anchorWorld.xz * uWindNoiseScale;\n  vec2 advected = (anchorWorld.xz - uWindDirection * t * 1.5) * uWindNoiseScale;\n  float gust = 0.7 * hmpWindNoise(advected) + 0.3 * hmpWindNoise(advected * 2.03 + vec2(11.7, 5.2));\n  float phase = 6.283185 * hmpWindNoise(fieldPosition + vec2(7.4, 19.1));\n  float localRate = mix(0.65, 1.4, hmpWindNoise(fieldPosition * 0.7 + vec2(21.3, 3.7)));\n  float sway = 0.65 * sin(t * localRate + phase) + 0.35 * sin(t * localRate * 1.83 + phase * 1.71);\n  float wave = (0.15 + 1.55 * gust) * sway;\n  vec3 direction = vec3(uWindDirection.x, 0.0, uWindDirection.y);\n  vec3 axis = length(foliageAxis) > 0.001 ? normalize(foliageAxis) : vec3(0.0, 1.0, 0.0);\n  vec3 worldSlope = direction * (uWindStrength * uWindFlex * wave * length(mat3(placement) * axis));\n  vec3 slope = transpose(foliageNormalMatrix(mat3(placement))) * worldSlope;\n  // Affine shear pins the anchor even inside a four-vertex card. Both passes use the same deformation.\n  p += slope * dot(p - foliageAnchor, axis);\n  float determinant = 1.0 + dot(axis, slope);\n  if (abs(determinant) > 0.000001) n -= axis * (dot(slope, n) / determinant);\n}\n";
const WIND_DEFAULTS = {"strength":1,"speed":3,"noiseScale":0.25,"direction":[1,0.3]};
const windUniforms = {
  uWindTime: { value: 0 },
  uWindStrength: { value: WIND_DEFAULTS.strength },
  uWindSpeed: { value: WIND_DEFAULTS.speed },
  uWindNoiseScale: { value: WIND_DEFAULTS.noiseScale },
  uWindDirection: { value: new THREE.Vector2(...WIND_DEFAULTS.direction).normalize() }
};
let manualWindTime = 0;
const windScenes = new WeakSet();
const windShadows = new WeakMap();

function syncWindTime() {
  const elapsed = typeof window !== 'undefined' ? window.__HM_GAME_LOOP__?.elapsedSeconds : undefined;
  windUniforms.uWindTime.value = Number.isFinite(elapsed) ? elapsed : manualWindTime;
}

export function setWind(options = {}) {
  if (Number.isFinite(options.noiseScale)) windUniforms.uWindNoiseScale.value = Math.max(0, Math.min(20, options.noiseScale));
  if (Number.isFinite(options.strength)) windUniforms.uWindStrength.value = Math.max(0, Math.min(2, options.strength));
  if (Number.isFinite(options.speed)) windUniforms.uWindSpeed.value = Math.max(0, Math.min(5, options.speed));
  const d = options.direction;
  if (Array.isArray(d) && d.length === 2 && d.every(Number.isFinite) && Math.hypot(...d) > 0) {
    windUniforms.uWindDirection.value.set(d[0], d[1]).normalize();
  }
  return getWind();
}

export function getWind() {
  syncWindTime();
  return {
    time: windUniforms.uWindTime.value,
    strength: windUniforms.uWindStrength.value,
    speed: windUniforms.uWindSpeed.value,
    noiseScale: windUniforms.uWindNoiseScale.value,
    direction: windUniforms.uWindDirection.value.toArray()
  };
}

export function updateWind(dt) {
  if (Number.isFinite(dt) && dt >= 0) manualWindTime += dt;
  syncWindTime();
}

function windVertex(source) {
  const original = source;
  if (foliageVertexPatches.has(source)) return foliageVertexPatches.get(source);
  if (!source.includes('// HMP_FOLIAGE_WIND')) {
    if (source.includes('HM_FOLIAGE_VERTEX_DECLARATIONS')) {
      source = foliageShaderMarker(source, 'HM_FOLIAGE_VERTEX_DECLARATIONS', WIND_GLSL);
      source = foliageShaderMarker(source, 'HM_FOLIAGE_VERTEX_DEFORM', 'foliageWind(tPos, tNor);');
    } else {
      source = WIND_GLSL + foliageShaderReplace(source, 'vec3 tNor = normal;', 'vec3 tNor = normal;\nfoliageWind(tPos, tNor);');
    }
    source = '// HMP_FOLIAGE_WIND\n' + source;
    source = foliageShaderReplace(source, 'tPos = (instanceMatrix * vec4(position, 1.0)).xyz;', 'tPos = (instanceMatrix * vec4(tPos, 1.0)).xyz;', false);
    source = foliageShaderReplace(source, 'tNor = mat3(instanceMatrix) * normal;', 'tNor = foliageNormalMatrix(mat3(instanceMatrix)) * tNor;', false);
    source = foliageShaderReplace(source, 'vNormal = normalize(mat3(modelMatrix) * tNor);', 'vNormal = normalize(foliageNormalMatrix(mat3(modelMatrix)) * tNor);', false);
  }
  if (foliageShaderMatches(source, 'foliageWind(tPos, tNor);').length !== 1)
    throw Error('foliage material integration: wind hook was not installed');
  return cacheFoliageShader(foliageVertexPatches, original, source);
}

function windShadowVertex(source) {
  return WIND_GLSL + source.replace('#include <begin_vertex>',
    '#include <begin_vertex>\nvec3 foliageShadowNormal = normal;\nfoliageWind(transformed, foliageShadowNormal);');
}

function shadowPair(material) {
  let pair = windShadows.get(material);
  if (pair) return pair;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const distance = new THREE.MeshDistanceMaterial();
  for (const shadow of [depth, distance]) {
    shadow.userData.foliageWindShadow = true;
    shadow.onBeforeCompile = function (shader) {
      Object.assign(shader.uniforms, windUniforms, { uWindFlex: material.uniforms.uWindFlex });
      shader.vertexShader = windShadowVertex(shader.vertexShader);
    };
    shadow.customProgramCacheKey = function () { return 'hmp-foliage-wind-v1'; };
  }
  pair = { depth, distance };
  windShadows.set(material, pair);
  material.addEventListener('dispose', function () {
    depth.dispose(); distance.dispose(); windShadows.delete(material);
  });
  return pair;
}

export function prepareFoliageWind(scene) {
  syncWindTime();
  scene.traverse(function (node) {
    if (!node.isMesh) return;
    const material = node.material;
    if (material?.uniforms?.uWindFlex && node.geometry?.getAttribute('foliageAnchor')) {
      const pair = shadowPair(material);
      node.customDepthMaterial = pair.depth;
      node.customDistanceMaterial = pair.distance;
    } else {
      if (node.customDepthMaterial?.userData.foliageWindShadow) node.customDepthMaterial = undefined;
      if (node.customDistanceMaterial?.userData.foliageWindShadow) node.customDistanceMaterial = undefined;
    }
  });
}

export function installFoliageWind(scene) {
  if (!scene?.isScene || windScenes.has(scene)) return;
  windScenes.add(scene);
  const previous = scene.onBeforeRender;
  scene.onBeforeRender = function (...args) {
    previous.apply(this, args);
    prepareFoliageWind(scene);
  };
  prepareFoliageWind(scene);
}



const foliageFragmentPatches = new Map(), foliageVertexPatches = new Map();
function cacheFoliageShader(cache, source, patched) {
  if (cache.size >= 16) cache.delete(cache.keys().next().value);
  cache.set(source, patched);
  return patched;
}
function foliageShaderTokens(source) {
  const tokens = [];
  const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\s+|[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[^\s]/g;
  for (const match of source.matchAll(pattern)) {
    if (/^(?:\s|\/\/|\/\*)/.test(match[0])) continue;
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}
function foliageShaderMatches(source, needle) {
  const tokens = foliageShaderTokens(source), expected = foliageShaderTokens(needle);
  const matches = [];
  for (let i = 0; i <= tokens.length - expected.length; i++) {
    if (expected.every((token, j) => token.text === tokens[i + j].text))
      matches.push({ start: tokens[i].start, end: tokens[i + expected.length - 1].end });
  }
  return matches;
}
function foliageShaderReplace(source, needle, replacement, required = true) {
  const matches = foliageShaderMatches(source, needle);
  if (required && matches.length !== 1) throw Error('foliage material integration: unsupported or ambiguous shader hook');
  for (const match of matches.reverse()) source = source.slice(0, match.start) + replacement + source.slice(match.end);
  return source;
}
function foliageShaderMarker(source, marker, replacement) {
  const pattern = new RegExp('^[ \\t]*//[ \\t]*' + marker + '[ \\t]*\\r?$', 'gm');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw Error('foliage material integration: missing or ambiguous ' + marker);
  return source.replace(pattern, () => replacement);
}
function foliageLegacyOutput(source) {
  const tokens = foliageShaderTokens(source);
  const starts = [];
  for (let i = 0; i < tokens.length - 4; i++)
    if (['gl_FragColor', '=', 'vec4', '('].every((value, j) => tokens[i + j].text === value)) starts.push(i);
  if (starts.length !== 1) throw Error('foliage material integration: unsupported fragment output');
  const start = starts[0];
  let depth = 0, comma = -1, end = -1;
  for (let i = start + 4; i < tokens.length; i++) {
    const value = tokens[i].text;
    if (value === '(' || value === '[') depth++;
    if (value === ')' && depth === 0) { end = i; break; }
    if (value === ')' || value === ']') depth--;
    if (value === ',' && depth === 0) {
      if (comma !== -1) throw Error('foliage material integration: fragment output must use vec3 and alpha');
      comma = i;
    }
  }
  if (comma < 0 || end < 0) throw Error('foliage material integration: incomplete fragment output');
  const rgb = source.slice(tokens[start + 4].start, tokens[comma].start);
  return source.slice(0, tokens[start + 4].start) + 'foliageLitColor(' + rgb + ')' + source.slice(tokens[comma].start);
}
function verifyFoliageFragment(source) {
  const has = needle => foliageShaderMatches(source, needle).length > 0;
  const color = has('color = foliageLitColor(color);') || has('gl_FragColor = vec4(foliageLitColor(');
  const texel = has('foliageTextureColor(texture2D(') ||
    (has('#define HM_FOLIAGE_TEXEL(value) foliageTextureColor(value)') && has('HM_FOLIAGE_TEXEL(texture2D('));
  if (!has('uniform float uCut;') || !has('if (hasMap && texture2D(map, vUv).a < uCut) discard;') || !color || !texel)
    throw Error('foliage material integration: cutout, colour or texture hook was not installed');
  return source;
}
function patchFoliageFragment(source) {
  const original = source;
  if (foliageFragmentPatches.has(source)) return foliageFragmentPatches.get(source);
  const marker = '// HMP_FOLIAGE_CUTOUT';
  if (source.includes(marker)) return cacheFoliageShader(foliageFragmentPatches, original, verifyFoliageFragment(source));
  source = foliageShaderReplace(source, 'if (!gl_FrontFacing) { n = -n; }', '', false);
  const declarations = marker + '\n' + "uniform float uCut;\nuniform vec3 uTint;\nuniform float uTintAmount;\nuniform float uMask;\nuniform vec3 uColorA;\nuniform vec3 uColorB;\nuniform float uTextureContrast;\nvec3 foliageTextureColor(vec3 texel) {\n  if (uTextureContrast == 1.0) return texel;\n  float lum = dot(texel, vec3(0.2126, 0.7152, 0.0722));\n  float adjusted = max(0.0, 0.18 + (lum - 0.18) * uTextureContrast);\n  return lum > 0.0001 ? texel * (adjusted / lum) : vec3(adjusted);\n}\nvec3 foliageLitColor(vec3 color) {\n  float lum = dot(color, vec3(0.299, 0.587, 0.114));\n  vec3 tinted = mix(color, uTint * lum * 1.6, uTintAmount);\n  vec3 masked = mix(uColorA, uColorB, clamp(vUv.y, 0.0, 1.0)) * (0.35 + lum * 1.5);\n  return mix(tinted, masked, uMask);\n}\n";
  if (source.includes('HM_FOLIAGE_DECLARATIONS')) {
    source = foliageShaderMarker(source, 'HM_FOLIAGE_DECLARATIONS', declarations + "#define HM_FOLIAGE_TEXEL(value) foliageTextureColor(value)\n");
    source = foliageShaderMarker(source, 'HM_FOLIAGE_ALPHA', 'if (hasMap && texture2D(map, vUv).a < uCut) discard;');
    source = foliageShaderMarker(source, 'HM_FOLIAGE_COLOR', 'color = foliageLitColor(color);');
  } else {
    source = foliageShaderReplace(source, 'texture2D(map, vUv).rgb', 'foliageTextureColor(texture2D(map, vUv).rgb)');
    source = foliageLegacyOutput(source);
    source = foliageShaderReplace(source, 'void main() {', declarations + '\nvoid main() {\nif (hasMap && texture2D(map, vUv).a < uCut) discard;');
  }
  return cacheFoliageShader(foliageFragmentPatches, original, verifyFoliageFragment(source));
}


function rng(seed) {
  let s = (Math.round(seed) || 1) >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function weldCards(input) {
  const pos = [], nor = [], uv = [], idx = [], anchors = [], windAxes = [];
  const crownH = input.crownH;
  const cy = input.base + crownH * 0.55;
  const flat = input.normalFlatten === undefined ? 1 : input.normalFlatten;
  const push = function (x, y, z, u, v) {
    pos.push(x, y, z);
    uv.push(u, v);
    const dx = x, dy = (y - cy) * flat, dz = z;
    const l = Math.hypot(dx, dy, dz) || 1;
    nor.push(dx / l, dy / l, dz / l);
  };
  const quad = function (anchor, axis = [0, 1, 0]) {
    const b = pos.length / 3 - 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    const root = anchor || [(pos[b * 3] + pos[(b + 1) * 3]) / 2, pos[b * 3 + 1], (pos[b * 3 + 2] + pos[(b + 1) * 3 + 2]) / 2];
    for (let i = 0; i < 4; i++) {
      anchors.push(root[0], root[1], root[2]);
      windAxes.push(axis[0], axis[1], axis[2]);
    }
  };
  const rand = input.rand;

  const addTier = function (t) {
    for (let i = 0; i < t.n; i++) {
      const a = (t.yaw0 || 0) + (Math.PI * i) / t.n + (rand() - 0.5) * 0.25;
      const ca = Math.cos(a), sa = Math.sin(a);
      const first = t.exact !== false && i === 0;
      let ox = 0, oz = 0, oy = 0;
      if (!first && ((t.scatterR || 0) > 0 || (t.scatterH || 0) > 0)) {
        const ang = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * (t.scatterR || 0);
        ox = Math.cos(ang) * rr;
        oz = Math.sin(ang) * rr;
        oy = Math.pow(rand(), 0.7) * (t.scatterH || 0);
      }
      const hh = t.ch * (first ? 1 : 0.86 + rand() * 0.14);
      const hw = (t.cw / 2) * (first ? 1 : 0.86 + rand() * 0.14);
      const p = first ? 0 : (i % 2 ? 1 : -1) * t.pitch;
      const leanCap = (t.cw / 2) * 0.4;
      const lean = Math.max(-leanCap, Math.min(leanCap, hh * Math.tan(p)));
      const rot = function (x, z) { return [x * ca + z * sa, -x * sa + z * ca]; };
      const r0 = rot(-hw, 0), r1 = rot(hw, 0), rp = rot(0, lean);
      const by = t.base + oy;
      push(r0[0] + ox, by, r0[1] + oz, 0, 0);
      push(r1[0] + ox, by, r1[1] + oz, 1, 0);
      push(r1[0] + ox + rp[0], by + hh, r1[1] + oz + rp[1], 1, 1);
      push(r0[0] + ox + rp[0], by + hh, r0[1] + oz + rp[1], 0, 1);
      quad();
    }
  };

  const finish = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("foliageAnchor", new THREE.Float32BufferAttribute(anchors, 3));
    g.setAttribute("foliageAxis", new THREE.Float32BufferAttribute(windAxes, 3));
    g.userData.foliageWindFlex = input.windFlex === undefined ? 0.16 : input.windFlex;
    g.setIndex(idx);
    return g;
  };

  if (input.layout === 'branches' && input.tips?.length) {
    const count = input.cards + (input.topCard ? input.topCards : 0);
    for (let i = 0; i < count; i++) {
      const tip = input.tips[i % input.tips.length];
      const root = new THREE.Vector3(...tip.from);
      const axis = new THREE.Vector3(...tip.pos).sub(root);
      const branchLength = axis.length();
      if (branchLength < 1e-5) axis.set(0, 1, 0); else axis.divideScalar(branchLength);
      const reference = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const side = reference.clone().addScaledVector(axis, -reference.dot(axis)).normalize();
      side.applyAxisAngle(axis, Math.floor(i / input.tips.length) * 1.5708 + Math.sin(i * 2.39996) * 0.2);
      const length = Math.min(input.ch, Math.max(0.1, branchLength * 1.45));
      const width = Math.min(input.cw, length * input.textureAspect);
      const offsets = [
        side.clone().multiplyScalar(-width / 2), side.clone().multiplyScalar(width / 2),
        side.clone().multiplyScalar(width / 2).addScaledVector(axis, length),
        side.clone().multiplyScalar(-width / 2).addScaledVector(axis, length)
      ];
      let fit = 1;
      const lo = [-input.boxW / 2, 0, -input.boxW / 2], hi = [input.boxW / 2, input.topY, input.boxW / 2];
      for (const offset of offsets) for (let j = 0; j < 3; j++) {
        const delta = offset.getComponent(j);
        if (Math.abs(delta) > 1e-8) fit = Math.min(fit, ((delta > 0 ? hi[j] : lo[j]) - root.getComponent(j)) / delta);
      }
      fit = Math.max(0, fit);
      for (let j = 0; j < 4; j++) {
        const p = offsets[j].multiplyScalar(fit).add(root);
        push(p.x, p.y, p.z, j === 1 || j === 2 ? 1 : 0, j >= 2 ? 1 : 0);
      }
      quad(root.toArray(), axis.toArray());
    }
    return finish();
  }

  const addAnchorCards = function (t) {
    const anchors = t.anchors;
    const n = anchors.length;
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    order.sort(function (a, b) { return anchors[a].pos[1] - anchors[b].pos[1]; });

    const place = function (idx, layer, count, sizeK, pitch) {
      const a = anchors[idx];
      const tp = a.pos;
      const k = Math.max(0.6, Math.min(1.35, (a.scale === undefined ? 0.5 : a.scale) / 0.5)) * sizeK;
      const yaw = idx * 2.39996 + layer * 1.1 + (rand() - 0.5) * 0.4;
      const ca = Math.cos(yaw), sa = Math.sin(yaw);
      const hw = (t.baseW * k) / 2;
      const topY = t.topY === undefined ? Infinity : t.topY;
      let hh = Math.min(t.baseH * k, Math.max(0, (topY - tp[1]) / 0.55));
      if (hh < 1e-4) return;
      const y0 = Math.max(0, tp[1] - hh * 0.45);
      const inset = layer === 0 ? 0 : hw * 0.18 * (layer % 2 ? 1 : -1);
      const lean = Math.max(-hw * 0.4, Math.min(hw * 0.4, hh * Math.tan(pitch || 0)));
      const rot = function (x, z) { return [x * ca + z * sa, -x * sa + z * ca]; };
      const r0 = rot(-hw + inset, 0), r1 = rot(hw + inset, 0), rp = rot(0, lean);
      push(tp[0] + r0[0], y0, tp[2] + r0[1], 0, 0);
      push(tp[0] + r1[0], y0, tp[2] + r1[1], 1, 0);
      push(tp[0] + r1[0] + rp[0], y0 + hh, tp[2] + r1[1] + rp[1], 1, 1);
      push(tp[0] + r0[0] + rp[0], y0 + hh, tp[2] + r0[1] + rp[1], 0, 1);
      quad(tp);
    };

    for (let i = 0; i < t.cards; i++) {
      place(order[i % n], Math.floor(i / n), t.cards, 1, 0);
    }
    const hiFrom = Math.max(0, n - Math.max(1, Math.round(n * 0.4)));
    const hi = order.slice(hiFrom);
    for (let i = 0; i < t.topCards; i++) {
      place(hi[i % hi.length], Math.floor(i / hi.length) + 1, t.topCards, t.conical ? 0.45 : 0.6, t.topPitch);
    }
  };

  const fullAnchors = input.layout === "anchors-full" || input.layout === "anchors-lit"
    || input.layout === "anchors-dense" || input.layout === "anchors-crown";
  if (fullAnchors && Array.isArray(input.tips) && input.tips.length > 0) {
    addAnchorCards({
      anchors: input.tips,
      baseW: input.tipCard ? input.tipCard.w : input.cw,
      baseH: input.tipCard ? input.tipCard.h : input.ch,
      cards: input.cards, topCards: input.topCard ? input.topCards : 0,
      conical: input.conical, topPitch: ((input.conical ? -42 : 60) * Math.PI) / 180,
      topY: input.topY
    });
    return finish();
  }

  if (input.layout === "anchors" && Array.isArray(input.tips) && input.tips.length > 0) {
    const baseW = input.tipCard ? input.tipCard.w : input.cw;
    const baseH = input.tipCard ? input.tipCard.h : input.ch;
    for (let i = 0; i < input.tips.length; i++) {
      const t = input.tips[i];
      const tp = t.pos || [0, input.base, 0];
      const k = Math.max(0.6, Math.min(1.35, (t.scale === undefined ? 0.5 : t.scale) / 0.5));
      const a = (Math.PI * i) / input.tips.length + (rand() - 0.5) * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      const hw = (baseW * k) / 2;
      const topY = input.topY === undefined ? Infinity : input.topY;
      const hh = Math.min(baseH * k, topY - tp[1] + baseH * k * 0.5);
      const y0 = Math.max(0, tp[1] - hh * 0.45);
      const rot = function (x, z) { return [x * ca + z * sa, -x * sa + z * ca]; };
      const r0 = rot(-hw, 0), r1 = rot(hw, 0);
      push(tp[0] + r0[0], y0, tp[2] + r0[1], 0, 0);
      push(tp[0] + r1[0], y0, tp[2] + r1[1], 1, 0);
      push(tp[0] + r1[0], y0 + hh, tp[2] + r1[1], 1, 1);
      push(tp[0] + r0[0], y0 + hh, tp[2] + r0[1], 0, 1);
      quad(tp);
    }
    return finish();
  }

  addTier({
    n: input.cards, cw: input.cw, ch: input.ch, base: input.base, pitch: input.pitch,
    scatterR: input.scatterR, scatterH: input.scatterH
  });

  if (input.topCard) {
    const at = Math.min(input.topAt, 0.6);
    const k = input.conical ? 0.34 : 0.55;
    const tp = ((input.conical ? -42 : 60) * Math.PI) / 180;
    const tch = Math.min(input.ch * 0.5, crownH * (1 - at));
    addTier({
      n: input.topCards, cw: input.cw * k, ch: tch, base: input.base + crownH * at,
      pitch: tp, yaw0: 0.7, exact: false,
      scatterR: Math.max(0, (input.scatterR || 0) * 0.7),
      scatterH: Math.max(0, crownH * (1 - at) - tch)
    });
  }

  return finish();
}

const FOLIAGE_UNIFORMS = ['uCut', 'uTint', 'uTintAmount', 'uMask', 'uColorA', 'uColorB', 'uTextureContrast']

function foliageUniformHandles(mat) {
  mat.userData.foliage = Object.fromEntries(FOLIAGE_UNIFORMS.map((key) => [key, mat.uniforms[key]]))
  return mat.userData.foliage
}

class FoliageMaterial extends THREE.ShaderMaterial {
  get map() { return this.uniforms?.map?.value ?? null }
  set map(value) { this.uniforms.map = { value } }
  get alphaTest() { return this.uniforms?.uCut?.value ?? super.alphaTest }
  set alphaTest(value) {
    super.alphaTest = value
    if (this.uniforms?.uCut) this.uniforms.uCut.value = value
  }

  copy(source) {
    super.copy(source)
    for (const [key, uniform] of Object.entries(source.uniforms)) {
      if (uniform.value?.isTexture) this.uniforms[key].value = uniform.value
      if (windUniforms[key]) this.uniforms[key] = windUniforms[key]
    }
    if (this.uniforms.uCut) foliageUniformHandles(this)
    return this
  }
}

export function makeCutout(mesh, { cut = 0.5, tint = null, tintAmount = 0, mask = false, colorA = 0x2f6b2a, colorB = 0x7fb04a, textureContrast = 1 } = {}) {
  const original = mesh.material
  if (!original?.isShaderMaterial) throw new Error('makeCutout requires the lit ShaderMaterial; call applyLitMaterial first')
  const fragment = patchFoliageFragment(original.fragmentShader)
  const mat = original instanceof FoliageMaterial ? original : new FoliageMaterial().copy(original)
  mat.fragmentShader = fragment
  mat.side = THREE.DoubleSide
  mat.transparent = false
  Object.assign(mat.uniforms, {
    uCut: { value: cut },
    uTint: { value: new THREE.Color(tint ?? 0xffffff) },
    uTintAmount: { value: tint ? tintAmount : 0 },
    uMask: { value: mask ? 1 : 0 },
    uColorA: { value: new THREE.Color(colorA) },
    uColorB: { value: new THREE.Color(colorB) },
    uTextureContrast: { value: Number.isFinite(textureContrast) ? Math.max(0, Math.min(2, textureContrast)) : 1 },
  })
  mat.alphaTest = cut
  if (mesh.geometry.getAttribute('foliageAnchor')) {
    mat.vertexShader = windVertex(original.vertexShader)
    Object.assign(mat.uniforms, windUniforms)
    mat.uniforms.uWindFlex ??= { value: mesh.geometry.userData.foliageWindFlex ?? 0.16 }
    if (!mesh.geometry.userData.foliageWindBounds) {
      const p = mesh.geometry.getAttribute('position'), a = mesh.geometry.getAttribute('foliageAnchor')
      let reach = 0
      const axis = mesh.geometry.getAttribute('foliageAxis')
      for (let i = 0; i < p.count; i++) reach = Math.max(reach, Math.abs(axis
        ? (p.getX(i)-a.getX(i))*axis.getX(i)+(p.getY(i)-a.getY(i))*axis.getY(i)+(p.getZ(i)-a.getZ(i))*axis.getZ(i)
        : p.getY(i)-a.getY(i)))
      mesh.geometry.computeBoundingSphere()
      mesh.geometry.boundingSphere.radius += reach * mat.uniforms.uWindFlex.value * 3.4
      mesh.geometry.userData.foliageWindBounds = true
    }
  }
  foliageUniformHandles(mat)
  mat.needsUpdate = true
  mesh.material = mat
  prepareFoliageWind(mesh)
  return mesh
}

function ownFoliageMaterial(node) {
  const owned = node.material.clone();
  const uniforms = foliageUniformHandles(owned);
  owned.userData.foliageOwned = true;
  node.material = owned;
  return uniforms;
}

function eachFoliageUniforms(root, visit) {
  let count = 0;
  root.traverse(function (node) {
    if (!node.material || !node.material.userData || !node.material.userData.foliage) return;
    const uniforms = node.material.userData.foliageOwned === true
      ? node.material.userData.foliage
      : ownFoliageMaterial(node);
    if (visit(uniforms) !== false) count += 1;
  });
  return count > 0;
}

export function tintFoliage(root, color, amount) {
  return eachFoliageUniforms(root, function (uniforms) {
    uniforms.uTint.value.set(color);
    uniforms.uTintAmount.value = amount === undefined ? 0.7 : amount;
    uniforms.uMask.value = 0;
  });
}

export function paintFoliage(root, colorBottom, colorTop) {
  return eachFoliageUniforms(root, function (uniforms) {
    uniforms.uColorA.value.set(colorBottom);
    uniforms.uColorB.value.set(colorTop === undefined ? colorBottom : colorTop);
    uniforms.uMask.value = 1;
  });
}

export function resetFoliageColor(root) {
  return eachFoliageUniforms(root, function (uniforms) {
    uniforms.uMask.value = 0;
    uniforms.uTintAmount.value = 0;
  });
}

export function setFoliageAppearance(root, { textureContrast = 1 } = {}) {
  if (!Number.isFinite(textureContrast)) return false;
  return eachFoliageUniforms(root, function (uniforms) {
    if (!uniforms.uTextureContrast) return false;
    uniforms.uTextureContrast.value = Math.max(0, Math.min(2, textureContrast));
  });
}

export function cloneFoliage(source) {
  const copy = source.clone();
  const originals = [];
  source.traverse(function (node) { originals.push(node); });
  let index = 0;
  copy.traverse(function (node) {
    const original = originals[index++];
    if (original && original.customDepthMaterial) node.customDepthMaterial = original.customDepthMaterial;
  });
  return copy;
}

function buildTrunkMesh(trunk, material, barkMeters) {
  const group = new THREE.Group();
  const meters = barkMeters > 0 ? barkMeters : 2.5;
  for (let i = 0; i < trunk.segments.length; i++) {
    const s = trunk.segments[i];
    const f = new THREE.Vector3(s.from[0], s.from[1], s.from[2]);
    const t = new THREE.Vector3(s.to[0], s.to[1], s.to[2]);
    const d = new THREE.Vector3().subVectors(t, f);
    const l = d.length();
    if (l < 1e-4) continue;
    d.normalize();
    const bent = s.bend > 0.01;
    const g = new THREE.CylinderGeometry(s.r1, s.r0, l, s.seg, bent ? 2 : 1, true);
    if (bent) {
      const off = s.bend * l * s.jitter;
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const u = (p.getY(k) + l / 2) / l;
        p.setX(k, p.getX(k) + off * u * u);
      }
      p.needsUpdate = true;
      g.computeVertexNormals();
    }
    const uv = g.attributes.uv;
    if (uv) {
      const vScale = l / meters;
      for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * vScale);
      uv.needsUpdate = true;
    }
    const m = new THREE.Mesh(g, material);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    m.position.copy(f).addScaledVector(d, l / 2);
    group.add(m);
  }
  return group;
}

function flattenToOneMesh(group, material) {
  group.updateMatrixWorld(true);
  const positions = [], normals = [], uvs = [], indices = [];
  let offset = 0;
  group.traverse(function (node) {
    if (!node.isMesh || !node.geometry) return;
    const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    const m = node.matrixWorld;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
      if (n) {
        v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize();
        normals.push(v.x, v.y, v.z);
      } else {
        normals.push(0, 1, 0);
      }
      uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      indices.push(offset + i);
    }
    offset += p.count;
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  return new THREE.Mesh(merged, material);
}

const loadedTextures = new Map();
function loadTexture(url, wrap) {
  const key = url + "#" + (wrap ? "repeat" : "clamp");
  if (!loadedTextures.has(key)) loadedTextures.set(key, new Promise(function (resolve, reject) {
    new THREE.TextureLoader().load(url, function (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      if (wrap) { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; }
      resolve(tex);
    }, undefined, function () {
      reject(new Error("贴图加载失败：" + url));
    });
  }));
  return loadedTextures.get(key);
}

async function loadFoliageInputs(input) {
  const spec = input.spec;
  const baseUrl = input.baseUrl;
  const solid = spec.representation === 'solid_geometry';
  if (solid && !spec.customModule) throw new Error('Solid foliage requires its validated custom module');
  if (!solid && !spec.texture) throw new Error('Cutout foliage requires a leaf texture');
  if (spec.customModule && !/^src[/]foliage[/][a-zA-Z0-9_-]+\.js$/.test(spec.customModule)) throw new Error('Invalid foliage module path');
  const [leafTex, barkTex, module] = await Promise.all([
    solid ? null : loadTexture(new URL(spec.texture, baseUrl).href, false),
    spec.bark ? loadTexture(new URL(spec.bark, baseUrl).href, true).catch(function () { return null; }) : null,
    spec.customModule ? import(new URL(spec.customModule, baseUrl).href) : null
  ]);
  return { leafTex, barkTex, module };
}

export async function preloadFoliage(input) {
  await loadFoliageInputs(input);
}

export async function buildFoliage(input) {
  const spec = input.spec;
  const solid = spec.representation === 'solid_geometry';
  const inputs = await loadFoliageInputs(input);
  const leafTex = inputs.leafTex ? inputs.leafTex.clone() : null;
  const barkTex = inputs.barkTex ? inputs.barkTex.clone() : null;

  if (spec.customModule) {
    const module = inputs.module;
    const group = module.createFoliage({ THREE, spec, leafTexture: leafTex, barkTexture: barkTex });
    if (!group?.isObject3D) throw new Error('createFoliage must return Object3D');
    group.traverse(function (node) {
      if (!node.isMesh) return;
      const leaf = !!leafTex && node.material?.map === leafTex;
      if (leaf && !node.geometry.getAttribute('foliageAnchor')) {
        const positions = node.geometry.getAttribute('position');
        const anchors = new Float32Array(positions.count * 3);
        const axes = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) axes[i * 3 + 1] = 1;
        node.geometry.setAttribute('foliageAnchor', new THREE.BufferAttribute(anchors, 3));
        node.geometry.setAttribute('foliageAxis', new THREE.BufferAttribute(axes, 3));
        node.geometry.userData.foliageWindFlex = 0.04;
      }
      applyLitMaterial(node);
      if (leaf) makeCutout(node, { cut: 0.5 });
      node.castShadow = true;
      node.receiveShadow = true;
    });
    group.userData.foliage = { slotId: spec.slotId, form: spec.form, mode: 'javascript', representation: solid ? 'solid_geometry' : 'cards', representationReason: spec.representationReason ?? null };
    return group;
  }

  const w = spec.bounds.width, h = spec.bounds.height, d = spec.bounds.depth;
  const rand = rng(spec.seed || 1);
  const boxW = Math.min(w, d);
  const crownH = h * spec.canopyFrac;
  const crownBase = Math.max(0, h - crownH);

  const conical = spec.taper < 0.55 && h > boxW * 1.5;
  const stretch = conical ? 1.05 : 1.35;


  const aspect = spec.textureAspect > 0.05 ? spec.textureAspect : 1;
  const wantW = Math.min(spec.cardMeters[0], boxW);
  const wantH = Math.min(spec.cardMeters[1], crownH);
  let ch = Math.min(wantH, wantW / aspect);
  let cw = Math.min(wantW, ch * aspect * stretch);
  ch = Math.min(wantH, cw / aspect);
  const layout = spec.layout || "scatter";

  const scatterR = Math.max(0, boxW / 2 - cw / 2);
  let scatterH = Math.max(0, crownH - ch);
  if (layout === "scatter-tight") scatterH = Math.min(scatterH, ch * 0.5);

  const group = new THREE.Group();

  let trunkMesh = null;
  let tips = null;
  if (spec.trunk && spec.trunk.segments.length > 0 && crownBase > 0.01) {
    const barkMat = new THREE.MeshStandardMaterial({
      color: barkTex ? 0xffffff : spec.trunk.color,
      map: barkTex,
      roughness: 0.95,
      metalness: 0
    });
    const built = buildTrunkMesh(spec.trunk, barkMat, spec.trunk.barkMeters);
    trunkMesh = flattenToOneMesh(built, barkMat);
    trunkMesh.name = spec.slotId + "_trunk";
    tips = (layout.startsWith("anchors") || layout === 'branches') && spec.trunk.tips?.length ? spec.trunk.tips : null;
    if (layout === 'branches') {
      const segments = spec.trunk.segments;
      const ends = tips || segments.map(s => ({pos: s.end || s.to, from: s.from, scale: 0.5}));
      tips = ends.map(t => {
        if (t.from) return t;
        let nearest = segments[0], distance = Infinity;
        for (const s of segments) {
          const end = s.end || s.to;
          const d = Math.hypot(end[0]-t.pos[0], end[1]-t.pos[1], end[2]-t.pos[2]);
          if (d < distance) { nearest = s; distance = d; }
        }
        return {...t, from: nearest.from};
      });
    }
  }

  let tipCard = null;
  if (tips) {
    const overlap = layout === "anchors-dense" || layout === "anchors-crown" ? 1.15 : 0.95;
    const clusterW = Math.min(cw, (boxW / Math.sqrt(tips.length)) * overlap);
    tipCard = { w: clusterW, h: clusterW / Math.max(aspect, 0.05) };
  }

  const geo = weldCards({
    cw: cw, ch: ch, base: crownBase, crownH: crownH,
    scatterR: scatterR, scatterH: scatterH,
    cards: spec.cards, topCard: spec.topCard, topCards: spec.topCards, topAt: spec.topAt,
    conical: conical,
    pitch: ((conical ? -spec.pitchDeg * 0.5 : spec.pitchDeg) * Math.PI) / 180,
    tips: tips, tipCard: tipCard, topY: h, boxW: boxW, textureAspect: aspect, rand: rand,
    layout: layout,
    windFlex: spec.form === 'tree' ? 0.08 : spec.form === 'grass' ? 0.32 : 0.16,
    normalFlatten:
      layout === "anchors-lit" || layout === "anchors-dense" || layout === "anchors-crown"
        ? 0.35 : 1
  });
  geo.computeBoundingBox();
  let bb = geo.boundingBox;
  const centerShift = new THREE.Matrix4().makeTranslation(layout === 'branches' ? 0 : -(bb.max.x + bb.min.x) / 2, 0, layout === 'branches' ? 0 : -(bb.max.z + bb.min.z) / 2);
  geo.applyMatrix4(centerShift);
  geo.getAttribute('foliageAnchor').applyMatrix4(centerShift);
  geo.computeBoundingBox();
  bb = geo.boundingBox;
  const spread = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  if (spread > boxW && spread > 0) {
    const shrink = new THREE.Matrix4().makeScale(boxW / spread, 1, boxW / spread);
    geo.applyMatrix4(shrink);
    geo.getAttribute('foliageAnchor').applyMatrix4(shrink);
  }

  const leaves = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: leafTex, roughness: 0.9, metalness: 0 }));
  leaves.name = spec.slotId + "_leaves";
  applyLitMaterial(leaves);
  makeCutout(leaves, { cut: 0.5 });
  group.add(leaves);
  if (trunkMesh) group.add(trunkMesh);

  group.updateMatrixWorld(true);
  const pre = new THREE.Box3().setFromObject(group);
  if (Math.abs(pre.min.y) > 1e-4) group.position.y -= pre.min.y;

  group.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(group);
  const wx = Math.max(Math.abs(whole.min.x), Math.abs(whole.max.x)) * 2;
  const wz = Math.max(Math.abs(whole.min.z), Math.abs(whole.max.z)) * 2;
  const k = Math.min(1, h / Math.max(whole.max.y, 1e-6), w / Math.max(wx, 1e-6), d / Math.max(wz, 1e-6));
  if (k < 0.999) {
    group.scale.multiplyScalar(k);
    group.updateMatrixWorld(true);
    const after = new THREE.Box3().setFromObject(group);
    if (Math.abs(after.min.y) > 1e-4) group.position.y -= after.min.y;
  }

  group.userData.foliage = {
    slotId: spec.slotId, form: spec.form, cards: spec.cards, conical: conical,
    layout: layout, anchors: tips ? tips.length : 0,
    clampedBy: k < 0.999 ? k : null
  };
  return group;
}
