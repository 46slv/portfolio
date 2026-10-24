import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  makePoints,densityVisibility,densityOccupancy,dotSizeMultiplier,samplePoint,
  createFieldMotion,advanceFieldMotion,pointPosition,POINT_BUDGET,FIELD_PADDING,
  LARGE_DOT_MIN_MULTIPLIER,LARGE_DOT_MAX_MULTIPLIER,
} from '../src/lib/glyph-field.ts';

const off={x:0,y:0,active:false};
const smooth=(low,high,value)=>{const t=Math.max(0,Math.min(1,(value-low)/(high-low)));return t*t*(3-2*t);};

test('local occupancy rises modestly over the previous mapping without increasing the point budget',(t)=>{
  const points=makePoints(1440,900);
  const rows=[];
  for(const light of [.2,.5,.8,1]){
    const before=points.filter(p=>smooth(p.densityRank-.16,p.densityRank+.16,.12+.78*light)>=.5).length;
    const after=points.filter(p=>densityVisibility(light,p.densityRank)>=.5).length;
    assert.ok(after>before&&after-before<points.length*.1);
    assert.equal(densityOccupancy(light),.16+.82*light);
    rows.push({light,before,after});
  }
  assert.equal(points.length,POINT_BUDGET);
  t.diagnostic(JSON.stringify(rows));
});

test('size ranks remain deterministic and preserve seeded identity through resize and recycling',()=>{
  const originalRandom=Math.random;
  Math.random=()=>{throw new Error('size must not reroll per frame');};
  try{
    const desktop=makePoints(1440,900),portrait=makePoints(390,844);
    for(const point of portrait){
      const previous=desktop[point.id];
      assert.deepEqual([point.largeRank,point.sizeRank,point.seed,point.speedIndex,point.densityRank],
        [previous.largeRank,previous.sizeRank,previous.seed,previous.speedIndex,previous.densityRank]);
      assert.ok(point.largeRank>=0&&point.largeRank<1&&point.sizeRank>=0&&point.sizeRank<1);
    }
    const motion=createFieldMotion();
    for(const seconds of [0,1,3600,30*24*3600]){
      advanceFieldMotion(motion,seconds,390,844);
      for(const point of portrait.filter((_,i)=>i%13===0)){
        const sample=samplePoint(point,motion,390,844,off);
        assert.ok(Number.isFinite(sample.radius)&&sample.radius>=.24&&sample.radius<=8.75);
        assert.ok(sample.sizeMultiplier>=1&&sample.sizeMultiplier<=7);
        assert.deepEqual(sample,samplePoint(point,motion,390,844,off));
      }
    }
  }finally{Math.random=originalRandom;}
});

test('small dots remain the majority and the upper size tail is rare and bounded in linear dimensions',(t)=>{
  const values=makePoints(1440,900).map(p=>dotSizeMultiplier(1,p.largeRank,p.sizeRank));
  assert.equal(dotSizeMultiplier(1,0,0),LARGE_DOT_MIN_MULTIPLIER);
  assert.equal(dotSizeMultiplier(1,0,1),LARGE_DOT_MAX_MULTIPLIER);
  const atLeast=threshold=>values.filter(value=>value>=threshold).length/values.length;
  assert.ok(atLeast(1.3)>.08&&atLeast(1.3)<.2,'most points retain normal size');
  assert.ok(atLeast(3)<.05&&atLeast(5)<.015&&atLeast(6.5)<.004);
  assert.ok(Math.max(...values)>6,'the rare largest tier is reachable with the real seeded pool');
  assert.ok(values.every(value=>value>=1&&value<=7));
  const meanAreaRatio=values.reduce((sum,value)=>sum+value**2,0)/values.length;
  assert.ok(meanAreaRatio<2.3,'rare large dots retain a bounded aggregate fill-area cost');
  t.diagnostic(JSON.stringify({fractionAtLeast1_3:atLeast(1.3),fractionAtLeast3:atLeast(3),fractionAtLeast5:atLeast(5),fractionAtLeast6_5:atLeast(6.5),max:Math.max(...values),meanAreaRatio}));
});

test('large-dot thresholds are continuous, monotonic and driven by gradient occupancy',()=>{
  const candidates=[{largeRank:0,sizeRank:1},...makePoints(1440,900).filter(p=>p.largeRank<.21&&p.sizeRank>.5).slice(0,80)];
  for(const point of candidates){
    let previous=1;
    for(let step=0;step<=1000;step++){
      const light=step/1000,value=dotSizeMultiplier(light,point.largeRank,point.sizeRank);
      if(densityOccupancy(light)<=.64)assert.equal(value,1);
      assert.ok(value>=previous-1e-12&&value-previous<.1,'no binary threshold size jump');
      assert.equal(value,dotSizeMultiplier(light,point.largeRank,point.sizeRank));
      previous=value;
    }
  }
});

