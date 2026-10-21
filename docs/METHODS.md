# Methods and boundaries

## Mechanics

The three original analytical models and v1 session format are preserved. Full equations, signs, bounds and file contracts are in [MECHANICS.md](MECHANICS.md). Applying parameters validates the complete next state before replacing it. Presets merge their named changes into current valid conditions. The selected plotted quantity comes from that model's labeled columns.

A parameter study evaluates 41 evenly spaced input values, including endpoints, while holding all other parameters fixed. The output is horizontal projectile range, oscillator period, or collision kinetic-energy loss at contact. Collision loss is computed even when contact lies outside the animation window. A largest sampled value is a discrete result, not a proof of a continuous or global optimum. CSV records fixed parameters, varied parameter and output units.

The mechanics-to-analysis bridge passes 201 time/position states (or fewer for a degenerate duration) in metres, with model name and exact parameters. It never labels these values measured. Projectile uses height; oscillator uses displacement; collision uses body 1 position. A collision is piecewise motion: a single polynomial spanning impact is generally a poor model. The oscillator is sinusoidal; line/parabola fits are only local approximations and their residuals matter.

## Signal processing

Synthesis uses 16,000 samples/s, a 2,048-sample window, deterministic indexed noise, sine/two-tone signals and a repeating four-second linear chirp. The two-tone signal splits tone amplitude equally; added noise may exceed digital full scale and is flagged rather than silently clipped.

The pure radix-2 FFT removes the mean and applies a Hann window. One-sided spectral amplitudes use the coherent window gain; DC and Nyquist receive their endpoint treatment. Reported spectral dB values reference peak sine amplitude. RMS dBFS uses the unwindowed original samples, including any DC offset. A full-scale sine therefore has about −3.01 dBFS RMS and 0 dBFS spectral peak when on a bin. The dominant-frequency estimate applies bounded log-magnitude parabolic interpolation near the largest non-DC bin. It is an estimate, not a frequency accuracy certificate or fundamental-pitch detector. The centroid weights amplitude by bin frequency, excluding DC.

Microphone acquisition requests echo cancellation, noise suppression and automatic gain control off. Requests do not prove what the device applied; only reported settings are available, and absent fields remain unknown. Capture uses the AudioContext's actual sample rate and waveform samples. The app computes its own Hann spectrum, rather than using AnalyserNode's default Blackman-window spectral output. The device and OS can still condition the signal. No calibration establishes acoustic pressure or SPL.

The spectrogram shows successive analysis windows at roughly 12 display updates per second, with no invented wall-clock axis; pauses are omitted. The history is visual, while the export is one exact sample window. Optional speaker output is a separate sine at the first signal frequency and 2% digital amplitude. Acoustic volume depends on system settings and hardware. Pause, visibility loss and instrument navigation stop it.

Audio session input: at most 300,000 UTF-8 bytes; 32–8,192 power-of-two samples; finite normalized amplitudes bounded to ±4; 8,000–192,000 samples/s; supported signal settings. The synth UI bounds frequency to 40–6,000 Hz, gain 0–1 and noise 0–0.5. Existing v1 capture files remain readable. Failed import retains the last valid window.

## Position fitting

`analysis.js` validates 2–10,000 strictly increasing time/position pairs, each numeric magnitude at most 10¹². CSV is at most 1 MiB, two unquoted numeric columns and no expressions. A supported optional header names time and value. Formula-like cells, nonfinite values, repeated times, extra columns and malformed rows are rejected. Failed imports retain the previous observations.

Linear and quadratic ordinary least squares use centered/scaled time with two-pass modified Gram–Schmidt QR decomposition. Fits require more observations than coefficients so residual degrees of freedom are positive: at least four points for a quadratic, three for a line. Near-singular time geometry is rejected. Predictions use normalized coefficients for stability even when the displayed polynomial in absolute time would suffer cancellation.

RMSE = √(Σr²/n); residual standard deviation = √(Σr²/(n−p)). Coefficient standard errors come from the inverse triangular factor. Two-sided 95% intervals use tabulated Student-t critical values through 30 degrees of freedom and a large-sample expansion thereafter. These coefficient intervals are not prediction intervals. They assume independent normal errors with constant variance in position, and exact times/scale. R² is descriptive and does not validate the physical assumptions.

For `y = c + bt + at²`, acceleration is `2a`. A candidate `g = −2a` makes physical sense only for upward-positive vertical free flight under effectively uniform gravity and negligible drag. It does not become a gravity measurement merely because position units are metres. The synthetic demo declares its generation formula and deterministic perturbations.

## Local video

A local object URL allows the browser to decode the chosen file without uploading it. Record the same visible point at distinct paused times. X/Y coordinates and ruler endpoints refer to original source pixels, not resized preview pixels. Vertical position is upward-positive from the frame bottom. Playback seeking uses `video.currentTime`; this workflow does not claim exact decoded-frame timestamps or automatic tracking.

A ruler's real length divided by its pixel distance sets metres per source pixel. Raw tracking coordinates, source dimensions, reported duration and calibration record accompany JSON export. If a manually edited pixel length no longer matches selected endpoints, the stale endpoints are omitted. A single scalar ruler cannot resolve camera motion, perspective, lens distortion or changes in object depth.

Input limits: 200 MiB; finite duration up to 30 minutes; dimensions up to 8.3 megapixels and 3,840 pixels per side; aspect ratio at most 8:1. Preview allocations are bounded independently of source size. Browser codec support varies. Up to 10,000 points can be tracked. Invalid or undecodable replacement video leaves prior analysis observations available.

## Session lifetime and privacy

Data remains in page memory until reload/close, or until an explicit replacement/removal. Instrument navigation retains workspaces but pauses acquisition/playback. Measurement history holds eight non-demo datasets, rejects overflow without eviction, and exposes explicit removal. Returning to a saved video observation set does not reopen the original clip; the current clip controls remain separate and the UI states that limit. Export JSON retains calibration/provenance; importing observation CSV alone does not recover those metadata automatically.

The app has no backend, account, analytics, external fonts or network data transmission. CSP blocks fetch connections; local media blob URLs are permitted. External reference/GitHub links open only when selected. Static hosting can still receive ordinary page/asset requests and log them. This is not a claim about the hosting provider's independent logging policy.
