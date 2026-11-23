// Presentation only: input arrays and applied geometry are never mutated.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const unit = (v) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
export const partPalette = [
  "#d66a5e",
  "#cc8071",
  "#8a99a6",
  "#5ba4b6",
  "#84949f",
  "#6a9dad",
  "#97a2ac",
  "#b3a17c",
];
export function colorRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

export function prepareScene(scene) {
  if (!scene?.vertices?.length || !scene.triangles?.length) return null;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const p of scene.vertices) {
    if (p.length !== 3 || !p.every(Number.isFinite))
      throw Error("Invalid preview coordinates");
    p.forEach((n, i) => {
      min[i] = Math.min(min[i], n);
      max[i] = Math.max(max[i], n);
    });
  }
  const center = min.map((n, i) => (n + max[i]) / 2),
    span = Math.max(...min.map((n, i) => max[i] - n)) || 1;
  const point = (p) => [
    ((p[0] - center[0]) / span) * 2,
    ((p[2] - center[2]) / span) * 2,
    (-(p[1] - center[1]) / span) * 2,
  ];
  const parts = scene.parts?.length
    ? scene.parts
    : [
        {
          id: "reference",
          source_name: "reference",
          triangle_range: { start: 0, count: scene.triangles.length },
        },
      ];
  const groups = new Map();
  const meshes = parts.map((part) => {
    const name = part.source_name || part.id;
    if (!groups.has(name)) groups.set(name, groups.size);
    const positions = [],
      normals = [];
    const { start, count } = part.triangle_range;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(count) ||
      start < 0 ||
      count < 0 ||
      start + count > scene.triangles.length
    )
      throw Error("Invalid preview triangle range");
    for (let i = start; i < start + count; i++) {
      const face = scene.triangles[i];
      if (
        face.length !== 3 ||
        !face.every(
          (v) => Number.isInteger(v) && v >= 0 && v < scene.vertices.length,
        )
      )
        throw Error("Invalid preview triangle");
      const p = face.map((v) => point(scene.vertices[v]));
      const n = unit(
        cross(
          p[1].map((x, j) => x - p[0][j]),
          p[2].map((x, j) => x - p[0][j]),
        ),
      );
      p.forEach((q) => {
        positions.push(...q);
        normals.push(...n);
      });
    }
    return {
      id: part.id,
      name,
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      color: partPalette[groups.get(name) % partPalette.length],
    };
  });
  const groupBounds = new Map();
  for (const m of meshes) {
    if (!groupBounds.has(m.name))
      groupBounds.set(m.name, {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      });
    const b = groupBounds.get(m.name);
    for (let i = 0; i < m.positions.length; i++) {
      const axis = i % 3;
      b.min[axis] = Math.min(b.min[axis], m.positions[i]);
      b.max[axis] = Math.max(b.max[axis], m.positions[i]);
    }
  }
  for (const m of meshes) {
    const b = groupBounds.get(m.name);
    m.groupCenter = b.min.map((n, i) => (n + b.max[i]) / 2);
  }
  return {
    meshes,
    center,
    span,
    bounds: { min, max },
    triangleCount: scene.triangles.length,
  };
}

export class OrbitCamera {
  constructor() {
    this.reset();
  }
  reset() {
    this.yaw = 0.7;
    this.pitch = 0.32;
    this.distance = 4.2;
    this.pan = [0, 0];
  }
  orbit(dx, dy) {
    this.yaw -= dx * 0.008;
    this.pitch = clamp(
      this.pitch + dy * 0.008,
      -Math.PI / 2 + 0.001,
      Math.PI / 2 - 0.001,
    );
  }
  zoom(delta) {
    this.distance = clamp(this.distance * Math.exp(delta * 0.001), 0.25, 40);
  }
  move(dx, dy, height) {
    const unit = (this.distance * 0.8) / Math.max(height, 1);
    this.pan[0] -= dx * unit;
    this.pan[1] += dy * unit;
  }
  view(name) {
    const views = {
      iso: [0.7, 0.32],
      front: [0, 0],
      back: [Math.PI, 0],
      right: [Math.PI / 2, 0],
      left: [-Math.PI / 2, 0],
      top: [0, Math.PI / 2 - 0.001],
      bottom: [0, -Math.PI / 2 + 0.001],
    };
    if (views[name]) [this.yaw, this.pitch] = views[name];
    this.pan = [0, 0];
  }
  matrices(aspect) {
    const cp = Math.cos(this.pitch),
      eye = [
        this.distance * cp * Math.sin(this.yaw),
        this.distance * Math.sin(this.pitch),
        this.distance * cp * Math.cos(this.yaw),
      ];
    const z = unit(eye),
      x = unit(cross([0, 1, 0], z)),
      y = cross(z, x);
    const target = x.map((n, i) => n * this.pan[0] + y[i] * this.pan[1]),
      pos = eye.map((n, i) => n + target[i]);
    const view = new Float32Array([
      x[0],
      y[0],
      z[0],
      0,
      x[1],
      y[1],
      z[1],
      0,
      x[2],
      y[2],
      z[2],
      0,
      -dot(x, pos),
      -dot(y, pos),
      -dot(z, pos),
      1,
    ]);
    const f = 1 / Math.tan(Math.PI / 8),
      near = 0.005,
      far = 100;
    const projection = new Float32Array([
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (far + near) / (near - far),
      -1,
      0,
      0,
      (2 * far * near) / (near - far),
      0,
    ]);
    return { view, projection };
  }
}

