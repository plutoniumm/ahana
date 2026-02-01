import { Vec2 } from './utils';
import { Polygon, Lens } from './optical';

const canvas = document.getElementById('simCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

let width, height;

let panOffset = { x: 0, y: 0 };
let zoom = 1;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffsetStart = { x: 0, y: 0 };

const DISPERSION_STRENGTH = 0.04;
const MAX_BOUNCES = 12;

let lightSource = { x: 100, y: 300 };
let objects: Array<any> = [];
let selectedObj: any = null;
let dragging: any = null;
let dragOffset = { x: 0, y: 0 };

const ui = {
  selection: document.getElementById('selectionPanel'),
  rot: document.getElementById('objRotation') as HTMLInputElement,
  rotVal: document.getElementById('objRotVal'),
  ior: document.getElementById('objIOR') as HTMLInputElement,
  iorVal: document.getElementById('objIORVal'),
  curve: document.getElementById('objCurve') as HTMLInputElement,
  lensCtrl: document.getElementById('lensControls'),
  spread: document.getElementById('spreadSlider') as HTMLInputElement,
  spreadVal: document.getElementById('spreadVal'),
  angle: document.getElementById('angleSlider') as HTMLInputElement,
  angleVal: document.getElementById('angleVal'),
  rays: document.getElementById('rayCountSlider') as HTMLInputElement,
  raysVal: document.getElementById('rayVal')
};

let activePanel: HTMLElement | null = null;
let draggingPanel = false;
let start = { x: 0, y: 0 };
let panelStart = { x: 0, y: 0 };

function activate (e: MouseEvent) {
  const panel = (e.target as HTMLElement).closest('.panel') as HTMLElement;
  if (!panel) return;

  if (e.target instanceof HTMLElement && e.target.tagName.toLowerCase() === 'input') return;
  if (e.target instanceof HTMLElement && e.target.tagName.toLowerCase() === 'button') return;

  activePanel = panel;
  draggingPanel = true;
  document.body.style.cursor = 'move';
  start = { x: e.clientX, y: e.clientY };
  const rect = panel.getBoundingClientRect();
  panelStart = { x: rect.left, y: rect.top };
  e.preventDefault();
}

document.addEventListener('mousedown', (e) => activate(e));

window.addEventListener('mousemove', (e) => {
  if (!draggingPanel || !activePanel) return;

  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  activePanel.style.left = (panelStart.x + dx) + 'px';
  activePanel.style.top = (panelStart.y + dy) + 'px';
});

window.addEventListener('mouseup', () => {
  draggingPanel = false;
  activePanel = null;
  document.body.style.cursor = '';
});

function init () {
  window.addEventListener('resize', resize);
  resize();
  addPrism();

  ui.angle.value = '0';

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const mx = e.clientX;
    const my = e.clientY;
    const oldWorld = screenToWorld(mx, my);
    const delta = e.deltaY;
    const zoomFactor = Math.exp(-delta * 0.0015);
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * zoomFactor));
    zoom = newZoom;
    panOffset.x = mx - oldWorld.x * zoom;
    panOffset.y = my - oldWorld.y * zoom;
  },
    { passive: false }
  );

  ui.rot.oninput = updateSelected;
  ui.ior.oninput = updateSelected;
  ui.curve.oninput = updateSelected;

  ui.spread.oninput = () => ui.spreadVal!.innerText = ui.spread.value + '°';
  ui.angle.oninput = () => ui.angleVal!.innerText = ui.angle.value + '°';
  ui.rays.oninput = () => ui.raysVal!.innerText = ui.rays.value;
  ui.rot.oninput = (e: any) => {
    updateSelected();
    ui.rotVal!.innerText = e.target.value + '°';
  };
  ui.ior.oninput = (e: any) => {
    updateSelected();
    ui.iorVal!.innerText = parseFloat(e.target.value).toFixed(2);
  };

  const btnReconvergence = document.getElementById('btnReconvergence');
  const btnPinkFloyd = document.getElementById('btnPinkFloyd');

  if (btnReconvergence)
    btnReconvergence.addEventListener('click', runReconvergence);
  if (btnPinkFloyd)
    btnPinkFloyd.addEventListener('click', runPinkFloyd);

  requestAnimationFrame(loop);
}

init();

// expose functions to window for UI buttons
(window as any).addPrism = addPrism;
(window as any).addBlock = addBlock;
(window as any).addLens = addLens;
(window as any).clearScene = clearScene;
(window as any).deleteSelected = deleteSelected;
(window as any).runPinkFloyd = runPinkFloyd;
(window as any).runReconvergence = runReconvergence;

function resize () {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}

function addPrism () {
  const s = 100;
  const h = s * Math.sqrt(3) / 2;
  const vertices = [{ x: -s / 2, y: h / 3 }, { x: s / 2, y: h / 3 }, { x: 0, y: -2 * h / 3 }];
  objects.push(new Polygon(width / 2, height / 2, vertices));
}

