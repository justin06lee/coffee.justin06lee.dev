#!/usr/bin/env python3
"""Generate the coffee icon: an ascii-shaded cup on a black disc.

A sibling to the donut icons on justin06lee.dev and chrome.justin06lee.dev.
Those work because the torus is genuinely 3D — a smooth luminance gradient
across a lit surface, sampled onto a character grid. A flat, banded drawing of
a cup does not sit next to them, so this raymarches a real one: a capped
cylinder for the body, a torus for the handle, a recessed disc for the coffee,
lit from the upper left and sampled the same way.

Glyphs are rects rather than <text>. A favicon is rendered in a context where
font availability isn't guaranteed, and a missing monospace face would leave an
empty disc; rect geometry always draws.

    python3 design/favicon/generate.py > src/app/icon.svg
"""
import math
import sys

N = 34                  # cells across
VIEW = 136.0            # viewBox units
CELL = VIEW / N
DISC = 0.97             # black disc radius, normalised
LEVELS = 11             # 1..11; 0 is empty, mirroring the ramp's leading space
SCALE = 1.22            # world units across the disc radius
# The handle only sticks out on one side, so the silhouette has to be
# re-centred or the cup sits visibly left of the disc's middle.
U_OFFSET = 0.30

CUP_R = 0.72            # cup radius in world units
CUP_H = 0.54            # half-height
WALL = 0.10             # rim thickness, so the coffee sits inside a lip
HANDLE_R = 0.36         # handle ring radius
HANDLE_T = 0.10         # handle tube radius

PITCH = math.radians(24)   # looking down onto the cup
YAW = math.radians(-17)    # turned so the handle reads in silhouette
# Deliberately not straight down: a vertical light leaves a cylinder wall
# almost unshaded, which is what made the first pass read flat.
LIGHT = (-0.55, 0.42, -0.72)


def norm(v):
    m = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / m, v[1] / m, v[2] / m)


LIGHT = norm(LIGHT)


def sd_capped_cylinder(p, h, r):
    dx = math.hypot(p[0], p[2]) - r
    dy = abs(p[1]) - h
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    return min(max(dx, dy), 0.0) + outside


def sd_torus_xy(p, big_r, small_r):
    """Torus whose axis is z, so the ring stands upright beside the cup."""
    q = math.hypot(p[0], p[1]) - big_r
    return math.hypot(q, p[2]) - small_r


# Surface ids, so the coffee can be shaded differently from the ceramic.
CERAMIC, COFFEE = 0, 1


def scene(p):
    """Signed distance to the cup, and which material was nearest."""
    body = sd_capped_cylinder(p, CUP_H, CUP_R)

    # The coffee is a shallow disc recessed just below the rim. Subtracting it
    # from the body carves the well, which is what puts a lip on the near edge.
    well = sd_capped_cylinder(
        (p[0], p[1] - (CUP_H - 0.06), p[2]), 0.30, CUP_R - WALL
    )
    body = max(body, -well)

    handle = sd_torus_xy((p[0] - (CUP_R + HANDLE_R * 0.42), p[1] + 0.02, p[2]),
                         HANDLE_R, HANDLE_T)

    # The liquid surface: a flat disc sitting in the well.
    coffee = sd_capped_cylinder(
        (p[0], p[1] - (CUP_H - 0.20), p[2]), 0.012, CUP_R - WALL - 0.015
    )

    solid = min(body, handle)
    if coffee < solid:
        return coffee, COFFEE
    return solid, CERAMIC


def normal_at(p):
    e = 0.0015
    dx = scene((p[0] + e, p[1], p[2]))[0] - scene((p[0] - e, p[1], p[2]))[0]
    dy = scene((p[0], p[1] + e, p[2]))[0] - scene((p[0], p[1] - e, p[2]))[0]
    dz = scene((p[0], p[1], p[2] + e))[0] - scene((p[0], p[1], p[2] - e))[0]
    return norm((dx, dy, dz))


def rotate(v):
    """Camera space to world space: yaw about y, then pitch about x."""
    x, y, z = v
    cy, sy = math.cos(YAW), math.sin(YAW)
    x, z = x * cy - z * sy, x * sy + z * cy
    cp, sp = math.cos(PITCH), math.sin(PITCH)
    y, z = y * cp - z * sp, y * sp + z * cp
    return (x, y, z)


