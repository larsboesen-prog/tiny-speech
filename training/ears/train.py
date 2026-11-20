"""Train the tiny ears to hear what the teacher hears (README.md here).

python train.py --manifest WORK/manifest.jsonl --labels WORK/labels --out OUT [--hours 8 --batch-seconds 320 --lr 2e-3]

Loss: frame by frame, the teacher's top-K sounds as a soft target (cross-entropy; mostly-blank frames weigh less), plus CTC
on the teacher's best sound sequence, plus (--phones) CTC on the sounds actually said, from the Spanish transcripts
(phones.mjs): the teacher mishears some Mexican sounds (perro → pero, frío → fio), and this keeps the student from copying it. The learning-rate schedule runs on the clock (warm-up, then cosine to the end of
--hours), so the same command fits a free GPU session whatever its speed. The audio is made harder as it is drawn (speed,
noise, other voices, a phone's narrow band, a room), while the targets stay the teacher's labels of the clean clip.
Saves OUT/last.pt every few minutes and at the end; OUT/best.pt by the fewest sound errors on the dev clips (against what was
said where there is a transcript, else against the teacher); resumes from
OUT/last.pt. Log: OUT/log.jsonl.
"""
import argparse
import json
import math
import os
import random
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torch.nn.functional as F
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt

from student import Student, size_report

FRAME = 320  # samples per 20 ms frame


def frames(samples):
    return (samples - 400) // FRAME + 1


class Labels:
    def __init__(self, folder):
        self.where = {}
        self.idx, self.logp = [], []
        for meta in sorted(Path(folder).glob("shard-*.json")):
            m = json.loads(meta.read_text())
            stem = str(meta)[:-5]
            s = len(self.idx)
            self.idx.append(np.load(stem + ".idx.npy", mmap_mode="r"))
            self.logp.append(np.load(stem + ".logp.npy", mmap_mode="r"))
            for k, uid in enumerate(m["ids"]):
                self.where[uid] = (s, m["offsets"][k], m["offsets"][k + 1])

    def get(self, uid):
        s, a, b = self.where[uid]
        return np.asarray(self.idx[s][a:b]), np.asarray(self.logp[s][a:b], dtype=np.float32)


