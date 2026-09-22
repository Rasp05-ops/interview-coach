"""Smart Turn v3 adapter for the engine / dataset builder: `SmartTurnONNX()(audio_16k_float32) -> P(turn complete)`.

UNTESTED IN THIS REPO'S CI: the model file is hosted on Hugging Face, which the build sandbox could not reach.
The inference steps mirror python/eot_detect.py (8 s window, left-padded, Whisper log-mel features), but unlike that
script this class loads the model and feature extractor ONCE, because per-pause evaluation calls it repeatedly.
Run `python3 python/download_model.py` first; requires `onnxruntime` and `transformers`."""
from __future__ import annotations

import os
from typing import Optional

import numpy as np

from .audio import SR

_HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_PATHS = [os.path.join(_HERE, "python", "smart-turn-v3-cpu.onnx"), os.path.join(_HERE, "python", "smart-turn-v3-gpu.onnx")]


class SmartTurnONNX:
    def __init__(self, model_path: Optional[str] = None):
        import onnxruntime as ort
        from transformers import WhisperFeatureExtractor
        path = model_path or next((p for p in DEFAULT_PATHS if os.path.exists(p)), None)
        if not path or not os.path.exists(path):
            raise FileNotFoundError("Smart Turn model not found; run python3 python/download_model.py")
        so = ort.SessionOptions()
        so.inter_op_num_threads = 1
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.sess = ort.InferenceSession(path, sess_options=so)
        self.fe = WhisperFeatureExtractor(chunk_length=8)

    def __call__(self, audio: np.ndarray) -> float:
        target = 8 * SR
        audio = audio[-target:].astype(np.float32)
        if len(audio) < target:
            audio = np.concatenate([np.zeros(target - len(audio), dtype=np.float32), audio])
        feat = self.fe(audio, sampling_rate=SR, return_tensors="np", padding="max_length", max_length=target,
                       truncation=True, do_normalize=True).input_features
        feat = np.expand_dims(feat.squeeze(0), 0).astype(np.float32)
        return float(self.sess.run(None, {"input_features": feat})[0][0])
