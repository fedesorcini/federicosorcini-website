/* Persistent view tabs. These only select independent existing renderers;
 * they do not touch the Three.js scene, cameras, picking, or room geometry.
 */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const buttons = {
    room: byId('roomViewBtn'),
    angular: byId('layoutViewBtn'),
    top: byId('toggleViewBtn'),
  };
  const projection = byId('projectionMode');
  if (!Object.values(buttons).every(Boolean) || !projection) return;

  let activeView = 'room';
  let writingProjection = false;
  function setView(view) {
    if (!Object.hasOwn(buttons, view)) return;
    activeView = view;
    window.realDepthAngularViewSuspend?.(view === 'top');
    window.realDepthTopViewSetActive?.(view === 'top');
    if (view !== 'top') {
      const value = view === 'angular' ? 'angular' : 'perspective';
      if (projection.value !== value) {
        writingProjection = true;
        projection.value = value;
        projection.dispatchEvent(new Event('change', { bubbles: true }));
        writingProjection = false;
      }
      // Keep the independent angular canvas in step even when no event fires.
      window.realDepthAngularViewSync?.();
    }
    for (const [key, button] of Object.entries(buttons)) {
      button.setAttribute('aria-pressed', String(key === view));
    }
  }

  for (const [view, button] of Object.entries(buttons)) {
    button.addEventListener('click', () => setView(view));
  }
  // The original projection dropdown remains functional and selects its view.
  projection.addEventListener('change', () => {
    if (!writingProjection) setView(projection.value === 'angular' ? 'angular' : 'room');
  });
  window.realDepthViewControls = Object.freeze({
    setView,
    syncProjection() {
      setView(projection.value === 'angular' ? 'angular' : 'room');
    },
    getActiveView() { return activeView; },
  });
  setView('room');
})();
