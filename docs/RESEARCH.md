# PhysicsBench: research and design rationale

Research checked 21 October 2026. This document records primary-source precedents, feasibility limits and proposed mechanisms. Source descriptions are not local replications. It does not assert that every proposal below is implemented; the README and verification report describe the delivered build.

## Direction

Make a laptop a useful experimental bench by connecting **predict → measure → compare → explain → export**. Keep deterministic simulations available without hardware or permission. Add opt-in microphone experiments, calibrated video measurements and honest data analysis where capabilities allow. The strongest portfolio story is a coherent bridge between models and observations, supported by reproducible artifacts and visible limits.

This is a synthesis of established approaches, not a claim that browser laboratories, spectra, video tracking or experiment notebooks are new. “10x” expresses the ambition; no tenfold improvement has been measured.

## Twelve useful precedents

The transfer column contains design proposals for PhysicsBench, rather than claims about those products.

| Precedent and primary source | Source-reported mechanism | Transfer and boundary |
| --- | --- | --- |
| [phyphox](https://phyphox.org/) and [experiment format](https://phyphox.org/docs/file-format/) | Phone sensor experiments, analysis, export and browser remote control; configurations describe inputs, analysis, views and export. | Treat each experiment as a reproducible specification. A browser remote view does not give a laptop a phone's sensors. |
| [PhET](https://phet.colorado.edu/en/about) | Interactive simulations show motion, graphs and numbers together, with immediate feedback and constrained exploration. | Link scene, time cursor, plots and measurements. Favor understandable controls over a huge parameter wall. PhET's educational findings do not establish PhysicsBench's learning outcomes. |
| [Tracker](https://opensourcephysics.github.io/tracker-website/help/intro.html), [calibration](https://opensourcephysics.github.io/tracker-website/help/stick.html), [autotracker](https://opensourcephysics.github.io/tracker-website/help/autotracker.html) | Manual and automatic video point tracking, real-distance scale calibration, model overlays and analysis. Template matching can stop for poor matches. | Calibrate two points, preserve manual correction and overlay a model. Keep motion in one plane and calibration in that same plane. An automatic tracker needs explicit confidence and failure handling. |
| [Falstad / CircuitJS](https://www.falstad.com/circuit/) and [JavaScript interface](https://www.falstad.com/circuit/doc/js-interface.html) | Browser circuit simulation, text import/export and a documented embedding interface. Controlling page and simulator must share an origin. | Save editable experiment state and make cause and effect visible. Do not treat an external iframe as an integrated measurement engine or copy licensed code without reviewing its terms. |
| [Arduino Science Journal](https://www.arduino.cc/education/science-journal/) | Mobile sensor recording, scientific-method activities and optional external Bluetooth sensors. | Add observation notes and repeated trials beside data. Its phone/board capabilities are not baseline laptop capabilities. |
| [iOLab](https://www.iolab.science/index.html) and [calibration workflow](https://www.iolab.science/running-application.html) | Dedicated hardware supports many physical sensors; software records and analyzes signals. Its web app still uses an iOLab device. | Adopt explicit acquisition state and calibration records. A no-purchase build cannot inherit its force, voltage, pressure or temperature measurements. |
| [Chrome Music Lab](https://musiclab.chromeexperiments.com/Spectrogram/) | Account-free browser experiments use Web Audio and other public browser technologies. | Make the first useful result immediate: a visible waveform or spectrum. A compelling visual is not calibrated scientific accuracy. |
| [CODAP](https://codap.concord.org/about/) | Free, open-source browser analysis and visualization without a required account. | Keep tables and plots linked and export data locally. Measurement interpretation should remain inspectable. |
| [JupyterLite](https://jupyterlite.readthedocs.io/en/stable/) | Browser computation, local browser storage and static hosting without a dedicated application server; some full Jupyter features are unavailable. | Export a complete run with inputs, transformations and outputs. A notebook runtime is a future optional extension, not necessary for a lightweight bench. |
| [Observable Plot](https://observablehq.github.io/plot/) | Layered marks, scales, data transforms and small multiples support exploratory charts. | Separate observed points, model curves and residuals using meaningful visual encodings. The free plotting library does not require adopting a paid hosted platform. |
| [GeoGebra sliders](https://geogebra.github.io/docs/manual/en/commands/Slider/) | Bounded parameter controls with configurable increments and animation. | Expose physically meaningful ranges and units. Keep the equations visible so the control is an explanation tool. |
| [lab.js](https://lab.js.org/) and [timing guidance](https://labjs.readthedocs.io/en/latest/recipes/timing-performance/) | Browser experiment assembly; timing-sensitive studies need deliberate design and measurement. | Represent a protocol as trials with saved settings. Browser display/keyboard latency cannot be assumed to be laboratory-grade timing. |

## Competing routes and decision

1. **A larger simulation atlas:** broadly portable and straightforward to verify, but more topics alone do not create an experimental laboratory. Retain strong simulations as the baseline.
2. **A sensor-heavy phyphox clone:** exciting when real sensors exist, but laptop sensor availability, browser permissions and calibration dominate the experience. Do not promise arbitrary laptop accelerometers, magnetometers, thermometers or barometers.
3. **A model-to-measurement bench:** use standard browser capabilities where available, local files elsewhere, and one run format. This makes an existing simulation useful for interpreting observations. Prefer this route because it combines practical portability with an assessable technical contribution.

The ambitious extension is an **experiment compiler**: a small declarative recipe chooses a source, validates units, applies transforms, compares a model and produces a replayable report. Its hardest assumption is that one schema can preserve enough source metadata and calibration to replay meaningful results. Prove that with two materially different sources before generalizing into a plugin framework.

## Microphone: feasible, with explicit limits

The [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#AnalyserNode) defines waveform and FFT analysis. Its frequency analyser applies a Blackman window and optional temporal smoothing; the default smoothing is 0.8. Set and record that value deliberately. Frequency bin centers follow `k × sampleRate / fftSize`; bin spacing is not an accuracy guarantee. At 48,000 samples/s and 8,192 samples, spacing is about 5.86 Hz and the analysis window spans about 171 ms. Use the actual audio context sample rate. Increasing FFT size trades responsiveness for finer bin spacing. Use float spectral data for computation rather than a display-scaled byte array.

Request microphone processing preferences with `echoCancellation: false`, `noiseSuppression: false` and `autoGainControl: false`, then inspect `track.getSettings()`. A requested setting is not evidence it took effect, and a missing reported property is unknown. Preserve the settings actually reported, FFT size and analysis method with exports. Prefer adaptable preferences to mandatory constraints that needlessly reject hardware. See [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/) and [constraints documentation](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Constraints).

Digital RMS level can be labeled `dBFS`, explicitly relative to digital full scale. It is not sound pressure level, `dB SPL`. A laptop speaker tone cannot calibrate absolute sound pressure because speaker gain, distance, room response and microphone response are unknown. Even phyphox's [amplitude experiment](https://phyphox.org/wiki/index.php/Experiment:_Audio_Amplitude) explains that a simple offset calibration cannot correct microphone frequency response, directionality, noise or nonlinear response. Prioritize frequency, relative comparisons and clipping/noise warnings. A dominant spectral peak may be a harmonic rather than the fundamental pitch.

A useful first proof feeds known synthetic tones through the same analysis function and checks silence, DC, off-bin frequencies, mixed harmonics and clipping. This proves parts of the digital analysis, not accuracy of a physical microphone. Actual microphone capture needs a separate device/browser check. Never monitor microphone input through speakers by default; output tones should begin only through a visible user action at conservative gain.

## Camera: measurement needs geometry and timestamps

Tracker's [calibration method](https://opensourcephysics.github.io/tracker-website/help/stick.html) uses a known distance in the plane of motion. PhysicsBench should preserve the two image endpoints, real length, units and origin. Without scale calibration, report pixels. A single pixel-to-length ratio cannot correct arbitrary perspective, camera movement or depth changes. Do not infer metric 3D motion from an ordinary webcam preview.

Use source-frame timestamps rather than animation-loop counts. The [video-frame callback API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) reports `mediaTime` and `presentedFrames`; it can reveal missed presented frames and supports work matched to video frames. It does not guarantee every captured or decoded frame is processed. Detect feature availability; do not silently substitute a screen refresh rate for camera frame rate. For uploaded video, codecs and timestamp behavior need browser checks.

Offer manual point marking as a trustworthy baseline. If color/template tracking is added, use a limited search region, display confidence, retain missed samples as gaps, and allow correction. Lighting, occlusion, motion blur and similar-colored backgrounds can break tracking. Numerical differentiation amplifies position noise, so distinguish raw points from smoothed or fitted derivatives and preserve the method. A quadratic position fit can estimate constant acceleration, but uncertainty and residuals depend on assumptions about timing, scale and measurement error.

## Cross-platform contract

The [getUserMedia documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) requires a secure context and permission. Requests may be denied, lack a matching device, fail at the operating-system boundary or remain unanswered. Provide a visible waiting/cancel path; a late successful response after cancellation must stop its tracks. Release devices on stop, navigation and error. Preserve loaded experiments when access fails. A static HTTPS host or localhost is the intended environment.

“Any laptop” should mean a broadly compatible core in current desktop browsers with graceful optional capabilities, not a promise about all hardware, browsers or operating systems. Simulation and local datasets remain useful without microphone or camera. A capability panel should distinguish **API present**, **permission pending**, **permission denied**, **device acquired**, and **live data observed**. Do not infer successful measurement from API presence.

## Evidence needed for portfolio claims

A convincing repository should include a current screenshot, a short local workflow, equations and assumptions, explicit compatibility limits, a sample replayable run, architecture boundaries and a reproducible verification command. Real datasets must be labeled with their acquisition method; synthetic samples must be labeled synthetic. Report model tests, browser interaction checks and hardware checks separately. Avoid “scientifically validated,” “works on every laptop,” “professional sound meter” or performance multipliers without the corresponding evidence.

A credible resume description should state the implemented mechanism and measured scope: for example, a static browser laboratory combining deterministic mechanics, opt-in local acquisition and replayable experiments, with tests for numerical identities and data validation. Adjust it to the delivered build instead of presenting this research roadmap as completed work.
