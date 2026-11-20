"""Run the tiny-ears notebook on Kaggle from a cloud session whose network proxy holds the Kaggle API token (README.md here).

python push.py push  MODE --user KAGGLE_USERNAME [--kit ears|voice] [--timeout-hours H]
                                                   upload the kit's notebook set to MODE as <user>/tiny-ears-<mode> (or tiny-voice-<mode>), run it
python push.py status SLUG                                             e.g. lars/tiny-ears-smoke
python push.py output SLUG DIR [--pattern REGEX]                       the run's log and output files
python push.py quota                                                   GPU hours used and allowed this week

The token is never in a file or a variable here: requests carry a placeholder that the proxy replaces. (The kaggle command
itself checks a token by sending it in the request body, which a proxy cannot fill in, so this talks to the API directly.)
Kits: ears (../ears.ipynb: smoke and data on a CPU, no GPU allowance used; train on a T4 with tiny-ears-data's output as its
input) and voice (../../gpu/kaggle/voice.ipynb: design on a T4, the bilingual tiny-voca voice).
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TIMEOUT = {"smoke": 1.5, "data": 11.5, "train": 11.6, "all": 11.6}  # hours: Kaggle stops the session then (protects the allowance)
KITS = {
    "ears": {"notebook": HERE.parent / "ears.ipynb", "prefix": "tiny-ears", "timeout": TIMEOUT, "gpu": {"train", "all"},
             "sources": {"train": "tiny-ears-data"}},
    "voice": {"notebook": HERE.parent.parent / "gpu" / "kaggle" / "voice.ipynb", "prefix": "tiny-voice",
              "timeout": {"design": 1.5, "teacher": 11.6, "train": 11.6}, "gpu": {"design", "teacher", "train"}, "sources": {}},
}


def client():
    from kagglesdk import KaggleClient, KaggleEnv
    return KaggleClient(env=KaggleEnv.PROD, api_token="proxy-injected")


def notebook(mode, kit="ears"):
    nb = json.loads(KITS[kit]["notebook"].read_text(encoding="utf-8"))
    src = "".join(nb["cells"][1]["source"])
    src, n = re.subn(r'^MODE = "[a-z]+"', f'MODE = "{mode}"', src, count=1, flags=re.M)
    assert n == 1, "the notebook's MODE line moved"
    nb["cells"][1]["source"] = src.splitlines(keepends=True)
    return json.dumps(nb)


def push(args):
    from kagglesdk.kernels.types.kernels_api_service import ApiSaveKernelRequest
    kit = KITS[args.kit]
    if args.mode not in kit["timeout"]:
        raise SystemExit(f"{args.kit}: no mode {args.mode} ({', '.join(kit['timeout'])})")
    gpu = args.mode in kit["gpu"]
    r = ApiSaveKernelRequest()
    r.slug = f"{args.user}/{kit['prefix']}-{args.mode}"
    r.new_title = f"{kit['prefix']}-{args.mode}"
    r.text = notebook(args.mode, args.kit)
    r.language = "python"
    r.kernel_type = "notebook"
    r.is_private = True
    r.enable_gpu = gpu
    r.enable_tpu = False
    r.enable_internet = True
    r.dataset_data_sources = []
    r.competition_data_sources = []
    r.kernel_data_sources = [f"{args.user}/{kit['sources'][args.mode]}"] if args.mode in kit["sources"] else []
    r.model_data_sources = []
    r.category_ids = []
    if gpu:
        r.machine_shape = "NvidiaTeslaT4"
    r.session_timeout_seconds = int(3600 * (args.timeout_hours or kit["timeout"][args.mode]))
    with client() as k:
        out = k.kernels.kernels_api_client.save_kernel(r)
    print(json.dumps({"ref": out.ref, "url": out.url, "version": out.version_number, "error": out.error,
                      "invalid_tags": out.invalid_tags, "invalid_dataset_sources": out.invalid_dataset_sources,
                      "invalid_kernel_sources": out.invalid_kernel_sources}, default=str))


def status(args):
    from kagglesdk.kernels.types.kernels_api_service import ApiGetKernelSessionStatusRequest
    user, slug = args.slug.split("/")
    r = ApiGetKernelSessionStatusRequest()
    r.user_name, r.kernel_slug = user, slug
    with client() as k:
        s = k.kernels.kernels_api_client.get_kernel_session_status(r)
    print(json.dumps({"status": str(s.status), "failure": s.failure_message}, default=str))


def output(args):
    import requests
    from kagglesdk.kernels.types.kernels_api_service import ApiListKernelSessionOutputRequest
    user, slug = args.slug.split("/")
    dest = Path(args.dir)
    dest.mkdir(parents=True, exist_ok=True)
    token = None
    with client() as k:
        while True:
            r = ApiListKernelSessionOutputRequest()
            r.user_name, r.kernel_slug = user, slug
            r.page_size = 100
            if token:
                r.page_token = token
            res = k.kernels.kernels_api_client.list_kernel_session_output(r)
            if res.log and not token:
                (dest / f"{slug}.log").write_text(res.log, encoding="utf-8")
                print(json.dumps({"log": str(dest / f"{slug}.log"), "chars": len(res.log)}))
            for f in res.files or []:
                if args.pattern and not re.search(args.pattern, f.file_name):
                    continue
                target = (dest / f.file_name).resolve()
                if not str(target).startswith(str(dest.resolve())):
                    continue  # a name that would leave the folder
                target.parent.mkdir(parents=True, exist_ok=True)
                with requests.get(f.url, stream=True, timeout=600) as resp:
                    resp.raise_for_status()
                    with open(target, "wb") as w:
                        for chunk in resp.iter_content(1 << 20):
                            w.write(chunk)
                print(json.dumps({"file": f.file_name, "bytes": target.stat().st_size}))
            token = res.next_page_token
            if not token:
                break


def quota(args):
    from kagglesdk.kernels.types.kernels_api_service import ApiGetAcceleratorQuotaStatisticsRequest
    with client() as k:
        q = k.kernels.kernels_api_client.get_accelerator_quota_statistics(ApiGetAcceleratorQuotaStatisticsRequest())
    g = q.gpu_quota  # durations: use total_seconds (the SDK's own to_dict drops whole days: 30 h prints as 21600s)
    print(json.dumps({"gpu_hours_used": round(g.time_used.total_seconds() / 3600, 2), "gpu_hours_allowed": round(g.total_time_allowed.total_seconds() / 3600, 2),
                      "refresh": str(q.quota_refresh_time)}))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("push")
    a.add_argument("mode", choices=sorted({m for k in KITS.values() for m in k["timeout"]}))
    a.add_argument("--user", required=True)
    a.add_argument("--kit", choices=list(KITS), default="ears")
    a.add_argument("--timeout-hours", type=float)
    a = sub.add_parser("status")
    a.add_argument("slug")
    a = sub.add_parser("output")
    a.add_argument("slug")
    a.add_argument("dir")
    a.add_argument("--pattern")
    sub.add_parser("quota")
    args = p.parse_args()
    {"push": push, "status": status, "output": output, "quota": quota}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
