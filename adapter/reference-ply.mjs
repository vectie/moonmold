import { AdapterRejection } from "./protocol.mjs";

const reject = message => { throw new AdapterRejection("invalid-reference-mesh", message); };
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const integers = { char: [-128, 127], int8: [-128, 127], uchar: [0, 255], uint8: [0, 255], short: [-32768, 32767], int16: [-32768, 32767], ushort: [0, 65535], uint16: [0, 65535], int: [-2147483648, 2147483647], int32: [-2147483648, 2147483647], uint: [0, 4294967295], uint32: [0, 4294967295] };
const integerType = type => Object.hasOwn(integers, type);
const scalarType = type => integerType(type) || ["float", "float32", "double", "float64"].includes(type);
const normals = ["nx", "ny", "nz"], colors = ["red", "green", "blue", "alpha"];
const readers = {
  char: [1, "readInt8"], int8: [1, "readInt8"], uchar: [1, "readUInt8"], uint8: [1, "readUInt8"],
  short: [2, "readInt16"], int16: [2, "readInt16"], ushort: [2, "readUInt16"], uint16: [2, "readUInt16"],
  int: [4, "readInt32"], int32: [4, "readInt32"], uint: [4, "readUInt32"], uint32: [4, "readUInt32"],
  float: [4, "readFloat"], float32: [4, "readFloat"], double: [8, "readDouble"], float64: [8, "readDouble"],
};

