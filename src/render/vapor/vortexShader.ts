// Leading-edge vortex and vapor cone (docs/vapor-overhaul-plan.md §4.1, §4.4).
// Both are density fields in aircraft space, marched only inside their own box
// and folded into the same optical depth as the wingtip cores.
export const vortexShader = /* glsl */ `
uniform float lexStrength, lexBurst, lexFlow, lexSamples;
// Baked onto the skin per aircraft (profile.ts); S is normalized arc length.
uniform vec3 lexPath[6];
uniform float lexPathS[6];
uniform vec3 lexBoxMin, lexBoxMax;
uniform vec2 lexRadius;
uniform float coneStrength, coneFront, coneBack, coneAxisY;
uniform vec2 coneRadius;
uniform vec3 coneBoxMin, coneBoxMax;

vec2 boxHit(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
  vec3 safe = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), rd)) * max(abs(rd), vec3(1e-7));
  vec3 a = (lo - ro) / safe, b = (hi - ro) / safe;
  vec3 n = min(a, b), f = max(a, b);
  return vec2(max(max(n.x, n.y), n.z), min(min(f.x, f.y), f.z));
}

// Offset from the nearest point on segment a→b; w = position along it, 0–1.
vec4 segmentOffset(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return vec4(p - (a + ab * t), t);
}

float lexDensity(vec3 p) {
  // One evaluation for both sides; the left vortex mirrors the right.
  vec3 q = vec3(p.x, p.y, abs(p.z));
  float side = p.z < 0.0 ? 1.0 : 0.0;
  vec3 off = vec3(1e3);
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    vec4 h = segmentOffset(q, lexPath[i], lexPath[i + 1]);
    if (dot(h.xyz, h.xyz) < dot(off, off)) { off = h.xyz; s = mix(lexPathS[i], lexPathS[i + 1], h.w); }
  }
  float radius = mix(lexRadius.x, lexRadius.y, s);
  // Vortex burst: the tight core breaks into a wide, lumpy cloud aft of this point.
  float burst = smoothstep(lexBurst - .04, lexBurst + .2, s);
  radius *= mix(1.0, 2.4, burst);
  // Air turbulence: slow noise that boils as it travels pushes the offset around,
  // so the outline rolls and bulges instead of sliding past as a fixed shape.
  float churn = turbulence * mix(.25, 1.0, burst) * min(noiseGain, 1.0);
  vec3 w = vec3(s * 4.0 - lexFlow * .6, q.y * .9 + lexFlow * .21, q.z * .9 + side * 9.1);
  off.yz += (vec2(noise3(w + 21.7), noise3(w * 1.3 + 40.2)) - .5) * radius * 1.0 * churn;
  // The burst cloud lies on the skin: squashed vertically, spread over the wing.
  vec2 e = vec2(off.y * mix(1.0, 1.5, burst), off.z * mix(1.0, .65, burst)) / radius;
  float radial = dot(e, e);
  if (radial > 9.0) return 0.0;
  // Scrolls downstream and twists about the axis.
  vec3 n = vec3(s * 7.0 - lexFlow, q.y / radius * .45 + side * 17.3, q.z / radius * .45 + s * 3.0);
  float broad = noise3(n * vec3(1.0, .6, .6) + 3.1);
  float fine = noise3(n * vec3(2.6, 1.7, 1.7) + 11.0);
  // Soft wisp, not a hard tube: wide falloff broken up by noise.
  float tight = (exp(-radial * 1.3) + exp(-radial * .5) * .1) * mix(1.0, .45 + broad * .6 + fine * .35, min(noiseGain, 1.0));
  // Puffy, cauliflower edge: the noise decides where the cloud ends, not a gaussian.
  // Billow noise (1 − |2n − 1|) adds small round puffs on top of the big lumps.
  float puff = 1.0 - abs(noise3(n * vec3(4.5, 3.2, 3.2) + 27.0) * 2.0 - 1.0);
  float lumps = mix(.55, broad * .6 + fine * .3 + puff * .15 - .025, min(noiseGain, 1.0));
  float burstCloud = smoothstep(0.0, .45, lumps * 1.3 - sqrt(radial) * .45) * mix(.75, .55 + fine * .25 + puff * .2, min(noiseGain, 1.0)) * .8;
  float head = smoothstep(0.0, .07, s);
  // Fades out over the wing root's trailing edge.
  float tail = 1.0 - smoothstep(.6, 1.0, s);
  return mix(tight, burstCloud, burst) * head * tail;
}

float lexOpticalDepth(vec3 ray, float surfaceDistance) {
  if (lexStrength * densityGain < .002) return 0.0;
  vec2 hit = boxHit(cameraLocal, ray, lexBoxMin, lexBoxMax);
  float start = max(0.0, hit.x), end = min(surfaceDistance, hit.y);
  if (end <= start) return 0.0;
  float ds = (end - start) / max(1.0, lexSamples);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
  float optical = 0.0;
  for (int i = 0; i < 40; i++) {
    if (float(i) >= lexSamples) break;
    optical += lexDensity(cameraLocal + ray * (start + (float(i) + jitter) * ds)) * ds;
  }
  return optical * lexStrength * densityGain * 1.3;
}

// A wide, soft haze disc around the jet, from the canopy back to the shock.
// Smooth everywhere: gaussian falloff outward, a soft front, a slightly firmer
// aft edge that leans back away from the fuselage, and only broad, slow noise.
float coneDensity(vec3 p) {
  float r = length(vec2(p.y - coneAxisY, p.z));
  float shockX = coneBack - r * .18;
  float run = max(.5, coneFront - coneBack);
  float u = clamp((coneFront - p.x) / run, 0.0, 1.0);
  float radius = mix(coneRadius.x, coneRadius.y, sqrt(u));
  float falloff = r / radius;
  if (falloff > 1.6) return 0.0;
  float shell = exp(-falloff * falloff * 2.2);
  float aftEdge = smoothstep(shockX - 1.4, shockX + .8, p.x);
  float front = smoothstep(0.0, .6, u);
  // Mottled like drifting haze: two slow octaves, no streaks or fine grain.
  vec3 n = (p - cloudAdvection * .25) * vec3(.35, .5, .5);
  float mottle = noise3(n + 5.3) * .6 + noise3(n * 2.3 + 1.7) * .4;
  float body = mix(.35, 1.0, u) * mix(1.0, smoothstep(.2, .8, mottle) * 1.3, min(noiseGain, 1.0));
  return shell * aftEdge * front * body;
}

float coneOpticalDepth(vec3 ray, float surfaceDistance) {
  if (coneStrength * densityGain < .002) return 0.0;
  vec2 hit = boxHit(cameraLocal, ray, coneBoxMin, coneBoxMax);
  float start = max(0.0, hit.x), end = min(surfaceDistance, hit.y);
  if (end <= start) return 0.0;
  float ds = (end - start) / max(1.0, lexSamples);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.yx, vec2(.06711056, .00583715))));
  float optical = 0.0;
  for (int i = 0; i < 40; i++) {
    if (float(i) >= lexSamples) break;
    optical += coneDensity(cameraLocal + ray * (start + (float(i) + jitter) * ds)) * ds;
  }
  // Kept faint: a thin veil the aircraft and terrain show through.
  return optical * coneStrength * densityGain * .175;
}
`
