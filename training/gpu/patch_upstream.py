"""Teach upstream tiny-voca (pinned commit, cloned by setup.sh) the bilingual vocabulary and the phoneme table front end.

python patch_upstream.py <tiny-voca checkout> <training/data/symbols.json>

1. text.py: Mexican Spanish's sounds and the <es> token appended after the released 76 symbols (every English id unchanged),
   x voiceless; a third front end, "table", that reads each text's tokens from training/data/phonemes.jsonl (made by
   tools/voice-data.mjs with the same code the page uses), so training sees exactly the tokens the page will send.
2. config.py: the defaults become the bilingual model's (87 symbols; speakers F2, M2, MX1).
3. infer.py: --voice accepts every speaker of the configuration.
Each change is an exact replacement that must match once; running it twice is refused (the checkout is already patched).
"""
import json
import sys
from pathlib import Path

MARK = "# tiny-speech bilingual"


def replace(path, old, new):
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one match for {old[:60]!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def main():
    root, symbols_file = Path(sys.argv[1]), Path(sys.argv[2])
    spec = json.loads(symbols_file.read_text(encoding="utf-8"))
    src = root / "src" / "tiny_voca"
    text = src / "text.py"
    if MARK in text.read_text(encoding="utf-8"):
        raise SystemExit("already patched")
    vowels, consonants, token = spec["spanish_vowels"], spec["spanish_consonants"], spec["language_token"]

    replace(text, 'SYMBOLS = SPECIALS + PUNCTUATION + PHONES\n',
            'SYMBOLS = SPECIALS + PUNCTUATION + PHONES\n'
            f'{MARK} (training/gpu/patch_upstream.py): Mexican Spanish\'s own sounds and a language token, appended after the\n'
            '# released 76 symbols so every English id is unchanged.\n'
            f'SPANISH_VOWELS = {tuple(vowels)!r}\n'
            f'SPANISH_CONSONANTS = {tuple(consonants)!r}\n'
            f'LANGUAGE_TOKENS = ({token!r},)\n'
            'SYMBOLS = SYMBOLS + SPANISH_VOWELS + SPANISH_CONSONANTS + LANGUAGE_TOKENS\n'
            'CONSONANTS = CONSONANTS + SPANISH_CONSONANTS\n'
            'VOWELS = VOWELS + SPANISH_VOWELS\n'
            'PHONES = CONSONANTS + VOWELS\n')
    replace(text, '"tʃ", "ʔ"))', '"tʃ", "ʔ", "x"))')
    replace(text, 'FRONTENDS = ("espeak", "own")', 'FRONTENDS = ("espeak", "own", "table")')
    replace(text, 'def frontend_identity():\n',
            f'{MARK}: the "table" front end reads each text\'s tokens from a JSONL file ({{"text", "symbols", "stress"}}).\n'
            'TABLE_VARIABLE = "TINY_VOCA_PHONEME_TABLE"\n'
            '_table_rows = None\n\n\n'
            'def _table_key(text):\n'
            '    return re.sub(r"\\s+", " ", unicodedata.normalize("NFKC", text)).strip()\n\n\n'
            'def _table():\n'
            '    global _table_rows\n'
            '    if _table_rows is None:\n'
            '        path = os.environ.get(TABLE_VARIABLE)\n'
            '        if not path:\n'
            '            raise RuntimeError(f"the table front end needs {TABLE_VARIABLE}: the path of training/data/phonemes.jsonl")\n'
            '        data = open(path, "rb").read()\n'
            '        rows = {}\n'
            '        for line in data.decode("utf-8").splitlines():\n'
            '            if line.strip():\n'
            '                row = json.loads(line)\n'
            '                rows[_table_key(row["text"])] = row\n'
            '        _table_rows = (hashlib.sha256(data).hexdigest(), rows)\n'
            '    return _table_rows\n\n\n'
            'def frontend_identity():\n'
            '    if _frontend == "table":\n'
            '        return {"phonemizer": "tiny-speech table", "table": _table()[0], "symbols": list(SYMBOLS)}\n')
    replace(text, 'def frontend_runtime():\n    """What an annotation run records about the exact program behind its\n    tokens: the eSpeak version, or the fingerprint of the phonemizer build."""\n',
            'def frontend_runtime():\n    """What an annotation run records about the exact program behind its\n    tokens: the eSpeak version, or the fingerprint of the phonemizer build."""\n'
            '    if _frontend == "table":\n'
            '        return {"phonemizer": _table()[0]}\n')
    replace(text, '    if _frontend == "own":\n        return tokenize(_dizione().pieces(text))\n',
            '    if _frontend == "table":\n'
            '        row = _table()[1].get(_table_key(text))\n'
            '        if row is None:\n'
            '            raise ValueError(f"text not in the phoneme table: {text!r}")\n'
            '        symbols = tuple(row["symbols"].split(" "))\n'
            '        return Phonemized(symbols, tuple(SYMBOL_TO_ID[s] for s in symbols), tuple(int(s) for s in row["stress"]), ())\n'
            '    if _frontend == "own":\n        return tokenize(_dizione().pieces(text))\n')

    config = src / "config.py"
    replace(config, 'speakers: tuple[str, ...] = ("F2", "M2")', f'speakers: tuple[str, ...] = ("F2", "M2", {spec["speaker"]!r})  {MARK}')
    replace(config, 'vocab_size: int = 76', f'vocab_size: int = {len(spec["symbols"])}  {MARK}')

    infer = src / "infer.py"
    replace(infer, 'parser.add_argument("--voice", choices=("F2", "M2"), default="F2")',
            f'parser.add_argument("--voice", choices=Config().speakers, default="F2")  {MARK}')

    # the patched inventory must be the page's, symbol for symbol
    sys.path.insert(0, str(root / "src"))
    from tiny_voca import text as patched  # noqa: E402
    if list(patched.SYMBOLS) != spec["symbols"]:
        raise SystemExit("the patched symbol table differs from training/data/symbols.json")
    print(f"patched {root}: {len(patched.SYMBOLS)} symbols, front ends {patched.FRONTENDS}")


if __name__ == "__main__":
    main()
