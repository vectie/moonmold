// Exact historical shapes: types.mbt ValidationFinding/ValidationEvidence;
// adapter_runtime/runtime.mbt spatial_receipt_from_execution/result_for_receipt;
// delivery.mjs report construction and delivery-geometry.mjs primitive records.
// All schemas are closed recursively. No coercion and no unknown fields.
const string = (v) => typeof v === "string";
const boolean = (v) => typeof v === "boolean";
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const integer = (v) => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
const count = (v) => integer(v) && v >= 0;
const positive = (v) => integer(v) && v > 0;
const literal = (...values) => (v) => values.includes(v);
const pattern = (re) => (v) => string(v) && re.test(v);
const id = pattern(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const digest = pattern(/^sha256:[a-f0-9]{64}$/);
const packageId = pattern(/^delivery-[a-f0-9]{64}$/);
const nullable = (check) => (v) => v === null || check(v);
const array = (check) => (v) => Array.isArray(v) && v.every(check);
const record = (fields) => (v) => v !== null && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).length === Object.keys(fields).length &&
  Object.entries(fields).every(([key, check]) => Object.hasOwn(v, key) && check(v[key]));
const backend = record({ mode: literal("deterministic-mock-reference"), evidence_class: literal("fixture-reference-only"), blender_evidence: literal(false), production_qualified: literal(false) });
const qualification = record({ selected_backend: literal("deterministic-mock-reference"), evidence_class: literal("fixture-reference-only"), production_qualified: literal(false), blender_evidence: literal(false), physical_authority: literal(false) });
const finding = record({ code: string, severity: literal("Info", "Warning", "Error"), message: string, criterion: string });
const evidence = record({ validator: string, validator_version: string, subject_digest: string, accepted: boolean, findings: array(finding) });
const receipt = record({
  contract_id: literal("moonmold.spatial-operation-receipt.v1"), operation_ref: literal("moonmold/spatial.operation.execute@0.2.0"),
  request_id: string, source_request_id: string, attempt_id: id, idempotency_key: string,
  outcome: literal("applied"), before_digest: string, after_digest: string, claim_ceiling: literal("digital-artifact"),
  physical_authority: literal(false), artifacts: array(string), changed_objects: array(string), warnings: array(string),
  validation_evidence: evidence, backend_qualification: qualification, review_required: boolean,
  reconciliation: record({ supported: literal(true), state: literal("terminal") }),
});
const result = record({
  result_id: string, request_id: string, attempt_id: id, idempotency_key: string, product_id: literal("moonmold"),
  external_job_id: string, status: literal("succeeded"), output_digest: digest, output_artifacts: array(string),
  error_kind: string, compensable: boolean, recorded_at: string,
});
const primitiveFields = {
  object_id: id, translation_mm: record({ x: integer, y: integer, z: integer }), material_id: nullable(id),
};
const box = record({ ...primitiveFields, kind: literal("box"), dimensions_mm: record({ width: positive, depth: positive, height: positive }) });
const sides = (v) => integer(v) && v >= 8 && v <= 256;
const cylinder = record({ ...primitiveFields, kind: literal("cylinder"), dimensions_mm: record({ radius: positive, height: positive }), sides });
const primitive = (v) => box(v) || cylinder(v);
const changed = (v) => record({ object_id: id, before: primitive, after: primitive })(v) && v.before.object_id === v.object_id && v.after.object_id === v.object_id;
const change = (v) => record({
  contract_id: literal("moonmold.digital-change-report.v1"), previous_package_id: nullable(packageId), previous_source_digest: nullable(digest),
  added: array(id), removed: array(id), changed: array(changed), review_required_for_this_revision: literal(true),
  prior_files_and_reviews_preserved: literal(true), physical_authority: literal(false),
})(v) && (v.previous_package_id === null) === (v.previous_source_digest === null);
const tessellation = (v) => record({
  object_id: id, radius_mm: positive, height_mm: positive, sides, vertex_count: positive, face_count: positive,
  cap_topology: literal("two-ngons"), side_topology: literal("quads"), axis: literal("+Z"), phase: literal("+X, counterclockwise viewed from +Z"),
  max_radial_deviation_mm: (n) => finite(n) && n >= 0, physical_tolerance_qualified: literal(false),
})(v) && v.vertex_count === v.sides * 2 && v.face_count === v.sides + 2;
const lossFields = {
  contract_id: literal("moonmold.representation-loss-report.v1"), source_digest: digest, backend, physical_authority: literal(false),
  representation: literal("presentation"), lineage_relation: literal("styled-from"), units: literal("mm", "cm", "m"),
  coordinate_frame: literal("z-up-right-handed"), conversion: string, known_losses: array(string),
};
const loss = (v) => record(lossFields)(v) || record({ ...lossFields, cylinder_tessellation: array(tessellation) })(v);
const triple = (v) => array(finite)(v) && v.length === 3;
const bounds = (v) => record({ min: triple, max: triple, units: literal("mm"), coordinate_frame: literal("z-up-right-handed") })(v) && v.min.every((n, i) => n <= v.max[i]);
const validationFields = {
  contract_id: literal("moonmold.digital-delivery-validation.v1"), source_digest: digest, checked: array(string), bounds_mm: bounds,
  box_count: count, constraints_pending_human_review: array(string), review_criteria_pending_human_review: array(string),
  adapter_receipt: receipt, adapter_result: result, backend, physical_authority: literal(false),
};
const validation = (v) => record(validationFields)(v) ||
  (record({ ...validationFields, cylinder_count: count, object_count: count, bounds_scope: string })(v) && v.object_count === v.box_count + v.cylinder_count);

export function supportedDeliveryReport(name, value, manifest) {
  if (name === "change-report.json") return change(value);
  if (name === "loss-report.json") return loss(value) && value.source_digest === manifest.source_digest;
  if (name !== "validation.json" || !validation(value)) return false;
  const r = value.adapter_receipt, output = value.adapter_result;
  return value.source_digest === manifest.source_digest && r.attempt_id === manifest.attempt_id && output.attempt_id === manifest.attempt_id &&
    output.output_digest === manifest.receipt_digest && output.request_id === r.request_id && output.idempotency_key === r.idempotency_key;
}
