ONE-SAMPLE t-TEST SIMULATOR — STATIC WEB VERSION

Place this entire folder at:
  public/tools/p-value-simulator/

It will then be available at:
  /tools/p-value-simulator/

Files:
  index.html      page markup
  style.css       styling matching the Real Depth Simulator palette/layout
  app.js          UI, validation, histogram rendering, responsive behavior
  worker.js       simulation engine running off the main browser thread
  stats-core.js   Student t distribution + one-sample t-test math

No R server and no npm build step are required. The simulation runs entirely
in the browser. Open through your Astro dev server rather than double-clicking
index.html, because web workers require an HTTP(S) origin.
