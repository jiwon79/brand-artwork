interface ColorVariant {
  color_name: string | null;
  color_code: string | null;
  color_hex: string | null;
  images: string[];
}

interface Product {
  id: string;
  name_kr: string | null;
  name_en: string | null;
  category: string;
  collection: string | null;
  frame_shape: string | null;
  frame_color: string | null;
  lens_color: string | null;
  materials: string | null;
  url: string;
  price: number | null;
  color_variants: ColorVariant[];
}

const ANGLE_LABELS = ['FRONT', 'SIDE', 'D_45'];

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRow(product: Product): string {
  const variant = product.color_variants[0];
  const imgs = variant?.images ?? [];
  const cells = [0, 1, 2].map((i) => {
    const file = imgs[i];
    if (!file) {
      return `<td class="img empty"><figure>—</figure></td>`;
    }
    return `<td class="img">
      <figure>
        <img loading="lazy" src="archive/images/${encodeURIComponent(file)}" alt="${escape(product.name_kr ?? product.id)} ${ANGLE_LABELS[i]}">
        <span class="angle-tag">${ANGLE_LABELS[i]}</span>
      </figure>
    </td>`;
  }).join('');

  const priceText = product.price ? `₩${product.price.toLocaleString('ko-KR')}` : '';
  const metaParts = [
    product.frame_shape,
    product.frame_color,
    product.materials,
    priceText,
  ].filter((v): v is string => Boolean(v));

  return `<tr>
    <td class="name">
      <div class="name-kr">${escape(product.name_kr ?? product.id)}</div>
      <div class="name-en">${escape(product.name_en ?? '')}</div>
      <div class="meta">
        ${metaParts.map(escape).join(' · ')}
        ${metaParts.length ? '<br>' : ''}
        <a href="${escape(product.url)}" target="_blank" rel="noopener">${escape(product.id)} ↗</a>
      </div>
    </td>
    ${cells}
  </tr>`;
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const summary = document.getElementById('summary')!;

  const response = await fetch('archive/metadata.json');
  if (!response.ok) {
    summary.textContent = `metadata.json 로드 실패 (HTTP ${response.status})`;
    return;
  }
  const products: Product[] = await response.json();
  const totalImgs = products.reduce(
    (sum, p) => sum + (p.color_variants[0]?.images.length ?? 0),
    0,
  );
  summary.textContent = `${products.length}개 제품 · ${totalImgs}장 이미지 · D_45/FRONT/SIDE`;

  app.innerHTML = `<table>
    <thead>
      <tr>
        <th>상품명</th>
        <th>FRONT</th>
        <th>SIDE</th>
        <th>D_45</th>
      </tr>
    </thead>
    <tbody>${products.map(renderRow).join('')}</tbody>
  </table>`;
}

main().catch((err) => {
  document.getElementById('summary')!.textContent = `에러: ${err}`;
  console.error(err);
});
