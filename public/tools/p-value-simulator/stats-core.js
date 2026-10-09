(function (root) {
  'use strict';

  // Lanczos approximation for log Gamma.
  const LANCZOS = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  function logGamma(z) {
    if (z < 0.5) {
      return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < LANCZOS.length; i += 1) {
      x += LANCZOS[i] / (z + i + 1);
    }
    const t = z + LANCZOS.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function betaContinuedFraction(a, b, x) {
    const MAX_ITER = 300;
    const EPS = 3e-14;
    const FPMIN = 1e-300;

    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;

    for (let m = 1; m <= MAX_ITER; m += 1) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;

      aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function regularizedIncompleteBeta(x, a, b) {
    if (!(a > 0) || !(b > 0)) return NaN;
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    const logBt =
      logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log1p(-x);
    const bt = Math.exp(logBt);

    if (x < (a + 1) / (a + b + 2)) {
      return (bt * betaContinuedFraction(a, b, x)) / a;
    }
    return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
  }

  function studentTCdf(t, df) {
    if (!(df > 0) || !Number.isFinite(df)) return NaN;
    if (t === Infinity) return 1;
    if (t === -Infinity) return 0;
    if (!Number.isFinite(t)) return NaN;
    if (t === 0) return 0.5;

    const x = df / (df + t * t);
    const ib = regularizedIncompleteBeta(x, df / 2, 0.5);
    const lowerTail = 0.5 * ib;
    return t > 0 ? 1 - lowerTail : lowerTail;
  }

  function meanAndSampleSd(x, n = x.length) {
    if (n < 1) return { mean: NaN, sd: NaN };
    let mean = 0;
    let m2 = 0;
    for (let i = 0; i < n; i += 1) {
      const delta = x[i] - mean;
      mean += delta / (i + 1);
      const delta2 = x[i] - mean;
      m2 += delta * delta2;
    }
    return {
      mean,
      sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : NaN,
    };
  }

  function oneSampleTTest(x, n = x.length, alternative = 'two.sided') {
    if (n < 2) throw new Error('At least two observations are required.');
    const stats = meanAndSampleSd(x, n);
    if (!Number.isFinite(stats.sd) || stats.sd <= 0) {
      throw new Error('Data are essentially constant.');
    }
    const t = stats.mean / (stats.sd / Math.sqrt(n));
    const cdf = studentTCdf(t, n - 1);
    let p;
    if (alternative === 'greater') {
      p = 1 - cdf;
    } else if (alternative === 'less') {
      p = cdf;
    } else {
      p = 2 * Math.min(cdf, 1 - cdf);
    }
    p = Math.min(1, Math.max(0, p));
    return { pValue: p, estimate: stats.mean, t, df: n - 1 };
  }

  const api = {
    logGamma,
    regularizedIncompleteBeta,
    studentTCdf,
    meanAndSampleSd,
    oneSampleTTest,
  };

  root.TStatCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
