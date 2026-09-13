// Shared opaque color/depth and 3D noise with condensation: no second scene pass,
// billboards, blurred flame texture or per-frame particle allocations.
export const exhaustShader = /* glsl */ `
uniform vec3 nozzleLeft, nozzleRight;
uniform vec2 nozzleRadiusLeft, nozzleRadiusRight, exhaustResolution;
uniform vec3 nozzleAxisLeft, nozzleAxisRight, nozzleUpLeft, nozzleUpRight;
uniform float exhaustPower, burnerStrength, exhaustTime, nozzleInset, nozzleRound;
uniform float exhaustLength, exhaustTurbulence;
uniform float chamberRadius, burnerViolet;

vec2 exhaustBounds(vec3 ro, vec3 rd, float lengthMax, vec2 nozzleRadius) {
  vec3 safe = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), rd)) * max(abs(rd), vec3(1e-7));
  vec3 extent = vec3(nozzleRadius * 2.1, lengthMax);
  vec3 a = (vec3(-extent.xy, -nozzleInset) - ro) / safe;
  vec3 b = (extent - ro) / safe;
  vec3 lo = min(a, b), hi = max(a, b);
  return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}

// RGB is integrated emission, alpha is a small background-refraction weight.
vec4 exhaustRay(vec3 ray, vec3 origin, vec3 axis, vec3 up, vec2 nozzleRadius, float surfaceDistance, float seed) {
  if (exhaustPower < .002) return vec4(0.0);
  vec3 across = normalize(cross(up, axis));
  vec3 offset = cameraLocal - origin;
  vec3 ro = vec3(dot(offset, across), dot(offset, up), dot(offset, axis));
  vec3 rd = vec3(dot(ray, across), dot(ray, up), dot(ray, axis));
  float plumeLength = mix(.38 + exhaustPower * .32, exhaustLength * (.60 + .40 * exhaustPower), burnerStrength);
  vec2 hit = exhaustBounds(ro, rd, plumeLength, nozzleRadius);
  float start = max(0.0, hit.x), end = min(surfaceDistance, hit.y);
  if (end <= start) return vec4(0.0);
  // Dry exhaust is short and smooth; reserve fine integration for compression
  // cells. This keeps a close rear view inexpensive when the burner is off.
  float sampleCount = burnerStrength > .002 ? 48.0 : 16.0;
  float ds = (end - start) / sampleCount;
  vec3 emission = vec3(0.0);
  float chamberFlicker = 1.0 + .014 * sin(exhaustTime * 23.0 + seed)
                           + .009 * sin(exhaustTime * 41.0 + seed * 2.0);
  // Soft elliptical hot bed, 0.74 m behind the lip. Physical placement and
  // scene-depth clipping preserve the dark cavity walls in oblique views.
  // Analytic intersection prevents a thin source from falling between samples.
  if (chamberRadius > 0.0 && rd.z < -1e-4) {
    float faceDistance = (-nozzleInset * .90 - ro.z) / rd.z;
    vec2 face = (ro.xy + rd.xy * faceDistance) / vec2(chamberRadius, chamberRadius * .64);
    float heatNoise = noise3(vec3(face * 2.8, exhaustTime * 1.8) + seed);
    float faceR = length(face) + (heatNoise - .5) * .035;
    float faceEdge = 1.0 - smoothstep(.62, 1.08, faceR);
    vec3 faceColor = mix(vec3(3.2, .68, .025), vec3(2.1, .23, .006), smoothstep(.08, .70, faceR));
    faceColor = mix(faceColor, vec3(1.2, .055, .002), smoothstep(.62, 1.05, faceR));
    if (faceDistance >= start && faceDistance <= end) {
      emission += faceColor * faceEdge * exhaustPower * chamberFlicker * (.96 + .08 * heatNoise);
    }
  }
  float haze = 0.0;
  float flicker = 1.0 + burnerStrength * (.025 * sin(exhaustTime * 39.0 + seed) + .018 * sin(exhaustTime * 67.0 + seed * 3.0));
  for (int i = 0; i < 48; i++) {
    if (float(i) >= sampleCount) break;
    vec3 p = ro + rd * (start + (float(i) + .5) * ds);
    float downstream = max(0.0, p.z), age = downstream / plumeLength;
    float inside = 1.0 - smoothstep(-.04, .16, p.z);
    float root = smoothstep(-nozzleInset, -nozzleInset + .16, p.z);
    float tail = 1.0 - smoothstep(.55, 1.0, age);
    // Slow expansion then dissolution, with a sheltered, unbroken young core.
    vec3 q = vec3(p.xy / nozzleRadius, downstream * 2.1 - exhaustTime * (10.0 + 8.0 * exhaustPower));
    float broad = noise3(q * .72 + seed), fine = noise3(q * 2.7 + seed + 7.2);
    vec2 eddy = vec2(broad - .5, noise3(q * .8 + seed + 17.0) - .5);
    vec2 transverse = p.xy / nozzleRadius;
    transverse -= eddy * exhaustTurbulence * smoothstep(0.0, .9, downstream) * (1.0 + age);
    float expansion = 1.0 + .15 * age - .42 * smoothstep(.45, 1.0, age) + .065 * sin(downstream * 5.0) * burnerStrength;
    // F-22's channel widens vertically towards the recessed chamber.
    vec2 radius = vec2(expansion, expansion + (1.0 - nozzleRound) * inside * .35);
    transverse /= radius * (.82 + .18 * exhaustPower);
    float roundR = length(transverse);
    vec2 square = transverse * transverse;
    float flatR = pow(dot(square * square, square * square), .125);
    float r = mix(flatR, roundR, nozzleRound);
    float edge = 1.0 - smoothstep(.68, 1.13, r + (fine - .5) * exhaustTurbulence * (1.0 - inside));
    if (r > 1.65) continue;
    float turbulence = mix(1.0, .65 + .60 * broad + .22 * fine, smoothstep(.15, 1.5, downstream));
    float core = exp(-r * r * 7.0) * exp(-downstream * 6.0);
    // Standing compression cells: narrowing cones meet at bright axial knots.
    // The wave pattern stays near-stationary while the gas texture advects.
    float cell = downstream / mix(.91, 1.12, nozzleRound);
    float phase = fract(cell + .08 * sin(exhaustTime * 2.0 + seed));
    float coneRadius = .08 + .64 * abs(phase * 2.0 - 1.0);
    float diamond = exp(-pow((r - coneRadius) / .13, 2.0)) * .55
                  + exp(-r * r * 18.0) * pow(max(0.0, sin(cell * 6.2831853 - 1.5708)), 8.0);
    diamond *= smoothstep(.18, .48, downstream) * exp(-age * 2.3) * edge;
    // Amber/orange dominates; F-22 has a subtle violet veil between the warm
    // compression cells and around the outer gas, only outside the nozzle.
    vec3 gold = vec3(3.0, .72, .025), orange = vec3(2.8, .40, .012);
    vec3 flameColor = mix(gold, orange, smoothstep(.12, .85, age));
    float coolCollar = exp(-downstream * 9.0) * .12 * (chamberRadius > 0.0 ? 0.0 : 1.0);
    flameColor = mix(flameColor, vec3(.50, .55, 1.5), coolCollar);
    float violet = burnerViolet * smoothstep(.12, .65, downstream)
                 * (.35 + .65 * smoothstep(.18, .85, r))
                 * (.55 + .45 * pow(sin(cell * 3.1415927), 2.0));
    flameColor = mix(flameColor, vec3(1.65, .42, 2.4), violet);

    // Su-57 retains its annular throat and tapered inner sleeve.
    float chamberMask = 1.0 - smoothstep(-.06, .015, p.z);
    float chamberDepth = clamp(-p.z / nozzleInset, 0.0, 1.0);
    float throatPlane = exp(-pow((p.z + nozzleInset * .72) / .16, 2.0));
    float throatRing = exp(-pow((r - .57) / .10, 2.0));
    float sleeveRadius = mix(.91, .68, chamberDepth);
    float sleeve = exp(-pow((r - sleeveRadius) / .095, 2.0));
    float ribs = .88 + .12 * cos(atan(transverse.y, transverse.x) * mix(20.0, 32.0, nozzleRound));
    vec3 throat = vec3(.42, .85, 3.0) * throatRing * throatPlane * mix(4.0, 2.0, burnerStrength);
    vec3 lining = vec3(2.5, .63, .055) * sleeve * ribs * (.65 + .35 * chamberDepth);
    vec3 chamber = (throat + lining) * chamberMask * (.3 + .7 * exhaustPower);
    if (chamberRadius > 0.0) {
      // Filled hot gas narrows from the deep elliptical bed to the flat exit.
      // The rim stays darker than the center, revealing the length of the duct.
      vec2 cavityRadius = mix(nozzleRadius * vec2(.94, 1.0), vec2(chamberRadius, chamberRadius * .64), chamberDepth);
      float cavityR = length(p.xy / cavityRadius);
      float cavityEdge = 1.0 - smoothstep(.58, 1.10, cavityR);
      float cavityHeat = exp(-cavityR * cavityR * 3.2);
      float cavityFlow = noise3(vec3(p.xy / cavityRadius * 2.5, p.z * 4.0 - exhaustTime * 3.0) + seed);
      vec3 cavityColor = mix(vec3(2.1, .12, .003), vec3(2.8, .48, .012), cavityHeat);
      float cavityMask = 1.0 - smoothstep(-.04, .12, p.z);
      chamber = cavityColor * cavityEdge * cavityMask * (.38 + .30 * chamberDepth)
              * (.94 + .12 * cavityFlow) * chamberFlicker;
    }
    vec3 hot = vec3(2.5, 1.7, .95) * core * burnerStrength * .32;
    vec3 flame = flameColor * edge * turbulence * burnerStrength * .24;
    // Warm compression highlights keep their shape without a white/blue chain.
    vec3 shocks = vec3(3.3, 1.35, .30) * diamond * burnerStrength * .44;
    if (chamberRadius > 0.0) {
      // Ignite inside the duct, reaching full flame before the exit. This
      // overlap with the cavity gas removes the dark seam at the nozzle lip.
      float ignition = smoothstep(-nozzleInset * .65, -.06, p.z);
      hot *= ignition; flame *= ignition; shocks *= ignition;
    }
    emission += (chamber + hot + flame + shocks)
              * root * tail * ds * exhaustPower * flicker;
    // Haze lives in the outer shear layer, NEVER over the hot core/diamonds.
    haze += smoothstep(.95, 1.18, r) * (1.0 - smoothstep(1.30, 1.65, r))
          * smoothstep(0.0, .35, downstream) * tail * ds * exhaustPower;
  }
  return vec4(emission, min(haze, 1.0));
}

vec3 exhaustComposite(vec3 base, vec3 ray, float surfaceDistance) {
  vec4 left = exhaustRay(ray, nozzleLeft, nozzleAxisLeft, nozzleUpLeft, nozzleRadiusLeft, surfaceDistance, 3.1);
  vec4 right = exhaustRay(ray, nozzleRight, nozzleAxisRight, nozzleUpRight, nozzleRadiusRight, surfaceDistance, 19.7);
  float haze = min(left.a + right.a, 1.0);
  if (haze < .0001) return base + left.rgb + right.rgb;
  vec2 displacement = vec2(sin(vUv.y * 310.0 + exhaustTime * 13.0), sin(vUv.x * 290.0 - exhaustTime * 11.0));
  // Less than half a physical pixel; sample only the opaque scene BEFORE adding
  // emission. No blur kernel and no sampling the hot core or shock diamonds.
  vec2 shifted = clamp(vUv + displacement * haze * .4 / exhaustResolution, vec2(0.0), vec2(1.0));
  float sameSurface = 1.0 - step(.00002, abs(texture2D(sceneDepth, shifted).r - texture2D(sceneDepth, vUv).r));
  vec3 refracted = mix(base, texture2D(sceneColor, shifted).rgb, haze * .16 * sameSurface);
  return refracted + left.rgb + right.rgb;
}
`