const vertexShader = `
attribute vec3 aPosition; attribute vec3 aNormal;
uniform mat4 uView; uniform mat4 uProjection; uniform vec3 uOffset;
varying vec3 vNormal;
void main(){vNormal=aNormal;gl_Position=uProjection*uView*vec4(aPosition+uOffset,1.0);}`;
const fragmentShader = `
precision mediump float; varying vec3 vNormal; uniform vec3 uColor;
void main(){vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;
float light=.44+.40*max(dot(n,normalize(vec3(.4,.8,1.))),0.)+.16*max(dot(n,normalize(vec3(-.7,.2,-.6))),0.);
gl_FragColor=vec4(uColor*light,1.0);}`;

export class SolidViewer {
  constructor(canvas, { onError = () => {}, onChange = () => {} } = {}) {
    this.canvas = canvas;
    this.onError = onError;
    this.onChange = onChange;
    this.camera = new OrbitCamera();
    this.hidden = new Set();
    this.colors = new Map();
    this.explode = 0;
    this.selected = "";
    this.scene = null;
    this.meshes = [];
    this.pending = 0;
    this.disposed = false;
    this.listeners = [];
    const gl = canvas.getContext("webgl", {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl)
      throw Error(
        "Solid preview is unavailable in this browser. Use wireframe view.",
      );
    this.gl = gl;
    const shader = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw Error(message);
      }
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, vertexShader),
      fs = shader(gl.FRAGMENT_SHADER, fragmentShader),
      p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw Error(gl.getProgramInfoLog(p));
    this.program = p;
    this.attributes = {
      position: gl.getAttribLocation(p, "aPosition"),
      normal: gl.getAttribLocation(p, "aNormal"),
    };
    this.uniforms = Object.fromEntries(
      ["uView", "uProjection", "uOffset", "uColor"].map((k) => [
        k,
        gl.getUniformLocation(p, k),
      ]),
    );
    const listen = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this.listeners.push(() => el.removeEventListener(type, fn, opts));
    };
    const pointers = new Map();
    let pinch = null;
    listen(canvas, "pointerdown", (e) => {
      canvas.focus({ preventScroll: true });
      pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        pan: e.shiftKey || e.button === 1 || e.button === 2,
      });
      canvas.setPointerCapture?.(e.pointerId);
      if (pointers.size === 2) pinch = [...pointers.values()];
      e.preventDefault();
    });
    listen(canvas, "pointermove", (e) => {
      const previous = pointers.get(e.pointerId);
      if (!previous) return;
      pointers.set(e.pointerId, { ...previous, x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const next = [...pointers.values()];
        if (pinch) {
          const before = Math.hypot(
              pinch[0].x - pinch[1].x,
              pinch[0].y - pinch[1].y,
            ),
            after = Math.hypot(next[0].x - next[1].x, next[0].y - next[1].y);
          if (before > 0 && after > 0)
            this.camera.zoom(Math.log(before / after) * 1000);
          this.camera.move(
            (next[0].x + next[1].x - pinch[0].x - pinch[1].x) / 2,
            (next[0].y + next[1].y - pinch[0].y - pinch[1].y) / 2,
            canvas.clientHeight,
          );
        }
        pinch = next;
      } else if (previous.pan || e.shiftKey)
        this.camera.move(
          e.clientX - previous.x,
          e.clientY - previous.y,
          canvas.clientHeight,
        );
      else this.camera.orbit(e.clientX - previous.x, e.clientY - previous.y);
      this.invalidate();
      e.preventDefault();
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      pinch = null;
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      listen(canvas, type, release);
    listen(canvas, "contextmenu", (e) => e.preventDefault());
    listen(
      canvas,
      "wheel",
      (e) => {
        this.camera.zoom(
          e.deltaY *
            (e.deltaMode === 1
              ? 16
              : e.deltaMode === 2
                ? canvas.clientHeight
                : 1),
        );
        this.invalidate();
        e.preventDefault();
      },
      { passive: false },
    );
    listen(canvas, "keydown", (e) => {
      let handled = true;
      switch (e.key) {
        case "ArrowLeft":
          this.camera.orbit(-18, 0);
          break;
        case "ArrowRight":
          this.camera.orbit(18, 0);
          break;
        case "ArrowUp":
          this.camera.orbit(0, -18);
          break;
        case "ArrowDown":
          this.camera.orbit(0, 18);
          break;
        case "+":
        case "=":
          this.camera.zoom(-120);
          break;
        case "-":
          this.camera.zoom(120);
          break;
        case "Home":
        case "0":
          this.camera.reset();
          break;
        case "1":
          this.camera.view("iso");
          break;
        case "2":
          this.camera.view("front");
          break;
        case "3":
          this.camera.view("right");
          break;
        case "4":
          this.camera.view("top");
          break;
        case "5":
          this.camera.view("bottom");
          break;
        default:
          handled = false;
      }
      if (handled) {
        this.invalidate();
        e.preventDefault();
      }
    });
    listen(canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.pending);
      this.pending = 0;
      this.onError(
        "Graphics context lost. Use wireframe view or retry solid preview.",
      );
    });
    listen(canvas, "webglcontextrestored", () =>
      this.onError(
        "Graphics recovered. Retry solid preview to rebuild the view.",
      ),
    );
    this.resize =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => this.invalidate())
        : null;
    this.resize?.observe(canvas);
    this.invalidate();
  }
  setScene(scene, selected = "") {
    this.selected = selected;
    if (scene === this.scene) {
      this.invalidate();
      return;
    }
    this.scene = scene;
    this.deleteMeshes();
    this.prepared = prepareScene(scene);
    this.hidden.clear();
    if (this.prepared) {
      const gl = this.gl;
      this.meshes = this.prepared.meshes.map((m) => {
        const buffer = (data) => {
          const b = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, b);
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          return b;
        };
        return {
          ...m,
          positionBuffer: buffer(m.positions),
          normalBuffer: buffer(m.normals),
        };
      });
    }
    this.camera.reset();
    this.invalidate();
  }
  deleteMeshes() {
    for (const m of this.meshes) {
      this.gl.deleteBuffer(m.positionBuffer);
      this.gl.deleteBuffer(m.normalBuffer);
    }
    this.meshes = [];
  }
  setVisibility(ids, visible) {
    for (const id of ids) {
      if (visible) this.hidden.delete(id);
      else this.hidden.add(id);
    }
    this.invalidate();
  }
  setColor(name, color) {
    if (/^#[0-9a-f]{6}$/i.test(color)) this.colors.set(name, color);
    this.invalidate();
  }
  setExplode(value) {
    this.explode = clamp(Number(value) || 0, 0, 1);
    this.invalidate();
  }
  view(name) {
    if (name === "fit") this.camera.reset();
    else this.camera.view(name);
    this.invalidate();
  }
  invalidate() {
    if (this.disposed || this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.draw();
      this.onChange();
    });
  }
  draw() {
    const gl = this.gl,
      c = this.canvas,
      dpr = Math.min(globalThis.devicePixelRatio || 1, 2),
      w = Math.max(1, Math.round(c.clientWidth * dpr)),
      h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.046, 0.063, 0.083, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.prepared) return;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program);
    const { view, projection } = this.camera.matrices(w / h);
    gl.uniformMatrix4fv(this.uniforms.uView, false, view);
    gl.uniformMatrix4fv(this.uniforms.uProjection, false, projection);
    const selectedName = this.meshes.find((m) => m.id === this.selected)?.name;
    for (const m of this.meshes) {
      if (this.hidden.has(m.id)) continue;
      for (const [attribute, buffer] of [
        [this.attributes.position, m.positionBuffer],
        [this.attributes.normal, m.normalBuffer],
      ]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 0, 0);
      }
      const offset = m.groupCenter.map((n) => n * this.explode * 0.8);
      gl.uniform3fv(this.uniforms.uOffset, offset);
      const color = this.colors.get(m.name) || m.color;
      let rgb = colorRgb(color);
      if (m.name === selectedName)
        rgb = rgb.map((n) => Math.min(1, n * 1.12 + 0.05));
      gl.uniform3fv(this.uniforms.uColor, rgb);
      gl.drawArrays(gl.TRIANGLES, 0, m.positions.length / 3);
    }
    c.dataset.yaw = this.camera.yaw.toFixed(4);
    c.dataset.pitch = this.camera.pitch.toFixed(4);
    c.dataset.distance = this.camera.distance.toFixed(4);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.pending);
    this.resize?.disconnect();
    this.listeners.forEach((fn) => fn());
    this.deleteMeshes();
    this.gl.deleteProgram(this.program);
  }
}
