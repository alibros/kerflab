import { GeometryError, type Path, type Seg, type Vec2 } from './geometry';
import { assertFinite, assertPositive } from './validate';

/** Heading in degrees, 0 = +x, positive = counter-clockwise. */
export class Turtle {
  private x: number;
  private y: number;
  private h: number;
  private readonly origin: Vec2;
  private readonly segs: Seg[] = [];

  constructor(start: Vec2 = { x: 0, y: 0 }, heading = 0) {
    this.x = start.x;
    this.y = start.y;
    this.h = heading;
    this.origin = { x: start.x, y: start.y };
  }

  get pos(): Vec2 { return { x: this.x, y: this.y }; }
  get heading(): number { return this.h; }

  forward(d: number): void {
    assertFinite(d, 'distance');
    if (Math.abs(d) < 1e-9) return;
    const r = (this.h * Math.PI) / 180;
    this.x += d * Math.cos(r);
    this.y += d * Math.sin(r);
    this.segs.push({ t: 'L', to: this.pos });
  }

  turn(deg: number): void {
    assertFinite(deg, 'angle');
    this.h += deg;
  }

  /** Arc of the given radius; positive deg turns left (ccw), negative turns right. */
  arc(radius: number, deg: number): void {
    assertPositive(radius, 'radius');
    assertFinite(deg, 'angle');
    if (deg === 0) return;
    const ccw = deg > 0;
    const hr = (this.h * Math.PI) / 180;
    const side = ccw ? 1 : -1;
    const c = { x: this.x - side * radius * Math.sin(hr), y: this.y + side * radius * Math.cos(hr) };
    const a0 = Math.atan2(this.y - c.y, this.x - c.x);
    const a1 = a0 + (deg * Math.PI) / 180;
    this.x = c.x + radius * Math.cos(a1);
    this.y = c.y + radius * Math.sin(a1);
    this.h += deg;
    this.segs.push({ t: 'A', to: this.pos, c, ccw });
  }

  toPath(close = false): Path {
    if (close && Math.hypot(this.x - this.origin.x, this.y - this.origin.y) > 1e-6)
      throw new GeometryError('toPath(true): end point is not at the start point');
    return { start: { ...this.origin }, segs: this.segs.map((s) => ({ ...s })), closed: close };
  }
}
