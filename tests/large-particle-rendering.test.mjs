import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';
import {
  samplePoint,makePoints,createFieldMotion,advanceFieldMotion,pointVisibility,transitionProgress,transitionDotWeight,
  particleGlyphSize,particleGlowRadius,particleGlowOpacity,particleHaloFalloff,paintParticleHalo,
  PARTICLE_HALO_TILE_SIZE,PARTICLE_HALO_MAX_RADIUS,PARTICLE_READABILITY_MARGIN,GLYPH_ATLAS_MAX_BYTES,
} from '../src/lib/glyph-field.ts';
import {clearCursorPointer,updateCursorPointer} from '../src/lib/cursor-pointer.ts';
const off={x:0,y:0,active:false};

test('dot and glyph use the same stable linear multiplier while normal particles retain their old size',()=>{
  const points=makePoints(1440,900),motion=createFieldMotion();let large=0,small=0;
  for(const time of[0,2,8,24,3600]){
    advanceFieldMotion(motion,time,1440,900);
    for(const point of points){
      const s=samplePoint(point,motion,1440,900,off);
      assert.ok(Math.abs(s.radius/(.24+1.01*s.brightness)-s.glyphSize/(5+9*s.brightness))<1e-12);
      assert.equal(s.glyphSize,particleGlyphSize(s.brightness,s.sizeMultiplier));
      assert.ok(s.glyphSize<=98&&s.glowRadius<=PARTICLE_HALO_MAX_RADIUS&&s.glowOpacity<=.12*s.luminance+1e-14);
      if(s.sizeMultiplier===1){small++;assert.equal(s.glyphSize,5+9*s.brightness);assert.equal(s.glowOpacity,0);}
      if(s.sizeMultiplier>3)large++;
      assert.deepEqual(samplePoint(point,motion,1440,900,off),s,'render properties never reroll ranks');
    }
  }
  assert.ok(large>20&&small>1000);assert.ok(PARTICLE_READABILITY_MARGIN>=98/2+9);
  assert.ok(PARTICLE_READABILITY_MARGIN>=PARTICLE_HALO_MAX_RADIUS+9);
});

test('the one cached halo has a monotone Gaussian shoulder and a broad C2-zero edge',()=>{
  assert.equal(particleHaloFalloff(0),1);
  let previous=1;
  for(let i=1;i<=10000;i++){
    const value=particleHaloFalloff(i/10000);assert.ok(value>=0&&value<=previous+1e-14);previous=value;
  }
  assert.equal(particleHaloFalloff(1),0);assert.equal(particleHaloFalloff(1.5),0);
  for(const radius of[.55,1]){
    const h=.00001,f=particleHaloFalloff;
    const dl=(f(radius)-f(radius-h))/h,dr=(f(radius+h)-f(radius))/h;
    const sl=(f(radius)-2*f(radius-h)+f(radius-2*h))/h**2;
    const sr=(f(radius+2*h)-2*f(radius+h)+f(radius))/h**2;
    assert.ok(Math.abs(dl-dr)<.001&&Math.abs(sl-sr)<.02,'broad tail has no ring or derivative seam');
  }
  const size=PARTICLE_HALO_TILE_SIZE,pixels=new Uint8ClampedArray(size*size*4);
  paintParticleHalo(pixels);assert.equal(pixels.byteLength,36864);
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const i=(row*size+col)*4,r=Math.hypot((col+.5)*2/size-1,(row+.5)*2/size-1);
    assert.deepEqual([...pixels.subarray(i,i+4)],[255,255,255,Math.round(255*particleHaloFalloff(r))]);
    if(row===0||col===0||row===size-1||col===size-1)assert.equal(pixels[i+3],0,'cache border is transparent');
  }
});

