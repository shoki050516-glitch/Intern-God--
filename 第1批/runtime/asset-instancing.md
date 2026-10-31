── Repeated copies across an area: use InstancedMesh ────────────────────────
With hundreds of copies, draw calls are the bottleneck, not triangles: 720 plants mean 1440 submissions
(two meshes per plant), above the 1000 budget. Instancing reduces this to variant count × meshes per template; the same 720 plants
across 4 variants need about 8 calls. The onscreen triangle budget often still has substantial headroom.

The object returned by assets.create() is a template; traverse its isMesh children and instance each one:

  const proto = makePineTree();                 // Template; do not add it to the scene.
  proto.updateMatrixWorld(true);                // child.matrixWorld is read below.
  proto.traverse((child) => {
    if (!child.isMesh) return;
    const im = new THREE.InstancedMesh(child.geometry, child.material, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.compose(posOf(i), quatOf(i), scaleOf(i));
      m.multiply(child.matrixWorld);            // 1. Without this the model falls apart; see below.
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;       // ②
    im.castShadow = child.castShadow;           // ③
    im.receiveShadow = child.receiveShadow;
    im.computeBoundingSphere();                 // ④
    scene.add(im);
  });

All four steps are required. Missing any can produce incorrect visuals without an error:
1. Template children have local transforms. After composing each instance matrix, .multiply(child.matrixWorld).
2. Set instanceMatrix.needsUpdate = true to upload the matrices.
3. Copy castShadow / receiveShadow from child. The platform configures the template, but your new InstancedMesh
   does not inherit them. Omitting these leaves the forest without shadows.
4. Populate matrices and computeBoundingSphere() before scene.add(). Refresh bounds after changing matrices/count/geometry, or maintain conservative bounds. instanceMatrix.needsUpdate does not refresh them. Never rely on `if (!im.boundingSphere)` after rendering: cached origin bounds can hide whole batches as the camera moves.

Split instances into spatial chunks instead of one batch. InstancedMesh culls the whole batch together: if one instance enters the frustum,
all instances are submitted. Partition by coordinates to recover culling at the cost of a few dozen draw calls.

Rebuild instances when real assets arrive. The platform replaces the manifest, not your existing InstancedMesh objects.
Wrap instance creation in a callable function and invoke it when real assets arrive (or during wrap-up verification). Without rebuilding,
the entire area stays on placeholders forever; early screenshots cannot reveal this because placeholders are expected then.