import { trackFactoryObject, trackFactoryTexture, trackFactoryMaterial, factoryFact } from "../factory-usage.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import * as sceneVisual from "../../src/visual.js";
import {
  applyLitMaterial,
  createBlendSurfaceMaterial as buildBlendSurface,
  createSkyDome,
  setupLighting,
  syncSceneLights
} from "../../src/visual.js";
import { scanAssetScene } from "./asset-diagnostics.js";

const ASSET_RUNTIME_URL = new URL("../asset-runtime.js", import.meta.url);
let manifest = null;
const diagnostics = Object.create(null);
const requestedAssetIds = Object.create(null);
const unknownSlots = Object.create(null);
const registeredRoots = new WeakSet();
const rootSlotIds = new WeakMap();
const deliveredModelIdentities = new WeakMap();
const createdCharacterNormalizations = new WeakMap();
let attachmentRuntime = null;
let attachmentRuntimeLoad = null;
function loadAttachmentRuntime(){
  attachmentRuntimeLoad ||= import(new URL("runtime/asset-attachments.js", new URL("../",ASSET_RUNTIME_URL)).href)
    .then(module=>{attachmentRuntime=module;return module;})
    .catch(error=>{attachmentRuntimeLoad=null;throw error;});
  return attachmentRuntimeLoad;
}
function sameAttachmentNormalization(a,b){
  return !!a&&!!b&&(a.rotationX||0)===(b.rotationX||0)&&a.rotationY===b.rotationY&&
    ['scale','offset'].every(key=>Array.isArray(a[key])&&Array.isArray(b[key])&&a[key].length===3&&b[key].length===3&&a[key].every((n,i)=>n===b[key][i]));
}
function characterNormalization(slot){
  const rig=slot.rig,transform=slot.generated?.transform;
  const bindHeight=Number(rig?.bindHeight);
  return JSON.stringify({height:slot.bounds.height,origin:slot.origin,bindHeight:Number.isFinite(bindHeight)&&bindHeight>0?bindHeight:0,
    rotationX:transform?.rotationX||0,rotationY:transform?.rotationY||0,clips:Array.isArray(rig?.clips)?rig.clips:null});
}
const consumedSurfaceIds = Object.create(null);
const surfaceLoads = Object.create(null);
function noteSurfaceUse(slotId) {
  if (typeof slotId === "string" && slotId) consumedSurfaceIds[slotId] = true;
}
const anchorRefs = [];
const MAX_ANCHOR_REFS = 32;
const MAX_TRIANGLE_OWNERS = 5;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const loadedGlb = new Map();
const loadedTexture = new Map();
const loadedFoliage = new Map();
const loadedFoliageResources = new Map();
let createsStarted = 0;
let createsSettled = 0;
let createsPending = 0;
let lastAssetActivityAt = 0;

let animationRuntime = null;

let foliageRuntime = null;
let windOptions = {"strength":1,"speed":3,"noiseScale":0.25,"direction":[1,0.3]};

function markAssetActivity() {
  lastAssetActivityAt = Date.now();
}

let manifestLoad = null;
let manifestFailed = false;
let assetReadySignalExposed = false;
function exposeAssetReadySignal() {
  if (assetReadySignalExposed || typeof window === "undefined") return;
  assetReadySignalExposed = true;
  try { Object.defineProperty(window, "__HM_ASSET_READY__", {
    configurable: false,
    enumerable: true,
    get: function () {
      return Object.freeze({
        initialized: manifest !== null,
        failed: manifestFailed,
        slotCount: manifest && manifest.slots ? Object.keys(manifest.slots).length : 0,
        started: createsStarted,
        settled: createsSettled,
        pending: createsPending,
        idleMs: Date.now() - lastAssetActivityAt
      });
    }
  }); } catch {}
}

function buildGeometry(primitive, bounds) {
  const w = bounds.width;
  const h = bounds.height;
  const d = bounds.depth;
  switch (primitive) {
    case "plane": return new THREE.PlaneGeometry(w, d);
    case "sphere": return new THREE.SphereGeometry(Math.max(w, h, d) / 2, 16, 12);
    case "cone": return new THREE.ConeGeometry(Math.max(w, d) / 2, h, 16);
    case "cylinder": return new THREE.CylinderGeometry(Math.max(w, d) / 2, Math.max(w, d) / 2, h, 16);
    default: return new THREE.BoxGeometry(w, h, d);
  }
}

function wrapForBusiness(inner) {
  const outer = new THREE.Group();
  outer.add(inner);
  return outer;
}

function buildEmergency(slot) {
  const fallback = slot.emergency || {};
  const bounds = slot.bounds || { width: 1, height: 1, depth: 1 };
  const primitive = fallback.primitive || "box";
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(fallback.color || "#c8ccd4"),
    roughness: 0.85,
    metalness: 0.05
  });
  const mesh = new THREE.Mesh(buildGeometry(primitive, bounds), material);
  if (primitive === "plane") mesh.rotation.x = -Math.PI / 2;
  const inner = new THREE.Group();
  inner.add(mesh);
  alignOrigin(inner, slot.origin);
  return wrapForBusiness(inner);
}


function surfaceUvScale(tilingMeters) {
  return (buildBlendSurface.uvScaleUnit === "repeats-per-meter" ? 1 : 10) / tilingMeters;
}

