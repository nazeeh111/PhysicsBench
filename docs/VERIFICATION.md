# Verification record

Checked 21 October 2026 against the 0.2.0 source and its freshly built distribution. These checks establish the listed software behavior; they do not establish universal correctness, scientific accuracy on real devices, or cross-platform compatibility.

## Passed locally

| Check | Evidence and scope |
| --- | --- |
| `npm test` | **54/54** tests pass on Node.js 24.14.0/macOS. Includes the original 30 model/file tests, 8 regression tests, 11 audio tests, 4 sweep tests and 1 preview boundary test. |
| `npm run build` | Thirteen allowlisted production assets built and hashed; production modules and local resource references validated. No production package dependency. |
| Integrated browser | Playwright 1.62.1 with Chromium 151.0.7922.34 on macOS. Real built assets served by the loopback preview with the actual CSP. No page exceptions or failed HTTP requests during the checked workflows. |
| Mechanics interactions | Presets; invalid input preserves valid experiment; exact time scrub; original v1 session download/import; plotted quantity selection; valid/invalid sweeps; simulation-to-analysis provenance. |
| Measurement interactions | Valid two-column CSV import; malformed import retains data; switching instruments retains observations; model transfer into an existing workspace; saved dataset selection. |
| Local video | Actual generated 640×360 MP4 decoded; four manually entered time/position points; pixel units before calibration; 0.01 m/source-pixel ruler calibration; exported physical units, raw coordinates and calibration metadata. This is a software fixture, not a physical motion measurement. |
| Audio and device lifecycle | Simulation run/pause; displayed spectral history; separate mocked-media browser context confirms no automatic microphone request, canceled late streams stopped, requested capture starts, actual reported settings retained without device identifiers, navigation releases tracks/context, denial leaves a recovery path. |
| Layout and motion | No document-level horizontal overflow at 320, 390, 768, 1024 and 1280 px in mechanics/audio/analysis. Desktop screenshots at 1440 px visually inspected. Reduced-motion mechanics uses Step. |
| Keyboard/dialog workflow | Instrument search via native dialog, search result activation, focus target, field guide and Escape dismissal. Controls retain native labels/focus styling. This is not a full screen-reader audit. |
| Independent review | Scientific math, data validation, acquisition lifecycle, distribution and integration reviewed separately. Found navigation discarding measurement work; fixed by retaining mounts and verified in the integrated browser test. No other material issue identified in that scoped review. |

A separate audio-only mocked browser check exercised explicit reference-tone start/stop, audio capture roundtrip, malformed-file preservation, microphone pause and teardown. A bounded session-history adapter check exercised eight entries, no silent eviction, duplicate suppression, restore/removal and disposed cleanup. The committed integrated browser suite covers the primary end-to-end paths; the pure test suite covers capture metadata rejection and numeric fixtures.

## Reproduce

```sh
npm test
npm run build
npm start
```

In a second terminal, with Playwright available:

```sh
# Optional test tooling only. The application does not need these packages.
npm install --no-save --package-lock=false --ignore-scripts playwright@1.62.1
npx --no-install playwright install chromium
npm run test:browser
```

If an installed Playwright module should be reused, set `PLAYWRIGHT_MODULE` to its absolute `index.mjs` path instead of installing it. `BENCH_URL` defaults to `http://127.0.0.1:4173/`. `BROWSER_ARTIFACT_DIR` defaults to ignored `.browser-artifacts/`; setting it to `docs/images` regenerates README screenshots. The fixture is committed under `test-fixtures/`.

The existing GitHub workflow runs numerical tests/build on Node 22 and 24; its Node 24 check now installs isolated Playwright tooling and runs the browser suite before Pages publishing is eligible. Local checks do not by themselves prove a GitHub run passed; inspect the pull request's current checks for that status.

## Confirmed GitHub run

[Run 39693305964](https://github.com/nazeeh111/PhysicsBench/actions/runs/39693305964) passed on runtime source commit `925288b716aecd9246d502e6cebc8b9d149e009b`: all 54 tests and the 13-asset build on Node 22 and 24, plus the complete Chromium 151.0.7922.34 browser suite on Ubuntu. The log confirms real MP4 decoding, manual calibration/metadata export, preserved navigation and mocked microphone lifecycle checks executed successfully. Pages build/deploy jobs were skipped because this is an unmerged pull request. This documentation update adds the observed CI result without changing runtime source.

## Not established

- Real microphone capture accuracy, acoustic calibration, or scientific agreement with a laboratory reference.
- Firefox/WebKit execution, Windows/ChromeOS browser runs or physical device accuracy. Firefox/WebKit were not installed locally. Ubuntu headless Chromium is covered by the GitHub run above; that does not establish every Linux distribution, browser or hardware setup.
- Guaranteed frame-accurate video decoding, automatic object tracking, or correction for camera perspective/motion.
- Full assistive-technology conformance, an exhaustive security audit, or a measured tenfold improvement.
- Persistence across reload/close. Export important work; page memory and session history are deliberately temporary.

Research documents distinguish implemented features from prospective extensions. No real participant data or private media was used in these checks.
