export const Vec2 = {
  add: (v1, v2) => ({ x: v1.x + v2.x, y: v1.y + v2.y }),
  sub: (v1, v2) => ({ x: v1.x - v2.x, y: v1.y - v2.y }),
  dot: (v1, v2) => v1.x * v2.x + v1.y * v2.y,
  mag: (v) => Math.sqrt(v.x * v.x + v.y * v.y),
  normalize: (v) => {
    const m = Math.sqrt(v.x * v.x + v.y * v.y);

    return m === 0 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
  },
  rotate: (v, angle) => ({
    x: v.x * Math.cos(angle) - v.y * Math.sin(angle),
    y: v.x * Math.sin(angle) + v.y * Math.cos(angle)
  }),
  cross: (v1, v2) => v1.x * v2.y - v1.y * v2.x,
  dist: (v1, v2) => Math.hypot(v1.x - v2.x, v1.y - v2.y)
};