function applySurfaceMaterial(object, slot, slotId) {
  const materialSpec = slot && slot.material;
  if (!materialSpec) return;
  const tilingMeters = surfaceTilingMeters(slot);
  const material = buildBlendSurface(
    {
      base: surfaceTexture(slot, slotId, "base"),
      blend: surfaceTexture(slot, slotId, "blend")
    },
    null,
    tilingMeters > 0 ? { uvScale: surfaceUvScale(tilingMeters) } : null
  );
  object.traverse(function (node) {
    if (!node.isMesh) return;
    node.material = material;
    node.castShadow = true;
    node.receiveShadow = true;
  });
}

function surfaceTilingMeters(slot) {
  const material = slot.material;
  if (!material) return null;
  if (material.tilingMeters > 0) return material.tilingMeters;
  if (!(material.uvScale > 0)) return null;
  const bounds = slot.bounds || { width: 0, height: 0, depth: 0 };
  const span = Math.max(bounds.width, bounds.depth);
  if (!(span > 0)) return null;
  return span / material.uvScale;
}

function surfaceTexture(slot, slotId, layer) {
  const material = slot.material;
  if (!material) return null;
  const path = layer === "blend" ? material.blend : material.base;
  if (!path) return null;
  const cacheKey = slotId + "/" + layer;
  if (!loadedTexture.has(cacheKey)) {
    surfaceLoads[cacheKey] = { loaded: false };
    const texture = new THREE.TextureLoader().load(new URL("../" + path, ASSET_RUNTIME_URL).href,
      function () { surfaceLoads[cacheKey] = { loaded: true }; try { const fact = factoryFact('surface', slotId, layer, path); if (fact) fact.loaded = true; } catch {} },
      undefined,
      function () { surfaceLoads[cacheKey] = { loaded: false, error: "texture_load_failed" }; try { const fact = factoryFact('surface', slotId, layer, path); if (fact) fact.error = 'texture_load_failed'; } catch {} });
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    loadedTexture.set(cacheKey, texture);
  }
  const copy = loadedTexture.get(cacheKey).clone();
  try { trackFactoryTexture(copy, slotId, layer, path); } catch {}
  return copy;
}

function alignOrigin(object, origin) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const y = origin === "bottom-center" ? box.min.y : origin === "top-center" ? box.max.y : center.y;
  object.position.add(new THREE.Vector3(-center.x, -y, -center.z));
  object.updateMatrixWorld(true);
}

function applyGeneratedTransform(object, transform) {
  const value = transform || { scale: [1, 1, 1], rotationY: 0, offset: [0, 0, 0] };
  object.scale.set(value.scale[0], value.scale[1], value.scale[2]);
  object.rotation.set(value.rotationX || 0, value.rotationY, 0);
  object.position.set(value.offset[0], value.offset[1], value.offset[2]);
  object.updateMatrixWorld(true);
}

function assertObject3D(value, source) {
  if (!value || value.isObject3D !== true) throw new Error(source + " 未返回 THREE.Object3D");
  return value;
}

function loadGlb(resource, sha256) {
  const url = new URL("../" + resource, ASSET_RUNTIME_URL);
  if (typeof sha256 === "string" && /^[a-f0-9]{64}$/.test(sha256)) {
    url.searchParams.set("sha256", sha256);
  }
  const key = url.href;
  if (!loadedGlb.has(key)) {
    loadedGlb.set(key, new Promise(function (resolve, reject) {
      loader.load(url.href, function (gltf) {
        resolve({ scene: gltf.scene, animations: gltf.animations || [], parser: gltf.parser });
      }, undefined, reject);
    }));
  }
  return loadedGlb.get(key);
}

function canDeliverGenerated(slot, generated) {
  const rig = slot.rig;
  if (!rig) return true;
  if (!rig.outcome || rig.outcome === "rigged") return false;
  if (generated && generated.tposeDesign === true) return false;
  return rig.outcome !== "tpose_static" || rig.staticFallback === true;
}

async function createGenerated(slot, generated) {
  if (!canDeliverGenerated(slot, generated)) return null;
  if (!generated || generated.status !== "ready" || !generated.resource) return null;
  const loaded = await loadGlb(generated.resource, generated.sha256);
  const inner = cloneSkinned(assertObject3D(loaded.scene, "generated asset"));
  applyGeneratedTransform(inner, generated.transform);
  applyLitMaterial(inner);
  const outer = wrapForBusiness(inner);
  outer.userData.factoryResource = generated.resource;
  outer.userData.factorySha256 = generated.sha256;
  outer.userData.factoryTransform = generated.transform;
  return outer;
}

function applyPartTransform(node, part) {
  const attach = part.attach || {};
  const position = attach.position || [0, 0, 0];
  const quaternion = attach.quaternion || [0, 0, 0, 1];
  const scale = attach.scale || [1, 1, 1];
  node.name = part.name;
  const pivot = part.pivot || [0, 0, 0];
  if (node.children[0]) node.children[0].position.add(new THREE.Vector3(pivot[0], pivot[1], pivot[2]));
  node.position.set(position[0], position[1], position[2]);
  node.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  node.scale.set(scale[0], scale[1], scale[2]);
}

async function createParted(slot, variant, id) {
  if (!Array.isArray(slot.parts) || slot.parts.length === 0) return null;
  const root = new THREE.Group();
  for (const part of slot.parts) {
    const node = await createGenerated(slot, part.generated);
    if (!node) continue;
    applyPartTransform(node, part);
    try { trackFactoryObject(node, "model", id, part.name, part.generated.resource); } catch {}
    root.add(node);
  }
  if (!root.children.length) return null;
  alignOrigin(root, slot.origin);
  return wrapForBusiness(root);
}

