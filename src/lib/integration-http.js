import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';

const denied = new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['100.64.0.0',10],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) denied.addSubnet(address,prefix,'ipv4');
const privateNetworks = new BlockList();
for(const [address,prefix] of [['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16]]) privateNetworks.addSubnet(address,prefix,'ipv4');
privateNetworks.addSubnet('fc00::',7,'ipv6');
const publicV6 = new BlockList(); publicV6.addSubnet('2000::',3,'ipv6');
denied.addSubnet('2001::',23,'ipv6'); denied.addSubnet('2001:db8::',32,'ipv6'); denied.addSubnet('2002::',16,'ipv6'); denied.addSubnet('3fff::',20,'ipv6');
export const networkError=code=>Object.assign(new Error(code),{code});
export function addressAllowed(address,allowPrivate=false){
 const family=isIP(address); if(!family)return false;
 const type=family===4?'ipv4':'ipv6';
 if(denied.check(address,type))return false;
 if(privateNetworks.check(address,type))return allowPrivate;
 return family===4||publicV6.check(address,type);
}
export function integrationUrl(value){
 let url;try{url=new URL(value);}catch{throw networkError('CONFIG_INVALID');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash)throw networkError('CONFIG_INVALID');
 return url;
}
export async function pinnedDestination(url,resolver=lookup){
 const hostname=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 const allowed=(process.env.INTEGRATION_ALLOWED_PRIVATE_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolver(hostname,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(a=>!addressAllowed(a.address,allowed.includes(hostname))))throw networkError('ADDRESS_BLOCKED');
 return addresses[0];
}
// Resolve once, then pin the socket to the checked address. Keep the original host for TLS/SNI.
// node:https does not follow redirects. Do not log errors from the HTTP library: URLs may contain secrets.
export async function integrationPost(target,body,headers={}){return integrationRequest(target,{method:'POST',body,headers});}
export async function integrationRequest(target,{method='GET',body='',headers={},maxResponseBytes=65536}={}){
 if(!['GET','POST','PUT','PATCH','DELETE','OPTIONS','PROPFIND','REPORT'].includes(method)||Buffer.byteLength(body)>3000000||maxResponseBytes>3000000)throw networkError('CONFIG_INVALID');
 const url=integrationUrl(target); let expired=false;
 const deadline=Date.now()+10000;
 let timeout;
 const destination=await Promise.race([pinnedDestination(url),new Promise((_,reject)=>{timeout=setTimeout(()=>{expired=true;reject(networkError('TIMEOUT'));},10000);})]).finally(()=>clearTimeout(timeout));
 if(expired)throw networkError('TIMEOUT');
 return new Promise((resolve,reject)=>{
  let request,timer; const finish=(error,result)=>{clearTimeout(timer);error?reject(error):resolve(result);};
  request=https.request(url,{method,agent:false,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),'user-agent':'Kontur-Integrations/1.0',...headers},lookup:(_host,options,callback)=>options.all?callback(null,[destination]):callback(null,destination.address,destination.family)},response=>{
   let size=0;const chunks=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>maxResponseBytes){finish(networkError('RESPONSE_TOO_LARGE'));request.destroy();}else chunks.push(chunk);});
   response.on('end',()=>finish(null,{status:response.statusCode,headers:response.headers,text:Buffer.concat(chunks).toString('utf8')}));
   response.on('error',()=>finish(networkError('NETWORK_ERROR')));
  });
  timer=setTimeout(()=>{finish(networkError('TIMEOUT'));request.destroy();},Math.max(1,deadline-Date.now()));
  request.on('error',()=>finish(networkError('NETWORK_ERROR')));request.end(body);
 });
}
