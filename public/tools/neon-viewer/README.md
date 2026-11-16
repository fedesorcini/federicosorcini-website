# Neon Eye & Head Viewer — static website release

A ready-to-upload, standalone browser app matched to the Real Depth Simulator theme.

## Install on federicosorcini.com

If your site is Astro (as with the existing Real Depth Simulator):

1. Create `public/tools/neon-viewer/` in your website project.
2. Put the included `index.html` into that directory. No npm build, framework, backend, or external JS package is necessary for the viewer.
3. Optionally add a link on your tools index page:
   `<a href="/tools/neon-viewer/">Neon Eye &amp; Head Viewer</a>`
4. Commit and deploy your site using its usual hosting workflow. Visit `https://federicosorcini.com/tools/neon-viewer/` and verify the viewer loads.

The "Back to Tools" navigation points to `/tools/`. If you publish under another URL, only the tools-index link needs updating.

## Inputs and workflow

Use locally selected raw Pupil Labs exports from **the same recording and section**:

- `3d_eye_states.csv` — master timeline, both optical axes, pupils, eyelids
- `imu.csv` — quaternions and gyroscope values
- `fixations.csv` — intervals and fixation IDs
- video — ideally H.264/AAC MP4 for broad browser compatibility; MOV support depends on codec/browser

After all three CSVs load, rows are aligned in the browser. The eye timestamp is the master clock; each eye row receives the most recent IMU sample with timestamp <= eye timestamp. Fixation labels are assigned by overlap with the fixation time interval. Set a baseline frame to make that frame's head direction 0°, then align the video by picking a corresponding moment and clicking "Align to selected row". A merged CSV can be exported.

## Data safety and dependencies

- **No participant recordings, CSVs, or videos are included in this release.**
- The app processes local files in the visitor's browser and does not send recordings to your site or an API.
- The interface requests the PT Serif font from Google Fonts when the user is online; Georgia is the built-in fallback. If you require strict no-external-request operation, remove the three Google Fonts `<link>` tags from `index.html` and use the Georgia fallback, or serve a licensed webfont yourself.
- All app CSS and JavaScript are included in `index.html`; there is no bundler or runtime dependency.
- Large raw exports can require substantial browser memory. Prefer desktop Chrome/Edge for very long recordings.
- The static website itself still follows any analytics / logs / policies configured for your website host.

## Scientific caveats

- The top-down body is a fixed schematic, not a measured body-position estimate.
- Fused IMU heading can be affected by magnetic calibration; raw gyroscope integration can drift over time. Source selection is available in Settings.
- Eye arrows show optical axes, not the independently calibrated visual gaze ray.
- Vergence distance is an **approximate** intersection of optical axes in the horizontal plane using an adjustable IPD defaulting to 64 mm, not an exact binocular fixation depth.
- Scene video is not automatically synchronized to CSV timestamps: one user-selected alignment moment is required.
- Lens undistortion and video gaze-dot overlays are **not implemented in this release**; they are possible future improvements and require further calibration/gaze inputs.

## Smoke test checklist

- Open `/tools/neon-viewer/` and confirm the page loads without uploads.
- Confirm metric row one shows **head rotation, fixation ID, vergence distance** and row two shows **left eye, right eye, left pupil, right pupil**.
- Upload a matched three-file recording and verify an aligned-samples count.
- Set a new baseline and confirm head rotation becomes `0.0°` at that frame.
- Upload a video and use **Align to selected row**; verify Play/Pause and manual scrub.
- Export the aligned CSV and confirm the downloaded file has the expected headers.

Release: November 2026.
