import { AdapterRejection } from "./protocol.mjs";

// This is a deterministic, deliberately narrow digital renderer. It does not
// run Blender or evaluate scripts, constraints, booleans or physical behavior.
export const DELIVERY_BACKEND = Object.freeze({
  mode: "deterministic-mock-reference",
  evidence_class: "fixture-reference-only",
  blender_evidence: false,
  production_qualified: false,
});

export function reconstructBoxes(operations) {
  let model = null;
  const objects = new Map();
  for (const operation of operations) {
    const p = operation.params;
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
      case "scene.set-transform": {
        const object = objects.get(p.objectId);
        if (!object) throw new AdapterRejection("unknown-delivery-object", `No box exists for ${p.objectId}`);
        object.translation_mm = { x: p.xMm, y: p.yMm, z: p.zMm };
        break;
      }
      case "scene.assign-material": {
        const object = objects.get(p.objectId);
        if (!object) throw new AdapterRejection("unknown-delivery-object", `No box exists for ${p.objectId}`);
        object.material_id = p.materialId;
        break;
      }
      case "representation.export":
      case "scene.validate":
        break;
      default:
        throw new AdapterRejection("unsupported-delivery-operation",
          `${operation.method} is retained in the adapter evidence but is not supported by the box delivery renderer; no approximate geometry was produced`);
    }
  }
  if (!model || objects.size === 0) {
    throw new AdapterRejection("missing-editable-source", "Delivery needs a created model with at least one box");
  }
  if (model.coordinate_frame !== "z-up-right-handed") {
    throw new AdapterRejection("unsupported-delivery-frame", "The box delivery renderer currently supports z-up-right-handed only; the source frame was not converted");
  }
  return { ...model, objects: [...objects.values()].sort((a, b) => a.object_id.localeCompare(b.object_id)) };
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
  const vertices = model.objects.flatMap(boxVertices);
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
    "# Digital box geometry only. Not Blender evidence. No physical authority.",
    `# source_sha256 ${sourceDigest}`,
    `# units ${model.units}; coordinate_frame ${model.coordinate_frame}`,
    "# OBJ is unitless: configure your importer to the units above.",
  ];
  let offset = 0;
  for (const object of model.objects) {
    lines.push(`o ${object.object_id}`);
    for (const vertex of boxVertices(object)) lines.push(`v ${vertex.map((n) => n / divisor).join(" ")}`);
    for (const face of [[1, 4, 3, 2], [5, 6, 7, 8], [1, 2, 6, 5], [2, 3, 7, 6], [3, 4, 8, 7], [4, 1, 5, 8]]) {
      lines.push(`f ${face.map((index) => index + offset).join(" ")}`);
    }
    offset += 8;
  }
  return `${lines.join("\n")}\n`;
}

function xml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderSvg(model, sourceDigest) {
  const project = ([x, y, z]) => [x - y, (x + y) / 2 - z];
  const all = model.objects.flatMap(boxVertices).map(project);
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
    const vertices = boxVertices(object);
    return `<g><title>${xml(object.object_id)}</title>${[
      [[2, 3, 7, 6], "#778ca5"], [[1, 2, 6, 5], "#4b6584"], [[4, 5, 6, 7], "#a5b9ce"],
    ].map(([face, fill]) => `<polygon points="${face.map((i) => screen(vertices[i])).join(" ")}" fill="${fill}" stroke="#24364b" stroke-width="1.5"/>`).join("")}</g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560" role="img" aria-label="Fixture-only digital box preview">
<rect width="800" height="560" fill="#f5f7fa"/>
<text x="30" y="35" font-family="sans-serif" font-size="20" fill="#24364b">${xml(model.name)} · digital box preview</text>
<text x="30" y="60" font-family="sans-serif" font-size="13" fill="#7b341e">DETERMINISTIC MOCK · FIXTURE ONLY · NOT BLENDER · NO PHYSICAL AUTHORITY</text>
${shapes}
<text x="30" y="500" font-family="sans-serif" font-size="13" fill="#24364b">${xml(model.units)} · ${xml(model.coordinate_frame)} · illustration, not a dimensioned engineering drawing</text>
<text x="30" y="526" font-family="monospace" font-size="10" fill="#526477">Editable source ${xml(sourceDigest)}</text>
</svg>\n`;
}
