import { SolidViewer, partPalette } from "./solid-viewer.mjs";

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.workbench || "layout";
const profilePage = page === "profile" || page === "revolution";
const legacyCanvas = $("preview");
const legacyViewRow = legacyCanvas?.nextElementSibling;
const legacyNodes = [...document.body.children];
const app = document.createElement("main");
app.className = "wb-app";
const icon = (name) =>
  `<span class="wb-icon" aria-hidden="true" style="background:currentColor;mask:url('/workbench/icons/${name}.svg') center/contain no-repeat;-webkit-mask:url('/workbench/icons/${name}.svg') center/contain no-repeat"></span>`;
app.innerHTML = `<header class="wb-topbar">
 <a class="wb-brand" href="/">${icon("package")}MoonMold</a>
 <nav class="wb-nav" aria-label="Workspace"><a href="/reference-layout" ${page === "layout" ? 'aria-current="page"' : ""}>Models</a><a href="/reference-profile" ${profilePage ? 'aria-current="page"' : ""}>Profile</a><a href="/operations" class="wb-operations-link">Operations</a></nav>
 <span class="wb-title" id="wb-model-title"></span>
 <div class="wb-command"><span id="wb-history-actions"></span><button id="wb-open" class="primary">Open${page === "profile" ? " profile" : ""}</button><button id="wb-export">Export</button></div>
</header>
<div class="wb-main">
 <aside class="wb-sources" aria-label="Sources"><div class="wb-pane-head">Sources<button class="wb-icon-button" id="wb-add" title="Import a reference" aria-label="Import a reference">+</button></div><div class="wb-object-list" id="wb-objects"></div><div class="wb-source-actions" id="wb-imports"></div></aside>
 <section class="wb-stage" aria-label="Model preview"><div class="wb-view-toolbar" role="toolbar" aria-label="View controls"><button id="wb-solid" aria-pressed="true">Solid</button><button id="wb-wire" aria-pressed="false">Wireframe</button><span class="spacer"></span><button data-view="iso" title="Isometric view (1)">Isometric</button><button data-view="front" title="Front view (2)">Front</button><button data-view="right" title="Side view (3)">Side</button><button data-view="top" title="Top view (4)">Top</button><button data-view="bottom" title="Bottom view (5)">Bottom</button><button id="wb-fit" class="wb-icon-button" title="Fit model (Home)" aria-label="Fit model">${icon("expand")}</button></div>
 <div class="wb-viewport" id="wb-viewport"><canvas id="wb-solid-canvas" tabindex="0" aria-label="3D model. Drag to rotate, scroll to zoom, Shift-drag to pan. Arrow keys rotate, plus or minus zoom, Home fits the model."></canvas><div class="wb-empty" id="wb-empty">${icon("package")}<h2>${page === "profile" ? "Create a profile" : "Open a model"}</h2><p>${page === "profile" ? "Build an outline to inspect it in 3D." : "Open an editable layout, or import a mesh with its source units."}</p><button class="primary" id="wb-empty-open">${page === "profile" ? "Use plate example" : "Open layout"}</button></div></div>
 <div class="wb-error" id="wb-error" role="alert" hidden></div>
 <div class="wb-wire-controls" id="wb-wire-controls" hidden></div><div class="wb-view-foot"><span id="wb-gesture-hint">Drag to rotate · Scroll to zoom · Shift-drag to pan</span><label>Explode<input id="wb-explode" type="range" min="0" max="100" value="0" aria-label="Exploded view amount"></label></div></section>
 <aside class="wb-inspector" aria-label="Inspector"><div class="wb-inspector-tabs" role="tablist" aria-label="Inspector"><button role="tab" id="wb-tab-object" aria-controls="wb-panel-object" aria-selected="true">${page === "profile" ? "Profile" : "Object"}</button><button role="tab" id="wb-tab-inspect" aria-controls="wb-panel-inspect" aria-selected="false" tabindex="-1">Inspect</button><button role="tab" id="wb-tab-tools" aria-controls="wb-panel-tools" aria-selected="false" tabindex="-1">Tools</button><button role="tab" id="wb-tab-export" aria-controls="wb-panel-export" aria-selected="false" tabindex="-1">Export</button></div><div class="wb-tabpanel" role="tabpanel" id="wb-panel-object" aria-labelledby="wb-tab-object"></div><div class="wb-tabpanel" role="tabpanel" id="wb-panel-inspect" aria-labelledby="wb-tab-inspect" hidden></div><div class="wb-tabpanel" role="tabpanel" id="wb-panel-tools" aria-labelledby="wb-tab-tools" hidden></div><div class="wb-tabpanel" role="tabpanel" id="wb-panel-export" aria-labelledby="wb-tab-export" hidden></div></aside>
</div><footer class="wb-statusbar"><span id="wb-brief-status">Reference model</span><span id="wb-history-state"></span><details><summary>Details</summary><div id="wb-source-details"></div></details></footer>`;
document.body.append(app);

