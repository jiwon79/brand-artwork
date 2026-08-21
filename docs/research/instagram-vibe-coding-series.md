# Instagram `바이브코딩으로 예쁜 거 만들기` 시리즈

`@loop.design.lab`에 게시한 `바이브코딩으로 예쁜 거 만들기` 시리즈의 게시 이력과 Instagram Insights 성과를 기록한다. 이 문서는 게시물을 다시 찾고, 작품 페이지와 연결하고, 후속 콘텐츠의 기준점을 비교하기 위한 데이터 스냅샷이다.

## 데이터 범위

- 계정: `loop.design.lab`
- 데이터 소스: Windsor MCP의 `instagram` 커넥터
- 계정 선택값: `루프 디자인 랩 (loop.design.lab)`
- 검색 조건: `media_caption`에 `바이브코딩으로 예쁜 거 만들기` 포함
- 검색 기간: 2010-10-06 ~ 2026-08-21
- 데이터 조회 시각: 2026-08-21 08:08:45 UTC, 2026-08-21 17:08:45 KST
- 검색 결과: 2개

성과 수치는 조회 시점의 누적값이다. 게시물 반응이 추가되거나 Instagram이 집계값을 보정하면 이후 조회 결과와 달라질 수 있다.

## 게시물 목록

| 회차 | 게시 시각 (KST) | 작품 | 구현 페이지 | Instagram | 미디어 |
| --- | --- | --- | --- | --- | --- |
| 1일차 | 2026-07-25 12:02:33 | Guseul | [`pages/guseul/`](../../pages/guseul/) · [공개 페이지](https://brand-artwork.vercel.app/pages/guseul/) | [Reel `DbMzWyMT_10`](https://www.instagram.com/reel/DbMzWyMT_10/) | Reel |
| 2일차 | 2026-08-10 12:00:08 | Color Text | [`pages/color-text/`](../../pages/color-text/) · [공개 페이지](https://brand-artwork.vercel.app/pages/color-text/) | [Reel `Db1_p35TbhR`](https://www.instagram.com/reel/Db1_p35TbhR/) | Reel |

원본 `timestamp`는 각각 `2026-07-25T03:02:33+0000`, `2026-08-10T03:00:08+0000`이며 위 표에서는 KST로 변환했다.

## 성과 스냅샷

| 지표 | 1일차 · Guseul | 2일차 · Color Text |
| --- | ---: | ---: |
| 조회 (`media_views`) | 23,024 | 88,713 |
| 도달 계정 (`media_reach`) | 16,252 | 63,220 |
| 좋아요 (`media_like_count`) | 396 | 2,127 |
| 댓글 (`media_comments_count`) | 73 | 92 |
| 저장 (`media_saved`) | 622 | 3,362 |
| 공유 (`media_shares`) | 210 | 954 |
| 참여 (`media_engagement`) | 1,327 | 6,665 |
| Reel 총 상호작용 (`media_reel_total_interactions`) | 1,327 | 6,665 |
| 평균 시청 시간 (`media_reel_avg_watch_time`) | 7.188초 | 7.205초 |
| 총 시청 시간 (`media_reel_total_watch_time`) | 33.25시간 | 125.88시간 |

도달을 분모로 한 참고용 파생값은 다음과 같다. 이 비율들은 Windsor가 직접 제공한 별도 필드가 아니라 위 누적값으로 계산했다.

| 파생값 | 1일차 · Guseul | 2일차 · Color Text |
| --- | ---: | ---: |
| 도달 계정당 조회 | 1.42회 | 1.40회 |
| 참여 ÷ 도달 | 8.17% | 10.54% |
| 저장 ÷ 도달 | 3.83% | 5.32% |
| 공유 ÷ 도달 | 1.29% | 1.51% |

2일차는 1일차보다 조회 3.85배, 도달 3.89배, 저장 5.41배, 공유 4.54배, 참여 5.02배를 기록했다. 평균 시청 시간은 약 7.2초로 거의 같았고, 도달 대비 저장·공유·참여 비율은 2일차가 더 높았다.

## 지표 의미

| Windsor 필드 | 의미 |
| --- | --- |
| `media_views` | 미디어가 표시되거나 재생된 총 횟수 |
| `media_reach` | 미디어를 본 고유 Instagram 계정 수 |
| `media_like_count` | 미디어의 좋아요 수. 앨범 자식 미디어와 프로모션에서 파생된 일부 좋아요는 제외될 수 있다. |
| `media_comments_count` | 미디어 댓글과 답글 수. 캡션과 앨범 자식 미디어의 댓글은 제외된다. |
| `media_saved` | 미디어를 저장한 고유 계정 수 |
| `media_shares` | 미디어가 공유된 총 횟수 |
| `media_engagement` | Instagram 미디어의 좋아요, 댓글, 저장, 공유를 기준으로 집계한 참여값 |
| `media_reel_total_interactions` | Reel의 좋아요, 저장, 댓글, 공유에서 취소·삭제된 상호작용을 반영한 값 |
| `media_reel_avg_watch_time` | Reel 평균 시청 시간. 원본 단위는 밀리초 |
| `media_reel_total_watch_time` | 재시청을 포함한 Reel 총 재생 시간. 원본 단위는 밀리초 |

`media_engagement`와 화면에 보이는 좋아요·댓글·저장·공유의 단순 합은 일치하지 않을 수 있다. 각 필드의 포함 범위와 취소·삭제 반영 시점이 다르므로 문서에는 Windsor가 반환한 원본 집계값을 유지한다.

`media_plays`, `media_all_plays`, `media_impressions`, `media_video_views`, `media_reel_video_views`는 두 게시물 모두 값이 없었다. Windsor 필드 정의에서 이 중 다수는 deprecated 상태다. Reel에는 `media_follows`, `media_profile_activity`, `media_profile_visits`가 지원되지 않아 값이 없다.

## 1일차 · Guseul

- 게시물 ID: `18425460385178281`
- shortcode: `DbMzWyMT_10`
- 미디어 타입: `REELS`
- 구현 문서: [Guseul architecture](../artworks/guseul/architecture.md), [surface refraction](../artworks/guseul/surface-refraction.md)

### 캡션

> 예쁜 걸 만들다 보면 미감도 늘까?
>
> 바이브코딩으로 예쁜 거 만들기 1일차.
>
> 첫 번째는 빛과 색을 품은 유리구슬입니다.  
> 열 개의 색 조각을 구 안에 넣고, 유리를 통과한 빛이 휘고 가장자리에서 여러 색으로 갈라지도록 만들었습니다.
>
> 이번 작업에서는 완성된 형태보다 그 사이의 작은 차이를 계속 실험했습니다. 굴절의 정도, 가장자리의 색 번짐, 회전 속도와 관성, 구슬이 늘어날 때 조명이 표면을 따라 휘는 방식, 잡아당긴 표면의 곡률과 두께를 하나씩 바꿔가며 개선했습니다.
>
> 굴절이 너무 강하면 안쪽의 색이 끊겨 보였고, 색 번짐이 지나치면 유리보다 장난감처럼 보였습니다. 표면이 너무 부드러우면 젤리가 되고, 너무 단단하면 늘어나는 느낌이 사라졌습니다.
>
> 손으로 밀면 구슬이 회전하고, 오래 누른 채 당기면 단단해 보이던 유리가 말랑하게 늘어납니다.
>
> 결국 예쁜 장면은 한 번에 만들어지는 게 아니라, 어색한 지점을 발견하고 조금씩 고쳐가는 과정에서 만들어지는 것 같습니다.
>
> TypeScript와 WebGL로, AI와 대화하며 만들었습니다.
>
> #바이브코딩 #크리에이티브코딩 #미디어아트 #creativecoding

## 2일차 · Color Text

- 게시물 ID: `18124773628691121`
- shortcode: `Db1_p35TbhR`
- 미디어 타입: `REELS`
- 구현 문서: [Color Text architecture](../artworks/color-text/architecture.md), [interaction ideation](../artworks/color-text/interaction-ideation.md)

### 캡션

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

## 재조회 기준

후속 스냅샷은 Windsor MCP에서 다음 조건을 유지한다.

- connector: `instagram`
- account: `17841462900928904`
- filter: `media_caption contains "바이브코딩으로 예쁜 거 만들기"`
- 필수 식별 필드: `data_fetched_at`, `media_id`, `media_caption`, `timestamp`, `media_type`, `media_permalink`, `media_shortcode`
- 핵심 성과 필드: `media_views`, `media_reach`, `media_like_count`, `media_comments_count`, `media_saved`, `media_shares`, `media_engagement`, `media_reel_total_interactions`, `media_reel_avg_watch_time`, `media_reel_total_watch_time`

새 회차를 게시하거나 성과를 다시 비교할 때는 기존 숫자를 덮어쓰기보다 새로운 조회 시각의 표를 추가해 변화량을 남긴다.
