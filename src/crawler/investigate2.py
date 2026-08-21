# -*- coding: utf-8 -*-
"""Compare obfuscation U+E52E against reference 回/口/日/目 outlines directly,
and try a fuzzy nearest-neighbor match."""
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

OBF = "cache/dc027189e0ba4cd.woff2"
REF = "cache/SourceHanSansCN-Normal.otf"


def points(gs, name):
    pen = RecordingPen()
    gs[name].draw(pen)
    out = []
    for op, args in pen.value:
        if op in ("moveTo", "lineTo", "curveTo", "qCurveTo"):
            out.extend((round(x), round(y)) for x, y in args)
    return out


def norm(pts):
    minx = min(p[0] for p in pts)
    miny = min(p[1] for p in pts)
    return sorted((p[0]-minx, p[1]-miny) for p in pts)


def main():
    obf = TTFont(OBF)
    ref = TTFont(REF)
    obf_gs = obf.getGlyphSet()
    ref_gs = ref.getGlyphSet()
    obf_cmap = obf.getBestCmap()
    ref_cmap = ref.getBestCmap()

    target = norm(points(obf_gs, obf_cmap[0xE52E]))
    print("obf U+E52E has", len(target), "points")
    for ch in ["回", "口", "日", "目", "田", "国", "因", "囗"]:
        gname = ref_cmap.get(ord(ch))
        if gname:
            rp = norm(points(ref_gs, gname))
            same = rp == target
            # count matching points
            common = len(set(rp) & set(target))
            print("ref %s U+%04X: pts=%d, exact_same=%s, common_pts=%d" % (ch, ord(ch), len(rp), same, common))

    # Fuzzy: for U+E52E, find nearest reference glyph by point-set Jaccard among all CJK
    print("\n=== fuzzy nearest for U+E52E ===")
    tset = set(target)
    best = []
    for cp in range(0x4E00, 0x9FA6):
        gname = ref_cmap.get(cp)
        if not gname:
            continue
        rp = norm(points(ref_gs, gname))
        rset = set(rp)
        inter = len(tset & rset)
        union = len(tset | rset)
        jac = inter / union if union else 0
        best.append((jac, chr(cp)))
    best.sort(reverse=True)
    print("top 10:", best[:10])


if __name__ == "__main__":
    main()
