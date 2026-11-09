import * as THREE from 'three';

// Both renderers use the same scene, camera, meshes, textures and hit testing.
// Canvas projection keeps the room three-dimensional when WebGL is unavailable.
export function createRenderer(host) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true });
  if (context) {
    const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    host.append(canvas);
    return renderer;
  }
  const softwareCanvas = document.createElement('canvas');
  host.append(softwareCanvas);
  return new ProjectedRenderer(softwareCanvas);
}

class ProjectedRenderer {
  constructor(canvas) {
    this.domElement = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.width = 1;
    this.height = 1;
    this.meshCache = new WeakMap();
    this.textureShades = new WeakMap();
    this.color = new THREE.Color();
    this.normal = new THREE.Vector3();
    this.edge = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.cameraDirection = new THREE.Vector3();
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    const scale = Math.min(devicePixelRatio || 1, 1.35);
    this.domElement.width = Math.round(width * scale);
    this.domElement.height = Math.round(height * scale);
    this.context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  render(scene, camera) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const ctx = this.context;
    ctx.fillStyle = '#101719';
    ctx.fillRect(0, 0, this.width, this.height);
    const faces = [];
    this.cameraPosition.copy(camera.position);
    camera.getWorldDirection(this.cameraDirection);
    const lamp = scene.userData.lampLevel ?? 1;
    this.lightOffset = scene.userData.lightOffset || 0;
    scene.traverseVisible(mesh => {
      if (!mesh.isMesh || mesh.userData.hitOnly) return;
      const geometry = mesh.geometry;
      const material = mesh.material;
      if (Array.isArray(material) || material.opacity < .01) return;
      let cached = this.meshCache.get(mesh);
      if (!cached) {
        const position = geometry.attributes.position;
        const uv = geometry.attributes.uv;
        cached = {
          vertices: Array.from({ length: position.count }, (_, i) => ({
            local: new THREE.Vector3().fromBufferAttribute(position, i),
            world: new THREE.Vector3(),
            camera: new THREE.Vector3(),
            u: uv ? uv.getX(i) : 0,
            v: uv ? 1 - uv.getY(i) : 0
          })),
          indices: geometry.index ? Array.from(geometry.index.array) : Array.from({ length: position.count }, (_, i) => i)
        };
        this.meshCache.set(mesh, cached);
      }
      for (const vertex of cached.vertices) {
        vertex.world.copy(vertex.local).applyMatrix4(mesh.matrixWorld);
        vertex.camera.copy(vertex.world).applyMatrix4(camera.matrixWorldInverse);
      }
      for (let i = 0; i < cached.indices.length; i += 3) {
        const a = cached.vertices[cached.indices[i]];
        const b = cached.vertices[cached.indices[i + 1]];
        const c = cached.vertices[cached.indices[i + 2]];
        this.normal.subVectors(b.world, a.world);
        this.edge.subVectors(c.world, a.world);
        this.normal.cross(this.edge).normalize();
        this.edge.subVectors(camera.position, a.world);
        if (material.side !== THREE.DoubleSide && this.normal.dot(this.edge) <= 0) continue;
        if (a.camera.z > -.07 && b.camera.z > -.07 && c.camera.z > -.07) continue;
        const vertices = clipNear([a, b, c]);
        if (vertices.length < 3) continue;
        const center = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
        const brightness = this.lighting(center, this.normal, material, lamp);
        const projected = vertices.map(vertex => {
          const point = vertex.camera.clone().applyMatrix4(camera.projectionMatrix);
          return { x: (point.x + 1) * this.width / 2, y: (1 - point.y) * this.height / 2, u: vertex.u, v: vertex.v };
        });
        if (projected.every(p => p.x < 0) || projected.every(p => p.x > this.width) || projected.every(p => p.y < 0) || projected.every(p => p.y > this.height)) continue;
        for (let j = 1; j < projected.length - 1; j++) {
          faces.push({
            points: [projected[0], projected[j], projected[j + 1]],
            depth: (a.camera.z + b.camera.z + c.camera.z) / 3,
            order: mesh.renderOrder,
            material,
            brightness
          });
        }
      }
    });
    faces.sort((a, b) => a.order - b.order || a.depth - b.depth);
    for (const face of faces) this.drawFace(face);
  }

