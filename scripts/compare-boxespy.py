#!/usr/bin/env python3
"""Compare boxes-js SVG output against boxes.py for the generators mapped one-to-one in docs/coverage.md.

    python3 scripts/compare-boxespy.py [-v]       # needs `import boxes` to work (boxes.py and its deps)
                                                  # -v: list both part-size sets for every mismatch
    BOXESPY_PATH=/path/to/boxes python3 scripts/compare-boxespy.py      # or set the env var ...
    python3 scripts/compare-boxespy.py --boxespy /path/to/boxes [-v]    # ... or pass it
        (path to your boxes.py checkout: the directory that holds the `boxes` package)

If boxes.py cannot be imported the script prints "skipped" and exits 0 (it is an optional check).

For every row of docs/coverage.md with status "yes" whose "How" column is empty or starts with
"default" (i.e. boxes-js at its defaults is meant to be the same object), it:
  1. builds the boxes.py generator with its own defaults (no reference rectangle, no labels),
  2. builds the boxes-js generator with the shared params copied over (x, y, h, thickness, sx, sy,
     outside -> inside, burn -> kerf, finger/space/play), through scripts/export-svg.mjs,
  3. parses both SVGs into per-part bounding boxes (rotation-free: sorted w x h; arcs and cubic
     curves are sampled, so a rounded corner's bulge counts and Bézier control points do not) and
     counts edge segments (path commands after the first move), and
  4. reports: part counts, how many part sizes match within +-1 mm, and the segment-count ratio.
     boxes.py draws each finger corner with a tiny burn curve, so its segment counts run higher;
     the ratio is a rough sanity check, not an equality.

Exit status: 0 always (it is a report; read docs/differences.md for the interpretation).
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOL = 1.0  # mm
VERBOSE = "-v" in sys.argv[1:]


def boxespy_path() -> str | None:
    """`--boxespy PATH` / `--boxespy=PATH` on the command line, else $BOXESPY_PATH."""
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a.startswith("--boxespy="):
            return a.split("=", 1)[1]
        if a == "--boxespy" and i + 1 < len(args):
            return args[i + 1]
    return os.environ.get("BOXESPY_PATH") or None


if boxespy_path():
    sys.path.insert(0, os.path.expanduser(boxespy_path() or ""))
try:
    import boxes  # noqa: F401
    import boxes.generators as bgens
except Exception as e:  # ImportError, or a missing dependency of boxes.py
    print(f"skipped (boxes.py not importable: {e.__class__.__name__}: {e})")
    sys.exit(0)


# --- mapping ----------------------------------------------------------------------------------

def mapped_rows() -> list[tuple[str, str]]:
    rows = []
    for line in (ROOT / "docs" / "coverage.md").read_text().splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[1] != "yes" or not cells[2]:
            continue
        how = cells[3]
        if how and not how.lower().startswith("default"):
            continue
        rows.append((cells[0], cells[2].split()[0]))
    return rows


# --- SVG parsing --------------------------------------------------------------------------------

TOKEN = re.compile(r"[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
ARGC = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def arc_points(x1: float, y1: float, rx: float, ry: float, phi_deg: float, large: int, sweep: int,
               x2: float, y2: float, n: int = 32) -> list[tuple[float, float]]:
    """Sample an SVG elliptical arc (endpoint parameterisation, SVG 1.1 appendix F.6)."""
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0 or (x1 == x2 and y1 == y2):
        return []
    phi = math.radians(phi_deg)
    cp, sp = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cp * dx + sp * dy, -sp * dx + cp * dy
    lam = (x1p / rx) ** 2 + (y1p / ry) ** 2
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx = cp * cxp - sp * cyp + (x1 + x2) / 2
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2
    ang = lambda ux, uy, vx, vy: math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dt > 0:
        dt -= 2 * math.pi
    elif sweep and dt < 0:
        dt += 2 * math.pi
    out = []
    for k in range(1, n):
        t = t1 + dt * k / n
        ex, ey = rx * math.cos(t), ry * math.sin(t)
        out.append((cp * ex - sp * ey + cx, sp * ex + cp * ey + cy))
    return out


def parse_path(d: str) -> tuple[list[tuple[float, float]], int]:
    """Points (endpoints and control points) and the number of drawing segments."""
    toks = TOKEN.findall(d)
    pts: list[tuple[float, float]] = []
    segs = 0
    i = 0
    cmd = None
    x = y = sx = sy = 0.0
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in "Zz":
                x, y = sx, sy
                continue
        if cmd is None:
            break
        n = ARGC[cmd.upper()]
        args = [float(v) for v in toks[i:i + n]]
        if len(args) < n:
            break
        i += n
        rel = cmd.islower()
        c = cmd.upper()
        if c == "M":
            x, y = (x + args[0], y + args[1]) if rel else (args[0], args[1])
            sx, sy = x, y
            pts.append((x, y))
            cmd = "l" if rel else "L"  # implicit lineto after the first pair
            continue
        segs += 1
        if c == "H":
            x = x + args[0] if rel else args[0]
        elif c == "V":
            y = y + args[0] if rel else args[0]
        elif c == "A":
            ex, ey = (x + args[5], y + args[6]) if rel else (args[5], args[6])
            # Points along the arc, not only its end: an arc's bulge counts towards the part size.
            pts.extend(arc_points(x, y, args[0], args[1], args[2], int(args[3]), int(args[4]), ex, ey))
            x, y = ex, ey
        else:
            coords = list(zip(args[0::2], args[1::2]))
            if rel:
                coords = [(x + a, y + b) for a, b in coords]
            if c == "C":
                # Points on the curve (control points lie outside it and would inflate the size).
                (ax, ay), (bx, by), (ex, ey) = coords
                for k in range(1, 16):
                    t = k / 16
                    m = 1 - t
                    pts.append((m * m * m * x + 3 * m * m * t * ax + 3 * m * t * t * bx + t * t * t * ex,
                                m * m * m * y + 3 * m * m * t * ay + 3 * m * t * t * by + t * t * t * ey))
            else:
                pts.extend(coords[:-1])
            x, y = coords[-1]
        pts.append((x, y))
    return pts, segs


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parts_of(svg: Path) -> list[dict]:
    """One entry per top-level <g> that contains paths: sorted size (long, short) and segment count."""
    root = ET.parse(svg).getroot()
    out = []
    for g in root.iter():
        if local(g.tag) != "g":
            continue
        paths = [p for p in g if local(p.tag) == "path"]
        if not paths:
            continue
        pts: list[tuple[float, float]] = []
        segs = 0
        for p in paths:
            ps, n = parse_path(p.get("d", ""))
            pts += ps
            segs += n
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        out.append({"size": (max(w, h), min(w, h)), "segs": segs})
    return out


def match(a: list[dict], b: list[dict]) -> int:
    """Greedy one-to-one match of part sizes within TOL."""
    left = [p["size"] for p in b]
    n = 0
    for p in sorted(a, key=lambda q: -q["size"][0]):
        for j, q in enumerate(left):
            if abs(p["size"][0] - q[0]) <= TOL and abs(p["size"][1] - q[1]) <= TOL:
                n += 1
                del left[j]
                break
    return n


# --- boxes.py side --------------------------------------------------------------------------------

SHARED = {"x": "x", "y": "y", "h": "h", "thickness": "thickness", "sx": "sx", "sy": "sy",
          "FingerJoint_finger": "finger", "FingerJoint_space": "space", "FingerJoint_play": "play"}


def boxespy_svg(name: str, gens: dict, out: Path) -> dict:
    """Render boxes.py `name` at its defaults to `out`; return the shared params in boxes-js terms.

    The params are read before rendering: some boxes.py generators adjust x / y / h in place while
    rendering (e.g. subtracting the walls when `outside` is set)."""
    gen = gens[name]()
    gen.parseArgs(["--reference=0", "--labels=0", f"--output={out}"])
    ours: dict = {}
    for theirs, mine in SHARED.items():
        v = getattr(gen, theirs, None)
        if v is None or isinstance(v, bool):
            continue
        if isinstance(v, (list, tuple)):  # sx / sy section lists
            v = ",".join(f"{s:g}" for s in v)
        elif isinstance(v, (int, float)) and v <= 0:  # boxes.py sentinels such as x = -1 ("from sx")
            continue
        ours[mine] = v
    if isinstance(getattr(gen, "outside", None), bool):
        ours["inside"] = not gen.outside
    burn = getattr(gen, "burn", None)
    if isinstance(burn, (int, float)):
        ours["kerf"] = 2 * burn
        ours["burn"] = burn > 0
    gen.open()
    gen.render()
    data = gen.close()
    out.write_bytes(data.getvalue() if hasattr(data, "getvalue") else data)
    return ours


def main() -> None:
    gens = {g.__name__: g for g in bgens.getAllBoxGenerators().values()}
    rows = [(b, j) for b, j in mapped_rows() if b in gens]
    tmp = Path(tempfile.mkdtemp(prefix="compare-boxespy-"))
    jobs = []
    py_parts: dict[str, list[dict]] = {}
    errors: dict[str, str] = {}
    for name, gid in rows:
        try:
            params = boxespy_svg(name, gens, tmp / f"py-{name}.svg")
            py_parts[name] = parts_of(tmp / f"py-{name}.svg")
            jobs.append({"id": gid, "params": params, "name": name})
        except Exception as e:  # boxes.py generator failed at its own defaults
            errors[name] = f"boxes.py: {e.__class__.__name__}: {e}"
    # One job per boxes-js id per boxes.py name: export each under a unique file name.
    results = {}
    for job in jobs:
        jf = tmp / f"job-{job['name']}.json"
        jf.write_text(json.dumps([{"id": job["id"], "params": job["params"]}]))
        od = tmp / f"js-{job['name']}"
        r = subprocess.run(["node", str(ROOT / "scripts" / "export-svg.mjs"), str(jf), str(od)],
                           cwd=ROOT, capture_output=True, text=True)
        try:
            res = json.loads(r.stdout.strip().splitlines()[-1])[0]
        except Exception:
            errors[job["name"]] = f"boxes-js export failed: {r.stderr.strip()[:200]}"
            continue
        if not res["ok"]:
            errors[job["name"]] = f"boxes-js: {res['message']}"
            continue
        results[job["name"]] = (job["id"], parts_of(Path(res["file"])))

    print(f"{'boxes.py':<22} {'boxes-js':<18} {'parts py/js':>11} {'size match':>10} {'segs py/js':>13} {'ratio':>6}")
    for name, gid in rows:
        if name in errors:
            print(f"{name:<22} {gid:<18} ERROR {errors[name]}")
            continue
        if name not in results:
            continue
        _, js = results[name]
        py = py_parts[name]
        m = match(py, js)
        sp, sj = sum(p["segs"] for p in py), sum(p["segs"] for p in js)
        ratio = f"{sp / sj:.2f}" if sj else "-"
        flag = "" if m == len(py) == len(js) else "  <-"
        print(f"{name:<22} {gid:<18} {len(py):>5}/{len(js):<5} {m:>5}/{max(len(py), len(js)):<4} {sp:>6}/{sj:<6} {ratio:>6}{flag}")
        if VERBOSE and flag:
            fmt = lambda ps: " ".join(f"{a:.1f}x{b:.1f}" for a, b in sorted(p["size"] for p in ps))
            print(f"    py: {fmt(py)}\n    js: {fmt(js)}")
    skipped = [b for b, _ in mapped_rows() if b not in gens]
    if skipped:
        print(f"not in this boxes.py: {', '.join(skipped)}")


if __name__ == "__main__":
    main()
