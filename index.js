
const Vec2 = {
  add: ( v1, v2 ) => ( { x: v1.x + v2.x, y: v1.y + v2.y } ),
  sub: ( v1, v2 ) => ( { x: v1.x - v2.x, y: v1.y - v2.y } ),
  dot: ( v1, v2 ) => v1.x * v2.x + v1.y * v2.y,
  mag: ( v ) => Math.sqrt( v.x * v.x + v.y * v.y ),
  normalize: ( v ) => {
    const m = Math.sqrt( v.x * v.x + v.y * v.y );
    return m === 0 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
  },
  rotate: ( v, angle ) => ( {
    x: v.x * Math.cos( angle ) - v.y * Math.sin( angle ),
    y: v.x * Math.sin( angle ) + v.y * Math.cos( angle )
  } ),
  cross: ( v1, v2 ) => v1.x * v2.y - v1.y * v2.x,
  dist: ( v1, v2 ) => Math.hypot( v1.x - v2.x, v1.y - v2.y )
};

const canvas = document.getElementById( 'simCanvas' );
const ctx = canvas.getContext( '2d', { alpha: false } ); // Optimize
let width, height;

const DISPERSION_STRENGTH = 0.04; // How much n varies between Red and Blue
const MAX_BOUNCES = 12;

let lightSource = { x: 100, y: 300 };
let objects = [];
let selectedObj = null;
let dragging = null;
let dragOffset = { x: 0, y: 0 };

const ui = {
  selection: document.getElementById( 'selectionPanel' ),
  rot: document.getElementById( 'objRotation' ),
  rotVal: document.getElementById( 'objRotVal' ),
  ior: document.getElementById( 'objIOR' ),
  iorVal: document.getElementById( 'objIORVal' ),
  curve: document.getElementById( 'objCurve' ),
  lensCtrl: document.getElementById( 'lensControls' ),

  // Source controls
  spread: document.getElementById( 'spreadSlider' ),
  spreadVal: document.getElementById( 'spreadVal' ),
  angle: document.getElementById( 'angleSlider' ),
  angleVal: document.getElementById( 'angleVal' ),
  rays: document.getElementById( 'rayCountSlider' ),
  raysVal: document.getElementById( 'rayVal' )
};

class OpticalObject {
  constructor ( x, y ) {
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.refractiveIndex = 1.1;
    this.selected = false;
  }

  toLocal ( pt ) {
    let dx = pt.x - this.x;
    let dy = pt.y - this.y;

    return {
      x: dx * Math.cos( -this.rotation ) - dy * Math.sin( -this.rotation ),
      y: dx * Math.sin( -this.rotation ) + dy * Math.cos( -this.rotation )
    };
  }

  toWorld ( pt ) {
    let rx = pt.x * Math.cos( this.rotation ) - pt.y * Math.sin( this.rotation );
    let ry = pt.x * Math.sin( this.rotation ) + pt.y * Math.cos( this.rotation );
    return { x: rx + this.x, y: ry + this.y };
  }

  dirToWorld ( dir ) {
    return {
      x: dir.x * Math.cos( this.rotation ) - dir.y * Math.sin( this.rotation ),
      y: dir.x * Math.sin( this.rotation ) + dir.y * Math.cos( this.rotation )
    };
  }
}

class Polygon extends OpticalObject {
  constructor ( x, y, vertices ) {
    super( x, y );
    this.relVertices = vertices;
  }

  getWorldVertices () {
    return this.relVertices.map( v => this.toWorld( v ) );
  }

