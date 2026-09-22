"""Download Smart Turn v3 ONNX model from HuggingFace (one-time, ~8 MB)."""
import argparse, os, sys, urllib.request

DIR = os.path.dirname(__file__)
MODELS = {
    "cpu": ("https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3-cpu.onnx", "smart-turn-v3-cpu.onnx", "~8 MB"),
    "gpu": ("https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3-gpu.onnx", "smart-turn-v3-gpu.onnx", "~32 MB"),
}

def download(variant="cpu"):
    url, fname, size = MODELS[variant]
    dest = os.path.join(DIR, fname)
    if os.path.exists(dest):
        print(f"✓ Already downloaded: {dest}"); return
    print(f"Downloading Smart Turn v3 ({variant}, {size}) …")
    def prog(n, bs, total):
        p = min(int(n*bs*100/(total or 1)), 100)
        print(f"\r  [{'█'*(p//5)}{'░'*(20-p//5)}] {p}%", end="", flush=True)
    try:
        urllib.request.urlretrieve(url, dest, reporthook=prog)
        print(f"\n✓ Saved → {dest}")
    except Exception as e:
        if os.path.exists(dest): os.unlink(dest)
        print(f"\n✗ Failed: {e}", file=sys.stderr); sys.exit(1)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gpu", action="store_true")
    download("gpu" if ap.parse_args().gpu else "cpu")
