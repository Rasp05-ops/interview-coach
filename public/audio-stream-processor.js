class AudioStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.inputRate = sampleRate;
    this.outputRate = 16000;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input) return true;

    for (let i = 0; i < input.length; i++) this.pending.push(input[i]);
    const step = this.inputRate / this.outputRate;
    const count = Math.floor((this.pending.length - 1) / step);
    if (count <= 0) return true;

    const pcm = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      const position = i * step;
      const left = Math.floor(position);
      const fraction = position - left;
      const sample = this.pending[left] * (1 - fraction) + this.pending[left + 1] * fraction;
      pcm[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
    }
    this.pending = this.pending.slice(Math.floor(count * step));
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("audio-stream-processor", AudioStreamProcessor);