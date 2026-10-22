import "./app.js";
import { mountAudio } from "./audio.js";
import { mountMeasure } from "./measure.js";
import { mountAcoustic } from "./acoustic-lab.js";
import { mountMotion } from "./motion-lab.js";
import {
  openRunStore,
  makeRun,
  parseRun,
  stringifyRun,
  compareTrials,
  MAX_RUN_BYTES,
} from "./experiment.js";
const $ = (id) => document.getElementById(id),
  navigation = [...document.querySelectorAll("[data-mode]")],
  mounts = new Map(),
  savedIds = new Map();
let mode = "acoustic",
  store = null,
  runs = [],
  openRevision = 0;
const notify = (text, error = false) => {
  $("shell-status").hidden = !text;
  $("shell-status").textContent = text;
  $("shell-status").className = "shell-status " + (error ? "error" : "");
};
function select(next) {
  document.dispatchEvent(new CustomEvent("bench:pause"));
  mode = next;
  $("mechanics-workspace").hidden = next !== "mechanics";
  $("extra-workspace").hidden = next === "mechanics";
  for (const [key, v] of mounts) v.host.hidden = key !== next;
  if (next !== "mechanics" && !mounts.has(next)) {
    const host = document.createElement("div");
    $("extra-workspace").append(host);
    const cleanup =
      next === "acoustic"
        ? mountAcoustic(host)
        : next === "motion"
          ? mountMotion(host, {
              onSave: () =>
                document.dispatchEvent(new CustomEvent("bench:save-current")),
            })
          : next === "audio"
            ? mountAudio(host)
            : mountMeasure(host);
    mounts.set(next, { host, cleanup });
  }
  for (const b of navigation)
    b.setAttribute("aria-pressed", String(b.dataset.mode === next));
  for (const id of ["record-save", "record-export"])
    $(id).disabled = !["motion", "acoustic"].includes(next);
  history.replaceState(null, "", `#${next}`);
  notify("");
}
for (const b of navigation)
  b.addEventListener("click", () => select(b.dataset.mode));
document.addEventListener("bench:analyze", (event) => {
  select("measure");
  mounts.get("measure").cleanup.loadDataset(event.detail);
});
for (const b of document.querySelectorAll("[data-close]"))
  b.addEventListener("click", () => $(b.dataset.close).close());
