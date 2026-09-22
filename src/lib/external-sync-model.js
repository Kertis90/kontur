import crypto from 'node:crypto';
import {WorkError} from './work-common.js';
export const snapshotHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function syncDecision(baseline,local,remote){
 if(!remote)return baseline?'conflict':'push';
 if(!baseline)return snapshotHash(local)===snapshotHash(remote)?'equal':'conflict';
 const changedLocal=snapshotHash(local)!==snapshotHash(baseline.local),changedRemote=snapshotHash(remote)!==snapshotHash(baseline.remote);
 if(changedLocal&&changedRemote)return snapshotHash(local)===snapshotHash(remote)?'equal':'conflict';
 return changedLocal?'push':changedRemote?'pull':'equal';
}
export function safeExternalKey(kind,key){if(!(kind==='gitlab'?/^\d{1,15}$/:/^kontur-[a-z0-9-]+$/).test(String(key)))throw new WorkError(422,'Некорректный внешний идентификатор');return String(key);}
export const syncError=code=>Object.assign(new WorkError(409,code),{syncCode:code});
