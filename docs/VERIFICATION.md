# Verification record

Current investigation revision checked on 21 October 2026. Results below concern software behavior and controlled specimens; they do not establish physical device accuracy or universal compatibility.

## Scientific checks

`npm test` passes **89 tests** on Node 24.14.0 locally:

- 20 acoustic identification checks: independent time-domain convolution fixtures; unseen reflection/latency cases; simple baseline; held-out output mutation cannot alter fitted coefficients/alignment; shifted/attenuated probe rejection; noise and silence; nonlinear mismatch; complete late-tail scoring; canonical source verification; capture gaps; explicit band-limited pre-ringing.
- 9 image-tracking/motion checks: lighting/noise/distractors, occlusion, ambiguous duplicate targets, bounded search, flat/boundary templates, pixel conversion, worst-case coefficient sensitivity and complete motion-record validation/roundtrips.
- 2 actual processor-code VM checks: exact emitted/recorded samples and continuity metadata; missing input plus skipped render frames are recorded rather than hidden as silence.
- 4 experiment-format/comparison checks: float32 byte roundtrips, size/schema rejection, matched repeated conditions and SHA-256 identity derived from raw recording bytes.
- The previous 54 tests covering mechanics, bounded interchange, regression, signal analysis, sweep studies and preview boundaries.

The dependency-free static build produces 21 allowlisted assets and a deterministic manifest. This count describes distribution scope, not scientific quality.

## Integrated browser

The committed browser runner serves the freshly verified distribution on an ephemeral loopback port. Playwright 1.62.1 / Chromium 151.0.7922.34 passed these workflows locally:

- Canonical acoustic reference; nonlinear and silent controls rejected/withheld.
- Waveform detail selection leaves the full held-out score unchanged.
- Complete raw record export and reopen recompute analysis; invalid/missing acquisition identity preserves prior work.
- IndexedDB persistence across reload, replacement of the same acquisition, four separate A/B acquisitions and matched comparison.
- Generated Canvas pixels → NCC observations → x/y motion inference; 25 observations recover approximately −9.816 m/s² versus source truth −9.81. This is an image/software test, not a physical gravity measurement.
- Straight-line model mismatch approximately 1.28 m versus ballistic mismatch 0.00803 m for that generated specimen. These are training-fit errors, not held-out motion prediction.
- Occlusion stops tracking with a gap. Linked chart/time controls, point exclusion and undo preserve observations.
- Actual local MP4 decode, presented-media timestamps and source attachment.
- Portrait-video canvas clicks map through the visible image (not its letterbox), and a rejected oversized replacement leaves the exported file identity, dimensions and track unchanged.
- Retained mechanics presets/sweeps/model-to-data handoff, reduced-motion stepping and methods dialog.
- No document horizontal overflow at 320, 390, 768, 1024 and 1280 px; desktop inspection at 1536 px. Scientific chart labels redraw at display size on resize, including high-density displays; chart selection retains the correct time coordinates. Current screenshots are under `docs/images/v3/`.
- Real AudioWorklet execution in an OfflineAudioContext, using a controlled digital reflection path: full-model normalized prediction error about **0.00111 (0.11%)**, versus **0.3712 (37.1%)** for a trained delay-and-gain baseline. 55,200 samples retained; no missing inputs/render discontinuities. This exercises actual processor execution without microphone or speaker hardware.
- Controlled pending-permission mock, cancellation and late-granted stream release. No physical microphone was recorded.

The runner writes a small browser-evidence JSON beside screenshots. It asserts no browser page errors or failed HTTP assets in the checked workflows. Optional API/device failures outside these cases are not thereby proven correct.

## Independent review

A separate reviewer found four material weaknesses, all corrected and retested:

1. Unexplained late output after finite model support escaped the score. Full retained probe-tail scoring with zero-extension now catches it.
2. Missing input blocks and render-frame jumps were hidden by zeros. Processor metadata and rejecting quality flags now preserve those defects.
3. A narrowband substitute could masquerade as the broadband protocol. Exact canonical float32 source verification now rejects it.
4. Missing acquisition identity could relabel a replay as a new repetition. Bounded identity validation plus independently recomputed raw-record SHA-256 fingerprints prevent ordinary duplicate replay in comparisons.

Review also prompted atomic source/result replacement across asynchronous hashing and a distinct estimator-version field. Reverification confirmed the four scientific/import fixes, captured metadata propagation and duplicate/level mismatch rejection. This was a scoped review, not an exhaustive security audit.

## Reproduction

```sh
npm test
npm run build
npm run benchmark
```

Optional browser tooling, separate from production:

```sh
npm install --no-save --package-lock=false --ignore-scripts playwright@1.62.1
npx --no-install playwright install chromium
npm run test:browser
```

Or reuse an installed Playwright module via `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs`. `BENCH_URL` optionally targets an already running local preview; unset it to test the runner's own freshly verified ephemeral server. `BROWSER_ARTIFACT_DIR` defaults to ignored `.browser-artifacts/`; use `docs/images/v3` to regenerate presentation screenshots.

`npm run benchmark` measured about 37 ms warmed median at 48 kHz on the current Node/macOS host in one local run. Browser messaging, hashing/encoding, worker startup and other devices are excluded; rerun rather than treating this as a portable performance guarantee.

[GitHub run 39700454515](https://github.com/nazeeh111/PhysicsBench/actions/runs/39700454515) passed on investigation source commit `0cf653a7d9be34b7444bb5ae4fe74c94ebb27f6b`: Node 22 and 24 tests/build, plus the complete Ubuntu Chromium integration suite on Node 24. Its log confirms 89 passing tests, the 21-asset build and the same offline AudioWorklet results above. Pages build/deployment were skipped on the PR, as intended. Later documentation-only revisions do not change that tested runtime; inspect the PR's current checks for its latest head.

## Unverified limits

Physical speaker/microphone accuracy and acoustic calibration; physical camera measurement validation; Firefox/Safari execution; Windows/ChromeOS physical hardware; full assistive-technology conformance; exhaustive security/performance behavior; scientific novelty or a measured tenfold advantage over competing tools.

The application provides explicit reference specimens and optional physical acquisition paths. It does not fabricate real hardware evidence when access or validation is unavailable.
