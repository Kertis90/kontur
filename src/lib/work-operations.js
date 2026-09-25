import {databaseEngine} from './database-config.js';
import IORedis from 'ioredis';
import {one,rows} from './db.js';
import {storage,bucket} from './storage.js';
import {workspaceFor,WorkError,reply} from './work-common.js';
async function probe(fn){const start=Date.now();let timer;try{const ok=await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),3000);})]);return {ok:ok!==false,latency_ms:Date.now()-start};}catch{return {ok:false,latency_ms:Date.now()-start};}finally{clearTimeout(timer);}}
export function operationsMetrics(value){
 const lines=['# HELP kontur_dependency_up Dependency read check',' # TYPE kontur_dependency_up gauge'.trim()];
 for(const [name,result]of Object.entries(value.dependencies))lines.push(`kontur_dependency_up{dependency="${name}"} ${result.ok?1:0}`);
 lines.push('# TYPE kontur_worker_instances gauge');for(const worker of value.workers)lines.push(`kontur_worker_instances{component="${worker.component}"} ${worker.active}`);
 lines.push('# TYPE kontur_queue_items gauge','# TYPE kontur_queue_oldest_seconds gauge');for(const q of value.queues){lines.push(`kontur_queue_items{queue="${q.name}"} ${Number(q.total)||0}`);lines.push(`kontur_queue_oldest_seconds{queue="${q.name}"} ${Math.max(0,Number(q.oldest_seconds)||0)}`);}return lines.join('\n')+'\n';
}
// Проверяет выбранную БД и внешние компоненты, сохраняя отдельное право просмотра состояния.
export async function operationsApi(request,path,user){
 if(request.method!=='GET')throw new WorkError(404,'Метод эксплуатации не найден');await workspaceFor(user,'operations.view');
 let redis;const dependencies=Object.fromEntries(await Promise.all([[databaseEngine(),()=>one('SELECT 1 AS ok')],['redis',async()=>{redis=new IORedis(process.env.REDIS_URL||'redis://127.0.0.1:6379',{lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:0,retryStrategy:()=>null,connectTimeout:2000});redis.on('error',()=>{});await redis.connect();return await redis.ping()==='PONG';}],['s3',()=>storage().bucketExists(bucket())]].map(async([name,fn])=>[name,await probe(fn)])));redis?.disconnect();
 const heartbeat=await rows("SELECT component,SUM(last_seen_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 90 SECOND)) AS active FROM runtime_heartbeats WHERE component IN ('worker','recording-worker') GROUP BY component");
 const workers=['worker','recording-worker'].map(component=>({component,active:Number(heartbeat.find(h=>h.component===component)?.active||0)}));
 const specs=[['outbox',"SELECT COUNT(*) AS total,MAX(TIMESTAMPDIFF(SECOND,available_at,CURRENT_TIMESTAMP)) AS oldest_seconds FROM outbox_events WHERE workspace_id=? AND processed_at IS NULL AND available_at<=CURRENT_TIMESTAMP"],['integrations',"SELECT COUNT(*) AS total,MAX(TIMESTAMPDIFF(SECOND,d.available_at,CURRENT_TIMESTAMP)) AS oldest_seconds FROM integration_deliveries d JOIN integration_connections c ON c.id=d.connection_id WHERE c.workspace_id=? AND d.status IN ('pending','running') AND d.available_at<=CURRENT_TIMESTAMP"],['ai',"SELECT COUNT(*) AS total,MAX(TIMESTAMPDIFF(SECOND,created_at,CURRENT_TIMESTAMP)) AS oldest_seconds FROM ai_jobs WHERE workspace_id=? AND status IN ('queued','running')"],['semantic',"SELECT COUNT(*) AS total,MAX(TIMESTAMPDIFF(SECOND,updated_at,CURRENT_TIMESTAMP)) AS oldest_seconds FROM semantic_jobs WHERE workspace_id=? AND status IN ('queued','running')"],['jira',"SELECT COUNT(*) AS total,MAX(TIMESTAMPDIFF(SECOND,updated_at,CURRENT_TIMESTAMP)) AS oldest_seconds FROM jira_import_jobs WHERE workspace_id=? AND status IN ('queued','running')"],['transcription',"SELECT COUNT(*) AS total,MAX(TIMESTAMPDIFF(SECOND,created_at,CURRENT_TIMESTAMP)) AS oldest_seconds FROM conference_recordings WHERE workspace_id=? AND transcript_status IN ('queued','running')"]];
 const queues=await Promise.all(specs.map(async([name,sql])=>({name,...await one(sql,[user.workspace_id])})));
 const value={checked_at:new Date().toISOString(),dependencies,workers,queues,note:'Проверки чтения и присутствия процессов. Они не подтверждают готовность медиаканала, запись в S3 или восстановимость резервной копии.'};
 if(path[1]==='metrics')return new Response(operationsMetrics(value),{headers:{'Content-Type':'text/plain; version=0.0.4; charset=utf-8','Cache-Control':'no-store'}});return reply(value);
}
