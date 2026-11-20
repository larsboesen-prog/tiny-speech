"""The trained student as one 8-bit ONNX file for the browser (onnxruntime-web), checked (README.md here).

python export.py --checkpoint OUT/best.pt --out OUT/onnx [--manifest WORK/manifest.jsonl --labels WORK/labels]
  → OUT/onnx/ears.onnx (32-bit), OUT/onnx/ears-int8.onnx (the one to ship), OUT/onnx/vocab.json, OUT/onnx/report.json
Input "audio": float32 (1, samples), 16 kHz mono in [-1, 1]. Output "logprobs": (1, frames, 392), one frame per 20 ms, the
teacher's sounds (vocab.json; 0 is the blank). Gates: the 8-bit file is at most 10 MB; 32-bit ONNX gives the same numbers as
PyTorch; the 8-bit file's best sounds agree with the 32-bit file's on most frames.
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from student import Student, size_report

LIMIT_BYTES = 10_000_000


def best_path(lp):
    out, last = [], -1
    for s in lp.argmax(-1).tolist():
        if s != last and s != 0:
            out.append(s)
        last = s
    return out


def edit(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(b)]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, help="to check on dev clips")
    parser.add_argument("--labels", type=Path, help="the teacher's labels of those clips")
    parser.add_argument("--clips", type=int, default=100)
    args = parser.parse_args()
    import onnx
    import onnxruntime as ort
    from onnxruntime.quantization import QuantType, quantize_dynamic

    args.out.mkdir(parents=True, exist_ok=True)
    ck = torch.load(args.checkpoint, map_location="cpu")
    model = Student(**ck["config"]).eval()
    model.load_state_dict(ck["model"])
    fp32, int8 = args.out / "ears.onnx", args.out / "ears-int8.onnx"
    dummy = torch.randn(1, 16000 * 3) * 0.1
    torch.onnx.export(model, (dummy,), str(fp32), input_names=["audio"], output_names=["logprobs"], opset_version=17,
                      dynamic_axes={"audio": {1: "samples"}, "logprobs": {1: "frames"}}, dynamo=False)
    graph = onnx.load(str(fp32))
    # the mel filter bank multiplies a power spectrum (values over many powers of ten): it must stay 32-bit
    mel_inits = {i.name for i in graph.graph.initializer if tuple(i.dims) == (80, 201)}
    keep32 = [n.name for n in graph.graph.node if n.op_type == "MatMul" and set(n.input) & mel_inits]
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"], nodes_to_exclude=keep32)

    from transformers.utils import cached_file
    shutil.copy(cached_file("facebook/wav2vec2-lv-60-espeak-cv-ft", "vocab.json", revision="ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4"), args.out / "vocab.json")

    report = {"checkpoint": str(args.checkpoint), "step": ck.get("step") or ck.get("state", {}).get("step"), **size_report(model),
              "bytes_fp32": fp32.stat().st_size, "bytes_int8": int8.stat().st_size, "kept_32bit": keep32}
    s32 = ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"])
    s8 = ort.InferenceSession(str(int8), providers=["CPUExecutionProvider"])
    waves = []
    if args.manifest:
        from prepare import load_manifest
        rows = load_manifest(args.manifest)
        waves = [(r, sf.read(r["audio"], dtype="float32")[0]) for r in rows if r.get("split") == "dev"][: args.clips]
    if not waves:
        waves = [({"id": "noise"}, (np.random.RandomState(0).randn(16000 * 4) * 0.05).astype("float32"))]
    labels = None
    if args.labels:
        from train import Labels
        labels = Labels(args.labels)
    diff, agree, frames_n, err32, err8, n_ref = 0.0, 0, 0, 0, 0, 0
    for r, w in waves:
        w = (w / (float(np.abs(w).max()) or 1.0) * 0.9).astype("float32")[None]
        with torch.no_grad():
            pt = model(torch.from_numpy(w)).numpy()[0]
        a = s32.run(None, {"audio": w})[0][0]
        b = s8.run(None, {"audio": w})[0][0]
        diff = max(diff, float(np.abs(pt - a).max()))
        agree += int((a.argmax(-1) == b.argmax(-1)).sum())
        frames_n += len(a)
        if labels and r["id"] in labels.where:
            idx, _ = labels.get(r["id"])
            ref = [s for k, s in enumerate(idx[:, 0].tolist()) if s != 0 and (k == 0 or s != idx[k - 1, 0])]
            err32 += edit(ref, best_path(a))
            err8 += edit(ref, best_path(b))
            n_ref += max(1, len(ref))
    report.update({"clips_checked": len(waves), "max_abs_diff_torch_vs_onnx": round(diff, 6), "frames_int8_agree_with_fp32": round(agree / max(1, frames_n), 4)})
    if n_ref:
        report.update({"sound_error_vs_teacher_fp32": round(err32 / n_ref, 4), "sound_error_vs_teacher_int8": round(err8 / n_ref, 4)})
    report["gates"] = {"int8_at_most_10MB": report["bytes_int8"] <= LIMIT_BYTES, "onnx_matches_torch": diff < 1e-2,
                       "int8_close_to_fp32": report["frames_int8_agree_with_fp32"] >= 0.9}
    (args.out / "report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report))
    if not all(report["gates"].values()):
        raise SystemExit("a gate failed: see report.json")


if __name__ == "__main__":
    main()
