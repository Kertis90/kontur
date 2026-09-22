import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {open,stat,rm,mkdtemp} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const MAGIC=Buffer.from('KONTURBK1\n');
export function backupKey(value){if(!/^[a-f0-9]{64}$/i.test(value||''))throw new Error('BACKUP_ENCRYPTION_KEY must contain 64 hexadecimal characters');return Buffer.from(value,'hex');}
export async function fileSha256(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function encryptBackup(input,path,key,metadata={}){
 const iv=randomBytes(12),header=Buffer.from(JSON.stringify({...metadata,format:1,compression:'gzip',created_at:new Date().toISOString(),iv:iv.toString('base64')}));
 if(header.length>65536)throw new Error('Backup header too large');const length=Buffer.alloc(4);length.writeUInt32BE(header.length);const prefix=Buffer.concat([MAGIC,length,header]),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(prefix);
 const file=await open(path,'wx',0o600);try{await file.writeFile(prefix);const output=createWriteStream(path,{fd:file.fd,start:prefix.length,autoClose:false});await pipeline(input,createGzip(),cipher,output,{end:false});output.end();await new Promise((resolve,reject)=>{output.once('finish',resolve);output.once('error',reject);});await file.write(cipher.getAuthTag(),0,16,(await file.stat()).size);await file.sync();}catch(e){input.destroy?.();await file.close();await rm(path,{force:true});throw e;}await file.close();return {sha256:await fileSha256(path),size:(await stat(path)).size};
}
// Authentication completes before decompression or any SQL execution.
export async function decryptBackup(path,key,callback){
 const file=await open(path,'r');let prefix,header,start,end,tag;
 try{const size=(await file.stat()).size;const initial=Buffer.alloc(MAGIC.length+4);await file.read(initial,0,initial.length,0);if(!initial.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('Unsupported backup format');const length=initial.readUInt32BE(MAGIC.length);if(length<2||length>65536||size<initial.length+length+17)throw new Error('Invalid backup size');const data=Buffer.alloc(length);await file.read(data,0,length,initial.length);header=JSON.parse(data.toString('utf8'));if(header.format!==1||header.compression!=='gzip')throw new Error('Unsupported backup format');prefix=Buffer.concat([initial,data]);start=prefix.length;end=size-17;tag=Buffer.alloc(16);await file.read(tag,0,16,size-16);}finally{await file.close();}
 const dir=await mkdtemp(join(tmpdir(),'kontur-restore-')),compressed=join(dir,'authenticated.gz'),sql=join(dir,'database.sql');
 try{const iv=Buffer.from(header.iv,'base64');if(iv.length!==12)throw new Error('Invalid IV');const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(prefix);decipher.setAuthTag(tag);await pipeline(createReadStream(path,{start,end}),decipher,createWriteStream(compressed,{flags:'wx',mode:0o600}));await pipeline(createReadStream(compressed),createGunzip(),createWriteStream(sql,{flags:'wx',mode:0o600}));return await callback(sql,header);}finally{await rm(dir,{recursive:true,force:true});}
}