  intersect ( rayOrigin, rayDir ) {
    const verts = this.getWorldVertices();
    let closest = null;
    let minT = Infinity;

    for ( let i = 0;i < verts.length;i++ ) {
      const p1 = verts[ i ];
      const p2 = verts[ ( i + 1 ) % verts.length ];

      const edge = Vec2.sub( p2, p1 );
      const v1 = Vec2.sub( rayOrigin, p1 );
      const v2 = Vec2.sub( p2, p1 );
      const v3 = { x: -rayDir.y, y: rayDir.x };

      const dot = Vec2.dot( v2, v3 );
      if ( Math.abs( dot ) < 1e-6 ) continue;

      const t1 = Vec2.cross( v2, v1 ) / dot;
      const t2 = Vec2.dot( v1, v3 ) / dot;

      if ( t1 >= 0.001 && ( t2 >= 0 && t2 <= 1 ) ) {
        if ( t1 < minT ) {
          minT = t1;
          let edgeDir = Vec2.normalize( edge );
          let normal = { x: -edgeDir.y, y: edgeDir.x };
          closest = {
            t: t1,
            point: Vec2.add( rayOrigin, { x: rayDir.x * t1, y: rayDir.y * t1 } ),
            normal: normal,
            obj: this
          };
        }
      }
    }
    return closest;
  }

  draw ( ctx ) {
    const verts = this.getWorldVertices();
    ctx.beginPath();
    ctx.moveTo( verts[ 0 ].x, verts[ 0 ].y );
    for ( let i = 1;i < verts.length;i++ ) ctx.lineTo( verts[ i ].x, verts[ i ].y );
    ctx.closePath();

    ctx.fillStyle = this.selected ? 'rgba(255, 0, 222, 0.2)' : 'rgba(200, 230, 255, 0.15)';
    ctx.strokeStyle = this.selected ? '#ff00de' : '#00d2ff';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }

  hitTest ( mx, my ) {
    const verts = this.getWorldVertices();
    let inside = false;
    for ( let i = 0, j = verts.length - 1;i < verts.length;j = i++ ) {
      const xi = verts[ i ].x, yi = verts[ i ].y;
      const xj = verts[ j ].x, yj = verts[ j ].y;
      const intersect = ( ( yi > my ) !== ( yj > my ) ) && ( mx < ( xj - xi ) * ( my - yi ) / ( yj - yi ) + xi );
      if ( intersect ) inside = !inside;
    }
    return inside;
  }
}

class Lens extends OpticalObject {
  constructor ( x, y, type ) {
    super( x, y );
    this.type = type;
    this.height = 120;
    this.width = 20;
    this.curvature = 0.008;
  }

  intersect ( rayOrigin, rayDir ) {
    const localOrg = this.toLocal( rayOrigin );
    const localDir = {
      x: rayDir.x * Math.cos( -this.rotation ) - rayDir.y * Math.sin( -this.rotation ),
      y: rayDir.x * Math.sin( -this.rotation ) + rayDir.y * Math.cos( -this.rotation )
    };

    // 2. Perform intersection as if lens is vertical at (0,0)
    // Geometry: Two circles.
    // Radius R = 1/k
    // Converging: Centers at (-offset, 0) and (+offset, 0). Intersection of circles.

    let intersections = [];
    const radius = 1 / Math.max( 0.001, this.curvature );
    // Calculate offset based on thickness (w)
    // Sagitta s = R - sqrt(R^2 - (h/2)^2)
    // For biconvex, centers are outside. Dist from center = R - w/2

    let cx = radius - this.width / 2;
    if ( this.type === 'diverging' ) cx = radius + this.width / 4; // Centers inside for biconcave

    const centers = [
      { x: -cx, y: 0, sign: 1 },
      { x: cx, y: 0, sign: 1 }
    ];

    if ( this.type === 'diverging' ) {
      centers[ 0 ].sign = -1;
      centers[ 1 ].sign = -1;
    }

    centers.forEach( ( c, idx ) => {
      const L = Vec2.sub( localOrg, c );
      const a = 1; // localDir is normalized
      const b = 2 * Vec2.dot( localDir, L );
      const cc = Vec2.dot( L, L ) - radius * radius;
      const disc = b * b - 4 * a * cc;

      if ( disc >= 0 ) {
        const sqrtDisc = Math.sqrt( disc );
        const t1 = ( -b - sqrtDisc ) / 2;
        const t2 = ( -b + sqrtDisc ) / 2;

        [ t1, t2 ].forEach( t => {
          if ( t > 0.001 ) {
            const pLocal = Vec2.add( localOrg, { x: localDir.x * t, y: localDir.y * t } );
            if ( Math.abs( pLocal.y ) < this.height / 2 ) {


              let valid = false;
              if ( this.type === 'converging' ) {
                if ( Math.abs( pLocal.x ) < this.width ) valid = true;
              } else {
                // Diverging
                if ( Math.abs( pLocal.x ) < this.width ) valid = true;
              }

              if ( valid ) {
                // Calculate Normal in Local
                let nLocal = Vec2.normalize( Vec2.sub( pLocal, c ) );
                if ( c.sign < 0 ) nLocal = { x: -nLocal.x, y: -nLocal.y };

                // Transform back to World
                intersections.push( {
                  t: t, // Distance is scale invariant if scale=1
                  point: this.toWorld( pLocal ),
                  normal: this.dirToWorld( nLocal ),
                  obj: this
                } );
              }
            }
          }
        } );
      }
    } );

    if ( intersections.length === 0 ) return null;
    intersections.sort( ( a, b ) => a.t - b.t );
    return intersections[ 0 ];
  }

