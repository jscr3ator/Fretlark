const encoder=new TextEncoder();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const bytesHex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export const hashValue=async value=>bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
export function newSecret(){
 const bytes=crypto.getRandomValues(new Uint8Array(20));let bits=0,value=0,result='';
 for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(value>>>bits)&31];}}
 return result;
}
function decodeSecret(secret){
 let bits=0,value=0;const result=[];
 for(const letter of secret){const digit=alphabet.indexOf(letter);if(digit<0)throw Error('Invalid authenticator secret');value=(value<<5)|digit;bits+=5;if(bits>=8){bits-=8;result.push((value>>>bits)&255);}}
 return new Uint8Array(result);
}
export async function totp(secret,step,digits=6){
 const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt(step));
 const key=await crypto.subtle.importKey('raw',decodeSecret(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)),offset=mac[19]&15;
 const value=((mac[offset]&127)<<24)|(mac[offset+1]<<16)|(mac[offset+2]<<8)|mac[offset+3];
 return String(value%10**digits).padStart(digits,'0');
}
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const from64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function encryptionKey(e){
 let bytes;try{bytes=from64(e.MFA_ENCRYPTION_KEY||'');}catch{}
 if(bytes?.length!==32)throw fail('Two-factor setup is temporarily unavailable.',503);
 return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealSecret(e,id,secret){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id)},await encryptionKey(e),encoder.encode(secret));
 return `v1.${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
export async function openSecret(e,id,sealed){
 const [version,iv,ciphertext]=sealed.split('.');if(version!=='v1')throw Error('Unsupported MFA key version');
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(iv),additionalData:encoder.encode(id)},await encryptionKey(e),from64(ciphertext)));
}
export async function matchingStep(secret,code,now=Date.now()){
 if(typeof code!=='string'||!/^\d{6}$/.test(code.trim()))return null;
 const step=Math.floor(now/30000);let match=null;
 for(const candidate of [step-1,step,step+1])if(candidate>=0&&await totp(secret,candidate)===code.trim())match=candidate;
 return match;
}
export async function recoveryCodes(){
 const codes=Array.from({length:10},()=>bytesHex(crypto.getRandomValues(new Uint8Array(12))).toUpperCase().match(/.{4}/g).join('-'));
 return {codes,hashes:JSON.stringify(await Promise.all(codes.map(code=>hashValue(code.replaceAll('-','').toLowerCase()))))};
}
export async function consumeFactor(e,row,code){
 if(!row.mfa_secret)throw fail('Two-factor authentication is not enabled.');
 const normalized=typeof code==='string'?code.trim():'';
 let result;
 if(/^\d{6}$/.test(normalized)){
  const step=await matchingStep(await openSecret(e,row.id,row.mfa_secret),normalized);
  if(step!==null)result=await e.DB.prepare('UPDATE teachers SET mfa_last_step=? WHERE id=? AND suspended=0 AND mfa_secret=? AND mfa_last_step<?').bind(step,row.id,row.mfa_secret,step).run();
 }else{
  const value=normalized.replaceAll('-','').toLowerCase();
  if(/^[a-f0-9]{24}$/.test(value)){
   const hashes=JSON.parse(row.mfa_recovery_codes),hash=await hashValue(value);
   if(hashes.includes(hash))result=await e.DB.prepare('UPDATE teachers SET mfa_recovery_codes=? WHERE id=? AND suspended=0 AND mfa_secret=? AND mfa_recovery_codes=?').bind(JSON.stringify(hashes.filter(item=>item!==hash)),row.id,row.mfa_secret,row.mfa_recovery_codes).run();
  }
 }
 if(!result?.meta.changes)throw fail('Invalid or already used code. Try the next authenticator code or a recovery code.',401);
}
