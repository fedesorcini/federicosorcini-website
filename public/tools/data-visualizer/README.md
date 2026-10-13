# Data Visualization Studio — version 1.2

A browser-only, no-build, no-backend visualization tool for CSV-based repeated-measures data, intended for use alongside the One-Sample t-Test and Real Depth simulators.

## Installation

Drop this folder under your Astro site's `public/tools/data-visualization-studio/`, then add a link to `/tools/data-visualization-studio/` on your Tools page. Open `index.html` in a browser to test locally. All CSV analysis runs in the browser; your data is not uploaded anywhere.

## Features

- Upload CSV (supports quoted text, embedded newlines, and comma, tab, or semicolon separation) or try generated sample data.
- Choose the subject/participant column and one numeric measure.
- Choose mean, sample SD, sample variance, minimum, maximum, or median across participant-wise condition means.
- For means, add optional SD, SEM, or normal-approximation 95% CI error bars.
- Add grouping factors; reorder factors by moving their cards or by clicking their arrows.
- **Reorder factor levels** with the up/down arrows beside each individual level. Both graph order and legend order update immediately.
- Give each factor a visual role: color, opacity, fill pattern, or position only. Customize each individual level. Bars default to solid black unless a color factor is explicitly assigned (opacity and fill still apply to black).
- Filter rows with pivot-style column-value checkboxes and a searchable value list.
- Animate bars splitting apart as a factor is added or merging when it is removed; replay the most recent transition.
- **Responsive chart geometry:** bar widths and gaps contract before horizontal scrolling is necessary; a 14 px minimum width maintains legibility.
- **Full labels:** long x-axis group values are wrapped or steeply rotated as needed instead of truncated with ellipses.
- Export standalone SVG, 2x PNG, and data summary CSV.

## Files

`index.html`, `style.css`, `app.js`, and `example_data.csv`. A one-file portable HTML build is also provided outside this folder.

## Aggregation policy

Raw observations are first aggregated within each participant × full selected factor combination. The selected descriptive statistic summarizes these participant means (rather than pooling all trials). Each factor combination can have a different participant count due to missing data. Sample SD is calculated with n−1 in the denominator. Variance is its square. For the mean, SEM = SD / sqrt(n) and 95% CI = ±1.96 SEM (a normal approximation); error bars are unavailable for other statistics.

When removing a factor, raw data are **reaggregated** at the new lower-dimensional participant level, so results can properly change when trial counts are unbalanced.

## Browser notes

Rendering up to 350 factor combinations is supported. The app works in modern Chrome, Safari, Firefox, and Edge. It uses Google Fonts for PT Serif (with local Georgia/serif fallback); all charting is native SVG and all data processing is local JavaScript.


### v1.3 layout improvements
- Data upload, measure & design, and factor sections can be expanded or collapsed by clicking their headings.
- Factor cards independently collapse/expand without changing the factor settings.
- Factors now occupy a right sidebar; data, design, and filters stay on the left.
- Narrower left/right controls create more space for the chart on desktop; responsive layouts stack on smaller screens.
