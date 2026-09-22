import crypto from 'node:crypto';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buffer){let bits=0,value=0,out='';for(const byte of buffer){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
export function base32Decode(text){let bits=0,value=0;const bytes=[];for(const char of String(text).toUpperCase().replace(/=+$/,'')){const n=alphabet.indexOf(char);if(n<0)throw new Error('Invalid base32 secret');value=(value<<5)|n;bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(bytes);}
export function hotp(secret,counter,{digits=6,algorithm='sha1'}={}){const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(counter));const h=crypto.createHmac(algorithm,Buffer.isBuffer(secret)?secret:base32Decode(secret)).update(msg).digest(),offset=h.at(-1)&15;return String((h.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function verifyTotp(secret,code,{now=Date.now(),lastCounter=-1,window=1}={}){if(!secret||!/^\d{6}$/.test(String(code)))return null;const counter=Math.floor(now/30000);for(let d=-window;d<=window;d++){const step=counter+d;if(step<=Number(lastCounter??-1)||step<0)continue;if(crypto.timingSafeEqual(Buffer.from(hotp(secret,step)),Buffer.from(String(code))))return step;}return null;}
export const secretHash=value=>crypto.createHash('sha256').update(value).digest('hex');
export const newTotpSecret=()=>base32Encode(crypto.randomBytes(20));
export const newRecoveryCodes=()=>Array.from({length:10},()=>crypto.randomBytes(8).toString('hex'));
