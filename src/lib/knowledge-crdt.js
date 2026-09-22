import * as Y from 'yjs';
export function makeDocument(body=''){const doc=new Y.Doc();doc.getText('body').insert(0,body);return doc;}
export function documentBody(doc){
 if([...doc.share.keys()].some(key=>key!=='body'))throw Error('Документ содержит неизвестные поля');
 const text=doc.getText('body');
 if(text.toDelta().some(op=>typeof op.insert!=='string'||op.attributes))throw Error('Документ должен содержать обычный текст');
 const body=text.toString();if(body.length>1000000)throw Error('Статья превышает 1 000 000 символов');return body;
}
export function replaceText(text,before,after,origin){
 let start=0,end=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 if(start&&/^[\uD800-\uDBFF]$/.test(before[start-1]))start--;
 while(end<before.length-start&&end<after.length-start&&before[before.length-end-1]===after[after.length-end-1])end++;
 if(end&&/^[\uDC00-\uDFFF]$/.test(before[before.length-end]))end--;
 text.doc.transact(()=>{if(before.length-start-end)text.delete(start,before.length-start-end);if(after.length-start-end)text.insert(start,after.slice(start,after.length-end));},origin);
}
export function lineDiff(before,after){
 const a=before.split('\n'),b=after.split('\n');let prefix=0,suffix=0;
 while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
 while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
 const left=a.slice(prefix,a.length-suffix),right=b.slice(prefix,b.length-suffix),result=a.slice(0,prefix).map(text=>({kind:'same',text}));
 if(left.length*right.length>250000)result.push(...left.map(text=>({kind:'removed',text})),...right.map(text=>({kind:'added',text})));
 else{const matrix=Array.from({length:left.length+1},()=>new Uint32Array(right.length+1));for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)matrix[i][j]=left[i]===right[j]?matrix[i+1][j+1]+1:Math.max(matrix[i+1][j],matrix[i][j+1]);let i=0,j=0;while(i<left.length||j<right.length){if(i<left.length&&j<right.length&&left[i]===right[j]){result.push({kind:'same',text:left[i++]});j++;}else if(i<left.length&&(j===right.length||matrix[i+1][j]>=matrix[i][j+1]))result.push({kind:'removed',text:left[i++]});else result.push({kind:'added',text:right[j++]});}}
 return [...result,...a.slice(a.length-suffix).map(text=>({kind:'same',text}))];
}
