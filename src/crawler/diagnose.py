# -*- coding: utf-8 -*-
"""Diagnose: do obfuscation glyphs match reference glyphs for KNOWN chars?"""
import json
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

OBF = "cache/dc027189e0ba4cd.woff2"
REF = "cache/SourceHanSansCN-Normal.otf"
BASE = 58344  # 0xE3E8


def outline(gs, name):
    pen = RecordingPen()
    gs[name].draw(pen)
    pts = []
    for op, args in pen.value:
        if op in ("moveTo", "lineTo", "curveTo", "qCurveTo"):
            for x, y in args:
                pts.append((int(round(x)), int(round(y))))
    return pts


def norm(pts):
    if not pts:
        return []
    minx = min(p[0] for p in pts)
    miny = min(p[1] for p in pts)
    return sorted((p[0]-minx, p[1]-miny) for p in pts)


def main():
    charset = json.load(open("cache/charset.json", encoding="utf-8"))[0]
    obf = TTFont(OBF)
    ref = TTFont(REF)
    obf_gs = obf.getGlyphSet()
    ref_gs = ref.getGlyphSet()
    obf_cmap = obf.getBestCmap()
    ref_cmap = ref.getBestCmap()

    # Test several known (index -> char) pairs.
    test_indices = [1, 2, 5, 10, 20, 40, 100, 326]  # 在,主,军,要,现,月,真,? (need to know)
    for i in test_indices:
        ch = charset[i]
        pua = BASE + i
        gname = obf_cmap.get(pua)
        if not gname:
            print("index %d: PUA U+%04X not in obf cmap" % (i, pua))
            continue
        op = norm(outline(obf_gs, gname))
        rp = norm(outline(ref_gs, ref_cmap[ord(ch)])) if ord(ch) in ref_cmap else None
        if rp is None:
            print("index %d: char %r not in ref" % (i, ch))
            continue
        same = op == rp
        common = len(set(op) & set(rp))
        print("index %d: %r U+%04X | obf_pts=%d ref_pts=%d | exact=%s common=%d" % (i, ch, pua, len(op), len(rp), same, common))


if __name__ == "__main__":
    main()
