import * as THREE from 'three';
const facts = Object.create(null);
const geometrySources = new WeakMap();
const objectSources = new WeakMap();
const materialSources = new WeakMap();
const textureSources = new WeakMap();
const materialHooks = new WeakMap();
const MAX_FACTS = 512;
let truncated = false;
export function factoryFact(kind, id, unit, resource) {
  const key = kind + ':' + id + ':' + unit + (kind === 'model' ? ':' + (resource || '') : '');
  if (!facts[key]) {
    if (Object.keys(facts).length >= MAX_FACTS) { truncated = true; return null; }
    facts[key] = { kind, slotId: id, unitId: unit, resource: resource || null, loaded: false, used: false };
  }
  return facts[key];
}
export function trackFactoryObject(object, kind, id, unit, resource) {
  const fact = factoryFact(kind, id, unit, resource);
  if (!fact) return;
  object.traverse((child) => {
    const positions = child.geometry?.getAttribute?.('position');
    if (!positions || positions.count === 0 || !positions.array.every(Number.isFinite)) return;
    fact.loaded = true;
    const sources = geometrySources.get(child.geometry) || new Set();
    sources.add(fact); geometrySources.set(child.geometry, sources);
    objectSources.set(child, fact);
    for (const material of [].concat(child.material || [])) {
      const sources = materialSources.get(material) || new Set();
      sources.add(fact); materialSources.set(material, sources);
    }
    try { trackFactoryMaterial(child.material); } catch {}
  });
}
export function trackFactoryTexture(texture, id, layer, resource) {
  if (!texture) return;
  const fact = factoryFact('surface', id, layer, resource);
  if (fact) { fact.loaded = !!texture.image; textureSources.set(texture.source || texture, fact); }
}
function observeTexture(texture) {
  const fact = texture && textureSources.get(texture.source || texture);
  if (fact && texture.image) { fact.loaded = true; fact.used = true; }
}
function observeDraw(object, material) {
  const positions = object.geometry?.getAttribute?.('position');
  if (positions?.count > 0 && (!object.isInstancedMesh || object.count > 0)) {
    const sources = geometrySources.get(object.geometry);
    const fact = objectSources.get(object) || (sources?.size === 1 ? [...sources][0] : null);
    if (fact && !fact.error && (!fact.needsUpdate || fact.updated)) fact.used = true;
    else if (!fact) for (const source of sources || materialSources.get(material) || []) source.sourceUnknown = true;
  }
  for (const value of Object.values(material || {})) if (value?.isTexture) observeTexture(value);
  for (const value of Object.values(material?.uniforms || {})) if (value?.value?.isTexture) observeTexture(value.value);
}
export function trackFactoryMaterial(material) {
  for (const entry of [].concat(material || [])) {
    const previous = entry.onBeforeRender;
    if (materialHooks.get(entry) === previous || previous === THREE.Material.prototype.onBeforeRender) continue;
    const hook = function(renderer, scene, camera, geometry, object, group) {
      previous.call(this, renderer, scene, camera, geometry, object, group);
      try { observeDraw(object, this); } catch {}
    };
    entry.onBeforeRender = hook;
    materialHooks.set(entry, hook);
  }
}
const beforeRender = THREE.Material.prototype.onBeforeRender;
THREE.Material.prototype.onBeforeRender = function(renderer, scene, camera, geometry, object, group) {
  beforeRender.call(this, renderer, scene, camera, geometry, object, group);
  try { observeDraw(object, this); } catch {}
};
try { Object.defineProperty(window, '__HM_FACTORY_DIAGNOSTICS__', {
  get: () => ({ facts: Object.values(facts).map((fact) => ({ ...fact })), truncated })
}); } catch {}
