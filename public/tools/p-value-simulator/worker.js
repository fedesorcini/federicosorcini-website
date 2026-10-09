'use strict';

importScripts('./stats-core.js');

const { oneSampleTTest, meanAndSampleSd } = self.TStatCore;

let spareNormal = null;

function randn() {
  if (spareNormal !== null) {
    const out = spareNormal;
    spareNormal = null;
    return out;
  }
  let u = 0;
  let v = 0;
  while (u <= Number.EPSILON) u = Math.random();
  while (v <= Number.EPSILON) v = Math.random();
  const mag = Math.sqrt(-2 * Math.log(u));
  const theta = 2 * Math.PI * v;
  spareNormal = mag * Math.sin(theta);
  return mag * Math.cos(theta);
}

function generateStudyStream(maxN, effectD, populationSd) {
  const x = new Float64Array(maxN);
  const trueMean = effectD * populationSd;
  for (let i = 0; i < maxN; i += 1) {
    x[i] = trueMean + populationSd * randn();
  }
  return x;
}

function runOneSampleTest(x, n, alternative) {
  return oneSampleTTest(x, n, alternative);
}

function runAnalysisWithOutlierRemoval(
  x,
  n,
  alpha,
  outlierRemoval,
  outlierSdCutoffs,
  alternative,
) {
  const base = runOneSampleTest(x, n, alternative);
  const baseResult = {
    pValue: base.pValue,
    estimate: base.estimate,
    outlierCutoff: null,
    outliersRemoved: 0,
    nAnalyzed: n,
  };

  if (!outlierRemoval || base.pValue <= alpha || outlierSdCutoffs.length === 0) {
    return baseResult;
  }

  const stats = meanAndSampleSd(x, n);
  if (!Number.isFinite(stats.sd) || stats.sd <= 0) return baseResult;

  let best = null;
  for (const cutoff of outlierSdCutoffs) {
    const filtered = new Float64Array(n);
    let kept = 0;
    const threshold = cutoff * stats.sd;
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(x[i] - stats.mean) <= threshold) {
        filtered[kept] = x[i];
        kept += 1;
      }
    }
    if (kept < 2) continue;

    try {
      const result = runOneSampleTest(filtered, kept, alternative);
      if (!Number.isFinite(result.pValue)) continue;
      const candidate = {
        pValue: result.pValue,
        estimate: result.estimate,
        outlierCutoff: cutoff,
        outliersRemoved: n - kept,
        nAnalyzed: kept,
      };
      if (best === null || candidate.pValue < best.pValue) best = candidate;
    } catch (_) {
      // Match the R version's tryCatch: invalid candidate analyses are ignored.
    }
  }

  // Important: the R code chooses the best removal candidate, not the best of
  // the candidate and the unmodified analysis.
  return best ?? baseResult;
}

function runOptionalStopping(xFull, p) {
  let currentN = p.initialN;
  let increasesUsed = 0;
  let result;

  for (;;) {
    result = runAnalysisWithOutlierRemoval(
      xFull,
      currentN,
      p.alpha,
      p.outlierRemoval,
      p.outlierSdCutoffs,
      p.alternative,
    );

    if (result.pValue < p.alpha) break;
    if (result.pValue > p.maxP) break;
    if (currentN >= p.maxN) break;
    if (increasesUsed >= p.maxIncreases) break;

    const nextN = Math.min(currentN + p.increaseN, p.maxN);
    if (nextN <= currentN) break;
    currentN = nextN;
    increasesUsed += 1;
  }

  return {
    pValue: result.pValue,
    estimate: result.estimate,
    nUsed: currentN,
    nAnalyzed: result.nAnalyzed,
    increasesUsed,
    outlierCutoff: result.outlierCutoff,
    outliersRemoved: result.outliersRemoved,
  };
}

function flexibilityLabel(p) {
  if (p.optionalStopping && p.outlierRemoval) return 'Optional stopping + outlier removal';
  if (p.optionalStopping) return 'Optional stopping';
  if (p.outlierRemoval) return 'Outlier removal';
  return 'Without flexibility';
}

function makeGroup(scenario, effectD, analysisMode, nStudies) {
  return {
    scenario,
    effectD,
    analysisMode,
    pValues: new Float64Array(nStudies),
    estimates: new Float64Array(nStudies),
  };
}

function simulateScenario(effectD, scenarioLabel, p, progressBase, progressSpan) {
  let streamN = p.initialN;
  if (p.optionalStopping) {
    const maxReachable = p.initialN + p.increaseN * p.maxIncreases;
    streamN = Number.isFinite(p.maxN) ? Math.min(p.maxN, maxReachable) : maxReachable;
  }

  const useFlexibility = p.optionalStopping || p.outlierRemoval;
  const fixedGroup = makeGroup(scenarioLabel, effectD, 'Without flexibility', p.nStudies);
  const flexGroup = useFlexibility
    ? makeGroup(scenarioLabel, effectD, flexibilityLabel(p), p.nStudies)
    : null;

  const updateEvery = Math.max(1, Math.floor(p.nStudies / 100));

  for (let i = 0; i < p.nStudies; i += 1) {
    const xFull = generateStudyStream(streamN, effectD, p.populationSd);

    const fixed = runOneSampleTest(xFull, p.initialN, p.alternative);
    fixedGroup.pValues[i] = fixed.pValue;
    fixedGroup.estimates[i] = fixed.estimate;

    if (flexGroup) {
      let flexible;
      if (p.optionalStopping) {
        flexible = runOptionalStopping(xFull, p);
      } else {
        flexible = runAnalysisWithOutlierRemoval(
          xFull,
          p.initialN,
          p.alpha,
          p.outlierRemoval,
          p.outlierSdCutoffs,
          p.alternative,
        );
      }
      flexGroup.pValues[i] = flexible.pValue;
      flexGroup.estimates[i] = flexible.estimate;
    }

    if ((i + 1) % updateEvery === 0 || i === p.nStudies - 1) {
      const local = (i + 1) / p.nStudies;
      self.postMessage({ type: 'progress', value: progressBase + progressSpan * local });
    }
  }

  return flexGroup ? [fixedGroup, flexGroup] : [fixedGroup];
}

function serializeGroup(group) {
  return {
    scenario: group.scenario,
    effectD: group.effectD,
    analysisMode: group.analysisMode,
    pValues: group.pValues,
    estimates: group.estimates,
  };
}

self.onmessage = (event) => {
  if (event.data?.type !== 'run') return;

  try {
    const p = event.data.params;
    spareNormal = null;

    const groups = [];
    const nonzeroEffect = Math.abs(p.effectD) > Number.EPSILON;

    if (nonzeroEffect) {
      groups.push(...simulateScenario(0, 'Null (d = 0)', p, 0, 0.5));
      groups.push(...simulateScenario(
        p.effectD,
        `Selected effect (d = ${Number(p.effectD).toString()})`,
        p,
        0.5,
        0.5,
      ));
    } else {
      groups.push(...simulateScenario(0, 'Null (d = 0)', p, 0, 1));
    }

    const serializedGroups = groups.map(serializeGroup);
    const transfers = [];
    for (const group of serializedGroups) {
      transfers.push(group.pValues.buffer, group.estimates.buffer);
    }

    self.postMessage({
      type: 'done',
      result: {
        groups: serializedGroups,
        params: p,
      },
    }, transfers);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error?.message || String(error),
      stack: error?.stack || '',
    });
  }
};
