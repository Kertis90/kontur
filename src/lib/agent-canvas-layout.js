export const BLOCK_WIDTH=290,BLOCK_HEIGHT=128;
const vectors={top:{x:0,y:-1},right:{x:1,y:0},bottom:{x:0,y:1},left:{x:-1,y:0}};
const opposite={top:'bottom',bottom:'top',left:'right',right:'left'};
// Выбирает обращённые друг к другу стороны с учётом ручной настройки связи.
export function edgeSides(from,to,choice={}){
 const dx=to.x-from.x,dy=to.y-from.y;
 const side=Math.abs(dx)/BLOCK_WIDTH>Math.abs(dy)/BLOCK_HEIGHT?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
 return {from:vectors[choice.from]?choice.from:side,to:vectors[choice.to]?choice.to:opposite[side]};
}
// Находит точку на границе блока, разделяя выходы «Да» и «Нет».
export function edgePoint(position,side,key=''){
 const fraction=key==='on_true'?.3:key==='on_false'?.7:.5;
 return {x:position.x+(side==='left'?0:side==='right'?BLOCK_WIDTH:BLOCK_WIDTH*fraction),y:position.y+(side==='top'?0:side==='bottom'?BLOCK_HEIGHT:BLOCK_HEIGHT*fraction)};
}
// Строит кривую, выходящую наружу с каждой выбранной стороны блока.
export function edgeCurve(from,to,key,choice){
 const sides=edgeSides(from,to,choice),a=edgePoint(from,sides.from,key),b=edgePoint(to,sides.to),distance=Math.max(48,Math.min(160,Math.hypot(b.x-a.x,b.y-a.y)*.4)),v=vectors[sides.from],w=vectors[sides.to];
 return {...sides,a,b,label:{x:a.x+v.x*24+8,y:a.y+v.y*24-8},path:`M${a.x} ${a.y} C${a.x+v.x*distance} ${a.y+v.y*distance},${b.x+w.x*distance} ${b.y+w.y*distance},${b.x} ${b.y}`};
}
