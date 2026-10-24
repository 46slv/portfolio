import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';
import {
  haloLuminance,haloScale,composeFieldLight,createLightPointer,advanceLightPointer,
  washLayout,washChannel,paintFieldWash,WASH_PIXEL_BUDGET,
  createFieldMotion,advanceFieldMotion,sampleLuminance,
  samplePoint,makePoints,densityVisibility,dotSizeMultiplier,pointVisibility,
} from '../src/lib/glyph-field.ts';
import {cursorPointer,clearCursorPointer,updateCursorPointer} from '../src/lib/cursor-pointer.ts';
const off={x:0,y:0,active:false};

test('core and broad shoulder have a continuous radial tail without a finite crop',()=>{
  const pointer={x:0,y:0,active:true};
  assert.equal(haloLuminance(0,0,pointer),.82);
  let previous=.82;
  for(let radius=1;radius<=2000;radius++){
    const value=haloLuminance(radius,0,pointer);
    assert.ok(value>0&&value<previous);previous=value;
    assert.ok(Math.abs(value-haloLuminance(radius*Math.cos(.7),radius*Math.sin(.7),pointer))<1e-14);
  }
  assert.ok(haloLuminance(1000,0,pointer)>.0001);
  for(const radius of[0,74.25,95,280,700,1000]){
    const h=.001,f=x=>haloLuminance(x,0,pointer);
    const left=(f(radius)-f(radius-h))/h,right=(f(radius+h)-f(radius))/h;
    assert.ok(Math.abs(left-right)<1e-6,'first derivative has no radial stop');
    const a=(f(radius)-2*f(radius-h)+f(radius-2*h))/h**2;
    const b=(f(radius+2*h)-2*f(radius+h)+f(radius))/h**2;
    assert.ok(Math.abs(a-b)<1e-6,'second derivative has no radial stop');
  }
  assert.equal(haloScale(1440,900),1);assert.equal(haloScale(390,844),.7);
});

test('linear-light screen retains headroom and shares one field with density and size',()=>{
  for(const base of[0,.1,.4,.8,1])for(const glow of[0,.12,.4,.82]){
    const value=composeFieldLight(base,glow);
    assert.ok(Math.abs(value-(1-(1-base)*(1-glow)))<1e-15);
    assert.ok(value>=base&&value<=1);
    if(base<1)assert.ok(value<1,'halo does not make a clipped flat plateau');
  }
  const motion=createFieldMotion();advanceFieldMotion(motion,18,1440,900);
  const pointer={x:720,y:450,active:true,strength:.8,scale:1};
  for(const point of makePoints(1440,900).filter((_,i)=>i%7===0)){
    const sample=samplePoint(point,motion,1440,900,pointer);
    const base=sampleLuminance(sample.x,sample.y,motion,off);
    const combined=composeFieldLight(base,haloLuminance(sample.x,sample.y,pointer));
    assert.equal(sample.fieldLuminance,combined);
    assert.equal(sample.fieldLuminance,sampleLuminance(sample.x,sample.y,motion,pointer));
    assert.equal(sample.density,densityVisibility(combined,point.densityRank));
    const expectedSize=1+(dotSizeMultiplier(combined,point.largeRank,point.sizeRank)-1)*pointVisibility(sample.x,sample.y,1440,900);
    assert.equal(sample.sizeMultiplier,expectedSize);
  }
});

test('pointer follow and exit use frame time, freeze at zero elapsed and fade at viewport edges',()=>{
  const target={x:900,y:500,active:true};
  const a=createLightPointer(),b=createLightPointer();
  for(const state of[a,b])advanceLightPointer(state,{x:300,y:300,active:true},0,1440,900,true);
  for(let i=0;i<18;i++)advanceLightPointer(a,target,1/30,1440,900);
  for(let i=0;i<36;i++)advanceLightPointer(b,target,1/60,1440,900);
  for(const key of['x','y','strength'])assert.ok(Math.abs(a[key]-b[key])<1e-10);
  const frozen=structuredClone(a);advanceLightPointer(a,{x:10,y:10,active:false},0,1440,900);assert.deepEqual(a,frozen);
  advanceLightPointer(a,{...target,active:false},1/30,1440,900);
  assert.ok(a.strength>0&&a.strength<frozen.strength);
  for(let i=0;i<60;i++)advanceLightPointer(a,{...target,active:false},1/30,1440,900);
  assert.equal(a.strength,0);assert.equal(a.active,false,'invisible exit tail stops halo evaluation');
  const edge=createLightPointer();
  for(const[x,expected]of[[0,0],[24,.5],[48,1],[-1,0]]){
    advanceLightPointer(edge,{x,y:450,active:true},0,1440,900,true);
    assert.ok(Math.abs(edge.strength-expected)<1e-12);
  }
});