function detail(title, parent, open = false) {
  const d = document.createElement("details");
  d.className = "wb-detail";
  d.open = open;
  const s = document.createElement("summary");
  s.textContent = title;
  const content = document.createElement("div");
  d.append(s, content);
  parent.append(d);
  return { root: d, content };
}
function move(id, parent) {
  const el = $(id);
  if (el) parent.append(el);
  return el;
}
const claimed = new Set();
function form(id, title, panel, open = false) {
  let el = $(id);
  if (!el) return;
  el = el.closest("form") || el;
  if (claimed.has(el)) return;
  claimed.add(el);
  // Legacy pages sometimes place the live result and downloads after the form.
  // Keep those siblings with their operation when moving it into the inspector.
  const prefix = id.replace(/-(controls|form)$/, "") + "-",
    outputs = [];
  for (
    let next = el.nextElementSibling;
    next?.id.startsWith(prefix);
    next = next.nextElementSibling
  )
    outputs.push(next);
  const container = detail(title, $(`wb-panel-${panel}`), open);
  container.content.append(el, ...outputs);
  return container;
}
function importForm(id, title, open = false) {
  let el = $(id);
  if (!el) return;
  el = el.closest("form") || el;
  claimed.add(el);
  const d = detail(title, $("wb-imports"), open);
  d.content.append(el);
  return d;
}
const nativeStatus = $("status");
if (nativeStatus) {
  move("status", $("wb-source-details"));
  nativeStatus.setAttribute("aria-live", "off");
}
const liveError = $("wb-error");
let currentScene = null,
  currentName = "",
  currentSelection = "",
  viewer = null,
  mode = "solid",
  graphicsFailed = false,
  groupNodes = new Map(),
  lastBusy = false;
if (nativeStatus && page !== "layout")
  new MutationObserver(() => {
    const text = nativeStatus.textContent;
    if (
      /(?:Last|Previous) successful[\s\S]*unchanged|Current draft[\s\S]*unchanged/.test(
        text,
      )
    ) {
      liveError.textContent = text;
      liveError.hidden = false;
    }
    globalThis.dispatchEvent(new Event("moonmold:request-preview"));
  }).observe(nativeStatus, {
    childList: true,
    characterData: true,
    subtree: true,
  });
const colors = new Map(),
  visibility = new Map();
function tab(name, focus = false) {
  if ($(`wb-tab-${name}`).disabled) return;
  for (const key of ["object", "inspect", "tools", "export"]) {
    const active = key === name;
    const b = $(`wb-tab-${key}`);
    b.setAttribute("aria-selected", String(active));
    b.tabIndex = active ? 0 : -1;
    $(`wb-panel-${key}`).hidden = !active;
    if (active && focus) b.focus();
  }
  if (name === "inspect" && currentScene) setMode("wire");
}
for (const name of ["object", "inspect", "tools", "export"]) {
  $(`wb-tab-${name}`).addEventListener("click", () => tab(name));
  $(`wb-tab-${name}`).addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const list = ["object", "inspect", "tools", "export"].filter(
          (key) => !$(`wb-tab-${key}`).disabled,
        ),
        i = list.indexOf(name);
      tab(
        list[
          (i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length
        ],
        true,
      );
      e.preventDefault();
    }
  });
}

