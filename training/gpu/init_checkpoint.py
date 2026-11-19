"""The released tiny-voca checkpoint grown to the bilingual vocabulary and a third speaker, as a checkpoint upstream's
train.py starts from with --init-from <file> --new-data. Run in the patched checkout (setup.sh).

python init_checkpoint.py --released tiny-voca.pt --symbols training/data/symbols.json --like M2 --out work/init.pt --config work/config.json

The released file is an inference export (weights only, no critics or optimizer), so --init-from cannot read it directly,
and --init-from refuses a changed configuration. This builds what it accepts: the new configuration (87 symbols; F2, M2, MX1),
every released weight copied, each new token row the mean of its nearest English rows (symbols.json "init", the same rule as
tools/voice-gguf.mjs init), the new speaker's rows a copy of --like, and a step counter of 0 with no trained critics, so the
adversarial phase starts at --gan-start with fresh critics and the learning rate warms up again.
"""
import argparse
import json
from pathlib import Path

import torch


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--released", type=Path, required=True)
    parser.add_argument("--symbols", type=Path, required=True)
    parser.add_argument("--like", default="M2", choices=("F2", "M2"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True, help="Where to write the new configuration (for --config of prepare/annotate/train)")
    args = parser.parse_args()
    from tiny_voca.config import Config
    from tiny_voca.text import SYMBOLS, SYMBOL_TO_ID, frontend_fingerprint
    from tiny_voca.train import CHECKPOINT_FORMAT, TrainingSystem, load_compatible

    spec = json.loads(args.symbols.read_text(encoding="utf-8"))
    if list(SYMBOLS) != spec["symbols"]:
        raise SystemExit("the checkout is not patched with training/data/symbols.json (run patch_upstream.py)")
    released = torch.load(args.released, map_location="cpu", weights_only=True)
    if released.get("format_version") != CHECKPOINT_FORMAT or released["config"]["vocab_size"] != 76:
        raise SystemExit("not the released 76-symbol checkpoint")
    old = released["config"]
    config = Config.from_dict({**old, "vocab_size": len(SYMBOLS), "speakers": [*old["speakers"], spec["speaker"]]})
    weights = {k: v.clone() for k, v in released["model"].items()}

    tokens = weights["tokens.weight"]
    grown = torch.zeros(len(SYMBOLS), tokens.shape[1], dtype=tokens.dtype)
    grown[:76] = tokens
    for symbol in SYMBOLS[76:]:
        rows = [SYMBOL_TO_ID[s] for s in spec["init"][symbol]]
        grown[SYMBOL_TO_ID[symbol]] = tokens[rows].mean(dim=0)
    weights["tokens.weight"] = grown
    like = old["speakers"].index(args.like)
    for name in ("voices.weight", "frame_voices.weight"):
        weights[name] = torch.cat([weights[name], weights[name][like:like + 1]], dim=0)

    system = TrainingSystem(config)
    report = load_compatible(system, {"model." + k: v for k, v in weights.items()})
    if report["grown"] or report["dropped"] or any(not n.startswith(("mel_head.", "spectral.")) for n in report["new"]):
        raise SystemExit(f"unexpected weights: {report}")
    # only the model's weights: train.py then starts the mel head, the optimizer and the critics fresh (it loads an optimizer
    # only when every tensor was an exact copy, and critics only past their checkpoint's gan_start)
    model_only = {k: v for k, v in system.state_dict().items() if k.startswith("model.")}
    state = {"format_version": CHECKPOINT_FORMAT, "config": config.to_dict(), "step": 0, "system": model_only,
             "frontend": {"released": released["frontend"], "now": frontend_fingerprint()}, "annotation": released.get("annotation"),
             "recipe": {"gan_start": 10 ** 12, "source": f"released step {released.get('step')}, grown by training/gpu/init_checkpoint.py"},
             "datasets": []}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(state, args.out)
    args.config.write_text(json.dumps(config.to_dict(), indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "symbols": len(SYMBOLS), "speakers": list(config.speakers), "new": report["new"],
                      "released_step": released.get("step")}))


if __name__ == "__main__":
    main()