// Bounded PLY 1.0 indexed triangles, XYZ and optional normal/color scalars.
// The header controls byte order and widths; no body text decoding, padding,
// triangulation, unit inference, welding or external fetching is performed.
export function parseReferencePly(input, factor) {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  if (!Buffer.isBuffer(bytes) || bytes.length > 400_000) reject("PLY input must be at most 400000 bytes");
  let offset = 0, lineNumber = 0;
  function headerLine() {
    const end = bytes.indexOf(10, offset);
    if (end < 0) reject("PLY requires a complete LF or CRLF terminated header");
    const raw = bytes.subarray(offset, end).toString("latin1");
    if (/[^\x09\x0d\x20-\x7e]/.test(raw)) reject("PLY header must be ASCII text");
    offset = end + 1; lineNumber++;
    return raw.trim();
  }
  if (headerLine() !== "ply") reject("PLY requires a ply header line");
  const format = /^format (ascii|binary_little_endian|binary_big_endian) 1\.0$/.exec(headerLine());
  if (!format) reject("PLY requires format ascii, binary_little_endian or binary_big_endian 1.0");
  const encoding = format[1];
  const elements = [], losses = new Set();
  let element, ended = false;
  while (offset < bytes.length) {
    const line = headerLine(), fields = line.split(/\s+/);
    if (line === "end_header") { ended = true; break; }
    if (["comment", "obj_info"].includes(fields[0])) { losses.add("PLY comments and object information"); continue; }
    if (fields[0] === "element") {
      if (fields.length !== 3 || !["vertex", "face"].includes(fields[1]) || !/^[1-9]\d*$/.test(fields[2]) || Number(fields[2]) > 40000) reject("PLY supports only nonempty vertex and face elements, at most 40000 records each");
      if (fields[1] !== ["vertex", "face"][elements.length]) reject("PLY requires one vertex element followed by one face element");
      element = { name: fields[1], count: Number(fields[2]), properties: [] }; elements.push(element);
    } else if (fields[0] === "property" && element) {
      let property;
      if (fields[1] === "list") {
        if (element.name !== "face" || fields.length !== 5 || !integerType(fields[2]) || !integerType(fields[3]) || !["vertex_indices", "vertex_index"].includes(fields[4])) reject("PLY supports only an integer face vertex_indices list");
        property = { name: "vertex_indices", countType: fields[2], type: fields[3], list: true };
      } else {
        if (fields.length !== 3 || !scalarType(fields[1])) reject("Unsupported PLY scalar property type");
        const name = fields[2];
        if (!(element.name === "vertex" && ["x", "y", "z"].includes(name)) && !normals.includes(name) && !colors.includes(name)) reject(`Unsupported PLY ${element.name} property: ${name}`);
        property = { name, type: fields[1] };
        if (normals.includes(name)) losses.add(`${element.name} normals (recomputed from winding for STL)`);
        if (colors.includes(name)) losses.add(`${element.name} colors`);
      }
      if (element.properties.some(p => p.name === property.name)) reject("Duplicate PLY property");
      element.properties.push(property);
    } else reject(`Unsupported PLY header at line ${lineNumber}`);
  }
  if (!ended || elements.length !== 2 || !["x", "y", "z"].every(name => elements[0].properties.some(p => p.name === name)) || !elements[1].properties.some(p => p.list)) reject("PLY requires a complete header with XYZ vertices and face vertex_indices");
  let lines, cursor = 0;
  if (encoding === "ascii") {
    const body = bytes.subarray(offset).toString("latin1");
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(body)) reject("ASCII PLY body must be ASCII text");
    lines = body.split(/\r?\n/);
  }
  function asciiValue(token, type, label) {
    const n = Number(token);
    if (!numeric.test(token ?? "") || !Number.isFinite(n)) reject(`${label}: invalid PLY number`);
    if (integerType(type) && (!/^[+-]?\d+$/.test(token) || n < integers[type][0] || n > integers[type][1])) reject(`${label}: invalid PLY integer`);
    if (["float", "float32"].includes(type) && !Number.isFinite(Math.fround(n))) reject(`${label}: PLY float out of range`);
    return n;
  }
  function binaryValue(type, label) {
    const [width, method] = readers[type];
    if (offset + width > bytes.length) reject(`${label}: truncated binary PLY ${type} at byte ${offset}`);
    const suffix = width === 1 ? "" : encoding === "binary_little_endian" ? "LE" : "BE";
    const value = bytes[method + suffix](offset); offset += width;
    if (!Number.isFinite(value)) reject(`${label}: nonfinite binary PLY ${type}`);
    return value;
  }
  const vertices = [], triangles = [];
  for (const item of elements) {
    for (let i = 0; i < item.count; i++) {
      const label = `${item.name} ${i + 1}`;
      let fields, fieldOffset = 0;
      if (lines) {
        const row = lines[cursor++]?.trim();
        if (!row) reject(`${label}: missing PLY record`);
        fields = row.split(/\s+/);
      }
      const value = type => fields ? asciiValue(fields[fieldOffset++], type, label) : binaryValue(type, label);
      const values = {};
      for (const property of item.properties) {
        if (property.list) {
          if (value(property.countType) !== 3) reject(`${label}: only triangular PLY faces are supported`);
          values.vertex_indices = [0, 1, 2].map(() => value(property.type));
        } else values[property.name] = value(property.type);
      }
      if (fields && fieldOffset !== fields.length) reject(`${label}: extra PLY fields`);
      if (item.name === "vertex") {
        const point = ["x", "y", "z"].map(axis => values[axis] * factor);
        if (point.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) reject(`${label}: coordinate exceeds reference range`);
        vertices.push(point);
      } else {
        const face = values.vertex_indices;
        if (face.some(n => n < 0 || n >= vertices.length) || new Set(face).size !== 3) reject(`${label}: invalid PLY vertex index`);
        const [a, b, c] = face.map(index => vertices[index]), u = b.map((n, j) => n - a[j]), v = c.map((n, j) => n - a[j]);
        if (Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) === 0) reject(`${label}: degenerate PLY triangle`);
        triangles.push(face);
      }
    }
  }
  if (lines ? lines.slice(cursor).some(line => line.trim()) : offset !== bytes.length) reject("Trailing PLY records or bytes are unsupported");
  return { vertices, triangles, encoding, losses: [...losses].sort() };
}
