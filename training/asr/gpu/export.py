"""A fine-tuned Whisper → the files the sites' transformers.js reads, in onnx-community/whisper-tiny's layout, 8-bit.

python export.py --model work/whisper-tiny-mx/final --out work/whisper-tiny-mx-onnx

Writes config.json, generation_config.json, preprocessor_config.json, the tokenizer files, onnx/encoder_model_quantized.onnx
and onnx/decoder_model_merged_quantized.onnx (decoder with and without past, one file), weights 8-bit as onnx-community's
"quantized" files are. A site then serves the folder as its own model (apps/*.json asr.models.es) instead of
onnx-community/whisper-tiny. Checked here by transcribing a few clips with the exported files (optimum + onnxruntime).
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def tie_to_8bit(path):
    """The word table is shared by the word lookup and the output layer. The quantizer gives the lookup the 8-bit table but
    leaves the output layer reading the 32-bit one through a Transpose (80 MB of the decoder's 110). Do what onnx-community's
    whisper-tiny file does: transpose the 8-bit table, turn it back (DequantizeLinear) and multiply; then drop the 32-bit
    table. About 30 MB, like the file the sites load today."""
    import onnx
    from onnx import helper
    model = onnx.load(path)
    names = {i.name for i in model.graph.initializer}
    changed = 0

    def walk(graph):
        nonlocal changed
        nodes = []
        for node in graph.node:
            for a in node.attribute:
                if a.type == onnx.AttributeProto.GRAPH:
                    walk(a.g)
            table = node.input[0] if node.op_type == "Transpose" else None
            if table and f"{table}_quantized" in names and f"{table}_scale" in names:
                flipped = f"{table}_transposed_quantized"
                nodes.append(helper.make_node("Transpose", [f"{table}_quantized"], [flipped], name=node.name + "_8bit", **{a.name: helper.get_attribute_value(a) for a in node.attribute}))
                nodes.append(helper.make_node("DequantizeLinear", [flipped, f"{table}_scale", f"{table}_zero_point"], [node.output[0]], name=node.name + "_dq"))
                changed += 1
            else:
                nodes.append(node)
        del graph.node[:]
        graph.node.extend(nodes)

    walk(model.graph)

    def used(graph, name):
        return any(name in n.input or any(a.type == onnx.AttributeProto.GRAPH and used(a.g, name) for a in n.attribute) for n in graph.node)
    for init in list(model.graph.initializer):
        if f"{init.name}_quantized" in names and not used(model.graph, init.name):
            model.graph.initializer.remove(init)
    onnx.save(model, path)
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--check", type=Path, help="A transcripts manifest to check a few clips with the exported files")
    args = parser.parse_args()
    from onnxruntime.quantization import QuantType, quantize_dynamic

    raw = args.out / "fp32"
    if raw.exists():
        shutil.rmtree(raw)
    subprocess.run([sys.executable, "-m", "optimum.exporters.onnx", "--model", str(args.model), "--task", "automatic-speech-recognition-with-past", str(raw)], check=True)
    onnx = args.out / "onnx"
    onnx.mkdir(parents=True, exist_ok=True)
    for name in ("encoder_model", "decoder_model_merged"):
        # inside the merged decoder's two branches too (EnableSubgraph), and the word table (Gather): else most of it stays 32-bit
        quantize_dynamic(str(raw / f"{name}.onnx"), str(onnx / f"{name}_quantized.onnx"), weight_type=QuantType.QUInt8,
                         op_types_to_quantize=["MatMul", "Gather"], extra_options={"EnableSubgraph": True})
    for f in raw.iterdir():
        if f.suffix == ".json" or f.name in ("vocab.json", "merges.txt", "normalizer.json", "added_tokens.json", "special_tokens_map.json"):
            shutil.copy(f, args.out / f.name)
    swapped = tie_to_8bit(str(onnx / "decoder_model_merged_quantized.onnx"))
    sizes = {f.name: f.stat().st_size for f in onnx.iterdir()}
    sizes["output layers reading the 8-bit word table"] = swapped
    print(json.dumps({"out": str(args.out), "onnx": sizes}))
    if args.check:
        # transcribe with the 8-bit files, as onnxruntime-web will
        for name in ("encoder_model", "decoder_model_merged"):
            shutil.copy(onnx / f"{name}_quantized.onnx", raw / f"{name}_q.onnx")
        from optimum.onnxruntime import ORTModelForSpeechSeq2Seq
        from transformers import WhisperProcessor
        import soundfile as sf
        processor = WhisperProcessor.from_pretrained(args.model)
        model = ORTModelForSpeechSeq2Seq.from_pretrained(raw, encoder_file_name="encoder_model_q.onnx", decoder_file_name="decoder_model_merged_q.onnx", use_merged=True)
        rows = [json.loads(line) for line in args.check.read_text(encoding="utf-8").splitlines() if line.strip()][:4]
        for r in rows:
            wave, rate = sf.read(r["audio"], dtype="float32")
            feats = processor(wave, sampling_rate=rate, return_tensors="pt").input_features
            ids = model.generate(feats, language="en" if r["lang"] == "en" else "es", task="transcribe", max_new_tokens=100)
            print(json.dumps({"said": r["text"], "heard (8-bit ONNX)": processor.batch_decode(ids, skip_special_tokens=True)[0].strip()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
