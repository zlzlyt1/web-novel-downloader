# -*- coding: utf-8 -*-
"""Investigate how obfuscation glyphs differ from reference glyphs."""
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

OBF = "cache/dc027189e0ba4cd.woff2"
REF = "cache/SourceHanSansCN-Normal.otf"


def bbox_of(gs, name):
    pen = RecordingPen()
    gs[name].draw(pen)
    xs, ys = [], []
    for op, args in pen.value:
        if op in ("moveTo", "lineTo", "curveTo", "qCurveTo"):
            for x, y in args:
                xs.append(x); ys.append(y)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def main():
    obf = TTFont(OBF)
    ref = TTFont(REF)
    obf_gs = obf.getGlyphSet()
    ref_gs = ref.getGlyphSet()
    obf_cmap = obf.getBestCmap()

    # width/height distribution of obfuscation PUA glyphs
    import collections
    widths = collections.Counter()
    heights = collections.Counter()
    for cp, gname in obf_cmap.items():
        if not (0xE000 <= cp <= 0xF8FF):
            continue
        b = bbox_of(obf_gs, gname)
        if b:
            widths[int(b[2]-b[0])] += 1
            heights[int(b[3]-b[1])] += 1
    print("obf PUA glyph bbox WIDTH top:", widths.most_common(8))
    print("obf PUA glyph bbox HEIGHT top:", heights.most_common(8))

    # reference CJK glyph bbox width distribution (sample)
    rw = collections.Counter()
    for cp in range(0x4E00, 0x9FA6):
        gname = ref.getBestCmap().get(cp)
        if not gname:
            continue
        b = bbox_of(ref_gs, gname)
        if b:
            rw[int(b[2]-b[0])] += 1
    print("ref CJK glyph bbox WIDTH top:", rw.most_common(8))

    # Print full outline of obfuscation U+E52E
    print("\n=== obf U+E52E full outline ===")
    pen = RecordingPen()
    obf_gs[obf_cmap[0xE52E]].draw(pen)
    for op, args in pen.value:
        print(op, args)

    # Print outline of reference 一 (U+4E00) and 人 (U+4EBA) and 大 (U+5927)
    for ch in ["一", "人", "大", "门", "太", "的"]:
        cp = ord(ch)
        gname = ref.getBestCmap().get(cp)
        if not gname:
            print("ref missing", ch)
            continue
        b = bbox_of(ref_gs, gname)
        print("ref %s U+%04X bbox=%s" % (ch, cp, b))


if __name__ == "__main__":
    main()
