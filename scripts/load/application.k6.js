import http from 'k6/http';
import {check,sleep} from 'k6';
import {SharedArray} from 'k6/data';
const users=new SharedArray('staging tokens',()=>JSON.parse(open(__ENV.LOAD_USERS_FILE||'./users.json')));
const count=Number(__ENV.LOAD_USERS||1000),base=String(__ENV.LOAD_BASE_URL||'').replace(/\/$/,''),conference=Number(__ENV.LOAD_CONFERENCE_ID);
if(__ENV.LOAD_TEST_ACK!=='staging'||!base.startsWith('https://')||!Number.isSafeInteger(conference)||conference<1||!Number.isInteger(count)||count<1||count>1000||users.length<count||new Set(users.slice(0,count).map(u=>u.user_id)).size!==count||users.slice(0,count).some(u=>!u.token||!Number.isSafeInteger(u.user_id)||u.user_id<1)||new Set(users.slice(0,count).map(u=>u.token)).size!==count)throw new Error('Use an HTTPS staging host, a conference and distinct staging users with API tokens');
export const options={scenarios:{participants:{executor:'ramping-vus',startVUs:0,stages:[{duration:'2m',target:Math.min(50,count)},{duration:'3m',target:Math.min(250,count)},{duration:'5m',target:count},{duration:'10m',target:count},{duration:'2m',target:0}],gracefulRampDown:'30s'}},thresholds:{http_req_failed:['rate<0.01'],http_req_duration:['p(95)<1500'],checks:['rate>0.99']},systemTags:['status','method','name','scenario'],discardResponseBodies:false};
let after=0;
export default function(){
 const user=users[__VU-1],params={headers:{Authorization:`Bearer ${user.token}`},tags:{name:'conference_chat_poll'},redirects:0,timeout:'10s'};
 const query=user.join_code?`&join_code=${encodeURIComponent(user.join_code)}`:'';
 const response=http.get(`${base}/api/conferences/${conference}/messages?after=${after}&limit=100${query}`,params);
 check(response,{'chat accessible':r=>r.status===200});if(response.status===200){try{const messages=response.json();if(Array.isArray(messages)&&messages.length)after=Number(messages[messages.length-1].id);}catch{}}
 // Optional writes are confined to the explicitly selected staging conference.
 if(__ENV.LOAD_WRITE_CHAT==='true'&&__ITER%12===0){const written=http.post(`${base}/api/conferences/${conference}/messages`,JSON.stringify({body:`Нагрузочная проверка · ${__VU} · ${__ITER}`,message_type:'message',...(user.join_code?{join_code:user.join_code}:{})}),{...params,headers:{...params.headers,'Content-Type':'application/json'},tags:{name:'conference_chat_write'}});check(written,{'chat write accepted':r=>r.status===200||r.status===201});}
 sleep(5);
}
