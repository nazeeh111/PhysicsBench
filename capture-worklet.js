// Emitted stimulus and recorded input share one uninterrupted render timeline.
// Device latency remains measurable in that timeline; it is not propagation alone.
class InvestigationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.excitation = null;
    this.response = null;
    this.cursor = 0;
    this.finished = false;
    this.integrity = {
      startFrame: null,
      endFrame: null,
      missingInputFrames: 0,
      discontinuities: 0,
      gapFrames: 0,
      totalFrames: 0,
    };
    this.expectedFrame = null;
    this.port.onmessage = (event) => {
      if (event.data?.type === "start" && !this.excitation && !this.finished) {
        this.excitation = event.data.excitation;
        this.response = new Float32Array(this.excitation.length);
      }
      if (event.data?.type === "cancel") {
        this.finished = true;
        this.excitation = null;
        this.response = null;
      }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (this.finished) return false;
    if (!this.excitation) return true;
    if (this.integrity.startFrame === null) {
      this.integrity.startFrame = currentFrame;
      this.port.postMessage({ type: "started", frame: currentFrame });
    }
    if (this.expectedFrame !== null && currentFrame !== this.expectedFrame) {
      this.integrity.discontinuities++;
      this.integrity.gapFrames += Math.abs(currentFrame - this.expectedFrame);
    }
    const quantum = output?.length || 128,
      input = inputs[0]?.[0],
      count = Math.min(quantum, this.excitation.length - this.cursor);
    for (let i = 0; i < count; i++) {
      if (!input || i >= input.length || !Number.isFinite(input[i])) {
        this.response[this.cursor + i] = 0;
        this.integrity.missingInputFrames++;
      } else this.response[this.cursor + i] = input[i];
      if (output) output[i] = this.excitation[this.cursor + i];
    }
    this.cursor += count;
    this.integrity.totalFrames = this.cursor;
    this.integrity.endFrame = currentFrame + count;
    this.expectedFrame = currentFrame + quantum;
    if (this.cursor === this.excitation.length) {
      this.finished = true;
      this.port.postMessage(
        {
          type: "complete",
          response: this.response,
          integrity: this.integrity,
        },
        [this.response.buffer],
      );
      this.excitation = null;
      this.response = null;
      return false;
    }
    return true;
  }
}
registerProcessor("investigation-capture", InvestigationCapture);