function addBlock () {
  const w = 120, h = 80;
  const vertices = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
  objects.push(new Polygon(width / 2, height / 2, vertices));
}

function addLens (type: 'converging' | 'diverging') {
  objects.push(new Lens(width / 2, height / 2, type));
}

function clearScene () {
  objects = [];
  selectedObj = null;
  ui.selection!.style.display = 'none';
}

function deleteSelected () {
  if (selectedObj) {
    objects = objects.filter(o => o !== selectedObj);
    selectedObj = null;
    ui.selection!.style.display = 'none';
  }
}

function updateSelected () {
  if (!selectedObj) return;
  selectedObj.rotation = parseFloat(ui.rot.value) * (Math.PI / 180);
  selectedObj.refractiveIndex = parseFloat(ui.ior.value);
  if (selectedObj instanceof Lens) {
    selectedObj.curvature = parseFloat(ui.curve.value);
  }
}

function loop () {
  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(panOffset.x, panOffset.y);
  ctx.scale(zoom, zoom);

  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1 / zoom;
  const gridStep = 50;
  const viewMinX = -panOffset.x / zoom;
  const viewMinY = -panOffset.y / zoom;
  const viewMaxX = viewMinX + width / zoom;
  const viewMaxY = viewMinY + height / zoom;
  let startX = Math.floor(viewMinX / gridStep) * gridStep;
  let startY = Math.floor(viewMinY / gridStep) * gridStep;
  for (let x = startX; x <= viewMaxX; x += gridStep) { ctx.beginPath(); ctx.moveTo(x, viewMinY); ctx.lineTo(x, viewMaxY); ctx.stroke(); }
  for (let y = startY; y <= viewMaxY; y += gridStep) { ctx.beginPath(); ctx.moveTo(viewMinX, y); ctx.lineTo(viewMaxX, y); ctx.stroke(); }

  objects.forEach(o => o.draw(ctx));

  ctx.globalCompositeOperation = 'screen';

  const rayCount = parseInt(ui.rays.value);
  const spreadDeg = parseInt(ui.spread.value);
  const spreadRad = spreadDeg * (Math.PI / 180);
  const baseAngle = parseFloat(ui.angle.value) * (Math.PI / 180);

  const wavelengths = [
    { color: '#ff0000', nOffset: -DISPERSION_STRENGTH, label: 'R' },
    { color: '#00ff00', nOffset: 0, label: 'G' },
    { color: '#0088ff', nOffset: DISPERSION_STRENGTH, label: 'B' }
  ];

  wavelengths.forEach(wave => {
    ctx.strokeStyle = wave.color;
    ctx.beginPath();

    for (let i = 0; i < rayCount; i++) {
      let rayAngle = baseAngle;
      if (spreadRad > 0 && rayCount > 1) {
        const pct = i / (rayCount - 1);
        rayAngle += (pct - 0.5) * spreadRad * 2;
      }

      traceSingleRay(
        { x: lightSource.x, y: lightSource.y },
        { x: Math.cos(rayAngle), y: Math.sin(rayAngle) },
        wave.nOffset,
        1.0
      );
    }
    ctx.stroke();
  });

  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(lightSource.x, lightSource.y, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(lightSource.x, lightSource.y);
  ctx.lineTo(lightSource.x + Math.cos(baseAngle) * 20, lightSource.y + Math.sin(baseAngle) * 20);
  ctx.stroke();

  ctx.restore();

  requestAnimationFrame(loop);
}

function traceSingleRay (origin, dir, nOffset, intensity) {
  let ray = { origin: { ...origin }, dir: { ...dir } };

  let currentRefractiveIndex = 1.0;
  let points = [ray.origin];

  for (let b = 0; b < MAX_BOUNCES; b++) {
    let closest = null;
    let minT = 3000;

    for (let obj of objects) {
      const hit = obj.intersect(ray.origin, ray.dir);
      if (hit && hit.t < minT && hit.t > 0.01) {
        minT = hit.t;
        closest = hit;
      }
    }

    if (closest) {
      points.push(closest.point);

      const objN = closest.obj.refractiveIndex + nOffset;

      const dot = Vec2.dot(ray.dir, closest.normal);
      let n1, n2, normal;

      if (dot < 0) {
        n1 = 1.0;
        n2 = objN;
        normal = closest.normal;
      } else {
        n1 = objN;
        n2 = 1.0;
        normal = { x: -closest.normal.x, y: -closest.normal.y };
      }

      const eta = n1 / n2;
      const cosI = -Vec2.dot(ray.dir, normal);
      const k = 1 - eta * eta * (1 - cosI * cosI);

      if (k < 0) {
        const reflectScale = 2 * Vec2.dot(ray.dir, normal);
        ray.dir = Vec2.sub(ray.dir, { x: normal.x * reflectScale, y: normal.y * reflectScale });
      } else {
        const term = eta * cosI - Math.sqrt(k);
        ray.dir = {
          x: eta * ray.dir.x + term * normal.x,
          y: eta * ray.dir.y + term * normal.y
        };
      }
      ray.origin = closest.point;
    } else {
      points.push({
        x: ray.origin.x + ray.dir.x * 2000,
        y: ray.origin.y + ray.dir.y * 2000
      });
      break;
    }
  }

  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
}

function screenToWorld (mx, my) {
  return { x: (mx - panOffset.x) / zoom, y: (my - panOffset.y) / zoom };
}

function onMouseDown (e) {
  const mx = e.clientX, my = e.clientY;
  const world = screenToWorld(mx, my);

  if (Vec2.dist(world, lightSource) < 15) {
    dragging = lightSource;
    return;
  }

  let hitObj = null;
  for (let i = objects.length - 1; i >= 0; i--) {
    if (objects[i].hitTest(world.x, world.y)) {
      hitObj = objects[i];
      break;
    }
  }

  if (selectedObj) selectedObj.selected = false;
  selectedObj = hitObj;

  if (selectedObj) {
    selectedObj.selected = true;
    dragging = selectedObj;
    dragOffset = { x: world.x - selectedObj.x, y: world.y - selectedObj.y };

    ui.selection!.style.display = 'block';
    ui.rot.value = (selectedObj.rotation * 180 / Math.PI).toFixed(0);
    ui.rotVal!.innerText = ui.rot.value + '°';
    ui.ior.value = String(selectedObj.refractiveIndex);
    ui.iorVal!.innerText = selectedObj.refractiveIndex.toFixed(2);

    if (selectedObj instanceof Lens) {
      ui.lensCtrl!.style.display = 'block';
      ui.curve.value = String(selectedObj.curvature);
    } else {
      ui.lensCtrl!.style.display = 'none';
    }
  } else {
    isPanning = true;
    panStart = { x: mx, y: my };
    panOffsetStart = { ...panOffset };
    ui.selection!.style.display = 'none';
  }
}

function onMouseMove (e) {
  const mx = e.clientX, my = e.clientY;
  if (isPanning) {
    panOffset.x = panOffsetStart.x + (mx - panStart.x);
    panOffset.y = panOffsetStart.y + (my - panStart.y);
    return;
  }
  if (!dragging) return;
  const world = screenToWorld(mx, my);

  if (dragging === lightSource) {
    lightSource.x = world.x; lightSource.y = world.y;
  } else {
    dragging.x = world.x - dragOffset.x;
    dragging.y = world.y - dragOffset.y;
  }
}

function onMouseUp () {
  dragging = null;
  isPanning = false;
}

function runReconvergence () {
  clearScene();
  ui.angle.value = '0';
  ui.angle.dispatchEvent(new Event('input'));
  ui.spread.value = '20';
  ui.spread.dispatchEvent(new Event('input'));
  ui.rays.value = '50';
  ui.rays.dispatchEvent(new Event('input'));
  lightSource = { x: width * 0.2, y: height * 0.6 };

  const s = 100;
  const h = s * Math.sqrt(3) / 2;
  const tri = [{ x: -s / 2, y: h / 3 }, { x: s / 2, y: h / 3 }, { x: 0, y: -2 * h / 3 }];
  const prism1 = new Polygon(width * 0.45, height * 0.55, tri);
  prism1.rotation = 0;
  prism1.refractiveIndex = 1.5;
  const prism2 = new Polygon(width * 0.65, height * 0.55, tri);
  prism2.rotation = Math.PI;
  prism2.refractiveIndex = 1.5;
  const lens = new Lens(width * 0.55, height * 0.5, 'converging');
  lens.curvature = 0.01;
  lens.refractiveIndex = 1.45;
  lens.rotation = 0;
  objects.push(prism1, prism2, lens);
}

function runPinkFloyd () {
  clearScene();
  ui.angle.value = '0';
  ui.angle.dispatchEvent(new Event('input'));
  ui.spread.value = '0';
  ui.spread.dispatchEvent(new Event('input'));
  ui.rays.value = '1';
  ui.rays.dispatchEvent(new Event('input'));
  lightSource = { x: width * 0.25, y: height * 0.6 };

  const s = 120;
  const h = s * Math.sqrt(3) / 2;
  const tri = [{ x: -s / 2, y: h / 3 }, { x: s / 2, y: h / 3 }, { x: 0, y: -2 * h / 3 }];
  const prism = new Polygon(width * 0.55, height * 0.55, tri);
  prism.rotation = 0;
  prism.refractiveIndex = 1.5;
  objects.push(prism);
}

init();
