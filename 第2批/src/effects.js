
import * as THREE from 'three'
import { trackFactoryObject, factoryFact } from '../runtime/factory-usage.js'
import { assets } from '../runtime/asset-runtime.js'

const EFFECT_TEXTURES = {"earth_brush":{"earth_puff":{"slotId":"fx_bf9f3b327f8069df6586982dc91094df","kind":"mask","description":"One isolated soft small irregular dust puff mask centered on pure black. Grayscale only, delicate translucent smoky clustered wisps, mottled mid-gray core fading gradually to black feathered edges. No hard outlines, no rocks or scene. Broad approximately round silhouette with subtle uneven lobes, fills central 75 percent. Sample luminance as particle opacity.","aspect":[1,1]}},"divine_drop":{"landing_dust":{"slotId":"fx_deb7d7d01c4ba318bcbf350b1e37548c","kind":"mask","description":"Single soft irregular airborne dust puff grayscale density mask on pure black. Rounded flattened billowing silhouette, wispy ragged very soft transparent outskirts, clustered soft lobes and subtle swirled cloudy internal density. No sharp outlines, no symbols, no ground, no ring. White and light gray dense center gently transitions to black perimeter with ample black padding. Used as opacity for small cream dust billboards.","aspect":[1,1]}},"geothermal":{"vent_wisp":{"slotId":"fx_ca0455c2f3785861d4c4b51ffc9241c5","kind":"mask","description":"Single soft rising steam curl on pure black. Grayscale density mask, feathered translucent wisps with irregular curled filaments and soft billowing center, no hard outline, no ground, no objects. Narrow base broadening into an asymmetrical dispersed curl at top. Image used as alpha for individually rotated rising smoke particles.","aspect":[1,1]}}}
const FACTORY_EFFECT_READY = {"arrival":true,"earth_brush":true,"rain_cloud":false,"rainbow":true,"life_pulse":true,"prayer_answer":true,"meteors":true,"harvest":true,"divine_drop":true,"divine_bolt":true,"shrine_fireworks":true,"shrine_incense":true,"gentle_soul":true,"healing_blessing":true,"geothermal":true,"village_hearth":true}
export const EFFECT_SPECS = {
  "earth_brush": {
    "kind": "particles",
    "sizeMeters": [
      10,
      3,
      10
    ],
    "durationSec": 0.8,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 8,
    "params": [
      {
        "name": "radius",
        "type": "number",
        "default": 3,
        "min": 0.5,
        "max": 12,
        "unit": "m",
        "means": "Current brush footprint controls spread."
      },
      {
        "name": "strength",
        "type": "number",
        "default": 0.6,
        "min": 0.1,
        "max": 1,
        "means": "Stroke strength controls density."
      }
    ],
    "description": "Local terrain edit dust: muted ochre translucent low dust puffs within the circular brush plus a few small gray stone flecks lifting briefly and falling, not an explosion. Fades promptly after each stroke emission. Attached at terrain contact; radius tunable.",
    "drivenBy": "Repeated short emission during active terrain brush only",
    "sprite": "earth_brush_sprite"
  },
  "arrival": {
    "kind": "volume",
    "sizeMeters": [
      5,
      15,
      5
    ],
    "durationSec": 2,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 8,
    "params": [
      {
        "name": "height",
        "type": "number",
        "default": 9,
        "min": 2,
        "max": 20,
        "unit": "m",
        "means": "Column extends above actual landing point."
      },
      {
        "name": "radius",
        "type": "number",
        "default": 1,
        "min": 0.3,
        "max": 3,
        "unit": "m",
        "means": "Halo and column size matched to creature."
      }
    ],
    "description": "Warm narrow sky-to-ground column with sparse downward moving gold motes, followed by a luminous thin landing halo expanding along ground and fading. Actual creature descends separately. Readable gentle divine creation, no explosion.",
    "drivenBy": "On valid creation request; simulation inserts entity at landing"
  },
  "rain_cloud": {
    "kind": "volume",
    "sizeMeters": [
      24,
      25,
      24
    ],
    "durationSec": 3,
    "loop": true,
    "attach": "follow",
    "maxOnScreen": 8,
    "params": [
      {
        "name": "radius",
        "type": "number",
        "default": 7,
        "min": 2,
        "max": 16,
        "unit": "m",
        "means": "Cloud footprint and rain footprint radius."
      },
      {
        "name": "height",
        "type": "number",
        "default": 12,
        "min": 3,
        "max": 25,
        "unit": "m",
        "means": "Distance from ground to cloud."
      },
      {
        "name": "intensity",
        "type": "number",
        "default": 0.6,
        "min": 0,
        "max": 2,
        "means": "Rain discharge changes visible streaks/splashes."
      }
    ],
    "description": "Cloud-local rain volume with many fine blue-gray vertical streaks falling from cloud to ground, intermittent small surface splash specks and subtle expanding concentric ripples at the bottom. Soft layered cloud puff crown. Strength increases streak density and speed. Finite storage drives stopping externally.",
    "drivenBy": "Loop follows raining cloud; removed when rain off or storage exhausted",
    "sprite": "rain_cloud_sprite"
  },
  "life_pulse": {
    "kind": "particles",
    "sizeMeters": [
      4,
      4,
      4
    ],
    "durationSec": 2,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 8,
    "params": [
      {
        "name": "courtship",
        "type": "bool",
        "default": false,
        "means": "True only for valid courting pair; adds two small rising hearts."
      },
      {
        "name": "radius",
        "type": "number",
        "default": 0.8,
        "min": 0.2,
        "max": 3,
        "unit": "m",
        "means": "Size of newborn or couple footprint."
      }
    ],
    "description": "Gentle warm pulse around newborn or valid courtship couple: a small luminous gold ring at feet and soft rising motes. With courtship parameter true add two independently readable small rose-gold heart outlines rising over the pair, no hearts for births.",
    "drivenBy": "Actual conditional conception/pair bond or actual birth"
  },
  "prayer_answer": {
    "kind": "particles",
    "sizeMeters": [
      4,
      9,
      4
    ],
    "durationSec": 2.5,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 6,
    "params": [
      {
        "name": "height",
        "type": "number",
        "default": 6,
        "min": 2,
        "max": 15,
        "unit": "m",
        "means": "Visible upward transfer distance."
      }
    ],
    "description": "Small warm gold glow surrounding resolved praying resident, a thin upward ribbon of motes traveling toward the upper right as faith is awarded. Soft core and sparse trailing sparks, gentle no flash.",
    "drivenBy": "Rain reaches dry resident with one unresolved prayer"
  },
  "rainbow": {
    "kind": "volume",
    "sizeMeters": [
      90,
      50,
      8
    ],
    "durationSec": 16,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 1,
    "params": [
      {
        "name": "radius",
        "type": "number",
        "default": 35,
        "min": 10,
        "max": 80,
        "unit": "m",
        "means": "Island-scale arc radius."
      },
      {
        "name": "opacity",
        "type": "number",
        "default": 0.3,
        "min": 0.1,
        "max": 0.7,
        "means": "Subtle spectral atmospheric visibility."
      }
    ],
    "description": "Broad translucent atmospheric rainbow arc with seven softly blended spectral bands, gently appearing above the island, slight warm mist at ends; elevated half arch, no ground impact.",
    "drivenBy": "Paid 10-faith rainbow activation"
  },
  "meteors": {
    "kind": "particles",
    "sizeMeters": [
      100,
      35,
      40
    ],
    "durationSec": 8,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 1,
    "params": [
      {
        "name": "spread",
        "type": "number",
        "default": 40,
        "min": 10,
        "max": 90,
        "unit": "m",
        "means": "Span of elevated sky trails."
      }
    ],
    "description": "Several elevated luminous warm-white meteor heads with long tapered gold sky trails sweeping diagonally high above island and fading before reaching ground, staggered motion, no impacts.",
    "drivenBy": "Paid 20-faith meteor activation"
  },
  "harvest": {
    "kind": "ground",
    "sizeMeters": [
      180,
      4,
      180
    ],
    "durationSec": 5,
    "loop": false,
    "attach": "ground",
    "maxOnScreen": 1,
    "params": [
      {
        "name": "radius",
        "type": "number",
        "default": 70,
        "min": 10,
        "max": 160,
        "unit": "m",
        "means": "Island radius reached by expanding wave."
      }
    ],
    "description": "Restrained gold wave traveling outward over island as a broad thin luminous ground ring, sparse small gold leaf-shaped motes lifting along its circumference then fading. Must leave plants visible.",
    "drivenBy": "Paid 30-faith island-wide immediate fruiting"
  },
  "divine_bolt": {
    "kind": "particles",
    "sizeMeters": [
      8,
      20,
      8
    ],
    "durationSec": 1.2,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 3,
    "params": [
      {
        "name": "height",
        "type": "number",
        "default": 18,
        "min": 4,
        "max": 30,
        "unit": "meters",
        "means": "Bolt reach above struck ground"
      },
      {
        "name": "radius",
        "type": "number",
        "default": 3,
        "min": 1,
        "max": 8,
        "unit": "meters",
        "means": "Impact ring and spark spread"
      }
    ],
    "description": "A nonlethal lightning impact centered at ground origin. Readable jagged icy-white vertical bolt with pale blue halo descends 18 meters, two short branches, rapid double flash then disappears; warm amber contact sparkle and small soot-toned expanding ground ring linger briefly. No lights. Scene scale and intensity adjustable; target attachment stays world-fixed.",
    "drivenBy": "Paid lightning strike on ground; never damages creatures"
  },
  "divine_drop": {
    "kind": "particles",
    "sizeMeters": [
      7,
      3,
      7
    ],
    "durationSec": 1.4,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 4,
    "params": [
      {
        "name": "radius",
        "type": "number",
        "default": 2.6,
        "min": 0.5,
        "max": 6,
        "unit": "meters",
        "means": "Landing footprint and sideways puff reach"
      }
    ],
    "description": "Soft nonviolent landing dust ring: warm cream dust puffs expand sideways around a small central golden contact glint, a few small gray-brown grit motes bounce and settle. Ground-centered horizontal ring with transparent fading irregular edge. Used on dropped creature or parachute crate landing. Radius adjustable, no persistent cloud.",
    "drivenBy": "Creature or crate reaches safe landing position"
  },
  "shrine_fireworks": {
    "kind": "particles",
    "sizeMeters": [
      16,
      20,
      16
    ],
    "durationSec": 3,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 2,
    "params": [
      {
        "name": "height",
        "type": "number",
        "default": 10,
        "min": 4,
        "max": 20,
        "unit": "meters",
        "means": "Firework burst height above shrine roof"
      },
      {
        "name": "radius",
        "type": "number",
        "default": 6,
        "min": 2,
        "max": 12,
        "unit": "meters",
        "means": "Radial burst spread"
      }
    ],
    "description": "Celebratory miniature fireworks centered above a completed shrine: three staggered upward golden trails burst into radial mint, peach and sunflower-gold sparkling stars at different heights; fine drifting gold embers fade below each burst. Bright compact layers readable from overhead, no smoke wall or lights.",
    "drivenBy": "First completion and once per irreversible shrine upgrade"
  },
  "shrine_incense": {
    "kind": "particles",
    "sizeMeters": [
      3,
      5,
      3
    ],
    "durationSec": 5,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 4,
    "params": [
      {
        "name": "height",
        "type": "number",
        "default": 3.5,
        "min": 1,
        "max": 7,
        "unit": "meters",
        "means": "Wisps and heart rise above altar"
      },
      {
        "name": "radius",
        "type": "number",
        "default": 1.1,
        "min": 0.3,
        "max": 3,
        "unit": "meters",
        "means": "Horizontal spread of incense strands"
      }
    ],
    "description": "Delicate incense at a miniature shrine altar: three thin ivory-gray wisps curl upward from close-set incense sticks, soft transparent strands drift slightly sideways, with two tiny warm peach heart glows rising independently then fading. A bounded airy plume, no opaque cloud or lights. One-shot prayer offering, ground origin at altar top, adjustable height and radius.",
    "drivenBy": "Resident finishes real morning worship at the shrine"
  },
  "gentle_soul": {
    "kind": "particles",
    "sizeMeters": [
      4,
      10,
      4
    ],
    "durationSec": 5,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 8,
    "params": [
      {
        "name": "radius",
        "type": "number",
        "default": 1.2,
        "min": 0.3,
        "max": 3,
        "unit": "m",
        "means": "Soul halo radius for camera readability"
      }
    ],
    "description": "Gentle non-gory death: small pale gold luminous soul mote rises 8 meters from ground, tiny tilted golden halo follows above it, a few soft white-gold trailing specks fade upward. Readable from miniature god camera. Single 5 second lifecycle, no new lights.",
    "drivenBy": "Actual creature death"
  },
  "geothermal": {
    "kind": "particles",
    "sizeMeters": [
      8,
      9,
      8
    ],
    "durationSec": 4,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 12,
    "params": [
      {
        "name": "mode",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 2,
        "means": "0 lava smoke and embers, 1 steam only, 2 swamp bubbles"
      },
      {
        "name": "radius",
        "type": "number",
        "default": 3,
        "min": 0.5,
        "max": 8,
        "unit": "m",
        "means": "Ground vent footprint"
      },
      {
        "name": "color",
        "type": "color",
        "default": 11972256,
        "means": "Smoke or bubble tint"
      }
    ],
    "description": "Bounded ground vent with soft wispy smoke rising and dispersing, a few low warm embers. Lava uses gray smoke and orange embers; water contact uses white steam without embers; swamp uses low greenish translucent bubbles that pop. Preserve readable vent structure with tunable mode and tint. Local effect, not atmospheric fog.",
    "drivenBy": "Active lava cells, actual water quench, or swamp surface activity",
    "sprite": "geothermal_sprite"
  },
  "healing_blessing": {
    "kind": "particles",
    "sizeMeters": [
      6,
      8,
      6
    ],
    "durationSec": 2,
    "loop": false,
    "attach": "world",
    "maxOnScreen": 4,
    "params": [
      {
        "name": "radius",
        "type": "number",
        "default": 2.5,
        "min": 0.5,
        "max": 5,
        "unit": "m",
        "means": "Ring radius to fit resident visual size"
      }
    ],
    "description": "Soft mint green and gold concentric healing rings rise around one resident, four luminous plus-shaped motes float upward and fade, a tiny gold halo pulses once. Gentle readable 2 second treatment effect, attached at cured resident ground position.",
    "drivenBy": "Successful 5-faith cure of an actually ill resident"
  },
  "village_hearth": {
    "kind": "particles",
    "sizeMeters": [
      3,
      5,
      3
    ],
    "durationSec": 3,
    "loop": true,
    "attach": "world",
    "maxOnScreen": 2,
    "params": [
      {
        "name": "radius",
        "type": "number",
        "default": 1.2,
        "min": 0.4,
        "max": 3,
        "unit": "m",
        "means": "Flame footprint inside existing physical stone ring"
      }
    ],
    "description": "A small welcoming campfire at a village stone fire ring: three warm orange and gold tapering flame tongues flicker upward from stacked logs, a few tiny amber sparks rise, faint thin gray smoke above. Bounded cozy flame, not an explosion, no new lights. Night gathering center.",
    "drivenBy": "Built village fire plaza at night"
  }
}