async function createRigged(slot, id) {
  slot={...slot,bounds:{...slot.bounds},generated:slot.generated?{...slot.generated,transform:slot.generated.transform?{...slot.generated.transform}:undefined}:undefined,
    rig:slot.rig?{...slot.rig,clips:Array.isArray(slot.rig.clips)?[...slot.rig.clips]:slot.rig.clips,groundLifts:{...slot.rig.groundLifts}}:undefined};
  const rig = slot.rig;
  if (!rig || rig.status !== "ready" || !rig.resource) return null;
  const normalization=characterNormalization(slot);
  const loaded = await loadGlb(rig.resource, rig.sha256);
  const inner = cloneSkinned(assertObject3D(loaded.scene, "rigged asset"));
  applyLitMaterial(inner);
  const loadedClips = Array.isArray(loaded.animations) ? loaded.animations : [];
  if (loadedClips.length === 0 || (Array.isArray(rig.clips) && rig.clips.length === 0)) {
    const holder = new THREE.Group();
    const oriented = slot.generated && slot.generated.transform ? slot.generated.transform : null;
    holder.rotation.set(oriented && oriented.rotationX ? oriented.rotationX : 0,
      oriented && oriented.rotationY ? oriented.rotationY : 0, 0);
    holder.add(inner);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const height = box.max.y - box.min.y;
    const measuredHeight = Number(rig.bindHeight);
    const normalizationHeight = Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : height;
    if (Number.isFinite(normalizationHeight) && normalizationHeight > 0 && slot.bounds.height > 0)
      holder.scale.setScalar(slot.bounds.height / normalizationHeight);
    alignOrigin(holder, slot.origin);
    const outer = wrapForBusiness(holder);
    outer.userData.factoryResource = rig.resource;
    outer.userData.factorySha256 = rig.sha256;
    createdCharacterNormalizations.set(outer,normalization);
    return outer;
  }
  const usable = Array.isArray(rig.clips) ? rig.clips : null;
  const clips = usable
    ? loadedClips.filter((clip) => usable.indexOf(clip.name) >= 0)
    : loadedClips;
  const definitions = loaded.parser && loaded.parser.json && loaded.parser.json.animations;
  const faithfulClips = loadedClips.filter((clip, index) => {
    const definition = Array.isArray(definitions) ? definitions[index] : null;
    const record = definition && definition.extras && definition.extras.hmMotionRetarget;
    return definition && definition.name === clip.name && record &&
      (record.version === "faithful-mapping-v3" || record.version === "faithful-mapping-v4") &&
      Number.isInteger(record.fps) && record.fps >= 1 && record.fps <= 120 &&
      typeof record.loop === "boolean" && record.processing === null &&
      (record.durationSeconds === undefined ||
        (Number.isFinite(record.durationSeconds) && record.durationSeconds > 0 && record.durationSeconds <= 30)) &&
      typeof record.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(record.sourceSha256) &&
      typeof record.targetBindFingerprint === "string" && /^[a-f0-9]{64}$/.test(record.targetBindFingerprint);
  }).map((clip) => clip.name);
  if (clips.length === 0)
    throw new Error(
      "绑骨产物里的 clip 与清单记录对不上：" +
        rig.resource +
        "（GLB 有 " + loadedClips.map((clip) => clip.name).join("、") +
        "，清单要 " + (usable || []).join("、") + "）"
    );

  const projectRoot = new URL("../", ASSET_RUNTIME_URL);
  const module = await import(new URL("runtime/asset-animation.js", projectRoot).href);
  if (typeof module.registerAnimated !== "function") throw new Error("动画运行时缺少 registerAnimated 导出");
  animationRuntime = module;

  const measuredBindHeight = Number(rig.bindHeight);
  const bindHeight = Number.isFinite(measuredBindHeight) && measuredBindHeight > 0 ? measuredBindHeight : 0;
  const scale = bindHeight > 0 ? slot.bounds.height / bindHeight : 1;
  const holder = new THREE.Group();
  holder.scale.set(scale, scale, scale);
  const oriented = slot.generated && slot.generated.transform ? slot.generated.transform : null;
  holder.rotation.set(
    oriented && oriented.rotationX ? oriented.rotationX : 0,
    oriented && oriented.rotationY ? oriented.rotationY : 0,
    0
  );
  holder.add(inner);
  const outer = wrapForBusiness(holder);
  outer.userData.factoryResource = rig.resource;
  outer.userData.factorySha256 = rig.sha256;
  createdCharacterNormalizations.set(outer,normalization);
  const baseY = slot.origin === "center"
    ? -slot.bounds.height / 2
    : slot.origin === "top-center" ? -slot.bounds.height : 0;
  module.registerAnimated(outer, holder, inner, clips, {
    slotId: id,
    resource: rig.resource,
    height: slot.bounds.height,
    scale: scale,
    baseY: baseY,
    groundLifts: rig.groundLifts || {},
    faithfulClips: faithfulClips
  });
  return outer;
}

function prepareFoliageResources(asset) {
  const key = asset.spec + "@" + (asset.sha256 || "");
  if (!loadedFoliageResources.has(key)) {
    loadedFoliageResources.set(key, (async function () {
      const projectRoot = new URL("../", ASSET_RUNTIME_URL);
      const specUrl = new URL(asset.spec, projectRoot);
      const [spec, module] = await Promise.all([
        fetch(specUrl).then(async function (response) {
          if (!response.ok) throw new Error("植被规格加载失败：" + response.status + " " + specUrl.href);
          return response.json();
        }),
        import(new URL("runtime/asset-foliage.js", projectRoot).href)
      ]);
      if (typeof module.buildFoliage !== "function" || typeof module.cloneFoliage !== "function") {
        throw new Error("植被运行时缺少资源加载或构建导出");
      }
      if (typeof module.preloadFoliage === "function") await module.preloadFoliage({ spec: spec, baseUrl: projectRoot });
      return { spec: spec, module: module, projectRoot: projectRoot };
    })());
  }
  return loadedFoliageResources.get(key);
}

