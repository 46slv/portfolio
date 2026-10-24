import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';
import {
  createFieldMotion,advanceFieldMotion,sampleLuminance,sampleGlobalLuminance,
  GLOBAL_SAMPLE_COLUMNS,GLOBAL_SAMPLE_ROWS,createGlobalPopulation,advanceGlobalPopulation,
  GLOBAL_POPULATION_RATE,pointCount,samplePoint,GLYPH_ATLAS_MAX_BYTES,
} from '../src/lib/glyph-field.ts';
import {clearCursorPointer,updateCursorPointer} from '../src/lib/cursor-pointer.ts';

test('global brightness is a fixed screen mean independent of pointer, point ranks and population',()=>{
  const motion=createFieldMotion();advanceFieldMotion(motion,12,390,844);
  let total=0;
  for(let row=0;row<GLOBAL_SAMPLE_ROWS;row++)for(let col=0;col<GLOBAL_SAMPLE_COLUMNS;col++){
    total+=sampleLuminance((col+.5)*390/GLOBAL_SAMPLE_COLUMNS,(row+.5)*844/GLOBAL_SAMPLE_ROWS,motion,{x:0,y:0,active:false});
  }
  const before=sampleGlobalLuminance(390,844,motion);
  assert.ok(Math.abs(before-total/(GLOBAL_SAMPLE_COLUMNS*GLOBAL_SAMPLE_ROWS))<1e-14);
  updateCursorPointer(120,120);
  assert.equal(sampleGlobalLuminance(390,844,motion),before);
  clearCursorPointer();
});

test('global population has a bounded positive relation, deadband, slew and paused state',()=>{
  let last=0;
  for(const light of [0,.1,.3,.5,.7,.9,1]){
    const state=createGlobalPopulation(2600,.5);
    let previous=state.count;
    for(let i=0;i<1200;i++){
      const count=advanceGlobalPopulation(state,light,1/30);
      assert.ok(Math.abs(state.count-previous)<=2600*GLOBAL_POPULATION_RATE/30+1e-9);
      assert.ok(count>=1&&count<=2600);previous=state.count;
    }
    assert.ok(Math.abs(state.count-2600*(.55+.45*light))<=6);
    assert.ok(state.count>last);last=state.count;
    const frozen=structuredClone(state);advanceGlobalPopulation(state,1-light,0);assert.deepEqual(state,frozen);
  }
  const stable=createGlobalPopulation(2600,.5),original=stable.count;
  for(let i=0;i<3000;i++)advanceGlobalPopulation(stable,.5+(i%2?.001:-.001),1/30);
  assert.equal(stable.count,original,'sub-deadband fluctuation cannot pump membership');
  for(const capacity of [1,36,851,2600,100000]){
    const initial=createGlobalPopulation(capacity,0);
    assert.ok(initial.count>=1&&initial.count<=initial.capacity);
    advanceGlobalPopulation(stable,.3,0,capacity);
    assert.ok(stable.count>=1&&stable.count<=Math.min(2600,Math.max(1,capacity)));
  }
});

test('an hour of real field evolution and repeated capacity changes stays bounded',()=>{
  const sizes=[[390,844],[1440,900],[3840,2160],[80,60]];
  const motion=createFieldMotion(),state=createGlobalPopulation(851,.5);
  let light=.5,previous=state.count,previousCapacity=state.capacity;
  for(let frame=0;frame<36000;frame++){
    const[w,h]=sizes[Math.floor(frame/1800)%sizes.length],capacity=pointCount(w,h);
    advanceFieldMotion(motion,.1,w,h);
    if(frame%4===0)light=sampleGlobalLuminance(w,h,motion);
    const count=advanceGlobalPopulation(state,light,.1,capacity);
    assert.ok(Number.isFinite(state.count)&&count>=1&&count<=capacity&&capacity<=2600);
    assert.ok(state.light>=0&&state.light<=1);
    if(capacity===previousCapacity)assert.ok(Math.abs(state.count-previous)<=capacity*GLOBAL_POPULATION_RATE*.1+1e-9);
    previous=state.count;previousCapacity=capacity;
  }
});

