import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeSides,edgeCurve,edgePoint} from '../src/lib/agent-canvas-layout.js';

test('стрелки обращены к соседу на всех четырёх сторонах',()=>{
 const origin={x:500,y:500};
 for(const [point,from,to]of [[{x:900,y:500},'right','left'],[{x:100,y:500},'left','right'],[{x:500,y:100},'top','bottom'],[{x:500,y:900},'bottom','top']])assert.deepEqual(edgeSides(origin,point),{from,to});
 const line=edgeCurve(origin,{x:900,y:500},'next');assert.equal(line.a.x,790);assert.equal(line.b.x,900);assert.ok(line.path.startsWith('M790 564 C'));
});
test('ручные стороны сохранены, выходы двух ветвей не перекрываются',()=>{
 assert.deepEqual(edgeSides({x:0,y:0},{x:700,y:0},{from:'top',to:'right'}),{from:'top',to:'right'});
 for(const side of ['left','top','right','bottom'])assert.notDeepEqual(edgePoint({x:10,y:10},side,'on_true'),edgePoint({x:10,y:10},side,'on_false'));
 assert.equal(edgeSides({x:0,y:0},{x:700,y:0},{from:'auto'}).from,'right');
});