function loadFoliage(slot, seed) {
  const asset = slot.foliageAsset;
  const key = asset.spec + "@" + (asset.sha256 || "") + "#" + (seed === undefined ? "-" : seed);
  if (!loadedFoliage.has(key)) {
    loadedFoliage.set(key, (async function () {
      const { spec, module, projectRoot } = await prepareFoliageResources(asset);
      foliageRuntime = module;
      module.setWind(windOptions);
      if (sceneRef) module.installFoliageWind(sceneRef);
      const seeded = seed === undefined ? spec : Object.assign({}, spec, { seed: seed });
      const inner = assertObject3D(await module.buildFoliage({ spec: seeded, baseUrl: projectRoot }), "foliage asset");
      alignOrigin(inner, slot.origin);
      return { inner: inner, clone: module.cloneFoliage };
    })());
  }
  return loadedFoliage.get(key);
}

async function createFoliage(slot, seed) {
  const asset = slot.foliageAsset;
  if (!asset || asset.status !== "ready" || !asset.spec) return null;
  const loaded = await loadFoliage(slot, seed);
  return wrapForBusiness(assertObject3D(loaded.clone(loaded.inner), "foliage asset"));
}

async function createProcedural(slot) {
  const url = new URL("../" + slot.procedural.module, ASSET_RUNTIME_URL);
  const module = await import(url.href);
  if (typeof module.createAsset !== "function") throw new Error("程序化模块缺少 createAsset 导出");
  const inner = assertObject3D(await module.createAsset({ THREE: THREE, slot: slot }), "procedural asset");
  alignOrigin(inner, slot.origin);
  return wrapForBusiness(inner);
}

function recordUnknownSlot(name) {
  unknownSlots[name] = (unknownSlots[name] || 0) + 1;
}

function recordDiagnostic(id, slot, layer, object, errors) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.isEmpty() ? [0, 0, 0] : box.getSize(new THREE.Vector3()).toArray();
  const materials = new Set();
  let meshCount = 0;
  let geometryValid = true;
  object.traverse(function (child) {
    if (!child.isMesh) return;
    meshCount += 1;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of list) if (material) materials.add(material.uuid);
    const positions = child.geometry && child.geometry.getAttribute ? child.geometry.getAttribute("position") : null;
    if (!positions || positions.count === 0) geometryValid = false;
    if (positions) {
      for (let index = 0; index < positions.array.length; index += 1) {
        if (!Number.isFinite(positions.array[index])) geometryValid = false;
      }
    }
  });
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const anchorY = slot.origin === "bottom-center" ? box.min.y : slot.origin === "top-center" ? box.max.y : center.y;
  const declared = slot.bounds || { width: 0, height: 0, depth: 0 };
  diagnostics[id] = {
    slotId: id,
    kind: slot.kind,
    wantsAnimation: Boolean(slot.rig && Array.isArray(slot.rig.animations) && slot.rig.animations.length > 0),
    fitMode: slot.fitMode || "uniform",
    layer: layer,
    errors: errors.slice(),
    bounds: size,
    meshCount: meshCount,
    materialCount: materials.size,
    geometryValid: geometryValid,
    originError: Math.abs(anchorY),
    declaredBounds: [declared.width, declared.height, declared.depth],
    forward: slot.forward
  };
}

function registerRoot(object, slotId) {
  registeredRoots.add(object);
  if (slotId) rootSlotIds.set(object, slotId);
  anchorRefs.push(new WeakRef(object));
  if (anchorRefs.length > MAX_ANCHOR_REFS) anchorRefs.shift();
}

function findSceneRoot() {
  for (let index = anchorRefs.length - 1; index >= 0; index -= 1) {
    const anchor = anchorRefs[index].deref();
    if (!anchor || !anchor.parent) continue;
    let node = anchor;
    while (node.parent) node = node.parent;
    if (node.isScene === true || node !== anchor) return node;
  }
  return null;
}

function scanScene() {
  return scanAssetScene({ root: findSceneRoot(), manifest, registeredRoots, rootSlotIds, consumedSurfaceIds, maxOwners: MAX_TRIANGLE_OWNERS });
}

let sceneRef = null;
const attachRemoved = [];
function noteAttachRemoved(object) {
  const name =
    (object && (object.name || (object.parent && object.parent.name))) || "(未命名)";
  if (attachRemoved.indexOf(name) < 0 && attachRemoved.length < 12) {
    attachRemoved.push(name);
  }
}
function rememberScene(scene) {
  if (scene && scene.isObject3D) sceneRef = scene;
  if (foliageRuntime) foliageRuntime.installFoliageWind(scene);
}
if (typeof window !== "undefined") {
  window.__HM_SCENE__ = function () { return sceneRef; };
}

