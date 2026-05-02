# Gentle Monster Brand Artwork — 스펙

## 1. 파일 구성

- `index.html` - Main HTML structure
- `style.css` - Styling for table-based layout with header, summary, and image gallery
- `script.ts` - TypeScript functionality
- `assets/` - Asset directory
- `scripts/` - Additional scripts

## 2. 컨셉

Dark-themed table-based layout for displaying brand artwork with:
- Sticky header with title and summary information
- Scrollable data table with product information
- Image preview cells with angle tags (FRONT, SIDE, D_45)
- Lazy-loaded images for performance
- Product metadata display with price formatting (₩)
- XSS protection with HTML entity escaping
- Error handling with user feedback
- Minimalist monochrome color scheme (#111 background, #e0e0e0 text)

## 3. 스타일 구조

### Global Styles
- Reset: margin, padding, box-sizing
- Font: System UI font stack
- Colors: Dark background (#111), light text (#e0e0e0)

### Header
- Sticky positioning (top: 0, z-index: 10)
- Semi-transparent dark background with backdrop blur
- Title (h1) and summary (#summary) display

### Table Layout
- Full-width responsive table with sticky headers
- Column specs:
  - `td.name` (240px): Product name (Korean + English) with metadata
  - `td.img` (200x200px): Image container with angle tags

### Image Cells
- Fixed 200x200px figures with relative positioning
- Object-fit: contain for proper image scaling
- Angle tags (9px font) positioned top-left with semi-transparent background
- Empty state styling with centered placeholder text
- Lazy loading enabled for performance optimization

## 4. 데이터 구조 (TypeScript Interfaces)

### ColorVariant
```typescript
{
  color_name: string | null,
  color_code: string | null,
  color_hex: string | null,
  images: string[] // Array of image filenames
}
```

### Product
```typescript
{
  id: string,
  name_kr: string | null,
  name_en: string | null,
  category: string,
  collection: string | null,
  frame_shape: string | null,
  frame_color: string | null,
  lens_color: string | null,
  materials: string | null,
  url: string,
  price: number | null,
  color_variants: ColorVariant[]
}
```

## 5. 주요 기능

### 데이터 로드
- `archive/metadata.json` 에서 상품 데이터 로드
- URL 은 `new URL(relative_path, document.baseURI).href` 를 사용하여 절대 경로로 변환
- 로드 실패 시 사용자에게 HTTP 상태 코드와 요청한 URL을 표시
- 로드 실패 시 콘솔에도 에러 로그 출력 (디버깅 용도)
- 총 상품 수와 이미지 수를 헤더에 표시

### 이미지 렌더링
- 각 상품마다 FRONT, SIDE, D_45 세 가지 각도 표시
- 이미지 없는 경우 빈 상태(—) 표시
- 모든 이미지는 `assets/images/` 디렉토리에서 로드
- 모든 이미지 경로는 URL 인코딩 처리
- 이미지 로딩 지연(lazy loading) 적용

### 상품 정보 표시
- 한글명 (name_kr)
- 영문명 (name_en)
- 메타데이터: frame_shape, frame_color, materials, price
  - 가격은 한국 로케일로 포매팅 (₩1,000,000 형식)
  - 값이 있는 것만 필터링하여 · 로 구분자 표시
- 상품 상세 페이지 링크 (target="_blank", noopener)

### 보안
- HTML 이스케이핑: &, <, >, " 문자 치환
- 모든 동적 콘텐츠에 escape() 함수 적용
- URL 경로 인코딩

### 에러 처리
- 데이터 로드 실패 시 summary 요소에 에러 메시지 표시
- JS 런타임 에러도 summary 요소에 표시
