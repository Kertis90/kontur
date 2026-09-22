// Media load on a separately configured, explicitly selected LiveKit CLI project.
import {spawn} from 'node:child_process';
const [scenario='webinar',project,room]=process.argv.slice(2),duration=Number(process.env.LOAD_DURATION_SECONDS||900);
const cases={webinar:['--video-publishers','4','--subscribers','996'],audio:['--audio-publishers','10','--subscribers','990'],meeting:['--video-publishers','50','--subscribers','50']};
if(process.env.LOAD_TEST_ACK!=='staging'||!cases[scenario]||!project||!/^loadtest-[a-zA-Z0-9_-]+$/.test(room||'')||!Number.isInteger(duration)||duration<30||duration>3600){console.error('Usage: LOAD_TEST_ACK=staging node scripts/load/livekit.mjs webinar|audio|meeting STAGING_CLI_PROJECT loadtest-ROOM; optional LOAD_DURATION_SECONDS=900');process.exit(2);}
const child=spawn('lk',['--project',project,'load-test','--room',room,...cases[scenario]],{stdio:'inherit'});let timedOut=false;
const timer=setTimeout(()=>{timedOut=true;child.kill('SIGINT');setTimeout(()=>child.kill('SIGTERM'),10000).unref();},duration*1000);
child.once('error',()=>{clearTimeout(timer);console.error('LiveKit CLI unavailable');process.exitCode=1;});
child.once('exit',(code,signal)=>{clearTimeout(timer);console.log(JSON.stringify({scenario,room,duration_seconds:duration,stopped_by_timer:timedOut,exit_code:code,signal}));process.exitCode=timedOut?0:code||1;});
process.on('SIGINT',()=>child.kill('SIGINT'));