test('wash uses a cached linear-light conversion and a reused bounded full-viewport buffer',()=>{
  let previous=10;
  for(let i=0;i<=1000;i++){
    const light=i/1000,linear=(10/255)/12.92+.0045*light;
    const expected=255*(linear<=.0031308?12.92*linear:1.055*linear**(1/2.4)-.055);
    const channel=washChannel(light);
    assert.ok(channel>=previous&&Math.abs(channel-expected)<1);previous=channel;
  }
  assert.equal(washChannel(0),10);assert.equal(washChannel(1),21);
  const motion=createFieldMotion(),pointer={x:10,y:100,active:true,strength:.8,scale:.7};
  for(const[width,height]of[[1,1],[390,844],[1440,900],[3840,2160],[100000,1],[1,100000]]){
    const grid=washLayout(width,height);
    assert.ok(grid.width*grid.height<=WASH_PIXEL_BUDGET&&grid.width<=128&&grid.height<=128);
    const pixels=new Uint8ClampedArray(grid.width*grid.height*4),identity=pixels;
    paintFieldWash(pixels,grid.width,grid.height,width,height,motion,pointer);
    assert.equal(pixels,identity);
    for(let row=0;row<grid.height;row++)for(let col=0;col<grid.width;col++){
      const index=(row*grid.width+col)*4;
      const expected=washChannel(sampleLuminance((col+.5)*width/grid.width,(row+.5)*height/grid.height,motion,pointer));
      assert.deepEqual([...pixels.subarray(index,index+4)],[expected,expected,expected,255]);
    }
  }
});

test('the restrained wash fits existing text headroom and Home alone removes the independent disk',async()=>{
  for(let step=0;step<=1000;step++){
    const alpha=step/1000,wash=(washChannel(1)-10)/245;
    const effective=alpha+(1-alpha)*wash;
    assert.ok(effective<=Math.min(1,alpha+.2),'current text headroom covers the added wash');
  }
  const layout=await readFile(new URL('../src/layouts/BaseLayout.astro',import.meta.url),'utf8');
  assert.match(layout,/\{!homeBackground && <div id="cursor-light"><\/div>\}/);
  assert.ok(layout.indexOf('updateCursorPointer(event.clientX, event.clientY)')<layout.indexOf('if (!light)'));
  assert.match(layout,/width: 150px/);assert.match(layout,/z-index: 9999/);assert.match(layout,/mix-blend-mode: screen/);
  const css=await readFile(new URL('../src/styles/home-readability.css',import.meta.url),'utf8');
  assert.match(css,/rgb\(10 10 10 \/ 64%\)/);assert.match(css,/blur\(3px\)/);
});