export const assets = {
  async preload(options = {}) {
    await this.init();
    const slots = manifest && manifest.slots ? manifest.slots : {};
    const selected = Array.isArray(options.slotIds) ? new Set(options.slotIds) : null;
    const jobs = [];
    const seen = new Set();
    const enqueueGlb = function (resource, sha256) {
      const key = resource + "@" + (sha256 || "");
      if (seen.has(key)) return;
      seen.add(key);
      jobs.push(() => loadGlb(resource, sha256));
    };
    const glb = function (slot, generated) {
      if (canDeliverGenerated(slot, generated) && generated && generated.status === "ready" && generated.resource) {
        enqueueGlb(generated.resource, generated.sha256);
      }
    };
    for (const id of Object.keys(slots)) {
      if (selected && !selected.has(id)) continue;
      const slot = slots[id];
      if (slot.rig && slot.rig.status === "ready" && slot.rig.resource) {
        enqueueGlb(slot.rig.resource, slot.rig.sha256);
      } else {
        glb(slot, slot.generated);
      }
      for (const variant of slot.variants || []) glb(slot, variant.generated);
      for (const part of slot.parts || []) glb(slot, part.generated);
      if (slot.foliageAsset && slot.foliageAsset.status === "ready" && slot.foliageAsset.spec) {
        const key = "foliage:" + slot.foliageAsset.spec + "@" + (slot.foliageAsset.sha256 || "");
        if (!seen.has(key)) {
          seen.add(key);
          jobs.push(() => prepareFoliageResources(slot.foliageAsset));
        }
      }
      for (const layer of ["base", "blend"]) {
        if (!(slot.material && slot.material[layer])) continue;
        jobs.push(() => new Promise(function (resolve, reject) {
          const texture = surfaceTexture(slot, id, layer);
          if (!texture) { resolve(); return; }
          if (texture.image && texture.image.width > 0) { resolve(); return; }
          let left = 600;
          const tick = function () {
            const state = surfaceLoads[id + "/" + layer];
            if (state && state.error) { reject(new Error(state.error)); return; }
            if (texture.image && texture.image.width > 0) { resolve(); return; }
            if (left-- <= 0) {
              surfaceLoads[id + "/" + layer] = { loaded: false, error: "texture_load_timeout" };
              reject(new Error("texture_load_timeout")); return;
            }
            setTimeout(tick, 25);
          };
          tick();
        }));
      }
    }
    let failed = 0, completed = 0, next = 0;
    const report = function () {
      try { Promise.resolve(options.onProgress?.({ total: jobs.length, completed, failed })).catch(() => {}); } catch {}
    };
    report();
    const concurrency = Math.max(1, Math.min(8, Math.floor(Number(options.concurrency) || 4)));
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async function () {
      while (next < jobs.length) {
        const job = jobs[next++];
        try { await job(); } catch { failed += 1; }
        completed += 1;
        report();
      }
    }));
    markAssetActivity();
    return { total: jobs.length, failed: failed };
  },
  async init() {
    if (manifest) return;
    exposeAssetReadySignal();
    if (!manifestLoad) {
      manifestFailed = false;
      manifestLoad = (async () => {
        try {
          const response = await fetch(new URL("../asset-manifest.json", ASSET_RUNTIME_URL));
          if (!response.ok) throw new Error("asset-manifest.json 加载失败：" + response.status);
          manifest = await response.json();
        } catch (error) {
          manifestFailed = true;
          manifestLoad = null;
          throw error;
        } finally {
          markAssetActivity();
        }
      })();
    }
    await manifestLoad;
    try { Object.defineProperty(window, "__HM_ASSET_DIAGNOSTICS__", {
      configurable: false,
      enumerable: true,
      get: function () {
        const assetUsage = {};
        for (const [id, slot] of Object.entries(manifest && manifest.slots || {})) {
          assetUsage[id] = (slot.kind === "surface" ? consumedSurfaceIds : requestedAssetIds)[id] === true;
        }
        let effectUsage = null;
        try {
          const observed = window.__HM_EFFECT_USAGE__;
          if (observed && typeof observed === "object" && !Array.isArray(observed)) {
            const entries = Object.entries(observed);
            if (entries.every((entry) => typeof entry[1] === "boolean")) effectUsage = Object.freeze(Object.fromEntries(entries));
          }
        } catch {}
        const slots = {};
        for (const id of Object.keys(diagnostics)) slots[id] = Object.freeze({ ...diagnostics[id] });
        const scanned = scanScene();
        const surfaces = {};
        for (const id of Object.keys(manifest && manifest.slots || {})) {
          const slot = manifest.slots[id];
          if (slot.kind !== "surface") continue;
          const base = surfaceLoads[id + "/base"];
          const blend = surfaceLoads[id + "/blend"];
          surfaces[id] = { consumed: consumedSurfaceIds[id] === true,
            loaded: !!base && base.loaded === true && (!slot.material.blend || !!blend && blend.loaded === true),
            ...(base && base.error || blend && blend.error ? { error: "texture_load_failed" } : {}) };
        }
        return Object.freeze({
          usage: Object.freeze({ assets: Object.freeze(assetUsage), effects: effectUsage }),
          factory: window.__HM_FACTORY_DIAGNOSTICS__,
          slots: Object.freeze(slots),
          surfaces: Object.freeze(surfaces),
          scene: Object.freeze(scanned.scene),
          shadowLightCount: scanned.shadowLightCount,
          attachRemoved: Object.freeze(attachRemoved.slice(0, 12)),
          creation: {
            started: createsStarted,
            settled: createsSettled,
            pending: createsPending,
            idleMs: Date.now() - lastAssetActivityAt
          },
          unknownSlots: Object.freeze({ ...unknownSlots })
        });
      }
    }); } catch {}
  },
  getSlot(id) {
    const slot = manifest && manifest.slots ? manifest.slots[id] : null;
    if (!slot) {
      recordUnknownSlot(id);
      throw new Error("未知的 asset slot: " + id);
    }
    return slot;
  },
  getCollider(id) {
    return this.getSlot(id).collider;
  },
  actualSize(id) {
    const slot = this.getSlot(id);
    const bounds = slot.bounds || { width: 0, height: 0, depth: 0 };
    const declared = [bounds.width, bounds.height, bounds.depth];
    if (slot.rig) return declared;
    const shown = slot.generated ? slot.generated.shownSize : null;
    return Array.isArray(shown) && shown.length === 3 ? shown.slice() : declared;
  },
  specOf(id) {
    const slot = this.getSlot(id);
    const bounds = slot.bounds || { width: 0, height: 0, depth: 0 };
    return {
      declaredSize: [bounds.width, bounds.height, bounds.depth],
      actualSize: this.actualSize(id),
      forward: slot.forward,
      origin: slot.origin,
      collider: slot.collider,
      variants: this.variantsOf(id),
      animation: this.animationStateOf(id)
    };
  },
  animationStateOf(id) {
    const rig = this.getSlot(id).rig;
    if (!rig) return "none";
    if (!rig.outcome) return "pending";
    return rig.outcome === "rigged" ? "ready" : "unavailable";
  },
  tilingMetersOf(id) {
    return surfaceTilingMeters(this.getSlot(id));
  },
  uvPerMeter(id) {
    const meters = surfaceTilingMeters(this.getSlot(id));
    return meters > 0 ? 1 / meters : null;
  },
  repeatFor(id, meters) {
    const tiling = surfaceTilingMeters(this.getSlot(id));
    if (!(tiling > 0) || !(meters > 0)) return null;
    return meters / tiling;
  },
  textureOf(id, layer) {
    noteSurfaceUse(id);
    const slot = this.getSlot(id);
    const name = layer === "blend" ? "blend" : "base";
    const texture = surfaceTexture(slot, id, name);
    try { trackFactoryTexture(texture, id, name, slot.material?.[name]); } catch {}
    return texture;
  },
  colorTextureOf(id, layer) {
    const texture = this.textureOf(id, layer);
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
    return texture;
  },
  dataTextureOf(id, layer) {
    const texture = this.textureOf(id, layer);
    if (texture) {
      texture.colorSpace = THREE.NoColorSpace;
      texture.needsUpdate = true;
    }
    return texture;
  },
  createBlendSurfaceMaterial(id, options) {
    noteSurfaceUse(id);
    const slot = this.getSlot(id);
    const base = surfaceTexture(slot, id, "base");
    if (!base) return null;
    const tiling = surfaceTilingMeters(slot);
    const opts = Object.assign({}, options || {});
    let blend;
    if (typeof opts.blendSlotId === "string") {
      const blendSlot = this.getSlot(opts.blendSlotId);
      noteSurfaceUse(opts.blendSlotId);
      blend = surfaceTexture(blendSlot, opts.blendSlotId, "base");
    } else {
      blend = surfaceTexture(slot, id, "blend");
    }
    if (typeof opts.uvScale !== "number" && tiling > 0) opts.uvScale = surfaceUvScale(tiling);
    const material = buildBlendSurface(
      { base: base, blend: blend },
      opts,
      opts
    );
    try { trackFactoryMaterial(material); } catch {}
    return material;
  },
  applyLitMaterial(object) {
    return applyLitMaterial(object);
  },
  setupLighting(scene, renderer, options) {
    rememberScene(scene);
    return setupLighting(scene, renderer, options);
  },
  captureEnvironmentOnce(scene, renderer, options) {
    return typeof sceneVisual.captureEnvironmentOnce === 'function'
      ? sceneVisual.captureEnvironmentOnce(scene, renderer, options) : null;
  },
  syncSceneLights(scene) {
    rememberScene(scene);
    return syncSceneLights(scene);
  },
  graphicTexture(id) {
    noteSurfaceUse(id);
    const slot = this.getSlot(id);
    if (!slot.material || slot.material.mode !== "graphic") return null;
    return surfaceTexture(slot, id, "base");
  },
  graphicAspect(id) {
    const slot = this.getSlot(id);
    const measured = slot.material ? slot.material.aspect : null;
    if (Array.isArray(measured) && measured.length === 2 && measured[0] > 0 && measured[1] > 0) {
      return measured[0] / measured[1];
    }
    const bounds = slot.bounds || { width: 1, height: 1 };
    return bounds.height > 0 ? bounds.width / bounds.height : 1;
  },
  graphicUrl(id) {
    const slot = this.getSlot(id);
    if (!slot.material || slot.material.mode !== "graphic" || !slot.material.base) return null;
    noteSurfaceUse(id);
    return new URL("../" + slot.material.base, ASSET_RUNTIME_URL).href;
  },
  cutoutMaterial(id, options) {
    const opts = options || {};
    const map = this.graphicTexture(id);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(opts.color === undefined ? 0xffffff : opts.color),
      roughness: opts.roughness === undefined ? 0.9 : opts.roughness,
      metalness: 0,
      transparent: false,
      map: map,
      alphaTest: opts.cut === undefined ? 0.5 : opts.cut,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
      opacity: map ? 1 : 0
    });
    material.needsUpdate = true;
    return material;
  },
  cutoutPlane(id, widthMeters, options) {
    const w = widthMeters > 0 ? widthMeters : 1;
    const geometry = new THREE.PlaneGeometry(w, w / this.graphicAspect(id));
    const mesh = new THREE.Mesh(geometry, this.cutoutMaterial(id, options));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },
  variantsOf(id) {
    const slot = this.getSlot(id);
    return (slot.variants || []).map(function (item) {
      return { id: item.id, status: item.generated.status, ready: item.generated.status === "ready" && !!item.generated.resource };
    });
  },
  async create(id, variantOrOptions) {
    const options = typeof variantOrOptions === "string" || variantOrOptions == null
      ? { variant: variantOrOptions == null ? undefined : variantOrOptions, seed: undefined }
      : variantOrOptions;
    let variantId = options.variant;
    const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : undefined;
    const slot = this.getSlot(id);
    if (!variantId && slot.variantCount > 1) {
      const available = (slot.variants || []).find(function (item) { return item.generated.status === "ready" && item.generated.resource; });
      variantId = available ? available.id : "v1";
    }
    const variant = variantId && Array.isArray(slot.variants) ? slot.variants.find(function (item) { return item.id === variantId; }) : null;
    if (variantId && !variant) {
      recordUnknownSlot(id + "/" + variantId);
      throw new Error("未知的 asset variant: " + id + "/" + variantId);
    }
    requestedAssetIds[id] = true;
    const errors = [];
    createsStarted += 1;
    createsPending += 1;
    markAssetActivity();
    try {
      try {
        const parted = await createParted(slot, variantId, id);
        if (parted) return this.deliver(id, slot, "generated-parts", parted, errors);
      } catch (error) {
        errors.push("parts: " + (error instanceof Error ? error.message : String(error)));
      }
      if (!variantId) {
        try {
          const rigged = await createRigged(slot, id);
          if (rigged) return this.deliver(id, slot, "rigged", rigged, errors);
        } catch (error) {
          errors.push("rigged: " + (error instanceof Error ? error.message : String(error)));
        }
      }
      try {
        const generated = await createGenerated(slot, variant ? variant.generated : slot.generated);
        if (generated) { applySurfaceMaterial(generated, slot, id); return this.deliver(id, slot, "generated", generated, errors); }
      } catch (error) {
        errors.push("generated: " + (error instanceof Error ? error.message : String(error)));
      }
      if (slot.variantCount > 1) {
        for (const alternate of slot.variants || []) {
          if (alternate.id === variantId) continue;
          try {
            const generated = await createGenerated(slot, alternate.generated);
            if (!generated) continue;
            errors.push("variant " + variantId + " unavailable; using " + alternate.id);
            applySurfaceMaterial(generated, slot, id);
            return this.deliver(id, slot, "generated", generated, errors);
          } catch (error) {
            errors.push("variant " + alternate.id + ": " + (error instanceof Error ? error.message : String(error)));
          }
        }
      }
      try {
        const foliage = await createFoliage(slot, seed);
        if (foliage) return this.deliver(id, slot, "foliage", foliage, errors);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const materialFailure = /^(foliage material integration:|foliage wind:|makeCutout)/.test(reason);
        errors.push("foliage: " + reason + (materialFailure ? " Material integration failed; the produced foliage geometry and textures remain reusable. Repair the rendering shader hooks; do not regenerate this foliage asset." : ""));
      }
      try {
        const procedural = await createProcedural(slot);
        applySurfaceMaterial(procedural, slot, id);
        return this.deliver(id, slot, "procedural", procedural, errors);
      } catch (error) {
        errors.push("procedural: " + (error instanceof Error ? error.message : String(error)));
      }
      return this.deliver(id, slot, "emergency", buildEmergency(slot), errors);
    } finally {
      createsPending -= 1;
      createsSettled += 1;
      markAssetActivity();
    }
  },
  deliver(id, slot, layer, object, errors) {
    recordDiagnostic(id, slot, layer, object, errors);
    registerRoot(object, id);
    if(layer==="rigged"||layer==="generated")deliveredModelIdentities.set(object,{resource:object.userData.factoryResource,sha256:object.userData.factorySha256,transform:object.userData.factoryTransform?JSON.parse(JSON.stringify(object.userData.factoryTransform)):null});
    try {
      const kind = layer === "foliage" ? "foliage" : layer === "procedural" || layer === "emergency" ? "whitebox" : "model";
      const resource = layer === "rigged" ? slot.generated.resource : layer === "foliage" ? slot.foliageAsset.spec : layer === "procedural" ? slot.procedural.module : object.userData.factoryResource || slot.generated.resource;
      if (layer !== "generated-parts") trackFactoryObject(object, kind, id, "resource", resource);
    } catch {}
    return object;
  },

  async attach(character, slotID, contact) {
    try {
      const id=rootSlotIds.get(character);
      if(!id||typeof slotID!=="string"||(contact!==undefined&&!['grip_left','grip_right'].includes(contact)))return null;
      const current=()=>{
        const slot=this.getSlot(id),rig=slot.rig,proof=deliveredModelIdentities.get(character);
        if(rig?.status!=="ready"||!proof||proof.resource!==rig.resource||proof.sha256!==rig.sha256||createdCharacterNormalizations.get(character)!==characterNormalization(slot))return null;
        if(!Number.isFinite(Number(rig.bindHeight))||Number(rig.bindHeight)<=0)return null;
        const matches=(rig.attachments||[]).filter(binding=>binding.status==="ready"&&binding.slotID===slotID&&(contact===undefined||binding.contact===contact));
        return matches.length===1?matches[0]:null;
      };
      const found=current(),binding=found?JSON.parse(JSON.stringify(found)):null;if(!binding)return null;
      const source=this.getSlot(slotID);
      if(source.kind!=="mesh"||source.rig||source.foliage)return null;
      const variants=source.variants||[];
      const variant=variants.find(item=>item.generated?.resource===binding.sourceResource&&item.generated?.sha256===binding.sourceSha256);
      const primary=source.generated;
      if(!variant&&(primary?.status!=="ready"||primary.resource!==binding.sourceResource||primary.sha256!==binding.sourceSha256))return null;
      if(!sameAttachmentNormalization((variant?.generated??primary)?.transform,binding.sourceTransform))return null;
      const object=await this.create(slotID,variant?.id);
      const proof=deliveredModelIdentities.get(object);
      if(!proof||proof.resource!==binding.sourceResource||proof.sha256!==binding.sourceSha256||!sameAttachmentNormalization(proof.transform,binding.sourceTransform))return null;
      const module=await loadAttachmentRuntime();
      if(JSON.stringify(current())!==JSON.stringify(binding))return null;
      if(!module.bindAttachment(character,object,binding))return null;
      return object;
    }catch{return null;}
  },
  detachAttachment(object) {
    return attachmentRuntime?attachmentRuntime.detachAttachment(object):false;
  },

  setState(root, action, options) {
    return animationRuntime ? animationRuntime.setState(root, action, options) : false;
  },
  playOnce(root, action, options) {
    return animationRuntime ? animationRuntime.playOnce(root, action, options) : false;
  },
  isAnimated(root) {
    return animationRuntime ? animationRuntime.isAnimated(root) : false;
  },
  clipsOf(root) {
    return animationRuntime ? animationRuntime.clipsOf(root) : [];
  },
  attachRenderer(renderer) {
    return animationRuntime ? animationRuntime.attachRenderer(renderer) : false;
  },

  tintFoliage(root, color, amount) {
    return foliageRuntime ? foliageRuntime.tintFoliage(root, color, amount) : false;
  },
  paintFoliage(root, colorBottom, colorTop) {
    return foliageRuntime ? foliageRuntime.paintFoliage(root, colorBottom, colorTop) : false;
  },
  resetFoliageColor(root) {
    return foliageRuntime ? foliageRuntime.resetFoliageColor(root) : false;
  },
  setFoliageAppearance(root, options = {}) {
    return foliageRuntime ? foliageRuntime.setFoliageAppearance(root, options) : false;
  },
  setWind(options = {}) {
    if (Number.isFinite(options.noiseScale)) windOptions.noiseScale = Math.max(0, Math.min(20, options.noiseScale));
    if (Number.isFinite(options.strength)) windOptions.strength = Math.max(0, Math.min(2, options.strength));
    if (Number.isFinite(options.speed)) windOptions.speed = Math.max(0, Math.min(5, options.speed));
    const d = options.direction;
    if (Array.isArray(d) && d.length === 2 && d.every(Number.isFinite) && Math.hypot(...d) > 0) {
      const length = Math.hypot(...d);
      windOptions.direction = [d[0] / length, d[1] / length];
    }
    if (foliageRuntime) foliageRuntime.setWind(windOptions);
    return this.getWind();
  },
  getWind() {
    if (foliageRuntime) return foliageRuntime.getWind();
    const time = typeof window !== 'undefined' ? window.__HM_GAME_LOOP__?.elapsedSeconds : 0;
    const length = Math.hypot(...windOptions.direction);
    return { ...windOptions, direction: windOptions.direction.map(v => v / length), time: time ?? 0 };
  },
  updateWind(dt) {
    if (foliageRuntime) foliageRuntime.updateWind(dt);
  },
  attachTo(object, host, options) {
    if (!object || !host) return false;
    const opts = options || {};
    const orient = opts.orient !== false;
    host.updateWorldMatrix(true, true);
    object.updateWorldMatrix(true, false);
    const intent = new THREE.Vector3();
    object.getWorldPosition(intent);

    const box = new THREE.Box3().setFromObject(host);
    if (box.isEmpty()) return false;
    const center = box.getCenter(new THREE.Vector3());

    const raycaster = new THREE.Raycaster();
    const directions = [
      center.clone().sub(intent),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 1, 0)
    ];
    let hit = null;
    for (let i = 0; i < directions.length; i += 1) {
      const dir = directions[i];
      if (dir.lengthSq() < 1e-12) continue;
      dir.normalize();
      const origin = i === 0
        ? intent.clone()
        : new THREE.Vector3(intent.x, i === 1 ? box.max.y + 1e-3 : box.min.y - 1e-3, intent.z);
      raycaster.set(origin, dir);
      const hits = raycaster.intersectObject(host, true);
      if (hits.length > 0) { hit = hits[0]; break; }
    }
    if (!hit) {
      if (object.parent) object.parent.remove(object);
      noteAttachRemoved(object);
      return false;
    }

    const parent = object.parent;
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
      : new THREE.Vector3(0, 1, 0);
    const lift = opts.offset === undefined ? 0.005 : opts.offset;
    const target = hit.point.clone().addScaledVector(normal, lift);

    if (orient) {
      const quaternion = new THREE.Quaternion()
        .setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      object.quaternion.copy(quaternion);
    }
    if (parent) {
      parent.updateWorldMatrix(true, false);
      object.position.copy(parent.worldToLocal(target.clone()));
      if (orient) {
        const parentQuaternion = new THREE.Quaternion();
        parent.getWorldQuaternion(parentQuaternion);
        object.quaternion.premultiply(parentQuaternion.invert());
      }
    } else {
      object.position.copy(target);
    }
    object.updateMatrixWorld(true);
    return true;
  },
  createSkyDome(scene, options) {
    return createSkyDome(scene, options);
  }
};
