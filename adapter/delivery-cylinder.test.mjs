import assert from "node:assert/strict";
import test from "node:test";
import { cylinderVertices, modelBounds, objectMesh, primaryDimensions, reconstructModel, renderObj, renderSvg } from "./delivery-geometry.mjs";

const op = (method, params) => ({ method, params });
const create = (units = "mm") => op("scene.create-model", { name: "cylinder-fixture", units, coordinateFrame: "z-up-right-handed" });
const cylinder = (sides = 32, more = {}) => op("scene.create-cylinder", { objectId: "primary-mass", radiusMm: 300, heightMm: 700, sides, ...more });
const translate = op("scene.set-transform", { objectId: "primary-mass", xMm: 100, yMm: -200, zMm: 350 });

function parseObj(text) {
  const vertices = [], faces = [], objects = [];
  for (const line of text.split("\n")) {
    const [kind, ...values] = line.split(" ");
    if (kind === "v") vertices.push(values.map(Number));
    if (kind === "f") faces.push(values.map(Number));
    if (kind === "o") objects.push({ name: values[0], vertexStart: vertices.length, faceStart: faces.length });
  }
  for (const v of vertices) assert.ok(v.length === 3 && v.every(Number.isFinite));
  for (const f of faces) assert.ok(f.length >= 3 && f.every((i) => Number.isSafeInteger(i) && i >= 1 && i <= vertices.length));
  return { vertices, faces, objects };
}

function near(actual, expected, scale = 1) { assert.ok(Math.abs(actual - expected) <= 1e-10 * scale, `${actual} != ${expected}`); }
function outwardClosed({ vertices, faces }, center) {
  const edges = new Map();
  for (const face of faces) {
    const [a, b, c] = face.map((i) => vertices[i - 1]);
    const u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(normal.reduce((sum, n, i) => sum + n * (a[i] - center[i]), 0) > 0, "face winding must point outward");
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = [Math.min(a, b), Math.max(a, b)].join(":");
      const directions = edges.get(key) ?? [];
      directions.push(a < b ? 1 : -1); edges.set(key, directions);
    }
  }
  for (const directions of edges.values()) assert.deepEqual(directions.toSorted(), [-1, 1]);
  assert.equal(vertices.length - edges.size + faces.length, 2);
}

for (const sides of [8, 9, 31, 32, 255, 256]) {
  test(`${sides}-sided cylinder has parsed radius, height, outward faces and closed directed edges`, () => {
    const model = reconstructModel([create(), cylinder(sides), translate]);
    const obj = renderObj(model, "sha256:fixture");
    assert.equal(renderObj(model, "sha256:fixture"), obj);
    const parsed = parseObj(obj);
    assert.equal(parsed.vertices.length, 2 * sides);
    assert.equal(parsed.faces.length, sides + 2);
    assert.equal(parsed.faces[0].length, sides);
    assert.equal(parsed.faces[1].length, sides);
    assert.ok(parsed.faces.slice(2).every((face) => face.length === 4));
    for (const [x, y, z] of parsed.vertices) {
      near(Math.hypot(x - 100, y + 200), 300);
      assert.ok(z === 0 || z === 700);
    }
    outwardClosed(parsed, [100, -200, 350]);
    const bounds = modelBounds(model);
    assert.deepEqual(bounds.min, [0, 1, 2].map((i) => Math.min(...parsed.vertices.map((v) => v[i]))));
    assert.deepEqual(bounds.max, [0, 1, 2].map((i) => Math.max(...parsed.vertices.map((v) => v[i]))));
    if (sides % 4 === 0) assert.deepEqual(bounds, { min: [-200, -500, 0], max: [400, 100, 700], units: "mm", coordinate_frame: "z-up-right-handed" });
    if (sides % 2) assert.ok(bounds.min[0] > -200, "odd polygon bounds must not pretend to be nominal diameter");
    assert.deepEqual(primaryDimensions(model.objects[0]), { width: 600, depth: 600, height: 700 });
    assert.deepEqual(cylinderVertices(model.objects[0]), parsed.vertices);
    assert.match(obj, /inscribed regular polygon; flat faces; no smooth normals/);
  });
}

test("mm/cm/m preserve both primitive geometry and translations", () => {
  for (const [units, divisor] of [["mm", 1], ["cm", 10], ["m", 1000]]) {
    const model = reconstructModel([create(units), cylinder(16), translate]);
    const { vertices } = parseObj(renderObj(model, "sha256:units"));
    const expected = cylinderVertices(model.objects[0]);
    for (let i = 0; i < vertices.length; i++) for (let j = 0; j < 3; j++) near(vertices[i][j] * divisor, expected[i][j]);
  }
});