const IMPL = {}
for (const key of Object.keys(EFFECT_SPECS)) {
  try {
    IMPL[key] = await import(`./effects/${key}.js`)
  } catch (err) {
    console.warn('[effects] 实现没加载上，这个特效会是空的', key, err)
  }
}

const usedEffects = Object.fromEntries(Object.keys(EFFECT_SPECS).map((key) => [key, false]))
try {
  Object.defineProperty(window, '__HM_EFFECT_USAGE__', {
    configurable: true,
    get: () => Object.freeze({ ...usedEffects })
  })
} catch {}

const live = new Set()
let clock = 0

const warned = new Set()
const warnOnce = (msg) => {
  if (warned.has(msg)) return
  warned.add(msg)
  console.warn('[effects] ' + msg)
}

function spriteTextureOf(spec) {
  if (!spec.sprite) return null
  try {
    const tex = assets.textureOf(spec.sprite, 'base')
    if (tex) {
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
    }
    return tex
  } catch (err) {
    return null
  }
}

function effectTextureOf(request) {
  try {
    const tex = assets.textureOf(request.slotId, 'base');
    if (!tex) return null;
    tex.colorSpace = request.kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = request.kind === 'noise' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    return tex;
  } catch { return null; }
}

export function makeEffect(key, opts = {}) {
  const spec = EFFECT_SPECS[key]
  if (!spec) {
    warnOnce('"' + key + '" 没声明过（拼错了？）—— 返回空 Group')
    return new THREE.Group()
  }
  if (Object.hasOwn(usedEffects, key)) usedEffects[key] = true
  let obj = null
  try {
    const textures = Object.fromEntries(Object.entries(EFFECT_TEXTURES[key] || {}).map(([name, request]) => [name, effectTextureOf(request)]));
    obj = IMPL[key]?.create?.({ sprite: textures.sprite || spriteTextureOf(spec), textures, ...opts }) ?? null
  } catch (err) {
    console.warn('[effects] create 抛了，返回空 Group', key, err)
  }
  if (!obj?.isObject3D) {
    try { const fact = factoryFact('effect', key, 'implementation', null); if (fact) fact.error = 'effect_create_failed'; } catch {}
    return new THREE.Group()
  }
  try { if (FACTORY_EFFECT_READY[key]) { trackFactoryObject(obj, 'effect', key, 'implementation', 'src/effects/' + key + '.js'); const fact = factoryFact('effect', key, 'implementation'); if (fact) fact.needsUpdate = typeof obj.userData.update === 'function'; } } catch {}
  try { if (!FACTORY_EFFECT_READY[key]) { const fact = factoryFact('effect', key, 'implementation', null); if (fact) fact.error = 'effect_placeholder'; } } catch {}
  obj.userData.effectKey = key
  live.add({ obj, key, born: clock, ttl: spec.loop ? Infinity : spec.durationSec, auto: false })
  return obj
}

