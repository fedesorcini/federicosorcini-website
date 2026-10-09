'use strict';

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const els = {
  simLayout: $('simLayout'),
  sidebarPane: $('sidebarPane'),
  resizeHandle: $('resizeHandle'),
  runSimulation: $('runSimulation'),
  runProgressWrap: $('runProgressWrap'),
  runProgressBar: $('runProgressBar'),
  runProgressText: $('runProgressText'),
  validationMessage: $('validationMessage'),
  population: $('population'),
  alternative: $('alternative'),
  sampleN: $('sampleN'),
  populationSd: $('populationSd'),
  nStudies: $('nStudies'),
  effectD: $('effectD'),
  effectDValue: $('effectDValue'),
  alpha: $('alpha'),
  alphaValue: $('alphaValue'),
  showNullRow: $('showNullRow'),
  showNull: $('showNull'),
  optionalStopping: $('optionalStopping'),
  optionalStoppingOptions: $('optionalStoppingOptions'),
  maxP: $('maxP'),
  increaseN: $('increaseN'),
  maxN: $('maxN'),
  maxIncreases: $('maxIncreases'),
  outlierRemoval: $('outlierRemoval'),
  outlierOptions: $('outlierOptions'),
  pBinwidth: $('pBinwidth'),
  pXmin: $('pXmin'),
  pXmax: $('pXmax'),
  estimateBinwidth: $('estimateBinwidth'),
  estimateXmin: $('estimateXmin'),
  estimateXmax: $('estimateXmax'),
  emptyState: $('emptyState'),
  resultsArea: $('resultsArea'),
  pHistogram: $('pHistogram'),
  estimateHistogram: $('estimateHistogram'),
};

let worker = null;
let lastRun = null;
let running = false;

