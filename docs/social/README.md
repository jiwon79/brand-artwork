# Social

작품별 소셜 게시 이력과 성과 스냅샷을 보관한다. 게시 플랫폼의 원본 URL, 게시 시각, 캡션, 누적 성과와 재조회 기준을 작품별 파일에 기록한다.

## `바이브코딩으로 예쁜 거 만들기` 시리즈

| 회차 | 프로젝트 | 게시 시각 (KST) | Instagram | 조회 | 도달 | 참여 |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 1일차 | [Guseul](./guseul.md) | 2026-07-25 12:02:33 | [Reel `DbMzWyMT_10`](https://www.instagram.com/reel/DbMzWyMT_10/) | 23,024 | 16,252 | 1,327 |
| 2일차 | [Color Text](./color-text.md) | 2026-08-10 12:00:08 | [Reel `Db1_p35TbhR`](https://www.instagram.com/reel/Db1_p35TbhR/) | 88,713 | 63,220 | 6,665 |

2일차는 1일차보다 조회 3.85배, 도달 3.89배, 저장 5.41배, 공유 4.54배, 참여 5.02배를 기록했다. 평균 시청 시간은 두 게시물 모두 약 7.2초였고, 도달 대비 저장·공유·참여 비율은 2일차가 더 높았다.

## 게시 예정

| 회차 | 프로젝트 | 상태 | 캡션 |
| --- | --- | --- | --- |
| 3일차 | Body Echo | 초안 | [캡션 초안](./body-echo.md) |

## `바이브코딩으로 귀여운 거 만들기` 시리즈

| 회차 | 프로젝트 | 상태 | 캡션 |
| --- | --- | --- | --- |
| 1일차 | Cat Cursor | 초안 | [캡션 초안](./cat-cursor.md) |

## 데이터 기준

- 계정: `loop.design.lab`
- 데이터 소스: Windsor MCP의 `instagram` 커넥터
- 계정 선택값: `루프 디자인 랩 (loop.design.lab)`
- 검색 조건: `media_caption`에 `바이브코딩으로 예쁜 거 만들기` 포함
- 검색 기간: 2010-10-06 ~ 2026-08-21
- 데이터 조회 시각: 2026-08-21 08:08:45 UTC, 2026-08-21 17:08:45 KST
- 검색 결과: 2개

성과 수치는 조회 시점의 누적값이다. 게시물 반응이 추가되거나 Instagram이 집계값을 보정하면 이후 조회 결과와 달라질 수 있다.

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

`media_engagement`와 화면에 보이는 좋아요·댓글·저장·공유의 단순 합은 일치하지 않을 수 있다. 각 필드의 포함 범위와 취소·삭제 반영 시점이 다르므로 작품별 문서에는 Windsor가 반환한 원본 집계값을 유지한다.

`media_plays`, `media_all_plays`, `media_impressions`, `media_video_views`, `media_reel_video_views`는 두 게시물 모두 값이 없었다. Windsor 필드 정의에서 이 중 다수는 deprecated 상태다. Reel에는 `media_follows`, `media_profile_activity`, `media_profile_visits`가 지원되지 않아 값이 없다.

## 재조회 기준

후속 스냅샷은 Windsor MCP에서 다음 조건을 유지한다.

- connector: `instagram`
- account: `17841462900928904`
- filter: `media_caption contains "바이브코딩으로 예쁜 거 만들기"`
- 필수 식별 필드: `data_fetched_at`, `media_id`, `media_caption`, `timestamp`, `media_type`, `media_permalink`, `media_shortcode`
- 핵심 성과 필드: `media_views`, `media_reach`, `media_like_count`, `media_comments_count`, `media_saved`, `media_shares`, `media_engagement`, `media_reel_total_interactions`, `media_reel_avg_watch_time`, `media_reel_total_watch_time`

새 회차를 게시하거나 성과를 다시 비교할 때는 기존 숫자를 덮어쓰기보다 새로운 조회 시각의 표를 추가해 변화량을 남긴다.