$("guide-open").addEventListener("click", () => $("guide-dialog").showModal());
function download(run) {
  const url = URL.createObjectURL(
      new Blob([stringifyRun(run)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `physicsbench-${run.kind}-${run.id.slice(0, 8)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function currentRun() {
  const api = mounts.get(mode)?.cleanup;
  if (!api?.exportRun)
    throw new Error(
      "Choose an acoustic or motion investigation to save a complete record.",
    );
  const data = api.exportRun();
  const run = makeRun(
    mode,
    data,
    api.getTitle?.() ||
      (mode === "motion"
        ? "Motion investigation"
        : `Acoustic · ${data.condition}`),
  );
  const key = data.acquisitionId || data.id;
  if (key) {
    if (savedIds.has(key)) run.id = savedIds.get(key);
    else savedIds.set(key, run.id);
  }
  return run;
}
async function refresh() {
  runs = (await store.list()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  $("run-count").textContent = runs.length;
}
async function save() {
  try {
    if (!store) throw new Error("Local experiment storage is still opening.");
    const run = currentRun();
    await store.put(run);
    await refresh();
    notify(
      `Saved “${run.title}” ${store.persistent ? "in this browser" : "for this page only; persistent storage is unavailable"}.`,
    );
  } catch (error) {
    notify(error.message, true);
  }
}
$("record-save").addEventListener("click", save);
document.addEventListener("bench:save-current", save);
$("record-export").addEventListener("click", () => {
  try {
    download(currentRun());
    notify(
      "Complete investigation exported. Raw observations and settings are included.",
    );
  } catch (error) {
    notify(error.message, true);
  }
});
async function reopen(run) {
  const ticket = ++openRevision;
  select(run.kind);
  const api = mounts.get(run.kind).cleanup;
  await api.loadRun(run.data);
  if (ticket !== openRevision) return;
  const key = run.data.acquisitionId || run.data.id;
  if (key) savedIds.set(key, run.id);
  notify(
    `Reopened “${run.title}”. Derived results were recomputed from the observations.`,
  );
}
$("record-import").addEventListener("click", () => $("record-file").click());
$("record-file").addEventListener("change", async () => {
  const file = $("record-file").files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_RUN_BYTES)
      throw new Error("Investigation records are limited to 12 MiB.");
    const text = await file.text();
    let run;
    try {
      const raw = JSON.parse(text);
      run =
        raw?.type === "motion"
          ? makeRun("motion", raw, raw.name || "Motion investigation")
          : parseRun(text);
    } catch (error) {
      throw new Error(error.message);
    }
    await reopen(run);
  } catch (error) {
    notify(`${error.message} Previous valid work retained.`, true);
  } finally {
    $("record-file").value = "";
  }
});
function renderRuns() {
  const list = $("runs-list");
  list.replaceChildren();
  $("run-comparison").replaceChildren();
  if (!runs.length) {
    const p = document.createElement("p");
    p.textContent =
      "No saved runs yet. Complete an investigation and choose Save run.";
    list.append(p);
    return;
  }
  for (const run of runs) {
    const row = document.createElement("div");
    row.className = "run-row";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.value = run.id;
    check.setAttribute("aria-label", `Select ${run.title}`);
    const label = document.createElement("div"),
      strong = document.createElement("strong"),
      small = document.createElement("small");
    strong.textContent = run.title;
    small.textContent = `${run.kind} · ${(typeof run.data.source === "string" ? run.data.source : run.data.source?.kind) || "source recorded in file"} · ${new Date(run.createdAt).toLocaleString()}`;
    label.append(strong, small);
    const open = document.createElement("button");
    open.textContent = "Open";
    open.addEventListener("click", async () => {
      try {
        await reopen(run);
        $("runs-dialog").close();
      } catch (error) {
        notify(error.message, true);
      }
    });
    const exportButton = document.createElement("button");
    exportButton.textContent = "Export";
    exportButton.addEventListener("click", () => download(run));
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      try {
        await store.remove(run.id);
        await refresh();
        renderRuns();
      } catch (error) {
        notify(error.message, true);
      }
    });
    row.append(check, label, open, exportButton, remove);
    list.append(row);
  }
}
$("runs-open").addEventListener("click", async () => {
  try {
    if (!store) throw new Error("Storage is still opening.");
    await refresh();
    renderRuns();
    $("runs-dialog").showModal();
  } catch (error) {
    notify(error.message, true);
  }
});
$("runs-compare").addEventListener("click", () => {
  const panel = $("run-comparison");
  panel.replaceChildren();
  try {
    const ids = [...$("runs-list").querySelectorAll("input:checked")].map(
        (x) => x.value,
      ),
      selected = runs.filter((r) => ids.includes(r.id));
    const result = compareTrials(selected);
    for (const group of result.groups) {
      const p = document.createElement("p");
      p.textContent = `${group.condition}: ${group.tail.n} acquisitions, mean late-energy fraction ${(group.tail.mean * 100).toFixed(2)}%, repeat standard deviation ${(group.tail.sd * 100).toFixed(2)}%.`;
      panel.append(p);
    }
    const strong = document.createElement("strong");
    strong.textContent = result.interpretation;
    const note = document.createElement("p");
    note.textContent = result.caveat;
    panel.append(strong, note);
  } catch (error) {
    panel.textContent = error.message;
  }
});
const initial = location.hash.slice(1);
select(
  ["acoustic", "motion", "mechanics", "audio", "measure"].includes(initial)
    ? initial
    : "acoustic",
);
window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (
    ["acoustic", "motion", "mechanics", "audio", "measure"].includes(next) &&
    next !== mode
  )
    select(next);
});
openRunStore()
  .then(async (value) => {
    store = value;
    $("storage-status").textContent = store.persistent
      ? "Runs saved in this browser · no uploads"
      : "Persistent storage unavailable · export your work";
    await refresh();
  })
  .catch((error) => notify(error.message, true));
