import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const degToRad = (d) => d * Math.PI / 180;
const radToDeg = (r) => r * 180 / Math.PI;
const visualAngleDeg = (sizeM, distanceM) => radToDeg(2 * Math.atan(sizeM / (2 * distanceM)));
const sizeFromAngleM = (angleDeg, distanceM) => 2 * distanceM * Math.tan(degToRad(angleDeg) / 2);
const positionAngleDeg = (offsetM, distanceM) => radToDeg(Math.atan2(offsetM, Math.max(distanceM, 0.0001)));
const offsetFromPositionAngleM = (angleDeg, distanceM) => Math.max(distanceM, 0.0001) * Math.tan(degToRad(angleDeg));
const formatSigned = (value, digits = 3) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

const els = {
  viewport: $('viewport'),
  viewportMessage: $('viewportMessage'),
  pupilMm: $('pupilMm'),
  ipdMm: $('ipdMm'),
  blurToggle: $('blurToggle'),
  diplopiaToggle: $('diplopiaToggle'),
  maxBlurPx: $('maxBlurPx'),
  displayWidthCm: $('displayWidthCm'),
  viewingDistanceCm: $('viewingDistanceCm'),
  viewportFovReadout: $('viewportFovReadout'),
  ppdReadout: $('ppdReadout'),
  roomWidthM: $('roomWidthM'),
  roomHeightM: $('roomHeightM'),
  roomDepthM: $('roomDepthM'),
  eyeHeightM: $('eyeHeightM'),
  roomBrightness: $('roomBrightness'),
  newObjectType: $('newObjectType'),
  newObjectText: $('newObjectText'),
  newObjectColor: $('newObjectColor'),
  newOrientationRow: null,
  newOrientationDeg: null,
  newGaborFrequencyRow: null,
  newGaborFrequencyCpd: null,
  addObjectBtn: $('addObjectBtn'),
  resetSceneBtn: $('resetSceneBtn'),
  clearSceneBtn: null,
  objectList: $('objectList'),
  objName: $('objName'),
  objTextRow: $('objTextRow'),
  objText: $('objText'),
  objOrientationRow: null,
  objOrientationDeg: null,
  objGaborFrequencyRow: null,
  objGaborFrequencyCpd: null,
  sizeLockMode: $('sizeLockMode'),
  objColor: $('objColor'),
  objWidthCm: $('objWidthCm'),
  objHeightCm: $('objHeightCm'),
  objAngleXDeg: $('objAngleXDeg'),
  objAngleYDeg: $('objAngleYDeg'),
  objDistanceM: $('objDistanceM'),
  objXDeg: $('objXDeg'),
  objYDeg: $('objYDeg'),
  setFocusBtn: $('setFocusBtn'),
  deleteObjectBtn: $('deleteObjectBtn'),
  focusStatusText: $('focusStatusText'),
  focusDistanceReadout: $('focusDistanceReadout'),
  focusDiopterReadout: $('focusDiopterReadout'),
  deltaDiopterReadout: $('deltaDiopterReadout'),
  blurArcminReadout: $('blurArcminReadout'),
  disparityDegReadout: $('disparityDegReadout'),
  disparityPxReadout: $('disparityPxReadout'),
  depthCanvas: $('depthCanvas'),
  selectedObjectSection: $('selectedObjectSection'),
};

// Pupil diameter is currently fixed for the public simulator.
// Set SHOW_PUPIL_DIAMETER_CONTROL to true if you want to expose the control later.
const FIXED_PUPIL_DIAMETER_MM = 4.0;
const SHOW_PUPIL_DIAMETER_CONTROL = false;

const DEFAULTS = {
  optics: {
    pupilMm: FIXED_PUPIL_DIAMETER_MM,
    ipdMm: 64,
    blur: true,
    diplopia: false,
    maxBlurPx: 24,
  },
  display: {
    widthCm: 80,
    viewingDistanceCm: 60,
  },
  room: {
    widthM: 7.0,
    heightM: 3.0,
    depthM: 16.0,
    eyeHeightM: 1.6,
    brightness: 1.25,
  }
};

let state = {
  objects: [],
  selectedId: null,
  focusedId: null,
  nextId: 1,
};

let calibration = {
  horizontalFovDeg: 40,
  verticalFovDeg: 30,
  pixelsPerDegreeCss: 30,
  focalPxCss: 1000,
};

let renderer;
let scene;
let camera;
let leftCamera;
let rightCamera;
let roomGroup;
let objectRoot;
let raycaster;
let pointer;
let dirty = true;
let renderTargets = {};
let fullScreenScene;
let fullScreenCamera;
let fullScreenQuad;
let compositeMaterial;
let roomDepthMaterial;
let roomBlurMaterial;
let rendererBackend = 'unknown';

const STIMULUS_FOCUS_TOL_D = 0.002;
const MAX_STIMULUS_TEXTURE_DIM = 2048;
const MIN_STIMULUS_TEXTURE_DIM = 96;
const stimulusSourceCache = new Map();

// Keyboard movement controls. A key press moves once immediately. If the key
// remains held, repeating begins after 300 ms and continues at a steady rate.
const KEYBOARD_NUDGE_ANGLE_DEG = 0.25;
const KEYBOARD_NUDGE_DEPTH_M = 0.05;
const KEYBOARD_HOLD_DELAY_MS = 300;
const KEYBOARD_REPEAT_MS = 60;
const activeMovementKeys = new Map();

const pickMeshes = [];

function numberValue(input, fallback) {
  const n = Number(input.value);
  return Number.isFinite(n) ? n : fallback;
}

function safeName(text, fallback = 'Object') {
  const s = String(text ?? '').trim();
  return s || fallback;
}

function normalizeHexColor(value, fallback = '#111111') {
  const s = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
}

function markDirty() {
  dirty = true;
}

