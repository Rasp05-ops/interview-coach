"""
eot_detect.py — Smart Turn v3 ONNX end-of-turn detection.
Falls back to energy-VAD heuristic if model not yet downloaded.

Usage:  python3 eot_detect.py <audio_file>
Output: single JSON line to stdout
"""
import json, os, subprocess, sys
import numpy as np

MODEL_DIR = os.path.dirname(__file__)
ONNX_CPU  = os.path.join(MODEL_DIR, "smart-turn-v3-cpu.onnx")
ONNX_GPU  = os.path.join(MODEL_DIR, "smart-turn-v3-gpu.onnx")

def load_16k_mono(path):
    import soundfile as sf, tempfile
    tmp = tempfile.mktemp(suffix=".wav")
    try:
        subprocess.run(["ffmpeg","-y","-i",path,"-ac","1","-ar","16000",tmp],
                       check=True, capture_output=True, timeout=30)
        x, _ = sf.read(tmp, dtype="float32", always_2d=False)
        return x
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def smart_turn(audio):
    import onnxruntime as ort
    from transformers import WhisperFeatureExtractor
    onnx = ONNX_CPU if os.path.exists(ONNX_CPU) else ONNX_GPU
    target = 8 * 16000
    if len(audio) > target:
        audio = audio[-target:]
    else:
        audio = np.concatenate([np.zeros(target - len(audio), dtype=np.float32), audio])
    fe = WhisperFeatureExtractor(chunk_length=8)
    feat = fe(audio, sampling_rate=16000, return_tensors="np",
               padding="max_length", max_length=target,
               truncation=True, do_normalize=True).input_features
    feat = np.expand_dims(feat.squeeze(0), 0).astype(np.float32)
    so = ort.SessionOptions()
    so.inter_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(onnx, sess_options=so)
    return float(sess.run(None, {"input_features": feat})[0][0])

def energy_fallback(audio):
    fl, hp, sr = int(0.025*16000), int(0.010*16000), 16000
    n = max(1, 1 + (len(audio) - fl) // hp)
    idx = np.arange(fl)[None,:] + hp * np.arange(n)[:,None]
    idx = np.clip(idx, 0, len(audio)-1)
    e = 20*np.log10(np.sqrt(np.mean(audio[idx]**2, axis=1)) + 1e-12)
    e = np.clip(e, -80, None)
    if len(e) < 4: return 0.5
    drop = e[:10].mean() - e[-10:].mean()
    return float(1 / (1 + np.exp(-(drop - 5) / 5)))

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: eot_detect.py <path>"})); sys.exit(1)
    p = sys.argv[1]
    if not os.path.exists(p):
        print(json.dumps({"error": f"file not found: {p}"})); sys.exit(1)
    try:
        audio = load_16k_mono(p)
        dur = len(audio) / 16000
        has_model = os.path.exists(ONNX_CPU) or os.path.exists(ONNX_GPU)
        if has_model:
            prob = smart_turn(audio)
            model = "smart-turn-v3"
        else:
            prob = energy_fallback(audio)
            model = "energy-fallback"
            print("[eot_detect] Smart Turn model not found — using energy heuristic. Run: python3 python/download_model.py", file=sys.stderr)
        print(json.dumps({"is_complete": prob >= 0.5, "probability": round(prob,4), "duration_s": round(dur,3), "model": model}))
    except Exception as e:
        print(json.dumps({"error": str(e)})); sys.exit(1)

if __name__ == "__main__":
    main()
