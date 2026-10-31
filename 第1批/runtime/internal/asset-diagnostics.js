export function scanAssetScene({ root, manifest, registeredRoots, rootSlotIds, consumedSurfaceIds, maxOwners }) {
  if (!root) {
    return {
      scene: {
        unregisteredMeshCount: null,
        totalMeshCount: null,
        unplacedSlotIds: null,
        declaredSlotCount: null,
        triangles: null
      },
      shadowLightCount: null
    };
  }
  let total = 0;
  let unregistered = 0;
  let shadowLights = 0;
  let sceneTriangles = 0;
  const uniqueGeometry = new Map();
  const owners = new Map();
  const placedSlotIds = {};
  root.traverse(function (child) {
    if (child.isLight === true && child.castShadow === true) shadowLights += 1;
    if (child.isMesh !== true) return;
    total += 1;
    let node = child;
    let ownerRoot = null;
    while (node) {
      if (registeredRoots.has(node)) {
        ownerRoot = node;
        break;
      }
      node = node.parent;
    }
    if (!ownerRoot) unregistered += 1;
    const geometry = child.geometry;
    const vertexCount = geometry
      ? (geometry.index
        ? geometry.index.count
        : (geometry.attributes && geometry.attributes.position ? geometry.attributes.position.count : 0))
      : 0;
    const perCopy = Math.floor(vertexCount / 3);
    if (geometry && !uniqueGeometry.has(geometry.uuid)) uniqueGeometry.set(geometry.uuid, perCopy);
    const copies = child.isInstancedMesh === true ? (child.count || 0) : 1;
    const triangles = perCopy * copies;
    sceneTriangles += triangles;
    {
      const seen = ownerRoot ? rootSlotIds.get(ownerRoot) : null;
      if (seen) placedSlotIds[seen] = true;
    }
    if (triangles <= 0) return;
    const slotId = ownerRoot ? (rootSlotIds.get(ownerRoot) || null) : null;
    const label = slotId || child.name || (child.parent && child.parent.name) || child.type;
    const key = (slotId ? "slot:" + slotId : "mesh:" + label);
    const entry = owners.get(key);
    if (entry) {
      entry.copies += copies;
      entry.triangles += triangles;
      if (perCopy > entry.trianglesPerCopy) entry.trianglesPerCopy = perCopy;
      if (child.castShadow === true) entry.castShadow = true;
    } else {
      owners.set(key, {
        label: label,
        slotId: slotId,
        registered: Boolean(ownerRoot),
        trianglesPerCopy: perCopy,
        copies: copies,
        triangles: triangles,
        castShadow: child.castShadow === true
      });
    }
  });
  let uniqueTriangles = 0;
  uniqueGeometry.forEach(function (value) { uniqueTriangles += value; });
  const top = Array.from(owners.values())
    .sort(function (a, b) { return b.triangles - a.triangles; })
    .slice(0, maxOwners)
    .map(function (entry) { return Object.freeze(entry); });
  const declared = manifest && manifest.slots ? Object.keys(manifest.slots) : null;
  const unplaced = declared
    ? declared.filter(function (id) {
      if (placedSlotIds[id] === true) return false;
      return consumedSurfaceIds[id] !== true;
    })
    : null;
  return {
    scene: {
      unregisteredMeshCount: unregistered,
      totalMeshCount: total,
      unplacedSlotIds: unplaced ? Object.freeze(unplaced) : null,
      declaredSlotCount: declared ? declared.length : null,
      triangles: Object.freeze({
        sceneTriangles: sceneTriangles,
        uniqueTriangles: uniqueTriangles,
        uniqueGeometryCount: uniqueGeometry.size,
        topOwners: Object.freeze(top)
      })
    },
    shadowLightCount: shadowLights
  };
}
