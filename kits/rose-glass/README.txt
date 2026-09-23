ROSE GLASS MATERIAL KIT

이 폴더는 완성 코드를 제공하는 대신, Codex 또는 Claude Code가 Rose Glass를 새 프로젝트에서 재현할 때 사용할 기준 자료를 담습니다.

구성
- 시작하기.pdf: 설치와 진행 순서를 안내하는 한 페이지 문서
- reference/rose-glass-01-final-4k.jpg: 인터랙션이 없는 2160×3840 최종 배경 고품질 렌더
- reference/rose-glass-02-social-preview.png: 가로형 소셜 미리보기
- reference/rose-glass-03-foreground-detail.jpg: 전경 유리의 색·서리·두꺼운 외곽 확대
- reference/rose-glass-04-upper-edge-detail.jpg: 위쪽 유리의 어두운 가장자리 확대
- reference/rose-glass-05-lower-edge-detail.jpg: 아래쪽 유리의 유백색 중심과 외곽 확대
- assets/rose-glass-manifest.json: 모든 자료의 역할과 읽는 순서
- assets/rose-glass-layer-contract.json: 원본과 같은 정지 화면을 만드는 4장 텍스처의 합성 규약
- assets/rose-glass-plate-base.png: 배경과 레퍼런스 보정이 담긴 기준판
- assets/rose-glass-delta-{upper,lower,foreground}.png: 각 유리의 색·서리·광학 외곽을 보존한 signed 레이어
- assets/rose-glass-texture-compose.glsl: 네 텍스처를 합성하는 최소 셰이더 식
- assets/rose-glass-spec.json: 배치, 재질, 조명, 상호작용과 렌더링 기준값
- assets/rose-glass-palette.json: 색상 역할과 sRGB 기준값
- assets/rose-glass-material-profile.json: 어두운 어깨·반사광·그림자의 수치 레시피
- assets/rose-glass-color-probes.json: 실제 4K 렌더에서 측정한 좌표별 sRGB 목표값
- assets/rose-glass-frost-kernel.glsl: 서리 높이·법선·입자 계산식
- assets/rose-glass-visual-checks.json: 형태·겹침·질감의 화면 체크포인트
- assets/rose-glass-test-cases.json: 0·1·2·5 포인터 검증 시나리오
- assets/rose-glass-shape-contract.json: 고정 실루엣 SVG의 좌표·샘플링 계약
- assets/rose-glass-mask-upper.svg: 위쪽 유리의 실제 알파 실루엣
- assets/rose-glass-mask-lower.svg: 아래쪽 유리의 실제 알파 실루엣
- assets/rose-glass-mask-foreground.svg: 중앙 전경 유리의 실제 알파 실루엣
- assets/rose-glass-geometry.svg: 590×1280 기준 좌표와 세 유리의 설명용 배치 지도
- assets/rose-glass-shader-notes.glsl: 형상·외곽·조명·성능의 핵심 식

사용 방법
1. ZIP을 한 번만 압축 해제합니다.
2. 이 폴더 전체를 AI 코딩 도구의 작업 폴더로 엽니다.
3. AI가 assets/rose-glass-manifest.json부터 읽었는지 확인합니다.
4. Rose Glass Notion 자료집의 0번 프롬프트부터 순서대로 같은 대화에 복사합니다.
5. 각 단계에서 detail 이미지와 visual-checks.json을 기준으로 실행 화면을 비교합니다.

정지 화면의 색·서리·외곽은 네 장의 PNG 텍스처가 기준입니다. signed delta RGB의 중립값은 약 0.5이며, 일반 사진처럼 한 장씩 표시하면 안 됩니다. layer-contract.json의 식으로 합성하면 레퍼런스와 픽셀 오차 1/255 이내로 맞습니다. 인터랙션은 각 유리의 delta를 역변형 샘플링하고, SVG 마스크는 잡기 영역과 반사광 범위에 사용합니다.
9:16 화면의 x좌표는 590 재질 공간을 억지로 늘리는 게 아닙니다. layer-contract.json의 displayMapping대로 양옆 65px 배경을 포함해 PNG와 SVG에 서로 다른 UV를 사용하세요.

reference 이미지는 결과 비교에 사용합니다. 자동 조명은 합성된 표면 위에 약하게 더하고, 정지 화면을 만드는 핵심 색·질감을 임의의 그라데이션으로 다시 그리지 않습니다.

완성 작품
https://studio.jiiwon.com/rose-glass/

문의
Instagram @jiiwon.studio
