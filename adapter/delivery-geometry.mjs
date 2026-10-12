import { AdapterRejection, validateMethodParameters } from "./protocol.mjs";

// This is a deterministic, deliberately narrow digital renderer. It does not
// run Blender or evaluate scripts, constraints, booleans or physical behavior.
export const DELIVERY_BACKEND = Object.freeze({
  mode: "deterministic-mock-reference",
  evidence_class: "fixture-reference-only",
  blender_evidence: false,
  production_qualified: false,
});

export function reconstructModel(operations, { allowEmpty = false } = {}) {
  let model = null;
  const objects = new Map();
  for (const operation of operations) {
    const p = operation.params;
    if (["scene.create-model", "scene.create-box", "scene.create-cylinder", "scene.set-transform", "scene.assign-material"].includes(operation.method)) {
      if (!p || typeof p !== "object" || Array.isArray(p)) throw new AdapterRejection("invalid-parameters", "Semantic params must be an object");
      validateMethodParameters(operation.method, p);
      // Match the durable MoonBit Int boundary, rather than accepting geometry
      // that the native semantic operation could never have applied.
      for (const [key, value] of Object.entries(p)) {
        if (key.endsWith("Mm") && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
          throw new AdapterRejection("invalid-geometry", `${key} must be a signed 32-bit integer in mm`);
        }
      }
    }
    switch (operation.method) {
      case "scene.create-model":
        model = { name: p.name, units: p.units, coordinate_frame: p.coordinateFrame };
        objects.clear();
        break;
      case "scene.create-box":
        if (!model) throw new AdapterRejection("missing-editable-source", "Create a model before adding a box");
        // Re-declaring an object replaces its dimensions and resets its position.
        objects.set(p.objectId, {
          object_id: p.objectId, kind: "box",
          dimensions_mm: { width: p.widthMm, depth: p.depthMm, height: p.heightMm },
          translation_mm: { x: 0, y: 0, z: 0 }, material_id: null,
        });
        break;
      case "scene.create-cylinder":
        if (!model) throw new AdapterRejection("missing-editable-source", "Create a model before adding a cylinder");
        objects.set(p.objectId, {
          object_id: p.objectId, kind: "cylinder",
          dimensions_mm: { radius: p.radiusMm, height: p.heightMm }, sides: p.sides,
          translation_mm: { x: 0, y: 0, z: 0 }, material_id: null,
        });
        break;
      case "scene.set-transform": {
        const object = objects.get(p.objectId);
        if (!object) throw new AdapterRejection("unknown-delivery-object", `No primitive exists for ${p.objectId}`);
        object.translation_mm = { x: p.xMm, y: p.yMm, z: p.zMm };
        break;
      }
      case "scene.assign-material": {
        const object = objects.get(p.objectId);
        if (!object) throw new AdapterRejection("unknown-delivery-object", `No primitive exists for ${p.objectId}`);
        object.material_id = p.materialId;
        break;
      }
      case "representation.export":
      case "scene.validate":
        break;
      default:
        throw new AdapterRejection("unsupported-delivery-operation",
          `${operation.method} is retained in the adapter evidence but is not supported by the box/cylinder delivery renderer; no approximate geometry was produced`);
    }
  }
  if (!model || (!allowEmpty && objects.size === 0)) {
    throw new AdapterRejection("missing-editable-source", "Delivery needs a created model with at least one box or cylinder");
  }
  if (model.coordinate_frame !== "z-up-right-handed") {
    throw new AdapterRejection("unsupported-delivery-frame", "The delivery renderer supports z-up-right-handed only; the source frame was not converted");
  }
  return { ...model, objects: [...objects.values()].sort((a, b) => a.object_id.localeCompare(b.object_id)) };
}

// Retain the original module API for existing callers and box-only snapshots.
export const reconstructBoxes = reconstructModel;

export function primaryDimensions(object) {
  return object.kind === "cylinder"
    ? { width: 2 * object.dimensions_mm.radius, depth: 2 * object.dimensions_mm.radius, height: object.dimensions_mm.height }
    : object.dimensions_mm;
}

// Two rings start at +X and proceed counterclockwise viewed from +Z. Exact
// cardinal directions avoid near-zero trigonometric artifacts at the axes.
export function cylinderVertices(object) {
  const { radius, height } = object.dimensions_mm;
  const { x, y, z } = object.translation_mm;
  const ring = Array.from({ length: object.sides }, (_, i) => {
    const quarter = 4 * i / object.sides;
    const [cos, sin] = Number.isInteger(quarter)
      ? [[1, 0], [0, 1], [-1, 0], [0, -1]][quarter]
      : [Math.cos(2 * Math.PI * i / object.sides), Math.sin(2 * Math.PI * i / object.sides)];
    return [x + radius * cos, y + radius * sin];
  });
  return [-height / 2, height / 2].flatMap((dz) => ring.map(([vx, vy]) => [vx, vy, z + dz]));
}

export function objectMesh(object) {
  if (object.kind === "box") return {
    vertices: boxVertices(object),
    faces: [[1, 4, 3, 2], [5, 6, 7, 8], [1, 2, 6, 5], [2, 3, 7, 6], [3, 4, 8, 7], [4, 1, 5, 8]],
  };
  if (object.kind !== "cylinder") throw new AdapterRejection("unsupported-delivery-object", "Only boxes and cylinders have a delivery mesh");
  const n = object.sides;
  return {
    vertices: cylinderVertices(object),
    faces: [
      Array.from({ length: n }, (_, i) => n - i),
      Array.from({ length: n }, (_, i) => n + i + 1),
      ...Array.from({ length: n }, (_, i) => [i + 1, (i + 1) % n + 1, (i + 1) % n + n + 1, i + n + 1]),
    ],
  };
}

