# Color Text 소셜 게시 기록

Color Text를 소개한 `바이브코딩으로 예쁜 거 만들기` 2일차 Instagram 게시물과 성과 스냅샷이다. 공통 지표 정의와 시리즈 비교는 [Social README](./README.md)를 참고한다.

## 게시 정보

| 항목 | 값 |
| --- | --- |
| 시리즈 | `바이브코딩으로 예쁜 거 만들기` 2일차 |
| 게시 시각 | 2026-08-10 12:00:08 KST |
| 원본 timestamp | `2026-08-10T03:00:08+0000` |
| Instagram | [Reel `Db1_p35TbhR`](https://www.instagram.com/reel/Db1_p35TbhR/) |
| 게시물 ID | `18124773628691121` |
| 미디어 타입 | `REELS` |
| 구현 | [`pages/color-text/`](../../pages/color-text/) |
| 공개 페이지 | [brand-artwork.vercel.app/pages/color-text](https://brand-artwork.vercel.app/pages/color-text/) |
| 구현 문서 | [Architecture](../artworks/color-text/architecture.md), [Interaction ideation](../artworks/color-text/interaction-ideation.md) |
| 데이터 조회 시각 | 2026-08-21 17:08:45 KST |

## 성과 스냅샷

| 지표 | 값 |
| --- | ---: |
| 조회 (`media_views`) | 88,713 |
| 도달 계정 (`media_reach`) | 63,220 |
| 좋아요 (`media_like_count`) | 2,127 |
| 댓글 (`media_comments_count`) | 92 |
| 저장 (`media_saved`) | 3,362 |
| 공유 (`media_shares`) | 954 |
| 참여 (`media_engagement`) | 6,665 |
| Reel 총 상호작용 (`media_reel_total_interactions`) | 6,665 |
| 평균 시청 시간 (`media_reel_avg_watch_time`) | 7.205초 |
| 총 시청 시간 (`media_reel_total_watch_time`) | 125.88시간 |

도달을 분모로 계산한 참고값은 도달 계정당 조회 1.40회, 참여율 10.54%, 저장률 5.32%, 공유율 1.51%다. 이 값들은 Windsor가 직접 반환한 필드가 아니라 위 누적값으로 계산했다.

## 캡션

> 예쁜 걸 만들다 보면 미감도 늘까?
>
> 바이브코딩으로 예쁜 거 만들기 2일차.
>
> 화면을 오래 누르면 액체가 천천히 생겨나고, 아래로 흐르며 글자를 밀어냅니다. 액체가 사라지면 글자는 스프링처럼 다시 원래 자리로 돌아옵니다.
>
> 처음에는 글자 위에 커다란 블러를 얹었지만, 액체가 글자의 형태를 따르지 않고 흐릿한 덩어리처럼 보였습니다.
>
> 그래서 손가락의 영향이 닿은 글자 픽셀을 먼저 찾고, 그 주변에 Metaball field를 만드는 방식으로 구조를 바꿨습니다. 입자에는 중력·점성·응집력을 적용하고, 최종 표면은 Metaball로 연결했습니다.
>
> 손가락을 움직여도 이미 떨어진 액체는 기존 위치에서 계속 흐르고, 새롭게 생기는 덩어리만 손가락을 따라갑니다. 액체가 글자의 한쪽에 닿으면 글자는 아래로 밀리면서 살짝 기울어집니다.
>
> 완성된 결과와 함께 내부 과정도 볼 수 있도록 네 단계로 구분하였습니다.
>
> 자연스러운 움직임은 한 번에 만들어지기보다 외곽선, 흐르는 속도, 글자가 반응하는 작은 차이를 계속 비교하고 수정하면서 만들어지는 것 같습니다.
>
> Inspired by @antonin.work
>
> #바이브코딩 #인터랙티브아트 #creativecoding
