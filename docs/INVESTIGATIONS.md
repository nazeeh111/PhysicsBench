# Investigation methods

## Acoustic identification

The versioned `ac-id-v1` source is one continuous 3.45-second sequence: 0.15 s quiet, 1.5 s logarithmic sweep, 0.6 s tail, 0.6 s independent seeded band-limited probe, 0.6 s tail. The sweep excites 150–6,000 Hz (bounded by sample rate); the probe occupies an interior band to avoid unsupported edges. Peak digital source amplitude defaults to 0.03, not a calibrated acoustic level. Amplitude and seed determine canonical float32 source values. Imports must reproduce those values exactly; a single tone cannot pretend to be a broadband experiment.

Training-only regularized inversion uses `H = Y·conj(X) / (|X|² + λ)` with a frequency-band taper. Correlation and the recovered response locate arrivals using training only. A 250 ms effective impulse response, with a short leading region and terminal taper, forms a finite linear model. The band limit creates mathematical ringing that can precede the dominant peak, including a negative effective offset for near-zero-latency sources. This is not evidence of physical pre-echo or acausal hardware.

The model predicts the independent probe by convolution using its training-derived offset. Scoring covers the full protocol-defined retained probe tail, zero-extending the prediction beyond finite model support. Neither held-out alignment, gain, model support nor a favorable crop is fitted. Late unexplained energy therefore counts against the model. A delay-and-gain baseline uses a scalar gain trained on the sweep and the same held-out interval.

Normalized RMSE is `√(Σ(y−ŷ)² / Σy²)`. Ambient RMS is estimated from the independent prequiet interval. A noise-adjusted error subtracts estimated ambient power from error and response powers only when positive signal power is resolved. Silence cannot win by having a small absolute error. The exploratory screening rule requires sufficient signal, no clipping or reported processing/capture defects, and noise-adjusted normalized error no greater than 0.35. This heuristic threshold is not a calibrated metrology acceptance criterion. A low error does not prove general linearity, and failure does not identify its cause.

`acoustic-linear-v2` identifies the current estimator/scoring revision separately from the source protocol version. Raw source and response remain authoritative. Imported cached summary values are recomputed.

### Acquisition

One AudioWorklet emits the known source and records the mono input in the same render timeline. Input absence, short blocks, nonfinite samples and discontinuities in `currentFrame` are retained as explicit capture-health metadata and reject interpretation. Replacing missing blocks with unmarked zeros is not allowed. Start/end frames, sample count, capture timestamp and timing description accompany real records.

The microphone request asks for echo cancellation, automatic gain control and noise suppression off. Only non-identifying settings actually reported by the browser are recorded. A request is not evidence that it took effect; absent values remain unknown. A late permission grant after cancellation stops its tracks. Cancellation, navigation, visibility loss, error and completion release microphone and output resources. Input is not routed directly to the speakers.

The identified path includes speaker response, microphone response, room acoustics, browser/device processing and latency. No calibrated sound pressure, absolute propagation distance, room-only response or RT60 is inferred. The finite remaining-energy plot is not a reverberation-time certificate. Real hardware accuracy is untested.

### Repeated conditions

A/B comparison requires two distinct, successful acquisitions in each of exactly two conditions, matching source, protocol, sample rate, output level/band, setup identity and reported processing. Both acquisition IDs and SHA-256 raw-record fingerprints must be unique. Identical data with new labels cannot become replication.

The compared quantity is impulse energy after 8 ms relative to the dominant arrival, divided by energy in the finite identified response. Reported repeat standard deviations and standard errors describe those repetitions. The displayed three-standard-error rule is exploratory, especially with small sample counts; it is not a causal test or formal confidence guarantee. Physical geometry, system volume and uncontrolled changes remain user-supplied assumptions. Virtual repetitions keep a fixed kernel per condition and vary only ambient noise realization.

## Motion inference

The generated specimen renders a textured target into Canvas pixels. Observations come from matching those images; no trajectory equation is inserted into the observation table. The known source recipe is preserved so a saved generated investigation can reopen its pixels. An occluding obstacle deliberately tests failure behavior.

Tracking uses normalized cross-correlation over a bounded search region with a fixed selected template. Both minimum similarity and a separated competing-match margin must pass. A similarity score is not a confidence probability. Occlusion, ambiguity or leaving the search window stops the batch and preserves a gap. Tracking never silently fills missing positions. Batches are bounded; corrections/manual seeds can resume work. Undo stores bounded prior investigation states.

Local video uses decoded image pixels and `requestVideoFrameCallback` media times when available. A requested seek time is not assumed to be the presented frame's time. Source reattachment checks file metadata and preserves observations. Automatic timing is unavailable where the browser cannot provide the required evidence; manual alternatives remain visible. Browser frame delivery is not guaranteed exact or exhaustive.

Raw source x/y pixels are retained. A known ruler distance, endpoints, origin and y direction map them into physical coordinates. Ruler and motion must share a plane with a fixed camera. A single scale cannot correct perspective, lens distortion, camera movement or motion in depth.

Competing fits are straight lines in both axes; ballistic horizontal-line/vertical-quadratic motion; or separate quadratics in both axes. QR regression centers/scales time. The displayed 2D RMSE is an in-sample mismatch. More parameters can reduce it without proving the physical model. A quadratic coefficient becomes a gravity interpretation only under the stated camera, scale, free-flight and drag assumptions.

Sensitivity uses worst-case independent point-coordinate bounds through the quadratic coefficient weights plus ruler-scale bounds. It is not a probabilistic confidence interval and excludes timestamp errors and geometric systematic errors. Exclusions are retained, with raw positions and correction methods.

## Records and replay

`physicsbench-investigation` v1 wraps a typed acoustic or motion payload with title, UUID and timestamp. Complete imports are bounded to 12 MiB. Acoustic source/response use exact little-endian float32 base64 packets, not rounded chart samples. The decoder checks length, encoding, numeric finiteness and supported normalized range. The analyzer then checks exact source protocol content and recomputes the result.

Motion records retain a stable investigation UUID, source metadata/recipe, x/y observations, timestamps, inclusion flags, gaps, model, fit window, cursor, calibration, tracker settings, question and notes. A plain motion payload is accepted by the motion importer and the global investigation importer. Source video bytes are not embedded; reattach the original clip for pixel inspection/correction. Reopening validates the candidate before replacing valid work.

IndexedDB stores up to 40 complete runs, with the limit and replacement enforced in a read/write transaction. Records are not silently evicted. Browser storage clearing, private modes and quota policies can remove or prevent persistence; failures are shown and export remains available. Raw media and samples are not uploaded by the application. Ordinary static-host requests may still be logged by the hosting provider.

The retained v0.2 tools use their original bounded formats. Mechanics v1 sessions/model CSV and sound-window sessions are separate utilities, not full v0.3 investigation records. Their formats remain documented in MECHANICS.md and METHODS.md.
