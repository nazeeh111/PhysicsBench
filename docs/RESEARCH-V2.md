# PhysicsBench research decision: a model must predict a new sound

Date: 2026-10-21. Research by direct inspection of original methods, official API specifications, comparator documentation and selected source files. This document proposes a design; it does not certify an implementation or a physical microphone measurement. No hardware accuracy experiment was performed during this research.

## Decision

Make the flagship investigation: **Can a model learned from one sound predict a different sound?**

An ordinary laptop supplies an actuator (speaker) and a sensor (microphone). Emit a known logarithmic sweep, retain raw samples, infer the combined audio system's impulse response, and use that fixed model to predict an independently generated broadband probe. Show measured output, prediction and unexplained residual together. Let users change one physical condition and repeat the investigation. Retain the complete acquisition and analysis settings so another person can reproduce the conclusion.

This changes the interaction from displaying a signal to testing an explanation. It is feasible without a GPU, phone, account or separately billed API. It is an engineering and educational product direction, not a claim to invent system identification or to achieve a measured tenfold gain.

**A sweep-to-impulse-response widget alone is insufficient differentiation.** Close browser precedents already exist. The difficult part worth building is honest independent prediction with preserved timing, meaningful baselines, failure examples and reproducible evidence.

## What the comparisons actually show

