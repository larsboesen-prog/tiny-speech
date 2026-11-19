"""Fine-tune Whisper tiny (the sites' ears) on restaurant requests in Mexican Spanish (training/asr/README.md).

python finetune.py --synthetic work/verified/synthetic.jsonl --human work/verified/human-train.jsonl --general work/fleurs/train.jsonl \
                   --hint ../hint-mx-sma-es.txt --out work/whisper-tiny-mx [--steps 4000]

The mix is a sampling rule, not a pile of files: each training example is drawn from the restaurant set (80%) or from general
speech (FLEURS, 20%, so the model keeps hearing everything else), and a restaurant example is synthetic 70% of the time and a
real speaker's 30% (the owner's ratio), however many hours each side has. Every example is changed a little as it is drawn:
speed, level, a phone's narrow band, a room, other people talking (babble made from other clips) or noise. A third of the
restaurant examples carry the page's name hint as Whisper's prompt (and the true names in it), so the hint keeps working.
Rows: {audio, text, lang} (lang es, mixed or en; mixed is decoded as Spanish, as the page does).
"""
import argparse
import json
import math
import random
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

RATE = 16000


def rows_of(path):
    if not path or not Path(path).exists():
        return []
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def load(path):
    import librosa
    wave, rate = sf.read(path, dtype="float32")
    if wave.ndim > 1:
        wave = wave.mean(axis=1)
    return librosa.resample(wave, orig_sr=rate, target_sr=RATE) if rate != RATE else wave


class Augment:
    """Small, cheap changes that make a clean clip sound like a phone in a restaurant."""

    def __init__(self, pool, rng):
        self.pool, self.rng = pool, rng

    def __call__(self, w):
        r = self.rng
        from scipy.signal import butter, sosfilt, fftconvolve
        if r.random() < 0.5:  # speed (and pitch with it), 0.9–1.1
            factor = r.uniform(0.9, 1.1)
            idx = np.arange(0, len(w) - 1, factor)
            w = np.interp(idx, np.arange(len(w)), w).astype("float32")
        if r.random() < 0.3:  # a phone's narrow band
            w = sosfilt(butter(4, [r.uniform(250, 400), r.uniform(3200, 3800)], btype="band", fs=RATE, output="sos"), w).astype("float32")
        if r.random() < 0.3:  # a room: decaying noise as its impulse response
            t60 = r.uniform(0.2, 0.7)
            n = int(t60 * RATE)
            ir = np.random.default_rng(r.randrange(1 << 30)).standard_normal(n) * np.exp(-6.9 * np.arange(n) / n)
            ir[0] = 1.0
            w = fftconvolve(w, ir / np.sqrt(np.sum(ir ** 2)), mode="full")[:len(w)].astype("float32")
        if r.random() < 0.5 and self.pool:  # other people talking, or plain noise, 5–25 dB below
            if r.random() < 0.7:
                noise = np.zeros_like(w)
                for _ in range(r.randint(2, 5)):
                    other = load(r.choice(self.pool))
                    if len(other) < len(w):
                        other = np.tile(other, math.ceil(len(w) / max(1, len(other))))
                    start = r.randrange(0, len(other) - len(w) + 1)
                    noise += other[start:start + len(w)]
            else:
                noise = np.random.default_rng(r.randrange(1 << 30)).standard_normal(len(w)).astype("float32")
            snr = r.uniform(5, 25)
            ps, pn = np.mean(w ** 2) + 1e-9, np.mean(noise ** 2) + 1e-9
            w = w + noise * np.sqrt(ps / (pn * 10 ** (snr / 10)))
        peak = float(np.max(np.abs(w))) or 1.0
        return (w * (r.uniform(0.1, 0.9) / peak)).astype("float32")


