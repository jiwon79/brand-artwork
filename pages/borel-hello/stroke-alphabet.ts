export type Point = readonly [number, number];
export interface PenStroke { d: string; width?: number }
export interface PenGlyph {
  strokes: PenStroke[];
  entry?: Point;
  exit?: Point;
  normalized?: boolean;
}
function pen(paths: string[], entry?: Point, exit?: Point): PenGlyph {
  return { strokes: paths.map(d => ({ d })), entry, exit };
}
function symbol(...paths: string[]): PenGlyph {
  return { strokes: paths.map(d => ({ d })), normalized: true };
}
function dot(x: number, y: number, width = 125): PenStroke {
  return { d: `M${x} ${y} L${x + .01} ${y}`, width };
}

// Authored pen trajectories in Borel's 1000-unit, y-up coordinate space.
// Entry/body/exit stay separate from the font's contours: crossings only reveal
// the ink already travelled by the pen. These are lettering interpretations.
export const alphabet: Record<string, PenGlyph> = {
  a: pen(['M170 205 C160 363 233 443 345 443 C454 443 507 359 507 236 C507 103 433 28 334 28 C229 28 170 101 170 205', 'M507 236 L507 442 L507 135 C507 53 553 28 630 28'], [170, 205], [630, 28]),
  b: pen(['M170 214 C317 378 434 638 434 812 C434 1000 184 972 184 781 L184 259 C184 121 242 28 348 28 C466 28 527 143 527 290 C527 380 496 437 460 408 C409 366 496 304 562 340'], [170, 214], [562, 340]),
  c: pen(['M157 201 C151 368 241 443 332 443 C372 443 404 429 425 405', 'M157 201 C158 82 244 28 375 28'], [157, 201], [375, 28]),
  d: pen(['M170 205 C160 363 233 443 345 443 C454 443 507 359 507 236 C507 103 433 28 334 28 C229 28 170 101 170 205', 'M507 236 L507 815 L507 135 C507 53 550 28 615 28'], [170, 205], [615, 28]),
  e: pen(['M-2 27.5 C115.5 27.5 248 112.5 330.5 210 C425.5 320 373 442.5 265.5 442.5', 'M265.5 442.5 C125.5 442.5 90.5 250 183 112.5 C225.5 50 288 27.5 340.5 27.5'], [-2, 27.5], [340.5, 27.5]),
  f: pen(['M158 200 C300 349 412 637 412 813 C412 1000 188 972 188 783 L188 -300 C188 -510 397 -535 397 -299 C397 -36 358 100 188 130 C257 54 358 28 455 28'], [158, 200], [455, 28]),
  g: pen(['M170 205 C160 363 233 443 345 443 C454 443 507 359 507 236 C507 103 433 28 334 28 C229 28 170 101 170 205', 'M507 236 L507 442 L507 -285 C507 -544 237 -497 273 -302 C301 -151 512 -48 637 28'], [170, 205], [637, 28]),
  h: pen(['M114 217.5 C309 310 451.5 567.5 451.5 787.5 C451.5 977.5 219 987.5 219 775', 'M219 775 L219 0', 'M219 165 C236.5 342.5 336.5 417.5 411.5 417.5 C491.5 417.5 539 360 539 267.5 L539 162.5 C539 27.5 586.5 27.5 649 27.5'], [114, 217.5], [649, 27.5]),
  dotlessi: pen(['M184 432 L184 149 C184 57 230 28 295 28'], [184, 432], [295, 28]),
  uni0237: pen(['M295 430 L295 -277 C295 -526 70 -495 87 -303 C99 -165 294 -55 393 28'], [295, 430], [393, 28]),
  k: pen(['M114 217 C209 310 451 568 451 788 C451 978 219 988 219 775 L219 0', 'M219 164 C259 365 343 441 400 441 C566 441 539 186 219 186 C365 205 477 28 628 28'], [114, 217], [628, 28]),
  l: pen(['M-103.5 27.5 C84 27.5 269 187.5 366.5 412.5 C416.5 530 416.5 652.5 411.5 745', 'M411.5 745 C409 1010 164 982.5 164 767.5 L164 290 C164 117.5 189 27.5 336.5 27.5'], [-103.5, 27.5], [336.5, 27.5]),
  m: pen(['M254 432 L254 28 L254 273 C254 387 374 443 483 443 C594 443 609 387 609 274 L609 28 L609 273 C609 387 717 443 826 443 C937 443 955 388 955 276 L955 141 C955 57 1017 28 1050 28'], [254, 432], [1050, 28]),
  n: pen(['M254 432 L254 28 L254 273 C254 387 402 443 533 443 C664 443 706 388 706 276 L706 141 C706 57 758 28 810 28'], [254, 432], [810, 28]),
  o: pen(['M-82 27.5 C33 27.5 103 95 158 162.5', 'M158 162.5 C140.5 285 198 442.5 348 442.5 C470.5 442.5 535.5 352.5 535.5 235 C535.5 107.5 463 27.5 348 27.5 C223 27.5 158 107.5 158 237.5'], [-82, 27.5], [158, 237.5]),
  p: pen(['M289 179 L289 432 L289 -350', 'M289 179 C314 371 390 443 455 443 C545 443 581 376 581 273 L581 142 C581 57 617 28 690 28'], [289, 179], [690, 28]),
  q: pen(['M170 205 C160 363 233 443 345 443 C454 443 507 359 507 236 C507 103 433 28 334 28 C229 28 170 101 170 205', 'M507 236 L507 442 L507 -355 C507 -318 575 -189 636 -189'], [170, 205], [636, -189]),
  r: pen(['M140 215 C197 339 213 476 168 506 C199 404 280 459 339 459 C425 459 420 382 420 287 L420 140 C420 57 461 28 570 28'], [140, 215], [570, 28]),
  s: pen(['M161 192 C240 291 296 421 332 512 C302 521 279 453 313 415 C359 363 479 314 479 236 C479 131 342 70 283 112', 'M479 236 L479 120 C479 49 484 28 512 28'], [161, 192], [512, 28]),
  t: pen(['M234 708 L234 222 C234 92 282 28 400 28', 'M91 511 L390 511'], [234, 222], [400, 28]),
  u: pen(['M184 432 L184 175 C184 -18 380 -28 486 147 L538 432 L538 145 C538 54 587 28 654 28'], [184, 432], [654, 28]),
  v: pen(['M252 432 C466 482 496 365 496 231 C496 101 544 28 599 28 C673 28 711 172 682 374 C671 473 604 458 639 402 C679 339 708 348 739 350'], [252, 432], [739, 350]),
  w: pen(['M252 432 C466 482 496 365 496 231 C496 91 526 28 588 28 C666 28 716 112 716 327 L716 191 C716 88 751 28 823 28 C915 28 955 184 927 374 C911 478 848 454 878 402 C915 338 951 348 982 350'], [252, 432], [982, 350]),
  x: pen(['M175 178 C240 368 292 443 371 443 C463 443 512 364 512 235 C512 103 440 28 338 28 C312 28 284 37 267 47', 'M709 432 C539 479 513 354 513 233 C513 94 584 28 700 28'], [175, 178], [700, 28]),
  y: pen(['M184 432 L184 175 C184 -18 380 -28 486 147 L538 432 L538 -285 C538 -544 268 -497 304 -302 C332 -151 543 -48 668 28'], [184, 432], [668, 28]),
  z: pen(['M140 215 C197 339 213 476 168 506 C199 404 352 422 439 436 L251 152 C328 226 388 218 439 174 C491 131 507 52 507 -137 C507 -544 292 -526 304 -319 C311 -181 539 -51 654 28'], [140, 215], [654, 28]),
  germandbls: pen(['M288 180 L288 -350', 'M135 184 C195 354 247 882 393 936 C598 1012 638 733 439 526 C644 456 716 149 550 47 C496 16 449 27 412 46'], [135, 184], [550, 47]),
  A: symbol('M0 0 L.5 1 L1 0', 'M.2 .4 L.8 .4'),
  B: symbol('M0 0 L0 1 L.5 1 C1 1 1 .54 .5 .54 L0 .54', 'M.5 .54 C1.12 .54 1.12 0 .5 0 L0 0'),
  C: symbol('M1 .88 C.56 1.26 0 .91 0 .5 C0 .09 .56 -.26 1 .12'),
  D: symbol('M0 0 L0 1 L.3 1 C1.23 1 1.23 0 .3 0 L0 0'),
  E: symbol('M1 1 L0 1 L0 0 L1 0', 'M0 .5 L.93 .5'),
  F: symbol('M0 0 L0 1 L1 1', 'M0 .53 L.9 .53'),
  G: symbol('M.95 .9 C.46 1.22 0 .92 0 .5 C0 -.23 1 -.16 1 .47 L.49 .47'),
  H: symbol('M0 1 L0 0', 'M0 .5 L1 .5', 'M1 1 L1 0'),
  I: symbol('M0 1 L1 1', 'M.5 1 L.5 0', 'M0 0 L1 0'),
  J: symbol('M0 1 L1 1', 'M.6 1 L.6 .28 C.6 -.12 -.05 -.14 0 .27'),
  K: symbol('M0 1 L0 0', 'M1 1 L0 .35', 'M.35 .58 L1 0'),
  L: symbol('M0 1 L0 0 L1 0'),
  M: symbol('M0 0 L0 1 L.5 .25 L1 1 L1 0'),
  N: symbol('M0 0 L0 1 L1 0 L1 1'),
  O: symbol('M.5 1 C1.17 1 1.17 0 .5 0 C-.17 0 -.17 1 .5 1'),
  P: symbol('M0 0 L0 1 L.55 1 C1.15 1 1.15 .48 .55 .48 L0 .48'),
  Q: symbol('M.5 1 C1.17 1 1.17 .13 .5 .13 C-.17 .13 -.17 1 .5 1', 'M.55 .39 L1 0'),
  R: symbol('M0 0 L0 1 L.55 1 C1.15 1 1.15 .48 .55 .48 L0 .48', 'M.51 .48 L1 0'),
  S: symbol('M1 .9 C.76 1.14 0 1.01 0 .76 C0 .43 1 .56 1 .24 C1 -.04 .2 -.1 0 .12'),
  T: symbol('M0 1 L1 1', 'M.5 1 L.5 0'),
  U: symbol('M0 1 L0 .3 C0 -.1 1 -.1 1 .3 L1 1'),
  V: symbol('M0 1 L.5 0 L1 1'),
  W: symbol('M0 1 L.23 0 L.5 .75 L.77 0 L1 1'),
  X: symbol('M0 1 L1 0', 'M1 1 L0 0'),
  Y: symbol('M0 1 L.5 .45 L1 1', 'M.5 .45 L.5 0'),
  Z: symbol('M0 1 L1 1 L0 0 L1 0'),
  zero: symbol('M.5 1 C1.17 1 1.17 0 .5 0 C-.17 0 -.17 1 .5 1'),
  one: symbol('M0 .77 L.68 1 L.68 0'),
  two: symbol('M0 .79 C.09 1.12 .99 1.08 1 .76 C1 .51 .36 .16 0 0 C.32 .06 .74 -.05 1 .02'),
  three: symbol('M0 .85 C.35 1.14 .99 1.03 .99 .76 C.99 .56 .71 .51 .29 .51 C.76 .53 1 .42 1 .22 C1 -.08 .25 -.07 0 .15'),
  four: symbol('M.48 1 L0 .3 L1 .3', 'M.73 .68 L.73 0'),
  five: symbol('M1 1 L.22 1 L.1 .56 C.71 .72 1 .45 1 .22 C1 -.06 .24 -.09 0 .16'),
  six: symbol('M.94 .9 C.49 1.22 0 .9 0 .4 C0 -.16 1 -.13 1 .32 C1 .72 .31 .72 0 .41'),
  seven: symbol('M0 1 L1 1 L.38 0'),
  eight: symbol('M.5 .52 C-.21 .81 .09 1 .5 1 C.98 1 1.14 .71 .5 .52 C-.27 .19 0 0 .5 0 C1.03 0 1.24 .22 .5 .52'),
  nine: symbol('M1 .59 C.69 .29 0 .3 0 .73 C0 1.14 1 1.12 1 .59 C1 .06 .5 -.17 .11 .09'),
  hyphen: symbol('M0 .5 L1 .5'),
  endash: symbol('M0 .5 L1 .5'),
  emdash: symbol('M0 .5 L1 .5'),
  minus: symbol('M0 .5 L1 .5'),
  slash: symbol('M0 0 L1 1'),
  backslash: symbol('M0 1 L1 0'),
  bar: symbol('M.5 1 L.5 0'),
  brokenbar: symbol('M.5 1 L.5 .61', 'M.5 .39 L.5 0'),
  plus: symbol('M.5 1 L.5 0', 'M0 .5 L1 .5'),
  multiply: symbol('M0 1 L1 0', 'M1 1 L0 0'),
  less: symbol('M1 1 L0 .5 L1 0'),
  greater: symbol('M0 1 L1 .5 L0 0'),
  logicalnot: symbol('M0 1 L1 1 L1 0'),
  asciicircum: symbol('M0 0 L.5 1 L1 0'),
  asciitilde: symbol('M0 .35 C.2 1.4 .72 -.45 1 .65'),
  parenleft: symbol('M1 1 C-.34 .75 -.34 .25 1 0'),
  parenright: symbol('M0 1 C1.34 .75 1.34 .25 0 0'),
  bracketleft: symbol('M1 1 L0 1 L0 0 L1 0'),
  bracketright: symbol('M0 1 L1 1 L1 0 L0 0'),
  braceleft: symbol('M1 1 C.3 1 .5 .94 .5 .67 Q.5 .5 0 .5 Q.5 .5 .5 .33 C.5 .06 .3 0 1 0'),
  braceright: symbol('M0 1 C.7 1 .5 .94 .5 .67 Q.5 .5 1 .5 Q.5 .5 .5 .33 C.5 .06 .7 0 0 0'),
  exclam: pen(['M191 690 L191 270']),
  exclamdown: pen(['M191 420 L191 0']),
  question: symbol('M0 .85 C.15 1.09 1.05 1.09 1 .75 C.96 .57 .43 .5 .44 .31', 'M.44 0 L.4401 0'),
  questiondown: symbol('M1 .15 C.85 -.09 -.05 -.09 0 .25 C.04 .43 .57 .5 .56 .69', 'M.56 1 L.5601 1'),
  quotesingle: symbol('M.5 1 L.5 0'),
  quoteleft: symbol('M1 1 C-.34 .75 -.34 .25 1 0'),
  quoteright: symbol('M0 1 C1.34 .75 1.34 .25 0 0'),
  quotedblleft: symbol('M.35 1 C-.1 .75 -.1 .25 .35 0', 'M1 1 C.55 .75 .55 .25 1 0'),
  comma: symbol('M.8 1 C1.12 .57 .66 .17 0 0'),
  period: { strokes: [dot(165, 55)] },
  bullet: { strokes: [dot(271, 353, 160)] },
  asterisk: symbol('M.5 1 L.5 0', 'M0 .75 L1 .25', 'M0 .25 L1 .75'),
  numbersign: symbol('M.4 1 L.12 0', 'M.9 1 L.62 0', 'M.08 .69 L1 .69', 'M0 .25 L.92 .25'),
  ampersand: symbol('M.84 .81 C.77 1.11 .07 1.06 .05 .81 C.02 .56 .33 .49 .52 .52 C-.18 .58 -.08 -.04 .53 0 C.96 .02 1 .33 .89 .53 C.72 .72 .52 .43 1 .45'),
  dollar: symbol('M.93 .83 C.78 1.04 .03 1.01 .03 .75 C.03 .48 .98 .57 .98 .29 C.98 -.01 .2 -.05 0 .18', 'M.51 1 L.51 0'),
  cent: symbol('M1 .8 C.54 1.08 0 .82 0 .48 C0 .06 .6 -.06 1 .2', 'M.55 1 L.55 0'),
  sterling: symbol('M1 .76 C.97 1.05 .21 1.11 .15 .8 C.08 .57 .56 .44 .05 0 C.42 .13 .71 -.1 1 .05', 'M0 .43 L.73 .43'),
  Euro: symbol('M1 .89 C.52 1.24 .16 .85 .16 .5 C.16 .08 .56 -.2 1 .11', 'M0 .64 L.64 .64', 'M0 .37 L.64 .37'),
  uni20BA: symbol('M.25 1 L.25 0 C.8 0 1 .23 1 .53', 'M0 .55 L.7 .76', 'M0 .37 L.7 .58'),
  plusminus: symbol('M.5 1 L.5 .36', 'M0 .66 L1 .66', 'M0 0 L1 0'),
  notequal: symbol('M0 .7 L1 .7', 'M0 .27 L1 .27', 'M.76 1 L.24 0'),
  guilsinglleft: symbol('M1 1 L0 .5 L1 0'),
  guilsinglright: symbol('M0 1 L1 .5 L0 0'),
  guillemotright: symbol('M0 1 L.4 .5 L0 0', 'M.6 1 L1 .5 L.6 0'),
  arrowleft: symbol('M1 .5 L0 .5', 'M.25 1 L0 .5 L.25 0'),
  arrowright: symbol('M0 .5 L1 .5', 'M.75 1 L1 .5 L.75 0'),
  arrowup: symbol('M.5 0 L.5 1', 'M0 .75 L.5 1 L1 .75'),
  arrowdown: symbol('M.5 1 L.5 0', 'M0 .25 L.5 0 L1 .25'),
  uni2196: symbol('M1 0 L0 1', 'M0 .55 L0 1 L.45 1'),
  uni2197: symbol('M0 0 L1 1', 'M.55 1 L1 1 L1 .55'),
  uni2198: symbol('M0 1 L1 0', 'M.55 0 L1 0 L1 .45'),
  uni2199: symbol('M1 1 L0 0', 'M0 .45 L0 0 L.45 0'),
  arrowdblboth: symbol('M.2 .62 L.8 .62', 'M.2 .38 L.8 .38', 'M.2 1 L0 .5 L.2 0', 'M.8 1 L1 .5 L.8 0'),
  circle: symbol('M.5 1 C1.17 1 1.17 0 .5 0 C-.17 0 -.17 1 .5 1'),
  uni25EF: symbol('M.5 1 C1.17 1 1.17 0 .5 0 C-.17 0 -.17 1 .5 1'),
  at: symbol('M.7 .56 C.57 .75 .28 .64 .28 .43 C.28 .22 .71 .15 .71 .57 L.71 .33 C.72 .14 1 .29 1 .56 C1 1.29 -.17 1.17 0 .36 C.04 .01 .52 -.08 .76 .01'),
  paragraph: symbol('M.69 0 L.69 1 L.39 1 C-.16 1 -.13 .48 .39 .48 L.69 .48', 'M1 1 L1 0'),
  section: symbol('M1 .9 C.64 1.21 0 1.03 0 .78 C0 .48 1 .62 1 .32 C1 .02 .3 -.08 0 .11', 'M.3 .62 C-.22 .41 .06 .34 .63 .24 C1.22 .35 .95 .56 .3 .62'),
  copyright: symbol('M.5 1 C1.17 1 1.17 0 .5 0 C-.17 0 -.17 1 .5 1', 'M.72 .68 C.38 .98 .16 .39 .47 .32 Q.62 .27 .72 .35'),
  registered: symbol('M.5 1 C1.17 1 1.17 0 .5 0 C-.17 0 -.17 1 .5 1', 'M.35 .23 L.35 .77 L.55 .77 C.85 .77 .85 .5 .55 .5 L.35 .5', 'M.54 .5 L.76 .23'),
  trademark: symbol('M0 1 L.45 1', 'M.23 1 L.23 0', 'M.57 0 L.57 1 L.79 .31 L1 1 L1 0'),
  degree: symbol('M.5 1 C1.17 1 1.17 0 .5 0 C-.17 0 -.17 1 .5 1'),
  minute: symbol('M0 0 L1 1'),
  u1F441: symbol('M0 .5 C.3 1.17 .7 1.17 1 .5 C.7 -.17 .3 -.17 0 .5', 'M.5 .83 C.93 .83 .93 .17 .5 .17 C.07 .17 .07 .83 .5 .83'),
  u1F442: symbol('M0 .45 C-.03 1.27 1.4 1.06 .86 .54 C.6 .26 .91 .01 .45 0 C.15 -.07 .08 .12 .08 .25', 'M.37 .46 C.05 .81 .65 .87 .66 .54', 'M.37 .46 C.76 .3 .63 .18 .38 .23'),
  u1F444: symbol('M0 .5 C.2 1.08 .37 1 .5 .79 C.7 1.02 .85 1.06 1 .5 C.76 -.17 .23 -.17 0 .5', 'M0 .5 Q.5 .37 1 .5'),
  uni270F: symbol('M0 0 L.1 .49 L.58 1 L.87 .87 L1 .58 L.49 .1 L0 0', 'M.1 .49 L.49 .1', 'M.58 1 L1 .58', 'M.23 .33 L.7 .8', 'M.35 .21 L.8 .69'),
  gravecomb: pen(['M119 739 Q173 679 253 634']),
  acutecomb: pen(['M119 634 Q204 679 253 739']),
  uni0302: pen(['M66 650 L187 780 L308 650']),
  tildecomb: pen(['M73 666 C100 794 208 591 287 693']),
  uni0306: pen(['M70 733 C70 585 304 585 304 733']),
  uni0307: { strokes: [dot(187, 686)] },
  uni0308: { strokes: [dot(95, 686), dot(277, 686)] },
  hookabovecomb: pen(['M104 710 C352 790 353 628 214 601']),
  uni030A: pen(['M187 762 C290 762 290 606 187 606 C84 606 84 762 187 762']),
  uni031B: pen(['M80 585 C171 585 186 652 181 725']),
  uni0327: pen(['M125 -63 C110 -196 304 -153 235 -254 C211 -289 150 -273 123 -273']),
  uni0338: pen(['M66 -49 L618 752']),
};

