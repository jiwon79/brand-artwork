(function () {
  'use strict';

  // Touch-only: skip on non-touch devices
  if (!('ontouchstart' in window)) return;

  const style = document.createElement('style');
  style.textContent = `
    .tc-dot {
      position: fixed;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.45);
      pointer-events: none;
      transform: translate(-50%, -50%);
      z-index: 99999;
      will-change: left, top;
    }
    .tc-ring {
      position: fixed;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.65);
      pointer-events: none;
      transform: translate(-50%, -50%);
      z-index: 99998;
      will-change: left, top;
    }
    .tc-ripple {
      position: fixed;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 1.5px solid rgba(255, 255, 255, 0.5);
      pointer-events: none;
      transform: translate(-50%, -50%) scale(1);
      z-index: 99997;
      animation: tc-ripple-out 0.45s ease-out forwards;
    }
    @keyframes tc-ripple-out {
      from {
        transform: translate(-50%, -50%) scale(1);
        opacity: 0.7;
      }
      to {
        transform: translate(-50%, -50%) scale(2.8);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);

  const cursors = new Map();

  function placeCursor(el, x, y) {
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
  }

  function spawnRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'tc-ripple';
    placeCursor(ripple, x, y);
    document.body.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  function createCursor(touch) {
    const dot  = document.createElement('div');
    dot.className = 'tc-dot';
    const ring = document.createElement('div');
    ring.className = 'tc-ring';

    placeCursor(dot,  touch.clientX, touch.clientY);
    placeCursor(ring, touch.clientX, touch.clientY);
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    spawnRipple(touch.clientX, touch.clientY);
    cursors.set(touch.identifier, { dot, ring });
  }

  function moveCursor(touch) {
    const c = cursors.get(touch.identifier);
    if (!c) return;
    placeCursor(c.dot,  touch.clientX, touch.clientY);
    placeCursor(c.ring, touch.clientX, touch.clientY);
  }

  function removeCursor(touch) {
    const c = cursors.get(touch.identifier);
    if (!c) return;
    spawnRipple(touch.clientX, touch.clientY);
    c.dot.remove();
    c.ring.remove();
    cursors.delete(touch.identifier);
  }

  document.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) createCursor(t);
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) moveCursor(t);
  }, { passive: true });

  document.addEventListener('touchend', e => {
    for (const t of e.changedTouches) removeCursor(t);
  }, { passive: true });

  document.addEventListener('touchcancel', e => {
    for (const t of e.changedTouches) {
      const c = cursors.get(t.identifier);
      if (c) { c.dot.remove(); c.ring.remove(); cursors.delete(t.identifier); }
    }
  }, { passive: true });
})();