if (page === "layout") {
  importForm("load-form", "Open layout or recipe");
  importForm("add-form", "Import mesh");
  importForm("glb-import-form", "Import GLB");
  move("edit-form", $("wb-panel-object"));
  claimed.add($("edit-form"));
  const sourceDetails = detail(
    "Source and placement options",
    $("edit-controls"),
  );
  for (const id of ["layout-name", "instance-id", "ground"]) {
    const field = $(id)?.closest("label");
    if (field) sourceDetails.content.append(field);
  }
  const selectLabel = $("selected")?.closest("label");
  if (selectLabel) {
    selectLabel.firstChild.textContent = "Instance ";
    $("edit-form").prepend(selectLabel);
  }
  const makeRow = (ids) => {
    const row = document.createElement("div");
    row.className = "row wb-axis-row";
    for (const id of ids) {
      const field = $(id)?.closest("label");
      if (field) row.append(field);
    }
    return row;
  };
  const transform = document.createElement("div");
  transform.className = "wb-transform";
  transform.append(
    makeRow(["scale"]),
    makeRow(["tx", "ty", "tz"]),
    makeRow(["rx", "ry", "rz"]),
  );
  $("edit-controls").prepend(transform);
  if (selectLabel) $("edit-controls").prepend(selectLabel);
  for (const [id, title] of [
    ["tx", "X · mm"],
    ["ty", "Y · mm"],
    ["tz", "Z · mm"],
    ["rx", "X · °"],
    ["ry", "Y · °"],
    ["rz", "Z · °"],
  ]) {
    const label = $(id)?.closest("label");
    if (label) label.firstChild.textContent = title;
  }
  const actions = document.createElement("div");
  actions.className = "wb-object-actions";
  for (const [id, title] of [
    ["duplicate", "Duplicate"],
    ["reset", "Reset placement"],
    ["remove", "Remove"],
  ]) {
    const b = $(id);
    if (b) {
      b.textContent = title;
      actions.append(b);
    }
  }
  sourceDetails.content.append(actions);
  const apply = $("edit-form").querySelector("button:not([type])");
  if (apply) apply.classList.add("primary");
  for (const [id, title, open] of [
    ["measure-controls", "Distance", true],
    ["angle-controls", "Angle"],
    ["surface-area-controls", "Area and volume"],
    ["section-controls", "Cross-section"],
    ["dimension-controls", "Named dimensions"],
    ["path-controls", "Vertex path"],
    ["defect-controls", "Mesh defects"],
    ["separation-controls", "Surface gap"],
  ])
    form(id, title, "inspect", open);
  for (const [id, title] of [
    ["align-controls", "Align"],
    ["arrange-controls", "Move arrangement"],
    ["registration-controls", "Register references"],
    ["face-placement-controls", "Lay face flat"],
    ["fit-envelope-controls", "Fit envelope"],
    ["calibrate-controls", "Calibrate scale"],
    ["array-controls", "Linear array"],
    ["path-array-controls", "Path array"],
    ["cut-controls", "Cutaway"],
    ["islands-controls", "Separate islands"],
    ["replace-controls", "Replace source"],
    ["merge-controls", "Merge layout"],
    ["placements-controls", "Placement table"],
  ])
    form(id, title, "tools");
  for (const id of ["layout-undo", "layout-redo"]) {
    const b = move(id, $("wb-history-actions"));
    if (b) {
      b.className = "wb-icon-button";
      b.title =
        id === "layout-undo" ? "Undo layout change" : "Redo layout change";
      b.setAttribute("aria-label", b.title);
      b.innerHTML = icon(id === "layout-undo" ? "undo" : "redo");
    }
  }
  move("history-status", $("wb-source-details"));
  move("discard-placement", sourceDetails.content);
  move("part-status", sourceDetails.content);
  form("revision-controls", "Compare revision", "export");
  move("downloads", $("wb-panel-export"));
  for (const [id, title] of [
    ["glb-export", "GLB for 3D viewers"],
    ["drawing-export", "Three-view drawing"],
  ]) {
    const el = $(id);
    if (el) {
      const d = detail(title, $("wb-panel-export"));
      d.content.append(el.closest("p") || el);
    }
  }
}
if (page === "mesh") {
  $("wb-open").textContent = "Open source";
  $("wb-empty").querySelector("h2").textContent = "Import a mesh";
  $("wb-empty").querySelector("p").textContent =
    "Choose OBJ, STL or PLY and set its source units.";
  $("wb-empty-open").textContent = "Choose mesh";
  importForm("import-form", "Import mesh", true);
  importForm("source-form", "Open saved source");
  move("edit-form", $("wb-panel-object"));
  claimed.add($("edit-form"));
  form("parts-controls", "Source parts", "object");
  const section = form("section-controls", "Cross-section", "inspect", true);
  for (const id of ["section-downloads", "section-status", "section-preview"])
    move(id, section?.content || $("wb-panel-inspect"));
  for (const id of ["downloads", "source-downloads", "source-help"])
    move(id, $("wb-panel-export"));
}
if (page === "profile") {
  importForm("open-form", "Open profile");
  importForm("dxf-form", "Import DXF");
  importForm("svg-form", "Import SVG");
  move("profile-form", $("wb-panel-object"));
  claimed.add($("profile-form"));
  form("transform-form", "Transform outline", "tools", true);
  for (const id of [
    "transform-apply",
    "transform-cancel",
    "transform-status",
    "transform-preview",
  ])
    move(id, $("wb-panel-tools"));
  for (const id of ["downloads", "summary"]) move(id, $("wb-panel-export"));
}
if (page === "revolution") {
  importForm("open-form", "Open profile");
  move("build-form", $("wb-panel-object"));
  claimed.add($("build-form"));
  for (const id of ["downloads", "summary"]) move(id, $("wb-panel-export"));
  $("wb-open").textContent = "Open profile";
  $("wb-tab-object").textContent = "Profile";
  $("wb-empty").querySelector("h2").textContent = "Create a collar";
  $("wb-empty").querySelector("p").textContent =
    "Build a radius–height profile to inspect it in 3D.";
}
if (profilePage) {
  const related = document.createElement("a");
  related.href =
    page === "profile" ? "/reference-revolution" : "/reference-profile";
  related.textContent =
    page === "profile" ? "Revolve a profile" : "Extrude a profile";
  $("wb-imports").append(related);
}
if (legacyCanvas) {
  $("wb-viewport").prepend(legacyCanvas);
  legacyCanvas.hidden = true;
  legacyCanvas.style.objectFit = "contain";
}
if (legacyViewRow && !legacyViewRow.matches("form,fieldset,script"))
  $("wb-wire-controls").append(legacyViewRow);
