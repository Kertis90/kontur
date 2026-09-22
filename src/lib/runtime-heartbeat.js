import {randomUUID} from 'node:crypto';
import {rows} from './db.js';
export function runtimeHeartbeat(component){
 const id=randomUUID();let pending=null,stopped=false;
 function tick(){if(pending||stopped)return;pending=rows('INSERT INTO runtime_heartbeats(instance_id,component) VALUES(?,?) ON DUPLICATE KEY UPDATE last_seen_at=CURRENT_TIMESTAMP',[id,component]).catch(()=>{}).finally(()=>{pending=null;});}
 tick();const timer=setInterval(tick,30000);
 return async()=>{stopped=true;clearInterval(timer);await pending;await rows('DELETE FROM runtime_heartbeats WHERE instance_id=?',[id]).catch(()=>{});};
}
