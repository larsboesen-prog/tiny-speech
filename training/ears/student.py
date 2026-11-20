"""The tiny ears: a small sound recognizer (about 7.5M parameters, under 10 MB at 8 bits) that hears the same sounds as the
large teacher (facebook/wav2vec2-lv-60-espeak-cv-ft: 300M parameters, Spanish and English sounds, the probe's recognizer).

Raw 16 kHz audio in, the log-probability of each of the teacher's 392 sounds (and the blank) every 20 ms out: the same
frames and the same sounds as the teacher, so the probe's matcher (training/asr/probe/probe.py) and the city's word list
work with either. The sound features (log-mel) are computed inside the model, so the browser needs nothing but the file.

Frames: the teacher gives floor((N - 400) / 320) + 1 frames for N samples; so does this model (10 ms mel frames, then a
stride-2 convolution with padding 1).
"""
import math

import torch
import torch.nn as nn
import torch.nn.functional as F

RATE, WINDOW, HOP, N_MELS = 16000, 400, 160, 80


def mel_matrix(n_fft=WINDOW, n_mels=N_MELS, rate=RATE, fmin=20.0, fmax=7600.0):
    """Slaney-style triangular mel filters (no librosa needed at run time)."""
    def hz_to_mel(f):
        return 2595.0 * math.log10(1.0 + f / 700.0)

    def mel_to_hz(m):
        return 700.0 * (10 ** (m / 2595.0) - 1.0)

    bins = n_fft // 2 + 1
    freqs = torch.linspace(0, rate / 2, bins)
    points = torch.tensor([mel_to_hz(m) for m in torch.linspace(hz_to_mel(fmin), hz_to_mel(fmax), n_mels + 2).tolist()])
    fb = torch.zeros(n_mels, bins)
    for i in range(n_mels):
        lo, mid, hi = points[i], points[i + 1], points[i + 2]
        up = (freqs - lo) / (mid - lo)
        down = (hi - freqs) / (hi - mid)
        fb[i] = torch.clamp(torch.minimum(up, down), min=0.0) * (2.0 / (hi - lo))
    return fb