test('glyph size and emitted glow ease through large-rank, population and viewport fades',()=>{
  let opacity=0,radius=particleGlowRadius(1,1),size=particleGlyphSize(1,1);
  for(let step=0;step<=6000;step++){
    const multiplier=1+step/1000,o=particleGlowOpacity(multiplier,1),r=particleGlowRadius(1,multiplier),g=particleGlyphSize(1,multiplier);
    assert.ok(o>=opacity-1e-12&&o-opacity<.0001&&r>=radius&&g>=size);
    opacity=o;radius=r;size=g;
  }
  const point={...makePoints(400,300)[0],x:18,y:150,largeRank:0,sizeRank:1,densityRank:0,presence:1};
  const motion=createFieldMotion(),fx=18*2.6,fy=150*2.6;
  motion.evolution=[Math.PI/2-fx/285-fy/410,-fy/240+fx/610,Math.PI/2-fx/510+fy/330];
  const full=samplePoint(point,motion,400,300,off);assert.equal(full.glyphSize,98);assert.equal(full.glowOpacity,.12);
  for(const field of['x','presence']){
    let lastOpacity=0;
    for(let step=0;step<=1000;step++){
      point.x=field==='x'?18*step/1000:18;point.presence=field==='presence'?step/1000:1;
      const s=samplePoint(point,motion,400,300,off);
      assert.ok(s.glowOpacity>=lastOpacity-1e-12&&s.glowOpacity-lastOpacity<.002);
      assert.ok(Number.isFinite(s.glyphSize)&&s.glyphSize<=98);lastOpacity=s.glowOpacity;
      if(step===0)assert.equal(s.glowOpacity,0);
    }
  }
  point.presence=1;point.x=0;const edge=samplePoint(point,motion,400,300,off);
  assert.equal(pointVisibility(0,150,400,300),0);assert.equal(edge.luminance,0);assert.equal(edge.glowOpacity,0);
});

