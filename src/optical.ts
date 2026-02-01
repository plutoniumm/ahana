import { Vec2 } from './utils';

type Point = {
  x: number;
  y: number
};

export type Hit = {
  t: number;
  point: Point;
  normal: Point;
  obj: OpticalObject
} | null;

export class OpticalObject {
  x: number;
  y: number;
  rotation: number;
  refractiveIndex: number;
  selected: boolean;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.refractiveIndex = 1.1;
    this.selected = false;
  }
  toLocal (pt) {
    let dx = pt.x - this.x;
    let dy = pt.y - this.y;

    return {
      x: dx * Math.cos(-this.rotation) - dy * Math.sin(-this.rotation),
      y: dx * Math.sin(-this.rotation) + dy * Math.cos(-this.rotation)
    };
  }
  toWorld (pt) {
    let rx = pt.x * Math.cos(this.rotation) - pt.y * Math.sin(this.rotation);
    let ry = pt.x * Math.sin(this.rotation) + pt.y * Math.cos(this.rotation);

    return {
      x: rx + this.x,
      y: ry + this.y
    };
  }
  dirToWorld (dir) {
    return {
      x: dir.x * Math.cos(this.rotation) - dir.y * Math.sin(this.rotation),
      y: dir.x * Math.sin(this.rotation) + dir.y * Math.cos(this.rotation)
    };
  }
}

export class Polygon extends OpticalObject {
  relVertices: Array<Point>;
  constructor(x: number, y: number, vertices: Array<Point>) {
    super(x, y);
    this.relVertices = vertices;
  }

  getWorldVertices () {
    return this.relVertices.map(v => this.toWorld(v));
  }

  intersect (rayOrigin, rayDir): Hit {
    const verts = this.getWorldVertices();
    let closest: Hit = null;

    let minT = Infinity;
    for (let i = 0; i < verts.length; i++) {
      const p1 = verts[i];
      const p2 = verts[(i + 1) % verts.length];

      const edge = Vec2.sub(p2, p1);
      const v1 = Vec2.sub(rayOrigin, p1);
      const v2 = Vec2.sub(p2, p1);
      const v3 = { x: -rayDir.y, y: rayDir.x };

      const dot = Vec2.dot(v2, v3);

      if (Math.abs(dot) < 1e-6) continue;

      const t1 = Vec2.cross(v2, v1) / dot;
      const t2 = Vec2.dot(v1, v3) / dot;

      if (t1 >= 0.001 && (t2 >= 0 && t2 <= 1)) {
        if (t1 < minT) {
          minT = t1;
          let edgeDir = Vec2.normalize(edge);
          let normal = { x: -edgeDir.y, y: edgeDir.x };
          closest = {
            t: t1, point: Vec2.add(
              rayOrigin,
              {
                x: rayDir.x * t1,
                y: rayDir.y * t1
              }
            ),
            normal: normal,
            obj: this
          };
        }
      }
    };

    return closest;
  }
  draw (ctx) {
    const verts = this.getWorldVertices();

    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);

    for (let i = 1; i < verts.length; i++)
      ctx.lineTo(verts[i].x, verts[i].y);

    ctx.closePath();
    ctx.fillStyle = this.selected ? 'rgba(255, 0, 222, 0.2)' : 'rgba(200, 230, 255, 0.15)';
    ctx.strokeStyle = this.selected ? '#ff00de' : '#00d2ff';
    ctx.lineWidth = 2;

    ctx.fill();
    ctx.stroke();
  }

  hitTest (mx, my) {
    const verts = this.getWorldVertices();
    let inside = false;

    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const xi = verts[i].x, yi = verts[i].y;
      const xj = verts[j].x, yj = verts[j].y;
      const intersect = ((yi > my) !== (yj > my)) && (mx < (xj - xi) * (my - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }
}

export class Lens extends OpticalObject {
  type: 'converging' | 'diverging';
  height: number;
  width: number;
  curvature: number;
  constructor(x: number, y: number, type: 'converging' | 'diverging') {
    super(x, y);
    this.type = type;
    this.height = 120;
    this.width = 20;
    this.curvature = 0.008;
  }
  intersect (rayOrigin, rayDir): Hit {
    const localOrg = this.toLocal(rayOrigin);
    const localDir = {
      x: rayDir.x * Math.cos(-this.rotation) - rayDir.y * Math.sin(-this.rotation),
      y: rayDir.x * Math.sin(-this.rotation) + rayDir.y * Math.cos(-this.rotation)
    };

    let intersections: Array<{
      t: number;
      point: { x: number; y: number };
      normal: { x: number; y: number };
      obj: OpticalObject
    }> = [];

    const radius = 1 / Math.max(0.001, this.curvature);
    let cx = radius - this.width / 2;

    if (this.type === 'diverging') cx = radius + this.width / 4;
    const centers = [{ x: -cx, y: 0, sign: 1 }, { x: cx, y: 0, sign: 1 }];
    if (this.type === 'diverging') {
      centers[0].sign = -1;
      centers[1].sign = -1;
    }

    centers.forEach(c => {
      const L = Vec2.sub(localOrg, c);
      const a = 1;
      const b = 2 * Vec2.dot(localDir, L);
      const cc = Vec2.dot(L, L) - radius * radius;
      const disc = b * b - 4 * a * cc;

      if (disc >= 0) {
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / 2;
        const t2 = (-b + sqrtDisc) / 2;

        [t1, t2].forEach(t => {
          if (t > 0.001) {
            const pLocal = Vec2.add(localOrg, {
              x: localDir.x * t,
              y: localDir.y * t
            });

            if (Math.abs(pLocal.y) < this.height / 2) {
              let valid = false;
              if (this.type === 'converging') {
                if (Math.abs(pLocal.x) < this.width)
                  valid = true;
              } else {
                if (Math.abs(pLocal.x) < this.width)
                  valid = true;
              }
              if (valid) {
                let nLocal = Vec2.normalize(Vec2.sub(pLocal, c));

                if (c.sign < 0) nLocal = {
                  x: -nLocal.x,
                  y: -nLocal.y
                };

                intersections.push({
                  t, point: this.toWorld(pLocal),
                  normal: this.dirToWorld(nLocal), obj: this
                });
              }
            }
          }
        });
      }
    });

    if (intersections.length === 0)
      return null;

    intersections.sort((a, b) => a.t - b.t);
    return intersections[0];
  }

  draw (ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.fillStyle = this.selected ? 'rgba(255, 0, 222, 0.2)' : 'rgba(200, 230, 255, 0.15)';
    ctx.strokeStyle = this.selected ? '#ff00de' : '#00d2ff';
    ctx.lineWidth = 2;

    const radius = 1 / Math.max(0.001, this.curvature);
    const angle = Math.asin((this.height / 2) / radius);
    ctx.beginPath();

    if (this.type === 'converging') {
      const cx = radius - this.width / 2;
      ctx.arc(cx, 0, radius, Math.PI - angle, Math.PI + angle);
      ctx.arc(-cx, 0, radius, -angle, angle);
    }
    else {
      const cx = radius + this.width / 4;
      ctx.arc(-cx, 0, radius, -angle, angle, true);
      ctx.arc(cx, 0, radius, Math.PI - angle, Math.PI + angle, true);
    }

    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  hitTest (mx, my) {
    const local = this.toLocal({ x: mx, y: my });
    return Math.abs(local.x) < 20 && Math.abs(local.y) < this.height / 2;
  }
}