  draw ( ctx ) {
    ctx.save();
    ctx.translate( this.x, this.y );
    ctx.rotate( this.rotation );

    ctx.fillStyle = this.selected ? 'rgba(255, 0, 222, 0.2)' : 'rgba(200, 230, 255, 0.15)';
    ctx.strokeStyle = this.selected ? '#ff00de' : '#00d2ff';
    ctx.lineWidth = 2;

    const radius = 1 / Math.max( 0.001, this.curvature );
    const angle = Math.asin( ( this.height / 2 ) / radius );

    ctx.beginPath();
    if ( this.type === 'converging' ) {
      const cx = radius - this.width / 2;
      // Left Arc (Center is +cx)
      ctx.arc( cx, 0, radius, Math.PI - angle, Math.PI + angle );
      // Right Arc (Center is -cx)
      ctx.arc( -cx, 0, radius, -angle, angle );
    } else {
      const cx = radius + this.width / 4;
      // Draw path: Top Line -> Right Arc -> Bottom Line -> Left Arc
      // Right Face (Concave, center -cx)
      ctx.arc( -cx, 0, radius, -angle, angle, true ); // true = anti-clockwise
      // Left Face (Concave, center +cx)
      ctx.arc( cx, 0, radius, Math.PI - angle, Math.PI + angle, true );
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  hitTest ( mx, my ) {
    const local = this.toLocal( { x: mx, y: my } );
    return Math.abs( local.x ) < 20 && Math.abs( local.y ) < this.height / 2;
  }
}

function init () {
  window.addEventListener( 'resize', resize );
  resize();
  addPrism();

  ui.angle.value = 0;

  canvas.addEventListener( 'mousedown', onMouseDown );
  canvas.addEventListener( 'mousemove', onMouseMove );
  canvas.addEventListener( 'mouseup', onMouseUp );

  ui.rot.oninput = updateSelected;
  ui.ior.oninput = updateSelected;
  ui.curve.oninput = updateSelected;

  ui.spread.oninput = () => ui.spreadVal.innerText = ui.spread.value + "°";
  ui.angle.oninput = () => ui.angleVal.innerText = ui.angle.value + "°";
  ui.rays.oninput = () => ui.raysVal.innerText = ui.rays.value;
  ui.rot.oninput = ( e ) => {
    updateSelected();
    ui.rotVal.innerText = e.target.value + "°";
  };
  ui.ior.oninput = ( e ) => {
    updateSelected();
    ui.iorVal.innerText = parseFloat( e.target.value ).toFixed( 2 );
  };

  requestAnimationFrame( loop );
}

function resize () {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}

function addPrism () {
  const s = 100;
  const h = s * Math.sqrt( 3 ) / 2;
  const vertices = [ { x: -s / 2, y: h / 3 }, { x: s / 2, y: h / 3 }, { x: 0, y: -2 * h / 3 } ];
  objects.push( new Polygon( width / 2, height / 2, vertices ) );
}

function addBlock () {
  const w = 120, h = 80;
  const vertices = [ { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 } ];
  objects.push( new Polygon( width / 2, height / 2, vertices ) );
}

function addLens ( type ) {
  objects.push( new Lens( width / 2, height / 2, type ) );
}

function clearScene () { objects = []; selectedObj = null; ui.selection.style.display = 'none'; }
function deleteSelected () {
  if ( selectedObj ) {
    objects = objects.filter( o => o !== selectedObj );
    selectedObj = null;
    ui.selection.style.display = 'none';
  }
}

function updateSelected () {
  if ( !selectedObj ) return;
  selectedObj.rotation = parseFloat( ui.rot.value ) * ( Math.PI / 180 );
  selectedObj.refractiveIndex = parseFloat( ui.ior.value );
  if ( selectedObj instanceof Lens ) {
    selectedObj.curvature = parseFloat( ui.curve.value );
  }
}

function loop () {
  // Clear and Draw Background
  ctx.fillStyle = '#080808';
  ctx.fillRect( 0, 0, width, height );

  // Draw Grid
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  for ( let x = 0;x < width;x += 50 ) { ctx.beginPath(); ctx.moveTo( x, 0 ); ctx.lineTo( x, height ); ctx.stroke(); }
  for ( let y = 0;y < height;y += 50 ) { ctx.beginPath(); ctx.moveTo( 0, y ); ctx.lineTo( width, y ); ctx.stroke(); }

  // Draw Objects
  objects.forEach( o => o.draw( ctx ) );

  // Trace Rays (Red, Green, Blue passes)
  // We use screen blending so Red+Green+Blue = White
  ctx.globalCompositeOperation = 'screen';

  const rayCount = parseInt( ui.rays.value );
  const spreadDeg = parseInt( ui.spread.value );
  const spreadRad = spreadDeg * ( Math.PI / 180 );
  const baseAngle = parseFloat( ui.angle.value ) * ( Math.PI / 180 );

  // Pre-calculate rays
  // If spread is 0, all rays have same angle. If spread > 0, interpolate.

  // WAVELENGTHS: R=0, G=1, B=2
  const wavelengths = [
    { color: '#ff0000', nOffset: -DISPERSION_STRENGTH, label: 'R' },
    { color: '#00ff00', nOffset: 0, label: 'G' },
    { color: '#0088ff', nOffset: DISPERSION_STRENGTH, label: 'B' }
  ];

  wavelengths.forEach( wave => {
    ctx.strokeStyle = wave.color;
    ctx.beginPath();

    for ( let i = 0;i < rayCount;i++ ) {
      // Determine Ray Angle
      let rayAngle = baseAngle;
      if ( spreadRad > 0 && rayCount > 1 ) {
        const pct = i / ( rayCount - 1 );
        rayAngle += ( pct - 0.5 ) * spreadRad;
      }

      traceSingleRay(
        { x: lightSource.x, y: lightSource.y },
        { x: Math.cos( rayAngle ), y: Math.sin( rayAngle ) },
        wave.nOffset,
        1.0
      );
    }
    ctx.stroke();
  } );

  ctx.globalCompositeOperation = 'source-over';

  // Draw Source Handle
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc( lightSource.x, lightSource.y, 6, 0, Math.PI * 2 ); ctx.fill();
  // Angle indicator
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo( lightSource.x, lightSource.y );
  ctx.lineTo( lightSource.x + Math.cos( baseAngle ) * 20, lightSource.y + Math.sin( baseAngle ) * 20 );
  ctx.stroke();

  requestAnimationFrame( loop );
}

function traceSingleRay ( origin, dir, nOffset, intensity ) {
  let ray = { origin: { ...origin }, dir: { ...dir } };

  let currentRefractiveIndex = 1.0; // Air
  let points = [ ray.origin ];

  for ( let b = 0;b < MAX_BOUNCES;b++ ) {
    let closest = null;
    let minT = 3000;

    // Check intersections
    for ( let obj of objects ) {
      const hit = obj.intersect( ray.origin, ray.dir );
      if ( hit && hit.t < minT && hit.t > 0.01 ) { // 0.01 epsilon
        minT = hit.t;
        closest = hit;
      }
    }

    if ( closest ) {
      points.push( closest.point );

      // Physics
      const objN = closest.obj.refractiveIndex + nOffset;

      // Are we entering or exiting?
      const dot = Vec2.dot( ray.dir, closest.normal );
      let n1, n2, normal;

      if ( dot < 0 ) {
        // Entering
        n1 = 1.0; // Air
        n2 = objN;
        normal = closest.normal;
      } else {
        // Exiting
        n1 = objN;
        n2 = 1.0; // Air
        normal = { x: -closest.normal.x, y: -closest.normal.y };
      }

      // Snell's Law
      const eta = n1 / n2;
      const cosI = -Vec2.dot( ray.dir, normal );
      const k = 1 - eta * eta * ( 1 - cosI * cosI );

      if ( k < 0 ) {
        // Total Internal Reflection
        const reflectScale = 2 * Vec2.dot( ray.dir, normal );
        ray.dir = Vec2.sub( ray.dir, { x: normal.x * reflectScale, y: normal.y * reflectScale } );
      } else {
        // Refraction
        const term = eta * cosI - Math.sqrt( k );
        ray.dir = {
          x: eta * ray.dir.x + term * normal.x,
          y: eta * ray.dir.y + term * normal.y
        };
      }
      ray.origin = closest.point;
    } else {
      // No hit
      points.push( {
        x: ray.origin.x + ray.dir.x * 2000,
        y: ray.origin.y + ray.dir.y * 2000
      } );
      break;
    }
  }

  // Draw the path
  ctx.moveTo( points[ 0 ].x, points[ 0 ].y );
  for ( let i = 1;i < points.length;i++ ) ctx.lineTo( points[ i ].x, points[ i ].y );
}

function onMouseDown ( e ) {
  const mx = e.clientX, my = e.clientY;

  // Check light source
  if ( Vec2.dist( { x: mx, y: my }, lightSource ) < 15 ) {
    dragging = lightSource;
    return;
  }

  // Check objects (Reverse order for z-index)
  let hitObj = null;
  for ( let i = objects.length - 1;i >= 0;i-- ) {
    if ( objects[ i ].hitTest( mx, my ) ) {
      hitObj = objects[ i ];
      break;
    }
  }

  if ( selectedObj ) selectedObj.selected = false;
  selectedObj = hitObj;

  if ( selectedObj ) {
    selectedObj.selected = true;
    dragging = selectedObj;
    dragOffset = { x: mx - selectedObj.x, y: my - selectedObj.y };

    ui.selection.style.display = 'block';
    ui.rot.value = ( selectedObj.rotation * 180 / Math.PI ).toFixed( 0 );
    ui.rotVal.innerText = ui.rot.value + "°";
    ui.ior.value = selectedObj.refractiveIndex;
    ui.iorVal.innerText = selectedObj.refractiveIndex.toFixed( 2 );

    if ( selectedObj instanceof Lens ) {
      ui.lensCtrl.style.display = 'block';
      ui.curve.value = selectedObj.curvature;
    } else {
      ui.lensCtrl.style.display = 'none';
    }
  } else {
    ui.selection.style.display = 'none';
  }
}

function onMouseMove ( e ) {
  if ( !dragging ) return;
  const mx = e.clientX, my = e.clientY;

  if ( dragging === lightSource ) {
    lightSource.x = mx; lightSource.y = my;
  } else {
    dragging.x = mx - dragOffset.x;
    dragging.y = my - dragOffset.y;
  }
}

function onMouseUp () { dragging = null; }

init();