// Keep every specialist control reachable, including future page additions.
for (const node of legacyNodes) {
  if (
    node.tagName === "SCRIPT" ||
    node.tagName === "STYLE" ||
    node.tagName === "LINK"
  )
    continue;
  if (node.parentElement !== document.body) continue;
  if (node.matches("h1,p,small") && !node.id && !node.querySelector("[id]")) {
    node.remove();
    continue;
  }
  if (node.matches("form,fieldset")) {
    const title =
      node.querySelector("legend")?.textContent || "Additional tools";
    if (node.id) form(node.id, title, "tools");
    else detail(title, $("wb-panel-tools")).content.append(node);
  } else if (node.id || node.querySelector("[id]")) {
    const d = detail("Additional details", $("wb-panel-tools"));
    d.content.append(node);
  } else node.remove();
}
// Long reference/qualification notes remain next to their operation, on demand.
for (const formEl of app.querySelectorAll("form,fieldset")) {
  const notes = [...formEl.children].filter((el) => el.tagName === "SMALL");
  if (notes.length) {
    const d = detail("Details", formEl);
    d.root.classList.add("wb-help");
    d.content.append(...notes);
  }
}
const labels = {
  "Save editable layout": "Save layout",
  "Combined OBJ": "Download OBJ",
  "Combined STL": "Download STL",
  "Inspection report": "Inspection report",
};
const nativeDownloads = $("downloads");
if (nativeDownloads)
  new MutationObserver(() => {
    for (const a of nativeDownloads.querySelectorAll("a"))
      if (labels[a.textContent] && labels[a.textContent] !== a.textContent)
        a.textContent = labels[a.textContent];
  }).observe(nativeDownloads, { childList: true, subtree: true });