class LogMel(nn.Module):
    """log-mel from raw audio with a fixed convolution (a windowed DFT): exports to plain ONNX ops that run in any browser."""

    def __init__(self):
        super().__init__()
        n = torch.arange(WINDOW, dtype=torch.float32)
        window = 0.5 - 0.5 * torch.cos(2 * math.pi * n / WINDOW)
        k = torch.arange(WINDOW // 2 + 1, dtype=torch.float32)[:, None]
        angle = 2 * math.pi * k * n[None, :] / WINDOW
        basis = torch.cat([torch.cos(angle) * window, -torch.sin(angle) * window], 0)  # (2 * 201, 400)
        self.register_buffer("basis", basis[:, None, :], persistent=True)
        self.register_buffer("mel", mel_matrix(), persistent=True)

    def forward(self, wave):  # (B, N) → (B, frames, 80)
        x = wave - wave.mean(dim=1, keepdim=True)
        spec = F.conv1d(x[:, None, :], self.basis, stride=HOP)  # (B, 402, frames)
        half = spec.shape[1] // 2
        power = spec[:, :half] ** 2 + spec[:, half:] ** 2
        mel = torch.matmul(self.mel, power).clamp(min=1e-6).log()  # (B, 80, frames)
        mel = (mel - mel.mean(dim=2, keepdim=True)) / (mel.std(dim=2, keepdim=True) + 1e-5)
        return mel.transpose(1, 2)


class FeedForward(nn.Module):
    def __init__(self, d, mult, dropout):
        super().__init__()
        self.norm, self.up, self.down, self.drop = nn.LayerNorm(d), nn.Linear(d, d * mult), nn.Linear(d * mult, d), nn.Dropout(dropout)

    def forward(self, x):
        return self.drop(self.down(self.drop(F.silu(self.up(self.norm(x))))))


class Attention(nn.Module):
    def __init__(self, d, heads, dropout):
        super().__init__()
        self.heads, self.norm, self.qkv, self.out, self.drop = heads, nn.LayerNorm(d), nn.Linear(d, 3 * d), nn.Linear(d, d), nn.Dropout(dropout)

    def forward(self, x, bias):
        b, t, d = x.shape
        q, k, v = self.qkv(self.norm(x)).reshape(b, t, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        w = torch.matmul(q, k.transpose(-1, -2)) * (d // self.heads) ** -0.5 + bias
        y = torch.matmul(torch.softmax(w, dim=-1), v).transpose(1, 2).reshape(b, t, d)
        return self.drop(self.out(y))


class ConvModule(nn.Module):
    def __init__(self, d, kernel, dropout):
        super().__init__()
        self.norm, self.pw1, self.pw2, self.drop = nn.LayerNorm(d), nn.Linear(d, 2 * d), nn.Linear(d, d), nn.Dropout(dropout)
        self.dw = nn.Conv1d(d, d, kernel, padding=kernel // 2, groups=d)
        self.dw_norm = nn.LayerNorm(d)

    def forward(self, x):
        y = F.glu(self.pw1(self.norm(x)), dim=-1)
        y = self.dw(y.transpose(1, 2)).transpose(1, 2)
        return self.drop(self.pw2(F.silu(self.dw_norm(y))))


class Block(nn.Module):
    """A Conformer block: half feed-forward, attention, convolution, half feed-forward."""

    def __init__(self, d, heads, kernel, mult, dropout):
        super().__init__()
        self.ff1, self.att, self.conv, self.ff2 = FeedForward(d, mult, dropout), Attention(d, heads, dropout), ConvModule(d, kernel, dropout), FeedForward(d, mult, dropout)
        self.norm = nn.LayerNorm(d)

    def forward(self, x, bias):
        x = x + 0.5 * self.ff1(x)
        x = x + self.att(x, bias)
        x = x + self.conv(x)
        x = x + 0.5 * self.ff2(x)
        return self.norm(x)


def relative_bias(t, heads, slopes, device):
    """ALiBi-style distance penalty (no learned positions: any length works, and it exports to plain ops)."""
    pos = torch.arange(t, device=device)
    dist = (pos[None, :] - pos[:, None]).abs().float()
    return -(slopes[:, None, None] * dist[None]).unsqueeze(0)  # (1, heads, t, t)


class Student(nn.Module):
    def __init__(self, vocab=392, d=176, layers=10, heads=4, kernel=15, mult=4, channels=64, dropout=0.1):
        super().__init__()
        self.config = dict(vocab=vocab, d=d, layers=layers, heads=heads, kernel=kernel, mult=mult, channels=channels, dropout=dropout)
        self.logmel = LogMel()
        self.sub = nn.Sequential(nn.Conv2d(1, channels, 3, stride=(2, 2), padding=1), nn.SiLU(),
                                 nn.Conv2d(channels, channels, 3, stride=(1, 2), padding=1), nn.SiLU())
        self.proj = nn.Linear(channels * (N_MELS // 4), d)
        self.drop = nn.Dropout(dropout)
        self.blocks = nn.ModuleList(Block(d, heads, kernel, mult, dropout) for _ in range(layers))
        self.head = nn.Linear(d, vocab)
        self.register_buffer("slopes", torch.tensor([2 ** (-8 * (h + 1) / heads) for h in range(heads)]), persistent=True)

    @staticmethod
    def frames(samples):
        return (samples - WINDOW) // (2 * HOP) + 1

    specaug = False  # train.py turns it on: hide a few mel bands and moments, so the student cannot lean on any one of them

    def _mask(self, x):  # (B, T10, 80)
        b, t, f = x.shape
        x = x.clone()
        for i in range(b):
            for _ in range(2):
                w = int(torch.randint(0, 11, ()).item())
                f0 = int(torch.randint(0, max(1, f - w), ()).item())
                x[i, :, f0:f0 + w] = 0
                w = int(torch.randint(0, max(1, int(0.05 * t)) + 1, ()).item())
                t0 = int(torch.randint(0, max(1, t - w), ()).item())
                x[i, t0:t0 + w, :] = 0
        return x

    def forward(self, wave):  # (B, N) float in [-1, 1] → (B, frames, vocab) log-probabilities
        x = self.logmel(wave)
        if self.training and self.specaug:
            x = self._mask(x)
        x = x[:, None]  # (B, 1, T10, 80)
        x = self.sub(x)  # (B, C, T20, 20)
        b, c, t, f = x.shape
        x = self.drop(self.proj(x.permute(0, 2, 1, 3).reshape(b, t, c * f)))
        bias = relative_bias(t, self.config["heads"], self.slopes, x.device)
        for block in self.blocks:
            x = block(x, bias)
        return torch.log_softmax(self.head(x), dim=-1)


def size_report(model):
    params = sum(p.numel() for p in model.parameters())
    linear = sum(m.weight.numel() for m in model.modules() if isinstance(m, nn.Linear))
    buffers = sum(b.numel() for b in model.buffers())
    # 8-bit for the linear layers' weights (dynamic quantization), 32-bit for the rest and the fixed DFT and mel tables
    approx = linear + 4 * (params - linear + buffers)
    return {"parameters": params, "in_linear_layers": linear, "approx_8bit_mb": round(approx / 1e6, 2)}


if __name__ == "__main__":
    import json
    m = Student()
    print(json.dumps(size_report(m)))
    for n in (16000, 16000 * 3 + 123):
        y = m(torch.randn(2, n) * 0.1)
        assert y.shape[1] == Student.frames(n), (y.shape, Student.frames(n))
    print("frames match the teacher's rule")
