/** Only HTTP(S) links; model/customer HTML is always plain text. */
export function appendLinkedText(parent:HTMLElement,text:string):void {
  const pattern=/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)|(https?:\/\/[^\s<>]+)/gi;
  let last=0;
  for(const match of text.matchAll(pattern)){
    parent.append(document.createTextNode(text.slice(last,match.index)));
    let url=match[2]??match[3]??'',suffix='';
    if(!match[2]){const trimmed=url.replace(/[.,!?;:。]+$/u,'');suffix=url.slice(trimmed.length);url=trimmed;
      while(url.endsWith(')')&&(url.match(/\)/g)??[]).length>(url.match(/\(/g)??[]).length){url=url.slice(0,-1);suffix=')'+suffix;}}
    try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();
      const a=document.createElement('a');a.href=parsed.href;a.textContent=match[1]??url;a.target='_blank';a.rel='noopener noreferrer';parent.append(a,document.createTextNode(suffix));
    }catch{parent.append(document.createTextNode(match[0]));}
    last=match.index!+match[0].length;
  }
  parent.append(document.createTextNode(text.slice(last)));
}
