import {spawn} from 'node:child_process';
import {WorkError} from './work-common.js';
export const CAPTION_MIME_FORMATS={'audio/webm':'matroska','audio/mp4':'mp4','audio/ogg':'ogg','audio/wav':'wav'};
export async function normalizeCaptionAudio(buffer,mime){
 const format=CAPTION_MIME_FORMATS[mime.split(';')[0].trim().toLowerCase()];
 if(!format||!buffer.length||buffer.length>1000000)throw new WorkError(422,'Фрагмент должен быть аудио WebM, MP4, Ogg или WAV до 1 МБ');
 const pcm=await new Promise((resolve,reject)=>{
  const child=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','pipe','-f',format,'-i','pipe:0','-map','0:a:0','-vn','-t','13','-ac','1','-ar','16000','-f','s16le','pipe:1'],{stdio:['pipe','pipe','ignore'],shell:false});
  const parts=[];let size=0,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){child.kill('SIGKILL');reject(error);}else resolve(value);};
  const timer=setTimeout(()=>finish(new WorkError(504,'Подготовка субтитров превысила время ожидания')),10000);
  child.on('error',()=>finish(new WorkError(503,'Для субтитров приложению нужен ffmpeg')));
  child.stdin.on('error',()=>{});child.stdout.on('data',chunk=>{size+=chunk.length;if(size>416000)finish(new WorkError(422,'Фрагмент слишком длинный'));else parts.push(chunk);});
  child.on('close',code=>finish(code===0?null:new WorkError(422,'Не удалось прочитать аудиофрагмент'),Buffer.concat(parts)));child.stdin.end(buffer);
 });
 const duration=pcm.length/32000;if(duration<0.15||duration>12)throw new WorkError(422,'Длина фрагмента должна быть от 0,15 до 12 секунд');
 const wav=Buffer.alloc(44+pcm.length);wav.write('RIFF');wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
 return {buffer:wav,duration};
}
