"""A trained checkpoint → the files tools/voice-gguf.mjs pack reads to make the page's GGUF (no torch needed there).

python dump.py --checkpoint runs/bilingual/inference.pt --out work/dump

Writes tensors.json ({name, shape, offset} per tensor, offsets in float32 values), tensors.f32 (all weights, float32,
little-endian, one after another) and config.json ({model: the configuration, step, frontend}).
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    args.out.mkdir(parents=True, exist_ok=True)
    index, offset = [], 0
    with open(args.out / "tensors.f32", "wb") as f:
        for name, tensor in state["model"].items():
            data = tensor.detach().to(torch.float32).contiguous().numpy().astype("<f4", copy=False)
            f.write(data.tobytes())
            index.append({"name": name, "shape": list(data.shape), "offset": offset})
            offset += data.size
    (args.out / "tensors.json").write_text(json.dumps({"tensors": index, "values": offset}))
    config = {"model": state["config"], "step": state["step"], "frontend": state["frontend"], "annotation": state.get("annotation")}
    (args.out / "config.json").write_text(json.dumps(config, indent=1))
    print(json.dumps({"tensors": len(index), "values": offset, "step": state["step"], "speakers": state["config"]["speakers"]}))


if __name__ == "__main__":
    main()