function openFile() {
  const input = $(
    page === "layout"
      ? "layout-file"
      : page === "profile"
        ? "profile-file"
        : page === "revolution"
          ? "recipe-file"
          : "source-file",
  );
  if (input) {
    input.click();
    return;
  }
  $("wb-add").click();
}
$("wb-open").addEventListener("click", openFile);
$("wb-empty-open").addEventListener("click", () => {
  if (page === "profile") {
    $("sample-plate")?.click();
    $("profile-form")?.requestSubmit();
  } else if (page === "revolution") $("build-form")?.requestSubmit();
  else if (page === "mesh") $("file")?.click();
  else openFile();
});
if (page === "revolution")
  $("wb-empty-open").textContent = "Build collar example";
const openInput = $(
  page === "layout"
    ? "layout-file"
    : page === "profile"
      ? "profile-file"
      : page === "revolution"
        ? "recipe-file"
        : "source-file",
);
openInput?.addEventListener("change", () => {
  if (openInput.files.length) openInput.closest("form").requestSubmit();
});
$("wb-add").addEventListener("click", () => {
  const first =
    $("wb-imports").querySelectorAll("details")[page === "layout" ? 1 : 0];
  if (first) {
    first.open = true;
    first.scrollIntoView({ block: "nearest" });
    first.querySelector("input")?.focus();
  }
});
$("wb-export").addEventListener("click", () => tab("export"));
app.addEventListener(
  "invalid",
  (event) => {
    for (
      let parent = event.target.parentElement;
      parent && parent !== app;
      parent = parent.parentElement
    )
      if (parent.tagName === "DETAILS") parent.open = true;
    const panel = event.target.closest("[role=tabpanel]");
    if (panel) tab(panel.id.replace("wb-panel-", ""));
  },
  true,
);
for (const id of [
  "registration-form",
  "face-placement-form",
  "fit-envelope-form",
])
  $(id)?.addEventListener("submit", () => setMode("wire"), true);
function setMode(next) {
  mode = next;
  const solid = next === "solid" && !graphicsFailed;
  $("wb-solid-canvas").hidden = !solid;
  if (legacyCanvas) legacyCanvas.hidden = solid;
  $("wb-wire-controls").hidden = solid;
  $("wb-solid").setAttribute("aria-pressed", String(solid));
  $("wb-wire").setAttribute("aria-pressed", String(!solid));
  $("wb-explode").disabled = !solid;
  $("wb-gesture-hint").textContent = solid
    ? "Drag to rotate · Scroll to zoom · Shift-drag to pan"
    : "Wireframe includes hidden edges · Use yaw and elevation controls";
  for (const row of groupNodes.values()) {
    row.check.disabled = !solid;
    row.color.disabled = !solid;
  }
  viewer?.invalidate();
}
function graphicsError(message) {
  graphicsFailed = true;
  liveError.textContent = message;
  liveError.hidden = false;
  setMode("wire");
  $("wb-solid").textContent = "Retry solid";
}
function startViewer() {
  try {
    viewer?.dispose();
    viewer = new SolidViewer($("wb-solid-canvas"), { onError: graphicsError });
    graphicsFailed = false;
    $("wb-solid").textContent = "Solid";
    liveError.hidden = true;
    if (currentScene) viewer.setScene(currentScene, currentSelection);
    for (const [name, value] of colors) viewer.setColor(name, value);
    for (const [name, visible] of visibility) {
      const ids = [...groupNodes.values()]
        .filter((n) => n.name === name)
        .flatMap((n) => n.ids);
      viewer.setVisibility(ids, visible);
    }
    setMode("solid");
  } catch (e) {
    graphicsError(e.message);
  }
}
$("wb-solid").addEventListener("click", () => {
  if (graphicsFailed) startViewer();
  else setMode("solid");
});
$("wb-wire").addEventListener("click", () => setMode("wire"));
for (const b of app.querySelectorAll("[data-view]"))
  b.addEventListener("click", () => {
    if (mode !== "solid") setMode("solid");
    viewer?.view(b.dataset.view);
  });
