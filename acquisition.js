const reportedKeys = [
  "echoCancellation",
  "noiseSuppression",
  "autoGainControl",
  "sampleRate",
  "channelCount",
  "sampleSize",
  "latency",
];
export function captureAcousticProtocol(generate, onProgress = () => {}) {
  let canceled = false,
    stream = null,
    context = null,
    node = null,
    input = null,
    timer = null,
    resolveDone,
    rejectDone,
    finished = false;
  const promise = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  function release() {
    clearInterval(timer);
    if (node) {
      try {
        node.port.postMessage({ type: "cancel" });
        node.disconnect();
      } catch {}
    }
    if (input) input.disconnect();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  }
  function fail(error) {
    if (finished) return;
    finished = true;
    release();
    rejectDone(error);
  }
  const cancel = () => {
    canceled = true;
    fail(new Error("Acquisition canceled. Previous experiment retained."));
  };
  (async () => {
    try {
      if (
        !globalThis.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia ||
        !globalThis.AudioWorkletNode
      )
        throw new Error(
          "This browser cannot record an AudioWorklet here. Use HTTPS/localhost with supported audio hardware, or the reference specimens.",
        );
      onProgress({ stage: "permission", fraction: 0 });
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (canceled) {
        release();
        return;
      }
      context = new AudioContext();
      await context.resume();
      if (canceled) {
        release();
        return;
      }
      if (!context.audioWorklet)
        throw new Error(
          "AudioWorklet is unavailable. No sound has been emitted.",
        );
      await context.audioWorklet.addModule(
        new URL("./capture-worklet.js", import.meta.url),
      );
      if (canceled) {
        release();
        return;
      }
      const protocol = generate(context.sampleRate);
      const settings = stream.getAudioTracks()[0]?.getSettings?.() || {};
      const reported = Object.fromEntries(
        reportedKeys.map((key) => [key, settings[key] ?? null]),
      );
      node = new AudioWorkletNode(context, "investigation-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      input = context.createMediaStreamSource(stream);
      input.connect(node);
      node.connect(context.destination);
      const started = performance.now();
      node.port.onmessage = (event) => {
        if (finished || canceled) return;
        if (event.data.type === "complete") {
          finished = true;
          const response = event.data.response;
          release();
          resolveDone({
            ...protocol,
            response,
            source: "microphone",
            captureSettings: reported,
            capturedAt: new Date().toISOString(),
            captureIntegrity: event.data.integrity,
            timing:
              "One AudioWorklet render timeline; device/acoustic latency remains in recorded response.",
          });
        }
      };
      node.onprocessorerror = () =>
        fail(
          new Error(
            "The audio processor failed; the previous experiment was retained.",
          ),
        );
      node.port.postMessage({ type: "start", excitation: protocol.excitation });
      timer = setInterval(() => {
        const fraction = Math.min(
          1,
          (performance.now() - started) / (protocol.durationSeconds * 1000),
        );
        onProgress({ stage: "recording", fraction });
        if (performance.now() - started > (protocol.durationSeconds + 8) * 1000)
          fail(
            new Error("Acquisition timed out. Previous experiment retained."),
          );
      }, 80);
      for (const track of stream.getTracks())
        track.addEventListener(
          "ended",
          () => {
            if (!finished)
              fail(
                new Error("The microphone disconnected during acquisition."),
              );
          },
          { once: true },
        );
    } catch (error) {
      fail(error);
    }
  })();
  return { promise, cancel };
}