test('shared halo contributes to local density and rare-dot eligibility through the same composed field',()=>{
  const motion=createFieldMotion();advanceFieldMotion(motion,12,1440,900);
  const point=makePoints(1440,900).find(p=>{
    const sample=samplePoint(p,motion,1440,900,off);
    return sample.x>30&&sample.x<1410&&sample.y>30&&sample.y<870
      &&sample.gradientLuminance>.05&&sample.gradientLuminance<.25;
  });
  assert.ok(point);point.largeRank=0;point.sizeRank=1;point.densityRank=.1;
  const before=samplePoint(point,motion,1440,900,off);
  const on=samplePoint(point,motion,1440,900,{x:before.x,y:before.y,active:true});
  assert.equal(on.gradientLuminance,before.gradientLuminance);
  assert.equal(before.sizeMultiplier,1);assert.ok(on.sizeMultiplier>1);
  assert.equal(on.sizeMultiplier,dotSizeMultiplier(on.fieldLuminance,point.largeRank,point.sizeRank));
  assert.equal(on.density,densityVisibility(on.fieldLuminance,point.densityRank));
  assert.ok(on.luminance>before.luminance+.5,'shared light retains the local pointer response');
});

test('maximum circles fade in radius and alpha at screen boundaries and through population changes',()=>{
  const width=400,height=300,point={...makePoints(width,height)[0],x:18,y:150,largeRank:0,sizeRank:1,densityRank:0,presence:1};
  const motion=createFieldMotion();
  // Put all three analytic waves at their bright peak around this screen edge.
  const fx=point.x*2.6,fy=point.y*2.6;
  motion.evolution=[Math.PI/2-fx/285-fy/410,-fy/240+fx/610,Math.PI/2-fx/510+fy/330];
  const full=samplePoint(point,motion,width,height,off);
  assert.equal(full.sizeMultiplier,7);assert.equal(full.radius,8.75);
  assert.ok(full.radius<FIELD_PADDING&&full.radius+3*3<18,'text sampling covers the largest dot plus three blur sigmas');
  let previousRadius=.24,previousAlpha=0;
  for(let step=0;step<=1000;step++){
    point.x=18*step/1000;
    const sample=samplePoint(point,motion,width,height,off);
    assert.ok(sample.radius>=previousRadius-1e-9&&sample.radius-previousRadius<.03);
    assert.ok(sample.luminance>=previousAlpha-1e-9);
    previousRadius=sample.radius;previousAlpha=sample.luminance;
  }
  point.x=0;assert.equal(samplePoint(point,motion,width,height,off).luminance,0);
  assert.equal(samplePoint(point,motion,width,height,off).sizeMultiplier,1);
  point.x=18;previousRadius=1.25;
  for(let step=0;step<=1000;step++){
    point.presence=step/1000;const sample=samplePoint(point,motion,width,height,off);
    assert.ok(sample.radius>=previousRadius-1e-9&&sample.radius-previousRadius<.03);
    assert.ok(sample.luminance>=0&&sample.luminance<=1);
    previousRadius=sample.radius;
  }
  // The same seeded ID retains its dimensions after an entire padded wrap.
  point.presence=1;const before=pointPosition(point,motion,width,height);
  motion.offsetX[point.speedIndex]=width+2*FIELD_PADDING;
  assert.deepEqual(pointPosition(point,motion,width,height),before);
  assert.equal(samplePoint(point,motion,width,height,off).radius,8.75);
});

test('rare-dot radius changes stay within one original maximum radius per 30fps frame',()=>{
  for(const[width,height,ids]of[[1440,900,[75,1010,1911]],[390,844,[75,346]]]){
    const points=makePoints(width,height).filter(p=>ids.includes(p.id));
    const motion=createFieldMotion();let previous=points.map(p=>samplePoint(p,motion,width,height,off));
    for(let frame=1;frame<=3600;frame++){
      advanceFieldMotion(motion,1/30,width,height);
      const next=points.map(p=>samplePoint(p,motion,width,height,off));
      for(let i=0;i<points.length;i++)assert.ok(Math.abs(next[i].radius-previous[i].radius)<1.25,
        `rare ID ${points[i].id} must ease through the known fast-threshold cases`);
      previous=next;
    }
  }
});
