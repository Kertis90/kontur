import {createHash} from 'node:crypto';
export const semanticHash=value=>createHash('sha256').update(value).digest('hex');
export function unitVector(values){
 if(!Array.isArray(values)||values.length<32||values.length>4096||values.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error('INVALID_EMBEDDING');
 const norm=Math.sqrt(values.reduce((s,v)=>s+v*v,0));if(!Number.isFinite(norm)||norm===0)throw new Error('INVALID_EMBEDDING');return values.map(v=>v/norm);
}
export function cosine(a,b){if(a.length!==b.length)return -1;return a.reduce((s,v,i)=>s+v*b[i],0);}
// Stable random hyperplanes: 8 bands of 8 bits. Same vectors share buckets.
// This is an approximate candidate index; cosine similarity ranks the candidates.
const planes=new Map();
function projection(dim){
 if(planes.has(dim))return planes.get(dim);let state=0x9e3779b9;
 const matrix=Array.from({length:64},()=>Float32Array.from({length:dim},()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296-.5;}));
 if(planes.size>4)planes.clear();planes.set(dim,matrix);return matrix;
}
export function vectorBuckets(vector){const matrix=projection(vector.length),buckets=Array(8).fill(0);matrix.forEach((p,i)=>{let dot=0;for(let j=0;j<vector.length;j++)dot+=p[j]*vector[j];if(dot>=0)buckets[Math.floor(i/8)]|=1<<(i%8);});return buckets;}
export function neighboringBuckets(vector){return vectorBuckets(vector).map((bucket,band)=>({band,values:[bucket,...Array.from({length:8},(_,i)=>bucket^(1<<i))]}));}
export function semanticChunks(text){const chunks=[];const bounded=text.slice(0,128000);for(let start=0;start<bounded.length;start+=3600)chunks.push({start,text:bounded.slice(start,start+4000)});return chunks;}