  lighting(center, normal, material, lamp) {
    if (material.isMeshBasicMaterial) return 1;
    const emissive = material.emissive?.getHex() ? material.emissiveIntensity || 1 : 0;
    let brightness = .22 + Math.max(0, normal.y) * .13;
    const toCamera = this.cameraPosition.clone().sub(center);
    const distance = toCamera.length();
    toCamera.normalize();
    const beam = Math.max(0, -toCamera.dot(this.cameraDirection));
    brightness += Math.max(0, normal.dot(toCamera)) * Math.pow(beam, 7) * .85 / (1 + distance * .08);
    for (const light of [
      { point: new THREE.Vector3(this.lightOffset, 3.7, -1.2), power: 3.8 * lamp },
      { point: new THREE.Vector3(this.lightOffset - 2.8, 1.5, -.7), power: 1.1 * lamp }
    ]) {
      const direction = light.point.sub(center);
      const length = direction.length();
      direction.normalize();
      brightness += Math.max(0, normal.dot(direction)) * light.power / (2 + length * length * .3);
    }
    return Math.min(1.2, brightness + emissive * .8);
  }

  drawFace(face) {
    const { points, material, brightness } = face;
    const ctx = this.context;
    const centerX = (points[0].x + points[1].x + points[2].x) / 3;
    const centerY = (points[0].y + points[1].y + points[2].y) / 3;
    ctx.beginPath();
    points.forEach((point, i) => {
      const x = point.x + Math.sign(point.x - centerX) * .35;
      const y = point.y + Math.sign(point.y - centerY) * .35;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.globalAlpha = material.opacity ?? 1;
    const image = material.map?.image;
    if (image?.width && image?.height) {
      let source = image;
      if (brightness < 1) {
        const level = Math.round(brightness * 24) / 24;
        let shades = this.textureShades.get(image);
        if (!shades) { shades = new Map(); this.textureShades.set(image, shades); }
        source = shades.get(level);
        if (!source) {
          source = document.createElement('canvas');
          source.width = image.width; source.height = image.height;
          const paint = source.getContext('2d');
          paint.drawImage(image, 0, 0);
          paint.fillStyle = `rgba(7,17,20,${1 - level})`;
          paint.fillRect(0, 0, source.width, source.height);
          shades.set(level, source);
        }
      }
      ctx.save(); ctx.clip();
      if (applyTextureTransform(ctx, points, image.width, image.height)) ctx.drawImage(source, 0, 0);
      ctx.restore();
    } else {
      this.color.copy(material.color).multiplyScalar(brightness);
      ctx.fillStyle = this.color.getStyle();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function clipNear(vertices) {
  const result = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const aInside = a.camera.z <= -.07;
    const bInside = b.camera.z <= -.07;
    if (aInside) result.push(a);
    if (aInside !== bInside) {
      const t = (-.07 - a.camera.z) / (b.camera.z - a.camera.z);
      result.push({ camera: a.camera.clone().lerp(b.camera, t), u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return result;
}

function applyTextureTransform(ctx, points, width, height) {
  const [a, b, c] = points;
  const u0 = a.u * width, v0 = a.v * height;
  const u1 = b.u * width, v1 = b.v * height;
  const u2 = c.u * width, v2 = c.v * height;
  const determinant = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(determinant) < .0001) return false;
  const m11 = (a.x * (v1 - v2) + b.x * (v2 - v0) + c.x * (v0 - v1)) / determinant;
  const m12 = (a.y * (v1 - v2) + b.y * (v2 - v0) + c.y * (v0 - v1)) / determinant;
  const m21 = (a.x * (u2 - u1) + b.x * (u0 - u2) + c.x * (u1 - u0)) / determinant;
  const m22 = (a.y * (u2 - u1) + b.y * (u0 - u2) + c.y * (u1 - u0)) / determinant;
  ctx.transform(m11, m12, m21, m22, a.x - m11 * u0 - m21 * v0, a.y - m12 * u0 - m22 * v0);
  return true;
}
