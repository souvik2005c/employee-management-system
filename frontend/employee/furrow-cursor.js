(() => {
  // Furrow-style custom cursor (minimal extraction)
  const cursor = document.querySelector('.custom-cursor');
  if (!cursor) return;

  const isCoarsePointer = (() => {
    try {
      return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch {
      return false;
    }
  })();

  // On touch devices, show cursor only while actively touching.
  if (isCoarsePointer) {
    cursor.style.opacity = '0';
  }

  const interactiveSelector = [
    'a[href]',
    'button',
    'canvas',
    '[role="button"]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[data-cursor="interactive"]'
  ].join(',');

  // Performance note:
  // The original Furrow cursor effect used repeated elementFromPoint() + getComputedStyle()
  // loops on every move, which can lag badly on mid/low-end devices. This implementation keeps
  // the cursor movement buttery-smooth by:
  // - updating position in requestAnimationFrame
  // - using pointerover/pointerout to toggle interactive state (cheap)
  // - removing the expensive “red on pure black background” scan

  let isSticky = false;
  let isTouchActive = false;
  let lastX = 0;
  let lastY = 0;
  let rafId = null;
  let needsAnotherFrame = false;

  function scheduleFrame() {
    if (rafId) {
      needsAnotherFrame = true;
      return;
    }

    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!isSticky) {
        cursor.style.transform = `translate3d(${lastX}px, ${lastY}px, 0) translate(-50%, -50%)`;
      }
      if (needsAnotherFrame) {
        needsAnotherFrame = false;
        scheduleFrame();
      }
    });
  }

  function updateFromEventPoint(evt) {
    if (!evt) return;
    if (typeof evt.clientX === 'number' && typeof evt.clientY === 'number') {
      lastX = evt.clientX;
      lastY = evt.clientY;
      scheduleFrame();
      return;
    }
    const touch = evt.touches?.[0] || evt.changedTouches?.[0];
    if (touch && typeof touch.clientX === 'number' && typeof touch.clientY === 'number') {
      lastX = touch.clientX;
      lastY = touch.clientY;
      scheduleFrame();
    }
  }

  function setInteractiveFromTarget(target) {
    const interactive = target && target.closest ? target.closest(interactiveSelector) : null;
    cursor.classList.toggle('--interactive', !!interactive);
  }

  function onMove(e) {
    // On touch devices we only track while touching, to avoid fighting scrolling.
    if (isCoarsePointer && !isTouchActive) return;
    updateFromEventPoint(e);
  }

  function onDown(e) {
    if (isCoarsePointer) {
      isTouchActive = true;
      cursor.style.opacity = '1';
    }
    updateFromEventPoint(e);
  }

  function onUp() {
    if (isCoarsePointer) {
      isTouchActive = false;
      cursor.style.opacity = '0';
    }
  }

  if ('PointerEvent' in window) {
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('pointercancel', onUp, { passive: true });
    document.addEventListener('pointerover', (e) => setInteractiveFromTarget(e.target), { passive: true });
    document.addEventListener('pointerout', (e) => setInteractiveFromTarget(e.relatedTarget || document.elementFromPoint(lastX, lastY)), { passive: true });
  } else {
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onUp, { passive: true });
    document.addEventListener('touchcancel', onUp, { passive: true });
    document.addEventListener('mouseover', (e) => setInteractiveFromTarget(e.target), { passive: true });
    document.addEventListener('mouseout', (e) => setInteractiveFromTarget(e.relatedTarget || document.elementFromPoint(lastX, lastY)), { passive: true });
  }

  // Optional: sticky effect for marked items
  const stickyItems = document.querySelectorAll('.sticky-item');
  stickyItems.forEach((item) => {
    item.addEventListener('mouseenter', () => {
      const r = item.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      cursor.classList.add('--sticky');
      cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%)`;
      isSticky = true;
    });
    item.addEventListener('mouseleave', () => {
      cursor.classList.remove('--sticky');
      isSticky = false;
    });
  });

  document.addEventListener('mouseleave', () => (cursor.style.opacity = '0'));
  document.addEventListener('mouseenter', () => (cursor.style.opacity = '1'));
})();