const source=await readFile(new URL('../src/scripts/glyph-field.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
  .replace(/from '(\.\.\/lib\/[^']+)'/g,(_,relative)=>`from '${new URL(`${relative}.ts`,new URL('../src/scripts/',import.meta.url)).href}'`)
  .replace(/\bsamplePoint\(/g,'globalThis.__particleSample(');
const{mountGlyphField}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function fixture(){
  const originals=new Map(['window','document','NodeFilter','__particleSample'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const canvases=[],callbacks=new Map(),styles=new Map();let main,latest,time=0,seconds=0,lastTime=0,nextId=0,allocations=0,uploads=0,draws=[],samples=[];
  class Canvas{
    width=300;height=150;dataset={};
    pen={globalAlpha:1,
      clearRect:()=>{if(this===main){draws=[];samples=[];}},setTransform(){},beginPath(){},fill(){},fillRect(){},fillText:glyph=>{this.glyph=glyph;},measureText:()=>({width:28}),
      createImageData:(w,h)=>{allocations++;return{width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},putImageData:()=>{uploads++;},
      arc:(x,y,r)=>{if(this===main)draws.push({kind:'dot',x,y,size:2*r,alpha:this.pen.globalAlpha,point:latest});},
      drawImage:(image,...args)=>{
        assert.ok(image.width&&image.height,'released caches cannot be drawn');
        if(this!==main||image.dataset.fieldLayer==='wash')return;
        const[x,y,width,height]=args.slice(-4);
        draws.push({layer:image.glyph?'target':'source',kind:image.dataset.fieldLayer==='particle-halo'?'halo':'glyph',x:x+width/2,y:y+height/2,size:width,height,alpha:this.pen.globalAlpha,point:latest});
      },
      set filter(_){throw Error('per-particle filters are forbidden');},set shadowBlur(_){throw Error('per-particle blur is forbidden');}};
    constructor(){canvases.push(this);}getContext(){return this.pen;}
  }
  const state={hit:''},motion=Object.assign(new EventTarget(),{matches:false});
  const window=Object.assign(new EventTarget(),{innerWidth:1440,innerHeight:900,devicePixelRatio:2,matchMedia:()=>motion,
    requestAnimationFrame(fn){callbacks.set(++nextId,fn);return nextId;},cancelAnimationFrame(id){callbacks.delete(id);}});
  const region={style:{getPropertyValue:k=>styles.get(k)??'',setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)},getBoundingClientRect:()=>({left:100,top:100,right:124,bottom:124})};
  const sourceElement={closest:()=>sourceElement};
  const document=Object.assign(new EventTarget(),{hidden:false,documentElement:new EventTarget(),querySelectorAll:()=>[region],createElement:()=>new Canvas(),
    elementFromPoint:()=>state.hit?sourceElement:null,createTreeWalker:()=>{let done=false;return{nextNode(){if(done)return null;done=true;return{textContent:state.hit};}};},
    createRange:()=>({setStart(){},setEnd(){},getClientRects:()=>[{left:0,top:0,right:1440,bottom:900,width:1440}]})});
  Object.assign(globalThis,{window,document,NodeFilter:{SHOW_TEXT:4},__particleSample:(point,...args)=>{const sample=samplePoint(point,...args);latest={id:point.id,seed:point.seed,largeRank:point.largeRank,sizeRank:point.sizeRank,presence:point.presence,progress:transitionProgress(point.transition,seconds),dotWeight:transitionDotWeight(point.transition,transitionProgress(point.transition,seconds)),...sample};samples.push(latest);return sample;}});
  for(const event of['pagehide'])window.addEventListener(event,()=>{lastTime=0;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)lastTime=0;});
  motion.addEventListener('change',()=>{lastTime=0;});
  clearCursorPointer();main=new Canvas();const cleanup=mountGlyphField(main);
  const frame=()=>{assert.equal(callbacks.size,1);const[id,fn]=callbacks.entries().next().value;callbacks.delete(id);time+=34;seconds+=lastTime?Math.min((time-lastTime)/1000,.1):0;lastTime=time;fn(time);};
  return{main,state,motion,window,document,canvases,callbacks,frame,run:n=>{for(let i=0;i<n;i++)frame();},skip:ms=>{time+=ms;},
    get draws(){return draws;},get samples(){return samples;},get allocations(){return allocations;},get uploads(){return uploads;},get localContrast(){return Number(styles.get('--home-background-luminance'));},
    close(){cleanup();clearCursorPointer();for(const[k,d]of originals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};
}
function verifyGeometry(f){
  for(const d of f.draws){
    const s=d.point;assert.ok(Math.abs(d.x-s.x)<1e-9&&Math.abs(d.y-s.y)<1e-9);
    const expected=d.kind==='glyph'?(5+9*s.brightness)*s.sizeMultiplier:d.kind==='dot'?2*s.radius:2*s.glowRadius;
    assert.ok(Math.abs(d.size-expected)<1e-9,`${d.kind} uses the same per-particle dimensions`);
    assert.ok(d.alpha>=0&&d.alpha<=s.luminance+1e-12);
    if(d.kind==='halo'){assert.equal(d.alpha,s.glowOpacity);assert.ok(s.sizeMultiplier>1);}
    else{
      const weight=d.kind==='dot'?s.dotWeight:d.layer==='source'?1-s.progress:s.progress;
      assert.ok(Math.abs(d.alpha-s.luminance*weight)<1e-12,'size/glow changes preserve existing transition alpha exactly');
    }
  }
}

test('actual dot to glyph to dot draws retain large scale, IDs and glow, leaving small glyphs unchanged',()=>{
  const f=fixture();
  try{
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));updateCursorPointer(720,450);
    verifyGeometry(f);const stable=()=>f.samples.map(({progress,dotWeight,...sample})=>sample);const before=structuredClone(stable()),halos=f.draws.filter(d=>d.kind==='halo').map(d=>[d.point.id,d.size,d.alpha]);
    f.state.hit='大';updateCursorPointer(720,450);verifyGeometry(f);
    assert.deepEqual(stable(),before,'representation never mutates sampled identities, ranks or field values');
    const glyphs=f.draws.filter(d=>d.kind==='glyph');
    assert.ok(glyphs.some(d=>d.point.sizeMultiplier>3&&d.size>40),'actual production glyph destinations include the large tail');
    assert.ok(glyphs.some(d=>d.point.sizeMultiplier===1&&d.size===5+9*d.point.brightness));
    assert.deepEqual(f.draws.filter(d=>d.kind==='halo').map(d=>[d.point.id,d.size,d.alpha]),halos);
    f.state.hit='';updateCursorPointer(720,450);verifyGeometry(f);
    assert.deepEqual(stable(),before);assert.equal(f.draws.filter(d=>d.kind==='glyph').length,0);
    assert.deepEqual(f.draws.filter(d=>d.kind==='halo').map(d=>[d.point.id,d.size,d.alpha]),halos);
    assert.equal(f.callbacks.size,0);
  }finally{f.close();}
});

test('interrupted animated glyph transitions retain scale/alpha and reuse a bounded halo cache',()=>{
  const f=fixture();
  try{
    f.frame();updateCursorPointer(720,450);f.run(12);
    const buffers=f.allocations;assert.equal(buffers,2,'one wash buffer and one initial halo upload');
    let glyphs=0,large=0;
    for(const hit of['大','字','','光','']){
      f.state.hit=hit;updateCursorPointer(720,450);
      for(let i=0;i<18;i++){
        f.frame();verifyGeometry(f);glyphs+=f.draws.filter(d=>d.kind==='glyph').length;
        large+=f.draws.filter(d=>d.kind==='glyph'&&d.point.sizeMultiplier>3).length;
      }
    }
    assert.ok(glyphs>100&&large>10);assert.equal(f.allocations,buffers);
    assert.equal(f.canvases.filter(c=>c.dataset.fieldLayer==='particle-halo').length,1);
    assert.equal(f.canvases.filter(c=>c.dataset.fieldLayer==='particle-halo')[0].width,PARTICLE_HALO_TILE_SIZE);
    const allocated=f.canvases.length;f.run(60);assert.equal(f.canvases.length,allocated,'steady frames allocate no new canvases');
    assert.ok(f.canvases.filter(c=>c.width&&c.height).length<=37);
    assert.ok(Number(f.main.dataset.transitionAtlasBytes)<=GLYPH_ATLAS_MAX_BYTES);assert.equal(f.callbacks.size,1);
    f.window.innerWidth=390;f.window.innerHeight=844;f.window.dispatchEvent(new Event('resize'));
    assert.equal(f.allocations,buffers+1,'resize only replaces the wash buffer, not the cached halo');
  }finally{const offscreen=f.canvases.slice(1);f.close();assert.ok(offscreen.every(c=>!c.width&&!c.height));}
});

test('large particle light obeys reduced-motion hidden resume, pointer exit and cleanup',()=>{
  const f=fixture();
  try{
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));updateCursorPointer(720,450);f.state.hit='字';updateCursorPointer(720,450);
    const frozen=f.samples.map(s=>[s.id,s.x,s.y,s.gradientLuminance,s.presence]);
    f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));f.skip(60000);
    f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(f.main.dataset.haloStrength,'0.0000');assert.equal(f.callbacks.size,0);
    assert.deepEqual(f.samples.map(s=>[s.id,s.x,s.y,s.gradientLuminance,s.presence]),frozen);
    verifyGeometry(f);f.motion.matches=false;f.motion.dispatchEvent(new Event('change'));f.frame();
    assert.deepEqual(f.samples.map(s=>[s.id,s.x,s.y,s.gradientLuminance,s.presence]),frozen);
    updateCursorPointer(720,450);f.run(10);clearCursorPointer();f.frame();
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));
    assert.equal(f.main.dataset.haloStrength,'0.0000');assert.equal(f.callbacks.size,0);verifyGeometry(f);
  }finally{f.close();}
});

test('readability observes large glyph/halo reach and conservatively composes halo overlap',()=>{
  const f=fixture();
  try{
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));updateCursorPointer(720,450);
    const margin=PARTICLE_READABILITY_MARGIN;
    const local=f.samples.filter(s=>s.x>=100-margin&&s.x<=124+margin&&s.y>=100-margin&&s.y<=124+margin);
    const core=Math.max(0,...local.map(s=>s.luminance));
    const halo=1-local.reduce((remaining,s)=>remaining*(1-s.glowOpacity),1);
    const expected=Math.min(1,core+(1-core)*halo+.2);
    assert.ok(Math.abs(f.localContrast-expected)<.0006,'actual text custom property includes bounded halo composition');
    assert.ok(f.localContrast+.001>=core+(1-core)*halo);
    assert.equal(f.main.dataset.particleGlowPolicy,'cached-large-particle-halo');
  }finally{f.close();}
});
