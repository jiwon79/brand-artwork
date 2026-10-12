const model = 'https://eduscol.education.fr/document/15805/download#page=21';
const forms = 'https://eduscol.education.gouv.fr/sites/default/files/document/ressc1ecritureforme-lettres456435pdf-74256.pdf';

/** DGESCO, Modèles d’écriture scolaire (2013), Écriture A, p.21.
 * A uses the descending alternative illustrated in La forme des lettres
 * (2015), p.5. These describe movements, not font outline coordinates.
 * Borel's roman capitals and unbarred 7 retain their original shapes.
 */
export const teachingStrokes: Record<string, readonly string[]> = {
  A: ['꼭대기 → 왼쪽 아래', '꼭대기 → 오른쪽 아래', '가로획 왼쪽 → 오른쪽'],
  B: ['세로획 위 → 아래', '위쪽 둥근 부분 → 아래쪽 둥근 부분'],
  C: ['오른쪽 위 → 왼쪽으로 돌아 오른쪽 아래'],
  D: ['세로획 위 → 아래', '위에서 오른쪽으로 돌아 아래까지'],
  E: ['세로획 → 아래 가로획', '위 가로획 왼쪽 → 오른쪽', '중간 가로획 왼쪽 → 오른쪽'],
  F: ['세로획 위 → 아래', '위 가로획 왼쪽 → 오른쪽', '중간 가로획 왼쪽 → 오른쪽'],
  G: ['오른쪽 위 → 왼쪽으로 도는 몸통', '안쪽에서 오른쪽으로 가로획 → 아래로 굽음'],
  H: ['왼쪽 세로획 위 → 아래', '가로획 왼쪽 → 오른쪽', '오른쪽 세로획 위 → 아래'],
  I: ['세로획 위 → 아래', '아래 가로획 왼쪽 → 오른쪽', '위 가로획 왼쪽 → 오른쪽'],
  J: ['위에서 내려와 왼쪽으로 굽음', '위 가로획 왼쪽 → 오른쪽'],
  K: ['세로획 위 → 아래', '가운데 → 오른쪽 아래', '오른쪽 위 → 왼쪽 아래'],
  L: ['세로획 위 → 아래 → 오른쪽으로 가로획'],
  M: ['왼쪽 세로획 위 → 아래', '왼쪽 위 → 가운데 아래 → 오른쪽 위 → 아래'],
  N: ['왼쪽 세로획 위 → 아래', '왼쪽 위 → 오른쪽 아래 → 위'],
  O: ['위쪽에서 시작해 반시계 방향으로 닫음'],
  P: ['세로획 위 → 아래', '위에서 오른쪽으로 돌아 가운데까지'],
  Q: ['반시계 방향으로 둥근 몸통', '안쪽 → 오른쪽 아래 꼬리'],
  R: ['세로획 위 → 아래', '위에서 오른쪽으로 도는 둥근 부분', '가운데 → 오른쪽 아래'],
  S: ['오른쪽 위 → 왼쪽 → 가운데 → 오른쪽 아래 → 왼쪽'],
  T: ['세로획 위 → 아래', '위 가로획 왼쪽 → 오른쪽'],
  U: ['왼쪽 위 → 아래를 돌아 오른쪽 위'],
  V: ['왼쪽 위 → 아래 → 오른쪽 위'],
  W: ['왼쪽 위 → 아래 → 가운데 위 → 아래 → 오른쪽 위'],
  X: ['오른쪽 위 → 왼쪽 아래', '왼쪽 위 → 오른쪽 아래'],
  Y: ['왼쪽 위 → 가운데', '오른쪽 위 → 가운데 → 아래'],
  Z: ['위 가로획 → 왼쪽 아래 대각선 → 아래 가로획'],
  '0': ['위쪽에서 시작해 반시계 방향으로 닫음'],
  '1': ['왼쪽에서 꼭대기로 올라간 뒤 아래로'],
  '2': ['왼쪽 위에서 오른쪽으로 회전 → 왼쪽 아래 → 오른쪽'],
  '3': ['위쪽 둥근 부분 → 가운데 → 아래쪽 둥근 부분'],
  '4': ['위에서 왼쪽 아래로 내려와 오른쪽으로', '오른쪽 세로획 위 → 아래'],
  '5': ['위 가로획 왼쪽 → 오른쪽', '왼쪽 위에서 내려와 오른쪽으로 둥글게 돌아 마무리'],
  '6': ['오른쪽 위에서 왼쪽으로 내려와 반시계 방향의 아래 고리'],
  '7': ['위 가로획 왼쪽 → 오른쪽 → 왼쪽 아래'],
  '8': ['위에서 왼쪽으로 시작 → 오른쪽 아래 → 왼쪽 아래 → 오른쪽 위 → 닫음'],
  '9': ['반시계 방향의 위 고리 → 오른쪽을 내려와 왼쪽으로 마무리'],
};

export function teachingReference(character: string) {
  const steps = teachingStrokes[character];
  if (steps) return {
    href: character === 'A' ? `${forms}#page=5` : model,
    text: steps.map((step, i) => `${i + 1}. ${step}`).join(' · '),
    note: character === '7' ? 'Borel 원본에 없는 중간 가로획은 추가하지 않습니다.'
      : 'Borel의 형태를 유지하며 프랑스 교본의 획순을 적용합니다.',
  };
  return {
    href: /^[a-z]$/.test(character)
      ? `https://l-education.com/ecrire-la-lettre-${character}-minuscule-cursive` : model,
    text: '',
    note: character === 'x' ? 'x는 선택한 두 대각선 방식을 유지합니다. 교본의 두 곡선 방식과 다릅니다.' : '',
  };
}
