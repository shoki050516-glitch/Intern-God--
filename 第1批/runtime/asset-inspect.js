import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assets } from "./asset-runtime.js";

const params = new URLSearchParams(location.search);
const slotId = params.get("slot");
const variantId = params.get("variant") || undefined;

const canvas = document.getElementById("view");
const hud = document.getElementById("hud");
const clips = document.getElementById("clips");
const errBox = document.getElementById("err");
const loading = document.getElementById("loading");

addEventListener("keydown", function (event) {
  if (event.key === "Escape") parent.postMessage({ type: "hm-asset-inspect-close" }, "*");
});

function fail(message) {
  if (loading) loading.hidden = true;
  errBox.textContent = message;
  errBox.style.display = "grid";
}

const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#111926");
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x35405a, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xbcd2ff, 0.5);
rim.position.set(-4, 2, -3);
scene.add(rim);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

async function main() {
  if (!slotId) return fail("缺少 slot 参数");
  await assets.init();
  const slot = assets.getSlot(slotId);
  const object = await assets.create(slotId, variantId);
  scene.add(object);
  assets.setupLighting(scene, renderer, { adopt: true });
  const delivery = window.__HM_ASSET_DIAGNOSTICS__?.slots?.[slotId];
  if (slot.foliageAsset?.status === "ready" && ["procedural", "emergency"].includes(delivery?.layer)) {
    const reasons = (delivery?.errors ?? []).filter(value => typeof value === "string" && value.startsWith("foliage:"));
    const newline = String.fromCharCode(10);
    return fail("植被已生成，但预览加载回落。已有几何和贴图保留，无需重新生成。" + (reasons.length ? newline + reasons.join(newline).slice(0,400) : "请检查材质接入与运行时依赖。"));
  }

  if (loading) loading.hidden = true;
  const b = slot.bounds;
  const box = new THREE.Box3().setFromObject(object);
  const size = box.isEmpty() ? new THREE.Vector3(b.width, b.height, b.depth) : box.getSize(new THREE.Vector3());
  const wire = new THREE.Box3Helper(
    new THREE.Box3(
      new THREE.Vector3(-b.width / 2, slot.origin === "bottom-center" ? 0 : -b.height / 2, -b.depth / 2),
      new THREE.Vector3(b.width / 2, slot.origin === "bottom-center" ? b.height : b.height / 2, b.depth / 2)
    ),
    new THREE.Color("#4f7fd0")
  );
  scene.add(wire);
  const span1m = Math.max(4, Math.ceil(Math.max(b.width, b.depth, size.x, size.z) * 2));
  const grid = new THREE.GridHelper(span1m, span1m);
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  scene.add(grid);

  const center = box.isEmpty() ? new THREE.Vector3(0, b.height / 2, 0) : box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, b.width, b.height, b.depth);
  controls.target.copy(center);
  camera.position.set(center.x + span * 1.1, center.y + span * 0.75, center.z + span * 1.6);
  controls.update();

  const layer = (window.__HM_ASSET_DIAGNOSTICS__?.slots?.[slotId] ?? {}).layer ?? "?";
  const gen = slot.generated || {};
  const declared = [b.width, b.height, b.depth];
  const rows = [
    slotId + (variantId ? " / " + variantId : ""),
    "交付层 <b>" + layer + "</b>" + (slot.fitMode === "axes" ? " <b>三轴强对齐</b>" : "")
      + (slot.origin === "center" ? " <span class=dim>原点=几何中心</span>" : ""),
    "声明 <b>" + fmt(declared) + "</b> 米　朝向 <b>" + (slot.forward || "?") + "</b>"
  ];

  if (Array.isArray(gen.localAabb && gen.localAabb.max)) {
    const raw = [0, 1, 2].map(function (i) { return gen.localAabb.max[i] - gen.localAabb.min[i]; });
    rows.push("GLB 几何 <b>" + fmt(raw) + "</b> <span class=dim>（provider 原始盒，未缩放未转向）</span>");
  }
  if (Array.isArray(gen.shownSize)) {
    rows.push("画面里 <b>" + fmt(gen.shownSize) + "</b> 米 <span class=dim>（生成期量，摆位/碰撞用它）</span>");
    const worst = Math.max.apply(null, declared.map(function (v, i) {
      return v > 0 ? Math.abs(gen.shownSize[i] - v) / v : 0;
    }));
    if (worst > 0.25) {
      rows.push("<span class=warn>比例差 " + Math.round(worst * 100) + "%</span>"
        + " <span class=dim>（三轴 " + declared.map(function (v, i) {
          return v > 0 ? round(gen.shownSize[i] / v) : "-";
        }).join(" / ") + " 倍）</span>");
    }
  }
  rows.push((slot.rig ? "<span class=dim>浏览器盒 " + fmt([size.x, size.y, size.z])
    + "（绑定姿态，对角色不准）</span>" : "浏览器盒 <b>" + fmt([size.x, size.y, size.z]) + "</b> 米"));
  const count = Math.max(1, Math.round(slot.instanceCount || 1));
  const total = (gen.faces && gen.faces.actual != null) ? gen.faces.actual
    : (slot.foliageAsset && slot.foliageAsset.faces && slot.foliageAsset.faces.actual != null)
      ? slot.foliageAsset.faces.actual
    : (slot.procedural && slot.procedural.faces && slot.procedural.faces.actual != null)
      ? slot.procedural.faces.actual : null;
  const perCopy = (slot.foliageAsset && slot.foliageAsset.triangles != null)
    ? slot.foliageAsset.triangles
    : (total != null ? Math.round(total / count) : null);
  if (perCopy != null) {
    rows.push("面数 <b>" + perCopy.toLocaleString() + "</b> <span class=dim>/份</span>"
      + (count > 1 && total != null
        ? " <span class=dim>· 同屏 " + count + " 份共 " + total.toLocaleString() + "</span>"
        : ""));
  }
  if (gen.transform && gen.transform.rotationY) {
    rows.push("<span class=dim>yaw " + Math.round((gen.transform.rotationY * 180) / Math.PI) + "°</span>");
  }
  hud.innerHTML = rows.join("<br>");

  const clipNames = assets.clipsOf(object);
  if (clipNames.length > 0) {
    let current = null;
    for (const name of clipNames) {
      const button = document.createElement("button");
      button.textContent = name;
      button.addEventListener("click", async function () {
        const next = current === name ? null : name;
        const ok = await assets.setState(object, next);
        if (!ok && next) {
          button.textContent = name + "（无此 clip）";
          return;
        }
        current = next;
        for (const other of clips.children) other.classList.remove("on");
        if (next) button.classList.add("on");
      });
      clips.append(button);
    }
  } else if (slot.rig) {
    const note = document.createElement("span");
    note.textContent = slot.rig.status === "ready" ? "有骨架但没有 clip" : "声明了动作，但这一份是静态网格";
    clips.append(note);
  }
}

function fmt(values) {
  return [0, 1, 2].map(function (i) { return round(values[i]); }).join(" × ");
}

function round(value) {
  return Math.round(value * 100) / 100;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(function () {
  assets.updateWind?.(Math.min(0.05, clock.getDelta()));
  controls.update();
  renderer.render(scene, camera);
});

export const inspectionReady = main().catch(function (error) {
  fail("检视失败：" + (error && error.message ? error.message : String(error)));
});
