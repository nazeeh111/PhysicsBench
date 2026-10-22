# Example inputs

All examples are **generated**, not observations from a physical experiment.

- `earth-projectile-session.json`: open through mechanics **Open session**. The original v1 model format.
- `synthetic-projectile.csv`: import through **Motion & data**. Time is seconds, height is metres. Set value units to metres after importing. Ground truth: `y=0.4+6.7t−4.905t²` plus deterministic small perturbations; g=9.81 m/s². It demonstrates regression and residuals, not physical validation.
- `sine-440-audio.json`: open through sound **Replay session JSON**. One silent 2,048-sample generated window at 16 kHz; sine frequency 440 Hz, peak amplitude 0.6, no added noise.

Observation CSV deliberately contains only two numeric columns. It cannot preserve provenance, calibration or original units on its own; pair it with an analysis JSON record when exporting an investigation.
