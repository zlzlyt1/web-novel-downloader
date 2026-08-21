# -*- coding: utf-8 -*-
"""恢复 charset.json 中的 '?' 字符：渲染字形位图 + 余弦相似度匹配参考字体。"""
import json
import numpy as np
from PIL import Image, ImageFont

OBF = "cache/obf.otf"
REF = "cache/SourceHanSansCN-Normal.otf"
CHARSET_PATH = "src/crawler/charset.json"
SIZE = 48
FONT_SIZE = 64


def render(font, ch):
    """渲染单个字符为 (SIZE, SIZE) 的归一化向量，失败返回 None。"""
    try:
        mask = font.getmask(ch, mode="L")
    except Exception:
        return None
    if mask is None or mask.size[0] == 0 or mask.size[1] == 0:
        return None
    img = mask.resize((SIZE, SIZE), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32).flatten()
    norm = np.linalg.norm(arr)
    if norm == 0:
        return None
    return arr / norm


def candidate_codepoints():
    cps = []
    # CJK 基本区 + 扩展A + 兼容 + 常用标点 + 全角 + 拉丁/数字
    ranges = [
        (0x4E00, 0x9FFF),
        (0x3400, 0x4DBF),
        (0xF900, 0xFAFF),
        (0x3000, 0x303F),
        (0xFF00, 0xFFEF),
        (0x2000, 0x206F),
        (0x0020, 0x007E),
        (0x2018, 0x201D),
    ]
    for lo, hi in ranges:
        for cp in range(lo, hi + 1):
            cps.append(cp)
    return cps


def main():
    obf_font = ImageFont.truetype(OBF, FONT_SIZE)
    ref_font = ImageFont.truetype(REF, FONT_SIZE)

    charset = json.load(open(CHARSET_PATH, encoding="utf-8"))

    # 收集 '?' 位置
    questions = []
    for mode in (0, 1):
        for i, c in enumerate(charset[mode]):
            if c == "?":
                questions.append((mode, i))

    # 渲染参考字体候选
    print("渲染参考字体候选字符…")
    ref_mat = []
    ref_cps = []
    for cp in candidate_codepoints():
        v = render(ref_font, chr(cp))
        if v is not None:
            ref_mat.append(v)
            ref_cps.append(cp)
    ref_mat = np.stack(ref_mat)  # (N, D)
    print("参考候选数:", len(ref_cps))

    # 恢复每个 '?'
    report = []
    for mode, i in questions:
        pua = 58344 + i if mode == 0 else 58345 + i
        q = render(obf_font, chr(pua))
        if q is None:
            report.append((mode, i, pua, None, 0.0, 0.0, False))
            print(f"mode{mode} index{i} U+{pua:04X}: 字体无此字形(空隙)")
            continue
        scores = ref_mat @ q  # 余弦相似度
        order = np.argsort(-scores)
        best_idx = order[0]
        best_cp = ref_cps[best_idx]
        best_score = scores[best_idx]
        second_score = scores[order[1]] if len(order) > 1 else 0.0
        confident = best_score > 0.55 and (best_score - second_score) > 0.02
        ch = chr(best_cp)
        report.append((mode, i, pua, ch, float(best_score), float(second_score), confident))
        print(f"mode{mode} index{i} U+{pua:04X} -> {ch!r} (U+{best_cp:04X}) score={best_score:.3f} second={second_score:.3f} {'OK' if confident else 'LOW'}")

    # 写回
    for mode, i, pua, ch, score, second, confident in report:
        if ch and confident:
            charset[mode][i] = ch
    json.dump(charset, open(CHARSET_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # 报告
    with open("cache/charset-recovery-report.md", "w", encoding="utf-8") as f:
        f.write("# charset '?' 恢复报告\n\n")
        for mode, i, pua, ch, score, second, confident in report:
            f.write(f"- mode{mode} index{i} U+{pua:04X} -> {ch!r} (score={score:.3f}, second={second:.3f}, {'OK' if confident else 'LOW'})\n")

    print("完成，已写回", CHARSET_PATH, "和 cache/charset-recovery-report.md")


if __name__ == "__main__":
    main()
