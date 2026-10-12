import { supportedDeliveryReport } from "./delivery-report-schema.mjs";

// Read-only interpretation of already digest-verified retained members.
// Bounds fail closed for the whole member; values are never truncated.
const names = ["change-report.json", "loss-report.json", "validation.json"];
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function rows(value) {
  const result = [];
  const walk = (v, label, depth) => {
    if (depth > 16 || result.length >= 2048 || label.length > 4096) throw new Error("Report exceeds display bounds");
    if (typeof v === "string" && v.length > 16384) throw new Error("Report value exceeds display bounds");
    const entries = object(v) || Array.isArray(v) ? Object.entries(v) : [];
    if (entries.length) for (const [key, child] of entries) walk(child, label ? `${label}.${key}` : key, depth + 1);
    else result.push({ label, value: typeof v === "string" ? v : JSON.stringify(v) });
  };
  walk(value, "", 0);
  return result;
}

export function readableDeliveryReports(delivery) {
  return names.map((name) => {
    const file = delivery.files.find((item) => item.name === name);
    const result = { name, sha256: file.sha256, status: "unavailable", message: "Interpretation unavailable: malformed, unsupported, or over display bounds. Download the exact retained member.", rows: [] };
    try {
      if (file.bytes > 262144) return result;
      const value = JSON.parse(file.text);
      if (!supportedDeliveryReport(name, value, delivery.manifest)) return result;
      return { ...result, status: "available", message: "Exact retained report fields. These findings do not establish human approval or physical qualification.", rows: rows(value) };
    } catch { return result; }
  });
}
