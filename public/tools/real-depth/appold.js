import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const degToRad = (d) => d * Math.PI / 180;
const radToDeg = (r) => r * 180 / Math.PI;
const visualAngleDeg = (sizeM, distanceM) => radToDeg(2 * Math.atan(sizeM / (2 * distanceM)));
const sizeFromAngleM = (angleDeg, distanceM) => 2 * distanceM * Math.tan(degToRad(angleDeg) / 2);
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
  addObjectBtn: $('addObjectBtn'),
  resetSceneBtn: $('resetSceneBtn'),
  objectList: $('objectList'),
  objName: $('objName'),
  objTextRow: $('objTextRow'),
  objText: $('objText'),
  sizeLockMode: $('sizeLockMode'),
  objColor: $('objColor'),
  objWidthCm: $('objWidthCm'),
  objHeightCm: $('objHeightCm'),
  objAngleXDeg: $('objAngleXDeg'),
  objAngleYDeg: $('objAngleYDeg'),
  objDistanceM: $('objDistanceM'),
  objXM: $('objXM'),
  objYM: $('objYM'),
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

const DEFAULTS = {
  optics: {
    pupilMm: 4.0,
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
let dofMaterial;
let compositeMaterial;
let rendererBackend = 'unknown';
let supportsDepthTexture = false;

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
    pupilM: clamp(numberValue(els.pupilMm, 4), 1, 9) / 1000,
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

  supportsDepthTexture = renderer.capabilities.isWebGL2 || renderer.extensions.has('WEBGL_depth_texture');
  if (!supportsDepthTexture) {
    els.blurToggle.checked = false;
    els.blurToggle.disabled = true;
    els.blurToggle.title = 'Depth-texture support is unavailable in this browser; the rest of the simulator still works.';
  }

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
  fullScreenScene = new THREE.Scene();
  fullScreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  fullScreenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  fullScreenQuad.frustumCulled = false;
  fullScreenScene.add(fullScreenQuad);

  dofMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uNear: { value: 0.05 },
      uFar: { value: 50.0 },
      uFocusDistance: { value: 1.0 },
      uPupilDiameterM: { value: 0.004 },
      uPixelsPerDegree: { value: 30.0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uMaxBlurPx: { value: 24.0 },
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
      uniform float uNear;
      uniform float uFar;
      uniform float uFocusDistance;
      uniform float uPupilDiameterM;
      uniform float uPixelsPerDegree;
      uniform vec2 uResolution;
      uniform float uMaxBlurPx;
      varying vec2 vUv;

      float depthToDistance(float depth) {
        float viewZ = (uNear * uFar) / ((uFar - uNear) * depth - uFar);
        return max(-viewZ, 0.0001);
      }

      float signedDefocusD(float distanceM) {
        return (1.0 / max(distanceM, 0.0001)) - (1.0 / max(uFocusDistance, 0.0001));
      }

      float blurRadiusPxForDistance(float distanceM) {
        float deltaD = abs(signedDefocusD(distanceM));
        float blurDiameterRad = uPupilDiameterM * deltaD;
        float blurDiameterDeg = blurDiameterRad * 57.2957795131;
        return clamp(0.5 * blurDiameterDeg * uPixelsPerDegree, 0.0, uMaxBlurPx);
      }

      void main() {
        const float FOCUS_TOL_D = 0.002;
        vec4 centerColor = texture2D(tColor, vUv);
        float depth = texture2D(tDepth, vUv).x;
        float z = depthToDistance(depth);
        float centerSignedD = signedDefocusD(z);
        float centerDeltaD = abs(centerSignedD);
        float centerRadiusPx = blurRadiusPxForDistance(z);

        // First build the ordinary gather blur for the surface visible at this
        // pixel. A pixel exactly on the focal plane remains an exact copy.
        vec4 baseColor = centerColor;
        if (centerDeltaD >= FOCUS_TOL_D && centerRadiusPx >= 0.35) {
          vec4 sum = centerColor * 1.5;
          float total = 1.5;

          const int GATHER_SAMPLES = 24;
          for (int i = 0; i < GATHER_SAMPLES; i++) {
            float fi = float(i);
            float angle = fi * 2.399963229728653;
            float radius = sqrt((fi + 0.5) / float(GATHER_SAMPLES));
            vec2 dir = vec2(cos(angle), sin(angle));
            vec2 offsetPx = dir * radius * centerRadiusPx;
            vec2 sampleUv = clamp(vUv + offsetPx / uResolution, vec2(0.0), vec2(1.0));

            float sampleDepth = texture2D(tDepth, sampleUv).x;
            float sampleZ = depthToDistance(sampleDepth);
            float sampleSignedD = signedDefocusD(sampleZ);

            // If the current pixel belongs to an out-of-focus BACKGROUND,
            // don't let an exactly focused foreground object smear outward into
            // it. This is the halo fix from v6. Defocused foreground surfaces
            // are still allowed to contribute; their blur is handled below too.
            bool centerIsBackground = centerSignedD < -FOCUS_TOL_D;
            bool sampleIsFocused = abs(sampleSignedD) < FOCUS_TOL_D;
            if (!(centerIsBackground && sampleIsFocused)) {
              float weight = 1.0 - 0.35 * radius;
              sum += texture2D(tColor, sampleUv) * weight;
              total += weight;
            }
          }
          baseColor = sum / total;
        }

        // ----------------------------------------------------------
        // FOREGROUND SCATTER APPROXIMATION
        //
        // A normal gather blur works well inside an out-of-focus
        // object, but cannot make a foreground object blur beyond its
        // original silhouette.
        //
        // For pixels that do NOT themselves belong to a near,
        // out-of-focus surface, search outward for nearby foreground
        // source pixels. If the current pixel lies inside that source
        // pixel's blur circle, allow the foreground color to spread
        // into this pixel.
        // ----------------------------------------------------------

        if (centerSignedD <= FOCUS_TOL_D) {

          vec4 nearSum = vec4(0.0);
          float nearWeight = 0.0;

          const int NEAR_DIRECTIONS = 12;
          const int NEAR_STEPS = 12;

          for (int d = 0; d < NEAR_DIRECTIONS; d++) {

            float angle =
              6.28318530718 *
              (float(d) + 0.5) /
              float(NEAR_DIRECTIONS);

            vec2 dir = vec2(cos(angle), sin(angle));

            // Keep only the strongest foreground source found
            // along each direction.
            float bestWeight = 0.0;
            vec4 bestColor = vec4(0.0);

            for (int s = 1; s <= NEAR_STEPS; s++) {

              float stepNorm =
                float(s) /
                float(NEAR_STEPS);

              // Squared spacing gives us many samples near the
              // silhouette edge, where foreground spreading matters
              // most, while still searching large blur radii.
              float radiusPx =
                stepNorm *
                stepNorm *
                uMaxBlurPx;

              vec2 offsetPx = dir * radiusPx;

              vec2 sampleUv = clamp(
                vUv + offsetPx / uResolution,
                vec2(0.0),
                vec2(1.0)
              );

              float sampleDepth =
                texture2D(tDepth, sampleUv).x;

              float sampleZ =
                depthToDistance(sampleDepth);

              float sampleSignedD =
                signedDefocusD(sampleZ);

              // Positive signed defocus = nearer than fixation.
              if (sampleSignedD > FOCUS_TOL_D) {

                float sourceRadiusPx =
                  blurRadiusPxForDistance(sampleZ);

                // Does this foreground source's blur circle
                // actually reach the current pixel?
                if (
                  sourceRadiusPx >= 0.35 &&
                  radiusPx <= sourceRadiusPx
                ) {

                  float edge =
                    1.0 -
                    radiusPx /
                    max(sourceRadiusPx, 0.001);

                  // Stronger contribution near the source,
                  // smoothly fading toward the edge of the
                  // blur circle.
                  float weight =
                    0.20 +
                    0.80 * edge;

                  if (weight > bestWeight) {
                    bestWeight = weight;
                    bestColor =
                      texture2D(tColor, sampleUv);
                  }
                }
              }
            }

            if (bestWeight > 0.0) {
              nearSum += bestColor * bestWeight;
              nearWeight += bestWeight;
            }
          }

          if (nearWeight > 0.001) {

            vec4 nearColor =
              nearSum / nearWeight;

            // Estimate how much of the current pixel is covered by
            // the foreground blur. The multiplier compensates for
            // the finite number of search directions.
            float coverage = clamp(
              (
                nearWeight /
                float(NEAR_DIRECTIONS)
              ) * 3.0,
              0.0,
              0.90
            );

            baseColor =
              mix(
                baseColor,
                nearColor,
                coverage
              );
          }
        }

        gl_FragColor = baseColor;
      }
    `,
    depthTest: false,
    depthWrite: false,
  });

  compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tMono: { value: null },
      tLeft: { value: null },
      tRight: { value: null },
      uStereo: { value: 0 },
      uHalfShiftUv: { value: 0.0 },
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
      uniform sampler2D tMono;
      uniform sampler2D tLeft;
      uniform sampler2D tRight;
      uniform int uStereo;
      uniform float uHalfShiftUv;
      varying vec2 vUv;

      void main() {
        if (uStereo == 0) {
          gl_FragColor = texture2D(tMono, vUv);
          return;
        }

        vec2 uvL = vec2(clamp(vUv.x + uHalfShiftUv, 0.0, 1.0), vUv.y);
        vec2 uvR = vec2(clamp(vUv.x - uHalfShiftUv, 0.0, 1.0), vUv.y);
        vec4 leftColor = texture2D(tLeft, uvL);
        vec4 rightColor = texture2D(tRight, uvR);
        gl_FragColor = 0.5 * (leftColor + rightColor);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

function disposeRenderTarget(target) {
  if (!target) return;
  if (target.depthTexture) target.depthTexture.dispose();
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
  if (supportsDepthTexture) {
    // UnsignedShort is the broadest depth-texture choice across WebGL 1/2.
    target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedShortType);
    target.depthTexture.format = THREE.DepthFormat;
  }
  return target;
}

function makeColorTarget(width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  return target;
}

function resizeRenderTargets(renderWidth, renderHeight) {
  const same = renderTargets.width === renderWidth && renderTargets.height === renderHeight;
  if (same) return;

  for (const key of ['mono', 'left', 'right', 'monoBlur', 'leftBlur', 'rightBlur']) {
    disposeRenderTarget(renderTargets[key]);
  }

  renderTargets = {
    width: renderWidth,
    height: renderHeight,
    mono: makeSceneTarget(renderWidth, renderHeight),
    left: makeSceneTarget(renderWidth, renderHeight),
    right: makeSceneTarget(renderWidth, renderHeight),
    monoBlur: makeColorTarget(renderWidth, renderHeight),
    leftBlur: makeColorTarget(renderWidth, renderHeight),
    rightBlur: makeColorTarget(renderWidth, renderHeight),
  };
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

function makeTextTexture(text, color) {
  const displayText = String(text || 'A').slice(0, 12);

  const fontSize = 400;
  const fontFamily = 'Arial, Helvetica, sans-serif';
  const fontWeight = '700';

  // Temporary canvas used only to measure the visible text bounds
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  measureCtx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  measureCtx.textAlign = 'left';
  measureCtx.textBaseline = 'alphabetic';

  const metrics = measureCtx.measureText(displayText);

  const left = metrics.actualBoundingBoxLeft;
  const right = metrics.actualBoundingBoxRight;
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;

  const glyphWidth = Math.ceil(left + right);
  const glyphHeight = Math.ceil(ascent + descent);

  // Very small amount of padding prevents antialiased edge pixels
  // from being clipped, while keeping the texture tightly fitted.
  const padding = 4;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, glyphWidth + padding * 2);
  canvas.height = Math.max(1, glyphHeight + padding * 2);

  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = normalizeHexColor(color, '#16191d');

  // Position the actual glyph bounds at the edges of the canvas
  const drawX = padding + left;
  const drawY = padding + ascent;

  ctx.fillText(displayText, drawX, drawY);

  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
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
  line.position.z = 0.003;
  line.scale.set(scale, scale, 1);
  line.renderOrder = 1000;
  line.visible = false;
  return line;
}

function createFlatShapeMesh(type, text, color) {
  if (type === 'letter') {
    const texture = makeTextTexture(text, color);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  }

  const material = new THREE.MeshBasicMaterial({ color: normalizeHexColor(color, '#20252b'), side: THREE.DoubleSide });

  if (type === 'circle') {
    return new THREE.Mesh(new THREE.CircleGeometry(0.5, 64), material);
  }

  if (type === 'triangle') {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.5);
    shape.lineTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.closePath();
    return new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  }

  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
}

function createObjectVisual(obj) {
  const group = new THREE.Group();
  const mesh = createFlatShapeMesh(obj.type, obj.text, obj.color);
  mesh.userData.simObjectId = obj.id;
  mesh.renderOrder = 2;
  group.add(mesh);

  const selectionOutline = makeOutline(0xb36a18, 1.08);
  group.add(selectionOutline);

  obj.group = group;
  obj.pickMesh = mesh;
  obj.selectionOutline = selectionOutline;
  obj.focusOutline = null;
  pickMeshes.push(mesh);
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
  obj.pickMesh = null;
}

function rebuildObjectVisual(obj) {
  removeObjectVisual(obj);
  createObjectVisual(obj);
}

function applyObjectTransform(obj) {
  if (!obj.group) return;
  const room = currentRoom();
  obj.group.position.set(obj.xM, room.eyeHeightM + obj.yM, -obj.distanceM);
  obj.group.scale.set(obj.widthM, obj.heightM, 1);
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

function sanitizeObjectToRoom(obj) {
  const room = currentRoom();
  obj.distanceM = clamp(obj.distanceM, 0.15, Math.max(0.16, room.depthM - 0.05));
  obj.xM = clamp(obj.xM, -room.widthM / 2 + 0.05, room.widthM / 2 - 0.05);
  const minYOffset = 0.05 - room.eyeHeightM;
  const maxYOffset = room.heightM - 0.05 - room.eyeHeightM;
  obj.yM = clamp(obj.yM, minYOffset, maxYOffset);
  obj.widthM = clamp(obj.widthM, 0.001, 5);
  obj.heightM = clamp(obj.heightM, 0.001, 5);
  obj.angleXDeg = clamp(obj.angleXDeg, 0.01, 90);
  obj.angleYDeg = clamp(obj.angleYDeg, 0.01, 90);
  syncObjectDimensions(obj);
}

function newObject({ type = 'letter', text = 'A', name, color = '#111111', distanceM = 1.25, xM = 0, yM = 0, lockMode = 'visual', widthM = 0.05, heightM = 0.05, angleXDeg = 3, angleYDeg = 3 }) {
  const id = state.nextId++;
  const obj = {
    id,
    type,
    text,
    name: name || (type === 'letter' ? text : type[0].toUpperCase() + type.slice(1)),
    color: normalizeHexColor(color, '#111111'),
    distanceM,
    xM,
    yM,
    lockMode,
    widthM,
    heightM,
    angleXDeg,
    angleYDeg,
    group: null,
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

function loadDefaultScene() {
  clearObjects();

  const n = newObject({
    type: 'letter',
    text: 'N',
    name: 'N',
    distanceM: 0.4,
    xM: 0.0,
    yM: 0.0,
    lockMode: 'visual',
    angleXDeg: 3.0,
    angleYDeg: 5.0,
    color: '#111111',
  });

  const x = newObject({
    type: 'letter',
    text: 'X',
    name: 'X',
    distanceM: 2.0,
    xM: 0.30,
    yM: 0.0,
    lockMode: 'visual',
    angleXDeg: 2.5,
    angleYDeg: 4.0,
    color: '#440cde',
  });

  // N starts selected and is the fixation target
  state.selectedId = n.id;
  state.focusedId = n.id;

  applyObjectTransform(n);
  applyObjectTransform(x);

  refreshUi();
  markDirty();
}

function resetAll() {
  els.pupilMm.value = DEFAULTS.optics.pupilMm.toFixed(1);
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
  resizeRenderTargets(renderWidth, renderHeight);

  markDirty();
}

function renderSceneToTarget(cam, target) {
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, cam);
}

function runDof(sourceTarget, destinationTarget, cam, focusDistanceM) {
  const optics = currentOptics();
  dofMaterial.uniforms.tColor.value = sourceTarget.texture;
  dofMaterial.uniforms.tDepth.value = sourceTarget.depthTexture;
  dofMaterial.uniforms.uNear.value = cam.near;
  dofMaterial.uniforms.uFar.value = cam.far;
  dofMaterial.uniforms.uFocusDistance.value = focusDistanceM;
  dofMaterial.uniforms.uPupilDiameterM.value = optics.pupilM;
  dofMaterial.uniforms.uPixelsPerDegree.value = calibration.pixelsPerDegreeCss * renderer.getPixelRatio();
  dofMaterial.uniforms.uResolution.value.set(renderTargets.width, renderTargets.height);
  dofMaterial.uniforms.uMaxBlurPx.value = optics.maxBlurPx * renderer.getPixelRatio();
  fullScreenQuad.material = dofMaterial;
  renderer.setRenderTarget(destinationTarget);
  renderer.clear();
  renderer.render(fullScreenScene, fullScreenCamera);
}

function renderFrame() {
  if (!renderer || !renderTargets.mono) return;

  const room = currentRoom();
  const optics = currentOptics();
  const focus = focusedObject();
  const focusDistanceM = focus ? focus.distanceM : 1.0;

  camera.position.set(0, room.eyeHeightM, 0);
  leftCamera.position.set(-optics.ipdM / 2, room.eyeHeightM, 0);
  rightCamera.position.set(optics.ipdM / 2, room.eyeHeightM, 0);

  // Monocular view: if defocus is enabled, send the DOF result directly to
  // screen. This avoids an extra texture-resampling pass that could make the
  // focused object look slightly softer even though its calculated blur is 0.
  if (!optics.diplopia || !focus) {
    renderSceneToTarget(camera, renderTargets.mono);

    if (optics.blur && focus && supportsDepthTexture) {
      runDof(renderTargets.mono, null, camera, focusDistanceM);
      return;
    }

    compositeMaterial.uniforms.tMono.value = renderTargets.mono.texture;
    compositeMaterial.uniforms.uStereo.value = 0;
    compositeMaterial.uniforms.uHalfShiftUv.value = 0;

    fullScreenQuad.material = compositeMaterial;
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(fullScreenScene, fullScreenCamera);
    return;
  }

  // Binocular / diplopia view.
  renderSceneToTarget(leftCamera, renderTargets.left);
  renderSceneToTarget(rightCamera, renderTargets.right);

  let leftTexture = renderTargets.left.texture;
  let rightTexture = renderTargets.right.texture;
  if (optics.blur && supportsDepthTexture) {
    runDof(renderTargets.left, renderTargets.leftBlur, leftCamera, focusDistanceM);
    runDof(renderTargets.right, renderTargets.rightBlur, rightCamera, focusDistanceM);
    leftTexture = renderTargets.leftBlur.texture;
    rightTexture = renderTargets.rightBlur.texture;
  }

  const focalPxRender = calibration.focalPxCss * renderer.getPixelRatio();
  const focusDisparityPx = focalPxRender * optics.ipdM / focusDistanceM;
  const halfShiftUv = 0.5 * focusDisparityPx / renderTargets.width;

  compositeMaterial.uniforms.tLeft.value = leftTexture;
  compositeMaterial.uniforms.tRight.value = rightTexture;
  compositeMaterial.uniforms.uHalfShiftUv.value = halfShiftUv;
  compositeMaterial.uniforms.uStereo.value = 1;

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
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return;
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
    meta.textContent = `${obj.distanceM.toFixed(2)} m · ${obj.angleXDeg.toFixed(2)}° × ${obj.angleYDeg.toFixed(2)}°`;
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
  els.sizeLockMode.value = obj.lockMode;
  els.objColor.value = normalizeHexColor(obj.color, '#111111');
  els.objWidthCm.value = (obj.widthM * 100).toFixed(2);
  els.objHeightCm.value = (obj.heightM * 100).toFixed(2);
  els.objAngleXDeg.value = obj.angleXDeg.toFixed(3);
  els.objAngleYDeg.value = obj.angleYDeg.toFixed(3);
  els.objDistanceM.value = obj.distanceM.toFixed(3);
  els.objXM.value = obj.xM.toFixed(3);
  els.objYM.value = obj.yM.toFixed(3);

  const room = currentRoom();
  els.objDistanceM.max = Math.max(0.16, room.depthM - 0.05).toFixed(2);
  els.objXM.min = (-room.widthM / 2 + 0.05).toFixed(2);
  els.objXM.max = (room.widthM / 2 - 0.05).toFixed(2);
  els.objYM.min = (0.05 - room.eyeHeightM).toFixed(2);
  els.objYM.max = (room.heightM - 0.05 - room.eyeHeightM).toFixed(2);

  const physicalLocked = obj.lockMode === 'physical';
  els.objWidthCm.disabled = !physicalLocked;
  els.objHeightCm.disabled = !physicalLocked;
  els.objAngleXDeg.disabled = physicalLocked;
  els.objAngleYDeg.disabled = physicalLocked;
  els.objName.disabled = false;
  els.objText.disabled = false;
  els.sizeLockMode.disabled = false;
  els.objColor.disabled = false;
  els.objDistanceM.disabled = false;
  els.objXM.disabled = false;
  els.objYM.disabled = false;
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
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(`${formatSigned(deltaD, 2)} D`, x, labelY + 12);
    }
  });
}

function refreshUi() {
  refreshObjectList();
  refreshSelectedObjectEditor();
  refreshFocusStatus();
  refreshOpticalReadouts();
  drawDepthSchematic();
}

function commitSelectedFromEditor(field) {
  const obj = selectedObject();
  if (!obj) return;

  const room = currentRoom();

  if (field === 'name') {
    obj.name = safeName(els.objName.value, obj.type === 'letter' ? (obj.text || 'Letter') : 'Object');
  } else if (field === 'text' && obj.type === 'letter') {
    obj.text = String(els.objText.value || 'A').slice(0, 12);
    if (!obj.text) obj.text = 'A';
    rebuildObjectVisual(obj);
  } else if (field === 'color') {
    obj.color = normalizeHexColor(els.objColor.value, obj.color || '#111111');
    rebuildObjectVisual(obj);
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
    syncObjectDimensions(obj);
  } else if (field === 'x') {
    obj.xM = clamp(numberValue(els.objXM, obj.xM), -room.widthM / 2 + 0.05, room.widthM / 2 - 0.05);
  } else if (field === 'y') {
    obj.yM = clamp(numberValue(els.objYM, obj.yM), 0.05 - room.eyeHeightM, room.heightM - 0.05 - room.eyeHeightM);
  }

  sanitizeObjectToRoom(obj);
  applyObjectTransform(obj);
  refreshUi();
  markDirty();
}

function addObjectFromControls() {
  const type = els.newObjectType.value;
  const text = safeName(els.newObjectText.value, 'A').slice(0, 12);
  const color = normalizeHexColor(els.newObjectColor.value, '#111111');
  const room = currentRoom();
  const baseDistance = focusedObject()?.distanceM ?? Math.min(1.25, room.depthM * 0.4);
  const offsetIndex = state.objects.length % 5;
  const obj = newObject({
    type,
    text,
    name: type === 'letter' ? text : `${type[0].toUpperCase()}${type.slice(1)} ${state.nextId}`,
    color,
    distanceM: clamp(baseDistance + 0.2 * (offsetIndex - 2), 0.2, room.depthM - 0.1),
    xM: clamp((offsetIndex - 2) * 0.11, -room.widthM / 2 + 0.1, room.widthM / 2 - 0.1),
    yM: 0,
    lockMode: 'visual',
    angleXDeg: 3,
    angleYDeg: 3,
  });
  state.selectedId = obj.id;
  if (!state.focusedId) state.focusedId = obj.id;
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
  for (const el of [els.pupilMm, els.ipdMm, els.maxBlurPx]) {
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

  els.newObjectType.addEventListener('change', () => {
    els.newObjectText.disabled = els.newObjectType.value !== 'letter';
  });
  els.addObjectBtn.addEventListener('click', addObjectFromControls);
  els.resetSceneBtn.addEventListener('click', resetAll);

  els.objName.addEventListener('input', () => commitSelectedFromEditor('name'));
  els.objText.addEventListener('input', () => commitSelectedFromEditor('text'));
  els.sizeLockMode.addEventListener('change', () => commitSelectedFromEditor('lockMode'));
  els.objColor.addEventListener('input', () => commitSelectedFromEditor('color'));
  els.objWidthCm.addEventListener('input', () => commitSelectedFromEditor('widthCm'));
  els.objHeightCm.addEventListener('input', () => commitSelectedFromEditor('heightCm'));
  els.objAngleXDeg.addEventListener('input', () => commitSelectedFromEditor('angleX'));
  els.objAngleYDeg.addEventListener('input', () => commitSelectedFromEditor('angleY'));
  els.objDistanceM.addEventListener('input', () => commitSelectedFromEditor('distance'));
  els.objXM.addEventListener('input', () => commitSelectedFromEditor('x'));
  els.objYM.addEventListener('input', () => commitSelectedFromEditor('y'));
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
}

function validateWebGL() {
  if (renderer.capabilities.isWebGL2) {
    showViewportMessage('');
    return;
  }

  if (supportsDepthTexture) {
    showViewportMessage('Running in WebGL 1 compatibility mode. Core simulation, defocus blur, and diplopia are available, although WebGL 2 is preferred.');
  } else {
    showViewportMessage('Running in WebGL 1 compatibility mode. This browser does not expose depth textures, so defocus blur has been disabled; scene geometry and diplopia still work.');
  }
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