class Clips(torch.utils.data.Dataset):
    def __init__(self, rows, labels, max_seconds, augment, noise_rows=None, said=None):
        self.rows, self.labels, self.max_seconds, self.augment = rows, labels, max_seconds, augment
        self.noise_rows = noise_rows or rows
        self.said = said or {}

    def __len__(self):
        return len(self.rows)

    def load(self, r, seconds=None):
        wave = sf.read(r["audio"], dtype="float32")[0]
        if wave.ndim > 1:
            wave = wave.mean(axis=1)
        return wave

    def __getitem__(self, item):
        i, length = item  # the batch sampler gives each clip the batch's common length (no padding)
        r = self.rows[i]
        wave = self.load(r)
        idx, logp = self.labels.get(r["id"])
        n = min(len(wave), (len(idx) - 1) * FRAME + 400)
        wave = wave[:n]
        speed = 1.0
        if self.augment and random.random() < 0.3:
            speed = random.choice([0.9, 1.1])
            up, down = (10, 9) if speed == 0.9 else (10, 11)
            wave = resample_poly(wave, up, down).astype("float32")  # slower: longer; faster: shorter
            src = np.minimum((np.arange(frames(len(wave))) * speed).round().astype(int), len(idx) - 1)
            idx, logp = idx[src], logp[src]
        # a window of the common length, starting on a frame
        want = min(length, len(wave))
        start = random.randrange(0, (len(wave) - want) // FRAME + 1) * FRAME if self.augment else 0
        full = len(wave)  # what was said covers the whole clip: usable only if (nearly) all of it is heard
        wave = wave[start:start + want]
        f0 = start // FRAME
        nf = frames(len(wave))
        idx, logp = idx[f0:f0 + nf], logp[f0:f0 + nf]
        if self.augment:
            wave = self.harder(wave)
        peak = float(np.abs(wave).max()) or 1.0
        wave = wave / peak * random.uniform(0.3, 0.95) if self.augment else wave / peak * 0.9
        said = self.said.get(r["id"]) if start == 0 else None
        return (torch.from_numpy(wave.astype("float32")), torch.from_numpy(idx.astype(np.int64)), torch.from_numpy(logp),
                torch.tensor(said or [], dtype=torch.long), full)

    def harder(self, wave):
        n = len(wave)
        if random.random() < 0.2:  # a room: a short decaying echo, the direct sound first so the timing holds
            rt = random.uniform(0.15, 0.6)
            t = np.arange(int(rt * 16000)) / 16000
            ir = np.random.randn(len(t)).astype("float32") * np.exp(-6.9 * t / rt)
            ir[0] = 1.0
            ir /= np.abs(ir).sum() ** 0.5
            wave = fftconvolve(wave, ir)[:n].astype("float32")
        if random.random() < 0.15:  # another voice behind, quieter
            other = self.load(random.choice(self.noise_rows))
            if len(other) < n:
                other = np.pad(other, (0, n - len(other)))
            o = random.randrange(0, len(other) - n + 1)
            other = other[o:o + n]
            snr = random.uniform(8, 20)
            p_s, p_o = float((wave ** 2).mean()) + 1e-9, float((other ** 2).mean()) + 1e-9
            wave = wave + other * math.sqrt(p_s / (p_o * 10 ** (snr / 10)))
        if random.random() < 0.3:  # noise: white or brown-ish
            noise = np.random.randn(n).astype("float32")
            if random.random() < 0.5:
                noise = np.cumsum(noise)
                noise -= noise.mean()
            snr = random.uniform(5, 30)
            p_s, p_n = float((wave ** 2).mean()) + 1e-9, float((noise ** 2).mean()) + 1e-9
            wave = wave + noise * math.sqrt(p_s / (p_n * 10 ** (snr / 10)))
        if random.random() < 0.25:  # a phone: 300–3400 Hz
            sos = butter(4, [300, 3400], btype="bandpass", fs=16000, output="sos")
            wave = sosfilt(sos, wave)
        return wave.astype("float32")


class Buckets(torch.utils.data.Sampler):
    """Batches of clips of similar length, all cut to the shortest (and at most max_seconds): no padding at all."""

    def __init__(self, rows, batch_seconds, max_seconds, shuffle=True, seed=0):
        self.rows, self.batch_seconds, self.max_seconds, self.shuffle = rows, batch_seconds, max_seconds, shuffle
        self.epoch, self.seed = 0, seed

    def batches(self):
        rng = random.Random(self.seed + self.epoch)
        order = sorted(range(len(self.rows)), key=lambda i: self.rows[i]["seconds"] + (rng.random() * 0.08 if self.shuffle else 0))
        out, cur = [], []
        for i in order:
            cur.append(i)
            length = min(self.max_seconds, min(self.rows[j]["seconds"] for j in cur))
            if len(cur) * length >= self.batch_seconds:
                out.append(cur)
                cur = []
        if cur:
            out.append(cur)
        if self.shuffle:
            rng.shuffle(out)
        result = []
        for b in out:
            length = int(min(self.max_seconds, min(self.rows[j]["seconds"] for j in b)) * 16000)
            result.append([(j, length) for j in b])
        return result

    def __iter__(self):
        yield from self.batches()

    def __len__(self):
        return len(self.batches())


def collate(items):
    n = min(len(it[0]) for it in items)
    nf = frames(n)
    waves = torch.stack([it[0][:n] for it in items])
    idx = torch.stack([it[1][:nf] for it in items])
    logp = torch.stack([it[2][:nf] for it in items])
    said = [it[3] if len(it[3]) and it[4] - n <= 1600 else torch.zeros(0, dtype=torch.long) for it in items]
    return waves, idx, logp, said


def collapse(seq, blank=0):
    out, last = [], -1
    for s in seq:
        if s != last and s != blank:
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


def said_ctc(out, said):
    """CTC on the sounds actually said, for the clips that have them (whole clips with a Spanish transcript)"""
    keep = [k for k, s in enumerate(said) if len(s) and len(s) < out.shape[1]]
    if not keep:
        return out.sum() * 0
    lp = out[keep].float().transpose(0, 1)
    targets = torch.cat([said[k] for k in keep]).to(out.device)
    return F.ctc_loss(lp, targets, torch.full((len(keep),), out.shape[1], dtype=torch.long), torch.tensor([len(said[k]) for k in keep]),
                      blank=0, reduction="mean", zero_infinity=True)


def losses(out, idx, logp, blank_weight, ctc_weight):
    """out: (B, T, V) student log-probs; idx, logp: (B, T, K) teacher's top sounds"""
    t = min(out.shape[1], idx.shape[1])
    out, idx, logp = out[:, :t].float(), idx[:, :t], logp[:, :t]
    q = torch.softmax(logp, dim=-1)  # the teacher's top-K, renormalized
    ce = -(q * out.gather(-1, idx)).sum(-1)  # (B, T)
    blankish = (idx[..., 0] == 0) & (logp[..., 0] > math.log(0.9))
    w = torch.where(blankish, torch.full_like(ce, blank_weight), torch.ones_like(ce))
    kd = (ce * w).sum() / w.sum()
    if ctc_weight <= 0:
        return kd, kd.detach() * 0
    targets = [torch.tensor(collapse(s.tolist()), dtype=torch.long) for s in idx[..., 0].cpu()]
    lengths = torch.tensor([len(x) for x in targets])
    keep = lengths > 0
    if keep.sum() == 0:
        return kd, kd.detach() * 0
    ctc = F.ctc_loss(out[keep].transpose(0, 1), torch.cat([x for x, k in zip(targets, keep) if k]).to(out.device),
                     torch.full((int(keep.sum()),), t, dtype=torch.long), lengths[keep], blank=0, reduction="mean", zero_infinity=True)
    return kd + ctc_weight * ctc, ctc.detach()


@torch.no_grad()
def agreement(model, rows, labels, device, limit=300, said=None):
    """sound error rate against the teacher's best sequence, on dev clips the student never learned from (lower is better);
    with transcripts, also against what was said, for the student and for the teacher (the bar to beat)"""
    model.eval()
    errors = total = 0
    vs_said = [0, 0, 0]  # student errors, teacher errors, sounds said
    for r in rows[:limit]:
        wave = sf.read(r["audio"], dtype="float32")[0]
        idx, _ = labels.get(r["id"])
        wave = wave[: (len(idx) - 1) * FRAME + 400]
        peak = float(np.abs(wave).max()) or 1.0
        out = model(torch.from_numpy(wave / peak * 0.9)[None].to(device))
        hyp = collapse(out[0].argmax(-1).tolist())
        ref = collapse(idx[:, 0].tolist())
        errors += edit(ref, hyp)
        total += max(1, len(ref))
        truth = (said or {}).get(r["id"])
        if truth:
            vs_said[0] += edit(truth, hyp)
            vs_said[1] += edit(truth, ref)
            vs_said[2] += len(truth)
    model.train()
    extra = {"dev_sound_error_vs_said": round(vs_said[0] / vs_said[2], 4), "teacher_sound_error_vs_said": round(vs_said[1] / vs_said[2], 4)} if vs_said[2] else {}
    return errors / max(1, total), extra


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--hours", type=float, default=8.0, help="training time; the schedule ends then")
    parser.add_argument("--max-steps", type=int, help="stop after this many steps (a quick try)")
    parser.add_argument("--batch-seconds", type=float, default=320.0)
    parser.add_argument("--max-seconds", type=float, default=12.0)
    parser.add_argument("--lr", type=float, default=2e-3)
    parser.add_argument("--warmup-minutes", type=float, default=15.0)
    parser.add_argument("--blank-weight", type=float, default=0.5)
    parser.add_argument("--ctc-weight", type=float, default=0.3, help="CTC on the teacher's best sounds")
    parser.add_argument("--phones", type=Path, help="what was said, as sounds (phones.mjs): adds CTC on it")
    parser.add_argument("--said-weight", type=float, default=0.5, help="weight of the CTC on what was said")
    parser.add_argument("--save-minutes", type=float, default=10.0)
    parser.add_argument("--check-minutes", type=float, default=30.0)
    parser.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 2))
    parser.add_argument("--no-augment", action="store_true", help="clean audio, no masking (a check that the model can learn at all)")
    parser.add_argument("--d", type=int, default=176)
    parser.add_argument("--layers", type=int, default=10)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    labels = Labels(args.labels)
    rows = [json.loads(l) for l in args.manifest.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if r["id"] in labels.where]
    said = {}
    if args.phones and args.phones.exists():
        for l in args.phones.read_text(encoding="utf-8").splitlines():
            if l.strip():
                x = json.loads(l)
                said[x["id"]] = x["phones"]
    train = [r for r in rows if r["split"] == "train"]
    dev = [r for r in rows if r["split"] == "dev"]
    print(json.dumps({"train_clips": len(train), "train_hours": round(sum(r["seconds"] for r in train) / 3600, 1), "dev_clips": len(dev), "device": device,
                      "with_transcript_sounds": sum(r["id"] in said for r in train)}), flush=True)

    model = Student(d=args.d, layers=args.layers).to(device)
    model.specaug = not args.no_augment
    print(json.dumps(size_report(model)), flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.98), weight_decay=0.01)
    scaler = torch.amp.GradScaler("cuda", enabled=device == "cuda")
    state = {"step": 0, "seconds_trained": 0.0, "epoch": 0, "best": None}
    last = args.out / "last.pt"
    if last.exists():
        ck = torch.load(last, map_location=device)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        scaler.load_state_dict(ck["scaler"])
        state = ck["state"]
        print(json.dumps({"resumed": state}), flush=True)

    sampler = Buckets(train, args.batch_seconds, args.max_seconds)
    data = Clips(train, labels, args.max_seconds, augment=not args.no_augment, said=said)
    budget = args.hours * 3600

    def save(path):
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "scaler": scaler.state_dict(), "state": state,
                    "config": model.config}, str(path) + ".tmp")
        os.replace(str(path) + ".tmp", path)

    log = open(args.out / "log.jsonl", "a", encoding="utf-8")
    t_start = time.time() - state["seconds_trained"]
    t_save = t_check = time.time()
    done = False
    while not done:
        sampler.epoch = state["epoch"]
        loader = torch.utils.data.DataLoader(data, batch_sampler=sampler, collate_fn=collate, num_workers=args.workers,
                                             pin_memory=device == "cuda", persistent_workers=False, prefetch_factor=4 if args.workers else None)
        for waves, idx, logp, said_batch in loader:
            elapsed = time.time() - t_start
            progress = min(1.0, elapsed / budget)
            warm = min(1.0, elapsed / (args.warmup_minutes * 60 + 1e-9))
            lr = args.lr * warm * (0.02 + 0.98 * 0.5 * (1 + math.cos(math.pi * progress)))
            for g in opt.param_groups:
                g["lr"] = lr
            waves, idx, logp = waves.to(device, non_blocking=True), idx.to(device, non_blocking=True), logp.to(device, non_blocking=True)
            with torch.autocast(device_type="cuda", dtype=torch.float16, enabled=device == "cuda"):
                out = model(waves)
            loss, ctc = losses(out, idx, logp, args.blank_weight, args.ctc_weight)
            said_loss = said_ctc(out, said_batch) if said else out.sum() * 0
            loss = loss + args.said_weight * said_loss
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            state["step"] += 1
            state["seconds_trained"] = time.time() - t_start
            if state["step"] % 50 == 0 or state["step"] <= 3:
                rec = {"step": state["step"], "epoch": state["epoch"], "loss": round(loss.item(), 4), "ctc": round(ctc.item(), 4), "said": round(said_loss.item(), 4), "with_said": sum(1 for x in said_batch if len(x)),
                       "lr": round(lr, 6), "hours": round(state["seconds_trained"] / 3600, 3), "batch": int(waves.shape[0]),
                       "seconds": round(waves.shape[0] * waves.shape[1] / 16000, 1)}
                print(json.dumps(rec), flush=True)
                log.write(json.dumps(rec) + "\n")
                log.flush()
            finished = progress >= 1.0 or (args.max_steps and state["step"] >= args.max_steps)
            if time.time() - t_check > args.check_minutes * 60 or finished:
                ser, extra = agreement(model, dev, labels, device, said=said)
                rec = {"step": state["step"], "dev_sound_error_vs_teacher": round(ser, 4), **extra}
                print(json.dumps(rec), flush=True)
                log.write(json.dumps(rec) + "\n")
                log.flush()
                score = extra.get("dev_sound_error_vs_said", ser)
                if state["best"] is None or score < state["best"]:
                    state["best"] = score
                    torch.save({"model": model.state_dict(), "config": model.config, "step": state["step"], "dev_ser": ser, **extra}, args.out / "best.pt")
                t_check = time.time()
            if time.time() - t_save > args.save_minutes * 60 or finished:
                save(last)
                t_save = time.time()
            if finished:
                done = True
                break
        else:
            state["epoch"] += 1
    save(last)
    print(json.dumps({"finished": state}), flush=True)


if __name__ == "__main__":
    main()
