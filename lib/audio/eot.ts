import { spawn } from "child_process";
import path from "path";

export type EOTResult = {
  is_complete: boolean;
  probability: number;
  duration_s: number;
  /** false when the Python bridge failed (missing python/ffmpeg/model). Callers must not trust duration_s then. */
  ok: boolean;
};

const FAILED: EOTResult = { is_complete: true, probability: 0.5, duration_s: 0, ok: false };

export async function detectEOT(audioPath: string): Promise<EOTResult> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), "python", "eot_detect.py");
    const py = process.env.PYTHON_BIN || "python3";
    const proc = spawn(py, [script, audioPath], { cwd: path.join(process.cwd(), "python") });
    let out = "";
    proc.stdout.on("data", d => out += d);
    proc.on("close", () => {
      try {
        const j = JSON.parse(out.trim().split("\n").pop() || "{}");
        const duration = Number(j.duration_s);
        resolve({
          is_complete: j.is_complete ?? true,
          probability: j.probability ?? 0.5,
          duration_s: Number.isFinite(duration) ? duration : 0,
          ok: Number.isFinite(duration) && duration > 0,
        });
      } catch {
        resolve(FAILED);
      }
    });
    proc.on("error", () => resolve(FAILED));
  });
}

/**
 * Pick a trustworthy audio duration. The Python bridge is authoritative when it worked;
 * otherwise fall back to the duration the browser measured. Never returns 0 when the
 * client supplied a plausible value, so pace and length scoring don't silently break.
 */
export function resolveDuration(eot: EOTResult, clientSeconds: number): number {
  if (eot.ok && eot.duration_s > 0) return eot.duration_s;
  if (Number.isFinite(clientSeconds) && clientSeconds > 0) return Math.min(clientSeconds, 900);
  return 0;
}
