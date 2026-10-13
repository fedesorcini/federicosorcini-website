/* Interactive, offline-ready TIVA calculator. Statistics live in stats-core.js. */
(() => {
  'use strict';
  const S = window.TIVAStats;
  const $ = id => document.getElementById(id);
  const els = {
    rows: $('rows'), defaultType: $('defaultType'),
    tail: $('tail'), tailFormula: $('tailFormula'), alpha: $('alpha'),
    status: $('statusMessage'), dirty: $('dirtyText'), rowCount: $('rowCount'),
    tag: $('dataTag'), k: $('kMetric'), variance: $('varianceMetric'),
    chi: $('chiMetric'), chiDf: $('chiDf'), p: $('pMetric'), pCaption: $('pCaption'),
    ititle: $('interpretationTitle'), itext: $('interpretationText'),
    warnings: $('warningList'), zChart: $('zChart'), vChart: $('varianceChart'),
    footnote: $('dataFootnote')
  };
  const TYPE_LABELS = {F:'F',t:'t',chi2:'χ²',z:'Z',p:'p'};
  const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([key,label])=>({key,label}));
  const STORAGE_KEY='tiva-tool-state-v1';
  let nextId=1;
  let rows=[];
  let last=null;
  let dataset='Your dataset';

  // Fresh sessions start with blank inputs, not a particular paper's results.
  function blankRows(count=4){
    return Array.from({length:count},(_,i)=>rowObj({label:`Experiment ${i+1}`,included:true}));
  }
  function rowObj(data={}){
    return {id:nextId++,label:String(data.label??`Experiment ${nextId-1}`),
      type:TYPE_LABELS[data.type]?data.type:'F',stat:String(data.stat??''),
      df1:String(data.df1??''),df2:String(data.df2??''),included:data.included!==false};
  }
  function esc(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
  function fmt(num,digits=3){
    if(!Number.isFinite(num))return '—';
    if(num===0)return '0';
    if(Math.abs(num)<0.0001)return num.toExponential(3);
    return num.toFixed(digits);
  }
  function fmtP(p){return p<0.0001?p.toExponential(3):p.toFixed(p<.01?5:4);}
  function saveState(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({rows,dataset,defaultType:els.defaultType.value,tail:els.tail.value,alpha:els.alpha.value}));}catch(_){}
  }
  function loadState(){
    try{
      const obj=JSON.parse(localStorage.getItem(STORAGE_KEY));
      if(!obj||!Array.isArray(obj.rows)||obj.rows.length>1000)return false;
      // Earlier versions auto-saved an untouched demonstration dataset. Ignore it.
      if(obj.dataset==='Example dataset')return false;
      rows=obj.rows.map(r=>rowObj(r));
      dataset=(typeof obj.dataset==='string'&&obj.dataset!=='Modified example')?obj.dataset:'Your dataset';
      if(TYPE_LABELS[obj.defaultType])els.defaultType.value=obj.defaultType;
      if(['one','two'].includes(obj.tail))els.tail.value=obj.tail;
      if(Number(obj.alpha)>.0&&Number(obj.alpha)<1)els.alpha.value=String(obj.alpha);
      return true;
    }catch(_){return false;}
  }
  function message(s='',success=false){
    els.status.textContent=s;els.status.hidden=!s;
    els.status.classList.toggle('success',success);
  }
  function setDirty(){
    els.dirty.hidden=false;
    $('results').classList.add('stale');
    saveState();
  }
  function markCalculated(){els.dirty.hidden=true;$('results').classList.remove('stale');saveState();}
  function setTailFormula(){
    els.tailFormula.textContent=els.tail.value==='two'
      ?'Z = Φ⁻¹(1 − p/2). Suited to two-sided tests and F(1, df) comparisons.'
      :'Z = Φ⁻¹(1 − p). For t and Z statistics, the signed upper tail is used.';
  }
  function typeOptionHtml(current){
    return TYPE_OPTIONS.map(t=>`<option value="${t.key}" ${t.key===current?'selected':''}>${t.label}</option>`).join('');
  }
  function renderRows(){
    els.rows.innerHTML=rows.map(row=>{
      const df1Required=['F','t','chi2'].includes(row.type),df2Required=row.type==='F';
      return `<tr data-id="${row.id}" class="${row.included?'':'excluded'}">
        <td><input type="checkbox" aria-label="Include ${esc(row.label)}" data-field="included" ${row.included?'checked':''}></td>
        <td class="name-cell"><input aria-label="Experiment name" type="text" data-field="label" value="${esc(row.label)}" maxlength="120"></td>
        <td class="type-cell"><select aria-label="Test type" data-field="type">${typeOptionHtml(row.type)}</select></td>
        <td class="num-cell"><input aria-label="Test statistic or exact p-value" type="text" inputmode="decimal" data-field="stat" value="${esc(row.stat)}" placeholder="${row.type==='p'?'0.012':'e.g. 5.2'}"></td>
        <td class="num-cell"><input aria-label="df or numerator df" type="text" inputmode="decimal" data-field="df1" value="${esc(row.df1)}" ${df1Required?'':'disabled'} placeholder="${df1Required?'df':'—'}"></td>
        <td class="num-cell"><input aria-label="Denominator df" type="text" inputmode="decimal" data-field="df2" value="${esc(row.df2)}" ${df2Required?'':'disabled'} placeholder="${df2Required?'df₂':'—'}"></td>
        <td class="output-cell" data-out="p">—</td><td class="output-cell" data-out="z">—</td>
        <td class="delete-cell"><button class="delete-button" type="button" data-delete="${row.id}" title="Remove experiment" aria-label="Remove ${esc(row.label)}">×</button></td>
      </tr>`;
    }).join('');
    els.rowCount.textContent=`${rows.length} ${rows.length===1?'row':'rows'}`;
    updatePreviews();
  }
  function parseNum(text,name){
    if(String(text).trim()==='')throw Error(`${name} is blank.`);
    const n=Number(String(text).trim());
    if(!Number.isFinite(n))throw Error(`${name} must be a finite number.`);
    return n;
  }
  function calculateOne(r,tail){
    const stat=parseNum(r.stat,'Statistic');
    if((r.type==='F'||r.type==='chi2')&&stat<0)throw Error('F and chi-square statistics cannot be negative.');
    const df1=['F','t','chi2'].includes(r.type)?parseNum(r.df1,'Degrees of freedom'):null;
    const df2=r.type==='F'?parseNum(r.df2,'Denominator degrees of freedom'):null;
    if(df1!==null&&df1<=0)throw Error('Degrees of freedom must be positive.');
    if(df2!==null&&df2<=0)throw Error('Denominator degrees of freedom must be positive.');
    const p=S.statisticToP({type:r.type,stat,df1,df2,tail});
    const z=S.pToZ(p,tail);
    if(!Number.isFinite(z))throw Error('The computed Z score is not finite. Check the p-value.');
    return {...r,p,z};
  }
  function updatePreviews(){
    rows.forEach(row=>{
      const tr=els.rows.querySelector(`tr[data-id="${row.id}"]`);
      if(!tr)return;
      tr.classList.toggle('excluded',!row.included);
      tr.querySelectorAll('.input-error').forEach(el=>el.classList.remove('input-error'));
      try{const v=calculateOne(row,els.tail.value);tr.querySelector('[data-out="p"]').textContent=fmtP(v.p);tr.querySelector('[data-out="z"]').textContent=fmt(v.z,3);}
      catch(_){tr.querySelector('[data-out="p"]').textContent='—';tr.querySelector('[data-out="z"]').textContent='—';}
    });
  }
  function getIncluded(){
    let selected=[];let types=new Set();let invalid=[];
    for(const row of rows){
      if(!row.included)continue;
      const tr=els.rows.querySelector(`tr[data-id="${row.id}"]`);
      try{const r=calculateOne(row,els.tail.value);selected.push(r);types.add(r.type);}
      catch(e){
        invalid.push(`${row.label||'Unnamed experiment'}: ${e.message}`);
        const field=tr?.querySelector('[data-field="stat"]');if(field)field.classList.add('input-error');
      }
    }
    if(invalid.length)throw Error(invalid[0]);
    if(selected.length<2)throw Error('Include at least two experiments with valid statistics to calculate TIVA.');
    return {selected,types};
  }
  function validateAlpha(){
    const a=Number(els.alpha.value);
    if(els.alpha.value.trim()===''||!(a>0&&a<1))throw Error('α must be between 0 and 1.');
    return a;
  }
  function run(){
    message();updatePreviews();
    try{
      const alpha=validateAlpha();
      const {selected,types}=getIncluded();
      const stats=S.tiva(selected.map(x=>x.z));
      last={alpha,selected,types:[...types],stats,tail:els.tail.value,dataset};
      renderAnalysis(last);
      markCalculated();
      return true;
    }catch(err){message(err.message);return false;}
  }
  function resetResults(){
    last=null;for(const x of [els.k,els.variance,els.chi,els.p])x.textContent='—';
    els.chiDf.textContent='Degrees of freedom: —';els.pCaption.textContent='Test of insufficient variance';
    els.ititle.textContent='Enter results to begin';els.itext.textContent='Enter at least two valid experiments, then select Calculate TIVA.';
    els.warnings.innerHTML='';els.zChart.innerHTML='';els.vChart.innerHTML='';
    els.dirty.hidden=true;message();
  }
  function renderAnalysis(a){
    const {stats:s,alpha,selected,types,tail}=a;
    els.k.textContent=String(s.k);els.variance.textContent=fmt(s.variance,4);
    els.chi.textContent=fmt(s.chiSquare,4);els.chiDf.textContent=`Degrees of freedom: ${s.df}`;
    els.p.textContent=fmtP(s.pValue);els.pCaption.textContent=`Lower-tail test (α = ${alpha})`;
    els.tag.textContent=a.dataset;
    if(s.pValue<alpha){
      els.ititle.textContent='Statistically insufficient variance detected';
      els.itext.textContent=`Across ${s.k} included experiments, the sample variance of converted Z-scores was ${fmt(s.variance,4)}. The lower-tail reference test gives χ²(${s.df}) = ${fmt(s.chiSquare,3)}, p = ${fmtP(s.pValue)}, below α = ${alpha}. The results are more tightly clustered than predicted by the reference model. This is a flag for follow-up, not evidence of misconduct or a specific bias mechanism.`;
    }else{
      els.ititle.textContent='Insufficient variance not established';
      els.itext.textContent=`Across ${s.k} included experiments, the sample variance of converted Z-scores was ${fmt(s.variance,4)}. The lower-tail reference test gives χ²(${s.df}) = ${fmt(s.chiSquare,3)}, p = ${fmtP(s.pValue)}, not below α = ${alpha}. This analysis does not establish insufficient variance; it does not prove an absence of reporting or selection bias.`;
    }
    const notes=[];
    if(s.k<5)notes.push('Few experiments included (k < 5): TIVA has low sensitivity and its reference approximation should be interpreted cautiously.');
    if(types.length>1)notes.push('Multiple statistical test types are mixed. Confirm that all tests address a comparable hypothesis, and consider a homogeneous subset.');
    const nonsig=selected.filter(x=>x.p>=alpha).length;
    if(nonsig>0)notes.push(`${nonsig} of ${s.k} included tests are not individually significant at α = ${alpha}. Non-significant results were retained, not automatically discarded.`);
    if(selected.some(x=>x.type==='chi2'&&Number(x.df1)>1||x.type==='F'&&Number(x.df1)>1))notes.push('Some tests have multiple numerator/chi-square degrees of freedom. The normal-equivalent Z approximation may be less direct than for one-df tests.');
    if(tail==='one')notes.push('One-sided conversion selected: signed t and Z tests use upper-tail probabilities. Check that the direction matches the original hypothesis.');
    if(rows.some(x=>!x.included))notes.push(`${rows.filter(x=>!x.included).length} row(s) were excluded manually. Document and justify exclusions in the analysis.`);
    els.warnings.replaceChildren(...notes.map(note=>{
      const el=document.createElement('div');el.className='warning-note';el.textContent='• '+note;return el;
    }));
    els.zChart.innerHTML=buildZChart(a);
    els.vChart.innerHTML=buildVarianceChart(a);
  }
  function svgStart(W,H,title){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><rect x="0" y="0" width="${W}" height="${H}" fill="#F0E8D8"/>`;}
  function svgText(x,y,text,size=13,opts=''){return `<text x="${x}" y="${y}" font-family="PT Serif,Georgia,serif" font-size="${size}" fill="#28343D" ${opts}>${esc(text)}</text>`;}
  function buildZChart(a){
    const data=a.selected,W=730,H=350,L=58,R=20,T=18,B=78,PW=W-L-R,PH=H-T-B;
    const threshold=S.pToZ(a.alpha,a.tail);
    const values=data.map(x=>x.z);
    const lo0=Math.min(...values,threshold,a.stats.mean),hi0=Math.max(...values,threshold,a.stats.mean);
    const ymin=Math.floor(Math.min(lo0-0.6,0)/0.5)*0.5;
    const ymax=Math.ceil(Math.max(hi0+0.5,1)/0.5)*0.5;
    const y=z=>T+PH-(z-ymin)/(ymax-ymin)*PH;
    const x=i=>L+PW*(i+.5)/data.length;
    let svg=svgStart(W,H,'Converted Z scores by experiment');
    const ticks=5;
    for(let i=0;i<=ticks;i++){
      const val=ymin+(ymax-ymin)*i/ticks,py=y(val);
      svg+=`<line x1="${L}" y1="${py}" x2="${W-R}" y2="${py}" stroke="#C8BBA5" stroke-width=".8"/>`;
      svg+=svgText(L-10,py+4,fmt(val,1),12,'text-anchor="end"');
    }
    const ym=y(a.stats.mean),yt=y(threshold);
    svg+=`<line x1="${L}" y1="${ym}" x2="${W-R}" y2="${ym}" stroke="#B06044" stroke-width="2" stroke-dasharray="7 5"/>`;
    svg+=`<line x1="${L}" y1="${yt}" x2="${W-R}" y2="${yt}" stroke="#7d8487" stroke-width="1.5" stroke-dasharray="3 5"/>`;
    data.forEach((item,i)=>{
      const cx=x(i),cy=y(item.z);
      svg+=`<circle cx="${cx}" cy="${cy}" r="6.2" fill="#324C63" stroke="#F0E8D8" stroke-width="2"><title>${esc(item.label)}: p=${fmtP(item.p)}, Z=${fmt(item.z,4)}</title></circle>`;
      svg+=svgText(cx,cy-12,fmt(item.z,2),13,'text-anchor="middle" font-weight="700"');
      const truncated=item.label.length>16?item.label.slice(0,15)+'…':item.label;
      svg+=svgText(cx,T+PH+19,truncated,Math.min(12,Math.max(9,420/data.length/1.3)),'text-anchor="middle"');
    });
    svg+=`<line x1="${L}" x2="${W-R}" y1="${T+PH}" y2="${T+PH}" stroke="#596570"/>`;
    svg+=svgText(L+10,H-18,`Mean Z = ${fmt(a.stats.mean,3)}`,12);
    svg+=`<line x1="${W-274}" x2="${W-249}" y1="${H-22}" y2="${H-22}" stroke="#B06044" stroke-width="2" stroke-dasharray="6 4"/>`;
    svg+=svgText(W-242,H-18,'Mean',12);
    svg+=`<line x1="${W-160}" x2="${W-135}" y1="${H-22}" y2="${H-22}" stroke="#7d8487" stroke-width="1.5" stroke-dasharray="3 4"/>`;
    svg+=svgText(W-129,H-18,`p = ${a.alpha}`,12);
    return svg+'</svg>';
  }
  function criticalVariance(df,alpha){
    let lo=0,hi=1;
    while(S.chiCDF(hi*df,df)<alpha&&hi<1e8)hi*=2;
    for(let i=0;i<100;i++){
      const mid=(lo+hi)/2;
      if(S.chiCDF(mid*df,df)<alpha)lo=mid;else hi=mid;
    }
    return (lo+hi)/2;
  }
  function buildVarianceChart(a){
    const s=a.stats,W=730,H=350,L=62,R=24,T=19,B=72,PW=W-L-R,PH=H-T-B;
    const crit=criticalVariance(s.df,a.alpha);
    const maxV=Math.max(2.8,s.variance*1.45,crit*1.7);
    const n=280;
    const data=Array.from({length:n+1},(_,i)=>{
      const xv=Math.max(1e-6,maxV*i/n);
      return {x:xv,y:S.chiPDF(s.df*xv,s.df)*s.df};
    });
    let maxD=Math.max(...data.map(v=>v.y).filter(Number.isFinite));
    // For df=1, density diverges at zero; clip display to keep usable axes.
    if(s.df===1)maxD=Math.max(...data.slice(3).map(v=>v.y));
    maxD*=1.12;
    const x=v=>L+v/maxV*PW, y=v=>T+PH-Math.min(maxD,v)/maxD*PH;
    let svg=svgStart(W,H,'TIVA reference distribution of sample Z variance');
    for(let i=0;i<=5;i++){
      const t=i/5*maxV,px=x(t);
      svg+=`<line x1="${px}" x2="${px}" y1="${T}" y2="${T+PH}" stroke="#C8BBA5" stroke-width=".8"/>`;
      svg+=svgText(px,T+PH+22,fmt(t,1),12,'text-anchor="middle"');
    }
    for(let i=0;i<=4;i++){
      const v=i/4*maxD,py=y(v);
      svg+=`<line x1="${L}" x2="${W-R}" y1="${py}" y2="${py}" stroke="#C8BBA5" stroke-width=".8"/>`;
      svg+=svgText(L-7,py+4,fmt(v,2),11,'text-anchor="end"');
    }
    const shade=data.filter(pt=>pt.x<=s.variance);
    shade.push({x:Math.min(s.variance,maxV),y:S.chiPDF(Math.max(.000001,s.variance*s.df),s.df)*s.df});
    const shape=shade.map(pt=>`${x(pt.x).toFixed(2)},${y(pt.y).toFixed(2)}`).join(' ');
    svg+=`<polygon points="${x(0)},${T+PH} ${shape} ${x(Math.min(s.variance,maxV))},${T+PH}" fill="#A3B9C8" opacity=".52"/>`;
    svg+=`<polyline points="${data.map(pt=>`${x(pt.x).toFixed(2)},${y(pt.y).toFixed(2)}`).join(' ')}" fill="none" stroke="#324C63" stroke-width="2.5"/>`;
    if(s.variance<=maxV)svg+=`<line x1="${x(s.variance)}" y1="${T}" x2="${x(s.variance)}" y2="${T+PH}" stroke="#B06044" stroke-width="2.5"/>`;
    svg+=`<line x1="${x(crit)}" y1="${T}" x2="${x(crit)}" y2="${T+PH}" stroke="#7e858a" stroke-dasharray="6 5" stroke-width="2"/>`;
    svg+=`<line x1="${L}" x2="${W-R}" y1="${T+PH}" y2="${T+PH}" stroke="#596570"/>`;
    svg+=svgText(L+8,H-17,`Observed = ${fmt(s.variance,3)} · lower-tail p = ${fmtP(s.pValue)}`,13);
    svg+=svgText(W-R,H-17,`α cutoff = ${fmt(crit,3)}`,12,'text-anchor="end"');
    return svg+'</svg>';
  }

  function download(filename,contents,mime){
    const blob=new Blob([contents],{type:mime}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=filename;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function downloadSvg(id,name){
    const source=$(id)?.querySelector('svg');
    if(!source){message('Calculate TIVA before downloading a plot.');return;}
    download(name,new XMLSerializer().serializeToString(source),'image/svg+xml;charset=utf-8');
  }
  function bind(){
    els.rows.addEventListener('input',event=>{
      const field=event.target.dataset.field;
      if(!field||field==='type'||field==='included')return;
      const id=Number(event.target.closest('tr')?.dataset.id),row=rows.find(x=>x.id===id);
      if(!row)return;
      row[field]=event.target.value;
      updatePreviews();setDirty();
    });
    els.rows.addEventListener('change',event=>{
      const field=event.target.dataset.field;
      if(!['type','included'].includes(field))return;
      const id=Number(event.target.closest('tr')?.dataset.id),row=rows.find(x=>x.id===id);
      if(!row)return;
      row[field]=field==='included'?event.target.checked:event.target.value;
      if(field==='type')renderRows();else updatePreviews();
      setDirty();
    });
    els.rows.addEventListener('click',event=>{
      const del=event.target.closest('[data-delete]');if(!del)return;
      rows=rows.filter(x=>x.id!==Number(del.dataset.delete));renderRows();setDirty();
    });
    $('addRow').addEventListener('click',()=>{
      rows.push(rowObj({label:`Experiment ${rows.length+1}`,type:els.defaultType.value,included:true}));
      renderRows();setDirty();els.rows.lastElementChild?.querySelector('[data-field="stat"]')?.focus();
    });
    $('calculate').addEventListener('click',run);
    $('downloadZ').addEventListener('click',()=>downloadSvg('zChart','tiva-z-scores.svg'));
    $('downloadVariance').addEventListener('click',()=>downloadSvg('varianceChart','tiva-variance-distribution.svg'));
    els.tail.addEventListener('change',()=>{setTailFormula();updatePreviews();setDirty();});
    $('alpha').addEventListener('input',setDirty);
    els.defaultType.addEventListener('change',saveState);
    let dragging=false;
    $('resizeHandle').addEventListener('pointerdown',event=>{
      if(window.matchMedia('(max-width:767px)').matches)return;
      dragging=true;$('resizeHandle').setPointerCapture(event.pointerId);document.body.classList.add('resizing');event.preventDefault();
    });
    $('resizeHandle').addEventListener('pointermove',event=>{
      if(!dragging)return;
      const rect=$('simLayout').getBoundingClientRect(),max=Math.min(650,Math.max(260,rect.width-420));
      const width=Math.max(260,Math.min(max,event.clientX-rect.left));
      $('sidebarPane').style.flexBasis=`${width}px`;$('sidebarPane').style.width=`${width}px`;
    });
    const stop=e=>{if(!dragging)return;dragging=false;document.body.classList.remove('resizing');if($('resizeHandle').hasPointerCapture(e.pointerId))$('resizeHandle').releasePointerCapture(e.pointerId);};
    $('resizeHandle').addEventListener('pointerup',stop);$('resizeHandle').addEventListener('pointercancel',stop);
  }
  if(!loadState()){
    rows=blankRows();dataset='Your dataset';
  }
  bind();setTailFormula();renderRows();
  if(rows.filter(x=>x.included).length>=2&&rows.filter(x=>x.included).every(x=>x.stat.trim()))run();else resetResults();
})();
