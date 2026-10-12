import { AdapterRejection } from "./protocol.mjs";

const reject = message => { throw new AdapterRejection("invalid-reference-mesh", message); };
const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// STL has triangle coordinates, not indexed topology. Share exactly equal points
// only; never tolerance-weld, repair winding, infer units or trust stored normals.
export function parseReferenceStl(bytes, factor) {
  const vertices = [], triangles = [], indices = new Map();
  const losses = new Set(["facet normals (recomputed from winding)"]);
  function facet(points, location) {
    const scaled = points.map(p => p.map(n => n * factor));
    if (scaled.some(p => p.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9))) reject(`${location}: invalid or out-of-range STL coordinate`);
    const [a, b, c] = scaled, u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
    if (Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) === 0) reject(`${location}: degenerate STL triangle`);
    triangles.push(scaled.map(point => {
      const key = point.join(",");
      if (!indices.has(key)) { indices.set(key, vertices.length); vertices.push(point); }
      return indices.get(key);
    }));
  }

  // An exact binary size/count match wins even when the 80-byte header begins
  // with "solid", which is legal and common in binary exporters.
  const count = bytes.length >= 84 ? bytes.readUInt32LE(80) : 0;
  let encoding;
  if (bytes.length >= 84 && bytes.length === 84 + count * 50) {
    encoding = "binary";
    losses.add("binary header");
    for (let i = 0; i < count; i++) {
      const offset = 84 + i * 50;
      const points = [0, 1, 2].map(p => [0, 1, 2].map(axis => bytes.readFloatLE(offset + 12 + p * 12 + axis * 4)));
      facet(points, `Facet ${i + 1}`);
      if (bytes.readUInt16LE(offset + 48)) losses.add("binary facet attributes (including possible colors)");
    }
  } else {
    encoding = "ascii";
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    if (!/^\s*solid(?:\s|$)/.test(text) || /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) reject("STL must be ASCII text or binary with an exact 84 + 50 × triangle count byte length");
    const lines = text.split(/\r?\n/).map((raw, i) => ({ text: raw.trim(), line: i + 1 })).filter(row => row.text);
    let cursor = 0;
    function take(pattern, label) {
      const row = lines[cursor++];
      const match = row?.text.match(pattern);
      if (!match) reject(`Line ${row?.line ?? lines.at(-1)?.line ?? 1}: expected ${label}`);
      return { row, match };
    }
    function vector(prefix) {
      const { row, match } = take(new RegExp(`^${prefix}\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)$`), `${prefix} with three numbers`);
      const values = match.slice(1);
      if (values.some(value => !number.test(value) || !Number.isFinite(Number(value)))) reject(`Line ${row.line}: invalid STL number`);
      return values.map(Number);
    }
    const opening = take(/^solid(?:\s+(.*))?$/, "solid").match[1] ?? "";
    losses.add("solid name");
    while (lines[cursor]?.text.startsWith("facet")) {
      const line = lines[cursor].line;
      vector("facet\\s+normal");
      take(/^outer\s+loop$/, "outer loop");
      const points = [vector("vertex"), vector("vertex"), vector("vertex")];
      take(/^endloop$/, "endloop");
      take(/^endfacet$/, "endfacet");
      facet(points, `Line ${line}`);
    }
    const closing = take(/^endsolid(?:\s+(.*))?$/, "endsolid").match[1] ?? "";
    if (closing && closing !== opening) reject("STL solid and endsolid names must match when an endsolid name is supplied");
    if (cursor !== lines.length) reject(`Line ${lines[cursor].line}: only one ASCII STL solid is supported`);
  }
  if (!triangles.length) reject("STL requires at least one triangle");
  return { vertices, triangles, encoding, losses: [...losses].sort() };
}
