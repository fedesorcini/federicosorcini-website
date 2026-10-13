/* Data Visualization Studio
   Native JS + SVG. No external charting library or build step.
   Imported CSV never leaves the browser. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const PALETTE = ['#21198A', '#9A3092', '#EEA650', '#02BFC4', '#324C63', '#D76D53', '#4C9974', '#6A91B7'];
  const FILL_CHOICES = ['solid', 'diagonal', 'reverse', 'dots', 'cross', 'horizontal'];
  const CHANNELS = ['color', 'opacity', 'fill', 'position'];
  const CHANNEL_NAMES = { color: 'Color', opacity: 'Opacity', fill: 'Fill pattern', position: 'Position only' };
  const $ = (id) => document.getElementById(id);
  const state = {
    headers: [], rows: [], levels: new Map(), levelCounts: new Map(), numeric: [],
    filename: '', subject: '', measure: '', statistic: 'mean', error: 'none',
    factors: [], filters: new Map(),
    title: '', ylabel: '', showValues: true, speed: 900,
    chartSnapshot: null, lastTransitionFrom: null,
    lastSummary: [], lastIncludedRows: 0, lastSubjectCount: 0,
    motionToken: 0
  };

  function escapeHTML(v) {
    return String(v).replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
  }
  function formatNumber(n, digits = 2) {
    if (!Number.isFinite(n)) return '—';
    const x = Math.abs(n);
    const places = x >= 100 ? 1 : x >= 10 ? 2 : x >= 1 ? 2 : 3;
    return Number(n.toFixed(digits === 2 ? places : digits)).toLocaleString('en-US', {maximumFractionDigits:digits === 2 ? places : digits});
  }
  function getNumber(s) {
    if (typeof s === 'number') return Number.isFinite(s) ? s : null;
    if (String(s).trim() === '') return null;
    const n = Number(String(s).trim());
    return Number.isFinite(n) ? n : null;
  }
  function distinct(array) { return Array.from(new Set(array)); }
  function compareValues(a,b) {
    const na = getNumber(a), nb = getNumber(b);
    if (na !== null && nb !== null) return na - nb;
    // Familiar ordered condition labels should read naturally from left to right.
    const ranks={
      'low':0,'medium':1,'moderate':1,'high':2,
      'in-focus':0,'in focus':0,'out-of-focus':1,'out of focus':1,
      'compatible':0,'incompatible':1,'congruent':0,'incongruent':1,
      'near':0,'far':1,'off':0,'on':1,'no':0,'yes':1
    };
    const sa=String(a).toLowerCase(), sb=String(b).toLowerCase();
    if(Object.hasOwn(ranks,sa)&&Object.hasOwn(ranks,sb))return ranks[sa]-ranks[sb];
    return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  }
  function pretty(v) { return v === '' ? '(Blank)' : String(v); }
  function mean(xs) { return xs.reduce((a,b)=>a+b,0)/xs.length; }
  function stdev(xs) { if (xs.length < 2) return null; const m=mean(xs); return Math.sqrt(xs.reduce((s,v)=>s+(v-m)**2,0)/(xs.length-1)); }
  function summarize(xs, stat) {
    if (!xs.length) return null;
    if (stat === 'mean') return mean(xs);
    if (stat === 'sd') return stdev(xs);
    if (stat === 'variance') {const s=stdev(xs); return s === null ? null : s*s;}
    if (stat === 'max') return xs.reduce((a,b)=>Math.max(a,b),-Infinity);
    if (stat === 'min') return xs.reduce((a,b)=>Math.min(a,b),Infinity);
    if (stat === 'median') {const ys=[...xs].sort((a,b)=>a-b);const i=Math.floor(ys.length/2);return ys.length%2 ? ys[i] : (ys[i-1]+ys[i])/2;}
    return mean(xs);
  }
  function hslHexToRgb(hex){const v=hex.replace('#','');return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16)];}
  function colorMix(from, to, progress) {
    if (!/^#[0-9a-fA-F]{6}$/.test(from) || !/^#[0-9a-fA-F]{6}$/.test(to)) return to;
    const a=hslHexToRgb(from), b=hslHexToRgb(to);
    return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*progress).toString(16).padStart(2,'0')).join('');
  }

  // RFC-style quoted fields, doubled quotes, CRLF, line breaks inside quoted fields.
  // Comma, tab, or semicolon delimiter is detected from first logical CSV record.
  function csvDelimiter(text) {
    let quoted=false; const count={',':0,'\t':0,';':0};
    for(let i=0;i<Math.min(text.length,30000);i++) {
      const ch=text[i];
      if(ch==='"'){if(quoted && text[i+1]==='"')i++;else quoted=!quoted;}
      else if(!quoted && (ch==='\n'||ch==='\r'))break;
      else if(!quoted && Object.hasOwn(count,ch))count[ch]++;
    }
    return Object.keys(count).sort((a,b)=>count[b]-count[a])[0];
  }
  function parseCSV(source) {
    const text=source.replace(/^\uFEFF/,'');
    const separator=csvDelimiter(text);
    const data=[]; let field='',row=[],quote=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quote){
        if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;} else quote=false;}
        else field+=ch;
      } else if(ch==='"'){quote=true;}
      else if(ch===separator){row.push(field);field='';}
      else if(ch==='\r'||ch==='\n'){
        if(ch==='\r'&&text[i+1]==='\n')i++;
        row.push(field);field='';
        if(row.some(v=>v!==''))data.push(row);
        row=[];
      }else field+=ch;
    }
    if(quote)throw new Error('The CSV contains an unmatched quotation mark.');
    row.push(field);if(row.some(v=>v!==''))data.push(row);
    if(data.length<2)throw new Error('CSV must include a header and at least one data row.');
    const headers=data.shift().map((h,i)=>String(h).trim() || `Column ${i+1}`);
    if(headers.length<2)throw new Error('CSV needs at least two columns.');
    const seen=new Map(); const unique=headers.map(h=>{
      const n=(seen.get(h)||0)+1;seen.set(h,n);return n===1?h:`${h} (${n})`;
    });
    const rows=[];
    data.forEach((values,index)=>{
      if(values.length!==headers.length) {
        // Ignore a single trailing blank column from spreadsheet exports.
        if(values.length===headers.length+1 && values.at(-1)==='') values.pop();
        else throw new Error(`Data row ${index+2} has ${values.length} cells; expected ${headers.length}.`);
      }
      const r=Object.create(null);
      unique.forEach((key,i)=>r[key]=values[i].trim());
      rows.push(r);
    });
    return {headers:unique,rows};
  }

  function demoCSV() {
    const lines=['Participant,Condition,Compatibility,Load,Trial,RT,Accuracy'];
    for(let p=1;p<=24;p++)for(const c of ['In-Focus','Out-of-Focus'])
      for(const compat of ['Compatible','Incompatible'])for(const load of ['Low','High'])
        for(let trial=1;trial<=7;trial++){
          const individual=(p-12)*3 + Math.sin(p*1.9)*24;
          const out=c==='Out-of-Focus', inc=compat==='Incompatible', hi=load==='High';
          const jitter=Math.sin(p*7.13+trial*5.32+(out?1.23:0)+(inc?3.11:0)+(hi?4.1:0))*23;
          const rt=Math.round(485+individual+out*38+inc*(31+hi*23)+hi*105+out*hi*19+jitter);
          const accuracy=(Math.sin(p*2.7+trial*6.8+(out?4.5:0)+(inc?2.3:0)+(hi?1.2:0)) > (hi?0.77:0.9))?1:0;
          lines.push([`P${String(p).padStart(2,'0')}`,c,compat,load,trial,rt,accuracy].join(','));
        }
    return lines.join('\n');
  }

  function ingest(text,filename) {
    try {
      const {headers,rows}=parseCSV(text);
      if(rows.length>400000)throw new Error('For responsive interaction, this version supports up to 400,000 CSV rows.');
      const levels=new Map(),counts=new Map();
      for(const h of headers){levels.set(h,new Set());counts.set(h,new Map());}
      for(const r of rows)for(const h of headers){
        const value=r[h];levels.get(h).add(value);
        const count=counts.get(h);count.set(value,(count.get(value)||0)+1);
      }
      const sortedLevels=new Map([...levels].map(([h,ls])=>[h,[...ls].sort(compareValues)]));
      const numeric=headers.filter(h=>{
        let present=0,numericCount=0;
        for(let i=0;i<rows.length;i++){
          const v=rows[i][h];if(v==='')continue;present++;
          if(getNumber(v)!==null)numericCount++;
          if(present>=500)break;
        }
        return present>0 && numericCount/present>=.90;
      });
      state.headers=headers; state.rows=rows;state.levels=sortedLevels;state.levelCounts=counts;state.numeric=numeric;
      state.filename=filename;state.factors=[];state.filters.clear();state.chartSnapshot=null;state.lastTransitionFrom=null;
      state.subject= headers.find(h=>/^(subject|subject.?id|participant|participant.?id|subj|subj.?id|observer|observer.?id|user.?id|pid|ppid|participant_number)$/i.test(h.replace(/\s/g,'_')))||'';
      state.measure=numeric.find(h=>/(^rt$|reaction.?time|response.?time|latency|accuracy|^score$)/i.test(h))||numeric.find(h=>h!==state.subject&&!/^(trial|block|session|age|year|order|index)$/i.test(h))||'';
      state.statistic='mean';state.error='none';$('statSelect').value='mean';$('errorSelect').value='none';
      $('dataFilename').textContent=`${filename} · ${rows.length.toLocaleString()} rows`;
      $('uploadError').hidden=true;
      populateSelects();renderFactorControls();renderFilterControls();computeAndRender();
    } catch(err){$('uploadError').textContent=err.message||'Unable to read CSV.';$('uploadError').hidden=false;}
  }
  function option(text,value='',selected=false) {const el=document.createElement('option');el.value=value;el.textContent=text;el.selected=selected;return el;}
  function populateSelect(select,choices,placeholder,current) {
    select.replaceChildren(option(placeholder,''),...choices.map(h=>option(h,h,h===current)));
    select.value=choices.includes(current)?current:'';select.disabled=!state.rows.length;
  }
  function populateSelects(){
    populateSelect($('subjectSelect'),state.headers,'Select participant column…',state.subject);
    populateSelect($('measureSelect'),state.numeric.filter(h=>h!==state.subject),'Select numeric measure…',state.measure);
    updateAddSelectors();
  }
  function factorColumns() {return state.factors.map(f=>f.col);}
  function updateAddSelectors(){
    populateSelect($('addFactorSelect'),state.headers.filter(h=>h!==state.subject&&h!==state.measure&&!factorColumns().includes(h)&&state.levels.get(h).length<=35),'Select a factor…','');
    populateSelect($('addFilterSelect'),state.headers.filter(h=>!state.filters.has(h)),'Select a column…','');
    $('addFactorButton').disabled=!$('addFactorSelect').value;
    $('addFilterButton').disabled=!$('addFilterSelect').value;
  }
  function defaultStyle(level, index, n, col) {
    const lower=String(level).toLowerCase();
    let opacity=n===1?1:0.55+(index/(n-1))*.45;
    if(/^(in.focus|near|on.focus|focused)/i.test(lower))opacity=1;
    if(/^(out.of.focus|far|unfocused)/i.test(lower))opacity=.53;
    const color = /^12$/.test(level) ? '#21198A' : /^8$/.test(level) ? '#9A3092' : /^4$/.test(level) ? '#EEA650' : PALETTE[index%PALETTE.length];
    return {color,opacity,fill:FILL_CHOICES[index%FILL_CHOICES.length]};
  }
  function addFactor(col){
    if(!col||state.factors.some(f=>f.col===col))return;
    const used=new Set(state.factors.map(f=>f.channel));
    const channel=CHANNELS.find(c=>!used.has(c))||'position';
    const values=state.levels.get(col);
    const styles=Object.fromEntries(values.map((v,i)=>[v,defaultStyle(v,i,values.length,col)]));
    state.factors.push({col,channel,styles,order:[...values],collapsed:false});
    renderFactorControls();updateAddSelectors();computeAndRender();
  }
  function setChannel(factorIndex, channel) {
    const changing=state.factors[factorIndex],previous=changing.channel;
    const displaced=state.factors.findIndex((f,i)=>i!==factorIndex&&f.channel===channel&&channel!=='position');
    if(displaced!==-1)state.factors[displaced].channel=previous==='position'?'position':previous;
    changing.channel=channel;
    renderFactorControls();computeAndRender();
  }
  function resetStyles(){
    state.factors.forEach(f=>{
      const ls=state.levels.get(f.col);
      f.styles=Object.fromEntries(ls.map((v,i)=>[v,defaultStyle(v,i,ls.length,f.col)]));
    });
    renderFactorControls();computeAndRender();
  }
  function renderFactorControls(){
    const root=$('factorList');root.replaceChildren();
    if(!state.factors.length){root.innerHTML='<p class="empty-mini">No factors yet — one overall bar.</p>';return;}
    state.factors.forEach((f,index)=>{
      const card=document.createElement('div');card.className='factor-item';card.draggable=true;card.dataset.index=index;
      const head=document.createElement('div');head.className='factor-header';
      const grip=document.createElement('button');grip.type='button';grip.className='drag-handle';grip.textContent='⠿';grip.title='Drag to reorder factor';
      const toggle=document.createElement('button');toggle.type='button';toggle.className='factor-collapse';
      toggle.setAttribute('aria-label',`${f.collapsed?'Expand':'Collapse'} ${f.col} settings`);
      toggle.setAttribute('aria-expanded',String(!f.collapsed));
      toggle.innerHTML=`<span class="factor-name"><span class="factor-num">${index+1}.</span>${escapeHTML(f.col)}</span><span class="factor-chevron" aria-hidden="true"></span>`;
      const up=document.createElement('button');up.className='mini-move';up.type='button';up.title='Move grouping outward';up.setAttribute('aria-label',`Move ${f.col} outward`);up.textContent='↑';up.style.cssText='background:none;border:0;color:#d5e8ed;padding:0 2px';up.disabled=index===0;
      const down=document.createElement('button');down.className='mini-move';down.type='button';down.title='Move grouping inward';down.setAttribute('aria-label',`Move ${f.col} inward`);down.textContent='↓';down.style.cssText='background:none;border:0;color:#d5e8ed;padding:0 2px';down.disabled=index===state.factors.length-1;
      const remove=document.createElement('button');remove.type='button';remove.className='remove-button';remove.title='Remove factor';remove.setAttribute('aria-label',`Remove ${f.col}`);remove.textContent='×';
      head.append(grip,toggle,up,down,remove);card.append(head);
      const body=document.createElement('div');body.className='factor-body';body.id=`factor-body-${index}`;
      body.hidden=!!f.collapsed;card.classList.toggle('is-collapsed',!!f.collapsed);
      toggle.setAttribute('aria-controls',body.id);
      toggle.addEventListener('click',()=>{
        f.collapsed=!f.collapsed;
        body.hidden=f.collapsed;
        card.classList.toggle('is-collapsed',f.collapsed);
        toggle.setAttribute('aria-expanded',String(!f.collapsed));
        toggle.setAttribute('aria-label',`${f.collapsed?'Expand':'Collapse'} ${f.col} settings`);
      });
      remove.addEventListener('click',()=>{state.factors.splice(index,1);renderFactorControls();updateAddSelectors();computeAndRender();});
      for(const [btn,to] of [[up,index-1],[down,index+1]])btn.addEventListener('click',()=>{const moved=state.factors.splice(index,1)[0];state.factors.splice(to,0,moved);renderFactorControls();computeAndRender();});
      card.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',String(index));e.dataTransfer.effectAllowed='move';card.classList.add('dragging');});
      card.addEventListener('dragend',()=>card.classList.remove('dragging'));
      card.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';});
      card.addEventListener('drop',e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));if(from===index||!Number.isInteger(from)||from<0||from>=state.factors.length)return;const moved=state.factors.splice(from,1)[0];state.factors.splice(index,0,moved);renderFactorControls();computeAndRender();});
      const setting=document.createElement('div');setting.className='factor-representation';
      const label=document.createElement('label');label.textContent='Represent as';
      const channel=document.createElement('select');channel.className='factor-channel';channel.setAttribute('aria-label',`Visual encoding for ${f.col}`);
      CHANNELS.forEach(v=>channel.append(option(CHANNEL_NAMES[v],v,v===f.channel)));
      channel.addEventListener('change',()=>setChannel(index,channel.value));
      setting.append(label,channel);body.append(setting);
      const levelHeading=document.createElement('div');levelHeading.className='level-heading';
      levelHeading.innerHTML='<span>Level order <small>· outer to inner</small></span><span class="level-heading-caption">APPEARANCE</span>';
      body.append(levelHeading);
      const list=document.createElement('div');list.className='factor-levels';
      f.order.forEach((level,levelIndex)=>{
        const row=document.createElement('div');row.className='level-row';
        const labelArea=document.createElement('div');labelArea.className='level-name-area';
        const reorders=document.createElement('div');reorders.className='level-order-buttons';
        const upLevel=document.createElement('button');upLevel.type='button';upLevel.className='level-move';upLevel.textContent='↑';upLevel.title=`Move ${pretty(level)} earlier`;upLevel.setAttribute('aria-label',`Move ${pretty(level)} earlier`);upLevel.disabled=levelIndex===0;
        const downLevel=document.createElement('button');downLevel.type='button';downLevel.className='level-move';downLevel.textContent='↓';downLevel.title=`Move ${pretty(level)} later`;downLevel.setAttribute('aria-label',`Move ${pretty(level)} later`);downLevel.disabled=levelIndex===f.order.length-1;
        const moveLevel=direction=>{const to=levelIndex+direction;if(to<0||to>=f.order.length)return;[f.order[levelIndex],f.order[to]]=[f.order[to],f.order[levelIndex]];renderFactorControls();computeAndRender();};
        upLevel.addEventListener('click',()=>moveLevel(-1));downLevel.addEventListener('click',()=>moveLevel(1));
        reorders.append(upLevel,downLevel);
        const name=document.createElement('span');name.className='level-name';name.textContent=pretty(level);name.title=pretty(level);
        labelArea.append(reorders,name);row.append(labelArea);
        const s=f.styles[level];
        if(f.channel==='color'){
          const input=document.createElement('input');input.type='color';input.value=s.color;input.setAttribute('aria-label',`Color for ${level}`);
          input.addEventListener('input',()=>{s.color=input.value;computeAndRender();});row.append(input);
        } else if(f.channel==='opacity'){
          const wrap=document.createElement('span');wrap.className='opacity-control';
          const slider=document.createElement('input');slider.type='range';slider.min='15';slider.max='100';slider.step='5';slider.value=String(Math.round(s.opacity*100));
          const percent=document.createElement('span');percent.textContent=`${Math.round(s.opacity*100)}%`;
          slider.setAttribute('aria-label',`Opacity for ${level}`);
          slider.addEventListener('input',()=>{s.opacity=Number(slider.value)/100;percent.textContent=`${slider.value}%`;computeAndRender();});
          wrap.append(slider,percent);row.append(wrap);
        } else if(f.channel==='fill'){
          const select=document.createElement('select');select.setAttribute('aria-label',`Fill pattern for ${level}`);
          for(const value of FILL_CHOICES)select.append(option(value[0].toUpperCase()+value.slice(1),value,value===s.fill));
          select.addEventListener('change',()=>{s.fill=select.value;computeAndRender();});row.append(select);
        }else{
          const hint=document.createElement('span');hint.className='level-preview';hint.textContent='Grouped on x-axis';row.append(hint);
        }
        list.append(row);
      });
      body.append(list);card.append(body);root.append(card);
    });
  }
  function addFilter(col){
    if(!col||state.filters.has(col))return;
    state.filters.set(col,{allowed:new Set(state.levels.get(col)),open:true,search:''});
    renderFilterControls();updateAddSelectors();computeAndRender();
  }
  function renderFilterControls() {
    const root=$('filterList');root.replaceChildren();
    if(!state.filters.size){root.innerHTML='<p class="empty-mini">All rows included.</p>';return;}
    for(const [col, filter] of state.filters){
      const card=document.createElement('div');card.className='filter-item';
      const head=document.createElement('div');head.className='filter-header';
      const name=document.createElement('span');name.className='filter-name';name.textContent=col;
      const toggle=document.createElement('button');toggle.className='filter-toggle';toggle.type='button';toggle.textContent=filter.open?'Hide':'Edit';
      toggle.addEventListener('click',()=>{filter.open=!filter.open;renderFilterControls();});
      const remove=document.createElement('button');remove.type='button';remove.className='remove-button';remove.title=`Remove ${col} filter`;remove.textContent='×';
      remove.addEventListener('click',()=>{state.filters.delete(col);renderFilterControls();updateAddSelectors();computeAndRender();});
      head.append(name,toggle,remove);card.append(head);
      const note=document.createElement('p');note.className='filter-summary';
      note.textContent=`${filter.allowed.size} of ${state.levels.get(col).length} values included`;
      card.append(note);
      if(filter.open){
        const panel=document.createElement('div');panel.className='filter-panel';
        const buttons=document.createElement('div');buttons.className='filter-actions';
        const all=document.createElement('button');all.type='button';all.textContent='Select all';
        const none=document.createElement('button');none.type='button';none.textContent='Clear all';
        all.addEventListener('click',()=>{filter.allowed=new Set(state.levels.get(col));renderFilterControls();computeAndRender();});
        none.addEventListener('click',()=>{filter.allowed.clear();renderFilterControls();computeAndRender();});
        buttons.append(all,none);panel.append(buttons);
        const search=document.createElement('input');search.className='filter-search';search.placeholder='Search values…';search.value=filter.search;
        search.setAttribute('aria-label',`Search ${col} filter values`);
        const options=document.createElement('div');options.className='filter-options';
        const more=document.createElement('p');more.className='filter-more';more.style.margin='7px 0 0';
        const drawOptions=()=>{
          const matching=state.levels.get(col).filter(v=>pretty(v).toLowerCase().includes(filter.search.toLowerCase()));
          const limit=220;options.replaceChildren();
          for(const value of matching.slice(0,limit)){
            const lab=document.createElement('label');lab.className='filter-option';
            const cb=document.createElement('input');cb.type='checkbox';cb.checked=filter.allowed.has(value);
            cb.addEventListener('change',()=>{
              cb.checked?filter.allowed.add(value):filter.allowed.delete(value);
              note.textContent=`${filter.allowed.size} of ${state.levels.get(col).length} values included`;
              computeAndRender();
            });
            const val=document.createElement('span');val.textContent=pretty(value);
            const count=document.createElement('em');count.textContent=String(state.levelCounts.get(col).get(value)||0);
            lab.append(cb,val,count);options.append(lab);
          }
          more.textContent=matching.length>limit?`Showing first ${limit} of ${matching.length} matches — refine search.`:matching.length===0?'No matching values.':'';
        };
        search.addEventListener('input',()=>{filter.search=search.value;drawOptions();});
        panel.append(search,options,more);card.append(panel);drawOptions();
      }
      root.append(card);
    }
  }
  function includedRows() {
    const filters=[...state.filters];
    return state.rows.filter(row=>filters.every(([col,f])=>f.allowed.has(row[col])));
  }
  function aggregate() {
    const rows=includedRows(), factors=factorColumns(), subjects=new Set();
    const cells=new Map();let includedNumeric=0;
    for(const r of rows){
      const subject=r[state.subject];if(!subject)continue;
      const value=getNumber(r[state.measure]);if(value===null)continue;
      subjects.add(subject);includedNumeric++;
      const vals=factors.map(c=>r[c]);const key=JSON.stringify(vals);
      if(!cells.has(key))cells.set(key,{key,vals,perSubject:new Map()});
      const cell=cells.get(key);const entry=cell.perSubject.get(subject)||{sum:0,count:0};
      entry.sum+=value;entry.count++;cell.perSubject.set(subject,entry);
    }
    const summary=[...cells.values()].map(cell=>{
      const subjectMeans=[...cell.perSubject.values()].map(v=>v.sum/v.count);
      const point=summarize(subjectMeans,state.statistic), sd=stdev(subjectMeans),n=subjectMeans.length;
      let margin=0;
      if(state.statistic==='mean'&&sd!==null){
        if(state.error==='sd')margin=sd;
        else if(state.error==='sem')margin=sd/Math.sqrt(n);
        else if(state.error==='ci')margin=1.96*sd/Math.sqrt(n); // Normal-approximation 95% CI
      }
      return {key:cell.key,vals:cell.vals,value:point,sd,margin,n,rows:[...cell.perSubject.values()].reduce((a,v)=>a+v.count,0)};
    }).filter(v=>v.value!==null);
    summary.sort((a,b)=>{for(let i=0;i<factors.length;i++){
      const factor=state.factors[i];
      const ai=factor.order.indexOf(a.vals[i]),bi=factor.order.indexOf(b.vals[i]);
      if(ai!==bi)return ai-bi;
      const v=compareValues(a.vals[i],b.vals[i]);if(v)return v;
    }return 0;});
    return {summary, rows:includedNumeric, subjects:subjects.size,totalFilteredRows:rows.length};
  }
  function computeAndRender(){
    const ready=!!state.rows.length&&!!state.subject&&!!state.measure&&state.measure!==state.subject;
    const value=$('measureSelect');
    if(ready){
      const {summary,rows,subjects,totalFilteredRows}=aggregate();
      state.lastSummary=summary;state.lastIncludedRows=rows;state.lastSubjectCount=subjects;
      $('metricRows').textContent=rows.toLocaleString();
      $('metricRowSub').textContent=rows===totalFilteredRows?'Valid plotted rows':`${(totalFilteredRows-rows).toLocaleString()} rows excluded (missing data)`;
      $('metricSubjects').textContent=subjects.toLocaleString();$('metricBars').textContent=summary.length.toLocaleString();
      $('metricFactors').textContent=String(state.factors.length);
      $('chartHeading').textContent=state.title||`${state.measure} by ${state.factors.length?factorColumns().join(' × '):'all participants'}`;
      $('chartSubtitle').textContent=`${{mean:'Mean',sd:'Standard deviation',variance:'Variance',max:'Maximum',min:'Minimum',median:'Median'}[state.statistic]} of participant-level trial means`;
      const renderable=summary.length>0 && summary.length<=350;
      $('chartContent').hidden=!renderable;$('chartEmpty').hidden=renderable;
      if(!summary.length){
        showEmpty('No matching observations','Try selecting more filter values or another numeric measure.',false);
      } else if(summary.length>350){
        showEmpty('Too many bars to show',`These factors produce ${summary.length} combinations. Narrow your filters or remove a factor to plot 350 bars or fewer.`,false);
      } else renderChart(summary);
      for(const id of ['exportSvg','exportPng','exportCsv','replayAnimation'])$(id).disabled=!renderable || (id==='replayAnimation'&&!state.lastTransitionFrom);
    } else {
      $('chartContent').hidden=true;$('chartEmpty').hidden=false;
      $('metricRows').textContent=state.rows.length?state.rows.length.toLocaleString():'—';
      $('metricRowSub').textContent=state.rows.length?'Loaded rows':'From uploaded data';
      $('metricSubjects').textContent='—';$('metricBars').textContent='—';$('metricFactors').textContent=String(state.factors.length);
      $('chartHeading').textContent='Explore your data';
      $('chartSubtitle').textContent=state.rows.length?'Select a participant ID and a measure to begin.':'Upload a CSV or start with a demonstration dataset.';
      showEmpty('Your canvas is ready','Choose a participant column and a numeric measure to see the first bar. Add factors to watch it branch into groups.',true);
      ['exportSvg','exportPng','exportCsv','replayAnimation'].forEach(id=>$(id).disabled=true);
      state.chartSnapshot=null;
    }
    // Errors are meaningful for the average, not the other descriptive statistics.
    $('errorSelect').disabled=state.statistic!=='mean';
  }
  function showEmpty(title,message,showDemo){
    $('chartEmpty').querySelector('h3').textContent=title;
    $('chartEmpty').querySelector('p').textContent=message;
    $('emptyDemo').hidden=!showDemo;
  }
  // The chart remains viewport-wide until even compact 14 px bars cannot fit.
  // Axis labels are laid out separately, with wrapping and rotation instead of truncation.
  function labelWidth(label,size=12){
    const ctx=labelWidth.canvas || (labelWidth.canvas=document.createElement('canvas').getContext('2d'));
    ctx.font=`${size}px "PT Serif", Georgia, serif`;
    return ctx.measureText(String(label)).width;
  }
  function wrapLabel(label,maxWidth,limit=6){
    const words=String(label).split(/\s+/).filter(Boolean);
    if(!words.length)return [''];
    const result=[];let line='';
    for(const word of words){
      if(labelWidth(word)>maxWidth)return null; // Never chop up the user's labels.
      const test=line ? line+' '+word : word;
      if(line && labelWidth(test)>maxWidth){result.push(line);line=word;}else line=test;
    }
    if(line)result.push(line);
    return result.length<=limit ? result : null;
  }
  function axisGroups(items,fi){
    const groups=[];let start=0;
    for(let i=1;i<=items.length;i++){
      const changed=i===items.length || items[i].vals.slice(0,fi+1).some((v,j)=>v!==items[start].vals[j]);
      if(!changed)continue;
      const left=items[start].x, right=items[i-1].x+items[i-1].w;
      groups.push({left,right,center:(left+right)/2,label:pretty(items[start].vals[fi])});start=i;
    }
    return groups;
  }
  function axisLayout(items,factors){
    if(!factors.length)return {rows:[],height:64};
    const rows=[];let total=0;
    for(let fi=factors.length-1;fi>=0;fi--){
      const groups=axisGroups(items,fi);let maxHeight=30;
      for(const group of groups){
        const cellWidth=group.right-group.left;
        const room=Math.max(12,cellWidth+3);
        const fullWidth=labelWidth(group.label);
        let lines=fullWidth<=room?[group.label]:wrapLabel(group.label,room,6);
        let rotate=0;
        if(!lines || (cellWidth<48 && fullWidth>room)){
          // Steep diagonal labels use vertical space, not extra chart width.
          rotate=cellWidth<26 ? -80 : cellWidth<44 ? -75 : -65;
          lines=[group.label];
        }
        group.lines=lines;group.rotate=rotate;
        const height=rotate?Math.min(260,Math.ceil(fullWidth*Math.sin(-rotate*Math.PI/180)+22)):lines.length*16+16;
        maxHeight=Math.max(maxHeight,height);
      }
      rows.push({fi,groups,height:maxHeight});total+=maxHeight;
    }
    return {rows,height:total+39};
  }
  function geometry(summary) {
    const n=summary.length, count=state.factors.length;
    const stage=$('chartStage');
    const availableWidth=Math.max(320,Math.floor(stage.clientWidth)-4);
    const left=112,right=29;
    const availablePlotWidth=Math.max(120,availableWidth-left-right-10);
    const preferredBar=n===1?95:n<=8?57:n<=20?44:n<=50?35:27;
    const minBar=14;
    // Larger gaps indicate changes to an outer factor, creating a nested pivot layout.
    const gapStrength=[];
    for(let i=1;i<n;i++){
      let first=count-1;
      for(let j=0;j<count;j++)if(summary[i].vals[j]!==summary[i-1].vals[j]){first=j;break;}
      gapStrength.push(count===0?0:count-1-first);
    }
    function calculateGap(bar){
      const base=Math.max(3,Math.min(13,bar*.19));
      return gapStrength.map(k=>base + k*Math.max(2,bar*.32));
    }
    let barW=preferredBar,gaps=calculateGap(barW);
    let occupied=n*barW+gaps.reduce((a,b)=>a+b,0);
    if(occupied>availablePlotWidth){
      let lo=minBar,hi=preferredBar;
      // Squeeze both bars and gaps down before requiring horizontal scrolling.
      for(let i=0;i<28;i++){
        const mid=(lo+hi)/2;
        const g=calculateGap(mid);
        const used=n*mid+g.reduce((a,b)=>a+b,0);
        if(used>availablePlotWidth)hi=mid;else lo=mid;
      }
      barW=lo;gaps=calculateGap(barW);occupied=n*barW+gaps.reduce((a,b)=>a+b,0);
    }
    const width=Math.ceil(Math.max(availableWidth,occupied+left+right+14));
    const items=[];
    let x=left+(width-left-right-occupied)/2;
    for(let i=0;i<n;i++){
      if(i)x+=gaps[i-1];
      items.push({...summary[i],x,w:barW});x+=barW;
    }
    const axes=axisLayout(items,factorColumns());
    const plotTop=52,plotBottom=440;
    const chartHeight=plotBottom+axes.height+22;
    let lowest=0,highest=0;
    for(const item of summary){lowest=Math.min(lowest,item.value-item.margin);highest=Math.max(highest,item.value+item.margin);}
    const spread=highest-lowest||Math.max(1,Math.abs(highest));
    lowest=lowest<0?lowest-spread*.09:0;
    highest=highest>0?highest+spread*.13:spread*.4;
    if(highest<=lowest)highest=lowest+1;
    const scaleY=v=>plotBottom-(v-lowest)/(highest-lowest)*(plotBottom-plotTop);
    const baseline=scaleY(0);
    items.forEach(item=>{
      const v=scaleY(item.value);
      Object.assign(item,{y:Math.min(v,baseline),h:Math.max(.5,Math.abs(v-baseline)),base:baseline,errorTop:scaleY(item.value+item.margin),errorBottom:scaleY(item.value-item.margin)});
    });
    return {width,chartHeight,plotTop,plotBottom,left,right,lowest,highest,scaleY,baseline,items,factors:factorColumns(),axes};
  }
  function svgEl(tag,attrs={},parent=null){
    const el=document.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attrs))if(value!==null&&value!==undefined)el.setAttribute(key,String(value));
    if(parent)parent.append(el);return el;
  }
  function textSVG(parent,x,y,str,attrs={}){const text=svgEl('text',{x,y,...attrs},parent);text.textContent=str;return text;}
  function niceTicks(min,max,count=5){
    const raw=(max-min)/count;
    const magnitude=10**Math.floor(Math.log10(raw));
    const normalized=raw/magnitude;
    const step=(normalized<=1?1:normalized<=2?2:normalized<=5?5:10)*magnitude;
    const start=Math.ceil(min/step)*step;
    const vals=[];for(let val=start,k=0;k<100&&val<=max+step*.0001;val+=step,k++)vals.push(Number(val.toPrecision(12)));
    return vals;
  }
  function paintFor(item,factors){
    if(!factors.length)return {color:'#000000',opacity:1,fill:'solid'};
    const style={color:'#000000',opacity:1,fill:'solid'};
    for(let i=0;i<factors.length;i++){
      const fact=state.factors.find(f=>f.col===factors[i]);
      if(!fact)continue;
      const v=item.vals[i],s=fact.styles[v];if(!s)continue;
      if(fact.channel==='color')style.color=s.color;
      if(fact.channel==='opacity')style.opacity=s.opacity;
      if(fact.channel==='fill')style.fill=s.fill;
    }
    return style;
  }
  function addPattern(defs,id,type){
    if(type==='solid')return;
    const p=svgEl('pattern',{id,patternUnits:'userSpaceOnUse',width:10,height:10},defs);
    if(type==='diagonal')svgEl('path',{d:'M-2 2 L2 -2 M0 10 L10 0 M8 12 L12 8',stroke:'#fff','stroke-opacity':'.86','stroke-width':'2.4',fill:'none'},p);
    if(type==='reverse')svgEl('path',{d:'M-2 8 L2 12 M0 0 L10 10 M8 -2 L12 2',stroke:'#fff','stroke-opacity':'.86','stroke-width':'2.4',fill:'none'},p);
    if(type==='dots'){svgEl('circle',{cx:2,cy:2,r:1.6,fill:'#fff','fill-opacity':'.87'},p);svgEl('circle',{cx:7,cy:7,r:1.6,fill:'#fff','fill-opacity':'.87'},p);}
    if(type==='cross'){svgEl('path',{d:'M-2 2 L2 -2 M0 10 L10 0 M8 12 L12 8 M-2 8 L2 12 M0 0 L10 10 M8 -2 L12 2',stroke:'#fff','stroke-opacity':'.75','stroke-width':'1.4',fill:'none'},p);}
    if(type==='horizontal')svgEl('path',{d:'M0 2 L10 2 M0 7 L10 7',stroke:'#fff','stroke-opacity':'.86','stroke-width':'2.1'},p);
  }
  function makeBar(layer, defs, item, factors, id, ghost=false) {
    const style=ghost && item.paint ? item.paint : paintFor(item,factors);
    const patternId=`hatch-${id}`;
    addPattern(defs,patternId,style.fill);
    const group=svgEl('g',{'class':'bar-group'},layer);
    const rect=svgEl('rect',{x:item.x,y:item.y,width:item.w,height:item.h,rx:1,fill:style.color,opacity:style.opacity,'class':'chart-bar'},group);
    const overlay=style.fill!=='solid'?svgEl('rect',{x:item.x,y:item.y,width:item.w,height:item.h,rx:1,fill:`url(#${patternId})`,opacity:style.opacity},group):null;
    const topLine=item.margin>0?svgEl('path',{class:'error-line',stroke:style.color,opacity:style.opacity,fill:'none'},group):null;
    const count=!ghost&&state.showValues?textSVG(group,item.x+item.w/2,item.y-9,formatNumber(item.value),{'text-anchor':'middle',class:'count-label'}):null;
    if(!ghost){
      const names=factors.map((f,i)=>`${f}: ${pretty(item.vals[i])}`).join('\n')||'All participants';
      const tip=svgEl('title',{},group);tip.textContent=`${names}\n${state.measure}: ${formatNumber(item.value,4)}\nn = ${item.n} participants`;
    }
    return {group,rect,overlay,topLine,count,style,item};
  }
  function updateBar(entry,frame,style,opacityFactor=1){
    const {rect,overlay,topLine,count}=entry;
    const a={x:frame.x,y:frame.y,width:Math.max(.1,frame.w),height:Math.max(.1,frame.h)};
    for(const [k,v] of Object.entries(a)){rect.setAttribute(k,v);if(overlay)overlay.setAttribute(k,v);}
    rect.setAttribute('fill',style.color);rect.setAttribute('opacity',Math.max(0,style.opacity*opacityFactor));
    if(overlay)overlay.setAttribute('opacity',Math.max(0,style.opacity*opacityFactor));
    if(topLine){
      const center=frame.x+frame.w/2,cap=Math.max(4,frame.w*.20);
      topLine.setAttribute('d',`M${center},${frame.errorTop}V${frame.errorBottom} M${center-cap},${frame.errorTop}H${center+cap} M${center-cap},${frame.errorBottom}H${center+cap}`);
      topLine.setAttribute('stroke',style.color);topLine.setAttribute('opacity',style.opacity*opacityFactor);
      topLine.setAttribute('stroke-dasharray',style.fill==='solid'?'none':style.fill==='dots'?'2 3':'4 2');
    }
    if(count){count.setAttribute('x',frame.x+frame.w/2);count.setAttribute('y',(frame.value>=0?frame.y-8:frame.y+frame.h+17));count.setAttribute('opacity',opacityFactor);}
  }
  function matching(items,fromFactors,toFactors,toVals){
    const common=fromFactors.filter(col=>toFactors.includes(col));
    return items.filter(old=>common.every(col=>old.vals[fromFactors.indexOf(col)]===toVals[toFactors.indexOf(col)]));
  }
  function startFrom(target, previous, nextFactors) {
    if(!previous||!previous.items.length)return {...target,x:target.x+target.w/2,w:0.5,y:target.base,h:0,errorTop:target.base,errorBottom:target.base};
    const matches=matching(previous.items,previous.factors,nextFactors,target.vals);
    if(!matches.length)return {...target,x:target.x+target.w/2,w:.5,y:target.base,h:0,errorTop:target.base,errorBottom:target.base};
    const avg=k=>matches.reduce((total,m)=>total+m[k],0)/matches.length;
    // When several old bars correspond to the same new cell, begin at their
    // center of mass; old bars will simultaneously converge toward this cell.
    const x=avg('x')+avg('w')/2-avg('w')/2;
    return {...target,x,w:avg('w'),y:avg('y'),h:avg('h'),errorTop:avg('errorTop'),errorBottom:avg('errorBottom'),value:avg('value')};
  }
  function interpolate(a,b,t){
    const keys=['x','w','y','h','errorTop','errorBottom','value'];const out={...b};
    keys.forEach(k=>out[k]=(a[k]??b[k])+((b[k]??0)-(a[k]??b[k]))*t);
    return out;
  }
  function cubicOut(t){return 1-Math.pow(1-t,3);}
  function renderChart(summary,replay=false){
    const geom=geometry(summary);
    const previous=replay ? state.lastTransitionFrom : state.chartSnapshot;
    if(!replay && previous)state.lastTransitionFrom=previous;
    const svg=$('chartSvg');svg.replaceChildren();
    svg.setAttribute('viewBox',`0 0 ${geom.width} ${geom.chartHeight}`);
    svg.setAttribute('width',geom.width);svg.setAttribute('height',geom.chartHeight);
    const defs=svgEl('defs',{},svg);
    const grid=svgEl('g',{},svg);
    for(const tick of niceTicks(geom.lowest,geom.highest,6)){
      const y=geom.scaleY(tick);
      svgEl('line',{x1:geom.left-6,y1:y,x2:geom.width-geom.right+2,y2:y,class:'gridline'},grid);
      textSVG(grid,geom.left-15,y+4,formatNumber(tick),{'text-anchor':'end',class:'axis-tick'});
    }
    svgEl('line',{x1:geom.left-6,y1:geom.baseline,x2:geom.width-geom.right+2,y2:geom.baseline,class:'baseline'},grid);
    const yTitle=state.ylabel||`${({mean:'Mean',sd:'SD',variance:'Variance',max:'Maximum',min:'Minimum',median:'Median'}[state.statistic])} ${state.measure}${state.statistic==='variance'?'²':''}`;
    textSVG(grid,25,(geom.plotTop+geom.plotBottom)/2,yTitle,{class:'axis-title','text-anchor':'middle',transform:`rotate(-90 25 ${(geom.plotTop+geom.plotBottom)/2})`});
    drawXAxis(svg,geom);
    const barLayer=svgEl('g',{},svg);
    const newBars=geom.items.map((item,i)=>makeBar(barLayer,defs,item,geom.factors,`cur-${i}`));
    const oldBars=[];
    const factorRemoved=previous && previous.factors.some(f=>!geom.factors.includes(f));
    if(factorRemoved){
      previous.items.forEach((old,i)=>{
        const possible=matching(geom.items,geom.factors,previous.factors,old.vals);
        if(!possible.length)return;
        const match=possible[0];
        const oldEntry=makeBar(barLayer,defs,old,previous.factors,`old-${i}`,true);
        oldBars.push({entry:oldEntry,old,target:match});
      });
    }
    const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration=reduced?0:state.speed;
    const starts=geom.items.map(item=>startFrom(item,previous,geom.factors));
    const startColors=starts.map((item,i)=>{
      const matches=previous?matching(previous.items,previous.factors,geom.factors,geom.items[i].vals):[];
      return matches.length?(matches[0].paint?.color || paintFor(matches[0],previous.factors).color):newBars[i].style.color;
    });
    const token=++state.motionToken;
    const apply=(p)=>{
      if(token!==state.motionToken)return;
      const eased=cubicOut(p);
      newBars.forEach((entry,i)=>{
        const pos=interpolate(starts[i],geom.items[i],eased);
        const color=colorMix(startColors[i],entry.style.color,eased);
        const alpha=previous?.items.length ? (starts[i].w===.5?eased:factorRemoved?.30+.70*eased:.7+.3*eased) : eased;
        updateBar(entry,pos,{...entry.style,color},alpha);
      });
      oldBars.forEach(({entry,old,target})=>{
        const ghostTo={...old,x:target.x,y:target.y,w:target.w,h:target.h,
          errorTop:target.errorTop,errorBottom:target.errorBottom,value:target.value};
        const pos=interpolate(old,ghostTo,eased);
        updateBar(entry,pos,entry.style,(1-eased)*.8);
      });
    };
    if(duration===0)apply(1);
    else {
      apply(0);
      let origin=null;
      const frame=(now)=>{
        if(token!==state.motionToken)return;
        if(origin===null)origin=now;
        const t=Math.min(1,(now-origin)/duration);
        apply(t);
        if(t<1)requestAnimationFrame(frame);
        else oldBars.forEach(b=>b.entry.group.remove());
      };
      requestAnimationFrame(frame);
    }
    state.chartSnapshot={items:geom.items.map(i=>({...i,paint:{...paintFor(i,geom.factors)}})),factors:[...geom.factors]};
    if(!replay)state.lastSummary=summary;
    updateLegend();
    $('plotFoot').replaceChildren();
    const note=document.createElement('span');note.textContent=`Bars summarize ${state.lastSubjectCount} participant(s); missing combinations are not drawn.`;
    const note2=document.createElement('span');note2.textContent=state.statistic==='mean' && state.error==='ci'?'95% CIs use normal approximation (±1.96 SEM).':'Hover over bars for group details and N.';
    $('plotFoot').append(note,note2);
  }
  function drawXAxis(svg,g){
    const layer=svgEl('g',{},svg);
    if(!g.factors.length){
      const item=g.items[0];textSVG(layer,item.x+item.w/2,g.plotBottom+30,'All participants',{'text-anchor':'middle',class:'x-label'});
      return;
    }
    let offset=0;
    for(const row of g.axes.rows){
      const y=g.plotBottom+27+offset;
      for(const group of row.groups){
        if(row.fi<g.factors.length-1)
          svgEl('line',{x1:group.left,y1:y-15,x2:group.right,y2:y-15,class:'axis-group-line'},layer);
        const label=group.label;
        if(group.rotate){
          textSVG(layer,group.center+3,y,label,{'text-anchor':'end',class:'x-label',transform:`rotate(${group.rotate} ${group.center+3} ${y})`});
        } else {
          group.lines.forEach((line,k)=>textSVG(layer,group.center,y+k*16,line,{'text-anchor':'middle',class:'x-label'}));
        }
      }
      textSVG(layer,g.left-15,y,g.factors[row.fi],{'text-anchor':'end',class:'x-factor-label'});
      offset+=row.height;
    }
  }
  function swatchStyle(v,channel){
    if(channel==='color')return `background:${v.color};`;
    if(channel==='opacity')return `background:#000000;opacity:${v.opacity};`;
    const base='#000000';
    if(channel==='fill'){
      const patterns={solid:'none',diagonal:'repeating-linear-gradient(135deg,transparent 0px,transparent 4px,#ffffffc7 4px,#ffffffc7 6px)',reverse:'repeating-linear-gradient(45deg,transparent 0px,transparent 4px,#ffffffc7 4px,#ffffffc7 6px)',dots:'radial-gradient(#ffffffc7 22%, transparent 27%)',cross:'repeating-linear-gradient(45deg,transparent 0px,transparent 4px,#ffffffc7 4px,#ffffffc7 6px),repeating-linear-gradient(135deg,transparent 0px,transparent 4px,#ffffffc7 4px,#ffffffc7 6px)',horizontal:'repeating-linear-gradient(0deg,transparent 0px,transparent 4px,#ffffffc7 4px,#ffffffc7 6px)'};
      return `background-color:${base};background-image:${patterns[v.fill]};background-size: ${v.fill==='dots'?'7px 7px':'auto'};`;
    }
    return `background:#000000;`;
  }
  function updateLegend(){
    const legend=$('legend');legend.replaceChildren();
    if(!state.factors.length){legend.innerHTML='<span class="legend-factor"><span class="legend-swatch" style="background:#000000"></span>Overall mean (all participants)</span>';return;}
    state.factors.forEach(f=>{
      const group=document.createElement('div');group.className='legend-factor';
      const title=document.createElement('strong');title.textContent=`${f.col} · ${CHANNEL_NAMES[f.channel]}`;group.append(title);
      for(const v of f.order){
        const val=document.createElement('span');val.className='legend-value';
        const swatch=document.createElement('span');swatch.className='legend-swatch';swatch.style.cssText=swatchStyle(f.styles[v],f.channel);
        const text=document.createElement('span');text.textContent=pretty(v);
        val.append(swatch,text);group.append(val);
      }
      legend.append(group);
    });
  }
  function downloadBlob(filename,blob){
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  function svgDownloadText(){
    const original=$('chartSvg').cloneNode(true);
    // Export standalone SVG without depending on external CSS or web fonts.
    const css=document.createElementNS(NS,'style');
    css.textContent=`text{font-family:Georgia,serif} .axis-tick{fill:#6e7c86;font-size:12px}.axis-title{font-size:14px;fill:#44596b;font-weight:700}.x-label{font-size:12px;fill:#455e70}.x-factor-label{font-size:10px;fill:#9ca8b0;font-family:Arial,sans-serif}.gridline{stroke:#e9eeed;stroke-width:1}.baseline{stroke:#a7b5ba;stroke-width:1.3}.count-label{font-size:11px;fill:#36546a}.axis-group-line{stroke:#e2e7e8;stroke-width:1}.error-line{stroke-width:1.6}`;
    original.insertBefore(css,original.firstChild);
    original.setAttribute('xmlns',NS);
    original.setAttribute('style','background:white');
    return new XMLSerializer().serializeToString(original);
  }
  function exportSVG(){
    if(!state.lastSummary.length)return;
    downloadBlob('visualization.svg',new Blob([svgDownloadText()],{type:'image/svg+xml;charset=utf-8'}));
  }
  async function exportPNG(){
    if(!state.lastSummary.length)return;
    const s=svgDownloadText(),svg=$('chartSvg'),width=Number(svg.getAttribute('width')),height=Number(svg.getAttribute('height'));
    const url=URL.createObjectURL(new Blob([s],{type:'image/svg+xml;charset=utf-8'}));
    const img=new Image();
    try{
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
      const canvas=document.createElement('canvas'),scale=2;
      canvas.width=width*scale;canvas.height=height*scale;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(scale,scale);ctx.drawImage(img,0,0);
      canvas.toBlob(blob=>{if(blob)downloadBlob('visualization.png',blob);else window.alert('Unable to export PNG. Try SVG instead.');},'image/png');
    }catch(err){window.alert('PNG export failed; please try SVG export.');}finally{URL.revokeObjectURL(url);}
  }
  function csvEscape(s){const t=String(s??'');return /[",\n\r]/.test(t)?`"${t.replace(/"/g,'""')}"`:t;}
  function exportCSV(){
    if(!state.lastSummary.length)return;
    const columns=[...factorColumns(),state.measure+' ('+state.statistic+')','N participants','Participant-mean SD','Error margin','N trials'];
    const csv=[columns,...state.lastSummary.map(item=>[...item.vals,item.value,item.n,item.sd??'',item.margin,item.rows])].map(line=>line.map(csvEscape).join(',')).join('\r\n');
    downloadBlob('visualization_summary.csv',new Blob([csv],{type:'text/csv;charset=utf-8'}));
  }
  function bind(){
    $('csvInput').addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(file)ingest(await file.text(),file.name);
      e.target.value='';
    });
    const upload=$('uploadZone');
    upload.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('csvInput').click();}});
    upload.addEventListener('dragover',e=>{e.preventDefault();upload.classList.add('drag-over');});
    upload.addEventListener('dragleave',()=>upload.classList.remove('drag-over'));
    upload.addEventListener('drop',async e=>{
      e.preventDefault();upload.classList.remove('drag-over');const file=e.dataTransfer?.files?.[0];if(file)ingest(await file.text(),file.name);
    });
    const demo=()=>ingest(demoCSV(),'Perceptual Load · sample data');
    $('loadDemo').addEventListener('click',demo);$('emptyDemo').addEventListener('click',demo);
    $('subjectSelect').addEventListener('change',e=>{
      state.subject=e.target.value;if(state.subject===state.measure){state.measure='';}
      // Existing selected factors that conflict with subject are removed.
      state.factors=state.factors.filter(f=>f.col!==state.subject);
      populateSelects();renderFactorControls();computeAndRender();
    });
    $('measureSelect').addEventListener('change',e=>{
      state.measure=e.target.value;state.factors=state.factors.filter(f=>f.col!==state.measure);
      renderFactorControls();updateAddSelectors();computeAndRender();
    });
    $('statSelect').addEventListener('change',e=>{state.statistic=e.target.value;if(state.statistic!=='mean'){state.error='none';$('errorSelect').value='none';}computeAndRender();});
    $('errorSelect').addEventListener('change',e=>{state.error=e.target.value;computeAndRender();});
    $('addFactorSelect').addEventListener('change',()=>{$('addFactorButton').disabled=!$('addFactorSelect').value;});
    $('addFactorButton').addEventListener('click',()=>addFactor($('addFactorSelect').value));
    $('addFilterSelect').addEventListener('change',()=>{$('addFilterButton').disabled=!$('addFilterSelect').value;});
    $('addFilterButton').addEventListener('click',()=>addFilter($('addFilterSelect').value));
    $('customTitle').addEventListener('input',e=>{state.title=e.target.value.trim();if(state.lastSummary.length)$('chartHeading').textContent=state.title||`${state.measure} by ${state.factors.length?factorColumns().join(' × '):'all participants'}`;});
    $('customYLabel').addEventListener('input',e=>{state.ylabel=e.target.value.trim();computeAndRender();});
    $('animationSpeed').addEventListener('change',e=>{state.speed=Number(e.target.value);});
    $('showValues').addEventListener('change',e=>{state.showValues=e.target.value==='yes';computeAndRender();});
    $('resetStyles').addEventListener('click',resetStyles);
    $('replayAnimation').addEventListener('click',()=>{if(state.lastTransitionFrom&&state.lastSummary.length)renderChart(state.lastSummary,true);});
    $('exportSvg').addEventListener('click',exportSVG);
    $('exportPng').addEventListener('click',exportPNG);
    $('exportCsv').addEventListener('click',exportCSV);
    let resizeTimer=null;window.addEventListener('resize',()=>{
      clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.lastSummary.length&&state.subject&&state.measure){const previousSpeed=state.speed;state.speed=0;renderChart(state.lastSummary);state.speed=previousSpeed;}},180);
    });
    updateAddSelectors();computeAndRender();
  }
  bind();
  // Expose a small test surface so a developer can validate CSV parsing and aggregation.
  window.DataVizStudio={parseCSV,aggregate,demoCSV,getState:()=>state};
})();
