#!/usr/bin/env python3
"""Gentle Monster 카테고리 페이지 → 이미지 + metadata.json.

저장된 카테고리 페이지 HTML 두 개에서 모든 카드를 추출하고,
각 카드의 모든 각도 이미지를 CDN(`gm-prd-resource.gentlemonster.com`)에서
다운로드한다.

리스팅에는 한 모델당 한 색상만 노출되므로 `color_variants`는 카드당 1개로
구성된다. 같은 모델의 다른 색상은 상세 페이지에 있고 봇 보호로 막혀있어
`failed.log`에 기록만 한다 (수집은 미진행).
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ARCHIVE = ROOT / "archive"
IMAGES_DIR = ARCHIVE / "images"
METADATA_PATH = ARCHIVE / "metadata.json"
FAILED_LOG_PATH = ARCHIVE / "failed.log"

CDN_BASE = "https://gm-prd-resource.gentlemonster.com"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

SOURCES = [
    {
        "category": "sunglasses",
        "html": ASSETS / "전체보기 _ 선글라스 _ 젠틀몬스터 공식 온라인 스토어.html",
        "files_dir": ASSETS / "전체보기 _ 선글라스 _ 젠틀몬스터 공식 온라인 스토어_files",
    },
]

# 제품 단독 정/측/45도 컷만 허용 (모델 컷/패키지 등 비제품 컷 제외)
ALLOWED_ANGLES: frozenset[str] = frozenset({"FRONT", "SIDE", "D_45"})


def slugify(value: str) -> str:
    """프레임 색상명/한글 등을 파일명 안전 슬러그로."""
    value = value.strip().lower()
    value = re.sub(r"[®™]", "", value)
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"[^a-z0-9가-힣\-_]+", "", value)
    return value or "x"


# 카드 단위 분리 후 안에서 image src 추출
PRODUCT_BLOCK_RE = re.compile(
    r'<div class="product"\s+id="(?P<idx>\d+)"\s+data-id="\d+"',
)
CARD_ANCHOR_RE = re.compile(
    r'<a class="product-image-swiper"[^>]*'
    r'product-name="(?P<name>[^"]+)"[^>]*'
    r'product-sku="(?P<sku>[^"]+)"[^>]*'
    r'product-price="(?P<price>[^"]+)"[^>]*'
    r'href="(?P<url>[^"]+)"',
)
IMAGE_FILENAME_RE = re.compile(
    r'(?:src|href)="(?:[^"]*?/)?([^/"]+\.(?:jpg|jpeg|png|webp))"'
)


def extract_cards(html: str, category: str) -> list[dict]:
    """카테고리 HTML에서 카드별 정보 추출."""
    cards: list[dict] = []
    # `<div class="product" id="N" data-id="N"` 마커로 카드 영역 분리
    parts = re.split(
        r'(<div class="product"\s+id="\d+"\s+data-id="\d+"[^>]*>)', html
    )
    # parts: [pre, marker, body, marker, body, ...]
    for marker, body in zip(parts[1::2], parts[2::2]):
        anchor_match = CARD_ANCHOR_RE.search(body[:5000])
        if not anchor_match:
            continue
        sku = anchor_match.group("sku")
        name = anchor_match.group("name")
        price_str = anchor_match.group("price")
        url = anchor_match.group("url")

        # 카드 본문 끝 추정: 다음 <div class="product" 직전 또는 본문 6000자 이내
        next_div = body.find('<div class="product"')
        card_body = body if next_div < 0 else body[:next_div]

        # 카드 안의 이미지 파일명들
        files = IMAGE_FILENAME_RE.findall(card_body)
        # 정렬은 카드 내 등장 순서 유지하되 중복 제거
        seen = set()
        ordered_files: list[str] = []
        for f in files:
            if f in seen:
                continue
            seen.add(f)
            ordered_files.append(f)

        try:
            price = int(price_str)
        except ValueError:
            price = None

        cards.append(
            {
                "category": category,
                "sku": sku,
                "name_kr_raw": name,
                "price": price,
                "url": url,
                "image_files": ordered_files,
            }
        )
    return cards


# Next.js streaming chunk 안의 풍부한 entry — sku로 검색
def extract_rich_entries(html: str) -> dict[str, dict]:
    """SKU → rich entry (frameColor, shape, materials, plpImage 등)."""
    chunks = re.findall(r"self\.__next_f\.push\(\[1,(.+?)\]\)", html, re.DOTALL)
    entries: dict[str, dict] = {}
    for raw in chunks:
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(decoded, str) or '"frameColor"' not in decoded:
            continue
        for match in re.finditer(r'"frameColor"', decoded):
            start = decoded.rfind('{"id":', 0, match.start())
            if start < 0:
                continue
            depth = 0
            end = start
            limit = min(start + 20000, len(decoded))
            for j in range(start, limit):
                ch = decoded[j]
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = j + 1
                        break
            try:
                obj = json.loads(decoded[start:end])
            except json.JSONDecodeError:
                continue
            sku = obj.get("sku")
            if sku and "frameColor" in obj:
                entries[sku] = obj
    return entries


# 사이트에서 발견된 모든 각도 — 길이 내림차순으로 정렬해서 그리디 매칭
KNOWN_ANGLES = (
    "D_45_DETAIL",
    "SIDE_DETAIL",
    "LOOK_BOOK_FIRST",
    "LOOK_BOOK_SECOND",
    "PACKAGE_WEB",
    "PACKAGE",
    "EXCEPTIONAL",
    "NORMAL",
    "FRONT",
    "SIDE",
    "D_45",
)
_ANGLE_RE = re.compile(
    r"^(?P<prefix>.+?)_(?P<angle>"
    + "|".join(KNOWN_ANGLES)
    + r")(?:-\d+)?\.(?:jpg|jpeg|png|webp)$"
)


def parse_image_filename(filename: str) -> tuple[str | None, str | None]:
    """파일명에서 (prefix, angle) 추출.

    `11005049_FRONT.jpg` → (`11005049`, `FRONT`)
    `11004426_FRONT-3.jpg` → (`11004426`, `FRONT`)  # 변형 suffix 허용
    `GLEAM_02_D_45.jpg` → (`GLEAM_02`, `D_45`)     # 언더스코어 prefix 허용
    """
    m = _ANGLE_RE.match(filename)
    if not m:
        return None, None
    return m.group("prefix"), m.group("angle")


def cdn_url_for(filename: str) -> str | None:
    """카탈로그 이미지(`<numeric>_<angle>.jpg`)에 대한 CDN 표준 경로.

    실제 운영은 대부분 `/catalog/product/bulk/<uuid>/...` 경로를 사용한다.
    이 함수는 rich entry에 매핑이 없을 때의 fallback이지만, gentlemonster CDN은
    표준 경로(/catalog/product/<id>/<file>)를 거의 받지 않으므로 (HTTP 500),
    호출 측에서 가급적 build_global_image_map()의 결과를 우선 사용해야 한다.
    """
    catalog_id, angle = parse_image_filename(filename)
    if not catalog_id or not angle or not catalog_id.isdigit():
        return None
    return f"{CDN_BASE}/catalog/product/{catalog_id}/{filename}"


def build_global_image_map(rich: dict[str, dict]) -> dict[str, str]:
    """모든 rich entry의 plpImage src를 모아 filename → bulk CDN URL 맵."""
    out: dict[str, str] = {}
    for entry in rich.values():
        for img in entry.get("plpImage", []) or []:
            src = img.get("src")
            if not src:
                continue
            filename = src.rsplit("/", 1)[-1]
            out.setdefault(filename, src)
    return out


# 실제 카탈로그성 이미지만 골라낸다 (LOOK_BOOK은 제외 안 함, 모델 컷도 보존)
ANGLE_PRIORITY = {
    "FRONT": 1,
    "SIDE": 2,
    "D_45": 3,
    "D_45_DETAIL": 4,
    "SIDE_DETAIL": 5,
    "LOOK_BOOK_FIRST": 6,
    "LOOK_BOOK_SECOND": 7,
    "PACKAGE": 99,
}


def angle_sort_key(angle: str) -> tuple[int, str]:
    return (ANGLE_PRIORITY.get(angle, 50), angle)


def download(
    url: str | None,
    dest: Path,
    local_fallbacks: list[Path] | None = None,
    retries: int = 2,
) -> tuple[bool, str | None]:
    """CDN URL을 우선 시도, 실패 시 local_fallbacks 중 첫 존재 파일 복사."""
    if dest.exists() and dest.stat().st_size > 1024:
        return True, None
    last_err: str | None = None
    if url:
        for attempt in range(retries + 1):
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": USER_AGENT}
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                if len(data) < 512:
                    last_err = f"too_small({len(data)})"
                else:
                    tmp = dest.with_suffix(dest.suffix + ".part")
                    tmp.write_bytes(data)
                    tmp.rename(dest)
                    return True, None
            except urllib.error.HTTPError as exc:
                last_err = f"http_{exc.code}"
                if exc.code in (404, 410, 500):
                    break  # bulk-UUID 누락 등 — fallback으로
            except Exception as exc:  # noqa: BLE001
                last_err = type(exc).__name__
            if attempt < retries:
                time.sleep(0.6 * (attempt + 1))
    # local fallback
    for src in local_fallbacks or []:
        if src.exists() and src.stat().st_size > 1024:
            dest.write_bytes(src.read_bytes())
            return True, None
    return False, last_err or "no_url_no_local"


def main() -> int:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    failed_lines: list[str] = []

    # 1) 두 HTML에서 카드 + rich entry 추출
    all_cards: list[dict] = []
    rich: dict[str, dict] = {}
    for src in SOURCES:
        html = src["html"].read_text(encoding="utf-8")
        cards = extract_cards(html, src["category"])
        print(f"[parse] {src['category']}: cards={len(cards)}", file=sys.stderr)
        all_cards.extend(cards)
        rich.update(extract_rich_entries(html))
    print(f"[parse] rich entries: {len(rich)}", file=sys.stderr)

    # filename → bulk CDN URL (글로벌, 카드 SKU와 무관하게)
    global_img_map = build_global_image_map(rich)
    print(f"[parse] global image map size: {len(global_img_map)}", file=sys.stderr)

    # SKU 충돌 — 두 카테고리에 동일 SKU가 있을 가능성은 낮지만 prefix 처리
    seen_sku_in_cat: dict[tuple[str, str], int] = {}
    for c in all_cards:
        key = (c["category"], c["sku"])
        seen_sku_in_cat[key] = seen_sku_in_cat.get(key, 0) + 1
    sku_collisions = [k for k, n in seen_sku_in_cat.items() if n > 1]
    if sku_collisions:
        print(f"[warn] dup sku within category: {sku_collisions[:5]}", file=sys.stderr)

    # 로컬 _files/ 디렉토리 풀 (브라우저가 저장한 이미지)
    local_pool: list[Path] = []
    for src in SOURCES:
        if src["files_dir"].is_dir():
            local_pool.append(src["files_dir"])
    print(f"[parse] local _files dirs: {len(local_pool)}", file=sys.stderr)

    # 2) 다운로드 작업 목록 빌드
    tasks: list[tuple[str | None, Path, list[Path], dict]] = []
    products_meta: list[dict] = []

    for card in all_cards:
        sku = card["sku"]
        category = card["category"]
        rich_entry = rich.get(sku)

        # 메타 보강
        name_kr = (rich_entry or {}).get("name") or card["name_kr_raw"]
        name_en = (rich_entry or {}).get("nameEn")
        url_key = (rich_entry or {}).get("urlKey") or sku.lower()
        frame_color = (rich_entry or {}).get("frameColor")
        lens_color = (rich_entry or {}).get("lensColor")
        materials = (rich_entry or {}).get("materials")
        shape = (rich_entry or {}).get("shape")
        colors = (rich_entry or {}).get("colors") or {}

        # 이미지 후보 수집 (카드 + rich plpImage). 값은 cdn_url 또는 None
        image_candidates: dict[str, str | None] = {}
        for img in (rich_entry or {}).get("plpImage", []) or []:
            src = img.get("src")
            if not src:
                continue
            filename = src.rsplit("/", 1)[-1]
            image_candidates.setdefault(filename, src)
        for filename in card["image_files"]:
            if filename in image_candidates:
                continue
            cdn = global_img_map.get(filename) or cdn_url_for(filename)
            image_candidates[filename] = cdn  # None 가능 — local fallback에 의존

        # 다운로드 대상: 제품 단독 컷 angle 만
        usable: list[tuple[str, str, str | None]] = []  # (angle, filename, cdn_url|None)
        for filename, cdn in image_candidates.items():
            catalog_id, angle = parse_image_filename(filename)
            if not catalog_id or not angle:
                continue
            if angle not in ALLOWED_ANGLES:
                continue
            usable.append((angle, filename, cdn))
        # 한 angle이 중복(다른 catalog_id)이면 첫 번째만 채택
        by_angle: dict[str, tuple[str, str]] = {}
        for angle, filename, cdn in sorted(usable, key=lambda t: angle_sort_key(t[0])):
            by_angle.setdefault(angle, (filename, cdn))

        # 색상 슬러그 — frameColor (없으면 'default')
        color_slug = slugify(frame_color) if frame_color else "default"
        # color_code: rich data엔 코드 없음. 카탈로그 ID로 대체
        catalog_ids = sorted({parse_image_filename(fn)[0] for fn, _ in by_angle.values()})
        color_code = catalog_ids[0] if catalog_ids else None

        # 다운로드 파일명 생성 + tasks
        product_slug = slugify(url_key)
        if category == "optical":
            product_slug = f"opt-{product_slug}"
        local_files: list[str] = []
        for idx, angle in enumerate(
            sorted(by_angle.keys(), key=angle_sort_key), start=1
        ):
            src_filename, cdn_url = by_angle[angle]
            ext_src = cdn_url or src_filename
            ext = ext_src.rsplit(".", 1)[-1].lower()
            local_name = f"{product_slug}_{color_slug}_{idx:02d}.{ext}"
            dest = IMAGES_DIR / local_name
            local_candidates = [pool / src_filename for pool in local_pool]
            tasks.append(
                (cdn_url, dest, local_candidates, {"sku": sku, "angle": angle})
            )
            local_files.append(local_name)

        if not local_files:
            failed_lines.append(
                f"[{datetime.now():%Y-%m-%d %H:%M:%S}] product={sku} reason=no_catalog_images"
            )

        products_meta.append(
            {
                "id": product_slug,
                "name_kr": name_kr,
                "name_en": name_en,
                "category": category,
                "collection": None,  # 리스팅 데이터엔 미포함
                "frame_shape": shape,
                "frame_color": frame_color,
                "lens_color": lens_color,
                "materials": materials,
                "url": card["url"],
                "price": card["price"],
                "color_variants": [
                    {
                        "color_name": frame_color or "Default",
                        "color_code": color_code,
                        "color_hex": colors.get("frameColorCode"),
                        "images": local_files,
                    }
                ],
            }
        )

        # 이 모델의 다른 색상 변형은 상세 페이지에 있음 — 알려진 전역 한계 (failed.log엔 미기재)

    print(
        f"[plan] products={len(products_meta)} download_tasks={len(tasks)}",
        file=sys.stderr,
    )

    # 3) 다운로드 (병렬)
    succeeded = 0
    skipped = 0

    def worker(item):
        url, dest, local_fallbacks, _meta = item
        if dest.exists() and dest.stat().st_size > 1024:
            return ("skip", url, dest, None)
        ok, err = download(url, dest, local_fallbacks=local_fallbacks)
        return ("ok" if ok else "fail", url, dest, err)

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(worker, t) for t in tasks]
        for i, fut in enumerate(as_completed(futures), start=1):
            status, url, dest, err = fut.result()
            if status == "ok":
                succeeded += 1
            elif status == "skip":
                skipped += 1
            else:
                failed_lines.append(
                    f"[{datetime.now():%Y-%m-%d %H:%M:%S}] image_url={url} reason={err}"
                )
            if i % 50 == 0 or i == len(futures):
                print(
                    f"[dl] {i}/{len(futures)} ok={succeeded} skip={skipped}",
                    file=sys.stderr,
                )

    # 4) metadata.json + failed.log 작성
    METADATA_PATH.write_text(
        json.dumps(products_meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    # 알려진 전역 한계 — 향후 보강 작업의 포인터로 기록
    n_no_meta = sum(1 for p in products_meta if not p.get("frame_shape"))
    notes = [
        "# Known limitations (not per-image failures)",
        "# - color_variants: 카테고리 리스팅에는 모델당 한 색상만 노출됨.",
        "#   같은 모델의 다른 색상은 상세 페이지(/kr/ko/item/<sku>/...)에 있고",
        "#   Cloudflare-style 챌린지(HTTP 202)로 막혀있어 헤드리스 브라우저 없이는 미수집.",
        f"# - {n_no_meta}/{len(products_meta)}개 제품은 풍부 메타(frame_shape/color/materials)가",
        "#   Next.js 스트리밍 청크에 없어 null.",
        "# - 이미지 각도는 ALLOWED_ANGLES (FRONT/SIDE/D_45)만 보존.",
        "#   상세 컷(_DETAIL), 모델 컷(LOOK_BOOK_*), 패키지 컷은 의도적으로 제외.",
        "",
    ]
    body = notes + (failed_lines if failed_lines else ["# (no per-image download failures)"])
    FAILED_LOG_PATH.write_text("\n".join(body) + "\n", encoding="utf-8")

    print(
        f"[done] products={len(products_meta)} dl_ok={succeeded} skip={skipped} "
        f"failed_lines={len(failed_lines)}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
