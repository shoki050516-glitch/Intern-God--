import * as THREE from 'three';

const attached=new WeakMap();
const contacts=new WeakMap();
const vector=(value,size)=>Array.isArray(value)&&value.length===size&&value.every(Number.isFinite);
export function validAttachmentTransform(value){
  return !!value&&vector(value.position,3)&&vector(value.quaternion,4)&&vector(value.scale,3)&&
    value.scale.every(n=>n>0&&n<=1e6)&&value.position.every(n=>Math.abs(n)<=1e6)&&
    Math.abs(Math.hypot(...value.quaternion)-1)<=1e-5;
}
export function findAttachmentBone(character,name){
  if(!character?.isObject3D||typeof name!=='string'||!name||name.length>256)return null;
  const clean=THREE.PropertyBinding.sanitizeNodeName(name);
  const matches=[];character.traverse(node=>{if(node.isBone&&(node.name===name||node.name===clean))matches.push(node);});
  return matches.length===1?matches[0]:null;
}
export function normalizeAttachmentModel(model,transform){
  const value=transform??{scale:[1,1,1],rotationY:0,offset:[0,0,0]};
  if(!model?.isObject3D||!vector(value.scale,3)||value.scale.some(n=>n<=0)||
    !vector(value.offset,3)||!Number.isFinite(value.rotationY)||
    (value.rotationX!==undefined&&!Number.isFinite(value.rotationX)))return null;
  model.scale.fromArray(value.scale);
  model.rotation.set(value.rotationX??0,value.rotationY,0,'XYZ');
  model.position.fromArray(value.offset);
  const wrapper=new THREE.Group();wrapper.add(model);wrapper.updateMatrixWorld(true);
  return wrapper;
}
export function detachAttachment(object){
  const record=attached.get(object);if(!record)return false;
  object.updateWorldMatrix(true,false);const world=object.matrixWorld.clone();
  object.removeFromParent();world.decompose(object.position,object.quaternion,object.scale);
  const byContact=contacts.get(record.character);
  if(byContact?.get(record.contact)===object)byContact.delete(record.contact);
  attached.delete(object);return true;
}
export function bindAttachment(character,object,binding){
  if(!character?.isObject3D||!object?.isObject3D||character===object||
    !['grip_left','grip_right'].includes(binding?.contact)||!validAttachmentTransform(binding.transform))return false;
  for(let node=character;node;node=node.parent)if(node===object)return false;
  const bone=findAttachmentBone(character,binding.bone);if(!bone)return false;
  let byContact=contacts.get(character);if(!byContact){byContact=new Map();contacts.set(character,byContact);}
  const prior=byContact.get(binding.contact);if(prior&&prior!==object)detachAttachment(prior);
  if(attached.has(object))detachAttachment(object);
  bone.add(object);object.position.fromArray(binding.transform.position);
  object.quaternion.fromArray(binding.transform.quaternion);object.scale.fromArray(binding.transform.scale);
  object.updateMatrixWorld(true);byContact.set(binding.contact,object);
  attached.set(object,{character,contact:binding.contact});return true;
}
