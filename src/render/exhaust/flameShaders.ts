// Stylised flame shells, nozzle interior and heat-haze volume, ported from
// example/su57-exhaust-demo.html (Exhaust Style GAME, SIM FX palette).
// Geometry is a unit tube: position.xy on the unit circle, position.z = s in [0, 1].
// Local +Z is the exhaust axis, +X across (nozzle width), +Y up (nozzle height).

// Ashima / stegu 3D simplex noise (MIT) + 3-octave FBM. Time-coherent.
const noise = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm3(vec3 p) {
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { f += a * snoise(p); p = p * 2.03 + vec3(3.1, 1.7, 5.3); a *= 0.5; }
  return f;
}
`

// The cross-section starts at the nozzle's own shape (flat on the F-22) and rounds
// out downstream: uRootScale -> uTailScale over the first 40% of the plume.
// Radii and noise run in demo metres, so every aircraft shows the same pattern scale.
export const flameVertex = /* glsl */ `
uniform float uTime, uScroll, uLength, uR0, uR1, uShape, uWobble, uBump, uFreq, uPhase, uBumpRamp;
uniform vec2 uRootScale;
uniform float uTailScale;
varying vec3 vLocal;
varying float vS;
varying vec3 vViewPos, vViewNormal, vAxisV;
${noise}
float radiusAt(float s) { return max(mix(uR0, uR1, pow(clamp(s, 0.0, 1.0), uShape)), 0.0); }
void main() {
  float s = position.z;
  vec2 d = position.xy / max(length(position.xy), 1e-4);
  // low-frequency body motion + high-frequency boundary turbulence
  float lf = snoise(vec3(s * 1.3 - uScroll * 0.12, uTime * 0.45, uPhase));
  float hf = snoise(vec3(d * 1.4 + uPhase, s * uFreq * 2.6 - uScroll * 0.55));
  float ramp = smoothstep(0.0, max(uBumpRamp, 0.12), s);
  float r = radiusAt(s) * (1.0 + uBump * (0.55 * hf + 0.45 * lf) * ramp);
  vec2 sway = vec2(
    snoise(vec3(s * 0.8 - uScroll * 0.07, uPhase + 1.3, uTime * 0.35)),
    snoise(vec3(s * 0.8 - uScroll * 0.07, uPhase + 8.7, uTime * 0.35 + 2.1))
  ) * uWobble * s * s * (0.25 + 0.04 * uLength);
  // Pattern space (demo metres) for the fragment noise.
  vLocal = vec3(d * r + sway, s * uLength);
  vS = s;
  vec2 scale = mix(uRootScale, vec2(uTailScale), smoothstep(0.0, 0.4, s));
  vec3 p = vec3((d * r + sway) * scale, s * uLength * uTailScale);
  vAxisV = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  float ds = 0.02;
  float slope = (radiusAt(min(s + ds, 1.0)) - radiusAt(max(s - ds, 0.0))) / (2.0 * ds * max(uLength, 0.05));
  vViewNormal = normalize(normalMatrix * normalize(vec3(d / scale * uTailScale, -slope)));
  gl_Position = projectionMatrix * mv;
}
`

// Smooth gradient cone with soft edges, travelling glow bands and a coherent
// flicker, plus the HYBRID (SIM FX) terms: ragged eroding edges, mid-plume
// breakup and a fast-dissolving tail.
export const flameFragment = /* glsl */ `
uniform float uTime, uScroll, uPhase, uIntensity, uEdge, uAxial, uFalloff, uFadeIn, uMid, uMid2;
uniform float uFlicker, uRim, uHybrid, uTailCut, uTintAmt, uPatch;
// Share of s inside the nozzle, and how much end-on glow that part keeps.
uniform float uInside, uInsideAxial;
uniform vec3 uInnerTint, uColA, uColB, uColC, uColD;
varying vec3 vLocal;
varying float vS;
varying vec3 vViewPos, vViewNormal, vAxisV;
${noise}
void main() {
  vec3 V = normalize(-vViewPos);
  float facing = abs(dot(normalize(vViewNormal), V));
  // Full end-on glow from just upstream of the lip outward, so the exit has no dark band.
  float insideAxial = uInside > 0.0 ? mix(uInsideAxial, 1.0, smoothstep(uInside * 0.4, uInside, vS)) : 1.0;
  float base = max(pow(facing, uEdge), uAxial * insideAxial * smoothstep(0.45, 0.97, abs(dot(normalize(vAxisV), V))));
  // uRim > 0: hollow sheath, brightest between centre and silhouette
  float rim = smoothstep(0.0, 0.55, facing) * (1.0 - smoothstep(0.25, 0.95, facing)) * 1.8;
  float thick = mix(base, rim + 0.25 * base, uRim);
  float s = vS;
  float axial = smoothstep(0.0, uFadeIn, s) * pow(max(1.0 - s, 0.0), uFalloff);
  float n = snoise(vec3(vLocal.xy * 0.8, vLocal.z * 0.6 - uScroll * 0.7) + uPhase);
  float bands = 1.0 + uFlicker * (0.16 * sin(vLocal.z * 3.0 - uScroll * 2.4 + n * 1.4) + 0.2 * n);
  // tongues of flame licking along the sheath
  float ang = atan(vLocal.y, vLocal.x);
  float tongues = snoise(vec3(cos(ang) * 1.6, sin(ang) * 1.6, vLocal.z * 0.9 - uScroll * 1.1) + uPhase * 1.3);
  bands *= mix(1.0, 0.35 + 0.75 * smoothstep(-0.6, 0.7, tongues), uRim);
  float pulse = 0.93 + 0.07 * sin(uTime * 21.0 + uPhase) * sin(uTime * 6.7 + uPhase * 2.0);
  vec3 col = mix(uColA, uColB, smoothstep(0.0, uMid, s));
  col = mix(col, uColC, smoothstep(uMid, uMid2, s));
  col = mix(col, uColD, smoothstep(uMid2, 1.0, s));
  col = mix(col, uInnerTint, smoothstep(0.35, 0.9, facing) * uTintAmt);
  float a = thick * axial * bands * pulse * uIntensity;
  if (uHybrid > 0.0) {
    float midZ = smoothstep(0.10, 0.42, s);
    // streaky noise stretched along the flow: flame tongues, not smoke puffs
    vec3 qh = vec3(vLocal.xy * 2.3, vLocal.z * 0.42 - uScroll * 0.95) + uPhase * 0.7;
    float hn = snoise(qh) * 0.65 + snoise(qh * vec3(2.2, 2.2, 1.5) + 7.3) * 0.35;
    float edge = smoothstep(0.0, 0.32, facing + (hn * 0.34 - 0.06) * midZ);
    float tailZ = smoothstep(0.62, 1.0, s);
    float pulses = 1.0 + 0.34 * midZ * (1.0 - tailZ) * sin(vLocal.z * 2.1 - uScroll * 1.9 + hn * 1.3);
    float breakup = mix(1.0, smoothstep(-0.5, 0.3, hn), midZ * 0.65);
    float root = 1.0 + (1.0 - midZ) * (0.06 + 0.05 * sin(uTime * 41.0 + uPhase + vLocal.z * 6.0));
    float tail = 1.0 - smoothstep(uTailCut - 0.28, uTailCut, s + hn * 0.06);
    float pn = snoise(vec3(cos(ang) * 0.9, sin(ang) * 0.9, vLocal.z * 0.32 - uScroll * 0.45) + uPhase * 2.1);
    tail *= mix(1.0, smoothstep(-0.25, 0.55, pn), uPatch);
    a *= mix(1.0, edge * pulses * breakup * root * tail, uHybrid);
  }
  gl_FragColor = vec4(col * a, 1.0);
}
`

// Shock cells (Mach diamonds): one shell whose radius is a chain of lenses.
export const shockVertex = /* glsl */ `
uniform float uTime, uScroll, uStart, uSpan, uRmax, uCells, uPhase, uBreath;
uniform vec2 uRootScale;
uniform float uTailScale;
varying vec3 vLocal;
varying float vS;
varying vec3 vViewPos, vViewNormal;
${noise}
float cellCoord(float s) { return uCells * (1.2 * s - 0.2 * s * s); }
float lensR(float s) {
  float x = cellCoord(clamp(s, 0.0, 1.0));
  float k = floor(x);
  float lens = pow(max(sin(3.14159265 * fract(x)), 0.0), 0.8);
  return uRmax * lens * (0.4 + 0.6 * exp(-k * 0.45));
}
void main() {
  float s = position.z;
  vec2 d = position.xy / max(length(position.xy), 1e-4);
  float k = floor(cellCoord(s));
  float r = lensR(s);
  r *= 1.0 + 0.14 * snoise(vec3(k * 2.7 + uPhase, uTime * 1.2, 0.5)) + 0.07 * snoise(vec3(d * 2.0, s * 9.0 - uScroll * 0.6));
  float span = uSpan * (1.0 + uBreath * sin(uTime * 2.3 + uPhase));
  vLocal = vec3(d * r, uStart + s * span);
  vS = s;
  vec2 scale = mix(uRootScale, vec2(uTailScale), smoothstep(0.0, 0.4, (uStart + s * span) / max(uStart + span, 0.05)));
  vec4 mv = modelViewMatrix * vec4(vec3(d * r * scale, (uStart + s * span) * uTailScale), 1.0);
  vViewPos = mv.xyz;
  float ds = 0.004;
  float slope = (lensR(s + ds) - lensR(s - ds)) / (2.0 * ds * max(span, 0.05));
  vViewNormal = normalize(normalMatrix * normalize(vec3(d, -slope)));
  gl_Position = projectionMatrix * mv;
}
`

export const shockFragment = /* glsl */ `
uniform float uTime, uScroll, uPhase, uCells, uIntensity;
uniform vec3 uColA, uColB;
varying vec3 vLocal;
varying float vS;
varying vec3 vViewPos, vViewNormal;
${noise}
void main() {
  vec3 V = normalize(-vViewPos);
  float facing = abs(dot(normalize(vViewNormal), V));
  float x = uCells * (1.2 * vS - 0.2 * vS * vS);
  float k = floor(x);
  float sf = sin(3.14159265 * fract(x));
  float flick = 0.78 + 0.22 * snoise(vec3(k * 1.7 + uPhase, uTime * 1.8, 3.0));
  float grain = 0.82 + 0.18 * snoise(vec3(vLocal.xy * 6.0, vLocal.z * 3.0 - uScroll * 0.8));
  vec3 col = mix(uColA, uColB, clamp(k / max(uCells - 1.0, 1.0), 0.0, 1.0));
  float a = pow(facing, 2.0) * sf * sf * exp(-k * 0.6) * flick * grain * uIntensity;
  gl_FragColor = vec4(col * a, 1.0);
}
`

// Nozzle interior by interior mapping: one plane at the exit, its local frame scaled so
// the duct is x, y in [-1, 1] at the plane (box, or a circle when uRound) and runs to
// z = -uDepth metres, narrowing to uTaper there. The duct is wider than the exit, so the
// airframe hides its walls' outer edges.
// Each fragment follows the view ray to the side wall or the back face, so the walls and
// the flameholder shift with the camera. It is virtual depth only: the plane sits at the
// lip and the airframe's own depth (walls, flaps) still occludes it.
export const interiorVertex = /* glsl */ `
// Plane half-size in duct units: below 1, the duct runs wider than the plane.
uniform float uPlane;
varying vec3 vBox, vCam;
void main() {
  vec3 scale = vec3(uPlane, uPlane, 1.0);
  vBox = position * scale;
  vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz * scale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const interiorFragment = /* glsl */ `
uniform float uIntensity, uAB, uTime, uScroll, uPhase, uRingAmt, uDepth, uTaper, uRound, uWall, uGas, uCore;
uniform vec3 uC0, uC1, uC2;
varying vec3 vBox, vCam;
${noise}
void main() {
  vec3 p = vec3(vBox.xy, 0.0);
  if (uRound > 0.5 && dot(p.xy, p.xy) > 1.0) discard;
  vec3 d = p - vCam;
  if (d.z > -1e-5) discard;
  float tBack = -uDepth / d.z, tWall = 1e9;
  // The wall's half-size along the ray is 1 + m t (m < 0: the duct narrows inward).
  float m = (1.0 - uTaper) * d.z / uDepth;
  if (uRound > 0.5) {
    // First positive root of |p.xy + t d.xy| = 1 + m t.
    float A = dot(d.xy, d.xy) - m * m, B = dot(p.xy, d.xy) - m, C = dot(p.xy, p.xy) - 1.0;
    if (abs(A) < 1e-8) { if (B > 1e-8) tWall = -C / (2.0 * B); }
    else {
      float disc = B * B - A * C;
      if (disc >= 0.0) {
        float s = sqrt(disc), r1 = (-B - s) / A, r2 = (-B + s) / A;
        if (r1 > 1e-6) tWall = r1;
        if (r2 > 1e-6) tWall = min(tWall, r2);
      }
    }
  } else {
    // Each side wall: p + t d = +-(1 + m t) on that axis.
    vec2 up = d.xy - m, down = -d.xy - m;
    vec2 tUp = mix(vec2(1e9), (1.0 - p.xy) / max(up, 1e-8), step(1e-8, up));
    vec2 tDown = mix(vec2(1e9), (1.0 + p.xy) / max(down, 1e-8), step(1e-8, down));
    tWall = min(min(tUp.x, tUp.y), min(tDown.x, tDown.y));
  }
  float t = min(tBack, tWall);
  vec3 h = p + d * t;
  // 0 at the exit, 1 at the back face.
  float depth = clamp(-h.z / uDepth, 0.0, 1.0);
  // One shading for back face and walls, so their corner leaves no seam: the back face's
  // radial pattern in coordinates normalised by the duct's size at that depth (walls sit at
  // its rim), dimming towards the exit. The rings fade in only near the back face.
  float size = 1.0 - (1.0 - uTaper) * depth;
  float r = length(h.xy) / size, a = atan(h.y, h.x);
  float ringAmt = uRingAmt * smoothstep(0.85, 1.0, depth);
  float rings = 1.0 - ringAmt * (0.5 - 0.5 * smoothstep(-0.3, 0.7, cos(r * 3.14159265 * 9.0)));
  float spokes = 1.0 - ringAmt * (0.12 - 0.12 * cos(a * 16.0));
  float n = snoise(vec3(h.xy * 2.2, h.z * 3.0 + uScroll * 0.35) + uPhase) * 0.5 + 0.5;
  vec3 col = mix(uC0, uC1, smoothstep(0.0, 0.6, r));
  col = mix(col, uC2, smoothstep(0.6, 1.1, r)) * rings * spokes * (0.75 + 0.5 * n) * (1.0 - 0.6 * smoothstep(0.75, 1.4, r));
  col += vec3(1.0, 0.92, 0.75) * exp(-r * r / (uCore * uCore)) * (0.35 + 0.65 * uAB);
  // Lit from the burner: walls darken towards the exit; uWall slows that falloff.
  col *= pow(depth, 1.6 / max(uWall, 0.05));
  // Hot gas filling the duct: brightest straight down the middle, where the ray runs deepest.
  col += mix(uC2, uC1, 0.6) * uGas * depth * exp(-1.2 * dot(p.xy, p.xy));
  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`

// Heat-haze volume: writes signed screen-space UV offsets (RG) into a half-res
// float buffer, additively. Soft-occluded against the resolved scene depth.
export const heatVertex = /* glsl */ `
uniform float uTime, uScroll, uLength, uR0, uR1, uStart, uPhase, uWobble;
uniform vec2 uRootScale;
uniform float uTailScale;
varying vec3 vLocal;
varying float vS, vR;
varying vec3 vViewPos, vViewNormal, vAxisV;
${noise}
float radiusAt(float s) { return mix(uR0, uR1, pow(clamp(s, 0.0, 1.0), 0.7)); }
void main() {
  float s = position.z;
  vec2 d = position.xy / max(length(position.xy), 1e-4);
  float r = radiusAt(s) * (1.0 + 0.2 * snoise(vec3(d * 1.2 + uPhase, s * 3.0 - uScroll * 0.22)) * smoothstep(0.0, 0.25, s));
  vec2 sway = vec2(
    snoise(vec3(s * 0.7 - uScroll * 0.05, uPhase + 3.0, uTime * 0.3)),
    snoise(vec3(s * 0.7 - uScroll * 0.05, uPhase + 9.0, uTime * 0.3 + 4.0))
  ) * uWobble * s * s;
  vLocal = vec3(d * r + sway, uStart + s * uLength);
  vS = s;
  vR = r;
  vec2 scale = mix(uRootScale, vec2(uTailScale), smoothstep(0.0, 0.3, s));
  vec3 p = vec3((d * r + sway) * scale, (uStart + s * uLength) * uTailScale);
  vAxisV = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  float ds = 0.02;
  float slope = (radiusAt(min(s + ds, 1.0)) - radiusAt(max(s - ds, 0.0))) / (2.0 * ds * max(uLength, 0.05));
  vViewNormal = normalize(normalMatrix * normalize(vec3(d, -slope)));
  gl_Position = projectionMatrix * mv;
}
`

export const heatFragment = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear, uFar, uOrtho, uSoftDistance, uCameraFade, uStrength, uScroll, uFreq, uPhase;
varying vec3 vLocal;
varying float vS, vR;
varying vec3 vViewPos, vViewNormal, vAxisV;
${noise}
void main() {
  float depth = texture2D(tDepth, gl_FragCoord.xy / uRes).x;
  float sceneDist = -mix(perspectiveDepthToViewZ(depth, uNear, uFar), orthographicDepthToViewZ(depth, uNear, uFar), uOrtho);
  float fragDist = -vViewPos.z;
  // Soft intersection with the airframe and ground.
  float soft = clamp((sceneDist - fragDist) / uSoftDistance, 0.0, 1.0);
  // A camera inside the volume sees no wall of distortion right at the lens.
  soft *= smoothstep(0.25 * uCameraFade, uCameraFade, fragDist);
  if (soft <= 0.0) discard;
  vec3 V = normalize(-vViewPos);
  float facing = abs(dot(normalize(vViewNormal), V));
  // Optical path: the silhouette fades out, but looking down the plume axis the path is long.
  float alongAxis = abs(dot(normalize(vAxisV), V));
  float thick = max(smoothstep(0.0, 0.8, facing), 0.9 * smoothstep(0.3, 0.95, alongAxis));
  float s = vS;
  float axial = smoothstep(0.0, 0.05, s) * pow(max(1.0 - s, 0.0), 1.5);
  float w = max(vR, 0.25);
  vec3 q = vec3(vLocal.xy / w * 1.1, vLocal.z * uFreq - uScroll) + uPhase;
  vec2 o = vec2(fbm3(q), fbm3(q + vec3(19.1, 7.3, 3.7)));
  vec3 q2 = vec3(vLocal.xy * 3.2, vLocal.z * uFreq * 2.4 - uScroll * 2.1) + uPhase * 1.7;
  o += 0.4 * vec2(snoise(q2), snoise(q2 + 11.3)) * (1.0 - s);
  float nearBoost = 1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.25, s));
  // Refraction parallax: the far background shifts most, surfaces right behind the plume barely move.
  float persp = clamp((sceneDist - fragDist) / max(sceneDist, 0.1) * 1.5, 0.0, 1.0);
  gl_FragColor = vec4(o * uStrength * axial * thick * soft * persp * nearBoost, 0.0, 1.0);
}
`
