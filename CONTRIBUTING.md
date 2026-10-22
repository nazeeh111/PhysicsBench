# Contributing

Use Node.js 22+. Run `npm test` and `npm run build` before a pull request. No production package install is necessary.

Keep scientific computation in pure modules and browser acquisition/rendering separate. Document units, signs, assumptions and numerical bounds. Include an independent fixture or invariant when changing a numerical method. Avoid claiming calibrated physical accuracy from a simulated fixture.

For UI work, run the built app, inspect desktop/narrow layouts, operate the affected controls with a keyboard, and test failure paths that could lose data or retain a microphone. Preserve existing v1 mechanics sessions. Keep production resources in the explicit allowlists of `scripts/build.mjs` and `scripts/serve.mjs`.

The optional browser check uses Playwright installed separately: `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser`. The browser runner serves the freshly verified build itself unless BENCH_URL selects an existing preview. See `docs/VERIFICATION.md` for scope. Browser development tools are not shipped with the application.

A useful issue includes browser/OS, exact steps, input file or minimal redacted sample, expected result and observed result. Do not attach private recordings or credentials.

For acoustic changes, ensure held-out response never changes coefficients, gain, alignment or scoring bounds. Test unexplained late energy, silence and broken capture, not only a successful inverse. For tracking changes, preserve gaps and corrections and challenge distractors/occlusion. Record schema/source protocol and estimator revisions separately.
