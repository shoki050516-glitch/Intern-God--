import * as THREE from 'three';
import {assets} from '../runtime/asset-runtime.js';
export function bindBiomeMaterial(mat,sim){const g=sim.grid,data=new Uint8Array(g.N*g.N*4),map=new THREE.DataTexture(data,g.N,g.N,THREE.RGBAFormat);map.minFilter=map.magFilter=THREE.NearestFilter;map.needsUpdate=true;const tex=id=>{const t=assets.colorTextureOf(id);if(t)t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;};Object.assign(mat.uniforms,{biomeState:{value:map},desertTexture:{value:tex('desert_soil')||tex('earth')},basaltTexture:{value:tex('volcanic_soil')||tex('cliff_stone')}});mat.fragmentShader='uniform sampler2D biomeState; uniform sampler2D desertTexture; uniform sampler2D basaltTexture;\n'+mat.fragmentShader;mat.fragmentShader=mat.fragmentShader.replace('  mat3 v2w =',`
 vec2 buv=(vWorldPos.xz-islandBounds.xy)/(islandBounds.zw-islandBounds.xy);
 float biome=floor(texture2D(biomeState,buv).r*255.0+.5);
 float terrainTop=smoothstep(.25,.72,abs(n_dir.y));
 vec3 sand=triplanar(desertTexture,vTexPos,blendW,1.0/18.0);
 vec3 basalt=triplanar(basaltTexture,vTexPos,blendW,1.0/12.0);
 if(biome>3.5&&biome<4.5)albedo=mix(albedo,sand,terrainTop);
 if(biome>4.5&&biome<5.5)albedo=mix(albedo,triplanar(snowMap,vTexPos,blendW,1.0/7.0),terrainTop);
 if(biome>5.5&&biome<6.5)albedo=mix(albedo,triplanar(mapElevation,vTexPos,blendW,1.0/5.0)*vec3(.62,.83,.55),terrainTop*.9);
 if((biome>1.5&&biome<3.5)||biome>8.5)albedo=mix(albedo,basalt,terrainTop);
  mat3 v2w =`);mat.needsUpdate=true;return ()=>{if(!g.biome)return;for(let k=0;k<g.biome.length;k++){data[k*4]=g.biome[k];data[k*4+1]=Math.min(255,g.lava[k]*255);data[k*4+3]=255;}map.needsUpdate=true;};}
