# -*- coding: utf-8 -*-
"""
Phase 1 spike (Python): match the obfuscation font's PUA glyphs against a
reference Source Han Sans font by glyph outline, to recover PUA -> real char.

Usage: python src/crawler/map-font.py
"""
import json
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

OBF_PATH = "cache/dc027189e0ba4cd.woff2"
REF_PATH = "cache/SourceHanSansCN-Normal.otf"
OUT_PATH = "cache/font-map-dc027189e0ba4cd.json"


def glyph_signature(glyph_set, name):
    """Return a canonical string signature of a glyph's outline, or None if empty."""
    pen = RecordingPen()
    try:
        glyph_set[name].draw(pen)
    except Exception:
        return None
    ops = pen.value
    pts = []
    for op, args in ops:
        if op in ("moveTo", "lineTo", "curveTo", "qCurveTo"):
            for p in args:
                pts.append(p)
    if not pts:
        return None
    min_x = min(p[0] for p in pts)
    min_y = min(p[1] for p in pts)
    parts = []
    for op, args in ops:
        if op == "closePath":
            parts.append("Z")
        elif op in ("moveTo", "lineTo", "curveTo", "qCurveTo"):
            nargs = tuple((int(round(p[0] - min_x)), int(round(p[1] - min_y))) for p in args)
            parts.append(op + ":" + str(nargs))
        else:
            parts.append(op)
    return ";".join(parts)


def main():
    obf = TTFont(OBF_PATH)
    ref = TTFont(REF_PATH)

    print("obf unitsPerEm:", obf["head"].unitsPerEm)
    print("ref unitsPerEm:", ref["head"].unitsPerEm)
    name_table = ref["name"]
    ver = name_table.getDebugName(5)
    print("ref version:", ver)

    ref_gs = ref.getGlyphSet()
    ref_cmap = ref.getBestCmap()

    # Build signature -> [codepoints] map from reference.
    ref_map = {}
    for cp, gname in ref_cmap.items():
        sig = glyph_signature(ref_gs, gname)
        if sig is None:
            continue
        ref_map.setdefault(sig, []).append(cp)
    print("ref signature map size:", len(ref_map), "| cmap size:", len(ref_cmap))

    obf_gs = obf.getGlyphSet()
    obf_cmap = obf.getBestCmap()

    matched = 0
    unmatched = 0
    multi = 0
    mapping = {}
    for cp, gname in obf_cmap.items():
        if not (0xE000 <= cp <= 0xF8FF):
            continue
        sig = glyph_signature(obf_gs, gname)
        if sig is None:
            unmatched += 1
            continue
        hit = ref_map.get(sig)
        if hit:
            matched += 1
            char_code = hit[0]
            mapping[cp] = {"char": chr(char_code), "charCode": char_code, "alternatives": hit}
            if len(hit) > 1:
                multi += 1
        else:
            unmatched += 1
            if unmatched <= 25:
                print("UNMATCHED PUA U+%04X" % cp)

    print("=== match result ===")
    print("matched:", matched, "unmatched:", unmatched, "multi-alternative:", multi)
    print("mapping size:", len(mapping))

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print("saved to", OUT_PATH)

    for cp, v in list(mapping.items())[:30]:
        print("U+%04X -> %s (U+%04X)" % (cp, v["char"], v["charCode"]))


if __name__ == "__main__":
    sys.exit(main())
