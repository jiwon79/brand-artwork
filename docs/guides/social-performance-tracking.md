# Social Performance Tracking

Instagram 게시물의 성과를 같은 조건으로 다시 조회하고, 시간에 따른 변화를 비교할 수 있도록 원본 필드와 스냅샷 보존 기준을 정리한다. 작품별 게시 상태, URL, 캡션과 실제 성과 스냅샷은 Notion의 `Project > Vibe`에서 관리한다.

## 1. 저장 범위

- Notion에는 작품별 게시 상태, 게시 시각, 원본 URL, 캡션과 조회 시점별 성과를 기록한다.
- 이 문서에는 여러 게시물에 공통으로 적용할 데이터 소스, 조회 조건, 필드 의미와 검증 원칙만 기록한다.
- 저장소에 작품별 소셜 기록이나 Notion 데이터의 복사본을 만들지 않는다.

## 2. 데이터 소스와 조회 조건

- connector: Windsor MCP의 `instagram`
- account id: `17841462900928904`
- account name: `루프 디자인 랩 (loop.design.lab)`
- filter: `media_caption contains "바이브코딩으로 예쁜 거 만들기"`
- 검색 시작일: `2010-10-06`
- 검색 종료일: 재조회하는 날

조회 결과에는 검색 기간 안에서 필터 문구를 포함하는 게시물만 들어와야 한다. 새 회차를 게시한 뒤에는 결과 개수가 한 건 늘었는지 먼저 확인한다.

## 3. 필수 필드

게시물을 식별하고 조회 시점을 재현하기 위해 다음 필드를 항상 요청한다.

- `data_fetched_at`
- `media_id`
- `media_caption`
- `timestamp`
- `media_type`
- `media_permalink`
- `media_shortcode`

성과 비교에는 다음 필드를 사용한다.

- `media_views`
- `media_reach`
- `media_like_count`
- `media_comments_count`
- `media_saved`
- `media_shares`
- `media_engagement`
- `media_reel_total_interactions`
- `media_reel_avg_watch_time`
- `media_reel_total_watch_time`

## 4. 지표 의미

| Windsor 필드 | 의미 |
| --- | --- |
| `media_views` | 미디어가 표시되거나 재생된 총 횟수 |
| `media_reach` | 미디어를 본 고유 Instagram 계정 수 |
| `media_like_count` | 미디어의 좋아요 수. 앨범 자식 미디어와 프로모션에서 파생된 일부 좋아요는 제외될 수 있다. |
| `media_comments_count` | 미디어 댓글과 답글 수. 캡션과 앨범 자식 미디어의 댓글은 제외된다. |
| `media_saved` | 미디어를 저장한 고유 계정 수 |
| `media_shares` | 미디어가 공유된 총 횟수 |
| `media_engagement` | 좋아요, 댓글, 저장과 공유를 기준으로 Instagram이 집계한 참여값 |
| `media_reel_total_interactions` | Reel의 좋아요, 저장, 댓글과 공유에서 취소·삭제된 상호작용을 반영한 값 |
| `media_reel_avg_watch_time` | Reel 평균 시청 시간. 원본 단위는 밀리초다. |
| `media_reel_total_watch_time` | 재시청을 포함한 Reel 총 재생 시간. 원본 단위는 밀리초다. |

`media_engagement`는 화면에 보이는 좋아요·댓글·저장·공유의 단순 합과 일치하지 않을 수 있다. 각 필드의 포함 범위와 취소·삭제 반영 시점이 다르므로 Windsor가 반환한 원본값을 유지한다.

## 5. 값이 없는 필드

`media_plays`, `media_all_plays`, `media_impressions`, `media_video_views`, `media_reel_video_views`는 이전 조회에서 값이 없었고, Windsor 필드 정의에서 다수가 deprecated 상태였다. Reel에는 `media_follows`, `media_profile_activity`, `media_profile_visits`가 지원되지 않았다.

필드가 반환되지 않으면 `0`으로 바꾸지 않고 값 없음 또는 미지원으로 기록한다. 이후 커넥터의 지원 범위가 달라지면 Windsor의 최신 필드 정의를 다시 확인한다.

## 6. 스냅샷 보존

새 게시물을 추가하거나 성과를 다시 비교할 때는 Notion의 기존 숫자를 덮어쓰지 않는다. 다음 정보를 포함한 새 스냅샷을 게시물 아래에 추가한다.

1. `data_fetched_at`의 원본 시각
2. 읽기 편한 KST 변환 시각
3. Windsor가 반환한 핵심 성과 필드의 원본값
4. 필요하면 도달 대비 참여율, 저장률, 공유율처럼 원본값에서 계산한 참고값

계산한 값은 Windsor 원본 필드와 섞지 않고 `계산값`이라고 표시한다. 평균·총 시청 시간은 원본 밀리초 값을 보존한 뒤 초나 시간 단위의 표시값을 함께 적는다.

## 7. 재조회 검증

- `media_id`와 `media_permalink`가 기존 게시물과 일치하는지 확인한다.
- 새 게시물이 없다면 검색 결과 개수가 이전 스냅샷과 같은지 확인한다.
- 누적값이 이전보다 작아졌더라도 임의로 보정하지 않는다. Instagram의 집계 보정이나 상호작용 취소가 원인일 수 있다.
- 계산 비율의 분모가 `media_reach`인지 `media_views`인지 명시한다.
- 누락된 필드는 `0`과 구분한다.
