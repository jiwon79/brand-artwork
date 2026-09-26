# 판매 자료 관리

판매 상품의 원본 에셋, 제작 자료, 배포 ZIP은 [Google Drive의 바이브코딩 판매자료](https://drive.google.com/drive/folders/1S7Lre1gpLGEGQNKL0eSpjHyWcsJmRmnM)를 기준으로 관리한다. 리틀리에는 작품 이름이 포함된 `<작품명>-시작하기.pdf` 한 개만 첨부한다. 구매자는 PDF에서 작품별 Notion 제작 가이드로 이동하고, 가이드 첫머리에서 Drive의 해당 상품 `배포본` 폴더를 연다. 저장소의 `kits/`는 필요할 때 Drive에서 내려받아 사용하는 로컬 작업 폴더이며 Git에서 추적하지 않는다.

## 상품별 위치

| 상품 | Drive 위치 | 현재 확인 상태 |
| --- | --- | --- |
| 구슬 | [01-Guseul](https://drive.google.com/drive/folders/1OAjg42UOb9mR4Rd9_Kh_bH3Oni3w3VMY) | 리틀리 `구슬-시작하기.pdf`; Drive `01-guseul-v1.3.zip` |
| 녹는 글자 | [02-Color Text](https://drive.google.com/drive/folders/1dH-gP9tTjl7-CZP6ZBEpWQsnHQfpINP0) | 리틀리 `녹는-글자-시작하기.pdf`; Drive `02-color-text-v1.3.zip` |
| 잔상 | [03-Body Echo](https://drive.google.com/drive/folders/1kBx-PO8oWL6fFp1jos-HUSRkVxnQ-t3R) | 리틀리 `잔상-시작하기.pdf`; Drive `03-body-echo-v1.3.zip` |
| 틈 | [04-Line Pull](https://drive.google.com/drive/folders/1pY6aXhCqG9yrbdGAXJTM1aI-gz_pBKuJ) | 리틀리 `틈-시작하기.pdf`; Drive `04-line-pull-v1.3.zip` |
| 고양이 | [05-Cursor Cat](https://drive.google.com/drive/folders/1Qf7x9pCBrqi-NiCCOoG7eNU0oK1K9jTu) | 리틀리 `고양이-시작하기.pdf`; Drive `05-cursor-cat-v1.3.zip` |
| 웃음꽃 | [05-Smile Flower](https://drive.google.com/drive/folders/1MbLp2Qxt3SaZ1sCM9DC3gbys5yX6u2sR) | 리틀리 `웃음꽃-시작하기.pdf`; Drive `smile-flower-v3.zip` |
| Rose Glass 제작 자료 | [06-Rose Glass](https://drive.google.com/drive/folders/1Oj-eYXYP0MhPlsViMnHw_8wTmGO5cf7Y) | 리틀리 `Rose-Glass-시작하기.pdf`; Drive `Rose-Glass-Material-Kit-20260926-v4.zip` |
| Rose Glass 4K 배경화면 5종 | [배경화면 상품](https://drive.google.com/drive/folders/1-ATjsyTmt4nMqlhI5Dyf1YjdC-rqVTLY) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일. 관리원본 PNG 5개 확인 |

2026-09-26에 7개 작품의 PDF를 A4 HTML에서 다시 출력했다. 실제 작품의 소셜 공유 이미지를 사용하고, Pretendard·작품별 Notion 링크·중앙 정렬된 제목과 시작 순서를 확인했다. PDF 이름을 작품별로 바꾸고 Drive ZIP 내부에도 같은 이름을 반영했다. Drive ZIP 7개와 리틀리 PDF 7개를 다시 다운로드해 로컬 파일과 바이트 단위로 대조했다. 잔상 ZIP에는 `reference/body-echo-05-interaction.mp4`가 포함된다.

## PDF 편집 원본

7개 작품별 HTML은 [관리원본의 시작하기 HTML 편집원본](https://drive.google.com/drive/folders/1BJedXYs9p6BohTWHkRoec9sMrr-ff8uE)에 **비공개**로 보관한다. 이 폴더와 HTML 파일은 소유자 권한만 확인했다. HTML에는 Pretendard와 작품별 소셜 공유 이미지를 포함하므로 단일 파일로 열어 편집할 수 있다. 구매자용 `배포본`에는 HTML을 넣지 않고 출력된 PDF만 둔다.

수정할 때는 해당 HTML을 Drive에서 내려받아 A4 크기로 편집하고 기존 Chrome에서 인쇄 배경을 포함해 PDF로 출력한다. 한 페이지 크기·텍스트·링크·실제 렌더링을 확인한 뒤 PDF를 ZIP에 넣는다. 로컬 `kits/_pdf-source/`는 작업 사본이며 Git에서 추적하지 않는다.

## 구매자 접근 범위

Notion의 작품별 제작 가이드 첫머리에는 아래 `배포본` 폴더만 연결한다. 최상위 판매자료 폴더, 상품별 상위 폴더, `관리원본`은 구매자용 링크로 사용하지 않는다. 배경화면 상품은 시작하기 PDF가 없는 별도 상품이므로 이 PDF → Notion 경로에 포함되지 않는다.

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
2. 작품별 시작하기 PDF를 수정할 때는 비공개 HTML 편집원본을 먼저 갱신하고, A4 PDF를 출력해 시각적으로 검토한다. PDF 이름에 작품명을 넣고 수정한 원본과 구매자용 ZIP을 Drive에 올린다. 파일 수·이름·크기와 ZIP 압축 검사를 확인한 뒤 Drive에서 다시 읽어 업로드를 확인한다.
3. 시작하기 PDF에는 작품별 Notion 제작 가이드 링크를, Notion 가이드 첫머리에는 위 Drive `배포본` 폴더 링크를 둔다. `배포본`과 그 안의 파일만 구매자가 열 수 있게 하고 상위 폴더와 `관리원본`의 권한은 유지한다. 링크 변경 후에는 로그인하지 않은 상태에서 폴더와 ZIP 다운로드가 되는지 확인한다.
4. 리틀리에는 해당 작품의 시작하기 PDF 한 개만 첨부한다. 저장 후 상품 목록을 다시 열어 파일명을 확인하고, 실제 첨부 PDF를 다운로드해 Drive 배포본의 PDF와 바이트 단위로 대조한다.
5. Drive에 원본과 배포본이 모두 확인되기 전에는 로컬 유일본을 삭제하거나 Git에서 제거하지 않는다. 새 판매 자료는 Git에 추가하지 않는다.

## Rose Glass 로컬 작업 폴더

`scripts/generate-rose-glass-layer-assets.py`와 `scripts/rose-glass-layer-preview.ts`는 로컬 `kits/rose-glass/`를 사용한다. 새 체크아웃에서 이 도구를 실행하려면 Drive의 `06-Rose Glass/관리원본`을 같은 폴더 구조로 내려받는다.
