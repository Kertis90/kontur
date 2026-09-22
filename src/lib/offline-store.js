const DATABASE='kontur-offline-v1';
function open(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DATABASE,1);request.onupgradeneeded=()=>request.result.createObjectStore('items');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function operation(mode,work){const database=await open();try{return await new Promise((resolve,reject)=>{const tx=database.transaction('items',mode),request=work(tx.objectStore('items'));let value;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{database.close();}}
export const offlineGet=key=>operation('readonly',store=>store.get(key));
export const offlinePut=(key,value)=>operation('readwrite',store=>store.put(value,key));
export const offlineDelete=key=>operation('readwrite',store=>store.delete(key));
export const ownerKey=user=>`${user.workspace_id}:${user.id}`;
export async function offlineIdentity(){const owner=await offlineGet('current');return owner?await offlineGet(`profile:${owner}`):null;}
export async function rememberOffline(data){
  const owner=ownerKey(data.user);if(!await offlineGet(`enabled:${owner}`))return;
  // Keep only task-editing context, never tokens, chat history, AI results or administration secrets.
  await offlinePut(`profile:${owner}`,{user:data.user,workspace:data.workspace,projects:data.projects,workflows:data.workflows,users:data.users.map(u=>({id:u.id,display_name:u.display_name})),tasks:data.tasks.map(t=>({id:t.id,project_id:t.project_id,title:t.title,description:t.description,priority:t.priority,due_date:t.due_date,assignee_id:t.assignee_id,version_number:t.version_number})),permissions:data.permissions,cached_at:new Date().toISOString()});
  await offlinePut('current',owner);
}
export async function clearOffline(){await operation('readwrite',store=>store.clear());}
export async function updateOfflineQueue(key,update){
  const database=await open();
  try{return await new Promise((resolve,reject)=>{
    const tx=database.transaction('items','readwrite'),store=tx.objectStore('items');let next;
    const request=store.get(key);
    request.onsuccess=()=>{try{next=update(request.result||[]);store.put(next,key);}catch(error){tx.abort();reject(error);}};
    tx.oncomplete=()=>resolve(next);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{database.close();}
}
export async function enqueueOffline(user,operation){return updateOfflineQueue(`queue:${ownerKey(user)}`,queue=>[...queue,{...operation,operation_id:crypto.randomUUID(),status:'queued',created_at:new Date().toISOString()}]);}