// Drive the real mount function. Observe actual objects passed into wash/point
// sampling and actual buffer uploads; no second renderer or browser is used.
const source=await readFile(new URL('../src/scripts/glyph-field.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
  .replace(/from '(\.\.\/lib\/[^']+)'/g,(_,path)=>`from '${new URL(`${path}.ts`,new URL('../src/scripts/',import.meta.url)).href}'`)
  .replace(/\bpaintFieldWash\(/g,'globalThis.__sharedWash(').replace(/\bsamplePoint\(/g,'globalThis.__sharedPoint(');
const {mountGlyphField}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function fixture(width=1440,height=900){
  const keys=['window','document','NodeFilter','__sharedWash','__sharedPoint'];
  const originals=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const canvases=[],callbacks=new Map(),buffers=new Set();
  let main,nextId=0,time=0,draws=0,uploads=0,washPointer=null,pointPointers=[],samples=[],order=[];
  class Canvas{
    width=300;height=150;dataset={};
    pen={clearRect:()=>{if(this===main){draws++;pointPointers=[];samples=[];order=[];}},setTransform(){},beginPath(){},arc(){order.push('dot');},fill(){},fillRect(){},fillText(){},measureText(){return{width:28};},
      createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
      putImageData:(image,x,y)=>{assert.equal(this.dataset.fieldLayer,'wash');assert.equal(x,0);assert.equal(y,0);assert.equal(image.data.length,this.width*this.height*4);uploads++;},
      drawImage:(image,...args)=>{if(image.dataset.fieldLayer==='wash'){assert.equal(this,main);assert.deepEqual(args,[0,0,window.innerWidth,window.innerHeight]);order.push('wash');}}};
    constructor(){canvases.push(this);}getContext(){return this.pen;}
  }
  const motion=Object.assign(new EventTarget(),{matches:false});
  const window=Object.assign(new EventTarget(),{innerWidth:width,innerHeight:height,devicePixelRatio:3,matchMedia:()=>motion,
    requestAnimationFrame(fn){callbacks.set(++nextId,fn);return nextId;},cancelAnimationFrame(id){callbacks.delete(id);}});
  const styleValues=new Map(),region={style:{getPropertyValue:k=>styleValues.get(k)??'',setProperty:(k,v)=>styleValues.set(k,v),removeProperty:k=>styleValues.delete(k)},getBoundingClientRect:()=>({left:0,top:0,right:window.innerWidth,bottom:window.innerHeight})};
  const document=Object.assign(new EventTarget(),{hidden:false,documentElement:new EventTarget(),querySelectorAll:()=>[region],createElement:()=>new Canvas(),elementFromPoint:()=>null});
  Object.assign(globalThis,{window,document,NodeFilter:{SHOW_TEXT:4},
    __sharedWash:(pixels,...args)=>{buffers.add(pixels);washPointer=structuredClone(args.at(-1));return paintFieldWash(pixels,...args);},
    __sharedPoint:(point,...args)=>{pointPointers.push(structuredClone(args.at(-1)));const sample=samplePoint(point,...args);samples.push({id:point.id,presence:point.presence,...sample});return sample;}});
  clearCursorPointer();main=new Canvas();const cleanup=mountGlyphField(main);
  const frame=()=>{
    assert.equal(callbacks.size,1);const[id,fn]=callbacks.entries().next().value;callbacks.delete(id);fn(time+=34);
    assert.equal(order[0],'wash');assert.equal(samples.length,Number(main.dataset.pointCount));
    assert.ok(Number(main.dataset.washPixels)<=4096&&samples.length<=2600);
  };
  return{main,motion,window,document,callbacks,canvases,buffers,frame,run:n=>{for(let i=0;i<n;i++)frame();},skip:ms=>{time+=ms;},
    get light(){return structuredClone(washPointer);},get pointers(){return pointPointers;},get samples(){return samples;},get draws(){return draws;},get uploads(){return uploads;},
    close(){cleanup();clearCursorPointer();for(const[k,d]of originals){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};
}

test('production wash and dots share the smoothed pointer and reuse their small buffer',()=>{
  const f=fixture();
  try{
    f.frame();updateCursorPointer(720,450);f.run(6);
    assert.ok(f.light.strength>0&&f.light.strength<1);
    for(const pointer of f.pointers)assert.deepEqual(pointer,f.light);
    const before=f.light;updateCursorPointer(1100,600);f.frame();
    assert.ok(f.light.x>before.x&&f.light.x<1100,'light follows frame time rather than snapping to raw input');
    for(const pointer of f.pointers)assert.deepEqual(pointer,f.light);
    f.run(40);assert.equal(f.buffers.size,1);assert.equal(f.canvases.length,4);
    assert.ok(f.uploads>40);
  }finally{f.close();}
});

test('production exit fades, hidden time freezes and reduced motion remains event-driven static',()=>{
  const f=fixture();
  try{
    f.frame();updateCursorPointer(720,450);f.run(12);const full=f.light.strength;
    f.document.documentElement.dispatchEvent(new Event('mouseleave'));f.frame();
    assert.ok(f.light.strength>0&&f.light.strength<full);
    const frozen=f.light;f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.callbacks.size,0);
    f.skip(60000);f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));f.frame();assert.deepEqual(f.light,frozen);
    f.run(12);assert.ok(f.light.strength<frozen.strength);
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));assert.equal(f.callbacks.size,0);
    const count=f.draws;updateCursorPointer(800,500);assert.ok(f.draws>count);assert.equal(f.light.x,800);assert.equal(f.light.strength,1);assert.equal(f.callbacks.size,0);
    clearCursorPointer();assert.equal(f.light.strength,0);assert.equal(f.callbacks.size,0);
    const offscreen=f.canvases.slice(1);f.close();assert.ok(offscreen.every(c=>c.width===0&&c.height===0));
  }finally{if(globalThis.window===f.window)f.close();}
});

