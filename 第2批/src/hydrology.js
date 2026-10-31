export function prepareDrainage(sim){
 const g=sim.grid,n=g.h.length,N=g.N,spill=new Float32Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),seen=new Uint8Array(n),order=[],heap=[];
 const push=(k,h)=>{let i=heap.length;heap.push({k,h});while(i){const p=(i-1)>>1;if(heap[p].h<=h)break;heap[i]=heap[p];i=p;}heap[i]={k,h};};
 const pop=()=>{const root=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].h<heap[c].h)c++;if(last.h<=heap[c].h)break;heap[i]=heap[c];i=c;}heap[i]=last;}return root;};
 const neighbors=k=>{const x=k%N,z=Math.floor(k/N);return [x>0?k-1:-1,x<N-1?k+1:-1,z>0?k-N:-1,z<N-1?k+N:-1];};
 for(let k=0;k<n;k++)if(g.valid[k]&&neighbors(k).some(q=>q<0||!g.valid[q])){seen[k]=1;spill[k]=g.h[k];push(k,spill[k]);}
 while(heap.length){const {k,h}=pop();order.push(k);for(const q of neighbors(k)){if(q<0||!g.valid[q]||seen[q])continue;seen[q]=1;parent[q]=k;spill[q]=Math.max(g.h[q],h);push(q,spill[q]);}}
 g.drainage={spill,parent,order};g.drainageDirty=false;
}
export function drainWater(sim,dt){
 const g=sim.grid,N=g.N,area=g.dx*g.dz;if(!g.drainage||g.drainageDirty)prepareDrainage(sim);
 const {spill,parent,order}=g.drainage,stats=sim.waterStats??={input:0,evaporated:0,infiltrated:0,outflow:0,volume:0,balance:0};
 const protectedCells=new Uint8Array(g.h.length);
 for(const h of sim.houses){const b=h.collider||{minX:h.x-3,maxX:h.x+3,minZ:h.z-2.5,maxZ:h.z+2.5};const pad=Math.max(g.dx,g.dz);for(let j=Math.max(0,Math.floor((b.minZ-pad-g.minZ)/g.dz));j<=Math.min(N-1,Math.ceil((b.maxZ+pad-g.minZ)/g.dz));j++)for(let i=Math.max(0,Math.floor((b.minX-pad-g.minX)/g.dx));i<=Math.min(N-1,Math.ceil((b.maxX+pad-g.minX)/g.dx));i++)protectedCells[j*N+i]=1;}
 g.flowX.fill(0);g.flowZ.fill(0);g.edgeOutflow??=new Float32Array(g.h.length);g.edgeOutflow.fill(0);
 const transfer=(k,q,w)=>{if(w<=0)return;g.water[k]-=w;if(q>=0){g.water[q]+=w;g.flowX[k]+=(q%N-k%N)*w;g.flowZ[k]+=(Math.floor(q/N)-Math.floor(k/N))*w;}else{stats.outflow+=w*area;g.edgeOutflow[k]+=w*area/dt;sim.runoff=(sim.runoff||0)+w*area;}};
 const delta=new Float32Array(g.h.length);
 for(const k of order){const w=g.water[k];if(w<=0)continue;const x=k%N,z=Math.floor(k/N),qs=[];let sum=0;for(const q of [x>0?k-1:-1,x<N-1?k+1:-1,z>0?k-N:-1,z<N-1?k+N:-1]){if(q<0||!g.valid[q])continue;const f=Math.max(0,(g.h[k]+w-g.h[q]-g.water[q])*.9*dt);if(f>0){qs.push([q,f]);sum+=f;}}const scale=sum>w*.7?w*.7/sum:1;for(const [q,f]of qs){const v=f*scale;delta[k]-=v;delta[q]+=v;g.flowX[k]+=(q%N-k%N)*v;g.flowZ[k]+=(Math.floor(q/N)-Math.floor(k/N))*v;}}
 for(const k of order)g.water[k]=Math.max(0,g.water[k]+delta[k]);
 for(let i=order.length-1;i>=0;i--){const k=order[i],capacity=protectedCells[k]?0:Math.max(0,spill[k]-g.h[k])+.065;transfer(k,parent[k],Math.max(0,g.water[k]-capacity));}
 const sunny=!sim.clouds.some(c=>c.rain&&c.water>0);let lakes=0,volume=0;
 for(const k of order){const basin=spill[k]-g.h[k]>.12;const infiltration=Math.min(g.water[k],dt*(basin?.0006:.021));g.water[k]-=infiltration;stats.infiltrated+=infiltration*area;const evaporation=Math.min(g.water[k],dt*(basin?(sunny?.0015:.0004):(sunny?.014:.004)));g.water[k]-=evaporation;stats.evaporated+=evaporation*area;if(g.water[k]>.22)lakes++;volume+=g.water[k]*area;
 if(g.water[k]>.015||infiltration>0)g.moist[k]=Math.min(1,g.moist[k]+dt*.08);else {const drought=sim.sunSpeed>1&&sunny,baseline=drought?.06:.42;g.moist[k]=Math.max(.04,Math.min(1,g.moist[k]+(baseline-g.moist[k])*dt*(drought?.008:.012)));}g.traffic[k]=Math.max(0,g.traffic[k]-dt*.000005);g.aqua[k]=Math.max(0,Math.min(1,g.aqua[k]+(g.water[k]>.2?dt*.012*Math.max(.15,Math.sin(sim.sun*6.283)):-dt*.03)));}
 stats.volume=volume;stats.balance=stats.input-stats.outflow-stats.infiltrated-stats.evaporated-volume;sim.flags.lake=lakes>8;sim.waterChanged=true;
}
