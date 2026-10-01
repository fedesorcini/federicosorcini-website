# Real Depth Simulator

A browser-based visual simulator for exploring how objects at different physical depths change in:

- visual angle / physical size
- dioptric distance
- defocus blur relative to a selected focal plane
- binocular disparity relative to a selected fixation depth

The app renders a simple gray room and lets you add letters/text, squares, circles, and triangles. A selected object can be designated as the focus target. Defocus blur and simulated diplopia can be toggled independently.

## 1. Run it

This project uses JavaScript ES modules, so the reliable way to run it is from a tiny local web server rather than double-clicking `index.html`.

### macOS / Linux

Open Terminal, change into this folder, and run:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Stop the server with `Control-C` in Terminal.

### Windows

If Python is installed:

```powershell
py -m http.server 8000
```

Then open `http://localhost:8000`.

### VS Code alternative

Open the folder in VS Code and use a local-server extension such as Live Server. The code itself does not require Node, npm, or a build step.

## 2. Files

- `index.html` — application layout and controls
- `style.css` — interface styling
- `app.js` — all scene rendering, geometry, optics calculations, blur shader, stereo rendering, and interactions

The app currently imports Three.js 0.162.0 from jsDelivr, so the browser needs internet access when loading the app unless you later install/host Three.js locally.

## 3. How to use it

1. Enter display width and viewing distance in **Display calibration**.
2. Keep browser zoom at 100% for meaningful visual-angle calibration.
3. Add or select an object.
4. Choose a sizing mode:
   - **Lock physical size**: moving the object in depth changes its visual angle.
   - **Lock visual angle**: moving the object in depth automatically changes physical size so retinal angle stays constant.
5. Click **Set selected object as focus**.
6. Toggle **Defocus blur** and/or **Diplopia**.
7. Change pupil diameter to see how the modeled blur circle changes.
8. Change IPD to see how binocular disparity changes.

The right-side optical readout reports the selected object's values relative to the focused object.

## 4. Geometry

For an object of physical size `s` at distance `z`, nominal visual angle is

```text
theta = 2 atan(s / (2z))
```

Conversely, for a target visual angle `theta`, physical size is

```text
s = 2 z tan(theta / 2)
```

This is applied separately to width and height.

## 5. Defocus model

Dioptric distance is

```text
D = 1 / z
```

where `z` is in meters.

Relative defocus is

```text
DeltaD = 1 / z_object - 1 / z_focus
```

The app uses the small-angle circle-of-confusion approximation

```text
blur diameter in radians ~= pupil diameter in meters * abs(DeltaD)
```

That angular blur diameter is converted into rendered pixels using the calibrated pixels-per-degree value. A GPU post-processing shader then applies a disk-like blur whose radius changes for every pixel according to that pixel's depth.

The `Max rendered blur radius` setting caps the shader radius for performance and to prevent enormous defocus values from covering the entire image. It does not change the numerical optical readout.

## 6. Binocular disparity / diplopia model

For small angles, relative binocular disparity can be approximated as

```text
delta ~= IPD * (1 / z_object - 1 / z_focus)
```

The app does something slightly better than simply shifting each object by that formula. It renders the **entire scene twice**, once from a left-eye camera and once from a right-eye camera separated by the specified IPD. The two rendered images are translated so the selected focus plane is aligned, then overlaid at 50/50 opacity.

This means surfaces such as the floor, walls, and all objects acquire depth-dependent image separation automatically.

## 7. Important scientific limitation

This is a **retinal-image simulation**, not true real-depth optics on a conventional monitor.

The monitor remains at one physical distance, so the observer's actual accommodation demand remains approximately the monitor distance. The application can simulate what defocus blur and left/right image separation would look like, but it cannot make the crystalline lens accommodate to a virtual 0.5 m object and then a virtual 2 m object.

Similarly, the diplopia mode overlays the left- and right-eye images on one display. For genuine binocular presentation, each eye would need its own image through a stereoscopic monitor, shutter/polarized system, or VR headset.

## 8. Calibration caveats

The display calibration estimates physical viewport size from:

- the display's physical width entered by the user
- JavaScript's reported screen width
- the rendered viewport's CSS width/height
- the entered viewing distance

For a research experiment, improve this with an on-screen ruler calibration step where the user adjusts a displayed line until it matches a physical ruler or credit-card-sized reference. You should also control browser zoom, OS display scaling, monitor, viewing distance, and preferably head position.

## 9. Where to improve it for research use

Recommended next upgrades:

1. Add a ruler/card calibration screen instead of relying only on reported screen width.
2. Add JSON save/load for exact scene configurations.
3. Add trial definitions and randomized conditions.
4. Add fixation cross and stimulus timing controls.
5. Hide all editor outlines during stimulus presentation.
6. Add keyboard-response logging and CSV export.
7. Add stereo/VR output if you need true eye-specific disparity.
8. Validate the blur implementation against a more complete optical point-spread-function model if quantitative retinal blur is a primary independent variable.
9. If experimental timing is critical, integrate the scene into a framework such as PsychoPy/PsychoJS or another timing-validated experimental environment.

## 10. Code notes

The application uses a render-on-change loop rather than continuously redrawing the scene, which keeps GPU use modest while the scene is static.

All world distances are stored in meters. The observer sits at `z = 0` and looks toward negative `z`; an object at 2 m therefore has a world z coordinate of `-2`.


## Compatibility build

This revision intentionally uses Three.js r162 because it supports both WebGL 2 and WebGL 1. The simulator first requests WebGL 2 and automatically falls back to WebGL 1 when necessary. If WebGL 1 is available without the depth-texture extension, defocus rendering is disabled but the 3D scene and binocular disparity simulation remain usable.


## v5 refinement
- Focused objects no longer have a permanent viewport outline.
- In monocular mode, the focal plane bypasses the extra post-processing resample, so toggling defocus should not soften the focused object.
- A 0.002 D tolerance protects the focal plane from depth-buffer quantization artifacts.

## v6 focal-plane halo fix

The defocus shader is now depth-aware at the fixation plane. When an out-of-focus pixel is blurred, samples that belong to the in-focus plane are excluded from that blur kernel. This prevents the sharp focused object from being smeared outward into the blurred background as a glow or shadow.

## v7 foreground defocus refinement

The depth-of-field shader now handles near and far defocus asymmetrically. A defocused foreground object is allowed to spread outside its original silhouette using a near-field scatter approximation, while the v6 protection against a sharp focused foreground object bleeding into an out-of-focus background remains in place.