export function boxVertices(object) {
  const { width: w, depth: d, height: h } = object.dimensions_mm;
  const { x, y, z } = object.translation_mm;
  return [
    [-w / 2, -d / 2, -h / 2], [w / 2, -d / 2, -h / 2],
    [w / 2, d / 2, -h / 2], [-w / 2, d / 2, -h / 2],
    [-w / 2, -d / 2, h / 2], [w / 2, -d / 2, h / 2],
    [w / 2, d / 2, h / 2], [-w / 2, d / 2, h / 2],
  ].map(([vx, vy, vz]) => [vx + x, vy + y, vz + z]);
}

export function modelBounds(model) {
  const vertices = model.objects.flatMap((object) => objectMesh(object).vertices);
  return {
    min: [0, 1, 2].map((i) => Math.min(...vertices.map((v) => v[i]))),
    max: [0, 1, 2].map((i) => Math.max(...vertices.map((v) => v[i]))),
    units: "mm", coordinate_frame: model.coordinate_frame,
  };
}

export function renderObj(model, sourceDigest) {
  const divisor = { mm: 1, cm: 10, m: 1000 }[model.units];
  if (!divisor) throw new AdapterRejection("unsupported-delivery-units", "Missing declared scene units");
  const lines = [
    "# MoonMold deterministic-mock-reference / fixture-reference-only",
    model.objects.some((object) => object.kind === "cylinder")
      ? "# Digital box/cylinder geometry only. Not Blender evidence. No physical authority."
      : "# Digital box geometry only. Not Blender evidence. No physical authority.",
    `# source_sha256 ${sourceDigest}`,
    `# units ${model.units}; coordinate_frame ${model.coordinate_frame}`,
    "# OBJ is unitless: configure your importer to the units above.",
  ];
  let offset = 0;
  for (const object of model.objects) {
    const mesh = objectMesh(object);
    lines.push(`o ${object.object_id}`);
    if (object.kind === "cylinder") lines.push(`# cylinder radius_mm ${object.dimensions_mm.radius}; height_mm ${object.dimensions_mm.height}; sides ${object.sides}; axis +Z; inscribed regular polygon; flat faces; no smooth normals`);
    for (const vertex of mesh.vertices) lines.push(`v ${vertex.map((n) => n / divisor).join(" ")}`);
    for (const face of mesh.faces) {
      lines.push(`f ${face.map((index) => index + offset).join(" ")}`);
    }
    offset += mesh.vertices.length;
  }
  return `${lines.join("\n")}\n`;
}

function xml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderSvg(model, sourceDigest) {
  const project = ([x, y, z]) => [x - y, (x + y) / 2 - z];
  const hasCylinders = model.objects.some((object) => object.kind === "cylinder");
  const all = model.objects.flatMap((object) => objectMesh(object).vertices).map(project);
  const minX = Math.min(...all.map((v) => v[0]));
  const maxX = Math.max(...all.map((v) => v[0]));
  const minY = Math.min(...all.map((v) => v[1]));
  const maxY = Math.max(...all.map((v) => v[1]));
  const scale = Math.min(700 / Math.max(1, maxX - minX), 360 / Math.max(1, maxY - minY));
  const screen = (point) => {
    const [x, y] = project(point);
    return `${(400 + (x - (minX + maxX) / 2) * scale).toFixed(3)},${(265 + (y - (minY + maxY) / 2) * scale).toFixed(3)}`;
  };
  const shapes = model.objects.map((object) => {
    if (object.kind === "cylinder") {
      const { vertices, faces } = objectMesh(object);
      // Painter-style illustration only: visible side facets, then the top cap.
      const visible = faces.slice(2).filter((face) => {
        const a = vertices[face[0] - 1], b = vertices[face[1] - 1];
        return b[1] - a[1] - (b[0] - a[0]) > 0;
      });
      return `<g><title>${xml(object.object_id)} · cylinder · ${object.sides} sides</title>${[...visible, faces[1]].map((face, i) => `<polygon points="${face.map((index) => screen(vertices[index - 1])).join(" ")}" fill="${i === visible.length ? "#a5b9ce" : "#4b6584"}" stroke="#24364b" stroke-width="1.5"/>`).join("")}</g>`;
    }
    const vertices = boxVertices(object);
    return `<g><title>${xml(object.object_id)}</title>${[
      [[2, 3, 7, 6], "#778ca5"], [[1, 2, 6, 5], "#4b6584"], [[4, 5, 6, 7], "#a5b9ce"],
    ].map(([face, fill]) => `<polygon points="${face.map((i) => screen(vertices[i])).join(" ")}" fill="${fill}" stroke="#24364b" stroke-width="1.5"/>`).join("")}</g>`;
  }).join("\n");
  const label = hasCylinders ? "box/cylinder" : "box";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560" role="img" aria-label="Fixture-only digital ${label} preview">
<rect width="800" height="560" fill="#f5f7fa"/>
<text x="30" y="35" font-family="sans-serif" font-size="20" fill="#24364b">${xml(model.name)} · digital ${label} preview</text>
<text x="30" y="60" font-family="sans-serif" font-size="13" fill="#7b341e">DETERMINISTIC MOCK · FIXTURE ONLY · NOT BLENDER · NO PHYSICAL AUTHORITY</text>
${shapes}
<text x="30" y="500" font-family="sans-serif" font-size="13" fill="#24364b">${xml(model.units)} · ${xml(model.coordinate_frame)} · illustration, not a dimensioned engineering drawing</text>
<text x="30" y="526" font-family="monospace" font-size="10" fill="#526477">Editable source ${xml(sourceDigest)}</text>
</svg>\n`;
}
