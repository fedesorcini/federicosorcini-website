/* TIVA statistical routines. Self-contained, usable in a browser or Node.
   Formula: Q = (k-1) * sampleVariance(z); p = P[ChiSq(k-1) <= Q].
   z = Phi^-1(1-p/2) for two-sided-equivalent conversion (default).
*/
(function (root) {
  'use strict';
  const COEFF = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  const SQRT2PI = Math.sqrt(2 * Math.PI);
  function logGamma(z) {
    if (!(z > 0)) return NaN;
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI*z)) - logGamma(1-z);
    z -= 1;
    let x=0.99999999999980993;
    for(let i=0;i<COEFF.length;i++) x+=COEFF[i]/(z+i+1);
    const t=z+COEFF.length-0.5;
    return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);
  }
  function betaFraction(a,b,x){
    const tiny=1e-300, eps=4e-15;let c=1,d=1-(a+b)*x/(a+1);
    if(Math.abs(d)<tiny)d=tiny; d=1/d; let h=d;
    for(let m=1;m<=1000;m++){
      const m2=2*m,aa1=m*(b-m)*x/((a-1+m2)*(a+m2));
      d=1+aa1*d;if(Math.abs(d)<tiny)d=tiny;
      c=1+aa1/c;if(Math.abs(c)<tiny)c=tiny;
      d=1/d;h*=d*c;
      const aa2=-(a+m)*(a+b+m)*x/((a+m2)*(a+1+m2));
      d=1+aa2*d;if(Math.abs(d)<tiny)d=tiny;
      c=1+aa2/c;if(Math.abs(c)<tiny)c=tiny;
      d=1/d;const delta=d*c;h*=delta;
      if(Math.abs(delta-1)<eps)break;
    }
    return h;
  }
  function betaI(x,a,b){
    if(!(a>0&&b>0&&x>=0&&x<=1))return NaN;
    if(x===0)return 0; if(x===1)return 1;
    const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
    if(x<(a+1)/(a+b+2)) return Math.min(1,Math.max(0,bt*betaFraction(a,b,x)/a));
    return Math.min(1,Math.max(0,1-bt*betaFraction(b,a,1-x)/b));
  }
  // Numerically stable regularized lower/upper incomplete gamma.
  function gammaP(a,x){
    if(!(a>0&&x>=0))return NaN;
    if(x===0)return 0;
    if(x>=a+1)return Math.max(0,1-gammaQ(a,x));
    let term=1/a,sum=term;
    for(let n=1;n<2000;n++){
      term*=x/(a+n);sum+=term;
      if(Math.abs(term)<Math.abs(sum)*2e-15)break;
    }
    return Math.min(1,Math.max(0,sum*Math.exp(a*Math.log(x)-x-logGamma(a))));
  }
  function gammaQ(a,x){
    if(!(a>0&&x>=0))return NaN;
    if(x===0)return 1;
    if(x<a+1)return Math.max(0,1-gammaP(a,x));
    const tiny=1e-300;let b=x+1-a,c=1/tiny,d=1/b,h=d;
    for(let i=1;i<2000;i++){
      const an=-i*(i-a);b+=2;d=an*d+b;if(Math.abs(d)<tiny)d=tiny;
      c=b+an/c;if(Math.abs(c)<tiny)c=tiny;
      d=1/d;const delta=d*c;h*=delta;
      if(Math.abs(delta-1)<2e-15)break;
    }
    return Math.min(1,Math.max(0,Math.exp(a*Math.log(x)-x-logGamma(a))*h));
  }
  function normalSF(x){
    if(!Number.isFinite(x))return x===Infinity?0:x===-Infinity?1:NaN;
    const half=0.5*gammaQ(0.5,x*x/2);
    return x>=0?half:1-half;
  }
  function normalInv(p){
    if(!(p>=0&&p<=1))return NaN;
    if(p===0)return -Infinity;if(p===1)return Infinity;
    // Peter J. Acklam's rational approximation.
    const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239];
    const b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572];
    const c=[-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783];
    const d=[0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416];
    let x,q,r;
    if(p<0.02425){q=Math.sqrt(-2*Math.log(p));x=(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
    else if(p>0.97575){q=Math.sqrt(-2*Math.log1p(-p));x=-(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
    else{q=p-.5;r=q*q;x=(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
    // Refine using the accurate normal survival, guarding tiny density.
    const diff=normalSF(x)-(1-p), density=Math.exp(-x*x/2)/SQRT2PI;
    if(density>1e-250)x+=diff/density;
    return x;
  }
  // Use normalSF inversion on tiny upper-tail probability to avoid 1-p cancellation.
  function zFromUpperTail(p){
    if(p===0)return Infinity;if(p===1)return -Infinity;
    return -normalInv(p);
  }
  function fSF(f,df1,df2){
    if(!(f>=0&&df1>0&&df2>0))return NaN;
    if(f===Infinity)return 0;
    if(f===0)return 1;
    // Stable upper-tail incomplete beta in the denominator df formulation.
    const x=df2/(df2+df1*f);
    return betaI(x,df2/2,df1/2);
  }
  function tSF(t,df){
    if(!(df>0))return NaN;
    if(t===Infinity)return 0;if(t===-Infinity)return 1;
    const x=df/(df+t*t),tail=0.5*betaI(x,df/2,.5);
    return t>=0?tail:1-tail;
  }
  function chiSF(chi,df){
    if(!(df>0&&chi>=0))return NaN;
    return gammaQ(df/2,chi/2);
  }
  function chiCDF(chi,df){
    if(!(df>0&&chi>=0))return NaN;
    return gammaP(df/2,chi/2);
  }
  function chiPDF(x,df){
    if(!(df>0&&x>=0))return NaN;
    if(x===0)return df<2?Infinity:df===2?.5:0;
    const half=df/2;
    return Math.exp((half-1)*Math.log(x)-x/2-half*Math.log(2)-logGamma(half));
  }
  function statisticToP({type,stat,df1,df2,tail='two'}){
    if(!Number.isFinite(stat))throw Error('Enter a finite numeric test statistic.');
    let p;
    if(type==='F')p=fSF(stat,df1,df2);
    else if(type==='t')p=tail==='one'?tSF(stat,df1):2*tSF(Math.abs(stat),df1);
    else if(type==='chi2')p=chiSF(stat,df1);
    else if(type==='z')p=tail==='one'?normalSF(stat):2*normalSF(Math.abs(stat));
    else if(type==='p')p=stat;
    else throw Error('Unknown statistical test type.');
    if(!(p>0&&p<=1)&&!(p===0))throw Error('Invalid p-value or degrees of freedom.');
    if(type==='p'&&!(p>0&&p<1))throw Error('Exact p-values must be greater than 0 and less than 1.');
    if(p===0)throw Error('p-value underflowed to zero. Enter a less extreme test statistic or exact p-value.');
    return Math.min(1,p);
  }
  function pToZ(p,tail='two'){
    if(!(p>0&&p<=1))return NaN;
    return zFromUpperTail(tail==='two'?p/2:p);
  }
  function tiva(zValues){
    const n=zValues.length;
    if(n<2)throw Error('Include at least two experiments.');
    if(zValues.some(v=>!Number.isFinite(v)))throw Error('Non-finite Z score.');
    const mean=zValues.reduce((a,b)=>a+b,0)/n;
    const sse=zValues.reduce((a,z)=>a+(z-mean)**2,0);
    const variance=sse/(n-1);
    return {k:n,mean,variance,chiSquare:sse,df:n-1,pValue:chiCDF(sse,n-1),stdDev:Math.sqrt(variance)};
  }
  const api={logGamma,betaI,gammaP,gammaQ,normalSF,normalInv,zFromUpperTail,fSF,tSF,chiSF,chiCDF,chiPDF,statisticToP,pToZ,tiva};
  root.TIVAStats=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