alphabet.exclam.strokes.push(dot(191, 57));
alphabet.exclamdown.strokes.unshift(dot(191, 637));
alphabet.dcroat = { ...alphabet.d, strokes: [...alphabet.d.strokes, { d: 'M365 647 L637 647' }] };
alphabet.uhorn = { ...alphabet.u, strokes: [...alphabet.u.strokes, { d: 'M538 432 C683 423 691 556 687 585' }] };
alphabet.Ohorn = { ...alphabet.O, strokes: [...alphabet.O.strokes, { d: 'M.72 .9 C.99 .88 1 .98 1 1.2' }] };
alphabet.Dcroat = { ...alphabet.D, strokes: [...alphabet.D.strokes, { d: 'M-.17 .5 L.45 .5' }] };
alphabet.uni1E9E = symbol('M0 0 L0 .7 C0 1.04 .47 1.09 .84 .95 L.56 .56 C1.23 .57 1.08 -.14 .28 .04');
alphabet.ae = pen(['M170 205 C160 363 233 443 345 443 C454 443 507 359 507 236 C507 103 433 28 334 28 C229 28 170 101 170 205', 'M507 236 C508 391 627 498 725 403 C835 262 664 203 514 217 C551 92 615 28 734 28'], [170, 205], [734, 28]);
alphabet.oe = pen(['M210 167 C190 304 248 442 348 442 C469 442 535 353 535 235 C535 107 463 28 348 28 C223 28 158 106 158 237 C158 369 244 442 348 442', 'M535 237 C526 432 692 501 753 373 C812 247 639 220 535 224 C550 97 619 28 743 28'], [210, 167], [743, 28]);
alphabet.AE = symbol('M0 0 L.55 1 L1 1', 'M.55 1 L.55 0 L1 0', 'M.16 .4 L.96 .4');
alphabet.OE = symbol('M.6 1 L.32 1 C-.11 1 -.11 0 .32 0 L.6 0 L.6 1 L1 1', 'M.6 .5 L.97 .5', 'M.6 0 L1 0');
alphabet.dong = symbol('M.78 .82 C.52 1.05 0 .85 0 .5 C0 .06 .78 .11 .78 .55', 'M.78 1 L.78 .16', 'M.37 .87 L1 .87', 'M0 0 L1 0');
alphabet.ordfeminine = symbol('M.75 .71 C.23 .97 0 .7 0 .48 C0 .19 .75 .19 .75 .49', 'M.75 .78 L.75 .36 Q.75 .25 1 .25', 'M0 0 L1 0');
alphabet.ordmasculine = symbol('M.5 1 C1.17 1 1.17 .29 .5 .29 C-.17 .29 -.17 1 .5 1', 'M0 0 L1 0');
alphabet.perthousand = symbol('M.25 .75 C.25 1.08 0 1.08 0 .75 C0 .42 .25 .42 .25 .75', 'M.59 1 L.24 0', 'M.71 .23 C.71 .55 .44 .55 .44 .23 C.44 -.08 .71 -.08 .71 .23', 'M1 .23 C1 .55 .73 .55 .73 .23 C.73 -.08 1 -.08 1 .23');
alphabet['periodcentered.loclCAT.case'] = { strokes: [dot(146, 353)] };
alphabet.uni25CC = { strokes: Array.from({ length: 16 }, (_, i) => dot(405 + 340 * Math.cos(i * Math.PI / 8), 350 + 340 * Math.sin(i * Math.PI / 8), 80)) };
alphabet['t_t.liga'] = pen(['M234 708 L234 222 C234 92 282 28 400 28', 'M617 708 L617 222 C617 92 665 28 783 28', 'M91 511 L775 511'], [234, 222], [783, 28]);

