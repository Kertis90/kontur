import {z} from 'zod';
import {WorkError} from './work-error.js';
const key=z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).refine(v=>!['constructor','prototype','__proto__'].includes(v));
const suggestionSchema=z.object({summary:z.string().max(6000),assumptions:z.array(z.string().max(1000)).max(15),items:z.array(z.object({key,kind:z.enum(['epic','task']),parent:key.nullable(),title:z.string().trim().min(2).max(300),description:z.string().max(6000),criteria:z.array(z.string().min(1).max(1000)).min(1).max(8),reason:z.string().max(2000),priority:z.enum(['critical','high','medium','low']),estimate_hours:z.number().min(0).max(10000).nullable(),depends_on:z.array(key).max(20)}).strict()).min(1).max(50)}).strict();
// Проверяет структуру предложений, существование эпиков и отсутствие циклов зависимостей.
export function parsePlanSuggestions(text){let raw;try{raw=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new WorkError(502,'Модель вернула неверный формат предложений');}const parsed=suggestionSchema.safeParse(raw);if(!parsed.success)throw new WorkError(502,'Предложения не соответствуют структуре плана');
 const value=parsed.data,byKey=new Map(value.items.map(i=>[i.key,i]));if(byKey.size!==value.items.length)throw new WorkError(502,'Модель повторила названия элементов схемы');
 for(const item of value.items){if(item.parent&&(item.kind!=='task'||byKey.get(item.parent)?.kind!=='epic'))throw new WorkError(502,'Модель указала неверный родительский эпик');if(new Set(item.depends_on).size!==item.depends_on.length||item.depends_on.some(id=>!byKey.has(id)))throw new WorkError(502,'Модель указала неверные зависимости');}
 const active=new Set(),done=new Set();
 // Проверяет иерархию вместе со связями, чтобы эпик не зависел от собственной задачи.
 function visit(id){if(active.has(id))throw new WorkError(502,'Модель предложила цикл зависимостей');if(done.has(id))return;active.add(id);const item=byKey.get(id);for(const parent of [...item.depends_on,...(item.parent?[item.parent]:[])])visit(parent);active.delete(id);done.add(id);}
 value.items.forEach(i=>visit(i.key));return value;
}
// Требует явно выбрать все опорные элементы предложения, не добавляя их за пользователя.
export function selectedPlanSuggestions(proposals,keys){const chosen=new Set(keys);if(!chosen.size||chosen.size!==keys.length||keys.some(k=>!proposals.items.some(i=>i.key===k)))throw new WorkError(422,'Выберите существующие предложения без повторов');const result=proposals.items.filter(i=>chosen.has(i.key));for(const item of result){if(item.parent&&!chosen.has(item.parent)||item.depends_on.some(k=>!chosen.has(k)))throw new WorkError(422,'Выберите также родительский эпик и блокирующие предложения');}return result.sort((a,b)=>(a.kind==='epic'?0:1)-(b.kind==='epic'?0:1));}