export function spawnEffect(key, parent, opts = {}) {
  const spec = EFFECT_SPECS[key]
  if (!spec || !parent) return null
  let n = 0
  for (const e of live) if (e.key === key) n++
  if (n >= spec.maxOnScreen) return null
  const obj = makeEffect(key, opts)
  const at = opts.at ?? opts.position ?? null
  if (Array.isArray(at)) obj.position.set(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0)
  else if (at?.isVector3) obj.position.copy(at)
  parent.add(obj)
  for (const e of live) if (e.obj === obj) e.auto = true
  return obj
}

export function updateEffects(dt) {
  const step = Number.isFinite(dt) ? dt : 0
  clock += step
  for (const e of [...live]) {
    try {
      e.obj.userData.update?.(clock - e.born, step)
      try { const fact = factoryFact('effect', e.key, 'implementation'); if (fact) fact.updated = true; } catch {}
    } catch (err) {
      try { const fact = factoryFact('effect', e.key, 'implementation'); if (fact) fact.error = 'effect_update_failed'; } catch {}
      live.delete(e)
      console.warn('[effects] update 抛了，已摘掉这个实例', e.key, err)
      continue
    }
    if (e.auto && clock - e.born > e.ttl) {
      e.obj.removeFromParent()
      e.obj.traverse((o) => {
        o.geometry?.dispose?.()
        if (o.material) for (const m of [].concat(o.material)) m.dispose?.()
      })
      live.delete(e)
    }
  }
}

