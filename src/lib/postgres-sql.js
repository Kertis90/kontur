import {postgresTables} from './postgres-tables.js';

// Разделяет SQL и его литералы: значения параметров никогда не вставляются в текст запроса.
export function sqlTokens(sql) {
 const result=[];let index=0,parameter=0;
 while(index<sql.length) {
  const rest=sql.slice(index),space=/^\s+/.exec(rest);
  if(space){index+=space[0].length;continue;}
  const comment=/^(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/.exec(rest);
  if(comment){index+=comment[0].length;continue;}
  if(rest[0]==="'"||rest[0]==='"'||rest[0]==='`') {
   const quote=rest[0];let value='',end=1,closed=false;
   while(end<rest.length) {
    if(rest[end]===quote){if(rest[end+1]===quote){value+=quote;end+=2;continue;}end++;closed=true;break;}
    if(rest[end]==='\\'&&quote!=='`') {
     end++;const escapes={n:'\n',r:'\r',t:'\t',b:'\b','0':'\0'};
     value+=escapes[rest[end]]??rest[end];end++;
    }else value+=rest[end++];
   }
   if(!closed)throw new Error('Незакрытый литерал SQL');
   result.push(quote==='`'?'"'+value.replaceAll('"','""')+'"':"'"+value.replaceAll("'","''")+"'");index+=end;continue;
  }
  const token=/^(?:[a-zA-Z_][a-zA-Z_\d]*|\d+(?:\.\d+)?|<=>|<>|!=|<=|>=|\|\||::|.)/.exec(rest)[0];
  result.push(token==='?'?`$${++parameter}`:token);index+=token.length;
 }
 return result;
}
// Разбивает только верхний уровень выражения, сохраняя вложенные скобки и строки.
function splitArguments(tokens) {
 const result=[[]];let depth=0;
 for(const token of tokens){if(token==='(')depth++;if(token===')')depth--;if(token===','&&!depth)result.push([]);else result.at(-1).push(token);}
 return result;
}
// Находит парную скобку с учётом вложенных функций; литералы уже отделены лексером.
function closingParen(tokens,start) {
 let depth=0;
 for(let i=start;i<tokens.length;i++){if(tokens[i]==='(')depth++;if(tokens[i]===')'&&!--depth)return i;}
 throw new Error('Несогласованные скобки SQL');
}
// Определяет условие, которое MySQL разрешает использовать как число в SUM и IF.
function predicate(tokens) {
 let depth=0;
 for(const token of tokens){if(token==='(')depth++;if(token===')')depth--;if(!depth&&['=','<>','!=','>','<','>=','<=','AND','OR','IN','IS','EXISTS','NOT'].includes(token.toUpperCase()))return true;}
 return false;
}
// Переводит отдельные функции общего слоя запросов в выражения PostgreSQL.
function sqlFunction(name,args) {
 const parts=args.map(convertTokens),upper=name.toUpperCase();
 if(upper==='IF')return `(CASE WHEN ${predicate(args[0])?parts[0]:`(${parts[0]})<>0`} THEN ${parts[1]} ELSE ${parts[2]} END)`;
 if(upper==='SUM'&&predicate(args[0]))return `SUM((${parts[0]})::integer)`;
 if(['UTC_DATE','CURDATE'].includes(upper))return 'CURRENT_DATE';
 if(['UTC_TIMESTAMP','NOW','CURRENT_TIMESTAMP'].includes(upper))return args[0]?.[0]==='6'?"(statement_timestamp() AT TIME ZONE 'UTC')":"date_trunc('second',statement_timestamp() AT TIME ZONE 'UTC')";
 if(upper==='DATE')return `CAST(${parts[0]} AS date)`;
 if(['DATE_ADD','DATE_SUB'].includes(upper)) {
  const interval=args[1];const unit=interval.at(-1).toLowerCase();
  if(interval[0]?.toUpperCase()!=='INTERVAL'||!['second','minute','hour','day','week','month','year'].includes(unit))throw new Error('Неподдержанный интервал SQL');
  return `(${parts[0]} ${upper==='DATE_ADD'?'+':'-'} ((${convertTokens(interval.slice(1,-1))})::double precision * INTERVAL '1 ${unit}'))`;
 }
 if(upper==='DATE_FORMAT') {
  if(parts[1]!=="'%Y-%m-01'")throw new Error('Неподдержанный формат даты SQL');
  return `date_trunc('month',${parts[0]})`;
 }
 if(upper==='TIMESTAMPDIFF') {
  const divisors={SECOND:1,MINUTE:60,HOUR:3600,DAY:86400};const divisor=divisors[parts[0].toUpperCase()];
  if(!divisor)throw new Error('Неподдержанная единица SQL');
  return `trunc(EXTRACT(EPOCH FROM (${parts[2]}-${parts[1]}))/${divisor})`;
 }
 if(upper==='FIELD')return `(CASE ${parts[0]} ${parts.slice(1).map((part,i)=>`WHEN ${part} THEN ${i+1}`).join(' ')} ELSE 0 END)`;
 if(upper==='FIND_IN_SET')return `COALESCE(array_position(string_to_array((${parts[1]})::text,','),(${parts[0]})::text),0)`;
 if(upper==='CONCAT')return `concat(${parts.map(p=>`(${p})::text`).join(',')})`;
 if(upper==='JSON_ARRAY')return `jsonb_build_array(${parts.join(',')})`;
 if(upper==='JSON_EXTRACT') {
  const path=/^'\$\.([a-zA-Z_][a-zA-Z_\d]*(?:\.[a-zA-Z_][a-zA-Z_\d]*)*)'$/.exec(parts[1]);
  if(!path)throw new Error('Неподдержанный путь JSON');
  return `(${parts[0]} #> ARRAY[${path[1].split('.').map(p=>`'${p}'`).join(',')}])`;
 }
 if(upper==='JSON_UNQUOTE')return `(${parts[0]} #>> '{}')`;
 if(upper==='JSON_TYPE')return `upper(jsonb_typeof(${parts[0]}))`;
 if(upper==='JSON_LENGTH')return `(CASE jsonb_typeof(${parts[0]}) WHEN 'array' THEN jsonb_array_length(${parts[0]}) WHEN 'object' THEN (SELECT count(*) FROM jsonb_object_keys(${parts[0]})) ELSE 1 END)`;
 if(upper==='CAST') {
  const at=args[0].findLastIndex(token=>token.toUpperCase()==='AS'),target=args[0].slice(at+1),type=target[0]?.toUpperCase();
  return at>=0&&['CHAR','JSON'].includes(type)?`CAST(${convertTokens(args[0].slice(0,at))} AS ${type==='JSON'?'jsonb':'text'})`:`CAST(${parts[0]})`;
 }
 return `${name}(${parts.join(',')})`;
}
// Обрабатывает вложенные функции и флаги, не меняя содержимое строковых значений.
function convertTokens(tokens) {
 const result=[];
 for(let i=0;i<tokens.length;i++) {
  const token=tokens[i],upper=token.toUpperCase();
  if(/^[A-Za-z_]\w*$/.test(token)&&tokens[i+1]==='(') {
   const end=closingParen(tokens,i+1);
   result.push(sqlFunction(token,splitArguments(tokens.slice(i+2,end))));i=end;
  }else if(upper==='CURRENT_TIMESTAMP')result.push("date_trunc('second',statement_timestamp() AT TIME ZONE 'UTC')");
  else if(upper==='BINARY') {
   const value=tokens[++i];if(!/^(?:[a-zA-Z_]\w*|\$\d+)$/.test(value))throw new Error('Неподдержанное точное сравнение SQL');
   result.push(`(${value} COLLATE "C")`);
  }else if(/^\$\d+$/.test(token)&&tokens[i+1]?.toUpperCase()==='IS')result.push(`(${token})::text`);
  else if(upper==='TRUE'||upper==='FALSE')result.push(upper==='TRUE'?'1':'0');
  else if(upper==='USER')result.push('"'+token+'"');
  else if(token==='<=>')result.push('IS NOT DISTINCT FROM');
  else result.push(token);
 }
 return result.join(' ');
}
// Выбирает бизнес-ключ вставки из проверенной схемы; неоднозначные запросы требуют явного исправления.
function conflictKey(table,columns) {
 const keys=postgresTables[table]?.keys.filter(key=>key.every(c=>columns.includes(c)))||[];
 // Повтор доставки определяется подключением и событием; новый UUID не заменяет эту защиту.
 if(table==='integration_deliveries'&&keys.some(key=>key.join(',')==='connection_id,event_uuid'))return ['connection_id','event_uuid'];
 const withoutIdentity=keys.filter(key=>!key.includes(postgresTables[table].identity));
 if(withoutIdentity.length===1)return withoutIdentity[0];
 if(keys.length===1)return keys[0];
 throw new Error(`Неоднозначный ключ обновления ${table}`);
}
// Переводит запрос прикладного слоя, оставляя параметры отдельным массивом драйвера.
export function postgresSql(sql,params=[]) {
 const tokens=sqlTokens(sql);if(tokens.at(-1)===';')tokens.pop();let statement=tokens;
 if(tokens[0]?.toUpperCase()==='INSERT') {
  const ignore=tokens[1]?.toUpperCase()==='IGNORE';if(ignore)statement=tokens.filter((_,i)=>i!==1);
  const table=statement[2]?.replaceAll('"','');
  const close=statement.indexOf(')');const columns=statement.slice(4,close).filter(t=>t!==',').map(t=>t.replaceAll('"',''));
  const duplicate=statement.findIndex((t,i)=>t.toUpperCase()==='ON'&&statement[i+1]?.toUpperCase()==='DUPLICATE');
  let suffix='';
  if(duplicate!==-1) {
   const valuesStart=statement.findIndex((t,i)=>i>close&&t.toUpperCase()==='VALUES');
   const values=valuesStart>=0?splitArguments(statement.slice(valuesStart+2,closingParen(statement,valuesStart+1))):[];
   const usableColumns=columns.filter((_,i)=>!(values[i]?.length===1&&(values[i][0].toUpperCase()==='NULL'||(/^\$\d+$/.test(values[i][0])&&Number(values[i][0].slice(1))<=params.length&&params[Number(values[i][0].slice(1))-1]==null))));
   const key=conflictKey(table,usableColumns),updates=splitArguments(statement.slice(duplicate+4));
   const assignments=updates.map(update=>{
    const value=update.slice(2);const prepared=[];
    for(let i=0;i<value.length;i++) {
     const token=value[i];
     if(token.toUpperCase()==='VALUES'&&value[i+1]==='('){prepared.push('excluded','.',value[i+2]);i+=3;}
     else if(postgresTables[table].columns.includes(token)&&value[i-1]!=='.')prepared.push(table,'.',token);
     else prepared.push(token);
    }
    return `${update[0]}=${convertTokens(prepared)}`;
   });
   suffix=` ON CONFLICT (${key.join(',')}) DO UPDATE SET ${assignments.join(',')}`;
   statement=statement.slice(0,duplicate);
  }else if(ignore)suffix=' ON CONFLICT DO NOTHING';
  const identity=postgresTables[table]?.identity;
  return convertTokens(statement)+suffix+(identity?` RETURNING ${identity}`:'');
 }
 return convertTokens(statement);
}
