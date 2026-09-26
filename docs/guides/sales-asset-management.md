# 판매 자료 관리

판매 상품의 원본 에셋, 제작 자료, 배포 ZIP은 [Google Drive의 바이브코딩 판매자료](https://drive.google.com/drive/folders/1S7Lre1gpLGEGQNKL0eSpjHyWcsJmRmnM)를 기준으로 관리한다. 리틀리에 첨부된 ZIP은 구매자 전달용 사본이며, Drive 배포본과 같은 버전인지 확인해야 한다. 저장소의 `kits/`는 필요할 때 Drive에서 내려받아 사용하는 로컬 작업 폴더이며 Git에서 추적하지 않는다.

## 상품별 위치

| 상품 | Drive 위치 | 현재 확인 상태 |
| --- | --- | --- |
| 구슬 | [01-Guseul](https://drive.google.com/drive/folders/1OAjg42UOb9mR4Rd9_Kh_bH3Oni3w3VMY) | 리틀리 ZIP과 Drive ZIP의 `시작하기.pdf`만 다름. 본문은 같고 링크는 동일한 Notion 페이지 ID를 다른 도메인으로 가리킴 |
| 녹는 글자 | [02-Color Text](https://drive.google.com/drive/folders/1dH-gP9tTjl7-CZP6ZBEpWQsnHQfpINP0) | 리틀리 ZIP과 Drive ZIP의 `시작하기.pdf`만 다름. 본문은 같고 링크는 동일한 Notion 페이지 ID를 다른 도메인으로 가리킴 |
| 잔상 | [03-Body Echo](https://drive.google.com/drive/folders/1kBx-PO8oWL6fFp1jos-HUSRkVxnQ-t3R) | 리틀리 ZIP에는 Drive 배포본의 `reference/body-echo-05-interaction.mp4`가 없음. 나머지 11개 파일은 동일 |
| 틈 | [04-Line Pull](https://drive.google.com/drive/folders/1pY6aXhCqG9yrbdGAXJTM1aI-gz_pBKuJ) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일 |
| 고양이 | [05-Cursor Cat](https://drive.google.com/drive/folders/1Qf7x9pCBrqi-NiCCOoG7eNU0oK1K9jTu) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일 |
| 웃음꽃 | [05-Smile Flower](https://drive.google.com/drive/folders/1MbLp2Qxt3SaZ1sCM9DC3gbys5yX6u2sR) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일. 관리원본 11개 파일 확인 |
| Rose Glass 제작 자료 | [06-Rose Glass](https://drive.google.com/drive/folders/1Oj-eYXYP0MhPlsViMnHw_8wTmGO5cf7Y) | ZIP 자체의 해시는 다르지만 내부 39개 파일은 모두 동일. 최상위 폴더 구조와 ZIP 파일명 인코딩이 다름 |
| Rose Glass 4K 배경화면 5종 | [배경화면 상품](https://drive.google.com/drive/folders/1-ATjsyTmt4nMqlhI5Dyf1YjdC-rqVTLY) | 리틀리 ZIP과 Drive 배포 ZIP 바이트 단위 동일. 관리원본 PNG 5개 확인 |

2026-09-26에 리틀리 판매자 화면에서 실제 첨부 파일을 받아 Drive 배포본과 SHA-256 및 ZIP 내부 파일별 해시를 비교했다. 판매 ZIP은 이때 교체하지 않았다. 잔상은 구매자에게 전달되는 파일이 Drive 기준 배포본보다 1개 적으므로 후속 조치가 필요하다.

## 작업 절차

1. 상품 자료를 수정할 때 Drive의 해당 상품 폴더에서 원본을 가져와 로컬 `kits/` 또는 임시 폴더에서 작업한다. 작품 실행에 필요한 `pages/`의 코드와 에셋은 별도로 Git에서 관리한다.
2. 수정한 원본과 구매자용 ZIP을 Drive에 올린다. 파일 수·이름·크기와 ZIP 압축 검사를 확인한 뒤 Drive에서 다시 읽어 업로드를 확인한다.
3. 리틀리 판매 파일을 바꿀 때는 검증된 Drive 배포본과 동일한 ZIP을 첨부하고, 공개 상품 목록과 첨부 파일명을 확인한다. Drive 폴더의 공유 권한은 별도 승인 없이 변경하지 않는다.
4. Drive에 원본과 배포본이 모두 확인되기 전에는 로컬 유일본을 삭제하거나 Git에서 제거하지 않는다. 새 판매 자료는 Git에 추가하지 않는다.

## Rose Glass 로컬 작업 폴더

`scripts/generate-rose-glass-layer-assets.py`와 `scripts/rose-glass-layer-preview.ts`는 로컬 `kits/rose-glass/`를 사용한다. 새 체크아웃에서 이 도구를 실행하려면 Drive의 `06-Rose Glass/관리원본`을 같은 폴더 구조로 내려받는다.
