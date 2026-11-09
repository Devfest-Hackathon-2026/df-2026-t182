// Procedural furniture from boytchev/3d-assets (MIT), re-skinned with the room's materials.
import * as THREE from 'three';
import { Mug } from './assets/3d-assets/mug.js';
import { Chair } from './assets/3d-assets/chair.js';
import { Monitor } from './assets/3d-assets/monitor.js';
import { Bookshelf } from './assets/3d-assets/bookshelf.js';
import { Table } from './assets/3d-assets/table.js';
import { Stool } from './assets/3d-assets/stool.js';
import { DrinkCan } from './assets/3d-assets/drink-can.js';
import { PhotoFrame } from './assets/3d-assets/photo-frame.js';
import { RoundBox } from './assets/3d-assets/round-box.js';
import { Speaker } from './assets/3d-assets/speaker.js';

const kinds = { mug: Mug, chair: Chair, monitor: Monitor, bookshelf: Bookshelf, table: Table, stool: Stool, can: DrinkCan, frame: PhotoFrame, box: RoundBox, speaker: Speaker };

// prop('chair', { color:'#536055' }) → Group with shadows and a flat standard material.
export function prop(kind, { color = '#6d7466', params = {}, metalness = .1, roughness = .8, keepMaps = false } = {}) {
  const Kind = kinds[kind];
  let asset;
  try { asset = new Kind({ ...Kind.defaults, ...params }); }
  catch (error) { console.warn('prop failed', kind, error); return new THREE.Group(); }
  const material = new THREE.MeshStandardMaterial({ color, metalness, roughness });
  asset.traverse(node => {
    if (!node.isMesh) return;
    const old = node.material;
    if (!(keepMaps && old?.map)) node.material = material;
    else node.material = new THREE.MeshStandardMaterial({ map: old.map, color: '#ffffff', metalness, roughness });
    node.castShadow = true; node.receiveShadow = true;
  });
  return asset;
}
