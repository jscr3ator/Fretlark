const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[’‘']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const exact=(a,b)=>normalize(a)===normalize(b);
// Only mastering labels are interchangeable; live, acoustic and remix labels stay significant.
const remasterLabel='(?:\\d{4}\\s+)?remaster(?:ed)?(?:\\s+\\d{4})?(?:\\s+(?:version|edition))?';
const remasterSuffix=new RegExp('(?:\\s*[([]'+remasterLabel+'[)\\]]|\\s+[-–—]\\s*'+remasterLabel+')$','i');
const trackTitle=value=>normalize(String(value||'').replace(remasterSuffix,''));
const expandedEdition=/\b(deluxe|legacy|expanded|anniversary)\b/i;
const editionRank=album=>expandedEdition.test(album.collectionName)?2:/\bremaster(?:ed)?\b/i.test(album.collectionName)?1:0;
const compilation=/\b(greatest hits|best of|compilation|anthology)\b/i;
const pendingLookups=new Map();
function imageUrl(value){
 try{const url=new URL(value);return url.protocol==='https:'&&(/^(?:is\d+-ssl\.mzstatic\.com|(?:e-cdns|cdn)-images\.dzcdn\.net)$/.test(url.hostname))&&!url.port&&!url.username&&!url.password?url:null;}catch{return null;}
}
export function matchTracks(items,title,artist){
 return items.filter(item=>item?.kind==='song'&&typeof item.trackName==='string'&&typeof item.artistName==='string'&&trackTitle(item.trackName)===trackTitle(title)&&exact(item.artistName,artist)&&Number.isSafeInteger(item.collectionId)&&item.collectionId>0);
}
export function chooseCover(tracks,albums,artist){
 const ids=new Set(tracks.map(track=>track.collectionId));
 let candidates=albums.filter(album=>album&&ids.has(album.collectionId)&&album.collectionType==='Album'&&exact(album.artistName,artist)&&typeof album.collectionName==='string'&&!compilation.test(album.collectionName)&&typeof album.releaseDate==='string'&&Number.isFinite(Date.parse(album.releaseDate))&&imageUrl(album.artworkUrl100));
 const preferred=Math.min(...candidates.map(editionRank));
 candidates=candidates.filter(album=>editionRank(album)===preferred);
 candidates.sort((a,b)=>Date.parse(a.releaseDate)-Date.parse(b.releaseDate)||a.collectionId-b.collectionId);
 const album=candidates[0];
 if(!album||candidates.some(other=>other.collectionId!==album.collectionId&&other.releaseDate.slice(0,10)===album.releaseDate.slice(0,10)&&!exact(other.collectionName,album.collectionName)))return null;
 const image=imageUrl(album.artworkUrl100),fallbackUrl=imageUrl(album.fallbackUrl)?.href||image.href;
 image.pathname=image.pathname.replace(/\/100x100bb\.(jpg|png|webp)$/, '/600x600bb.$1');
 const deezer=album.source==='Deezer';
 return {url:image.href,fallbackUrl,album:album.collectionName,artist:album.artistName,source:deezer?'Deezer':'Apple Music',sourceUrl:deezer?`https://www.deezer.com/album/${album.collectionId}`:`https://music.apple.com/album/${album.collectionId}`};
}
async function deezerArtwork(title,artist,fetcher){
 async function request(path,params={}){
  const url=new URL('https://api.deezer.com/'+path);url.search=new URLSearchParams(params);
  const response=await fetcher(url,{signal:AbortSignal.timeout(5000),redirect:'manual'});
  if(!response.ok)throw Error('Deezer artwork catalog unavailable');
  const data=await response.json();if(!data||data.error)throw Error('Deezer artwork catalog unavailable');return data;
 }
 const wanted=trackTitle(title);
 const byArtist=list=>(Array.isArray(list)?list:[]).filter(track=>track?.type==='track'&&typeof track.title==='string'&&exact(track.artist?.name,artist)&&Number.isSafeInteger(track.album?.id)&&track.album.id>0);
 const data=await request('search',{q:title+' '+artist,limit:'25'});
 if(!Array.isArray(data.data))throw Error('Invalid Deezer catalog response');
 let found=byArtist(data.data);
 // Deezer's ranking often buries the original recording under remixes, so a miss gets one track-only search.
 if(!found.some(track=>trackTitle(track.title)===wanted)){
  try{found=found.concat(byArtist((await request('search',{q:'track:"'+title.replace(/"/g,'')+'"',limit:'100'})).data));}catch{/* The first search already answered. */}
 }
 const exactIds=new Set(found.filter(track=>trackTitle(track.title)===wanted).map(track=>track.album.id));
 // Albums holding only a remix or alternate take are checked against their full track list before use.
 const variantIds=found.filter(track=>trackTitle(track.title).startsWith(wanted+' ')).map(track=>track.album.id);
 const ids=[...new Set([...exactIds,...variantIds])].slice(0,4);
 if(!ids.length)return null;
 const responses=await Promise.allSettled(ids.map(id=>request('album/'+id)));
 const albums=responses.filter(r=>r.status==='fulfilled').map(({value:a})=>a)
  .filter(a=>exactIds.has(a.id)||(Array.isArray(a.tracks?.data)&&a.tracks.data.some(track=>typeof track?.title==='string'&&trackTitle(track.title)===wanted&&exact(track.artist?.name,artist))))
  .map(a=>({collectionId:a.id,collectionType:'Album',collectionName:a.title,artistName:a.artist?.name,releaseDate:a.release_date,artworkUrl100:a.cover_xl||a.cover_big||a.cover_medium,fallbackUrl:a.cover_medium||a.cover_small,source:'Deezer'}));
 const result=chooseCover(albums.map(album=>({collectionId:album.collectionId})),albums,artist);
 if(!result&&responses.some(r=>r.status==='rejected'))throw Error('Deezer album lookup unavailable');
 return result;
}
async function catalog(path,params,fetcher){
 const url=new URL('https://itunes.apple.com/'+path);url.search=new URLSearchParams({...params,country:'US'});
 const response=await fetcher(url,{signal:AbortSignal.timeout(5000),redirect:'manual'});
 if(!response.ok){console.warn('Artwork catalog request failed',{path,status:response.status,redirect:response.headers.get('location')?.split('?')[0]||null});throw Error('Artwork catalog unavailable');}
 const data=await response.json();if(!Array.isArray(data.results))throw Error('Invalid artwork catalog response');return data.results;
}
export async function findArtwork(title,artist,{fetcher=fetch,cache=globalThis.caches?.default}={}){
 if(typeof title!=='string'||typeof artist!=='string'||!normalize(title)||!normalize(artist)||title.length>180||artist.length>180)return null;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([trackTitle(title),normalize(artist)])));
 const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 const key=new Request('https://artwork-cache.invalid/v5/'+hash);
 try{const hit=await cache?.match(key);if(hit)return await hit.json();}catch{/* Catalog lookup still works without edge cache. */}
 if(pendingLookups.has(hash))return pendingLookups.get(hash);
 const lookup=(async()=>{
  let result,failed=false;
  try{
   const tracks=matchTracks(await catalog('search',{term:title+' '+artist,entity:'song',limit:'200'},fetcher),title,artist);
   const ids=[...new Set(tracks.map(track=>track.collectionId))];
   result=ids.length?chooseCover(tracks,await catalog('lookup',{id:ids.join(',')},fetcher),artist):null;
  }catch(error){failed=true;console.warn('Apple artwork lookup failed',String(error?.message||error));}
  if(!result)try{result=await deezerArtwork(title,artist,fetcher);}catch(error){failed=true;console.warn('Deezer artwork lookup failed',String(error?.message||error));}
  if(!result&&failed)throw Object.assign(Error('Artwork lookup is temporarily unavailable. Please try again.'),{status:503});
  try{await cache?.put(key,Response.json(result,{headers:{'Cache-Control':'public, max-age='+(result?604800:3600)}}));}catch{/* Missing artwork never blocks the library. */}
  return result;
 })();
 pendingLookups.set(hash,lookup);
 try{return await lookup;}finally{pendingLookups.delete(hash);}
}
