(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LyricsTool=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function parseLyrics(text){
    // Bracketed text is a hidden comment. Repeated spaces/hyphens encode blank beats.
    text=String(text??'').replace(/\[[^\]]*\]/g,'').replace(/[\r\n\t]/g,' ');
    const words=[];
    for(const raw of text.split(/ +/)) if(raw) words.push(raw);
    const tokens=[];
    for(const word of words){
      const parts=word.split('+');
      const joined=parts.map(part=>splitWord(part)).flat();
      if(parts.length>1){
        tokens.push(joined.filter(Boolean).join(' '));
      } else tokens.push(...joined);
    }
    return tokens;
  }
  function splitWord(word){
    const out=[]; let part='',blankDash=false;
    for(const c of word){
      if(c==='-'){if(part){out.push(part+'-');part='';blankDash=false;}else if(!blankDash){out.push('');blankDash=true;}}
      else {part+=c;blankDash=false;}
    }
    if(part)out.push(part);
    return out;
  }
  function noteBeats(score,trackIndex,startBar){
    const staff=score.tracks[trackIndex]?.staves[0], out=[];
    if(!staff)return out;
    for(let b=startBar;b<staff.bars.length;b++) for(const beat of staff.bars[b].voices[0]?.beats||[]){
      if((beat.graceType!=null&&beat.graceType!==0)||!beat.notes.length||beat.notes.every(n=>n.isTieDestination))continue;
      out.push(beat);
    }
    return out;
  }
  function assignLyrics(score,trackIndex,startBar,text,line=0){
    if(!Number.isInteger(line)||line<0||line>4)throw new RangeError('line must be 0-4');
    const beats=noteBeats(score,trackIndex,startBar); for(const beat of beats)if(beat.lyrics)beat.lyrics[line]='';
    const tokens=parseLyrics(text), count=Math.min(tokens.length,beats.length);
    for(let i=0;i<count;i++){const lyrics=beats[i].lyrics||[];while(lyrics.length<=line)lyrics.push('');lyrics[line]=tokens[i];beats[i].lyrics=lyrics;}
    return {assigned:count,leftover:tokens.length-count};
  }
  function readLyrics(score,trackIndex,startBar,line=0){
    if(!Number.isInteger(line)||line<0||line>4)throw new RangeError('line must be 0-4');
    const values=noteBeats(score,trackIndex,startBar).map(b=>b.lyrics?.[line]||'-');
    let text=''; for(const value of values){if(!text)text=value==='-'?'':value;else if(text.endsWith('-'))text+=value==='-'?'':value;else text+=' '+(value==='-'?'-':value);}
    return text;
  }
  return {parseLyrics,assignLyrics,readLyrics};
});
