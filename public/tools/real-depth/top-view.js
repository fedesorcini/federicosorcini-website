/* Independent 2D overhead view for the Real Depth Simulator.
 * This script NEVER accesses WebGL, THREE, the original render loop, or optics.
 * It only reads scene object data through realDepthTopViewBridge.snapshot().
 */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const panel = byId('topViewPanel');
  const canvas = byId('topViewCanvas');
  const toggle = byId('toggleViewBtn');
  if (!panel || !canvas || !toggle) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const zoomLabel = byId('topZoomLabel');
  const zoomIn = byId('topZoomIn');
  const zoomOut = byId('topZoomOut');
  const zoomFit = byId('topZoomFit');
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 24;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const view = { active: false, zoom: 1, centerX: 0, centerD: 4,
    pointer: null, clickTargets: [], width: 1, height: 1, lastSignature: '' };
  const images = {};
  for (const key of ['apple','mug','stapler','banana']) {
    const img = new Image();
    img.src = `./images/${key}.png`;
    img.onload = () => { if (view.active) draw(); };
    images[key] = img;
  }

  function snapshot() {
    try { return window.realDepthTopViewBridge?.snapshot() || null; }
    catch (e) { console.warn('Overhead data read failed:', e); return null; }
  }
  function room(s) { return s?.room || {widthM:7, heightM:3, depthM:8}; }
  function dimensions() {
    const box = canvas.getBoundingClientRect();
    const width = Math.max(1,box.width), height = Math.max(1,box.height);
    const dpr = Math.min(2,window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width*dpr), pixelHeight = Math.round(height*dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    view.width=width; view.height=height;
    return {width,height};
  }
  function fitScale(s) {
    const r=room(s);
    // Keep the real-world room footprint, not object markers, to one scale.
    return Math.max(.001,Math.min((view.width-96)/r.widthM,(view.height-110)/r.depthM));
  }
  function scale(s) { return fitScale(s)*view.zoom; }
  function project(x,d,s) {
    const k=scale(s);
    return {x:view.width/2+(x-view.centerX)*k,
      y:view.height/2+(view.centerD-d)*k};
  }
  function unproject(x,y,s) {
    const k=scale(s);
    return {x:view.centerX+(x-view.width/2)/k,
      d:view.centerD-(y-view.height/2)/k};
  }
  function fit() {
    const s=snapshot();
    view.zoom=1;view.centerX=0;view.centerD=room(s).depthM/2;
    zoomLabel.textContent='100%';
    draw();
  }
  function setZoom(factor,x,y) {
    if (!view.active) return;
    const s=snapshot();if (!s) return;
    dimensions();
    const mx=x ?? view.width/2, my=y ?? view.height/2;
    const anchor=unproject(mx,my,s);
    const next=clamp(view.zoom*factor,MIN_ZOOM,MAX_ZOOM);
    if (next===view.zoom) return;
    view.zoom=next;
    const k=scale(s);
    view.centerX=anchor.x-(mx-view.width/2)/k;
    view.centerD=anchor.d+(my-view.height/2)/k;
    zoomLabel.textContent=`${Math.round(100*view.zoom)}%`;
    draw();
  }
  function setActive(active) {
    view.active=active;
    panel.hidden=!active;
    view.pointer=null;
    canvas.classList.remove('is-panning');
    if(active) {
      dimensions();
      const s=snapshot(), r=room(s);
      const footprint=`${r.widthM}|${r.depthM}`;
      // Fit to the actual room on first activation or after room dimensions change.
      if(view.lastFitFootprint!==footprint){
        view.lastFitFootprint=footprint;
        fit();
      } else draw();
    }
    // Intentionally DO NOT hide, resize, or stop #viewport's WebGL canvas.
  }
  zoomIn.addEventListener('click',()=>setZoom(1.25));
  zoomOut.addEventListener('click',()=>setZoom(1/1.25));
  zoomFit.addEventListener('click',fit);
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();
    const r=canvas.getBoundingClientRect();
    setZoom(Math.exp(-event.deltaY*.0016),event.clientX-r.left,event.clientY-r.top);
  },{passive:false});
  function local(event) {
    const rect=canvas.getBoundingClientRect();
    return {x:event.clientX-rect.left,y:event.clientY-rect.top};
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!view.active || event.button!==0) return;
    const pt=local(event);
    view.pointer={id:event.pointerId,x:pt.x,y:pt.y,
      centerX:view.centerX,centerD:view.centerD,dragged:false};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    const g=view.pointer;
    if (!g || g.id!==event.pointerId) return;
    const pt=local(event),dx=pt.x-g.x,dy=pt.y-g.y;
    if(Math.hypot(dx,dy)>5)g.dragged=true;
    if(!g.dragged) return;
    const s=snapshot();if(!s)return;
    const k=scale(s);
    view.centerX=g.centerX-dx/k;
    view.centerD=g.centerD+dy/k;
    canvas.classList.add('is-panning');
    draw();
  });
  canvas.addEventListener('pointerup',event=>{
    const g=view.pointer;
    if(!g || g.id!==event.pointerId) return;
    view.pointer=null;
    canvas.classList.remove('is-panning');
    if(g.dragged)return;
    const p=local(event);
    // Last-painted targets have priority where graphics overlap.
    const hit=[...view.clickTargets].reverse().find(t=>
      p.x>=t.x && p.x<=t.x+t.w && p.y>=t.y && p.y<=t.y+t.h);
    if(hit) window.realDepthTopViewBridge?.selectObject(hit.id);
    // Clicks in empty space intentionally do not alter the current selection.
    draw();
  });
  canvas.addEventListener('pointercancel',()=>{
    view.pointer=null;canvas.classList.remove('is-panning');
  });
  canvas.addEventListener('keydown',event=>{
    if(['+','=','-','_','0'].includes(event.key)) {
      event.preventDefault();event.stopPropagation();
      if(event.key==='0')fit();
      else setZoom(event.key==='-'||event.key==='_'?1/1.25:1.25);
    } else {
      // Prevent original arrow-key nudge handler from editing scene while
      // user interacts with the map: overhead is view-only, not an editor.
      event.stopPropagation();
    }
  });

  function roundedRect(x,y,w,h,r=5) {
    const radius=Math.min(r,w/2,h/2);
    ctx.beginPath();ctx.moveTo(x+radius,y);ctx.lineTo(x+w-radius,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+radius);
    ctx.lineTo(x+w,y+h-radius);ctx.quadraticCurveTo(x+w,y+h,x+w-radius,y+h);
    ctx.lineTo(x+radius,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-radius);
    ctx.lineTo(x,y+radius);ctx.quadraticCurveTo(x,y,x+radius,y);ctx.closePath();
  }

  // Draw a recognizable, orientation-aware miniature from the stimulus's own
  // type, text, color, image key, and frequency. It is a MAP SYMBOL, not a
  // claim that a front-facing texture is visible from directly above.
  function drawStimulusIcon(o,x,y,size=21) {
    const angle=(o.orientationDeg||0)*Math.PI/180;
    ctx.save();ctx.translate(x,y);ctx.rotate(-angle);
    ctx.fillStyle=o.color||'#16191d';ctx.strokeStyle=o.color||'#16191d';
    const type=o.type;
    if(type==='letter') {
      const value=String(o.text||'?').slice(0,3);
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font=`bold ${value.length>1?12:22}px Arial, sans-serif`;
      ctx.fillText(value,0,1);
    }else if(type==='circle') {
      ctx.beginPath();ctx.arc(0,0,size*.36,0,Math.PI*2);ctx.fill();
    }else if(type==='square') {
      ctx.fillRect(-size*.34,-size*.34,size*.68,size*.68);
    }else if(type==='triangle') {
      ctx.beginPath();ctx.moveTo(0,-size*.42);
      ctx.lineTo(-size*.42,size*.37);ctx.lineTo(size*.42,size*.37);
      ctx.closePath();ctx.fill();
    }else if(type==='arrow') {
      ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(-9,0);ctx.lineTo(8,0);ctx.moveTo(1,-6);ctx.lineTo(8,0);ctx.lineTo(1,6);ctx.stroke();
    }else if(type==='landolt') {
      ctx.lineWidth=4.1;ctx.beginPath();ctx.arc(0,0,size*.36,.28,2*Math.PI-.28);ctx.stroke();
    }else if(type==='gabor') {
      ctx.beginPath();ctx.arc(0,0,size*.46,0,2*Math.PI);ctx.clip();
      ctx.fillStyle='#e9e9e9';ctx.fillRect(-size/2,-size/2,size,size);
      const freq=Number(o.spatialFrequencyCpd)||1.5;
      const bars=clamp(Math.round(freq*2.4),2,12);
      for(let i=0;i<bars;i++){
        ctx.fillStyle=i%2?'#e7e7e7':'#444';
        ctx.fillRect(-size/2+i*size/bars,-size/2,size/bars+1,size);
      }
    }else if(type==='image' && images[o.imageKey]?.complete && images[o.imageKey]?.naturalWidth) {
      const im=images[o.imageKey];
      const k=Math.min(size/im.naturalWidth,size/im.naturalHeight);
      ctx.drawImage(im,-im.naturalWidth*k/2,-im.naturalHeight*k/2,im.naturalWidth*k,im.naturalHeight*k);
    }else {
      ctx.beginPath();ctx.arc(0,0,6,0,2*Math.PI);ctx.fill();
    }
    ctx.restore();
  }
  function draw() {
    if(!view.active)return;
    dimensions();
    const w=view.width,h=view.height;
    const s=snapshot();
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle='#f8fafb';ctx.fillRect(0,0,w,h);
    if(!s){
      ctx.fillStyle='#566977';ctx.font='14px Georgia,serif';ctx.textAlign='center';
      ctx.fillText('Loading scene data…',w/2,h/2);
      return;
    }
    const r=room(s),k=scale(s),objects=s.objects||[];
    const left=project(-r.widthM/2,0,s).x;
    const right=project(r.widthM/2,0,s).x;
    const top=project(0,r.depthM,s).y;
    const bottom=project(0,0,s).y;
    ctx.save();ctx.fillStyle='#eaf0f3';ctx.fillRect(left,top,right-left,bottom-top);
    ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    const spacing=k<13?4:k<28?2:k<70?1:.5;
    ctx.strokeStyle='#d5dfe4';ctx.lineWidth=1;
    for(let d=0;d<=r.depthM+.001;d+=spacing) {
      const y=project(0,d,s).y;
      ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
    }
    for(let x=Math.ceil((-r.widthM/2)/spacing)*spacing;x<=r.widthM/2;x+=spacing){
      const xx=project(x,0,s).x;
      ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.stroke();
    }
    ctx.strokeStyle='#9fb3be';ctx.setLineDash([5,5]);
    const center=project(0,0,s).x;
    ctx.beginPath();ctx.moveTo(center,top);ctx.lineTo(center,bottom);ctx.stroke();
    ctx.setLineDash([]);
    // Selected object's lateral viewing direction, when visible.
    const selected=objects.find(o=>o.id===s.selectedId);
    if(selected){
      const p=project(selected.xM,selected.distanceM,s),v=project(0,0,s);
      ctx.strokeStyle='rgba(196,130,62,.65)';ctx.lineWidth=1.3;ctx.setLineDash([4,5]);
      ctx.beginPath();ctx.moveTo(v.x,v.y);ctx.lineTo(p.x,p.y);ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.strokeStyle='#859eab';ctx.lineWidth=2;ctx.strokeRect(left,top,right-left,bottom-top);

    // Distance tick labels match the metrically scaled position map.
    ctx.textAlign='right';ctx.textBaseline='middle';ctx.font='11px Georgia,serif';
    ctx.fillStyle='#627985';
    const labelStep=k<28?4:k<55?2:1;
    for(let d=0;d<=r.depthM+.001;d+=labelStep){
      const p=project(0,d,s);
      if(p.y<52||p.y>h-39||left<44||left>w+30)continue;
      ctx.fillText(`${d} m`,left-9,p.y);
    }
    // A fixed scale bar; it reports actual length at the current zoom.
    const barLength=k<35?2:k>170?.25:1;
    const barPx=barLength*k;
    if(barPx<w*.45){
      const bx=17,by=h-46;
      ctx.strokeStyle='#5a7788';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx+barPx,by);
      ctx.moveTo(bx,by-4);ctx.lineTo(bx,by+4);
      ctx.moveTo(bx+barPx,by-4);ctx.lineTo(bx+barPx,by+4);ctx.stroke();
      ctx.fillStyle='#5a7788';ctx.textAlign='left';ctx.textBaseline='bottom';
      ctx.font='11px Georgia,serif';ctx.fillText(`${barLength} m`,bx,by-6);
    }
    const viewer=project(0,0,s);
    ctx.fillStyle='#324c63';ctx.strokeStyle='white';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(viewer.x,viewer.y-8);ctx.lineTo(viewer.x-6,viewer.y+6);
    ctx.lineTo(viewer.x+6,viewer.y+6);ctx.closePath();ctx.fill();ctx.stroke();
    if(viewer.y>=45 && viewer.y<h-16){
      ctx.fillStyle='#324c63';ctx.font='bold 10px Georgia,serif';ctx.textAlign='center';
      ctx.fillText('Viewer',viewer.x,viewer.y+20);
    }
    // Each object uses its actual x, distance, physical size, rotation,
    // properties and identifying glyph. No editing of source objects occurs.
    view.clickTargets=[];
    const usedLabels=[];
    const sorted=[...objects].sort((a,b)=>b.distanceM-a.distanceM);
    for(const o of sorted){
      const p=project(o.xM,o.distanceM,s);
      if(p.x< -120||p.x>w+120||p.y< -60||p.y>h+60)continue;
      const isSelected=o.id===s.selectedId,isFocus=o.id===s.focusedId;
      const theta=(o.orientationDeg||0)*Math.PI/180;
      const projectedWidth=Math.abs(o.widthM*Math.cos(theta)) + Math.abs(o.heightM*Math.sin(theta));
      // Physical top-down footprint of a vertical stimulus plane.
      ctx.strokeStyle=o.color||'#324c63';ctx.lineWidth=2.5;
      ctx.beginPath();ctx.moveTo(p.x-projectedWidth*k/2,p.y);
      ctx.lineTo(p.x+projectedWidth*k/2,p.y);ctx.stroke();
      // Separate fixed-size identifying preview; rotated to source orientation.
      ctx.beginPath();ctx.arc(p.x,p.y,14,0,Math.PI*2);
      ctx.fillStyle='#fff';ctx.fill();
      ctx.strokeStyle=isSelected?'#c4823e':isFocus?'#709c82':'#9badb7';
      ctx.lineWidth=isSelected||isFocus?3:1.4;ctx.stroke();
      drawStimulusIcon(o,p.x,p.y,20);
      view.clickTargets.push({id:o.id,x:p.x-16,y:p.y-16,w:32,h:32});
      const name=String(o.name||o.text||o.type||'Object').slice(0,20);
      // Map Y represents forward Z; label represents actual eye-to-object range.
      const eyeDistanceM=Math.hypot(Number(o.xM)||0,Number(o.yM)||0,Number(o.distanceM)||0);
      const text=`${name} · ${eyeDistanceM.toFixed(2)} m`;
      ctx.font='bold 11px Georgia,serif';
      const labelWidth=Math.min(w-20,Math.ceil(ctx.measureText(text).width+17)), labelHeight=23;
      // Choose an available label placement, avoiding markers and toolbar.
      const candidates=[
        [17,-28],[17,9],[-labelWidth-17,-28],[-labelWidth-17,9],
        [17,-57],[-labelWidth-17,-57],[17,40],[-labelWidth-17,40],
      ];
      for(const [dx,dy] of candidates){
        const x=p.x+dx,y=p.y+dy;
        if(x<8||x+labelWidth>w-8||y<62||y+labelHeight>h-50)continue;
        const overlaps=usedLabels.some(t=>x<t.x+t.w+3&&x+labelWidth+3>t.x&&y<t.y+t.h+3&&y+labelHeight+3>t.y);
        const hitsMarker=objects.some(other=>{
          const m=project(other.xM,other.distanceM,s);
          return m.x>x-14&&m.x<x+labelWidth+14&&m.y>y-14&&m.y<y+labelHeight+14;
        });
        if(overlaps||hitsMarker)continue;
        usedLabels.push({x,y,w:labelWidth,h:labelHeight});
        ctx.strokeStyle='rgba(102,123,136,.5)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(dx>0?x:x+labelWidth,y+labelHeight/2);ctx.stroke();
        roundedRect(x,y,labelWidth,labelHeight,5);
        ctx.fillStyle='#fff';ctx.fill();
        ctx.strokeStyle=isSelected?'#c4823e':isFocus?'#709c82':'#cbd6dd';
        ctx.lineWidth=isSelected||isFocus?2:1;ctx.stroke();
        ctx.fillStyle='#324c63';ctx.textAlign='left';ctx.textBaseline='middle';
        ctx.fillText(text,x+8,y+labelHeight/2,labelWidth-12);
        view.clickTargets.push({id:o.id,x,y,w:labelWidth,h:labelHeight});
        break;
      }
    }
    ctx.fillStyle='#324c63';ctx.font='bold 16px Georgia,serif';
    ctx.textAlign='left';ctx.textBaseline='top';
    ctx.fillText('Top view',14,14);
    ctx.fillStyle='#647988';ctx.font='11px Georgia,serif';
    ctx.fillText(`${r.widthM.toFixed(1)} m × ${r.depthM.toFixed(1)} m room · object footprints to scale`,15,36);
  }
  function animate(t){
    // The overhead map is an optional, independent read-only representation.
    // Polling the snapshot while visible also picks up edits made in panels.
    if(view.active && (!animate.last || t-animate.last>95)) {
      animate.last=t;
      const s=snapshot();
      const r=room(s), footprint=`${r.widthM}|${r.depthM}`;
      if(view.lastFitFootprint!==footprint){
        view.lastFitFootprint=footprint;
        fit();
      }
      const sig=s?JSON.stringify(s):'loading';
      const rect=canvas.getBoundingClientRect();
      const size=`${rect.width}|${rect.height}|${window.devicePixelRatio||1}`;
      if(sig!==view.lastSignature||size!==animate.size){
        view.lastSignature=sig;animate.size=size;draw();
      }
    }
    requestAnimationFrame(animate);
  }
  window.addEventListener('resize',()=>{if(view.active)draw();});
  requestAnimationFrame(animate);
  // Expose only read-only debug state for integration regression tests.
  window.realDepthTopViewSetActive = setActive;
  window.__realDepthOverheadCheck = ()=>({
    active:view.active,zoom:view.zoom,centerX:view.centerX,centerD:view.centerD,
    participantWidth:byId('viewport')?.getBoundingClientRect().width,
    participantHeight:byId('viewport')?.getBoundingClientRect().height,
    markers:view.clickTargets.length, dataAvailable:!!snapshot(),
  });
})();