test("mixed scene face indices, bounds, editable reconstruction and SVG use actual primitives", () => {
  const operations = [create(), cylinder(12), translate,
    op("scene.create-box", { objectId: "z-box", widthMm: 20, depthMm: 40, heightMm: 60 }),
    op("scene.set-transform", { objectId: "z-box", xMm: 1000, yMm: 0, zMm: 0 }),
    op("scene.assign-material", { objectId: "primary-mass", materialId: "reference-blue" })];
  const model = reconstructModel(operations);
  assert.deepEqual(reconstructModel(JSON.parse(JSON.stringify(operations))), model);
  const obj = parseObj(renderObj(model, "sha256:mixed"));
  assert.equal(obj.vertices.length, 32); assert.equal(obj.faces.length, 20);
  assert.deepEqual(obj.objects.map((o) => o.name), ["primary-mass", "z-box"]);
  assert.ok(obj.faces.slice(14).every((f) => f.every((v) => v >= 25 && v <= 32)));
  assert.deepEqual(modelBounds(model), { min: [-200, -500, -30], max: [1010, 100, 700], units: "mm", coordinate_frame: "z-up-right-handed" });
  const svg = renderSvg(model, "sha256:mixed");
  assert.match(svg, /primary-mass · cylinder · 12 sides/);
  assert.match(svg, /<title>z-box<\/title>/);
  assert.match(svg, /FIXTURE ONLY · NOT BLENDER · NO PHYSICAL AUTHORITY/);
  assert.doesNotMatch(svg, /NaN|Infinity|<script/);
  assert.ok((svg.match(/<polygon /g) ?? []).length > 4);
});

test("redeclared cylinders reset pose/material; model reset and kind replacement are exact", () => {
  const model = reconstructModel([create(), cylinder(), translate, op("scene.assign-material", { objectId: "primary-mass", materialId: "blue" }), cylinder(8, { radiusMm: 50 })]);
  assert.deepEqual(model.objects[0], { object_id: "primary-mass", kind: "cylinder", dimensions_mm: { radius: 50, height: 700 }, sides: 8, translation_mm: { x: 0, y: 0, z: 0 }, material_id: null });
  const replaced = reconstructModel([create(), cylinder(), op("scene.create-box", { objectId: "primary-mass", widthMm: 5, depthMm: 6, heightMm: 7 })]);
  assert.equal(replaced.objects[0].kind, "box"); assert.equal(objectMesh(replaced.objects[0]).vertices.length, 8);
  const reset = reconstructModel([create(), cylinder(), create("m"), cylinder(9, { objectId: "new-cylinder" })]);
  assert.equal(reset.objects.length, 1); assert.equal(reset.objects[0].object_id, "new-cylinder");
});

test("invalid cylinder parameters fail closed without defaults, coercion or scripts", () => {
  for (const sides of [undefined, null, "32", 0, 7, 257, 8.5, NaN, Infinity]) {
    assert.throws(() => reconstructModel([create(), cylinder(sides === undefined ? 32 : sides, { sides })]), { code: "invalid-geometry" });
  }
  for (const key of ["radiusMm", "heightMm"]) for (const value of [0, -1, 0.5, "300", null, undefined, NaN, Infinity, 2147483648]) {
    assert.throws(() => reconstructModel([create(), cylinder(32, { [key]: value })]), { code: "invalid-geometry" });
  }
  assert.throws(() => reconstructModel([create(), cylinder(32, { expression: "anything" })]), { code: "unexpected-parameter" });
  assert.throws(() => reconstructModel([create(), cylinder(32, { objectId: "x\nv 0 0 0" })]), { code: "invalid-identity" });
  assert.throws(() => reconstructModel([cylinder()]), { code: "missing-editable-source" });
  assert.throws(() => reconstructModel([create(), cylinder(), op("scene.set-transform", { ...translate.params, zMm: Infinity })]), { code: "invalid-transform" });
  assert.throws(() => reconstructModel([create(), cylinder(), op("scene.set-transform", { ...translate.params, zMm: 0.5 })]), { code: "invalid-geometry" });
  assert.throws(() => reconstructModel([op("scene.create-model", { ...create().params, units: "inch" }), cylinder()]), { code: "missing-scale" });
  assert.throws(() => reconstructModel([op("scene.create-model", { ...create().params, coordinateFrame: "y-up-right-handed" }), cylinder()]), { code: "unsupported-delivery-frame" });
});