// Transpile the production handler. The controllable scalar replaces only the
// global-brightness input; every star still uses the production field sampler.
// The spy records actual point objects visited by the production draw loop,
// including alpha-zero stars, so changing diagnostics alone cannot pass.
const source=await readFile(new URL('../src/scripts/glyph-field.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
  .replace(/from '(\.\.\/lib\/[^']+)'/g,(_,path)=>`from '${new URL(`${path}.ts`,new URL('../src/scripts/',import.meta.url)).href}'`)
  .replace(/\bsampleGlobalLuminance\(/g,'globalThis.__populationGlobal(')
  .replace(/\bsamplePoint\(/g,'globalThis.__populationPoint(');
const {mountGlyphField}=await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

function fixture(width,height,override=.1){
  const originals=new Map(['window','document','NodeFilter','__populationGlobal','__populationPoint'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  let main,visited=[],nextId=0,time=0,draws=0,boundsReads=0,globalSamples=0;
  const callbacks=new Map(),canvases=[];
  class Canvas{
    width=300;height=150;dataset={};
    pen={clearRect:()=>{if(this===main){visited=[];draws++;}},setTransform(){},beginPath(){},arc(){},fill(){},fillRect(){},fillText(){},measureText(){return{width:28};},drawImage(image){assert.ok(image.width>0&&image.height>0);}};
    constructor(){canvases.push(this);}getContext(){return this.pen;}
  }
  const motion=Object.assign(new EventTarget(),{matches:false});
  const window=Object.assign(new EventTarget(),{innerWidth:width,innerHeight:height,devicePixelRatio:3,matchMedia:()=>motion,
    requestAnimationFrame(fn){callbacks.set(++nextId,fn);return nextId;},cancelAnimationFrame(id){callbacks.delete(id);}});
  const values=new Map();
  const region={style:{getPropertyValue:k=>values.get(k)??'',setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)},
    getBoundingClientRect(){boundsReads++;return{left:0,right:window.innerWidth,top:0,bottom:window.innerHeight};}};
  const sourceElement={closest:()=>sourceElement};
  const document=Object.assign(new EventTarget(),{hidden:false,documentElement:new EventTarget(),querySelectorAll:()=>[region],
    createElement:()=>new Canvas(),elementFromPoint:()=>state.hit?sourceElement:null,
    createTreeWalker:()=>{let done=false;return{nextNode(){if(done)return null;done=true;return{textContent:state.hit};}};},
    createRange:()=>({setStart(){},setEnd(){},getClientRects:()=>[{left:0,top:0,right:100,bottom:100,width:100}]})});
  const state={override,hit:''};
  Object.assign(globalThis,{window,document,NodeFilter:{SHOW_TEXT:4},
    __populationGlobal:(w,h,m)=>{globalSamples++;return state.override??sampleGlobalLuminance(w,h,m);},
    __populationPoint:(p,...args)=>{visited.push({id:p.id,seed:p.seed,speedIndex:p.speedIndex,rank:p.densityRank,presence:p.presence,glyph:p.transition.target});return samplePoint(p,...args);}});
  clearCursorPointer();main=new Canvas();const cleanup=mountGlyphField(main);
  const frame=()=>{
    assert.equal(callbacks.size,1);
    const[id,fn]=callbacks.entries().next().value;callbacks.delete(id);fn(time+=34);
    assert.equal(visited.length,Number(main.dataset.pointCount),'real draw-loop population matches slot diagnostics');
    assert.equal(visited.filter(p=>p.presence>0).length,Number(main.dataset.activePointCount));
    assert.ok(visited.length<=2600);
    assert.ok(Number(main.dataset.transitionAtlasBytes)<=GLYPH_ATLAS_MAX_BYTES);
  };
  const run=n=>{for(let i=0;i<n;i++)frame();};
  return {main,state,motion,window,document,callbacks,canvases,frame,run,
    get visited(){return structuredClone(visited);},get boundsReads(){return boundsReads;},get globalSamples(){return globalSamples;},get draws(){return draws;},
    skip(ms){time+=ms;},resize(w,h){window.innerWidth=w;window.innerHeight=h;window.dispatchEvent(new Event('resize'));},
    close(){cleanup();clearCursorPointer();for(const[k,d]of originals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};
}

test('production active IDs grow and are actually removed at fixed geometry, with smooth new-star presence',()=>{
  const f=fixture(1440,900,.1);
  try{
    f.frame();const low=f.visited,lowCount=low.length,bounds=f.boundsReads;
    assert.equal(lowCount,Math.round(2600*(.55+.45*.1)));
    f.state.override=.9;
    let sawFade=false;
    for(let i=0;i<900;i++){f.frame();sawFade ||= f.visited.some(p=>p.id>=lowCount&&p.presence>0&&p.presence<1);}
    const high=f.visited;assert.ok(high.length>lowCount+800);assert.ok(sawFade);
    for(const p of low){const after=high[p.id];assert.deepEqual([after.id,after.seed,after.speedIndex,after.rank],[p.id,p.seed,p.speedIndex,p.rank]);}
    f.state.override=.1;f.run(900);
    assert.ok(Math.abs(f.visited.length-lowCount)<=6);
    assert.ok(!f.visited.some(p=>p.id>=lowCount+6),'retired IDs leave the actual production sample loop');
    assert.equal(f.boundsReads,bounds,'population changes never remeasure layout');
    assert.equal(f.canvases.length,3,'growth reuses two pre-sized atlases');
    assert.ok(f.globalSamples<500,'global sampling piggybacks at the capped cadence');
    f.resize(390,844);f.run(20);
    assert.ok(f.visited.length<=pointCount(390,844),'normal resize releases the retiring tail after its fade');
    assert.ok(Math.abs(f.visited.length-Math.round(pointCount(390,844)*(.55+.45*.1)))<=6);
    assert.equal(f.canvases.length,3);
  }finally{f.close();}
});

test('IDs added and re-added during glyph hover join the latest Japanese target',()=>{
  const f=fixture(390,844,.1);
  try{
    f.frame();const initialCount=f.visited.length;
    f.state.hit='星';updateCursorPointer(1,1);f.run(30);
    assert.equal(f.main.dataset.glyph,'星');
    f.state.override=.9;f.run(250);
    const added=f.visited.filter(p=>p.id>=initialCount);
    assert.ok(added.length>100&&added.every(p=>p.glyph==='星'));
    f.state.hit='月';updateCursorPointer(1,1);f.run(40);
    assert.ok(f.visited.every(p=>p.glyph==='月'));
    f.state.override=.1;f.run(500);
    assert.ok(f.visited.length<=initialCount+3);
    f.state.override=.9;f.run(250);
    const readded=f.visited.filter(p=>p.id>=initialCount+3);
    assert.ok(readded.length>100&&readded.every(p=>p.glyph==='月'),'reused IDs cannot restore stale glyphs');
    assert.equal(f.main.dataset.glyph,'月');
  }finally{f.close();}
});

test('production envelope and membership pause through hide/reduced motion and settle a hidden reduced resize',()=>{
  const f=fixture(390,844,.1);
  try{
    f.frame();f.state.override=.9;f.run(50);const pending=f.visited;
    f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.callbacks.size,0);
    f.skip(60000);f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));f.frame();assert.deepEqual(f.visited,pending);
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));const frozen=f.visited;assert.equal(f.callbacks.size,0);
    updateCursorPointer(120,120);assert.deepEqual(f.visited,frozen,'local pointer glow cannot change the global membership');
    f.skip(60000);f.resize(390,844);assert.deepEqual(f.visited,frozen,'same-size static redraw preserves the frozen envelope');
    f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));f.resize(80,60);
    assert.equal(f.main.dataset.pointCount,f.main.dataset.targetPointCount);assert.equal(f.callbacks.size,0);
    f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(f.visited.length,Math.round(pointCount(80,60)*(.55+.45*.9)));
    assert.ok(f.visited.every(p=>p.presence===1));
    f.motion.matches=false;f.motion.dispatchEvent(new Event('change'));const staticIds=f.visited;f.frame();assert.deepEqual(f.visited,staticIds);
  }finally{f.close();}
});

test('unmodified production gradient changes actual total IDs without any resize or pointer input',(t)=>{
  for(const[w,h]of [[390,844],[1440,900]]){
    const f=fixture(w,h,null);
    try{
      let min=2600,max=0;const samples=[];
      for(let i=0;i<1800;i++){f.frame();if(i>120){const active=f.visited.filter(p=>p.presence>0).length;min=Math.min(min,active);max=Math.max(max,active);samples.push([Number(f.main.dataset.populationLuminance),active]);}}
      assert.ok(max-min>=2,`${w}x${h} real mean must change active population (${min}..${max})`);
      const mx=samples.reduce((s,p)=>s+p[0],0)/samples.length,my=samples.reduce((s,p)=>s+p[1],0)/samples.length;
      let xy=0,xx=0,yy=0;for(const[x,y]of samples){xy+=(x-mx)*(y-my);xx+=(x-mx)**2;yy+=(y-my)**2;}
      const correlation=xy/Math.sqrt(xx*yy);
      assert.ok(correlation>.8,'settled active counts follow the smoothed global luminance');
      t.diagnostic(`${w}x${h}: actual active IDs ${min}..${max}; correlation ${correlation.toFixed(4)}`);
    }finally{f.close();}
  }
});