def trace(u, v):
    """Luminance in 0..1 for a ray through screen point (u, v), 0 for a miss."""
    origin = rotate((u, v, -3.0))
    direction = rotate((0.0, 0.0, 1.0))

    t = 0.0
    for _ in range(96):
        p = (origin[0] + direction[0] * t,
             origin[1] + direction[1] * t,
             origin[2] + direction[2] * t)
        d, material = scene(p)
        if d < 0.002:
            n = normal_at(p)
            lambert = max(0.0, sum(n[i] * LIGHT[i] for i in range(3)))
            if material == COFFEE:
                # Darker and flatter than the ceramic — it should read as
                # liquid sitting inside the cup, not as more of the cup.
                return 0.11 + 0.30 * lambert
            # Ambient term keeps the unlit side present at 16-32px, where the
            # whole mark averages down to a smudge; the gain is still kept
            # below saturation, because letting the lit wall reach the top of
            # the ramp turns it into a solid white slab and loses the texture
            # exactly where the cup is biggest.
            return 0.22 + 0.64 * lambert
        if t > 6.0:
            break
        t += max(d * 0.85, 0.004)
    return 0.0


def glyph(level, cx, cy):
    """Rects for one cell, shaped to evoke the ascii ramp it stands in for."""
    s = CELL
    unit = s / 5.0
    px, py = cx - s / 2.0, cy - s / 2.0

    def rect(gx, gy, gw, gh):
        # Emitted as path data rather than a <rect> element: the icon is a few
        # hundred marks, and "M.. h.. v.. h.. z" is less than half the bytes of
        # the equivalent element once they are all concatenated into one path.
        return (f"M{px + gx * unit:.1f} {py + gy * unit:.1f}"
                f"h{gw * unit:.1f}v{gh * unit:.1f}h{-gw * unit:.1f}z")

    if level <= 1:                      # ,
        return [rect(2, 3, 1.1, 1.1)]
    if level <= 3:                      # - ~
        return [rect(1, 2.1, 3, 1)]
    if level <= 5:                      # : ;
        return [rect(2, 0.6, 1.1, 1.3), rect(2, 3.2, 1.1, 1.3)]
    if level <= 7:                      # = !
        return [rect(0.6, 1.1, 3.8, 1), rect(0.6, 3.0, 3.8, 1)]
    if level <= 9:                      # * #
        return [rect(0.5, 1.1, 4, 0.9), rect(0.5, 3.1, 4, 0.9),
                rect(1.4, 0.3, 0.9, 4.4), rect(2.8, 0.3, 0.9, 4.4)]
    return [rect(0.35, 0.35, 4.3, 4.3)]  # $ @


def main():
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEW:.0f} {VIEW:.0f}"'
        f' width="{VIEW:.0f}" height="{VIEW:.0f}">',
        "<title>coffee</title>",
        # The disc is the whole background; outside it stays transparent, the
        # way the donut icons on the other sites do it.
        f'<circle cx="{VIEW / 2:.0f}" cy="{VIEW / 2:.0f}"'
        f' r="{DISC * VIEW / 2:.2f}" fill="#000000"/>',
    ]

    buckets = {}
    for row in range(N):
        for col in range(N):
            cx, cy = (col + 0.5) * CELL, (row + 0.5) * CELL
            u = (cx - VIEW / 2) / (VIEW / 2) * SCALE + U_OFFSET
            v = -(cy - VIEW / 2) / (VIEW / 2) * SCALE
            if math.hypot((u - U_OFFSET) / SCALE, v / SCALE) > DISC - 0.02:
                continue
            level = int(round(trace(u, v) * LEVELS))
            if level <= 0:
                continue
            buckets.setdefault(level, []).extend(glyph(level, cx, cy))

    for level in sorted(buckets):
        opacity = 0.34 + 0.66 * (level / LEVELS)
        out.append(
            f'<path fill="#ffffff" fill-opacity="{opacity:.2f}"'
            f' d="{"".join(buckets[level])}"/>'
        )

    out.append("</svg>")
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
