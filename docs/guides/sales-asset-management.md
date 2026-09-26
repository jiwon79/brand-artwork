# 판매 자료 관리

판매 상품의 원본 에셋, 제작 자료, 배포 ZIP은 [Google Drive의 바이브코딩 판매자료](https://drive.google.com/drive/folders/1S7Lre1gpLGEGQNKL0eSpjHyWcsJmRmnM)를 기준으로 관리한다. 구매자는 리틀리의 `시작하기.pdf`에서 작품별 Notion 제작 가이드로 이동하고, 가이드 첫머리에서 Drive의 해당 상품 `배포본` 폴더를 연다. 리틀리에 첨부된 ZIP은 전달용 사본이다. 저장소의 `kits/`는 필요할 때 Drive에서 내려받아 사용하는 로컬 작업 폴더이며 Git에서 추적하지 않는다.

## 상품별 위치

| 상품 | Drive 위치 | 현재 확인 상태 |
| --- | --- | --- |
| 구슬 | [01-Guseul](https://drive.google.com/drive/folders/1OAjg42UOb9mR4Rd9_Kh_bH3Oni3w3VMY) | 리틀리 ZIP과 Drive ZIP의 `시작하기.pdf`만 다름. 본문은 같고 링크는 동일한 Notion 페이지 ID를 다른 도메인으로 가리킴 |
| 녹는 글자 | [02-Color Text](https://drive.google.com/drive/folders/1dH-gP9tTjl7-CZP6ZBEpWQsnHQfpINP0) | 리틀리 ZIP과 Drive ZIP의 `시작하기.pdf`만 다름. 본문은 같고 링크는 동일한 Notion 페이지 ID를 다른 도메인으로 가리킴 |
| 잔상 | [03-Body Echo](https://drive.google.com/drive/folders/1kBx-PO8oWL6fFp1jos-HUSRkVxnQ-t3R) | 리틀리 ZIP에는 Drive 배포본의 `reference/body-echo-05-interaction.mp4`가 없음. 나머지 11개 파일은 동일 |
| 틈 | [04-Line Pull](https://drive.google.com/drive/folders/1pY6aXhCqG9yrbdGAXJTM1aI-gz_pBKuJ) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일 |
| 고양이 | [05-Cursor Cat](https://drive.google.com/drive/folders/1Qf7x9pCBrqi-NiCCOoG7eNU0oK1K9jTu) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일 |
| 웃음꽃 | [05-Smile Flower](https://drive.google.com/drive/folders/1MbLp2Qxt3SaZ1sCM9DC3gbys5yX6u2sR) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일. 관리원본 11개 파일 확인 |
| Rose Glass 제작 자료 | [06-Rose Glass](https://drive.google.com/drive/folders/1Oj-eYXYP0MhPlsViMnHw_8wTmGO5cf7Y) | `시작하기.pdf`에 Notion 링크를 추가한 뒤 리틀리와 Drive의 배포 ZIP을 바이트 단위로 일치시킴 |
| Rose Glass 4K 배경화면 5종 | [배경화면 상품](https://drive.google.com/drive/folders/1-ATjsyTmt4nMqlhI5Dyf1YjdC-rqVTLY) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일. 관리원본 PNG 5개 확인 |

2026-09-26에 리틀리 판매자 화면에서 실제 첨부 파일을 받아 Drive 배포본과 SHA-256 및 ZIP 내부 파일별 해시를 비교했다. 이 비교 이후 Rose Glass 판매 ZIP을 갱신했다. 잔상은 리틀리 사본에 `reference/body-echo-05-interaction.mp4`가 빠져 있지만 Drive 배포 ZIP에는 있다.

## 구매자 접근 범위

Notion의 작품별 제작 가이드 첫머리에는 아래 `배포본` 폴더만 연결한다. 최상위 판매자료 폴더, 상품별 상위 폴더, `관리원본`은 구매자용 링크로 사용하지 않는다. 배경화면 상품은 `시작하기.pdf`가 없는 별도 상품이므로 이 PDF → Notion 경로에 포함되지 않는다.

2026-09-26에 아래 8개 `배포본` 폴더와 내부 ZIP·PDF를 `링크가 있는 모든 사용자: 보기`로 확인했다. 최상위 폴더와 상품별 상위 폴더는 소유자만 접근할 수 있고, `관리원본`도 공개되지 않았다. 웃음꽃과 Rose Glass 제작 가이드를 웹에 게시한 뒤 공개 페이지에서 Drive 링크를 확인했다. 로그인 정보 없이 구슬 ZIP과 Rose Glass PDF를 직접 내려받아 파일을 검증했다.

| 상품 | Notion 제작 가이드 | Drive 배포본 |
| --- | --- | --- |
| 구슬 | [제작 가이드](https://app.notion.com/p/3d6a89f7e31a8107a06fd47ffb45716f) | [배포본](https://drive.google.com/drive/folders/1cQdS9MRfwK5FV47JkSqJ2P_NNnVc40bP) |
| 녹는 글자 | [제작 가이드](https://app.notion.com/p/3d6a89f7e31a816d9fd2ca03d39bac36) | [배포본](https://drive.google.com/drive/folders/1Z9FHkNM-mYsLApLwxG2a0ASgxVISDey5) |
| 잔상 | [제작 가이드](https://app.notion.com/p/3d6a89f7e31a8124a56cc44c7e1e3ae4) | [배포본](https://drive.google.com/drive/folders/1x8ZTQjjiIqR3aMLjHaIfI97x09nuqR4i) |
| 틈 | [제작 가이드](https://app.notion.com/p/3d6a89f7e31a81418657d9a7aeaf1b21) | [배포본](https://drive.google.com/drive/folders/1XNWa_ssFwiPhOBT0_W_3CJ8nYt4opMZT) |
| 고양이 | [제작 가이드](https://app.notion.com/p/3cda89f7e31a8110961ac9bf73dff3d4) | [배포본](https://drive.google.com/drive/folders/17CZ139RVKeZp6U_be7trqOzwxRo2SpWy) |
| 웃음꽃 | [제작 가이드](https://app.notion.com/p/3d9a89f7e31a818cb561dc1bf4d8142d) | [배포본](https://drive.google.com/drive/folders/1IdJDIeGlkFhi_31-PpPEBWGMrHS4cE2A) |
| Rose Glass | [제작 가이드](https://app.notion.com/p/3e3a89f7e31a815c8059faa903ba0630) | [배포본](https://drive.google.com/drive/folders/17gpIblA9sPS5yW2dSgLXeujdQY3jCAV3) |
| Rose Glass 배경화면 | 해당 없음 | [배포본](https://drive.google.com/drive/folders/1B5qqRXC4GvCdjPKqi9MLXCkVy505ERsV) |

## 작업 절차

1. 상품 자료를 수정할 때 Drive의 해당 상품 폴더에서 원본을 가져와 로컬 `kits/` 또는 임시 폴더에서 작업한다. 작품 실행에 필요한 `pages/`의 코드와 에셋은 별도로 Git에서 관리한다.
2. 수정한 원본과 구매자용 ZIP을 Drive에 올린다. 파일 수·이름·크기와 ZIP 압축 검사를 확인한 뒤 Drive에서 다시 읽어 업로드를 확인한다.
3. `시작하기.pdf`에는 작품별 Notion 제작 가이드 링크를, Notion 가이드 첫머리에는 위 Drive `배포본` 폴더 링크를 둔다. `배포본`과 그 안의 파일만 구매자가 열 수 있게 하고 상위 폴더와 `관리원본`의 권한은 유지한다. 링크 변경 후에는 로그인하지 않은 상태에서 폴더와 ZIP 다운로드가 되는지 확인한다.
4. 리틀리 판매 파일을 바꿀 때는 검증된 Drive 배포본과 동일한 ZIP을 첨부하고, 공개 상품 목록과 첨부 파일명을 확인한다.
5. Drive에 원본과 배포본이 모두 확인되기 전에는 로컬 유일본을 삭제하거나 Git에서 제거하지 않는다. 새 판매 자료는 Git에 추가하지 않는다.

## Rose Glass 로컬 작업 폴더

`scripts/generate-rose-glass-layer-assets.py`와 `scripts/rose-glass-layer-preview.ts`는 로컬 `kits/rose-glass/`를 사용한다. 새 체크아웃에서 이 도구를 실행하려면 Drive의 `06-Rose Glass/관리원본`을 같은 폴더 구조로 내려받는다.
