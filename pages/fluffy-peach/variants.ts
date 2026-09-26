export type VariantId = 'original' | 'bean' | 'flower' | 'star' | 'wave';

export type VariantColors = {
  base: string;
  cool: string;
  blush: string;
  warm: string;
  highlight: string;
  bottom: string;
  detail: string;
  furTip: string;
  backgroundTop: string;
  backgroundBottom: string;
  shadow: string;
  eye: string;
};

export type Variant = {
  id: VariantId;
  label: string;
  referenceDetail: number;
  flutter: number;
  depth: number;
  eyeShift: readonly [number, number];
  colors: VariantColors;
};

export const variants: readonly Variant[] = [
  {
    id: 'original', label: '기존', referenceDetail: 1, flutter: 1.13, depth: 1, eyeShift: [0, 0],
    colors: {
      base: '#807de8', cool: '#737deb', blush: '#ff808c', warm: '#ffb8a3',
      highlight: '#ffdee0', bottom: '#7d82eb', detail: '#ef80b5', furTip: '#fadef0',
      backgroundTop: '#4061e1', backgroundBottom: '#777de2', shadow: '#1351dc', eye: '#6663e0',
    },
  },
  {
    id: 'bean', label: '민트 콩', referenceDetail: 0.2, flutter: 0, depth: 0.92, eyeShift: [-69, -13],
    colors: {
      base: '#b4e6bb', cool: '#5bbcb5', blush: '#dcf0a0', warm: '#fff2b0',
      highlight: '#f0f9d7', bottom: '#72bfb2', detail: '#ffc481', furTip: '#ecf9d7',
      backgroundTop: '#225c65', backgroundBottom: '#458b83', shadow: '#164b55', eye: '#28616a',
    },
  },
  {
    id: 'flower', label: '꿀 꽃', referenceDetail: 0.18, flutter: 0, depth: 0.94, eyeShift: [-63, 6],
    colors: {
      base: '#ffc17d', cool: '#d77994', blush: '#ff987c', warm: '#ffe09d',
      highlight: '#fff3c4', bottom: '#dc8b9a', detail: '#d95381', furTip: '#fff2d7',
      backgroundTop: '#713e78', backgroundBottom: '#ae738c', shadow: '#542d6d', eye: '#673e72',
    },
  },
  {
    id: 'star', label: '보라 별', referenceDetail: 0.14, flutter: 0, depth: 0.82, eyeShift: [-69, -4],
    colors: {
      base: '#9aa9f3', cool: '#6578ce', blush: '#c88ee7', warm: '#edb3de',
      highlight: '#ece0ff', bottom: '#6979c4', detail: '#f19dbb', furTip: '#ede6ff',
      backgroundTop: '#172e69', backgroundBottom: '#62548f', shadow: '#102655', eye: '#ffe2a1',
    },
  },
  {
    id: 'wave', label: '파도', referenceDetail: 0.17, flutter: 0, depth: 0.86, eyeShift: [-67, -10],
    colors: {
      base: '#a1e2e9', cool: '#57a9c4', blush: '#b6d8f2', warm: '#d8f4e9',
      highlight: '#ecfff7', bottom: '#6fb8d2', detail: '#83d3d4', furTip: '#e7fff9',
      backgroundTop: '#206d98', backgroundBottom: '#6aa9ad', shadow: '#17537a', eye: '#286084',
    },
  },
];

function ellipse(angle: number, width: number, height: number) {
  return 1 / Math.hypot(Math.cos(angle) / width, Math.sin(angle) / height);
}

function angularDistance(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function shapeFactor(id: VariantId, angle: number) {
  const y = Math.sin(angle);
  switch (id) {
    case 'original': return 1;
    case 'bean': {
      const notch = angularDistance(angle, 2.45) / 0.45;
      return ellipse(angle, 1.13, 0.9)
        * (0.98 + 0.12 * Math.cos(2 * angle - 0.4) + 0.04 * Math.cos(angle + 0.2) - 0.18 * Math.exp(-notch * notch));
    }
    case 'flower': {
      return ellipse(angle, 1.13, 0.94) * (0.9 + 0.17 * Math.cos(4 * angle - Math.PI) + 0.08 * y);
    }
    case 'star': return ellipse(angle, 1.04, 1.04) * (0.95 + 0.18 * Math.cos(5 * angle - Math.PI / 2));
    case 'wave': {
      const crest = angularDistance(angle, 0.67) / 0.38;
      const curl = angularDistance(angle, 1.47) / 0.31;
      return ellipse(angle, 1.22, 0.79)
        * (1 + 0.34 * Math.exp(-crest * crest) - 0.24 * Math.exp(-curl * curl) - 0.03 * y);
    }
  }
}
