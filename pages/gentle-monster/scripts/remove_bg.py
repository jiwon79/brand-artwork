#!/usr/bin/env python3
"""배경 제거 스크립트 (PIL 기반).

JPG 배경이 균일한 #f3f4f6 (243, 244, 246) 임을 검증함.
각 픽셀의 RGB가 배경색과 얼마나 다른지 max-channel-diff로 측정:
- diff = 0   → alpha 0   (배경 그 자체, 완전 투명)
- diff ≥ EDGE → alpha 255 (배경과 충분히 다름, 완전 불투명)
- 사이값 → 선형 (안티앨리어싱 보존)"""
import json
import time
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "assets" / "images"
META = ROOT / "assets" / "metadata.json"
LIMIT = 90

BG = np.array([243, 244, 246], dtype=np.int32)  # JPG 배경색 (#f3f4f6)
EDGE = 12  # max-channel-diff가 이 이상이면 완전 불투명
TARGET_SIZE = 1200  # 리사이즈 출력 크기 (줌 인 + 고DPI 대응)

products = json.loads(META.read_text(encoding="utf-8"))[:LIMIT]
files = []
for p in products:
    for v in p["color_variants"]:
        files.extend(v["images"])
files = list(dict.fromkeys(files))
# metadata가 이미 .png를 가리킬 수 있음 — 항상 .jpg 원본을 소스로 사용
files = [f.rsplit(".", 1)[0] + ".jpg" for f in files]
print(f"target: {len(files)} images", flush=True)

t0 = time.time()
done = 0
for fname in files:
    src = IMG_DIR / fname
    dst = IMG_DIR / (fname[:-4] + ".png")
    if not src.exists():
        print(f"missing: {fname}", flush=True)
        continue
    img = Image.open(src).convert("RGB")
    if max(img.size) > TARGET_SIZE:
        img.thumbnail((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
    arr = np.array(img).astype(np.int32)
    # 배경색과의 max-channel-diff
    diff = np.max(np.abs(arr - BG), axis=2)
    alpha = np.clip(diff / EDGE, 0.0, 1.0) * 255.0
    rgba = np.dstack([arr.astype(np.uint8), alpha.astype(np.uint8)])
    Image.fromarray(rgba, "RGBA").save(dst, optimize=True)
    done += 1
    if done % 30 == 0:
        rate = done / (time.time() - t0)
        print(f"{done}/{len(files)} — {rate:.1f}img/s", flush=True)

print(f"done: {done} files in {time.time()-t0:.1f}s", flush=True)
