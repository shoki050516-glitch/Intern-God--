function source(value) {
  if (!value) return ['none','100% 100%','center'];
  const item = typeof value === 'string' ? {url:value} : value;
  if (typeof item.url !== 'string' || !item.url.trim()) throw new TypeError('UI art needs a URL');
  const columns=item.columns??1, rows=item.rows??1, index=item.index??0;
  if (![columns,rows,index].every(Number.isInteger) || columns<1 || rows<1 || columns>64 || rows>64 || index<0 || index>=columns*rows) throw new RangeError('Invalid UI atlas cell');
  const crop=item.crop??[0,0,1,1];
  if (!Array.isArray(crop) || crop.length!==4 || !crop.every(Number.isFinite)) throw new RangeError('Invalid UI art crop');
  const [x,y,w,h]=crop;
  if (x<0 || y<0 || w<=0 || h<=0 || x+w>1 || y+h>1) throw new RangeError('UI art crop must fit inside its cell');
  return ['url('+JSON.stringify(item.url)+')',columns/w*100+'% '+rows/h*100+'%',(columns===w?50:((index%columns)+x)*100/(columns-w))+'% '+(rows===h?50:(Math.floor(index/columns)+y)*100/(rows-h))+'%',x!==0 || y!==0 || w!==1 || h!==1];
}
const authoredPadding=new WeakMap();
function paddingProperties(style) {
  return Array.from(style).filter(name=>name==='padding' || name.startsWith('padding-'));
}
function contentLayout(element,inset) {
  if (inset===undefined) return;
  if (inset===null) {
    if (authoredPadding.has(element)) {
      for (const name of paddingProperties(element.style)) element.style.removeProperty(name);
      element.style.cssText+=';'+authoredPadding.get(element);
    }
    authoredPadding.delete(element); delete element.dataset.hmArtContent; return;
  }
  if (typeof inset!=='string' || !CSS.supports('padding',inset)) throw new TypeError('contentInset needs a CSS padding value');
  if (!authoredPadding.has(element)) {
    if (!element.style.getPropertyValue('padding') && paddingProperties(element.style).some(name=>!element.style.getPropertyValue(name))) throw new TypeError('Move mixed variable padding to CSS or use explicit side values before setting contentInset; the browser cannot serialize it safely');
    const original=document.createElement('span').style;
    original.cssText=element.style.cssText;
    const padding=new Set(paddingProperties(original));
    for (const name of Array.from(original)) if (!padding.has(name)) original.removeProperty(name);
    authoredPadding.set(element,original.cssText);
  }
  element.style.padding=inset; element.dataset.hmArtContent='safe';
}
function prepare(element,kind) {
  element.dataset.hmArt=kind;
  element.style.background='transparent'; element.style.borderColor='transparent'; element.style.borderImage='none';
  element.style.boxShadow='none';
  const position=getComputedStyle(element).position;
  if (!position || position==='static') element.style.position='relative';
  element.style.isolation='isolate';
}
export function setButtonArt(button,{normal,hover,pressed,disabled,contentInset}={}) {
  if (button.tagName!=='BUTTON') throw new TypeError('setButtonArt needs a native button');
  const states={normal:source(normal),hover:source(hover??normal),pressed:source(pressed??normal),disabled:source(disabled??normal)};
  contentLayout(button,contentInset); prepare(button,'button');
  for (const [state,values] of Object.entries(states)) for (let i=0;i<3;i++) button.style.setProperty('--hm-art-'+state+'-'+['image','size','position'][i],values[i]);
  return button;
}
export function setPanelArt(panel,{image,slice,width='1rem',contentInset}={}) {
  const values=source(image);
  if (slice!=null && values[3]) throw new TypeError('Nine-slice needs a whole frame image; cropped sources use stretch mode');
  contentLayout(panel,contentInset); prepare(panel,'panel');
  for (let i=0;i<3;i++) panel.style.setProperty('--hm-art-panel-'+['image','size','position'][i],values[i]);
  panel.style.setProperty('--hm-art-panel-slice',slice==null?'0':String(slice));
  panel.style.setProperty('--hm-art-panel-width',slice==null?'0px':String(width));
  panel.dataset.hmArtSliced=slice==null?'false':'true'; return panel;
}