export function removeEffect(obj) {
  for (const e of [...live]) if (e.obj === obj) live.delete(e)
}

export const hasEffect = (key) => typeof IMPL[key]?.create === 'function'
export const paramsOf = (key) => ({ ...(IMPL[key]?.params ?? {}) })
export const liveCount = (key) => {
  let n = 0
  for (const e of live) if (e.key === key) n++
  return n
}

export function createEarthBrush(opts = {}) { return makeEffect("earth_brush", opts) }
export function createArrival(opts = {}) { return makeEffect("arrival", opts) }
export function createRainCloud(opts = {}) { return makeEffect("rain_cloud", opts) }
export function createLifePulse(opts = {}) { return makeEffect("life_pulse", opts) }
export function createPrayerAnswer(opts = {}) { return makeEffect("prayer_answer", opts) }
export function createRainbow(opts = {}) { return makeEffect("rainbow", opts) }
export function createMeteors(opts = {}) { return makeEffect("meteors", opts) }
export function createHarvest(opts = {}) { return makeEffect("harvest", opts) }
export function createDivineBolt(opts = {}) { return makeEffect("divine_bolt", opts) }
export function createDivineDrop(opts = {}) { return makeEffect("divine_drop", opts) }
export function createShrineFireworks(opts = {}) { return makeEffect("shrine_fireworks", opts) }
export function createShrineIncense(opts = {}) { return makeEffect("shrine_incense", opts) }
export function createGentleSoul(opts = {}) { return makeEffect("gentle_soul", opts) }
export function createGeothermal(opts = {}) { return makeEffect("geothermal", opts) }
export function createHealingBlessing(opts = {}) { return makeEffect("healing_blessing", opts) }
export function createVillageHearth(opts = {}) { return makeEffect("village_hearth", opts) }
