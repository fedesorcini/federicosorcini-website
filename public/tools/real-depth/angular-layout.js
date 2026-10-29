/* Independent angular-coordinate STIMULUS layout.
 * This is deliberately not a warped camera image: rectilinear projection
 * cannot preserve straight room lines AND equal pixel spacings per degree.
 * No changes to WebGL, original camera, geometry, objects, or raycasting.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('angularViewPanel');
  const canvas = $('angularLayoutCanvas');
  const mode = $('projectionMode');
  const toggle = $('layoutViewBtn');
  if (!panel || !canvas || !mode || !toggle) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
  let active=false;
  let suspended=false;
  let lastSignature='';
  let lastSize='';
  let lastPaint=0;
  let hits=[];
  const rendering = {width:0,height:0,hFov:70,vFov:75,dpr:1};

  function bridge() {return window.realDepthTopViewBridge || null;}
  function snapshot() {
    try {return bridge()?.snapshot() || null;}
    catch (e) {console.error('Angular diagram data error',e);return null;}
  }
  function updateMode() {
    const want=mode.value==='angular' && !suspended;
    if (want!==active) {
      active=want;
      panel.hidden=!active;
      lastSignature='';
      if (active) draw();
    }
  }
  mode.addEventListener('change',updateMode);
  window.realDepthAngularViewSync = updateMode;
  window.realDepthAngularViewSuspend = (value) => { suspended=!!value; updateMode(); };

  function coords(o,w,h,hFov,vFov) {
    return {x:w*(0.5+o.positionXDeg/hFov),
            y:h*(0.5-o.positionYDeg/vFov),
            w:Math.max(1,o.angleXDeg*w/hFov),
            h:Math.max(1,o.angleYDeg*h/vFov)};
  }
  function paintGrid(w,h,hFov,vFov) {
    ctx.fillStyle='#f7fafb';ctx.fillRect(0,0,w,h);
    // Degree grid, independent of physical monitor calibration.
    ctx.font='11px Georgia,serif';ctx.textAlign='center';ctx.textBaseline='top';
    for(let a=Math.ceil(-hFov/20)*20;a<=hFov/2;a+=10){
      if(a< -hFov/2)continue;
      const x=w*(0.5+a/hFov);
      ctx.lineWidth=a===0?1.5:1;
      ctx.strokeStyle=a===0?'#a5b8c3':'#e3eaee';
      ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();
      ctx.fillStyle='#6b8190';ctx.fillText(`${a}°`,x,12);
    }
    for(let a=Math.ceil(-vFov/20)*20;a<=vFov/2;a+=10){
      if(a< -vFov/2)continue;
      const y=h*(0.5-a/vFov);
      ctx.lineWidth=a===0?1.5:1;
      ctx.strokeStyle=a===0?'#a5b8c3':'#e3eaee';
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
      if (a !== 0 && y>30 && y<h-15) {
        ctx.fillStyle='#6b8190';ctx.textAlign='left';
        ctx.fillText(`${a>0?'+':''}${a}°`,8,y+3);
      }
    }
    ctx.fillStyle='#324c63';ctx.textAlign='left';ctx.textBaseline='top';
    ctx.font='bold 15px Georgia,serif';ctx.fillText('Angular stimulus layout',15,37);
    ctx.font='12px Georgia,serif';ctx.fillStyle='#637d8c';
    ctx.fillText(`${hFov.toFixed(0)}° × ${vFov.toFixed(1)}° field · ${Math.round(w/hFov*10)/10} px/° horizontally`,15,57);
  }

  function draw() {
    if(!active)return;
    const b=bridge();
    const s=snapshot();
    if(!s || !b)return;
    const rect=canvas.getBoundingClientRect();
    if(rect.width<10 || rect.height<10)return;
    const w=rect.width,h=rect.height,dpr=Math.min(2,window.devicePixelRatio||1);
    const pw=Math.max(1,Math.round(w*dpr)),ph=Math.max(1,Math.round(h*dpr));
    if(canvas.width!==pw || canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const hFov=clamp(Number($('horizontalFovDeg')?.value)||70,20,150);
    const vFov=clamp(Number($('verticalFovDeg')?.value)||75,10,125);
    rendering.width=w;rendering.height=h;rendering.hFov=hFov;rendering.vFov=vFov;rendering.dpr=dpr;
    paintGrid(w,h,hFov,vFov);
    hits=[];
    const focus=s.objects.find(o=>o.id===s.focusedId);
    const focusRange=focus?Math.hypot(focus.xM,focus.yM,focus.distanceM):null;
    // Far first, so nearer stimuli visually cover farther ones, consistent
    // with painter's-order depth sorting of a stimulus-only diagram.
    for(const o of [...s.objects].sort((a,b)=>b.distanceM-a.distanceM)) {
      const p=coords(o,w,h,hFov,vFov);
      if(p.x+p.w/2 < -10 || p.x-p.w/2>w+10 || p.y+p.h/2< -10 || p.y-p.h/2>h+10) continue;
      const angle=(o.orientationDeg||0)*Math.PI/180;
      const tex=b.stimulusCanvas(o.id,clamp(Math.round(p.w*dpr),2,2048),clamp(Math.round(p.h*dpr),2,2048));
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(-angle); // Three.js +Z orientation = CCW on screen.
      if(s.optics?.blur && focusRange != null){
        const r=Math.hypot(o.xM,o.yM,o.distanceM);
        const deltaD=Math.abs(1/r-1/focusRange);
        // Angular circle-of-confusion approximation beta = pupil * deltaDiopters.
        const radius=Math.min(s.optics.maxBlurPx,0.5*(s.optics.pupilM*deltaD)*180/Math.PI*(w/hFov));
        if(radius>=.18)ctx.filter=`blur(${(radius/1.17741).toFixed(3)}px)`;
      }
      if(tex)ctx.drawImage(tex,-p.w/2,-p.h/2,p.w,p.h);
      ctx.restore();
      if(o.id===s.selectedId){
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(-angle);
        ctx.strokeStyle='#c4823e';ctx.lineWidth=2;ctx.strokeRect(-p.w/2-3,-p.h/2-3,p.w+6,p.h+6);
        ctx.restore();
      }
      hits.push({id:o.id,x:p.x,y:p.y,w:p.w,h:p.h,angle});
    }
    lastSize=`${w}|${h}|${dpr}`;
    lastSignature=JSON.stringify(s)+`|${hFov}|${vFov}`;
    lastPaint=performance.now();
  }

  canvas.addEventListener('pointerdown',e=>{
    if(!active || e.button!==0)return;
    const rect=canvas.getBoundingClientRect();
    const x=e.clientX-rect.left,y=e.clientY-rect.top;
    // Test in reverse drawing order; keep a minimum 12px clickable area.
    for(let i=hits.length-1;i>=0;i--){
      const o=hits[i],dx=x-o.x,dy=y-o.y;
      const c=Math.cos(o.angle),s=Math.sin(o.angle);
      // Inverse of canvas rotation(-angle).
      const ux=c*dx-s*dy,uy=s*dx+c*dy;
      if(Math.abs(ux)<=Math.max(o.w/2,7) && Math.abs(uy)<=Math.max(o.h/2,7)){
        bridge()?.selectObject(o.id);
        lastSignature='';draw();return;
      }
    }
  });

  window.addEventListener('resize',()=>{lastSize='';if(active)draw();});
  function tick(t){
    updateMode();
    if(active && t-lastPaint>110){
      const s=snapshot();
      const r=canvas.getBoundingClientRect();
      const sig=s?JSON.stringify(s)+`|${$('horizontalFovDeg').value}|${$('verticalFovDeg').value}`:'none';
      const sz=`${r.width}|${r.height}|${Math.min(2,window.devicePixelRatio||1)}`;
      if(sig!==lastSignature||sz!==lastSize || t-lastPaint>2000)draw();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.__realDepthAngularCheck=()=>({active,hitCount:hits.length,angularPositions:hits.map(o=>({id:o.id,x:o.x,w:o.w})),fov:rendering.hFov});
})();
