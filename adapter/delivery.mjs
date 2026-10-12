import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AdapterRejection, canonicalJson } from "./protocol.mjs";
import { DELIVERY_BACKEND, modelBounds, primaryDimensions, reconstructModel, renderObj, renderSvg } from "./delivery-geometry.mjs";
import { readableDeliveryReports } from "./delivery-reader.mjs";

const ROOT = ".moonsuite/products/moonmold";
const JOURNAL = `${ROOT}/runtime/semantic-journal.json`;
const REQUIRED_FILES = ["brief.json", "editable-source.json", "presentation.obj", "preview.svg", "loss-report.json", "change-report.json", "validation.json", "README.txt"];
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;
const reject = (code, message) => { throw new AdapterRejection(code, message); };

function exact(value, keys, label) {
  if (!value || Array.isArray(value) || typeof value !== "object" ||
      Object.keys(value).some((key) => !keys.includes(key)) ||
      keys.some((key) => !(key in value))) reject("invalid-delivery-request", `${label} must have exactly: ${keys.join(", ")}`);
}

function identity(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

function text(value) { return typeof value === "string" && value.trim().length > 0; }

async function readJson(workspace, reference, absent = false) {
  try { return JSON.parse(await readFile(path.join(workspace, reference), "utf8")); }
  catch (error) { if (absent && error.code === "ENOENT") return null; throw error; }
}

async function immutable(workspace, reference, bytes) {
  const filename = path.join(workspace, reference);
  await mkdir(path.dirname(filename), { recursive: true });
  try { await writeFile(filename, bytes, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST" || !Buffer.from(await readFile(filename)).equals(Buffer.from(bytes))) {
      reject("immutable-output-conflict", `The retained delivery file ${reference} differs; use a new revision`);
    }
  }
}

function assertBrief(brief) {
  exact(brief, ["contract_id", "commitment_ref", "revision", "project_id", "model_id", "intended_use", "units", "coordinate_frame", "dimensions_mm", "constraints", "deliverables", "review_criteria", "physical_authority"], "digital brief");
  exact(brief.dimensions_mm, ["width", "depth", "height"], "dimensions_mm");
  if (brief.contract_id !== "moonmold.digital-brief.v1" ||
      !identity(brief.commitment_ref) || !identity(brief.project_id) || !identity(brief.model_id) ||
      !Number.isSafeInteger(brief.revision) || brief.revision < 1 ||
      !text(brief.intended_use) || !["mm", "cm", "m"].includes(brief.units) ||
      brief.coordinate_frame !== "z-up-right-handed" || brief.physical_authority !== false ||
      Object.values(brief.dimensions_mm).some((value) => !Number.isSafeInteger(value) || value <= 0) ||
      !Array.isArray(brief.constraints) || !brief.constraints.every(text) ||
      !Array.isArray(brief.review_criteria) || !brief.review_criteria.length || !brief.review_criteria.every(text) ||
      canonicalJson(brief.deliverables) !== canonicalJson(["editable-source", "presentation"])) {
    reject("invalid-digital-brief", "Use a digital-only brief with positive integer primary-mass dimensions in mm (cylinder width/depth = nominal diameter), declared units, z-up-right-handed frame, editable-source + presentation, and named review criteria");
  }
}

function briefReference(brief) {
  const key = sha(`${brief.project_id}|${brief.model_id}|${brief.commitment_ref}`).slice(7);
  return `${ROOT}/briefs/${key}-r${brief.revision}.json`;
}

async function loadBrief(workspace, reference) {
  if (typeof reference !== "string" || !new RegExp(`^${ROOT.replaceAll(".", "\\.")}/briefs/[a-f0-9]{64}-r[1-9][0-9]*\\.json$`).test(reference)) {
    reject("invalid-brief-reference", "Select an exact frozen delivery brief");
  }
  const bytes = await readFile(path.join(workspace, reference));
  const record = JSON.parse(bytes);
  assertBrief(record.brief);
  if (record.contract_id !== "moonmold.frozen-digital-brief.v1" || reference !== briefReference(record.brief) ||
      !Number.isSafeInteger(record.journal_prefix_length) || record.journal_prefix_length < 0 ||
      typeof record.journal_prefix_digest !== "string") reject("invalid-brief-reference", "Frozen brief record is invalid");
  return { record, digest: sha(bytes), reference };
}

export async function freezeDeliveryBrief(workspace, body) {
  exact(body, ["brief"], "freeze brief");
  assertBrief(body.brief);
  const reference = briefReference(body.brief);
  const existing = await readJson(workspace, reference, true);
  if (existing) {
    if (canonicalJson(existing.brief) !== canonicalJson(body.brief)) reject("immutable-output-conflict", "This commitment revision is already frozen; increment revision for changed dimensions or criteria");
  } else {
    const journal = await readJson(workspace, JOURNAL, true) ?? [];
    await immutable(workspace, reference, jsonText({
      contract_id: "moonmold.frozen-digital-brief.v1", brief: body.brief,
      frozen_at: new Date().toISOString(),
      journal_prefix_length: journal.length, journal_prefix_digest: sha(canonicalJson(journal)),
      physical_authority: false,
    }));
  }
  const loaded = await loadBrief(workspace, reference);
  return { reference, digest: loaded.digest, brief: loaded.record.brief };
}

function packageRoot(packageId) {
  if (typeof packageId !== "string" || !/^delivery-[a-f0-9]{64}$/.test(packageId)) reject("invalid-delivery-id", "Select an exact delivery package");
  return `${ROOT}/deliveries/${packageId}`;
}

export async function verifiedDelivery(workspace, packageId) {
  const root = packageRoot(packageId);
  const bytes = await readFile(path.join(workspace, `${root}/manifest.json`));
  const manifest = JSON.parse(bytes);
  if (manifest.contract_id !== "moonmold.digital-delivery.v1" || manifest.package_id !== packageId ||
      manifest.physical_authority !== false || !Array.isArray(manifest.files) ||
      manifest.files.length !== REQUIRED_FILES.length ||
      REQUIRED_FILES.some((name) => manifest.files.filter((file) => file.name === name).length !== 1)) {
    reject("incomplete-delivery", "Delivery must retain editable source, presentation files, brief, validation, loss and change reports");
  }
  const files = [];
  for (const file of manifest.files) {
    let content;
    try { content = await readFile(path.join(workspace, root, file.name)); }
    catch (error) {
      if (error.code === "ENOENT") reject("incomplete-delivery", `Required delivery file is missing: ${file.name}`);
      throw error;
    }
    if (sha(content) !== file.sha256 || content.length !== file.bytes) reject("delivery-integrity", `Delivery file no longer matches the manifest: ${file.name}`);
    files.push({ ...file, text: content.toString("utf8") });
  }
  const { package_id: ignoredId, ...base } = manifest;
  void ignoredId;
  if (manifest.source_digest !== files.find((file) => file.name === "editable-source.json").sha256 ||
      manifest.brief_digest !== files.find((file) => file.name === "brief.json").sha256 ||
      packageId !== `delivery-${sha(canonicalJson(base)).slice(7)}`) {
    reject("delivery-integrity", "Delivery identity does not bind the exact source and manifest");
  }
  return { manifest, manifest_digest: sha(bytes), files };
}

async function packageIds(workspace) {
  try { return (await readdir(path.join(workspace, ROOT, "deliveries"))).filter((id) => /^delivery-[a-f0-9]{64}$/.test(id)).sort(); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function previousDelivery(workspace, brief) {
  const candidates = [];
  for (const id of await packageIds(workspace)) {
    const delivery = await verifiedDelivery(workspace, id);
    if (delivery.manifest.project_id === brief.project_id && delivery.manifest.model_id === brief.model_id &&
        delivery.manifest.commitment_ref === brief.commitment_ref && delivery.manifest.brief_revision < brief.revision) candidates.push(delivery);
  }
  candidates.sort((a, b) => b.manifest.brief_revision - a.manifest.brief_revision || b.manifest.journal_index - a.manifest.journal_index);
  return candidates[0] ?? null;
}

function changeReport(previous, source) {
  const priorSource = previous ? JSON.parse(previous.files.find((file) => file.name === "editable-source.json").text) : null;
  const before = new Map((priorSource?.model.objects ?? []).map((object) => [object.object_id, object]));
  const after = new Map(source.model.objects.map((object) => [object.object_id, object]));
  return {
    contract_id: "moonmold.digital-change-report.v1",
    previous_package_id: previous?.manifest.package_id ?? null,
    previous_source_digest: previous?.manifest.source_digest ?? null,
    added: [...after.keys()].filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
    changed: [...after.keys()].filter((id) => before.has(id) && canonicalJson(before.get(id)) !== canonicalJson(after.get(id)))
      .map((id) => ({ object_id: id, before: before.get(id), after: after.get(id) })),
    review_required_for_this_revision: true,
    prior_files_and_reviews_preserved: true, physical_authority: false,
  };
}

export async function buildDelivery(workspace, body, loadRun) {
  exact(body, ["attempt_id", "brief_ref"], "build delivery");
  if (!identity(body.attempt_id)) reject("invalid-delivery-request", "Select a durable execution attempt");
  const selected = await loadRun(body.attempt_id);
  if (!selected || selected.request.operation.method !== "representation.export" ||
      selected.request.operation.params.representation !== "presentation" ||
      selected.flow_request.operation !== "spatial.operation.execute" || selected.receipt.outcome !== "applied") {
    reject("delivery-export-required", "Execute a fresh presentation export before preparing its downloadable model package; a replayed no-op export cannot bind later geometry");
  }
  const { record, digest: briefDigest } = await loadBrief(workspace, body.brief_ref);
  const brief = record.brief;
  if (selected.request.project_id !== brief.project_id || selected.request.model_id !== brief.model_id) reject("brief-model-mismatch", "Selected export belongs to another brief model");
  const journal = await readJson(workspace, JOURNAL);
  const index = journal.findIndex((entry) => entry.flow_request.attempt_id === body.attempt_id);
  if (index < 0 || record.journal_prefix_length > index ||
      sha(canonicalJson(journal.slice(0, record.journal_prefix_length))) !== record.journal_prefix_digest) {
    reject("brief-not-frozen-before-work", "Freeze the brief before its design change and export; earlier outputs cannot be retrospectively bound");
  }
  const entries = journal.slice(0, index + 1).filter((entry) => entry.spatial_request.project_id === brief.project_id && entry.spatial_request.model_id === brief.model_id);
  const newEntries = journal.slice(record.journal_prefix_length, index + 1).filter((entry) => entry.spatial_request.project_id === brief.project_id && entry.spatial_request.model_id === brief.model_id);
  if (newEntries.some((entry) => !entry.spatial_request.reference_artifacts.includes(body.brief_ref))) {
    reject("brief-not-bound", "The revised design operations and export must reference the frozen brief; create a new bound design revision");
  }
  const provenance = [];
  const operations = [];
  let appliedDesignChange = false;
  for (const entry of entries) {
    const run = await loadRun(entry.flow_request.attempt_id);
    if (!run || canonicalJson(run.request) !== canonicalJson(entry.spatial_request) ||
        canonicalJson(run.flow_request) !== canonicalJson(entry.flow_request) ||
        run.receipt.backend_qualification?.selected_backend !== DELIVERY_BACKEND.mode ||
        run.receipt.backend_qualification?.blender_evidence !== false) reject("delivery-lineage-mismatch", "Journal source is not bound to its deterministic adapter receipt");
    provenance.push({ attempt_id: run.flow_request.attempt_id, receipt_digest: run.result.output_digest, outcome: run.receipt.outcome, before_digest: run.receipt.before_digest, after_digest: run.receipt.after_digest });
    // Replayed idempotency keys can be journaled without changing native state.
    // Keep their evidence, but never re-apply a no-op to editable geometry.
    if (run.receipt.outcome === "applied") {
      operations.push(entry.spatial_request.operation);
      if (newEntries.includes(entry) && !["representation.export", "scene.validate"].includes(entry.spatial_request.operation.method)) appliedDesignChange = true;
    }
  }
  if (!appliedDesignChange) reject("brief-not-bound", "The frozen brief needs an actually applied design operation; replayed no-ops do not establish a new design revision");
  const model = reconstructModel(operations);
  const cylinders = model.objects.filter((object) => object.kind === "cylinder");
  // Source retains all applied operations, including objects replaced or reset
  // later. Never label cylinder-bearing replay history as legacy box-only.
  const hasCylinderHistory = operations.some((operation) => operation.method === "scene.create-cylinder");
  const primary = model.objects.find((object) => object.object_id === "primary-mass");
  if (!primary || canonicalJson(primaryDimensions(primary)) !== canonicalJson(brief.dimensions_mm) ||
      model.units !== brief.units || model.coordinate_frame !== brief.coordinate_frame) {
    reject("brief-dimensions-mismatch", "The primary-mass dimensions, units or frame differ from the frozen brief; correct the design or freeze a new brief revision");
  }
  const source = {
    contract_id: hasCylinderHistory ? "moonmold.editable-primitive-source.v1" : "moonmold.editable-box-source.v1", project_id: brief.project_id, model_id: brief.model_id,
    brief_ref: body.brief_ref, brief_digest: briefDigest, backend: DELIVERY_BACKEND,
    dimension_units: "mm", translation_units: "mm", model,
    operations: operations.filter((op) => !["representation.export", "scene.validate"].includes(op.method)),
    provenance, physical_authority: false,
    editing_notes: hasCylinderHistory
      ? "Edit semantic operation parameters as a new brief/request revision in the operator. Re-declaring a box or cylinder replaces its kind/dimensions/sides and resets translation/material. Cylinder radius/height are mm; sides explicitly controls tessellation (8–256). The primary-mass brief width/depth is nominal diameter, not the faceted mesh bounds. OBJ is a derived sibling, not this semantic source."
      : "Edit semantic operation parameters as a new brief/request revision in the operator. Re-declaring a box replaces dimensions and resets its translation/material. OBJ can also be edited in a mesh editor; it is a derived sibling, not this semantic source.",
  };
  const sourceText = jsonText(source);
  const sourceDigest = sha(sourceText);
  const previous = await previousDelivery(workspace, brief);
  const losses = {
    contract_id: "moonmold.representation-loss-report.v1", source_digest: sourceDigest,
    backend: DELIVERY_BACKEND, physical_authority: false,
    representation: "presentation", lineage_relation: "styled-from",
    units: model.units, coordinate_frame: model.coordinate_frame,
    conversion: `Semantic dimensions/translations remain in mm. OBJ coordinates divide mm by ${{ mm: 1, cm: 10, m: 1000 }[model.units]} to use declared ${model.units}; no frame conversion.`,
    known_losses: [
      "OBJ does not retain semantic operation history or enforce dimensions/constraints; configure importer units explicitly",
      "Material identifiers are retained in source only; no engineering material properties, textures or measured appearance are exported",
      hasCylinderHistory ? "SVG is an illustrative projection of the same faceted geometry with no depth/collision analysis; overlapping primitives may occlude incorrectly" : "SVG is an illustrative projection with no depth/collision analysis; overlapping boxes may occlude incorrectly",
      hasCylinderHistory ? "Cylinders are inscribed regular polygons with planar side facets and two ngon caps; no smooth surface or smooth normals. Odd side counts need not span the nominal diameter on each axis" : "No Boolean CSG, cylinders, assemblies, topology/manifold qualification or tolerance solving in this box renderer",
      ...(hasCylinderHistory ? ["No Boolean CSG, assemblies, topology/manifold qualification or tolerance solving in this box/cylinder renderer"] : []),
      "Human brief constraints and review criteria are recorded, not automatically proven",
      "No Blender qualification, engineering fitness, fabrication readiness, machine authority or client acceptance",
    ],
  };
  if (hasCylinderHistory) losses.cylinder_tessellation = cylinders.map((object) => ({
    object_id: object.object_id, radius_mm: object.dimensions_mm.radius, height_mm: object.dimensions_mm.height,
    sides: object.sides, vertex_count: 2 * object.sides, face_count: object.sides + 2,
    cap_topology: "two-ngons", side_topology: "quads", axis: "+Z", phase: "+X, counterclockwise viewed from +Z",
    max_radial_deviation_mm: object.dimensions_mm.radius * (1 - Math.cos(Math.PI / object.sides)),
    physical_tolerance_qualified: false,
  }));
  const validation = {
    contract_id: "moonmold.digital-delivery-validation.v1", source_digest: sourceDigest,
    checked: ["Exact native attempt/input/receipt lineage", hasCylinderHistory ? "Primary-mass nominal dimensions match frozen brief; cylinder width/depth = twice radius" : "Primary-mass dimensions match frozen brief", "Declared units and coordinate frame match brief", hasCylinderHistory ? "All model operations supported by box/cylinder renderer" : "All model operations supported by box renderer"],
    bounds_mm: modelBounds(model), box_count: model.objects.length - cylinders.length,
    constraints_pending_human_review: brief.constraints,
    review_criteria_pending_human_review: brief.review_criteria,
    adapter_receipt: selected.receipt, adapter_result: selected.result,
    backend: DELIVERY_BACKEND, physical_authority: false,
  };
  if (hasCylinderHistory) {
    validation.cylinder_count = cylinders.length;
    validation.object_count = model.objects.length;
    validation.bounds_scope = "Actual tessellated mesh vertices in mm; primary-mass brief dimensions remain nominal";
  }
  const readme = hasCylinderHistory
    ? `MoonMold digital box/cylinder package\n\nDETERMINISTIC MOCK / FIXTURE-REFERENCE-ONLY. NOT BLENDER EVIDENCE. NO PHYSICAL AUTHORITY.\n\nOpen editable-source.json to inspect exact semantic operations, radius/height/sides, translations and material tags. Increment the brief revision and freeze before changed operations, then execute Presentation export and build a new package. Re-declaring a primitive replaces its kind/dimensions/sides and resets translation/material. Old package files and exact reviews remain readable.\n\nOpen presentation.obj in a mesh editor with units set to ${model.units} and z-up-right-handed. Each box has 8 vertices and 6 outward quad faces. An N-sided cylinder has 2N vertices, N outward side quads and 2 outward ngon caps, centered on translation with axis +Z and its first vertex at +X. Sides must be an explicit integer 8–256. Cylinders are faceted inscribed polygons with no smooth normals. See per-cylinder approximation losses. Nominal primary-mass width/depth is twice radius; actual mesh bounds can be smaller, especially for odd side counts. All input dimensions/translations remain mm; OBJ values convert to declared units.\n\nSVG is an illustrative projection, not a dimensioned drawing or reliable occlusion analysis. Read brief.json, loss-report.json, change-report.json and validation.json. Human constraints are not automatically proven; generated topology is not engineering/manifold qualification. Review binds the exact manifest digest separately. Package generation is not human approval, client acceptance, payment, Blender evidence or physical certification.\n`
    : `MoonMold digital box package\n\nDETERMINISTIC MOCK / FIXTURE-REFERENCE-ONLY. NOT BLENDER EVIDENCE. NO PHYSICAL AUTHORITY.\n\nOpen editable-source.json in a text editor to inspect dimensions, translations and exact semantic operation history. To revise in MoonMold, increment the brief revision, freeze it, execute changed box/transform parameters with that brief reference, then export Presentation and prepare a new package. Re-declaring a box replaces it and resets translation/material. Old packages remain readable.\n\nOpen presentation.obj in a mesh editor with units set to ${model.units} and z-up-right-handed. Each box has eight vertices and six outward-oriented quad faces. Geometry operations retain millimeter dimensions; OBJ coordinates are converted to declared units. The file is editable derived geometry, not a parametric CAD certification.\n\nOpen preview.svg in a browser for an illustrative preview. Read loss-report.json, change-report.json, validation.json and brief.json before reviewing. Review is recorded separately against the exact manifest digest. Package generation is not named review, client acceptance, payment or physical certification.\n`;
  const contents = [
    ["brief.json", jsonText(record)], ["editable-source.json", sourceText],
    ["presentation.obj", renderObj(model, sourceDigest)], ["preview.svg", renderSvg(model, sourceDigest)],
    ["loss-report.json", jsonText(losses)], ["change-report.json", jsonText(changeReport(previous, source))],
    ["validation.json", jsonText(validation)], ["README.txt", readme],
  ];
  const files = contents.map(([name, bytes]) => ({ name, sha256: sha(bytes), bytes: Buffer.byteLength(bytes), media_type: name.endsWith(".json") ? "application/json" : name.endsWith(".svg") ? "image/svg+xml" : "text/plain" }));
  const base = {
    contract_id: "moonmold.digital-delivery.v1", project_id: brief.project_id, model_id: brief.model_id,
    commitment_ref: brief.commitment_ref, brief_revision: brief.revision, brief_ref: body.brief_ref, brief_digest: briefDigest,
    attempt_id: body.attempt_id, receipt_digest: selected.result.output_digest, source_digest: sourceDigest,
    journal_index: index, scene_digest: selected.receipt.after_digest, backend: DELIVERY_BACKEND,
    files, physical_authority: false,
  };
  // Canonical JSON omits no fields implicitly: the ID hashes only the base.
  const packageId = `delivery-${sha(canonicalJson(base)).slice(7)}`;
  const root = packageRoot(packageId);
  for (const [name, bytes] of contents) await immutable(workspace, `${root}/${name}`, bytes);
  await immutable(workspace, `${root}/manifest.json`, jsonText({ ...base, package_id: packageId }));
  return packageId;
}

export async function deliveryProjection(workspace, packageId, reviews = []) {
  const delivery = await verifiedDelivery(workspace, packageId);
  const { manifest, manifest_digest } = delivery;
  const journal = await readJson(workspace, JOURNAL, true) ?? [];
  let stale = false;
  for (const entry of journal.slice(manifest.journal_index + 1)) {
    if (entry.spatial_request.project_id !== manifest.project_id || entry.spatial_request.model_id !== manifest.model_id || ["representation.export", "scene.validate"].includes(entry.spatial_request.operation.method)) continue;
    const attemptId = entry.flow_request.attempt_id;
    if (!identity(attemptId)) reject("delivery-lineage-mismatch", "A later journal attempt has an invalid identity");
    const receipt = await readJson(workspace, `${ROOT}/adapter-attempts/${attemptId}/operation-receipt.json`, true);
    // Unresolved later evidence is conservatively historical; a retained no-op
    // does not invalidate the geometry or pretend a new design was applied.
    if (receipt?.outcome !== "idempotent-no-op") stale = true;
  }
  const bound = reviews.filter((review) => review.delivery_id === packageId && review.delivery_digest === manifest_digest && review.receipt_digest === manifest.receipt_digest);
  const latest = bound.at(-1);
  const latestTime = latest?.reviewed_at;
  const decisions = new Set(bound.filter((review) => review.reviewed_at === latestTime).map((review) => review.decision));
  return {
    contract_id: "moonmold.operator-delivery.v1", manifest, manifest_digest,
    reports: readableDeliveryReports(delivery),
    download_url: latest && decisions.size === 1
      ? `/api/delivery/${packageId}/reviewed/${sha(canonicalJson(latest)).slice(7)}`
      : `/api/delivery/${packageId}/bundle`,
    files: manifest.files.map((file) => ({ name: file.name, url: `/api/delivery/${packageId}/file/${file.name}` })),
    review_status: decisions.size > 1 ? "unverified" : latest?.decision ?? "pending", reviews: bound, stale,
  };
}

export async function latestDeliveryId(workspace, projectId, modelId) {
  const candidates = [];
  for (const id of await packageIds(workspace)) {
    const record = await verifiedDelivery(workspace, id);
    if (record.manifest.project_id === projectId && record.manifest.model_id === modelId) candidates.push(record.manifest);
  }
  candidates.sort((a, b) => b.journal_index - a.journal_index || b.brief_revision - a.brief_revision);
  return candidates[0]?.package_id ?? null;
}
