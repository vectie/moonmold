import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("MoonMold is a self-contained domain pack with its own operator app", async () => {
  const manifest = JSON.parse(await readFile(path.join(REPO, "pack.json"), "utf8"));
  assert.equal(manifest.id, "moonmold");
  assert.equal(manifest.product_id, "moonmold");
  assert.equal(manifest.kind, "DomainPack");
  assert.deepEqual(manifest.app_entrypoints, [{
    id: "spatial-operator",
    path: "ui/rabbita-moonmold",
    audience: "spatial-model-operator",
  }]);
  assert.ok(manifest.tools.length >= 3);
  assert.ok(manifest.workflows.length >= 1);
  assert.equal(manifest.tools.some((tool) => tool.authority === "PhysicalEffect"), false);
  assert.equal(manifest.tools.every((tool) => tool.owner_product === "moonmold"), true);

  const refs = [
    ...manifest.book_templates,
    ...manifest.schemas,
    ...manifest.workflows,
    ...manifest.skills,
    ...manifest.policies,
    ...manifest.provider_ports,
    ...manifest.migrations,
    ...manifest.evaluations,
    manifest.uninstall_contract,
  ];
  for (const ref of refs) {
    assert.equal(path.isAbsolute(ref.path), false);
    assert.equal(ref.path.includes(".."), false);
    await access(path.join(REPO, ref.path));
  }
  for (const app of manifest.app_entrypoints) {
    assert.equal(path.isAbsolute(app.path), false);
    assert.equal(app.path.includes(".."), false);
    await access(path.join(REPO, app.path));
  }
  const declaration = JSON.parse(await readFile(
    path.join(REPO, "adapters/moonmold-pack-local-v1.declaration.json"),
    "utf8",
  ));
  assert.equal(declaration.protocol, "moonflow.adapter.v2");
  assert.deepEqual(
    declaration.operations.map((operation) => operation.operation_id),
    manifest.tools.map((tool) => tool.id),
  );
  assert.equal(
    declaration.operations.every((operation) => operation.supports_reconcile),
    true,
  );
});