test('real global population histories are identical with and without pointer light',()=>{
  const histories=[],last=[];
  for(const active of[false,true]){
    const f=fixture(390,844);
    try{
      const history=[];
      for(let i=0;i<150;i++){
        if(active)updateCursorPointer(195,422);
        f.frame();history.push([f.main.dataset.targetPointCount,f.samples.map(s=>[s.id,s.presence])]);
      }
      histories.push(history);last.push(f.samples.map(s=>s.luminance));
      if(active)assert.ok(f.light.strength>.99);
    }finally{f.close();}
  }
  assert.deepEqual(histories[0],histories[1]);
  assert.ok(last[1].some((light,i)=>light>last[0][i]+.1),'shared local light is active while total population is unchanged');
});

test('static lifecycle snapshots reconcile a cleared pointer after hidden visibility return',()=>{
  const f=fixture();
  try{
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));
    updateCursorPointer(720,450);assert.equal(f.light.strength,1);
    const frozen=f.samples.map(({id,x,y,presence})=>({id,x,y,presence}));
    f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(cursorPointer.active,false);assert.equal(f.callbacks.size,0);
    const draws=f.draws;f.skip(60000);assert.equal(f.draws,draws);
    f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(f.light.strength,0);assert.equal(f.light.active,false);
    assert.equal(f.callbacks.size,0);
    assert.deepEqual(f.samples.map(({id,x,y,presence})=>({id,x,y,presence})),frozen,'static resume retains field position and population');
    updateCursorPointer(800,500);assert.equal(f.light.strength,1);
    f.window.dispatchEvent(new Event('pagehide'));clearCursorPointer();
    f.window.dispatchEvent(new Event('pageshow'));
    assert.equal(f.light.strength,0);assert.equal(f.callbacks.size,0);
  }finally{f.close();}
});

test('enabling reduced motion during pointer exit clears the obsolete fade before drawing',()=>{
  const f=fixture();
  try{
    f.frame();updateCursorPointer(720,450);f.run(12);
    clearCursorPointer();f.frame();
    assert.ok(f.light.strength>0&&f.light.strength<1);
    assert.equal(cursorPointer.active,false);
    const frozen=f.samples.map(({id,x,y,presence})=>({id,x,y,presence}));
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));
    assert.equal(f.light.strength,0);assert.equal(f.light.active,false);assert.equal(f.callbacks.size,0);
    assert.deepEqual(f.samples.map(({id,x,y,presence})=>({id,x,y,presence})),frozen);
    f.motion.matches=false;f.motion.dispatchEvent(new Event('change'));f.frame();
    assert.equal(f.light.strength,0);assert.equal(f.callbacks.size,1);
    assert.deepEqual(f.samples.map(({id,x,y,presence})=>({id,x,y,presence})),frozen,'first resumed frame has no hidden-time catch-up');
  }finally{f.close();}
});

test('hidden preference changes in either direction resume using the current input contract',()=>{
  for(const initialReduced of[false,true]){
    const f=fixture();
    try{
      if(initialReduced){f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));updateCursorPointer(720,450);}
      else{f.frame();updateCursorPointer(720,450);f.run(12);}
      assert.ok(f.light.strength>.9);
      f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));
      f.motion.matches=!initialReduced;f.motion.dispatchEvent(new Event('change'));
      assert.equal(cursorPointer.active,false);assert.equal(f.callbacks.size,0);
      f.skip(60000);f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));
      if(f.motion.matches){
        assert.equal(f.light.strength,0);assert.equal(f.light.active,false);assert.equal(f.callbacks.size,0);
      }else{
        assert.equal(f.callbacks.size,1);f.run(61);
        assert.equal(f.light.strength,0);assert.equal(f.light.active,false);
      }
    }finally{f.close();}
  }
});

test('visible preference toggles snapshot the latest pointer and restore eased follow',()=>{
  const f=fixture();
  try{
    f.frame();updateCursorPointer(720,450);f.run(12);
    updateCursorPointer(1100,600);f.frame();assert.ok(f.light.x<1100);
    f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));
    assert.equal(f.light.x,1100);assert.equal(f.light.y,600);assert.equal(f.light.strength,1);assert.equal(f.callbacks.size,0);
    f.window.dispatchEvent(new Event('blur'));assert.equal(f.light.strength,0);
    updateCursorPointer(800,500);assert.equal(f.light.strength,1);
    f.motion.matches=false;f.motion.dispatchEvent(new Event('change'));f.frame();
    updateCursorPointer(1000,600);f.frame();
    assert.ok(f.light.x>800&&f.light.x<1000,'normal follow resumes instead of remaining static');
    f.document.documentElement.dispatchEvent(new Event('mouseleave'));f.frame();
    assert.ok(f.light.strength>0&&f.light.strength<1,'normal exit keeps its eased fade');
  }finally{f.close();}
});
