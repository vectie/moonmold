import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OrbitCamera,
  prepareScene,
  SolidViewer,
} from "../ui/workbench/solid-viewer.mjs";
import { createOperatorServer } from "./operator-server.mjs";

const scene = () => ({
  vertices: [
    [1e9, 0, 0],
    [1e9 + 2, 0, 0],
    [1e9, 3, 0],
    [1e9, 0, 4],
  ],
  triangles: [
    [0, 1, 2],
    [0, 3, 1],
  ],
  parts: [
    {
      id: "source-chunk-1",
      source_name: "same-source",
      triangle_range: { start: 0, count: 1 },
    },
    {
      id: "source-chunk-2",
      source_name: "same-source",
      triangle_range: { start: 1, count: 1 },
    },
  ],
});
test("solid presentation normalizes before float32 conversion, preserves source data and keeps source chunks together", () => {
  const input = scene(),
    before = JSON.stringify(input);
  input.vertices.forEach(Object.freeze);
  input.triangles.forEach(Object.freeze);
  const output = prepareScene(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(output.bounds, { min: [1e9, 0, 0], max: [1e9 + 2, 3, 4] });
  assert.ok(output.meshes[0].positions.every(Number.isFinite));
  assert.notDeepEqual(
    [...output.meshes[0].positions.slice(0, 3)],
    [...output.meshes[0].positions.slice(3, 6)],
  );
  assert.deepEqual(output.meshes[0].groupCenter, output.meshes[1].groupCenter);
  assert.equal(output.meshes[0].color, output.meshes[1].color);
  for (const m of output.meshes)
    for (let i = 0; i < m.normals.length; i += 3)
      assert.ok(Math.abs(Math.hypot(...m.normals.slice(i, i + 3)) - 1) < 1e-6);
});
test("bad mesh references reject usefully and an empty scene is a distinct state", () => {
  assert.equal(prepareScene(null), null);
  assert.equal(prepareScene({ vertices: [], triangles: [] }), null);
  const input = scene();
  input.triangles[0][0] = 999;
  assert.throws(() => prepareScene(input), /Invalid preview triangle/);
  const points = scene();
  points.vertices[0][0] = NaN;
  assert.throws(() => prepareScene(points), /Invalid preview coordinates/);
});
test("orbit completes multiple full turns, all named views and extreme zoom stay finite", () => {
  const camera = new OrbitCamera();
  camera.orbit(10000, 10000);
  assert.ok(Math.abs(camera.yaw) > Math.PI * 2);
  for (const name of [
    "front",
    "back",
    "right",
    "left",
    "top",
    "bottom",
    "iso",
  ]) {
    camera.view(name);
    for (const delta of [1e9, -1e9]) {
      camera.zoom(delta);
      camera.move(100, -100, 400);
      const m = camera.matrices(0.2);
      assert.ok([...m.view, ...m.projection].every(Number.isFinite));
      assert.ok(camera.distance >= 0.25 && camera.distance <= 40);
    }
  }
  camera.reset();
  assert.deepEqual(camera.pan, [0, 0]);
  assert.equal(camera.distance, 4.2);
});

test("camera and visibility changes reuse GPU geometry and release old buffers on a new scene", (t) => {
  let uploads = 0,
    deletes = 0,
    draws = 0,
    frames = [];
  const raf = Object.getOwnPropertyDescriptor(
      globalThis,
      "requestAnimationFrame",
    ),
    caf = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  globalThis.requestAnimationFrame = (fn) => {
    frames.push(fn);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    if (raf) Object.defineProperty(globalThis, "requestAnimationFrame", raf);
    else delete globalThis.requestAnimationFrame;
    if (caf) Object.defineProperty(globalThis, "cancelAnimationFrame", caf);
    else delete globalThis.cancelAnimationFrame;
  });
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    COLOR_BUFFER_BIT: 1,
    DEPTH_BUFFER_BIT: 2,
    DEPTH_TEST: 7,
    CULL_FACE: 8,
    FLOAT: 9,
    TRIANGLES: 10,
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    deleteShader() {},
    createProgram: () => ({}),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    createBuffer: () => ({}),
    bindBuffer() {},
    bufferData() {
      uploads++;
    },
    deleteBuffer() {
      deletes++;
    },
    viewport() {},
    clearColor() {},
    clear() {},
    enable() {},
    disable() {},
    useProgram() {},
    uniformMatrix4fv() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    uniform3fv() {},
    drawArrays() {
      draws++;
    },
    deleteProgram() {},
  };
  const canvas = {
    clientWidth: 800,
    clientHeight: 500,
    dataset: {},
    getContext: () => gl,
    addEventListener() {},
    removeEventListener() {},
  };
  const viewer = new SolidViewer(canvas);
  const flush = () => {
    const current = frames;
    frames = [];
    for (const fn of current) fn();
  };
  const input = scene(),
    before = JSON.stringify(input);
  viewer.setScene(input);
  flush();
  assert.equal(uploads, 4);
  for (let i = 0; i < 30; i++) {
    viewer.camera.orbit(30, 2);
    viewer.camera.zoom(i - 15);
    viewer.setScene(input, "source-chunk-1");
    viewer.setVisibility(["source-chunk-2"], i % 2 === 0);
    viewer.setExplode(0.5);
    flush();
  }
  assert.equal(
    uploads,
    4,
    "orbit must update uniforms, not upload the mesh every frame",
  );
  assert.ok(draws > 30);
  assert.equal(JSON.stringify(input), before);
  viewer.setScene({ ...input });
  flush();
  assert.equal(uploads, 8);
  assert.equal(deletes, 4);
  viewer.dispose();
  assert.equal(deletes, 8);
});

test("operator home opens the model workspace and serves only local viewer assets with correct media types", async (t) => {
  const root = fileURLToPath(
    new URL("../evidence/generated/", import.meta.url),
  );
  await mkdir(root, { recursive: true });
  const workspace = await mkdtemp(path.join(root, "workbench-test-"));
  const server = createOperatorServer({ workspaceRoot: workspace });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /data-workbench="layout"/);
  for (const [file, type] of [
    ["workbench.mjs", "text/javascript"],
    ["solid-viewer.mjs", "text/javascript"],
    ["workbench.css", "text/css"],
    ["icons/package.svg", "image/svg+xml"],
  ]) {
    const r = await fetch(`${base}/workbench/${file}`);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("content-type").startsWith(type));
  }
  const escape = await fetch(`${base}/workbench/%2e%2e%2fAGENTS.md`);
  assert.notEqual(escape.headers.get("content-type"), "text/markdown");
  assert.doesNotMatch(await escape.text(), /# MoonMold Agent Guide/);
});
