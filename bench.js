import "./app.js";
import { mountAudio } from "./audio.js";
import { mountMeasure } from "./measure.js";
const $ = (id) => document.getElementById(id);
const navigation = [...document.querySelectorAll("[data-mode]")];
let mode = "mechanics";
const mounts = new Map();
function select(next, dataset) {
  document.dispatchEvent(new CustomEvent("bench:pause"));
  mode = next;
  $("mechanics-workspace").hidden = next !== "mechanics";
  $("extra-workspace").hidden = next === "mechanics";
  for (const [key, value] of mounts) value.host.hidden = key !== next;
  if (next !== "mechanics" && !mounts.has(next)) {
    const host = document.createElement("div");
    $("extra-workspace").append(host);
    const cleanup =
      next === "audio" ? mountAudio(host) : mountMeasure(host, dataset);
    mounts.set(next, { host, cleanup });
  } else if (next === "measure" && dataset)
    mounts.get(next).cleanup.loadDataset(dataset);
  $("breadcrumb-current").textContent =
    next === "mechanics"
      ? "Mechanics"
      : next === "audio"
        ? "Sound laboratory"
        : "Motion & data";
  for (const b of navigation) {
    if (b.dataset.mode !== "mechanics")
      b.setAttribute("aria-pressed", String(b.dataset.mode === next));
    else if (next !== "mechanics") b.setAttribute("aria-pressed", "false");
  }
  if (next !== "mechanics") history.replaceState(null, "", `#${next}`);
}
for (const b of navigation)
  b.addEventListener("click", () => {
    select(b.dataset.mode);
    if (b.dataset.lab) {
      b.setAttribute("aria-pressed", "true");
      history.replaceState(null, "", `#${b.dataset.lab}`);
    }
  });
document.addEventListener("bench:analyze", (event) =>
  select("measure", event.detail),
);
for (const id of ["guide-open", "help-open"])
  $(id).addEventListener("click", () => $("guide-dialog").showModal());
for (const b of document.querySelectorAll("[data-close]"))
  b.addEventListener("click", () => $(b.dataset.close).close());
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
const searchItems = [
  [
    "Projectile motion",
    "Launch angle, gravity, trajectory, parameter sweeps",
    "projectile",
  ],
  ["Mass & spring", "Oscillator, energy, frequency, Hooke’s law", "oscillator"],
  [
    "Collisions",
    "Momentum, restitution, elastic and inelastic impact",
    "collision",
  ],
  [
    "Sound laboratory",
    "Microphone, FFT, waveform, spectrogram, signal generator",
    "audio",
  ],
  [
    "Motion & data",
    "Local video tracking, CSV, regression, residuals, gravity",
    "measure",
  ],
];
function search() {
  const q = $("instrument-search").value.toLowerCase().trim();
  const matches = searchItems.filter((item) =>
    item.join(" ").toLowerCase().includes(q),
  );
  $("search-results").replaceChildren(
    ...matches.map(([name, description, id]) => {
      const b = document.createElement("button");
      b.type = "button";
      const strong = document.createElement("strong");
      strong.textContent = name;
      const small = document.createElement("small");
      small.textContent = description;
      b.append(strong, small);
      b.addEventListener("click", () => {
        $("search-dialog").close();
        navigation
          .find((x) => (x.dataset.lab || x.dataset.mode) === id)
          .click();
        $("main-content").focus();
      });
      return b;
    }),
  );
  if (!matches.length) {
    const p = document.createElement("p");
    p.textContent = "No instruments found. Try sound, motion or gravity.";
    $("search-results").append(p);
  }
}
function openSearch() {
  search();
  $("search-dialog").showModal();
  $("instrument-search").focus();
}
$("search-open").addEventListener("click", openSearch);
$("instrument-search").addEventListener("input", search);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!$("search-dialog").open) openSearch();
  }
});
const initial = location.hash.slice(1);
const initialButton = navigation.find(
  (x) => (x.dataset.lab || x.dataset.mode) === initial,
);
if (initialButton) initialButton.click();
window.addEventListener("hashchange", () => {
  const b = navigation.find(
    (x) => (x.dataset.lab || x.dataset.mode) === location.hash.slice(1),
  );
  if (b) b.click();
});