// Uppercase and stacked Vietnamese accents have their own source coordinates.
for (const name of ['gravecomb', 'acutecomb', 'uni0302', 'uni0306', 'uni0307', 'uni0308', 'hookabovecomb', 'uni031B', 'uni0338']) {
  alphabet[`${name}.case`] = { ...alphabet[name], normalized: true };
}
for (const prefix of ['uni0302', 'uni0306']) {
  for (const [suffix, mark] of [['0300', 'gravecomb'], ['0301', 'acutecomb'], ['0303', 'tildecomb'], ['0309', 'hookabovecomb']]) {
    const bottom = alphabet[prefix];
    const top = alphabet[mark];
    for (const ending of ['', '.case']) {
      alphabet[`${prefix}${suffix}${ending}`] = {
        strokes: [...bottom.strokes, ...top.strokes.map(stroke => ({ ...stroke, d: stroke.d.replace(/-?\d+(?:\.\d+)?/g, (value, offset, full) => {
          // Converted into a normalized box by the layout engine below instead;
          // the two marks keep their vertical relationship before fitting.
          const numbersBefore = full.slice(0, offset).match(/-?\d+(?:\.\d+)?/g)?.length ?? 0;
          return String(Number(value) + (numbersBefore % 2 ? 210 : 150));
        }) }))],
        normalized: true,
      };
    }
  }
}