function numberValue(input, fallback = NaN) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function parseOptionalNumber(input, fieldName) {
  const raw = input.value.trim();
  if (raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a number or left blank.`);
  return value;
}

function setValidation(message = '') {
  els.validationMessage.textContent = message;
  els.validationMessage.hidden = !message;
}

function getSelectedOutlierCutoffs() {
  return Array.from(document.querySelectorAll('input[name="outlierCutoff"]:checked'))
    .map((input) => Number(input.value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function getHistScale() {
  return document.querySelector('input[name="histScale"]:checked')?.value || 'proportion';
}

function updateConditionalControls() {
  const effectD = numberValue(els.effectD, 0);
  els.showNullRow.hidden = Math.abs(effectD) <= Number.EPSILON;
  els.optionalStoppingOptions.hidden = !els.optionalStopping.checked;
  els.outlierOptions.hidden = !els.outlierRemoval.checked;
  els.effectDValue.textContent = effectD.toFixed(1);
  els.alphaValue.textContent = numberValue(els.alpha, 0.05).toFixed(3);
}

function validateAndCollectParameters() {
  const initialN = Math.round(numberValue(els.sampleN));
  const populationSd = numberValue(els.populationSd);
  const nStudies = Math.round(numberValue(els.nStudies));
  const effectD = numberValue(els.effectD);
  const alpha = numberValue(els.alpha);

  if (!(initialN >= 2)) throw new Error('N must be at least 2.');
  if (!(populationSd > 0)) throw new Error('sd must be greater than 0.');
  if (!(nStudies >= 100)) throw new Error('Studies must be at least 100.');
  if (!(alpha >= 0.001 && alpha <= 0.10)) throw new Error('Alpha must be between .001 and .10.');
  if (els.population.value !== 'normal') throw new Error('Only the normal population distribution is currently implemented.');

  const optionalStopping = els.optionalStopping.checked;
  const outlierRemoval = els.outlierRemoval.checked;
  const outlierSdCutoffs = getSelectedOutlierCutoffs();

  if (outlierRemoval && outlierSdCutoffs.length === 0) {
    throw new Error('Select at least one SD cutoff for outlier removal.');
  }

  let maxP = 1;
  let maxN = Infinity;
  let increaseN = 10;
  let maxIncreases = 0;

  if (optionalStopping) {
    const maxPEntered = parseOptionalNumber(els.maxP, 'Max p');
    const maxNEntered = parseOptionalNumber(els.maxN, 'Max n');
    increaseN = Math.round(numberValue(els.increaseN));
    maxIncreases = Math.round(numberValue(els.maxIncreases));

    if (!(increaseN >= 1)) throw new Error('Increase n must be at least 1.');
    if (!(maxIncreases >= 0)) throw new Error('Max increases cannot be negative.');
    if (maxPEntered !== null && !(maxPEntered >= 0 && maxPEntered <= 1)) {
      throw new Error('Max p must be between 0 and 1, or left blank.');
    }
    if (maxNEntered !== null && !(maxNEntered >= initialN)) {
      throw new Error('Max n must be at least the initial N, or left blank.');
    }

    if (maxPEntered !== null) maxP = maxPEntered;
    if (maxNEntered !== null) maxN = Math.round(maxNEntered);
  }

  return {
    population: els.population.value,
    alternative: els.alternative.value,
    initialN,
    populationSd,
    nStudies,
    effectD,
    alpha,
    optionalStopping,
    increaseN,
    maxN,
    maxIncreases,
    maxP,
    outlierRemoval,
    outlierSdCutoffs,
    hasFlexibility: optionalStopping || outlierRemoval,
  };
}

function validateGraphControls() {
  const pXmin = numberValue(els.pXmin);
  const pXmax = numberValue(els.pXmax);
  const estimateXmin = numberValue(els.estimateXmin);
  const estimateXmax = numberValue(els.estimateXmax);
  const pBinwidth = numberValue(els.pBinwidth);
  const estimateBinwidth = numberValue(els.estimateBinwidth);

  if (!(pXmin < pXmax)) throw new Error('P-value x-axis minimum must be smaller than the maximum.');
  if (!(estimateXmin < estimateXmax)) throw new Error('Effect-estimate x-axis minimum must be smaller than the maximum.');
  if (!(pBinwidth > 0)) throw new Error('P-value histogram bar width must be greater than 0.');
  if (!(estimateBinwidth > 0)) throw new Error('Effect-estimate histogram bar width must be greater than 0.');

  return { pXmin, pXmax, estimateXmin, estimateXmax, pBinwidth, estimateBinwidth };
}

function setRunning(isRunning) {
  running = isRunning;
  els.runSimulation.disabled = isRunning;
  els.runSimulation.textContent = isRunning ? 'Running…' : 'Run simulation';
  els.runProgressWrap.hidden = !isRunning;
  if (!isRunning) {
    els.runProgressBar.style.width = '0%';
    els.runProgressText.textContent = 'Running simulation… 0%';
  }
}

function updateProgress(value) {
  const pct = clamp(Math.round(value * 100), 0, 100);
  els.runProgressBar.style.width = `${pct}%`;
  els.runProgressText.textContent = `Running simulation… ${pct}%`;
}

function startSimulation() {
  if (running) return;
  setValidation('');

  let params;
  try {
    params = validateAndCollectParameters();
    validateGraphControls();
  } catch (error) {
    setValidation(error.message);
    return;
  }

  if (worker) worker.terminate();
  worker = new Worker('./worker.js');
  setRunning(true);
  updateProgress(0);

  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'progress') {
      updateProgress(message.value);
      return;
    }
    if (message.type === 'error') {
      setRunning(false);
      setValidation(`Simulation error: ${message.message}`);
      console.error(message.stack || message.message);
      return;
    }
    if (message.type === 'done') {
      lastRun = message.result;
      setRunning(false);
      els.emptyState.hidden = true;
      els.resultsArea.hidden = false;
      renderPlots();
    }
  };

  worker.onerror = (event) => {
    setRunning(false);
    setValidation(`Simulation error: ${event.message || 'Worker failed.'}`);
  };

  worker.postMessage({ type: 'run', params });
}

function groupsForPlot() {
  if (!lastRun) return [];
  const p = lastRun.params;
  const nonzeroEffect = Math.abs(p.effectD) > Number.EPSILON;

  // Matches the source Shiny app exactly: the null comparison can be hidden
  // for a nonzero effect only when optional stopping is OFF.
  if (nonzeroEffect && !p.optionalStopping && !els.showNull.checked) {
    return lastRun.groups.filter((group) => Math.abs(group.effectD) > Number.EPSILON);
  }
  return lastRun.groups;
}

function groupMetric(group, alpha) {
  let rejected = 0;
  for (const p of group.pValues) if (p < alpha) rejected += 1;
  return rejected / group.pValues.length;
}

function niceStep(rawStep) {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const fraction = rawStep / power;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * power;
}

function niceTicks(min, max, target = 6) {
  if (!(max > min)) return [min];
  const step = niceStep((max - min) / Math.max(1, target - 1));
  const first = Math.ceil(min / step - 1e-12) * step;
  const ticks = [];
  for (let value = first; value <= max + step * 1e-9 && ticks.length < 100; value += step) {
    ticks.push(Math.abs(value) < step * 1e-12 ? 0 : value);
  }
  return ticks;
}

function formatTick(value, span) {
  const absSpan = Math.abs(span);
  if (absSpan <= 0.02) return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (absSpan <= 0.2) return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  if (absSpan <= 2) return value.toFixed(1).replace(/\.0$/, '');
  if (Math.abs(value) >= 10000) return value.toExponential(1);
  return Number(value.toPrecision(5)).toString();
}

function buildHistogram(values, binwidth, kind) {
  let minValue;
  let maxValue;
  let start;

  if (kind === 'p') {
    minValue = 0;
    maxValue = 1;
    start = 0;
  } else {
    minValue = Infinity;
    maxValue = -Infinity;
    for (const value of values) {
      if (value < minValue) minValue = value;
      if (value > maxValue) maxValue = value;
    }
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      minValue = -binwidth;
      maxValue = binwidth;
    }
    // ggplot2's default alignment (when neither center nor boundary is
    // supplied) centers a bin on zero, i.e. boundaries fall at width/2 + k*width.
    const boundary = binwidth / 2;
    start = Math.floor((minValue - boundary) / binwidth) * binwidth + boundary;
  }

  const end = kind === 'p'
    ? 1 + binwidth * 1e-9
    : Math.ceil(maxValue / binwidth) * binwidth + binwidth;
  const count = Math.max(1, Math.ceil((end - start) / binwidth));
  const bins = new Float64Array(count);

  for (const value of values) {
    let index = Math.floor((value - start) / binwidth);
    if (value === start + count * binwidth) index = count - 1;
    if (index >= 0 && index < count) bins[index] += 1;
  }

  return { start, binwidth, bins };
}

function esc(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function histogramSvg(group, options) {
  const values = options.kind === 'p' ? group.pValues : group.estimates;
  const hist = buildHistogram(values, options.binwidth, options.kind);
  const proportion = options.histScale === 'proportion';
  const divisor = proportion ? values.length : 1;

  let yMax = 0;
  for (const count of hist.bins) yMax = Math.max(yMax, count / divisor);
  if (!(yMax > 0)) yMax = 1;
  yMax *= 1.08;

  const W = 620;
  const H = 390;
  const M = { left: 78, right: 24, top: 24, bottom: 58 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const xSpan = options.xmax - options.xmin;
  const xScale = (x) => M.left + ((x - options.xmin) / xSpan) * plotW;
  const yScale = (y) => M.top + plotH - (y / yMax) * plotH;

  const xTicks = niceTicks(options.xmin, options.xmax, 8);
  const yTicks = niceTicks(0, yMax, 6);
  const metric = groupMetric(group, lastRun.params.alpha);
  const metricName = Math.abs(group.effectD) <= Number.EPSILON ? 'FP' : 'Power';
  const metricLine1 = `${metricName}: ${metric.toFixed(3)}`;
  const metricLine2 = `Alpha: ${lastRun.params.alpha.toFixed(3)}`;

  const parts = [];
  parts.push(`<svg class="histogram-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(options.ariaLabel)}">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#F0E8D8"/>`);
  parts.push(`<defs><clipPath id="clip-${options.uid}"><rect x="${M.left}" y="${M.top}" width="${plotW}" height="${plotH}"/></clipPath></defs>`);

  for (const tick of yTicks) {
    const y = yScale(tick);
    parts.push(`<line x1="${M.left}" x2="${M.left + plotW}" y1="${y}" y2="${y}" stroke="#C8BBA5" stroke-width="1"/>`);
    parts.push(`<text x="${M.left - 10}" y="${y + 5}" text-anchor="end" font-size="14" font-family="PT Serif, Georgia, serif" fill="#28343D">${esc(formatTick(tick, yMax))}</text>`);
  }

  for (const tick of xTicks) {
    const x = xScale(tick);
    parts.push(`<line x1="${x}" x2="${x}" y1="${M.top}" y2="${M.top + plotH}" stroke="#C8BBA5" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${M.top + plotH + 24}" text-anchor="middle" font-size="14" font-family="PT Serif, Georgia, serif" fill="#28343D">${esc(formatTick(tick, xSpan))}</text>`);
  }

  parts.push(`<g clip-path="url(#clip-${options.uid})">`);

  if (options.kind === 'p') {
    const shadeLeft = xScale(0);
    const shadeRight = xScale(lastRun.params.alpha);
    parts.push(`<rect x="${Math.min(shadeLeft, shadeRight)}" y="${M.top}" width="${Math.abs(shadeRight - shadeLeft)}" height="${plotH}" fill="#324C63" opacity="0.10"/>`);
  }

  for (let i = 0; i < hist.bins.length; i += 1) {
    const x0 = hist.start + i * hist.binwidth;
    const x1 = x0 + hist.binwidth;
    if (x1 < options.xmin || x0 > options.xmax) continue;
    const yValue = hist.bins[i] / divisor;
    const bx0 = xScale(x0);
    const bx1 = xScale(x1);
    const by = yScale(yValue);
    const bw = Math.max(0.35, bx1 - bx0);
    const bh = Math.max(0, M.top + plotH - by);
    parts.push(`<rect x="${bx0}" y="${by}" width="${bw}" height="${bh}" fill="#324C63" stroke="#FFFFFF" stroke-width="0.35"/>`);
  }

  const refX = options.kind === 'p' ? lastRun.params.alpha : 0;
  if (refX >= options.xmin && refX <= options.xmax) {
    const x = xScale(refX);
    parts.push(`<line x1="${x}" x2="${x}" y1="${M.top}" y2="${M.top + plotH}" stroke="#28343D" stroke-width="1.6" stroke-dasharray="7 5"/>`);
  }

  parts.push('</g>');

  parts.push(`<line x1="${M.left}" x2="${M.left}" y1="${M.top}" y2="${M.top + plotH}" stroke="#28343D" stroke-width="1"/>`);
  parts.push(`<line x1="${M.left}" x2="${M.left + plotW}" y1="${M.top + plotH}" y2="${M.top + plotH}" stroke="#28343D" stroke-width="1"/>`);

  const yLabel = proportion ? 'Proportion of studies' : 'Count of studies';
  parts.push(`<text transform="translate(20 ${M.top + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="17" font-family="PT Serif, Georgia, serif" fill="#28343D">${esc(yLabel)}</text>`);

  const labelW = 130;
  const labelH = 62;
  const labelX = M.left + plotW - labelW - 7;
  const labelY = M.top + 7;
  parts.push(`<rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" rx="4" fill="#FFFFFF" stroke="#777" stroke-width="0.7"/>`);
  parts.push(`<text x="${labelX + 10}" y="${labelY + 23}" font-size="15" font-family="PT Serif, Georgia, serif" fill="#28343D">${esc(metricLine1)}</text>`);
  parts.push(`<text x="${labelX + 10}" y="${labelY + 45}" font-size="15" font-family="PT Serif, Georgia, serif" fill="#28343D">${esc(metricLine2)}</text>`);

  parts.push('</svg>');
  return parts.join('');
}

function renderHistogramGrid(container, kind, graphConfig) {
  const groups = groupsForPlot();
  container.innerHTML = '';
  if (!groups.length) return;

  const hasFlexibility = lastRun.params.hasFlexibility;
  container.classList.toggle('flex-layout', hasFlexibility);

  const scenarioOrder = [...new Set(groups.map((g) => g.scenario))];
  const modeOrder = [...new Set(groups.map((g) => g.analysisMode))];
  const orderedGroups = [];

  if (hasFlexibility) {
    for (const scenario of scenarioOrder) {
      for (const mode of modeOrder) {
        const group = groups.find((g) => g.scenario === scenario && g.analysisMode === mode);
        if (group) orderedGroups.push(group);
      }
    }
  } else {
    for (const scenario of scenarioOrder) {
      const group = groups.find((g) => g.scenario === scenario);
      if (group) orderedGroups.push(group);
    }
  }

  orderedGroups.forEach((group, index) => {
    const cell = document.createElement('div');
    cell.className = 'facet-cell';
    const strip = document.createElement('div');
    strip.className = 'facet-strip';

    const mode = document.createElement('span');
    mode.textContent = group.analysisMode;
    const scenario = document.createElement('span');
    scenario.className = 'scenario-label';
    scenario.textContent = group.scenario;
    strip.append(mode, scenario);
    cell.appendChild(strip);

    const uid = `${kind}-${index}-${Date.now().toString(36)}`;
    cell.insertAdjacentHTML('beforeend', histogramSvg(group, {
      kind,
      uid,
      histScale: graphConfig.histScale,
      binwidth: kind === 'p' ? graphConfig.pBinwidth : graphConfig.estimateBinwidth,
      xmin: kind === 'p' ? graphConfig.pXmin : graphConfig.estimateXmin,
      xmax: kind === 'p' ? graphConfig.pXmax : graphConfig.estimateXmax,
      ariaLabel: `${kind === 'p' ? 'P-value' : 'Sample mean'} histogram: ${group.scenario}, ${group.analysisMode}`,
    }));
    container.appendChild(cell);
  });
}

function renderPlots() {
  if (!lastRun) return;
  setValidation('');
  let graphConfig;
  try {
    graphConfig = { ...validateGraphControls(), histScale: getHistScale() };
  } catch (error) {
    setValidation(error.message);
    return;
  }

  renderHistogramGrid(els.pHistogram, 'p', graphConfig);
  renderHistogramGrid(els.estimateHistogram, 'estimate', graphConfig);
}

function installSidebarResize() {
  let dragging = false;

  els.resizeHandle.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 767px)').matches) return;
    dragging = true;
    els.resizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
    event.preventDefault();
  });

  els.resizeHandle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const layoutRect = els.simLayout.getBoundingClientRect();
    const totalWidth = layoutRect.width;
    let newWidth = event.clientX - layoutRect.left;
    const maxWidth = Math.min(650, Math.max(240, totalWidth - 360));
    newWidth = clamp(newWidth, 240, maxWidth);
    els.sidebarPane.style.flexBasis = `${newWidth}px`;
    els.sidebarPane.style.width = `${newWidth}px`;
  });

  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing');
    if (event?.pointerId !== undefined && els.resizeHandle.hasPointerCapture(event.pointerId)) {
      els.resizeHandle.releasePointerCapture(event.pointerId);
    }
  };

  els.resizeHandle.addEventListener('pointerup', stop);
  els.resizeHandle.addEventListener('pointercancel', stop);
}

function bindEvents() {
  els.runSimulation.addEventListener('click', startSimulation);

  for (const input of [els.effectD, els.alpha]) {
    input.addEventListener('input', updateConditionalControls);
  }
  els.optionalStopping.addEventListener('change', updateConditionalControls);
  els.outlierRemoval.addEventListener('change', updateConditionalControls);

  const graphInputs = [
    els.showNull,
    els.pBinwidth,
    els.pXmin,
    els.pXmax,
    els.estimateBinwidth,
    els.estimateXmin,
    els.estimateXmax,
    ...document.querySelectorAll('input[name="histScale"]'),
  ];
  for (const input of graphInputs) {
    input.addEventListener('change', () => {
      if (lastRun) renderPlots();
    });
  }

  installSidebarResize();
}

updateConditionalControls();
bindEvents();