| Comparator and inspected evidence | Concrete mechanism or capability | Consequence for PhysicsBench |
| --- | --- | --- |
| [REW measurement manual](https://www.roomeqwizard.com/help/help_en-GB/html/makingmeasurements.html) | Configurable sweeps, capture timing references, clock mismatch correction, level checks and synchronous averaging. Its manual explains that clock mismatch can distort phase/IR and repeated sweeps can produce false multiple peaks when synchronization changes. | REW is the stronger conventional measurement tool. Browser convenience does not establish better accuracy. Preserve sample timing and expose clock/latency limitations. |
| [REW impulse response explanation](https://www.roomeqwizard.com/help/help_en-GB/html/impulseresponse.html) | Separates sweep-derived linear response from earlier distortion responses; controls the time window used for frequency response. | The window is part of the measurement definition. Store it. Do not label every peak as a physical echo. |
| [Open Sound Meter measurement source](https://raw.githubusercontent.com/psmokotnin/osm/master/src/source/measurement.cpp), [coherence source](https://raw.githubusercontent.com/psmokotnin/osm/master/src/math/coherence.cpp) | Measurement code routes reference and measurement samples, applies delay/calibration, calculates transfer magnitude and phase, averages IR estimates, and stores acquisition settings. Coherence accumulates reference/output power and cross spectra over depth, rather than computing confidence from one FFT. Its scalar value method returns magnitude coherence, not squared coherence. | Adopt explicit reference/output provenance and repeatability. Do not copy implementation or call a single-frame spectral ratio a confidence estimate. Source is GPL; this research is a method comparison, not permission to copy it into MIT code. |
| [Friture delay-estimator source](https://raw.githubusercontent.com/tlecomte/friture/master/friture/delay_estimator.py) | Requires two audio channels, decimates, uses generalized cross-correlation, smooths successive correlation functions, and finds signed delay. A heuristic maps peak significance to a display score. | It goes beyond a spectrum plot. A heuristic significance indicator must not be presented as calibrated probability. Do not apply a two-channel reference assumption to an unreferenced microphone. |
| [Tracker autotracker manual](https://opensourcephysics.github.io/tracker-website/help/autotracker.html) | RGB template matching, subpixel interpolation, prediction of search location, evolving/tethered templates, and deliberate stops for weak matches. | Automatic camera tracking is feasible, but already conventional. A credible version needs confidence stops, editable corrections and geometry/timing control. |
| [phyphox sonar method](https://phyphox.org/wiki/index.php?title=Experiment:_Sonar), [acoustic stopwatch](https://phyphox.org/experiment/acoustic-stopwatch/) | Short transmitted sounds with recorded echoes; threshold-based timing between sound events. The sonar documentation explicitly warns that random-room echoes are nearly impossible to interpret without shielding unwanted directions. | Do not promise room geometry or absolute wall distance from an uncalibrated laptop response. Acoustic events can still support strong bounded experiments. |
| [audioJS browser measurement](https://audiojs.dev/util/measure/), [package description](https://github.com/audiojs/measure) | In-browser sweep, microphone capture, IR, frequency response, latency and T20-style RT estimate. Package documents inverse-sweep convolution and identity calibration. | This is a close precedent, not an obscure adjacent inspiration. The next capability must exceed the one-measurement plot. Package internals were not fully retrieved, so robustness is not independently established here. |
| [Sensing Studio room response](https://sensingstudio.org/room-impulse-response/) | Sweep acquisition, raw waveform, IR, Schroeder decay, RT display, WAV export, and synthetic-room listening. | Both real/synthetic modes and auralization already exist in the browser. They are useful features, not novelty claims. |
| [IR Maker](https://www.haukesteinbach.de/ir-maker.html) | Local reference/recording import, regularized inverse filtering, optional noise reduction and IR export. | File import and export are part of the baseline. Do not destructively denoise the evidence used to claim predictive accuracy. |
| [acoust.org demo](https://acoust.org/demo/) | Narrow 18–22 kHz chirp, deconvolution, reflection features and broad space classification. It states that laptop speakers can be weak in this band and one recording cannot reconstruct a room shape. | Avoid ultrasound as a general laptop assumption. Narrowband classification does not provide broadband physical identification. |

The accessible [AcoustiVision Pro preprint](https://arxiv.org/html/2602.12299v1), posted 11 February 2026, also describes uploaded/dataset IR analysis, many acoustic metrics, auralization and visualizations. Its reported evaluation was not replicated. More metrics would not distinguish PhysicsBench, and standards-compliance claims would require independent examination of applicable standards and measurement conditions.

## Mathematical contract

### What is identified

Model the **whole digital-output-to-digital-microphone chain**, not a room in isolation:

`y[n] = sum(h[k] * x[n-k], k=0..L-1) + e[n]`.

Here `x` is the exact emitted digital signal, `y` the captured samples, `h` a finite impulse response and `e` everything the fixed linear model does not explain. Speaker response, microphone response, operating-system processing, propagation, reflections and capture/output delay all contribute. Without separate calibration, they cannot generally be factored into independent physical causes.

[Farina's original AES 2000 paper](https://www.angelofarina.it/Public/Papers/134-AES00.PDF), particularly pp. 2–6, derives exponential sweeps and inverse-filter deconvolution. It discusses padding/silence, time aliasing and the placement of harmonic-distortion responses before the linear response. For conventional ESS, with `r=f2/f1`, use `L=T/log(r)` and `x(t)=A*w(t)*sin(2*pi*f1*L*(exp(t/L)-1))`; `w` is a known endpoint fade. A time-reversed sweep requires exponential amplitude compensation; reversing alone is not inversion.

[Novak's author implementation and theory](https://www.ant-novak.com/pages/sss/) supplies exact synchronized-sweep formulas and example code. Its phase convention differs from the conventional zero-start formula. Synchronization is consequential for higher harmonic phase and nonlinear modeling. Do not promise harmonic kernels merely because ordinary linear deconvolution works.

A practical linear estimate is `Hhat[k]=Ytrain[k]*conj(Xtrain[k])/(abs(Xtrain[k])^2+lambda[k])`, followed by inverse FFT and a declared finite causal support/window. This is a regularized frequency-domain estimate, not an exact noise-free inversion. Record the regularization, FFT size, support and band mask. Convolution must have sufficient zero padding (`FFT length >= input length + FIR length - 1`) to prevent circular wrap. Verify amplitude with identity and gain fixtures, not plot normalization. Discarding late samples changes the model and can cause prediction error.

### Timing and leakage are decisive

1. Generate sweep and probe from the same continuous audio processing graph; record the exact emitted reference and captured input with shared sample indices. An AudioWorklet can generate output and capture input during the same processing callback. The microphone must not be routed audibly back to the speakers.
2. Use a continuous recording with pre-silence, training sweep, capture tail, silence, independent probe, and probe tail. Retain segment boundaries in sample indices. Learn any delay/gain correction using training only. Preserve sufficient silence/tail for the longest modeled response.
3. A sample-aligned audio graph does not remove physical I/O delay or independent device-clock drift. Include learned latency in `h`, or store an explicit training-derived delay applied consistently to prediction. It is not pure acoustic time of flight.
4. Compute `ypred = h * xprobe` on the retained time coordinate. Compare with the matching captured segment. Do not optimize delay, gain, crop, regularization, support or band using held-out output and still call the same data independent validation.
5. If best realignment is useful as a diagnostic, label it separately and keep the fixed-model score. A low score after moving the traces until they overlap is not independent physical prediction.

The [Web Audio specification](https://webaudio.github.io/web-audio-api/) defines graph sample time, worklet `currentFrame`, sample rate and processing blocks. Use the actual array length, not an assumed 128-sample block. Chunk sequence/frame continuity should detect missing data. Retain chunks in bounded buffers and transfer them in batches; run large FFTs off the audio thread. A graph frame counter does not prove that hardware captured without glitches or that two device clocks match.

### Probe, scores and baselines

Use a separately seeded broadband signal occupying the training band, with known fades and amplitude. A concrete conservative initial excitation band is 300 Hz–8 kHz, clipped below Nyquist; this is a proposal to validate, not a guarantee of every laptop's response. A sweep and a probe should test overlapping frequencies. Unexcited bands must not receive response claims.

Keep two baselines: silence, and a delay-plus-gain model `h0[n]=g*delta[n-d]` whose `g,d` are estimated on training. Complex reflected systems should be better predicted by a full FIR than by this simple baseline; an identity path need not show improvement. Retain every model's actual residual, including negative improvement.

Report RMS residual, RMS measured output, and `NRMSE = norm(y-ypred)/norm(y)` after a declared common analysis filter and fixed crop. Optionally report `10*log10(sum(e^2)/sum(y^2))`. State the exact denominator. These are errors, not probabilities or universally calibrated quality scores. Independently show ambient RMS from silence, capture peak/clipping and output-to-ambient contrast. Silent capture cannot pass merely because absolute residual is tiny. Ambient noise has to be measured in the same digital units and analysis band as the residual; an IR noise estimate has different units.

Training estimation noise can contribute to prediction residual, so residual/ambient ratio is a diagnostic rather than an automatic proof of nonlinearity. Input-correlated residual can indicate unmodeled response, but colored environmental noise need not be white. [MathWorks' system-identification validation guidance](https://www.mathworks.com/help/ident/ug/validating-models-after-estimation.html) explicitly separates estimation and validation and requires compatible frequency content/preprocessing. Its [residual analysis documentation](https://www.mathworks.com/help/ident/ug/what-is-residual-analysis.html) explains input/residual independence and the distinction between dynamics and disturbance models.

### Probe level matters

A same-level held-out probe tests a bounded operating condition. Add an explicitly lower-amplitude probe as a separate challenge. Do not silently rescale microphone output to make an amplitude-dependent system look linear. This can expose AGC/compression or clipping behavior, but failure alone does not diagnose the particular cause.

The [Schoukens, Vaes and Pintelon author postprint](https://arxiv.org/pdf/1804.09587), published in IEEE Control Systems Magazine in June 2016 and uploaded to arXiv in 2018, explains best linear approximations and nonlinear-distortion experiments. Its Fig. 2 and accompanying example use an independent amplitude-varying validation input to expose operating-range limits. A successful linear residual test under one input distribution does not establish universal linearity. For a later extension, random-phase multisines with deliberately unexcited detection lines can separate some nonlinear contributions; do not approximate that method by counting arbitrary FFT peaks.

## Honest acquisition and optional decay

Request echo cancellation, noise suppression and automatic gain control off, inspect both supported capabilities and resulting settings, and record unavailable settings as unknown. The [Media Capture specification](https://w3c.github.io/mediacapture-main/) defines those controls and capability reporting. A successful constraint request is not independent evidence that all OS/hardware processing disappeared. Show retained settings and let an amplitude challenge expose some violations.

Store source kind separately: synthetic ground truth, imported recording, or live capture. An exported JSON should retain sample rate, exact reference samples or a versioned exact generator/seed, captured PCM, segment boundaries, model settings, inferred response, scores, acquisition flags and app version. Export WAV/CSV where useful. Imported IR-only data can support decay and response analysis, but cannot validate an unseen probe recording that does not exist.

Do not make a decorative RT60 value the headline. [REW's decay documentation](https://www.roomeqwizard.com/help/help_en-GB/html/graph_rt60.html) explains backward integrated squared IR, T20 fitting from -5 to -25 dB and T30 from -5 to -35 dB. It also explains why domestic low-frequency modes and early/direct decay can invalidate a diffuse-field RT interpretation. The backwards sum includes noise and finite-tail bias. Require sufficient range above noise, a declared fitting interval, adequate tail and a usable fit; otherwise withhold the extrapolated time. Band filters themselves can ring. Any heuristic quality thresholds must be labeled as application heuristics, not ISO certification.

Coherence is optional and only meaningful with averaging over independent segments/trials. The [SciPy definition](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.coherence.html) uses Welch estimates and `abs(Pxy)^2/(Pxx*Pyy)`. For one unaveraged spectral pair that ratio is trivially one at nonzero bins. Repeated deterministic sweeps can assess repeat stability after declared training alignment, but this does not calibrate the speaker/microphone chain or prove a room-only response.

## Physical A/B investigation

After the predictive model works, compare a declared physical intervention while maintaining device, volume, geometry and acquisition settings. Store the question and order of trials. Start with at least three repeats per condition and show every trace plus within-condition spread. Alternate A/B if returning the setup is practical, because sequential blocks confound drift with intervention.

For each declared band, compare `20*log10(abs(HB)/abs(HA))` only where both captures have adequate excitation and usable signal. Use preserved absolute digital gain for amplitude claims; independent normalization would erase gain changes. Separate shape-normalized diagnostics if provided. Do not call replicate min/max a confidence interval. Pointwise intervals, if added, do not automatically establish significance across hundreds of frequencies. A visible effect smaller than ordinary repeat spread supports an inconclusive result, not a forced winner.

## Why not lead with the other mechanisms

**Automatic video inverse mechanics** remains the best second complete investigation: detect a colored marker/template, preserve frame timestamps, calibrate a reference in the motion plane, estimate constant-acceleration or damped-oscillator parameters, and test prediction on withheld frames. Tracker demonstrates the needed stops and corrections. [WebCodecs](https://www.w3.org/TR/webcodecs/) gives presentation timestamps; those timestamps are not guaranteed physical exposure times. Container demuxing/decoding, occlusion, blur, perspective and calibration uncertainty remain real work. Assuming arbitrary webcam footage yields accurate gravity would be weak. This direction is valuable when implemented with data, not a generic object-detection label.

**Single-laptop sonar/room reconstruction** has a harder identifiability barrier: multiple surfaces contribute ambiguous echoes, source and microphone are separated, and emission-to-capture latency contains hardware/OS delay. Even a perfect delay sample grid does not imply equivalent distance accuracy. Bandwidth sets correlation-peak resolution, while echo path geometry determines what distance means. A single mic's response cannot uniquely determine wall layout.

**Multimodal AI inference** adds synchronization and identifiability burdens before delivering a concrete measurement. Browser/video/audio timestamp origins are not automatically shared. Using a neural label does not remove camera calibration, source spectrum or timing errors. Keep this as a later question tied to a falsifiable benefit, not a flagship claim.

## Proof that would earn the implementation

These are proposed acceptance checks, not completed results:

- Independent direct-convolution fixture generator with several unknown FIRs: identity, signed gain/delay, multiple reflections, resonant/decaying tails, plus added colored noise. Use different seeds and signals for training and held-out probes.
- Assert identity amplitude and impulse timing. Compare recovered transfer response only inside the excited band. Compare predicted output to independently produced held-out output. Require materially lower error than the simple trained baseline in the reflection-rich cases; do not demand superiority on identity.
- Explicit adversarial failures: silence, clipped output, level-dependent gain, moving delay/time stretch, insufficient tail, probe outside training band, missing chunk, truncated input, and capture interruption. The interface must show a poor or unavailable result rather than a reassuring default.
- Leakage check: changing held-out output must not change the estimated IR, selected delay/gain, regularization or analysis crop. Changing the synthetic oracle must not silently change the solver's ground truth.
- Browser checks exercise actual worklet chunks, start/cancel, permission denial, errors, navigation cleanup, downloaded session replay and fresh render. Simulated devices establish lifecycle behavior, not microphone accuracy.
- A reproducible imported reference/recording/probe fixture can prove file interoperability. A real external IR by itself cannot prove full live acquisition or independent probe prediction.
- Physical feasibility remains unverified until actual permissioned capture on ordinary laptop hardware succeeds, with recorded settings, raw samples and declared scoring. Broader hardware accuracy needs more than one successful machine.

The defensible first delivery is a complete, inspectable prediction experiment with honest simulated/imported/live states. A measured claim of superiority requires running the same task against the strongest relevant conventional tool under matched conditions. No present evidence supports a universal accuracy claim, scientific novelty, room reconstruction or a numerical 10x result.
