// Right-handed source/world rotations, applied X then Y then Z.
// Shared with placement composition so arrangement edits keep the same convention.
export function rotateReferencePoint(point, rotationDeg) {
  const angles = rotationDeg.map(n => (n % 360) * Math.PI / 180);
  let [x, y, z] = point;
  let c = Math.cos(angles[0]), s = Math.sin(angles[0]);
  [y, z] = [y*c-z*s, y*s+z*c];
  c = Math.cos(angles[1]); s = Math.sin(angles[1]);
  [x, z] = [x*c+z*s, -x*s+z*c];
  c = Math.cos(angles[2]); s = Math.sin(angles[2]);
  return [x*c-y*s, x*s+y*c, z];
}

// Equivalent Euler angles for R(delta) R(existing), not component-wise addition.
export function composeReferenceRotations(existing, delta) {
  const columns = [[1,0,0], [0,1,0], [0,0,1]].map(p => rotateReferencePoint(rotateReferencePoint(p, existing), delta));
  const m = [0,1,2].map(i => columns.map(p => p[i]));
  const horizontal = Math.hypot(m[0][0], m[1][0]);
  const y = Math.atan2(-m[2][0], horizontal);
  const z = horizontal > 4 * Number.EPSILON ? Math.atan2(m[1][0], m[0][0]) : 0;
  // Recover X after removing the chosen Z. Unlike atan2(m21, m22),
  // this uses order-one matrix entries near ±90° Y and keeps X/Z coupled.
  const c = Math.cos(z), s = Math.sin(z);
  const x = Math.atan2(s*m[0][2]-c*m[1][2], c*m[1][1]-s*m[0][1]);
  return [x,y,z].map(n => n === 0 ? 0 : n * 180 / Math.PI);
}