class Mixture(torch.utils.data.IterableDataset):
    """Draws examples by the mix's probabilities, forever; the trainer stops at --steps."""

    def __init__(self, groups, processor, hint_names, seed=0, augment=True, prompt_share=0.33):
        self.groups = [(w, rows) for w, rows in groups if rows]
        total = sum(w for w, _ in self.groups)
        self.weights = [w / total for w, _ in self.groups]
        self.processor, self.hint_names, self.seed, self.augment, self.prompt_share = processor, hint_names, seed, augment, prompt_share

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        rng = random.Random(self.seed + (info.id if info else 0) * 9973)
        pool = [r["audio"] for _, rows in self.groups for r in rows[:2000]]
        augment = Augment(pool, rng)
        tok = self.processor.tokenizer
        while True:
            _, rows = self.groups[rng.choices(range(len(self.groups)), self.weights)[0]]
            row = rng.choice(rows)
            try:
                wave = load(row["audio"])
            except Exception:
                continue
            if self.augment:
                wave = augment(wave)
            feats = self.processor.feature_extractor(wave[: 30 * RATE], sampling_rate=RATE).input_features[0]
            lang = "en" if row.get("lang") == "en" else "es"
            prefix = tok.convert_tokens_to_ids(["<|startoftranscript|>", f"<|{lang}|>", "<|transcribe|>", "<|notimestamps|>"])
            text_ids = tok.encode(" " + row["text"].strip(), add_special_tokens=False)
            eot = tok.convert_tokens_to_ids("<|endoftext|>")
            prompt = []
            if row.get("source") != "general" and rng.random() < self.prompt_share and self.hint_names:
                names = list(dict.fromkeys([*row.get("names", []), *rng.sample(self.hint_names, min(len(self.hint_names), rng.randint(8, 40)))]))
                rng.shuffle(names)
                prompt = [tok.convert_tokens_to_ids("<|startofprev|>")] + tok.encode(" " + ", ".join(names) + ".", add_special_tokens=False)[-200:]
            full = prompt + prefix + text_ids + [eot]
            if len(full) > 440:
                continue
            labels = full[1:]
            masked = [-100] * max(0, len(prompt) - 1 + 1) if prompt else []  # positions predicting the prompt and <|startoftranscript|>
            labels = masked + labels[len(masked):]
            yield {"input_features": feats, "decoder_input_ids": full[:-1], "labels": labels}


def collate(batch, pad_id):
    longest = max(len(b["decoder_input_ids"]) for b in batch)
    return {
        "input_features": torch.tensor(np.stack([b["input_features"] for b in batch])),
        "decoder_input_ids": torch.tensor([b["decoder_input_ids"] + [pad_id] * (longest - len(b["decoder_input_ids"])) for b in batch]),
        "labels": torch.tensor([b["labels"] + [-100] * (longest - len(b["labels"])) for b in batch]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="openai/whisper-tiny")
    parser.add_argument("--synthetic", type=Path, required=True)
    parser.add_argument("--human", type=Path)
    parser.add_argument("--general", type=Path)
    parser.add_argument("--hint", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=4000)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--synthetic-share", type=float, default=0.7)
    parser.add_argument("--general-share", type=float, default=0.2)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()
    from transformers import Seq2SeqTrainer, Seq2SeqTrainingArguments, WhisperForConditionalGeneration, WhisperProcessor

    processor = WhisperProcessor.from_pretrained(args.base)
    model = WhisperForConditionalGeneration.from_pretrained(args.base)
    model.config.forced_decoder_ids = None
    model.generation_config.forced_decoder_ids = None
    synthetic, human, general = rows_of(args.synthetic), rows_of(args.human), rows_of(args.general)
    for r in general:
        r["source"] = "general"
    domain = 1 - (args.general_share if general else 0)
    # with no human recordings yet, the restaurant share is all synthetic (and the report says so)
    syn_w = domain * (args.synthetic_share if human else 1.0)
    groups = [(syn_w, synthetic), (domain * (1 - args.synthetic_share), human), (args.general_share, general)]
    hint_names = [n.strip() for n in args.hint.read_text(encoding="utf-8").strip().rstrip(".").split(",")] if args.hint else []
    data = Mixture(groups, processor, hint_names, seed=args.seed)
    plan = {"synthetic": [round(syn_w, 3), len(synthetic)], "human": [round(domain * (1 - args.synthetic_share), 3) if human else 0, len(human)],
            "general": [args.general_share if general else 0, len(general)], "steps": args.steps, "batch": args.batch, "lr": args.lr, "base": args.base}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "mix.json").write_text(json.dumps(plan, indent=2))
    print(json.dumps({"mix": plan}), flush=True)
    cuda = torch.cuda.is_available()
    targs = Seq2SeqTrainingArguments(
        output_dir=str(args.out), max_steps=args.steps, per_device_train_batch_size=args.batch, learning_rate=args.lr,
        warmup_steps=min(300, args.steps // 10), lr_scheduler_type="linear", weight_decay=0.01, logging_steps=max(1, min(50, args.steps // 20)),
        save_steps=max(10, args.steps // 4), save_total_limit=2, bf16=cuda and torch.cuda.is_bf16_supported(), fp16=cuda and not torch.cuda.is_bf16_supported(),
        dataloader_num_workers=args.workers if cuda else 0, report_to=[], remove_unused_columns=False, seed=args.seed)
    trainer = Seq2SeqTrainer(model=model, args=targs, train_dataset=data, data_collator=lambda b: collate(b, processor.tokenizer.pad_token_id))
    trainer.train()
    model.generation_config.forced_decoder_ids = None
    trainer.save_model(str(args.out / "final"))
    processor.save_pretrained(str(args.out / "final"))
    print(json.dumps({"saved": str(args.out / "final")}))


if __name__ == "__main__":
    main()