function installStimulusUi() {
  // Add the extra stimulus types and controls without requiring a separate
  // HTML replacement. These are inserted into the existing Add object and
  // Selected object panels at startup.
  const ensureTypeOption = (value, label) => {
    if (!Array.from(els.newObjectType.options).some(option => option.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      els.newObjectType.appendChild(option);
    }
  };

  ensureTypeOption('gabor', 'Gabor patch');
  ensureTypeOption('arrow', 'Arrow');

  // Orientation applies to every stimulus. 0° is the native orientation;
  // positive angles rotate counterclockwise on screen. For a Gabor, 0° means
  // vertical bars. For an arrow, 0° points right.
  if (!document.getElementById('newOrientationDeg')) {
    const row = document.createElement('label');
    row.id = 'newOrientationRow';
    row.innerHTML = `
      <span class="label-text">Orientation</span>
      <span class="field-with-unit stacked">
        <input id="newOrientationDeg" type="number" min="0" max="359.9" step="1" value="0" />
        <span>deg</span>
      </span>
      <small class="helper">0° = native; arrow points right; Gabor bars are vertical; positive = counterclockwise</small>
    `;
    const textLabel = els.newObjectText.closest('label');
    if (textLabel) textLabel.insertAdjacentElement('afterend', row);
  }

  if (!document.getElementById('newGaborFrequencyCpd')) {
    const row = document.createElement('label');
    row.id = 'newGaborFrequencyRow';
    row.innerHTML = `
      <span class="label-text">Spatial frequency</span>
      <span class="field-with-unit stacked">
        <input id="newGaborFrequencyCpd" type="number" min="0.1" max="10" step="0.1" value="1.5" />
        <span>cyc/°</span>
      </span>
      <small class="helper">Carrier frequency in cycles per degree of visual angle</small>
    `;
    const orientationRow = document.getElementById('newOrientationRow');
    if (orientationRow) orientationRow.insertAdjacentElement('afterend', row);
  }

  els.newOrientationRow = $('newOrientationRow');
  els.newOrientationDeg = $('newOrientationDeg');
  els.newGaborFrequencyRow = $('newGaborFrequencyRow');
  els.newGaborFrequencyCpd = $('newGaborFrequencyCpd');

  if (!document.getElementById('objOrientationDeg')) {
    const row = document.createElement('label');
    row.id = 'objOrientationRow';
    row.innerHTML = `
      <span class="label-text">Orientation</span>
      <span class="field-with-unit stacked">
        <input id="objOrientationDeg" type="number" min="0" max="359.9" step="1" />
        <span>deg</span>
      </span>
      <small class="helper">0° = native; arrow points right; Gabor bars are vertical; positive = counterclockwise</small>
    `;
    els.objTextRow.insertAdjacentElement('afterend', row);
  }

  if (!document.getElementById('objGaborFrequencyCpd')) {
    const row = document.createElement('label');
    row.id = 'objGaborFrequencyRow';
    row.innerHTML = `
      <span class="label-text">Spatial frequency</span>
      <span class="field-with-unit stacked">
        <input id="objGaborFrequencyCpd" type="number" min="0.1" max="10" step="0.1" />
        <span>cyc/°</span>
      </span>
      <small class="helper">Carrier frequency in cycles per degree of visual angle</small>
    `;
    const orientationRow = document.getElementById('objOrientationRow');
    if (orientationRow) orientationRow.insertAdjacentElement('afterend', row);
  }

  els.objOrientationRow = $('objOrientationRow');
  els.objOrientationDeg = $('objOrientationDeg');
  els.objGaborFrequencyRow = $('objGaborFrequencyRow');
  els.objGaborFrequencyCpd = $('objGaborFrequencyCpd');

  updateNewObjectControls();
}


function installWorkspaceLayout() {
  // Keep the pupil-diameter control in the DOM/code for a possible later
  // release, but hide it for now and force the simulation to use 4.0 mm.
  if (els.pupilMm) {
    els.pupilMm.value = FIXED_PUPIL_DIAMETER_MM.toFixed(1);
    const pupilControlRow = els.pupilMm.closest('label') || els.pupilMm.parentElement;
    if (pupilControlRow) {
      pupilControlRow.hidden = !SHOW_PUPIL_DIAMETER_CONTROL;
      pupilControlRow.style.display = SHOW_PUPIL_DIAMETER_CONTROL ? '' : 'none';
    }
  }

  // Reorganize the existing simulator DOM at startup so the HTML file does
  // not need to be replaced. The Add object panel remains always visible,
  // while Optics, Display calibration, and Room Options become compact
  // disclosure sections beneath it.
  const controlsPanel = document.querySelector('.controls-panel');
  const objectPanel = document.querySelector('.object-panel');

  const addSection = els.addObjectBtn?.closest('.panel-section');
  const opticsSection = els.pupilMm?.closest('.panel-section');
  const displaySection = els.displayWidthCm?.closest('.panel-section');
  const roomSection = els.roomWidthM?.closest('.panel-section');

  if (controlsPanel && addSection && opticsSection && displaySection && roomSection) {
    // Explicitly enforce the requested top-to-bottom order.
    controlsPanel.append(addSection, opticsSection, displaySection, roomSection);

    makeCollapsiblePanelSection(opticsSection, 'Optics', false);
    makeCollapsiblePanelSection(displaySection, 'Display calibration', false);
    makeCollapsiblePanelSection(roomSection, 'Room Options', false);
  }

  // Put the selected-object editor first in the right toolbar. The Objects
  // list and Optical readout follow it in their existing relative order.
  if (objectPanel && els.selectedObjectSection) {
    objectPanel.prepend(els.selectedObjectSection);
  }

  installSceneActionBar();
  installWorkspaceLayoutStyles();
}

function makeCollapsiblePanelSection(section, title, initiallyExpanded = false) {
  if (!section || section.dataset.collapsibleInstalled === 'true') return;

  const oldHeading = section.querySelector(':scope > h2');
  const body = document.createElement('div');
  body.className = 'collapsible-section-body';

  // Move everything except the old heading into the disclosure body.
  for (const child of [...section.children]) {
    if (child !== oldHeading) body.appendChild(child);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'collapsible-section-toggle';
  toggle.setAttribute('aria-expanded', initiallyExpanded ? 'true' : 'false');

  const arrow = document.createElement('span');
  arrow.className = 'collapsible-section-arrow';
  arrow.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'collapsible-section-label';
  label.textContent = title;

  toggle.append(arrow, label);

  const setExpanded = (expanded) => {
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    arrow.textContent = expanded ? '▾' : '▸';
    body.hidden = !expanded;
  };

  toggle.addEventListener('click', () => {
    setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
  });

  if (oldHeading) oldHeading.remove();
  section.prepend(toggle);
  section.appendChild(body);
  section.classList.add('collapsible-panel-section');
  section.dataset.collapsibleInstalled = 'true';
  setExpanded(initiallyExpanded);
}

function installSceneActionBar() {
  if (document.getElementById('sceneActionBar')) {
    els.clearSceneBtn = $('clearSceneBtn');
    return;
  }

  const viewportCard = document.querySelector('.viewport-card');
  if (!viewportCard || !els.viewport || !els.resetSceneBtn) return;

  const bar = document.createElement('div');
  bar.id = 'sceneActionBar';
  bar.className = 'scene-action-bar';

  // Move the existing Reset scene button out of the page header and into the
  // new bar. Keep its id so the existing reset behavior remains unchanged.
  els.resetSceneBtn.className = 'button scene-reset-button';

  const clearButton = document.createElement('button');
  clearButton.id = 'clearSceneBtn';
  clearButton.type = 'button';
  clearButton.className = 'button scene-clear-button';
  clearButton.textContent = 'Clear scene';
  clearButton.title = 'Remove all objects from the scene';

  bar.append(els.resetSceneBtn, clearButton);
  els.viewport.insertAdjacentElement('afterend', bar);
  els.clearSceneBtn = clearButton;

  // The old header action wrapper is no longer needed once Reset scene moves.
  const headerActions = document.querySelector('.header-actions');
  if (headerActions && headerActions.children.length === 0) headerActions.remove();
}

function installWorkspaceLayoutStyles() {
  if (document.getElementById('workspaceLayoutStyles')) return;

  const style = document.createElement('style');
  style.id = 'workspaceLayoutStyles';
  style.textContent = `
    .collapsible-panel-section {
      padding: 0 !important;
    }

    .collapsible-section-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 0.55rem;
      margin: 0;
      padding: 1rem;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 700;
      line-height: 1.2;
      text-align: left;
      cursor: pointer;
    }

    .collapsible-section-toggle:hover {
      background: color-mix(in srgb, currentColor 7%, transparent);
    }

    .collapsible-section-toggle:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: -4px;
    }

    .collapsible-section-arrow {
      flex: 0 0 1rem;
      width: 1rem;
      font-size: 0.95em;
      line-height: 1;
      text-align: center;
    }

    .collapsible-section-label {
      flex: 1 1 auto;
      min-width: 0;
    }

    .collapsible-section-body {
      padding: 0 1rem 1rem;
    }

    .collapsible-section-body[hidden] {
      display: none !important;
    }

    .scene-action-bar {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.65rem;
      padding: 0.7rem 0.8rem;
      border-top: 1px solid var(--border, #d8dde4);
      background: var(--panel, #ffffff);
    }

    .scene-action-bar .button {
      width: auto;
      min-width: 110px;
    }

    .scene-reset-button {
      border: 1px solid var(--navy, var(--accent, #324C63));
      background: var(--navy, var(--accent, #324C63));
      color: var(--cream, #F0E8D8);
    }

    .scene-clear-button {
      border: 1px solid var(--navy, var(--accent, #324C63));
      background: transparent;
      color: var(--navy, var(--accent, #324C63));
    }

    .scene-clear-button:hover,
    .scene-reset-button:hover {
      transform: translateY(-1px);
    }

    @media (max-width: 560px) {
      .scene-action-bar {
        justify-content: stretch;
      }

      .scene-action-bar .button {
        flex: 1 1 0;
        min-width: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

function normalizedOrientationDeg(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

function normalizedGaborFrequencyCpd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1.5;
  return clamp(n, 0.1, 10);
}

function updateNewObjectControls() {
  const type = els.newObjectType.value;
  const isLetter = type === 'letter';
  const isGabor = type === 'gabor';

  els.newObjectText.disabled = !isLetter;
  if (els.newOrientationDeg) els.newOrientationDeg.disabled = false;
  if (els.newGaborFrequencyRow) els.newGaborFrequencyRow.style.display = isGabor ? 'block' : 'none';
  if (els.newGaborFrequencyCpd) els.newGaborFrequencyCpd.disabled = !isGabor;

  // The Gabor is achromatic; the color picker remains available for letters,
  // arrows, and geometric shapes.
  if (els.newObjectColor) els.newObjectColor.disabled = isGabor;
}

function showViewportMessage(message) {
  if (!message) {
    els.viewportMessage.hidden = true;
    els.viewportMessage.textContent = '';
    return;
  }
  els.viewportMessage.textContent = message;
  els.viewportMessage.hidden = false;
}

function currentRoom() {
  return {
    widthM: clamp(numberValue(els.roomWidthM, DEFAULTS.room.widthM), 1.5, 15),
    heightM: clamp(numberValue(els.roomHeightM, DEFAULTS.room.heightM), 1.8, 8),
    depthM: clamp(numberValue(els.roomDepthM, DEFAULTS.room.depthM), 1, 30),
    eyeHeightM: clamp(numberValue(els.eyeHeightM, DEFAULTS.room.eyeHeightM), 0.5, 2.3),
    brightness: clamp(numberValue(els.roomBrightness, DEFAULTS.room.brightness), 0.4, 2.5),
  };
}

function currentOptics() {
  return {
    pupilM: FIXED_PUPIL_DIAMETER_MM / 1000,
    ipdM: clamp(numberValue(els.ipdMm, 64), 45, 80) / 1000,
    blur: els.blurToggle.checked,
    diplopia: els.diplopiaToggle.checked,
    maxBlurPx: clamp(numberValue(els.maxBlurPx, 24), 2, 60),
  };
}

function focusedObject() {
  return state.objects.find(o => o.id === state.focusedId) ?? null;
}

function selectedObject() {
  return state.objects.find(o => o.id === state.selectedId) ?? null;
}

function objectById(id) {
  return state.objects.find(o => o.id === id) ?? null;
}

function createRenderer() {
  // Three.js r162 is intentionally used because it can run on either WebGL 2
  // or WebGL 1. Newer Three.js releases require WebGL 2.
  const attrs = {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
  };

  const canvas = document.createElement('canvas');
  let context = null;

  // Try the most capable path first, then progressively relax requirements.
  try { context = canvas.getContext('webgl2', attrs); } catch (_) {}
  if (context) {
    rendererBackend = 'WebGL 2';
  } else {
    const webgl1Attrs = { ...attrs, antialias: false };
    try { context = canvas.getContext('webgl', webgl1Attrs); } catch (_) {}
    if (!context) {
      try { context = canvas.getContext('experimental-webgl', webgl1Attrs); } catch (_) {}
    }
    if (context) rendererBackend = 'WebGL 1 compatibility mode';
  }

  if (!context) {
    throw new Error('No WebGL context could be created by this browser.');
  }

  renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xc7d0da, 1);

  els.viewport.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('pointerdown', onViewportPointerDown);
}

function createScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd3dbe4);

  camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  leftCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  rightCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xa0acb7, 2.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(-1.6, 3.8, 1.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(1.8, 2.2, 0.8);
  scene.add(fill);

  roomGroup = new THREE.Group();
  objectRoot = new THREE.Group();
  scene.add(roomGroup, objectRoot);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
}

function createPostProcessing() {
  // Stimulus defocus is baked into each object's transparent texture.
  // The room is different: its walls/floor/ceiling span many depths, so we
  // render a room-only depth map and apply a depth-dependent blur per pixel.
  // The same fullscreen pass infrastructure is then reused for diplopia.
  fullScreenScene = new THREE.Scene();
  fullScreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  fullScreenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  fullScreenQuad.frustumCulled = false;
  fullScreenScene.add(fullScreenQuad);

  roomDepthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uFar: { value: 50.0 },
    },
    vertexShader: `
      varying float vViewDepth;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDepth = max(0.0, -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uFar;
      varying float vViewDepth;

      void main() {
        // Pack normalized linear depth into two 8-bit color channels.
        // This stays compatible with the simulator's WebGL 1 fallback.
        float normalizedDepth = clamp(vViewDepth / max(uFar, 0.001), 0.0, 1.0);
        float scaled = normalizedDepth * 255.0;
        float hi = floor(scaled) / 255.0;
        float lo = fract(scaled);
        gl_FragColor = vec4(hi, lo, 0.0, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
  });

  roomBlurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFocusDistance: { value: 1.0 },
      uPupilM: { value: 0.004 },
      uFocalPx: { value: 1000.0 },
      uMaxBlurPx: { value: 24.0 },
      uFar: { value: 50.0 },
      uBlurEnabled: { value: 1.0 },
      uOutputToScreen: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform vec2 uResolution;
      uniform float uFocusDistance;
      uniform float uPupilM;
      uniform float uFocalPx;
      uniform float uMaxBlurPx;
      uniform float uFar;
      uniform float uBlurEnabled;
      uniform float uOutputToScreen;
      varying vec2 vUv;

      vec3 linearToSRGB(vec3 value) {
        vec3 v = max(value, vec3(0.0));
        vec3 low = v * 12.92;
        vec3 high = 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055;
        return mix(low, high, step(vec3(0.0031308), v));
      }

      float decodeLinearDepth(vec4 packedDepth) {
        float normalizedDepth = packedDepth.r + packedDepth.g / 255.0;
        return normalizedDepth * uFar;
      }

      float opticalBlurRadiusPx(float depthM) {
        if (uBlurEnabled < 0.5) return 0.0;

        float objectDepth = max(depthM, 0.05);
        float focusDepth = max(uFocusDistance, 0.05);
        float deltaD = abs((1.0 / objectDepth) - (1.0 / focusDepth));
        if (deltaD < ${STIMULUS_FOCUS_TOL_D.toFixed(6)}) return 0.0;

        float blurDiameterRad = uPupilM * deltaD;
        float blurDiameterPx = 2.0 * uFocalPx * tan(blurDiameterRad * 0.5);
        return min(0.5 * blurDiameterPx, uMaxBlurPx);
      }

      void main() {
        vec4 centerColor = texture2D(tColor, vUv);
        float depthM = decodeLinearDepth(texture2D(tDepth, vUv));
        float radiusPx = opticalBlurRadiusPx(depthM);
        vec4 outputColor = centerColor;

        if (radiusPx >= 0.35) {
          vec2 texel = 1.0 / max(uResolution, vec2(1.0));
          vec4 sum = centerColor * 1.5;
          float totalWeight = 1.5;

          // A fixed golden-angle disc gives a smooth, roughly circular blur while
          // allowing every pixel to use its own optical blur radius.
          for (int i = 0; i < 32; i++) {
            float fi = float(i) + 0.5;
            float radial = sqrt(fi / 32.0);
            float angle = fi * 2.39996323;
            vec2 direction = vec2(cos(angle), sin(angle));
            vec2 sampleUv = clamp(
              vUv + direction * radial * radiusPx * texel,
              vec2(0.0),
              vec2(1.0)
            );
            float weight = exp(-1.7 * radial * radial);
            sum += texture2D(tColor, sampleUv) * weight;
            totalWeight += weight;
          }

          outputColor = sum / totalWeight;
        }

        // Offscreen eye buffers stay in linear space. When this shader writes
        // directly to the visible canvas, encode once for the display.
        if (uOutputToScreen > 0.5) {
          outputColor.rgb = linearToSRGB(outputColor.rgb);
        }
        gl_FragColor = outputColor;
      }
    `,
    depthTest: false,
    depthWrite: false,
  });

  compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tLeft: { value: null },
      tRight: { value: null },
      uHalfShiftUv: { value: 0.0 },
      uVisibleScaleX: { value: 1.0 },
      uVisibleOffsetX: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tLeft;
      uniform sampler2D tRight;
      uniform float uHalfShiftUv;
      uniform float uVisibleScaleX;
      uniform float uVisibleOffsetX;
      varying vec2 vUv;

      vec3 linearToSRGB(vec3 value) {
        vec3 v = max(value, vec3(0.0));
        vec3 low = v * 12.92;
        vec3 high = 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055;
        return mix(low, high, step(vec3(0.0031308), v));
      }

      void main() {
        // Each eye is rendered to a horizontally overscanned texture that is
        // wider than the actual viewport. First map the visible viewport into
        // the centered crop of that wider texture, then apply the fixation
        // alignment shift. This lets diplopic content come in naturally from
        // outside the visible frame instead of smearing or being cut off at
        // the render-target edge.
        float baseX = uVisibleOffsetX + vUv.x * uVisibleScaleX;
        float xL = baseX + uHalfShiftUv;
        float xR = baseX - uHalfShiftUv;

        bool validL = xL >= 0.0 && xL <= 1.0;
        bool validR = xR >= 0.0 && xR <= 1.0;

        vec4 outputColor;
        if (validL && validR) {
          vec4 leftColor = texture2D(tLeft, vec2(xL, vUv.y));
          vec4 rightColor = texture2D(tRight, vec2(xR, vUv.y));
          outputColor = 0.5 * (leftColor + rightColor);
        } else if (validL) {
          outputColor = texture2D(tLeft, vec2(xL, vUv.y));
        } else if (validR) {
          outputColor = texture2D(tRight, vec2(xR, vUv.y));
        } else {
          // Linear-space equivalent of scene background #D3DBE4.
          outputColor = vec4(0.651406, 0.708376, 0.775822, 1.0);
        }

        // The eye render targets contain linear RGB. Convert to sRGB exactly
        // once when compositing to the visible canvas so colors match the
        // non-diplopia path instead of appearing artificially dark.
        outputColor.rgb = linearToSRGB(outputColor.rgb);
        gl_FragColor = outputColor;
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

function disposeRenderTarget(target) {
  if (!target) return;
  target.dispose();
}

function makeSceneTarget(width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  return target;
}

function makeRoomDepthTarget(width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    // Packed depth should be sampled exactly; linear filtering can mix the
    // two packed channels across geometry boundaries.
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  return target;
}

function resizeRenderTargets(viewportWidth, renderHeight, overscanPx = 0) {
  const padPx = Math.max(0, Math.ceil(overscanPx));
  const targetWidth = Math.max(1, viewportWidth + padPx * 2);
  const same =
    renderTargets.viewportWidth === viewportWidth &&
    renderTargets.height === renderHeight &&
    renderTargets.overscanPx === padPx;
  if (same) return;

  for (const key of ['left', 'right', 'roomColor', 'roomDepth']) {
    disposeRenderTarget(renderTargets[key]);
  }

  renderTargets = {
    // width is the actual offscreen render width. viewportWidth is the center
    // crop that is ultimately shown to the user.
    width: targetWidth,
    viewportWidth,
    height: renderHeight,
    overscanPx: padPx,
    left: makeSceneTarget(targetWidth, renderHeight),
    right: makeSceneTarget(targetWidth, renderHeight),
    roomColor: makeSceneTarget(targetWidth, renderHeight),
    roomDepth: makeRoomDepthTarget(targetWidth, renderHeight),
  };
}

function diplopiaOverscanPx(focus, optics) {
  if (!renderer || !focus) return 0;

  const dpr = renderer.getPixelRatio();
  const focalPxRender = calibration.focalPxCss * dpr;

  // The final binocular composite translates each complete eye image by half
  // the fixation disparity. The offscreen eye render therefore needs at least
  // that much extra image on both sides. Add enough extra margin for the
  // largest permitted blur halo so blurred stimuli/room edges can also enter
  // the visible crop cleanly.
  const halfFocusShiftPx = 0.5 * focalPxRender * optics.ipdM / Math.max(focus.distanceM, 0.05);
  const blurSafetyPx = optics.blur ? (3 * optics.maxBlurPx * dpr + 4 * dpr) : (4 * dpr);

  return Math.ceil(halfFocusShiftPx + blurSafetyPx);
}

function disposeObject3D(root) {
  root.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    }
  });
}

function buildRoom() {
  while (roomGroup.children.length) {
    const child = roomGroup.children[0];
    roomGroup.remove(child);
    disposeObject3D(child);
  }

  const room = currentRoom();
  const brightness = room.brightness;
  const brighten = (hex, mult = 1) => {
    const color = new THREE.Color(hex);
    const scale = brightness * mult;
    color.r = clamp(color.r * scale, 0, 1);
    color.g = clamp(color.g * scale, 0, 1);
    color.b = clamp(color.b * scale, 0, 1);
    return color;
  };

  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(room.widthM, room.heightM),
    new THREE.MeshBasicMaterial({ color: brighten(0xe2e5e8, 1.00), side: THREE.DoubleSide })
  );
  back.position.set(0, room.heightM / 2, -room.depthM);
  roomGroup.add(back);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(room.widthM, room.depthM),
    new THREE.MeshBasicMaterial({ color: brighten(0xc6cbd0, 0.96), side: THREE.DoubleSide })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -room.depthM / 2);
  roomGroup.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(room.widthM, room.depthM),
    new THREE.MeshBasicMaterial({ color: brighten(0xf0f1f2, 1.00), side: THREE.DoubleSide })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, room.heightM, -room.depthM / 2);
  roomGroup.add(ceiling);

  const leftWall = new THREE.Mesh(
    new THREE.PlaneGeometry(room.depthM, room.heightM),
    new THREE.MeshBasicMaterial({ color: brighten(0xd5d9dd, 0.98), side: THREE.DoubleSide })
  );
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-room.widthM / 2, room.heightM / 2, -room.depthM / 2);
  roomGroup.add(leftWall);

  const rightWall = new THREE.Mesh(
    new THREE.PlaneGeometry(room.depthM, room.heightM),
    new THREE.MeshBasicMaterial({ color: brighten(0xd5d9dd, 0.98), side: THREE.DoubleSide })
  );
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(room.widthM / 2, room.heightM / 2, -room.depthM / 2);
  roomGroup.add(rightWall);

  const edgeColor = new THREE.Color(0x7d858d);
  const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.9 });
  const halfW = room.widthM / 2;
  const h = room.heightM;
  const d = room.depthM;
  const frontZ = 0;
  const backZ = -d;
  const corners = {
    fbl: new THREE.Vector3(-halfW, 0, frontZ),
    fbr: new THREE.Vector3(halfW, 0, frontZ),
    ftl: new THREE.Vector3(-halfW, h, frontZ),
    ftr: new THREE.Vector3(halfW, h, frontZ),
    bbl: new THREE.Vector3(-halfW, 0, backZ),
    bbr: new THREE.Vector3(halfW, 0, backZ),
    btl: new THREE.Vector3(-halfW, h, backZ),
    btr: new THREE.Vector3(halfW, h, backZ),
  };
  const edges = [
    ['bbl', 'bbr'], ['btl', 'btr'], ['bbl', 'btl'], ['bbr', 'btr'],
    ['fbl', 'bbl'], ['fbr', 'bbr'], ['ftl', 'btl'], ['ftr', 'btr'],
    ['fbl', 'fbr'], ['ftl', 'ftr'], ['fbl', 'ftl'], ['fbr', 'ftr'],
  ];
  for (const [a, b] of edges) {
    const geom = new THREE.BufferGeometry().setFromPoints([corners[a], corners[b]]);
    roomGroup.add(new THREE.Line(geom, edgeMat));
  }

  markDirty();
}

function makeTightTextSource(text, color) {
  const displayText = String(text || 'A').slice(0, 12);
  const normalizedColor = normalizeHexColor(color, '#16191d');

  const cacheKey = `letter|${displayText}|${normalizedColor}`;
  const cached = stimulusSourceCache.get(cacheKey);
  if (cached) return cached;

  const fontSize = 512;
  const fontFamily = 'Arial, Helvetica, sans-serif';
  const fontWeight = '700';

  // Draw the glyph onto an oversized temporary canvas, then inspect the
  // alpha channel so the source crop matches the true visible pixel bounds.
  const measureCanvas = document.createElement('canvas');
  const tempWidth = Math.max(2048, displayText.length * fontSize * 1.5);
  const tempHeight = fontSize * 2;

  measureCanvas.width = Math.ceil(tempWidth);
  measureCanvas.height = Math.ceil(tempHeight);

  const ctx = measureCanvas.getContext('2d');
  ctx.clearRect(0, 0, measureCanvas.width, measureCanvas.height);
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = normalizedColor;

  const drawX = fontSize * 0.5;
  const drawY = fontSize * 1.25;
  ctx.fillText(displayText, drawX, drawY);

  const imageData = ctx.getImageData(0, 0, measureCanvas.width, measureCanvas.height);
  const data = imageData.data;

  let minX = measureCanvas.width;
  let minY = measureCanvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < measureCanvas.height; y++) {
    for (let x = 0; x < measureCanvas.width; x++) {
      const alpha = data[(y * measureCanvas.width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    const source = {
      canvas: measureCanvas,
      sx: 0,
      sy: 0,
      sw: measureCanvas.width,
      sh: measureCanvas.height,
    };
    stimulusSourceCache.set(cacheKey, source);
    return source;
  }

  const source = {
    canvas: measureCanvas,
    sx: minX,
    sy: minY,
    sw: maxX - minX + 1,
    sh: maxY - minY + 1,
  };

  stimulusSourceCache.set(cacheKey, source);
  return source;
}

function projectedPixelsForAngle(angleDeg, focalPx) {
  return 2 * focalPx * Math.tan(degToRad(angleDeg) / 2);
}

function objectOpticalBlurRadiusRenderPx(obj) {
  const optics = currentOptics();
  const focus = focusedObject();

  if (!optics.blur || !focus) return 0;

  const deltaD = Math.abs((1 / obj.distanceM) - (1 / focus.distanceM));
  if (deltaD < STIMULUS_FOCUS_TOL_D) return 0;

  const blurDiameterRad = optics.pupilM * deltaD;
  const focalPxRender = calibration.focalPxCss * (renderer?.getPixelRatio?.() || 1);
  const blurDiameterPx = 2 * focalPxRender * Math.tan(blurDiameterRad / 2);
  const opticalRadiusPx = 0.5 * blurDiameterPx;
  const maxRadiusPx = optics.maxBlurPx * (renderer?.getPixelRatio?.() || 1);

  return clamp(opticalRadiusPx, 0, maxRadiusPx);
}

function makeGaborSourceCanvas(obj, widthPx, heightPx) {
  // Render the carrier at a high enough source resolution for the simulator's
  // generic defocus pass to attenuate its contrast smoothly.
  const maxSourceDim = 1024;
  const scale = Math.min(1, maxSourceDim / Math.max(widthPx, heightPx));
  const sourceWidth = Math.max(96, Math.round(widthPx * scale));
  const sourceHeight = Math.max(96, Math.round(heightPx * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;

  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(sourceWidth, sourceHeight);
  const data = image.data;

  // The source Gabor always has vertical bars. The generic object rotation is
  // applied later to the entire stimulus, so orientation works identically for
  // Gabors, letters, arrows, and shapes.
  const frequencyCpd = normalizedGaborFrequencyCpd(obj.spatialFrequencyCpd ?? 1.5);
  const angleXDeg = Math.max(0.01, obj.angleXDeg || 0.01);
  const minDim = Math.max(1, Math.min(sourceWidth, sourceHeight));

  // Circular Gaussian envelope with a cosine taper that reaches true zero
  // before the square texture edge, preventing a visible square cutoff.
  const sigma = 0.34;
  const taperStart = 0.72;

  for (let y = 0; y < sourceHeight; y++) {
    const dy = (y + 0.5 - sourceHeight / 2) / (minDim / 2);
    for (let x = 0; x < sourceWidth; x++) {
      const dx = (x + 0.5 - sourceWidth / 2) / (minDim / 2);
      const radius = Math.hypot(dx, dy);

      // Convert horizontal position into degrees of visual angle. Because the
      // carrier varies along local X, frequency remains constant in cycles/deg
      // even when a physically locked object changes angular size with depth.
      const xNorm = (x + 0.5) / sourceWidth - 0.5;
      const xDeg = xNorm * angleXDeg;
      const carrier = Math.cos(2 * Math.PI * frequencyCpd * xDeg);
      const gaussian = Math.exp(-0.5 * (radius * radius) / (sigma * sigma));

      let aperture = 0;
      if (radius < taperStart) {
        aperture = 1;
      } else if (radius < 1) {
        const t = (radius - taperStart) / (1 - taperStart);
        aperture = 0.5 * (1 + Math.cos(Math.PI * t));
      }

      const envelope = gaussian * aperture;
      const luminance = Math.round(255 * (0.5 + 0.5 * carrier));
      const alpha = envelope <= 0.0005 ? 0 : Math.round(255 * envelope);
      const i = (y * sourceWidth + x) * 4;
      data[i] = luminance;
      data[i + 1] = luminance;
      data[i + 2] = luminance;
      data[i + 3] = alpha;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function makeSharpStimulusCanvas(obj, widthPx, heightPx) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, widthPx);
  canvas.height = Math.max(1, heightPx);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = normalizeHexColor(obj.color, '#111111');

  if (obj.type === 'letter') {
    // The cached source is tightly cropped to the visible glyph. Drawing it
    // into the full sharp stimulus rectangle means the visible glyph itself,
    // rather than a surrounding text canvas, has the requested visual angle.
    const source = makeTightTextSource(obj.text, obj.color);
    ctx.drawImage(
      source.canvas,
      source.sx, source.sy, source.sw, source.sh,
      0, 0, canvas.width, canvas.height
    );
    return canvas;
  }

  if (obj.type === 'gabor') {
    const source = makeGaborSourceCanvas(obj, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  if (obj.type === 'arrow') {
    // Right-pointing arrow modeled after a standard psychophysics cue: a
    // straight shaft with a filled triangular arrowhead. Generic orientation
    // rotates this complete stimulus after rendering.
    const w = canvas.width;
    const h = canvas.height;
    ctx.beginPath();
    ctx.moveTo(0.06 * w, 0.43 * h);
    ctx.lineTo(0.72 * w, 0.43 * h);
    ctx.lineTo(0.72 * w, 0.22 * h);
    ctx.lineTo(0.96 * w, 0.50 * h);
    ctx.lineTo(0.72 * w, 0.78 * h);
    ctx.lineTo(0.72 * w, 0.57 * h);
    ctx.lineTo(0.06 * w, 0.57 * h);
    ctx.closePath();
    ctx.fill();
    return canvas;
  }

  if (obj.type === 'circle') {
    ctx.beginPath();
    ctx.ellipse(
      canvas.width / 2,
      canvas.height / 2,
      canvas.width / 2,
      canvas.height / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    return canvas;
  }

  if (obj.type === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(0, canvas.height);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();
    return canvas;
  }

  // Square / fallback.
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function makeStimulusTextureData(obj) {
  const dpr = renderer?.getPixelRatio?.() || 1;
  const focalPxRender = calibration.focalPxCss * dpr;

  const targetWidthRenderPx = Math.max(1, projectedPixelsForAngle(obj.angleXDeg, focalPxRender));
  const targetHeightRenderPx = Math.max(1, projectedPixelsForAngle(obj.angleYDeg, focalPxRender));
  const largestTarget = Math.max(targetWidthRenderPx, targetHeightRenderPx);

  // Use one common texture scale in X and Y so a circular blur remains circular
  // in screen pixels even when the requested stimulus is not square.
  let textureScale = 1;
  if (largestTarget < MIN_STIMULUS_TEXTURE_DIM) {
    textureScale = MIN_STIMULUS_TEXTURE_DIM / largestTarget;
  }
  if (largestTarget * textureScale > MAX_STIMULUS_TEXTURE_DIM) {
    textureScale = MAX_STIMULUS_TEXTURE_DIM / largestTarget;
  }

  const sharpWidthPx = Math.max(2, Math.round(targetWidthRenderPx * textureScale));
  const sharpHeightPx = Math.max(2, Math.round(targetHeightRenderPx * textureScale));
  const sharpCanvas = makeSharpStimulusCanvas(obj, sharpWidthPx, sharpHeightPx);

  const opticalBlurRadiusRenderPx = objectOpticalBlurRadiusRenderPx(obj);
  const opticalBlurRadiusCanvasPx = opticalBlurRadiusRenderPx * textureScale;

  // Canvas blur() is Gaussian. Match its FWHM approximately to the diameter of
  // the optical circle of confusion: FWHM = 2.355*sigma ~= 2*opticalRadius.
  const gaussianSigmaPx = opticalBlurRadiusCanvasPx / 1.17741;
  const paddingPx = Math.max(2, Math.ceil(3 * gaussianSigmaPx + 3));

  const canvas = document.createElement('canvas');
  canvas.width = sharpWidthPx + paddingPx * 2;
  canvas.height = sharpHeightPx + paddingPx * 2;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (gaussianSigmaPx >= 0.20) {
    ctx.filter = `blur(${gaussianSigmaPx.toFixed(3)}px)`;
    ctx.drawImage(sharpCanvas, paddingPx, paddingPx);
    ctx.filter = 'none';
  } else {
    ctx.drawImage(sharpCanvas, paddingPx, paddingPx);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    // The Three.js group itself is scaled to the requested sharp physical
    // width/height. Enlarge only the visual plane by the padding ratio so the
    // blur can extend beyond the original silhouette without changing the
    // requested sharp stimulus dimensions.
    planeScaleX: canvas.width / sharpWidthPx,
    planeScaleY: canvas.height / sharpHeightPx,
    opticalBlurRadiusRenderPx,
  };
}

function makeStimulusVisualMesh(obj) {
  const data = makeStimulusTextureData(obj);
  const material = new THREE.MeshBasicMaterial({
    map: data.texture,
    transparent: true,
    // Keep every low-alpha texel for Gabors so the Gaussian envelope and any
    // defocus halo can fade all the way to transparency without a hard contour.
    alphaTest: obj.type === 'gabor' ? 0 : 0.001,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.scale.set(data.planeScaleX, data.planeScaleY, 1);
  mesh.renderOrder = 2;
  mesh.userData.opticalBlurRadiusRenderPx = data.opticalBlurRadiusRenderPx;
  return mesh;
}

function makePickMesh(id) {
  // Separate the clickable area from the padded blurred visual. This keeps the
  // hit target equal to the object's requested sharp width/height.
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    colorWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.userData.simObjectId = id;
  mesh.position.z = 0.002;
  return mesh;
}

function makeOutline(color, scale = 1.08) {
  const points = [
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(-0.5, 0.5, 0),
  ];
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
  const line = new THREE.LineLoop(geom, mat);
  line.position.z = 0.004;
  line.scale.set(scale, scale, 1);
  line.renderOrder = 1000;
  line.visible = false;
  return line;
}

function createObjectVisual(obj) {
  const group = new THREE.Group();

  const visualMesh = makeStimulusVisualMesh(obj);
  group.add(visualMesh);

  const pickMesh = makePickMesh(obj.id);
  group.add(pickMesh);

  const selectionOutline = makeOutline(0xb36a18, 1.08);
  group.add(selectionOutline);

  obj.group = group;
  obj.visualMesh = visualMesh;
  obj.pickMesh = pickMesh;
  obj.selectionOutline = selectionOutline;
  obj.focusOutline = null;

  pickMeshes.push(pickMesh);
  objectRoot.add(group);
  applyObjectTransform(obj);
}

function removeObjectVisual(obj) {
  if (!obj?.group) return;
  const pickIndex = pickMeshes.indexOf(obj.pickMesh);
  if (pickIndex >= 0) pickMeshes.splice(pickIndex, 1);
  objectRoot.remove(obj.group);
  disposeObject3D(obj.group);
  obj.group = null;
  obj.visualMesh = null;
  obj.pickMesh = null;
  obj.selectionOutline = null;
}

function rebuildObjectVisual(obj) {
  removeObjectVisual(obj);
  createObjectVisual(obj);
}

function refreshObjectStimulus(obj) {
  if (!obj?.group) return;

  const oldMesh = obj.visualMesh;
  const newMesh = makeStimulusVisualMesh(obj);
  obj.group.add(newMesh);
  obj.visualMesh = newMesh;

  if (oldMesh) {
    obj.group.remove(oldMesh);
    disposeObject3D(oldMesh);
  }
}

function refreshAllStimulusTextures() {
  for (const obj of state.objects) {
    refreshObjectStimulus(obj);
  }
  markDirty();
}

function applyObjectTransform(obj) {
  if (!obj.group) return;
  const room = currentRoom();
  obj.group.position.set(obj.xM, room.eyeHeightM + obj.yM, -obj.distanceM);
  obj.group.scale.set(obj.widthM, obj.heightM, 1);
  obj.group.rotation.z = degToRad(normalizedOrientationDeg(obj.orientationDeg ?? 0));
  obj.selectionOutline.visible = obj.id === state.selectedId;
}

function syncObjectDimensions(obj) {
  if (obj.lockMode === 'visual') {
    obj.widthM = sizeFromAngleM(obj.angleXDeg, obj.distanceM);
    obj.heightM = sizeFromAngleM(obj.angleYDeg, obj.distanceM);
  } else {
    obj.angleXDeg = visualAngleDeg(obj.widthM, obj.distanceM);
    obj.angleYDeg = visualAngleDeg(obj.heightM, obj.distanceM);
  }
}

function positionAngleLimits(obj) {
  const room = currentRoom();
  const d = Math.max(obj.distanceM, 0.0001);

  const minXM = -room.widthM / 2 + 0.05;
  const maxXM = room.widthM / 2 - 0.05;
  const minYM = 0.05 - room.eyeHeightM;
  const maxYM = room.heightM - 0.05 - room.eyeHeightM;

  return {
    minXDeg: positionAngleDeg(minXM, d),
    maxXDeg: positionAngleDeg(maxXM, d),
    minYDeg: positionAngleDeg(minYM, d),
    maxYDeg: positionAngleDeg(maxYM, d),
  };
}

function syncObjectPosition(obj) {
  obj.xM = offsetFromPositionAngleM(obj.positionXDeg, obj.distanceM);
  obj.yM = offsetFromPositionAngleM(obj.positionYDeg, obj.distanceM);
}

function sanitizeObjectToRoom(obj) {
  const room = currentRoom();
  obj.distanceM = clamp(obj.distanceM, 0.15, Math.max(0.16, room.depthM - 0.05));

  const limits = positionAngleLimits(obj);
  obj.positionXDeg = clamp(Number.isFinite(obj.positionXDeg) ? obj.positionXDeg : 0, limits.minXDeg, limits.maxXDeg);
  obj.positionYDeg = clamp(Number.isFinite(obj.positionYDeg) ? obj.positionYDeg : 0, limits.minYDeg, limits.maxYDeg);
  syncObjectPosition(obj);

  obj.widthM = clamp(obj.widthM, 0.001, 5);
  obj.heightM = clamp(obj.heightM, 0.001, 5);
  obj.angleXDeg = clamp(obj.angleXDeg, 0.01, 90);
  obj.angleYDeg = clamp(obj.angleYDeg, 0.01, 90);
  obj.orientationDeg = normalizedOrientationDeg(obj.orientationDeg ?? 0);
  if (obj.type === 'gabor') {
    obj.spatialFrequencyCpd = normalizedGaborFrequencyCpd(obj.spatialFrequencyCpd ?? 1.5);
  }
  syncObjectDimensions(obj);
}

function newObject({
  type = 'letter',
  text = 'A',
  name,
  color = '#111111',
  distanceM = 1.25,
  positionXDeg = null,
  positionYDeg = null,
  xM = 0,
  yM = 0,
  lockMode = 'physical',
  widthM = 0.05,
  heightM = 0.05,
  angleXDeg = 3,
  angleYDeg = 3,
  orientationDeg = 0,
  spatialFrequencyCpd = 1.5,
}) {
  const id = state.nextId++;

  // xM/yM are retained as optional legacy inputs so older scene definitions
  // still work. New scenes should specify angular position directly.
  const resolvedPositionXDeg = positionXDeg ?? positionAngleDeg(xM, distanceM);
  const resolvedPositionYDeg = positionYDeg ?? positionAngleDeg(yM, distanceM);

  const obj = {
    id,
    type,
    text,
    name: name || (type === 'letter' ? text : type[0].toUpperCase() + type.slice(1)),
    color: normalizeHexColor(color, '#111111'),
    distanceM,
    positionXDeg: resolvedPositionXDeg,
    positionYDeg: resolvedPositionYDeg,
    xM: 0,
    yM: 0,
    lockMode,
    widthM,
    heightM,
    angleXDeg,
    angleYDeg,
    orientationDeg: normalizedOrientationDeg(orientationDeg),
    spatialFrequencyCpd: normalizedGaborFrequencyCpd(spatialFrequencyCpd),
    group: null,
    visualMesh: null,
    pickMesh: null,
  };

  sanitizeObjectToRoom(obj);
  state.objects.push(obj);
  createObjectVisual(obj);
  return obj;
}

function clearObjects() {
  for (const obj of [...state.objects]) removeObjectVisual(obj);
  state.objects = [];
  state.selectedId = null;
  state.focusedId = null;
  state.nextId = 1;
}


function clearScene() {
  stopAllMovementKeys();
  clearObjects();
  updateOutlines();
  refreshUi();
  markDirty();
}

function loadDefaultScene() {
  clearObjects();

  const n = newObject({
    type: 'letter',
    text: 'N',
    name: 'N',
    distanceM: 1.0,
    positionXDeg: 0.0,
    positionYDeg: 0.0,
    lockMode: 'physical',
    widthM: sizeFromAngleM(3.0, 1.0),
    heightM: sizeFromAngleM(5.0, 1.0),
    angleXDeg: 3.0,
    angleYDeg: 5.0,
    color: '#111111',
  });

  const x = newObject({
    type: 'letter',
    text: 'X',
    name: 'X',
    distanceM: 4.0,
    positionXDeg: 8.531,
    positionYDeg: 0.0,
    lockMode: 'physical',
    widthM: sizeFromAngleM(0.75, 4.0),
    heightM: sizeFromAngleM(1.251, 4.0),
    angleXDeg: 0.75,
    angleYDeg: 1.251,
    color: '#440cde',
  });

  const a = newObject({
    type: 'letter',
    text: 'A',
    name: 'A',
    distanceM: 0.4,
    positionXDeg: -7.5,
    positionYDeg: 0.0,
    lockMode: 'physical',
    widthM: sizeFromAngleM(7.495, 0.4),
    heightM: sizeFromAngleM(12.456, 0.4),
    angleXDeg: 7.495,
    angleYDeg: 12.456,
    color: '#AF1919',
  });

  // N starts selected and is the fixation target
  state.selectedId = n.id;
  state.focusedId = n.id;

  applyObjectTransform(n);
  applyObjectTransform(x);
  applyObjectTransform(a);

  refreshAllStimulusTextures();

  refreshUi();
  markDirty();
}

function resetAll() {
  if (els.pupilMm) els.pupilMm.value = FIXED_PUPIL_DIAMETER_MM.toFixed(1);
  els.ipdMm.value = DEFAULTS.optics.ipdMm.toFixed(0);

  els.blurToggle.checked = DEFAULTS.optics.blur;
  els.diplopiaToggle.checked = DEFAULTS.optics.diplopia;

  els.maxBlurPx.value = DEFAULTS.optics.maxBlurPx.toFixed(0);

  els.displayWidthCm.value = DEFAULTS.display.widthCm.toFixed(1);
  els.viewingDistanceCm.value = DEFAULTS.display.viewingDistanceCm.toFixed(1);

  els.roomWidthM.value = DEFAULTS.room.widthM.toFixed(1);
  els.roomHeightM.value = DEFAULTS.room.heightM.toFixed(1);
  els.roomDepthM.value = DEFAULTS.room.depthM.toFixed(1);

  els.eyeHeightM.value = DEFAULTS.room.eyeHeightM.toFixed(2);
  els.roomBrightness.value = DEFAULTS.room.brightness.toFixed(2);

  els.newObjectColor.value = '#111111';
  if (els.newOrientationDeg) els.newOrientationDeg.value = '0';
  if (els.newGaborFrequencyCpd) els.newGaborFrequencyCpd.value = '1.5';

  buildRoom();
  updateCameraAndCalibration();
  loadDefaultScene();
}

function updateCameraAndCalibration() {
  if (!renderer) return;
  const room = currentRoom();
  const width = Math.max(1, els.viewport.clientWidth);
  const height = Math.max(1, els.viewport.clientHeight);
  const displayWidthCm = clamp(numberValue(els.displayWidthCm, 53), 10, 200);
  const viewingDistanceCm = clamp(numberValue(els.viewingDistanceCm, 60), 20, 300);
  const screenCssWidth = Math.max(1, window.screen?.width || width);
  const cssPxPerCm = screenCssWidth / displayWidthCm;
  const viewportWidthCm = width / cssPxPerCm;
  const viewportHeightCm = height / cssPxPerCm;

  const hFovRad = 2 * Math.atan(viewportWidthCm / (2 * viewingDistanceCm));
  const vFovRad = 2 * Math.atan(viewportHeightCm / (2 * viewingDistanceCm));
  const focalPxCss = (width / 2) / Math.tan(hFovRad / 2);
  const ppdCss = focalPxCss * Math.PI / 180;

  calibration = {
    horizontalFovDeg: radToDeg(hFovRad),
    verticalFovDeg: radToDeg(vFovRad),
    pixelsPerDegreeCss: ppdCss,
    focalPxCss,
  };

  for (const cam of [camera, leftCamera, rightCamera]) {
    cam.fov = calibration.verticalFovDeg;
    cam.aspect = width / height;
    cam.near = 0.05;
    cam.far = Math.max(50, room.depthM + 5);
    cam.position.set(0, room.eyeHeightM, 0);
    cam.rotation.set(0, 0, 0);
    cam.updateProjectionMatrix();
  }

  const ipdM = currentOptics().ipdM;
  leftCamera.position.x = -ipdM / 2;
  rightCamera.position.x = ipdM / 2;

  els.viewportFovReadout.textContent = `${calibration.horizontalFovDeg.toFixed(1)}° × ${calibration.verticalFovDeg.toFixed(1)}°`;
  els.ppdReadout.textContent = `${calibration.pixelsPerDegreeCss.toFixed(1)} px/°`;

  const dpr = renderer.getPixelRatio();
  const renderWidth = Math.max(1, Math.round(width * dpr));
  const renderHeight = Math.max(1, Math.round(height * dpr));
  renderer.setSize(width, height, false);
  resizeRenderTargets(renderWidth, renderHeight, 0);

  // Texture resolution and rendered blur are calibrated in screen pixels, so
  // regenerate stimulus textures whenever display calibration changes.
  if (state.objects.length) refreshAllStimulusTextures();

  markDirty();
}

function renderRoomScratch(cam) {
  if (!renderTargets.roomColor || !renderTargets.roomDepth) return false;

  const oldObjectVisible = objectRoot.visible;
  const oldOverrideMaterial = scene.overrideMaterial;
  const oldBackground = scene.background;
  const oldClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const oldClearAlpha = renderer.getClearAlpha();

  objectRoot.visible = false;

  // First render the visible room colors normally.
  renderer.setRenderTarget(renderTargets.roomColor);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);

  // Then render only room geometry into a packed, linear-depth texture.
  // Clear to the far plane so pixels with only the scene background behave
  // like distant room/background pixels rather than near geometry.
  scene.background = null;
  scene.overrideMaterial = roomDepthMaterial;
  roomDepthMaterial.uniforms.uFar.value = cam.far;
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(renderTargets.roomDepth);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);

  scene.overrideMaterial = oldOverrideMaterial;
  scene.background = oldBackground;
  objectRoot.visible = oldObjectVisible;
  renderer.setClearColor(oldClearColor, oldClearAlpha);

  return true;
}

function renderBlurredRoom(cam, target) {
  if (!renderRoomScratch(cam)) return;

  const optics = currentOptics();
  const focus = focusedObject();
  const dpr = renderer.getPixelRatio();

  roomBlurMaterial.uniforms.tColor.value = renderTargets.roomColor.texture;
  roomBlurMaterial.uniforms.tDepth.value = renderTargets.roomDepth.texture;
  roomBlurMaterial.uniforms.uResolution.value.set(renderTargets.width, renderTargets.height);
  roomBlurMaterial.uniforms.uFocusDistance.value = focus?.distanceM ?? 1.0;
  roomBlurMaterial.uniforms.uPupilM.value = optics.pupilM;
  roomBlurMaterial.uniforms.uFocalPx.value = calibration.focalPxCss * dpr;
  roomBlurMaterial.uniforms.uMaxBlurPx.value = optics.maxBlurPx * dpr;
  roomBlurMaterial.uniforms.uFar.value = cam.far;
  roomBlurMaterial.uniforms.uBlurEnabled.value = optics.blur && focus ? 1.0 : 0.0;
  roomBlurMaterial.uniforms.uOutputToScreen.value = target === null ? 1.0 : 0.0;

  fullScreenQuad.material = roomBlurMaterial;
  renderer.setRenderTarget(target);
  renderer.clear(true, true, true);
  renderer.render(fullScreenScene, fullScreenCamera);
}

function renderObjectsOverRoom(cam, target) {
  const oldRoomVisible = roomGroup.visible;
  const oldBackground = scene.background;
  const oldAutoClear = renderer.autoClear;

  roomGroup.visible = false;
  scene.background = null;
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  renderer.clearDepth();
  renderer.render(scene, cam);

  renderer.autoClear = oldAutoClear;
  scene.background = oldBackground;
  roomGroup.visible = oldRoomVisible;
}

function renderEyeView(cam, target) {
  renderBlurredRoom(cam, target);
  renderObjectsOverRoom(cam, target);
}

function renderFrame() {
  if (!renderer) return;

  const room = currentRoom();
  const optics = currentOptics();
  const focus = focusedObject();
  const viewportRenderWidth = Math.max(1, renderer.domElement.width);
  const viewportRenderHeight = Math.max(1, renderer.domElement.height);

  camera.position.set(0, room.eyeHeightM, 0);
  leftCamera.position.set(-optics.ipdM / 2, room.eyeHeightM, 0);
  rightCamera.position.set(optics.ipdM / 2, room.eyeHeightM, 0);

  // Stimuli carry their own precomputed defocus. The room is rendered through
  // a depth-aware blur pass so its walls, floor, ceiling, and edge features
  // defocus according to their distance from the current fixation plane.
  if (!optics.diplopia || !focus) {
    // When diplopia is off, render exactly the visible field rather than the
    // wider stereo buffer used below.
    resizeRenderTargets(viewportRenderWidth, viewportRenderHeight, 0);
    renderEyeView(camera, null);
    return;
  }

  // Render a wider-than-visible field for each eye. Only the centered viewport
  // crop is shown at the end. This is analogous to camera overscan: geometry
  // just outside the display still exists in the eye images and can shift into
  // view when the two eyes are aligned at fixation.
  const overscanPx = diplopiaOverscanPx(focus, optics);
  resizeRenderTargets(viewportRenderWidth, viewportRenderHeight, overscanPx);

  if (!renderTargets.left || !renderTargets.right) return;

  // Keep vertical FOV and pixel scale unchanged while widening only the
  // horizontal field of the offscreen stereo cameras.
  const stereoAspect = renderTargets.width / renderTargets.height;
  for (const cam of [leftCamera, rightCamera]) {
    if (Math.abs(cam.aspect - stereoAspect) > 1e-9) {
      cam.aspect = stereoAspect;
      cam.updateProjectionMatrix();
    }
  }

  renderEyeView(leftCamera, renderTargets.left);
  renderEyeView(rightCamera, renderTargets.right);

  const focalPxRender = calibration.focalPxCss * renderer.getPixelRatio();
  const focusDisparityPx = focalPxRender * optics.ipdM / Math.max(focus.distanceM, 0.05);
  const halfShiftUv = 0.5 * focusDisparityPx / renderTargets.width;
  const visibleScaleX = renderTargets.viewportWidth / renderTargets.width;
  const visibleOffsetX = renderTargets.overscanPx / renderTargets.width;

  compositeMaterial.uniforms.tLeft.value = renderTargets.left.texture;
  compositeMaterial.uniforms.tRight.value = renderTargets.right.texture;
  compositeMaterial.uniforms.uHalfShiftUv.value = halfShiftUv;
  compositeMaterial.uniforms.uVisibleScaleX.value = visibleScaleX;
  compositeMaterial.uniforms.uVisibleOffsetX.value = visibleOffsetX;

  fullScreenQuad.material = compositeMaterial;
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(fullScreenScene, fullScreenCamera);
}

function animate() {
  requestAnimationFrame(animate);
  if (!dirty) return;
  dirty = false;
  renderFrame();
}

function onViewportPointerDown(event) {
  stopAllMovementKeys();
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickMeshes, false);

  // Clicking empty space clears the current selection.
  // The fixation target is NOT changed; it simply remains focused
  // without being selected for editing.
  if (!hits.length) {
    state.selectedId = null;
    updateOutlines();
    refreshUi();
    markDirty();
    return;
  }

  const id = hits[0].object.userData.simObjectId;
  selectObject(id);
}

function selectObject(id) {
  if (!objectById(id)) return;
  state.selectedId = id;
  updateOutlines();
  refreshUi();
  markDirty();
}

function setFocus(id) {
  if (!objectById(id)) return;
  state.focusedId = id;
  refreshAllStimulusTextures();
  updateOutlines();
  refreshUi();
  markDirty();
}

function updateOutlines() {
  for (const obj of state.objects) {
    if (!obj.group) continue;
    obj.selectionOutline.visible = obj.id === state.selectedId;
  }
}

function refreshObjectList() {
  els.objectList.innerHTML = '';
  for (const obj of state.objects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${obj.id === state.selectedId ? 'selected' : ''} ${obj.id === state.focusedId ? 'focused' : ''}`.trim();
    button.textContent = obj.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const frequencyMeta = obj.type === 'gabor' ? ` · ${obj.spatialFrequencyCpd.toFixed(2)} cyc/°` : '';
    meta.textContent = `${obj.distanceM.toFixed(2)} m · ${obj.angleXDeg.toFixed(2)}° × ${obj.angleYDeg.toFixed(2)}° · ori ${obj.orientationDeg.toFixed(1)}°${frequencyMeta}`;
    button.appendChild(meta);
    button.addEventListener('click', () => selectObject(obj.id));
    els.objectList.appendChild(button);
  }

  if (!state.objects.length) {
    const empty = document.createElement('div');
    empty.className = 'helper';
    empty.textContent = 'No objects. Add one from the left panel.';
    els.objectList.appendChild(empty);
  }
}

function refreshSelectedObjectEditor() {
  const obj = selectedObject();
  const controls = els.selectedObjectSection.querySelectorAll('input, select, button');
  controls.forEach(control => control.disabled = !obj);
  if (!obj) return;

  els.objName.value = obj.name;
  els.objText.value = obj.text || '';
  els.objTextRow.style.display = obj.type === 'letter' ? 'block' : 'none';
  if (els.objOrientationRow) els.objOrientationRow.style.display = 'block';
  if (els.objOrientationDeg) {
    els.objOrientationDeg.value = normalizedOrientationDeg(obj.orientationDeg ?? 0).toFixed(1);
  }
  if (els.objGaborFrequencyRow) {
    els.objGaborFrequencyRow.style.display = obj.type === 'gabor' ? 'block' : 'none';
  }
  if (els.objGaborFrequencyCpd) {
    els.objGaborFrequencyCpd.value = normalizedGaborFrequencyCpd(obj.spatialFrequencyCpd ?? 1.5).toFixed(2);
  }
  els.sizeLockMode.value = obj.lockMode;
  els.objColor.value = normalizeHexColor(obj.color, '#111111');
  els.objWidthCm.value = (obj.widthM * 100).toFixed(2);
  els.objHeightCm.value = (obj.heightM * 100).toFixed(2);
  els.objAngleXDeg.value = obj.angleXDeg.toFixed(3);
  els.objAngleYDeg.value = obj.angleYDeg.toFixed(3);
  els.objDistanceM.value = obj.distanceM.toFixed(3);
  els.objXDeg.value = obj.positionXDeg.toFixed(3);
  els.objYDeg.value = obj.positionYDeg.toFixed(3);

  const room = currentRoom();
  const limits = positionAngleLimits(obj);
  els.objDistanceM.max = Math.max(0.16, room.depthM - 0.05).toFixed(2);
  els.objXDeg.min = limits.minXDeg.toFixed(3);
  els.objXDeg.max = limits.maxXDeg.toFixed(3);
  els.objYDeg.min = limits.minYDeg.toFixed(3);
  els.objYDeg.max = limits.maxYDeg.toFixed(3);

  const physicalLocked = obj.lockMode === 'physical';
  els.objWidthCm.disabled = !physicalLocked;
  els.objHeightCm.disabled = !physicalLocked;
  els.objAngleXDeg.disabled = physicalLocked;
  els.objAngleYDeg.disabled = physicalLocked;
  els.objName.disabled = false;
  els.objText.disabled = obj.type !== 'letter';
  if (els.objOrientationDeg) els.objOrientationDeg.disabled = false;
  if (els.objGaborFrequencyCpd) els.objGaborFrequencyCpd.disabled = obj.type !== 'gabor';
  els.sizeLockMode.disabled = false;
  els.objColor.disabled = obj.type === 'gabor';
  els.objDistanceM.disabled = false;
  els.objXDeg.disabled = false;
  els.objYDeg.disabled = false;
  els.setFocusBtn.disabled = false;
  els.deleteObjectBtn.disabled = false;
}

function refreshFocusStatus() {
  const focus = focusedObject();
  els.focusStatusText.textContent = focus ? `Focus: ${focus.name} at ${focus.distanceM.toFixed(2)} m` : 'Focus: none';
}

function refreshOpticalReadouts() {
  const focus = focusedObject();
  const selected = selectedObject();
  if (!focus) {
    els.focusDistanceReadout.textContent = '—';
    els.focusDiopterReadout.textContent = '—';
    els.deltaDiopterReadout.textContent = '—';
    els.blurArcminReadout.textContent = '—';
    els.disparityDegReadout.textContent = '—';
    els.disparityPxReadout.textContent = '—';
    return;
  }

  const focusD = 1 / focus.distanceM;
  els.focusDistanceReadout.textContent = `${focus.distanceM.toFixed(3)} m`;
  els.focusDiopterReadout.textContent = `${focusD.toFixed(3)} D`;

  if (!selected) {
    els.deltaDiopterReadout.textContent = '—';
    els.blurArcminReadout.textContent = '—';
    els.disparityDegReadout.textContent = '—';
    els.disparityPxReadout.textContent = '—';
    return;
  }

  const optics = currentOptics();
  const deltaD = (1 / selected.distanceM) - focusD;
  const blurDiameterRad = optics.pupilM * Math.abs(deltaD);
  const blurArcmin = radToDeg(blurDiameterRad) * 60;
  const disparityRad = optics.ipdM * deltaD;
  const disparityDeg = radToDeg(disparityRad);
  const separationPxCss = calibration.focalPxCss * disparityRad;

  els.deltaDiopterReadout.textContent = `${formatSigned(deltaD, 3)} D`;
  els.blurArcminReadout.textContent = `${blurArcmin.toFixed(2)} arcmin`;
  els.disparityDegReadout.textContent = `${formatSigned(disparityDeg, 3)}°`;
  els.disparityPxReadout.textContent = `${formatSigned(separationPxCss, 1)} px`;
}

function drawDepthSchematic() {
  const canvas = els.depthCanvas;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(300, rect.width || 900);
  const cssHeight = 190;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const styles = getComputedStyle(document.documentElement);
  const textColor = styles.getPropertyValue('--text').trim() || '#19202a';
  const muted = styles.getPropertyValue('--muted').trim() || '#687383';
  const border = styles.getPropertyValue('--border').trim() || '#d8dde4';
  const focusColor = styles.getPropertyValue('--focus').trim() || '#2e7d62';
  const selectedColor = styles.getPropertyValue('--selected').trim() || '#b36a18';

  const room = currentRoom();
  const left = 44;
  const right = cssWidth - 24;
  const axisY = 102;
  const usable = right - left;
  const mapX = (distanceM) => left + usable * clamp(distanceM / room.depthM, 0, 1);

  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, axisY);
  ctx.lineTo(right, axisY);
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = '12px "PT Serif", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('viewer', left, axisY + 34);

  ctx.beginPath();
  ctx.moveTo(left, axisY - 12);
  ctx.lineTo(left, axisY + 12);
  ctx.strokeStyle = textColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  const tickCount = Math.min(12, Math.max(2, Math.ceil(room.depthM)));
  for (let i = 0; i <= tickCount; i++) {
    const d = room.depthM * i / tickCount;
    const x = mapX(d);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, axisY - 5);
    ctx.lineTo(x, axisY + 5);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.font = '10px "PT Serif", Georgia, serif';
    ctx.fillText(`${d.toFixed(d < 10 ? 1 : 0)}m`, x, axisY + 20);
  }

  ctx.strokeStyle = muted;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(right, 35);
  ctx.lineTo(right, 145);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = muted;
  ctx.font = '10px "PT Serif", Georgia, serif';
  ctx.fillText('back wall', right, 28);

  const focus = focusedObject();
  const focusD = focus ? 1 / focus.distanceM : null;

  const sorted = [...state.objects].sort((a, b) => a.distanceM - b.distanceM);
  sorted.forEach((obj, idx) => {
    const x = mapX(obj.distanceM);
    const isFocus = obj.id === state.focusedId;
    const isSelected = obj.id === state.selectedId;
    const color = isFocus ? focusColor : (isSelected ? selectedColor : textColor);
    const markerY = axisY - 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = isFocus || isSelected ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(x, axisY - 25);
    ctx.lineTo(x, axisY + 2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, markerY, isFocus ? 6 : 5, 0, Math.PI * 2);
    ctx.fill();

    const labelY = 40 + (idx % 3) * 18;
    ctx.fillStyle = color;
    ctx.font = `${isFocus ? '700' : '400'} 11px "PT Serif", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillText(obj.name.slice(0, 18), x, labelY);

    if (focusD !== null) {
      const deltaD = (1 / obj.distanceM) - focusD;
      ctx.fillStyle = muted;
      ctx.font = '10px "PT Serif", Georgia, serif';
      ctx.fillText(`${formatSigned(deltaD, 2)} D`, x, labelY + 12);
    }
  });
}

function refreshUi({ refreshEditor = true } = {}) {
  refreshObjectList();
  if (refreshEditor) refreshSelectedObjectEditor();
  refreshFocusStatus();
  refreshOpticalReadouts();
  drawDepthSchematic();
}

function commitSelectedFromEditor(field, { refreshEditor = true } = {}) {
  const obj = selectedObject();
  if (!obj) return;

  const room = currentRoom();

  if (field === 'name') {
    obj.name = safeName(els.objName.value, obj.type === 'letter' ? (obj.text || 'Letter') : 'Object');
  } else if (field === 'text' && obj.type === 'letter') {
    obj.text = String(els.objText.value || 'A').slice(0, 12);
    if (!obj.text) obj.text = 'A';
  } else if (field === 'color' && obj.type !== 'gabor') {
    obj.color = normalizeHexColor(els.objColor.value, obj.color || '#111111');
  } else if (field === 'orientation') {
    obj.orientationDeg = normalizedOrientationDeg(numberValue(els.objOrientationDeg, obj.orientationDeg ?? 0));
  } else if (field === 'gaborFrequency' && obj.type === 'gabor') {
    obj.spatialFrequencyCpd = normalizedGaborFrequencyCpd(numberValue(els.objGaborFrequencyCpd, obj.spatialFrequencyCpd ?? 1.5));
  } else if (field === 'lockMode') {
    obj.lockMode = els.sizeLockMode.value === 'visual' ? 'visual' : 'physical';
    syncObjectDimensions(obj);
  } else if (field === 'widthCm' && obj.lockMode === 'physical') {
    obj.widthM = clamp(numberValue(els.objWidthCm, obj.widthM * 100) / 100, 0.001, 5);
    syncObjectDimensions(obj);
  } else if (field === 'heightCm' && obj.lockMode === 'physical') {
    obj.heightM = clamp(numberValue(els.objHeightCm, obj.heightM * 100) / 100, 0.001, 5);
    syncObjectDimensions(obj);
  } else if (field === 'angleX' && obj.lockMode === 'visual') {
    obj.angleXDeg = clamp(numberValue(els.objAngleXDeg, obj.angleXDeg), 0.01, 90);
    syncObjectDimensions(obj);
  } else if (field === 'angleY' && obj.lockMode === 'visual') {
    obj.angleYDeg = clamp(numberValue(els.objAngleYDeg, obj.angleYDeg), 0.01, 90);
    syncObjectDimensions(obj);
  } else if (field === 'distance') {
    obj.distanceM = clamp(numberValue(els.objDistanceM, obj.distanceM), 0.15, Math.max(0.16, room.depthM - 0.05));
    // Visual size and angular position both stay fixed as depth changes.
    syncObjectDimensions(obj);
    syncObjectPosition(obj);
  } else if (field === 'positionX') {
    obj.positionXDeg = numberValue(els.objXDeg, obj.positionXDeg);
  } else if (field === 'positionY') {
    obj.positionYDeg = numberValue(els.objYDeg, obj.positionYDeg);
  }

  sanitizeObjectToRoom(obj);
  applyObjectTransform(obj);

  // Distance changes to the fixation target change every object's dioptric
  // error. Other appearance/size/distance edits only require this object's
  // pre-blurred texture to be regenerated.
  if (field === 'distance' && obj.id === state.focusedId) {
    refreshAllStimulusTextures();
  } else if (!['name', 'positionX', 'positionY', 'orientation'].includes(field)) {
    refreshObjectStimulus(obj);
  }

  // Do not rewrite the editor's current value while the user is typing. That
  // was what caused the caret to jump to the end on each keystroke.
  refreshUi({ refreshEditor });
  markDirty();
}

function isEditableKeyboardTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}

function movementActionForEvent(event) {
  switch (event.code) {
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'KeyW': return 'away';
    case 'KeyS': return 'closer';
    default: return null;
  }
}

function nudgeSelectedObject(action) {
  const obj = selectedObject();
  if (!obj) return;

  const before = {
    distanceM: obj.distanceM,
    positionXDeg: obj.positionXDeg,
    positionYDeg: obj.positionYDeg,
  };

  if (action === 'left') {
    obj.positionXDeg -= KEYBOARD_NUDGE_ANGLE_DEG;
  } else if (action === 'right') {
    obj.positionXDeg += KEYBOARD_NUDGE_ANGLE_DEG;
  } else if (action === 'up') {
    obj.positionYDeg += KEYBOARD_NUDGE_ANGLE_DEG;
  } else if (action === 'down') {
    obj.positionYDeg -= KEYBOARD_NUDGE_ANGLE_DEG;
  } else if (action === 'away') {
    obj.distanceM += KEYBOARD_NUDGE_DEPTH_M;
  } else if (action === 'closer') {
    obj.distanceM -= KEYBOARD_NUDGE_DEPTH_M;
  } else {
    return;
  }

  sanitizeObjectToRoom(obj);

  const distanceChanged = Math.abs(obj.distanceM - before.distanceM) > 1e-9;
  const positionChanged =
    Math.abs(obj.positionXDeg - before.positionXDeg) > 1e-9 ||
    Math.abs(obj.positionYDeg - before.positionYDeg) > 1e-9;

  if (!distanceChanged && !positionChanged) return;

  applyObjectTransform(obj);

  // Moving in depth changes optical blur. If the fixation object itself moves,
  // every object's defocus changes; otherwise only the moved object needs a new
  // pre-blurred texture. Lateral/vertical movement needs no texture rebuild.
  if (distanceChanged) {
    if (obj.id === state.focusedId) {
      refreshAllStimulusTextures();
    } else {
      refreshObjectStimulus(obj);
    }
  }

  refreshUi();
  markDirty();
}

function stopMovementKey(code) {
  const active = activeMovementKeys.get(code);
  if (!active) return;
  clearTimeout(active.delayTimer);
  if (active.repeatTimer) clearInterval(active.repeatTimer);
  activeMovementKeys.delete(code);
}

function stopAllMovementKeys() {
  for (const code of [...activeMovementKeys.keys()]) {
    stopMovementKey(code);
  }
}

function onMovementKeyDown(event) {
  const action = movementActionForEvent(event);
  if (!action) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isEditableKeyboardTarget(event.target)) return;
  if (!selectedObject()) return;

  // Prevent arrow keys from scrolling the page and suppress the browser's own
  // key-repeat timing; repetition is handled explicitly below.
  event.preventDefault();

  const code = event.code;
  if (activeMovementKeys.has(code)) return;

  nudgeSelectedObject(action);

  const active = {
    action,
    delayTimer: null,
    repeatTimer: null,
  };

  active.delayTimer = window.setTimeout(() => {
    // The key may have been released during the delay.
    if (!activeMovementKeys.has(code)) return;
    nudgeSelectedObject(action);
    active.repeatTimer = window.setInterval(() => {
      nudgeSelectedObject(action);
    }, KEYBOARD_REPEAT_MS);
  }, KEYBOARD_HOLD_DELAY_MS);

  activeMovementKeys.set(code, active);
}

function onMovementKeyUp(event) {
  if (!movementActionForEvent(event)) return;
  stopMovementKey(event.code);
}

function addObjectFromControls() {
  const type = els.newObjectType.value;
  const text = safeName(els.newObjectText.value, 'A').slice(0, 12);
  const color = normalizeHexColor(els.newObjectColor.value, '#111111');
  const orientationDeg = normalizedOrientationDeg(numberValue(els.newOrientationDeg, 0));
  const spatialFrequencyCpd = type === 'gabor'
    ? normalizedGaborFrequencyCpd(numberValue(els.newGaborFrequencyCpd, 1.5))
    : 1.5;
  const room = currentRoom();
  const baseDistance = focusedObject()?.distanceM ?? Math.min(1.25, room.depthM * 0.4);
  const offsetIndex = state.objects.length % 5;
  const newDistanceM = clamp(baseDistance + 0.2 * (offsetIndex - 2), 0.2, room.depthM - 0.1);
  // Most new stimuli begin at 3° × 3°. Arrows start wider and thinner so
  // their native 0° appearance matches a conventional right-pointing cue.
  const initialAngleXDeg = type === 'arrow' ? 4.0 : 3.0;
  const initialAngleYDeg = type === 'arrow' ? 1.0 : 3.0;

  const obj = newObject({
    type,
    text,
    name: type === 'letter' ? text : `${type[0].toUpperCase()}${type.slice(1)} ${state.nextId}`,
    color,
    distanceM: newDistanceM,
    positionXDeg: (offsetIndex - 2) * 4.0,
    positionYDeg: 0,
    lockMode: 'physical',
    widthM: sizeFromAngleM(initialAngleXDeg, newDistanceM),
    heightM: sizeFromAngleM(initialAngleYDeg, newDistanceM),
    angleXDeg: initialAngleXDeg,
    angleYDeg: initialAngleYDeg,
    orientationDeg,
    spatialFrequencyCpd,
  });
  state.selectedId = obj.id;
  if (!state.focusedId) state.focusedId = obj.id;
  refreshAllStimulusTextures();
  updateOutlines();
  refreshUi();
  markDirty();
}

function deleteSelectedObject() {
  const obj = selectedObject();
  if (!obj) return;
  const index = state.objects.findIndex(o => o.id === obj.id);
  removeObjectVisual(obj);
  state.objects.splice(index, 1);

  if (state.focusedId === obj.id) {
    state.focusedId = state.objects[0]?.id ?? null;
  }
  state.selectedId = state.objects[Math.min(index, state.objects.length - 1)]?.id ?? null;
  refreshAllStimulusTextures();
  updateOutlines();
  refreshUi();
  markDirty();
}

function roomSettingsChanged() {
  const room = currentRoom();
  els.roomWidthM.value = room.widthM.toFixed(1);
  els.roomHeightM.value = room.heightM.toFixed(1);
  els.roomDepthM.value = room.depthM.toFixed(1);
  els.eyeHeightM.value = room.eyeHeightM.toFixed(2);
  els.roomBrightness.value = room.brightness.toFixed(2);

  for (const obj of state.objects) {
    sanitizeObjectToRoom(obj);
    applyObjectTransform(obj);
  }
  buildRoom();
  updateCameraAndCalibration();
  refreshUi();
  markDirty();
}

function opticsChanged() {
  updateCameraAndCalibration();
  refreshOpticalReadouts();
  drawDepthSchematic();
  markDirty();
}

function bindEvents() {
  // Pupil diameter is fixed at 4.0 mm for now. The element remains in the
  // page so the control can be restored later by flipping the flag above.
  if (SHOW_PUPIL_DIAMETER_CONTROL && els.pupilMm) {
    els.pupilMm.addEventListener('input', opticsChanged);
  }
  for (const el of [els.ipdMm, els.maxBlurPx]) {
    el.addEventListener('input', opticsChanged);
  }
  els.blurToggle.addEventListener('change', opticsChanged);
  els.diplopiaToggle.addEventListener('change', opticsChanged);

  els.displayWidthCm.addEventListener('input', () => {
    updateCameraAndCalibration();
    refreshOpticalReadouts();
    markDirty();
  });
  els.viewingDistanceCm.addEventListener('input', () => {
    updateCameraAndCalibration();
    refreshOpticalReadouts();
    markDirty();
  });

  for (const el of [els.roomWidthM, els.roomHeightM, els.roomDepthM, els.eyeHeightM, els.roomBrightness]) {
    el.addEventListener('change', roomSettingsChanged);
  }

  els.newObjectType.addEventListener('change', updateNewObjectControls);
  els.addObjectBtn.addEventListener('click', addObjectFromControls);
  els.resetSceneBtn.addEventListener('click', resetAll);
  if (els.clearSceneBtn) els.clearSceneBtn.addEventListener('click', clearScene);

  // Free-text fields update live, but do not rewrite the editor while the
  // user is typing, so the caret stays where the user put it.
  els.objName.addEventListener('input', () => commitSelectedFromEditor('name', { refreshEditor: false }));
  els.objText.addEventListener('input', () => commitSelectedFromEditor('text', { refreshEditor: false }));
  els.objColor.addEventListener('input', () => commitSelectedFromEditor('color', { refreshEditor: false }));
  if (els.objOrientationDeg) {
    els.objOrientationDeg.addEventListener('change', () => commitSelectedFromEditor('orientation'));
  }
  if (els.objGaborFrequencyCpd) {
    els.objGaborFrequencyCpd.addEventListener('change', () => commitSelectedFromEditor('gaborFrequency'));
  }

  els.sizeLockMode.addEventListener('change', () => commitSelectedFromEditor('lockMode'));

  // Numeric fields commit on change (Enter or leaving the field). This lets the
  // user type values such as 0.400, -5.0, etc. normally without the app
  // formatting the value after every keystroke.
  els.objWidthCm.addEventListener('change', () => commitSelectedFromEditor('widthCm'));
  els.objHeightCm.addEventListener('change', () => commitSelectedFromEditor('heightCm'));
  els.objAngleXDeg.addEventListener('change', () => commitSelectedFromEditor('angleX'));
  els.objAngleYDeg.addEventListener('change', () => commitSelectedFromEditor('angleY'));
  els.objDistanceM.addEventListener('change', () => commitSelectedFromEditor('distance'));
  els.objXDeg.addEventListener('change', () => commitSelectedFromEditor('positionX'));
  els.objYDeg.addEventListener('change', () => commitSelectedFromEditor('positionY'));
  els.setFocusBtn.addEventListener('click', () => {
    const obj = selectedObject();
    if (obj) setFocus(obj.id);
  });
  els.deleteObjectBtn.addEventListener('click', deleteSelectedObject);

  const resizeObserver = new ResizeObserver(() => {
    updateCameraAndCalibration();
    drawDepthSchematic();
    markDirty();
  });
  resizeObserver.observe(els.viewport);
  resizeObserver.observe(els.depthCanvas.parentElement);

  window.addEventListener('resize', () => {
    updateCameraAndCalibration();
    drawDepthSchematic();
  });

  window.addEventListener('keydown', onMovementKeyDown);
  window.addEventListener('keyup', onMovementKeyUp);
  window.addEventListener('blur', stopAllMovementKeys);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAllMovementKeys();
  });
}

function validateWebGL() {
  if (renderer.capabilities.isWebGL2) {
    showViewportMessage('');
    return;
  }

  showViewportMessage('Running in WebGL 1 compatibility mode. Stimulus defocus blur and diplopia remain available, although WebGL 2 is preferred.');
}

function init() {
  try {
    createRenderer();
  } catch (error) {
    console.error(error);
    showViewportMessage('This browser could not create either a WebGL 2 or WebGL 1 graphics context. In Chrome, open chrome://gpu and check that WebGL is Hardware accelerated, then relaunch Chrome.');
    return;
  }

  try {
    createScene();
    createPostProcessing();
    installStimulusUi();
    installWorkspaceLayout();
    bindEvents();
    buildRoom();
    updateCameraAndCalibration();
    loadDefaultScene();
    validateWebGL();
    animate();
  } catch (error) {
    console.error('Simulator startup error:', error);
    const detail = error && error.message ? ` ${error.message}` : '';
    showViewportMessage(`Simulator startup error.${detail} Please send this message or a screenshot so it can be fixed.`);
  }
}

init();