$("wb-fit").addEventListener("click", () => {
  setMode("solid");
  viewer?.view("fit");
});
$("wb-explode").addEventListener("input", (e) =>
  viewer?.setExplode(Number(e.target.value) / 100),
);

function selectPart(id) {
  if (page !== "layout") return;
  const menu = $("selected");
  menu.value = id;
  menu.dispatchEvent(new Event("change", { bubbles: true }));
  tab("object");
}
function updateGroups(scene, selected) {
  const groups = new Map();
  for (const p of scene.parts || [
    { id: "reference", source_name: "reference" },
  ]) {
    const name = p.source_name || p.id;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(p.id);
  }
  $("wb-objects").replaceChildren();
  groupNodes = new Map();
  let index = 0;
  for (const [name, ids] of groups) {
    const row = document.createElement("div");
    row.className = "wb-object-row";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = visibility.get(name) !== false;
    check.setAttribute("aria-label", `Show ${name} in solid preview`);
    check.title = "Show in solid preview";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.title = ids.join("\n");
    b.addEventListener("click", () => selectPart(ids[0]));
    const color = document.createElement("input");
    color.type = "color";
    color.value = colors.get(name) || partPalette[index++ % partPalette.length];
    color.setAttribute("aria-label", `Preview color for ${name}`);
    color.title = "Preview color";
    check.addEventListener("change", () => {
      visibility.set(name, check.checked);
      viewer?.setVisibility(ids, check.checked);
    });
    color.addEventListener("input", () => {
      colors.set(name, color.value);
      viewer?.setColor(name, color.value);
    });
    row.append(check, b, color);
    $("wb-objects").append(row);
    groupNodes.set(name, { row, check, color, ids, name });
    viewer?.setColor(name, color.value);
    viewer?.setVisibility(ids, check.checked);
  }
  highlightGroups(selected);
  setMode(mode);
}
function highlightGroups(selected) {
  for (const { row, ids } of groupNodes.values())
    row.classList.toggle("is-selected", ids.includes(selected));
}
globalThis.addEventListener("moonmold:preview", (event) => {
  const {
    scene,
    selected = "",
    name = "",
    busy = false,
    dirty = false,
    error,
  } = event.detail;
  if (error) {
    liveError.textContent = error;
    liveError.hidden = false;
  }
  if (busy && !lastBusy && !graphicsFailed) liveError.hidden = true;
  lastBusy = busy;
  const changed = scene !== currentScene;
  if (changed && !graphicsFailed && !error) liveError.hidden = true;
  currentScene = scene;
  currentName = name;
  currentSelection = selected;
  app.dataset.hasModel = String(!!scene);
  $("wb-model-title").textContent = name;
  $("wb-empty").hidden = !!scene;
  $("wb-brief-status").textContent = busy
    ? "Working…"
    : dirty
      ? "Unapplied changes"
      : scene
        ? `${scene.bounds?.size?.map((n) => Number(n.toPrecision(5))).join(" × ")} mm`
        : "Reference model";
  $("wb-open").disabled = busy;
  $("wb-add").disabled = busy;
  $("wb-export").disabled = !scene;
  for (const key of ["inspect", "export"]) $(`wb-tab-${key}`).disabled = !scene;
  $("wb-tab-tools").disabled = !scene && !profilePage;
  for (const b of app.querySelectorAll("[data-view],#wb-fit"))
    b.disabled = !scene;
  try {
    viewer?.setScene(scene, selected);
    if (changed) {
      $("wb-explode").value = "0";
      viewer?.setExplode(0);
      if (scene) updateGroups(scene, selected);
      else {
        $("wb-objects").replaceChildren();
        groupNodes.clear();
      }
    } else highlightGroups(selected);
  } catch (e) {
    graphicsError(e.message);
  }
});
document.body.classList.add("workbench-ready");
startViewer();
globalThis.dispatchEvent(new Event("moonmold:request-preview"));
