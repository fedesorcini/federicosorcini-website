# Real Depth Simulator — Static-layout edition

The Real Depth Simulator is a browser-based tool for visualizing visual angle, defocus blur, and relative binocular disparity for stimuli at different simulated distances. This edition preserves the existing Three.js simulator and editor while moving its final page layout out of JavaScript and into the initial HTML and CSS.

## Deployment

Copy these files into your Astro project's `public/tools/real-depth/` folder:

- `index.html` — complete, final page markup (including disclosure sections and scene action buttons).
- `style.css` — theme, responsive layout, disclosure styling, and scene action controls.
- `app.js` — unchanged rendering/optics core, interactions, and save/load logic; a smaller startup routine.

**Keep your existing `public/tools/real-depth/images/` folder.** The current code references `apple.png`, `mug.png`, `stapler.png`, and `banana.png` in that location. These image files were not included in the supplied materials and are not bundled here.

The built-in **Back to Tools** link goes to `/tools/`. Open the simulator at `/tools/real-depth/index.html` on your website.

The project uses JavaScript ES modules with **Three.js r162** imported from jsDelivr, so a browser needs access to the CDN. When testing locally, use a development server (e.g., `python3 -m http.server 8000` from the containing directory), not a `file://` URL.

## Layout (visible immediately, before JS executes)

The left panel starts with **Add object**, followed by **Optics**, **Display calibration**, and **Room Options**. The latter three sections start collapsed.

The center contains the simulated viewport with **Reset / Clear / Save / Load** immediately underneath, followed by the depth schematic.

The right panel starts with **Selected object** (with Duplicate and Delete), then **Objects**, then **Optical readout**.

All panel positions, scene-action buttons, and stimulus-specific input fields are now authored in `index.html`. The stylesheet controlling them is loaded before JavaScript. The simulator no longer moves panels, creates those buttons, builds those inputs, or injects a second stylesheet at startup. The collapsible headers are simply wired to their preexisting contents.

## Working with the simulator

- Choose a stimulus category (Text, Shapes, Vision science stimuli, Images), adjust its properties, and click **Add object**.
- Select an object in the room or the Objects list. Edit its appearance, orientation, dimensions, visual angle, and depth in the Selected object panel.
- Change the focus by choosing **Set selected object as focus**.
- Control simulated defocus and overlaid binocular views under Optics. The public build fixes pupil diameter at **4.0 mm**; the original hidden pupil input remains in the code for a future option.
- **Reset** restores the original scene and settings; **Clear** removes all objects; **Save** exports the current scene as a JSON file; **Load** imports an exported scene JSON file.
- Select **Lock physical size** or **Lock visual angle** to determine which size representation remains fixed as depth changes.
- The viewport's focused objects are rendered without a permanent outline, and image/stimulus appearance is preserved.

## Scientific notes

The nominal visual angle of a stimulus of size `s` viewed at distance `z` is `2 atan(s/(2z))`. For small angles, relative disparity scales with `IPD × (1/z_object − 1/z_focus)` and blur diameter scales approximately with pupil diameter times the absolute dioptric difference. The simulator estimates retinal image appearance, **not actual accommodation changes**: a conventional monitor remains at one physical viewing distance. Its binocular composite overlays both eye images on one display rather than sending separate images to each eye.

The display-width and viewing-distance inputs help calibrate visual angle. For research use, verify browser zoom, monitor calibration, and the limits of the rendering approximation.

## Maintenance / checks

The HTML and CSS now represent the final visible state independently of module loading. The refactor leaves the simulator's computational/graphics, stimulus, and JSON persistence functions intact. Static checks verify all DOM IDs referenced by JavaScript exist, that no IDs are duplicated, and that the module parses. Browser checks cover initial layout, disclosure toggles, category switching, and responsive widths. Full GPU/WebGL integration requires opening the site in a browser with the Three.js CDN available.
