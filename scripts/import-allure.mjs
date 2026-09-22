#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
const folder=process.argv[2]||'allure-results';
try{
 const {KONTUR_URL,KONTUR_TOKEN,KONTUR_ALLURE_CONNECTION_ID,KONTUR_ALLURE_LAUNCH_ID,KONTUR_ALLURE_REPORT_URL='',KONTUR_ALLURE_TITLE='Автотесты Allure'}=process.env;
 if(!KONTUR_URL||!KONTUR_TOKEN||!/^\d+$/.test(KONTUR_ALLURE_CONNECTION_ID||'')||!KONTUR_ALLURE_LAUNCH_ID)throw new Error('Укажите KONTUR_URL, KONTUR_TOKEN, KONTUR_ALLURE_CONNECTION_ID и KONTUR_ALLURE_LAUNCH_ID в окружении CI');
 const base=new URL(KONTUR_URL);if(base.username||base.password||base.search||base.hash||!['https:','http:'].includes(base.protocol))throw new Error('Некорректный KONTUR_URL');
 if(base.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname)&&process.env.KONTUR_ALLOW_HTTP!=='true')throw new Error('Для передачи API-токена используйте HTTPS. Для доверенного локального стенда можно явно задать KONTUR_ALLOW_HTTP=true');
 const names=(await fs.readdir(folder)).filter(n=>n.endsWith('-result.json')).sort();
 if(!names.length||names.length>200)throw new Error('Ожидается от 1 до 200 файлов *-result.json');
 const results=[];let size=0;for(const name of names){const file=path.join(folder,name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Поддерживаются обычные файлы результатов');size+=stat.size;if(size>2_800_000)throw new Error('Пакет результатов превышает 2,8 МБ');results.push(JSON.parse(await fs.readFile(file,'utf8')));}
 const payload=JSON.stringify({external_id:KONTUR_ALLURE_LAUNCH_ID,title:KONTUR_ALLURE_TITLE,report_url:KONTUR_ALLURE_REPORT_URL,results});
 if(Buffer.byteLength(payload)>3_000_000)throw new Error('Пакет превышает 3 МБ');
 const response=await fetch(new URL(`/api/work/allure/connections/${KONTUR_ALLURE_CONNECTION_ID}/import`,base),{method:'POST',redirect:'error',headers:{authorization:`Bearer ${KONTUR_TOKEN}`,'content-type':'application/json'},body:payload,signal:AbortSignal.timeout(120000)});
 const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`Контур: HTTP ${response.status}. ${value.error||'Импорт не выполнен'}`);
 console.log(JSON.stringify({run_id:value.run_id,summary:value.summary,replayed:value.replayed},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
