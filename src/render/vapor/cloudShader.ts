// The original wing pressure cloud is a separate density field from the long,
// straight wingtip cores. Each field gets its own tight raymarch bounds.
export const pressureCloudShader = /* glsl */ `
uniform float alpha, load, speed, slip, humidity, wingSpan, wingHeight;
uniform float cloudUpperWeight;
uniform vec3 cloudAdvection, lightDirection;

float cloudFbm(vec3 p) {
  return noise3(p) * .57 + noise3(p * 2.03 + 9.7) * .28 + noise3(p * 4.07 - 5.1) * .15;
}

float pressureSideDensity(vec3 p, bool detail, float dorsal) {
  float incidence = clamp(abs(alpha) / 38.0, 0.0, 1.0);
  float aft = -p.x;
  p.z -= slip * max(0.0, aft + 2.0) * .32;
  float span = abs(p.z);
  float normalizedSpan = span / wingSpan;
  float leading = -3.1 + normalizedSpan * 5.3;
  float trailing = 3.4 - normalizedSpan * .4;
  float chord = clamp((aft - leading) / max(.7, trailing - leading), 0.0, 1.0);
  float downstream = max(0.0, aft - trailing);
  float speedShape = smoothstep(60.0, 280.0, speed);
  float height = (.18 + incidence * .58 + load * .24) * (1.0 - .40 * normalizedSpan) * mix(1.12, .78, speedShape);
  float surfaceY = wingHeight - .28 * normalizedSpan + .08 * sin(chord * 3.14159);
  if (dorsal < 0.0) surfaceY -= .10;
  float aboveWing = (p.y - surfaceY) * dorsal;
  // Most samples can only intersect one side. Skip the other field before its
  // shape/noise work, including while the two densities are crossfading.
  if (aboveWing <= -.16) return 0.0;
  float crest = .025 + height * .10 + downstream * incidence * .035;
  float front = smoothstep(leading - .24, leading + .50, aft);
  float back = 1.0 - smoothstep(trailing - .25, trailing + (.8 + incidence * 1.6) * mix(.7, 1.15, speedShape), aft);
  float spanMask = smoothstep(.6, 1.75, span) * (1.0 - smoothstep(wingSpan * .84, wingSpan * 1.02, span));
  float vertical = exp(-pow((aboveWing - crest) / max(.1, height), 2.0) * 1.7);
  float wing = front * back * spanMask * vertical;
  vec3 shoulder = vec3((p.x - .9) / 2.6, (aboveWing - .30) / (.30 + incidence * .48), p.z / 1.65);
  float body = exp(-dot(shoulder, shoulder) * 1.8) * (.35 + load * .4);
  // Short inboard shear rolls stay within the cloud. The long outboard trails
  // are rendered by the straight-core shader, with no duplicate curved trails.
  float wake = max(0.0, aft - 1.8);
  float phase = wake * 2.6 - cloudAdvection.x * .6;
  vec2 radial = vec2(span - (2.6 + wake * .10), aboveWing - .12 - wake * .035);
  radial += vec2(sin(phase), cos(phase)) * wake * .04 * turbulence;
  float roll = exp(-dot(radial, radial) / (.12 + wake * .14)) * smoothstep(1.8, 3.1, aft) * (1.0 - smoothstep(4.0, 7.5, aft)) * .25;
  float shape = wing + body + roll;
  if (shape < .004) return 0.0;
  vec3 q = (p - cloudAdvection) * vec3(1.45, 2.3, 1.7);
  float broad = noise3(q * .55 + 7.0);
  q += turbulence * (broad - .5) * 1.9;
  float fine = detail ? cloudFbm(q * 2.1) : noise3(q * 2.1);
  float billow = smoothstep(.30, .73, broad * .76 + fine * .24);
  float broken = max(0.0, shape * (.10 + billow * 1.65) - (1.0 - shape) * (1.0 - fine) * .42);
  float contact = exp(-pow(aboveWing / .18, 2.0)) * front * back * spanMask * .28;
  float textured = max(mix(shape, broken, noiseGain), contact);
  float base = smoothstep(-.16, -.035, aboveWing);
  float bounds = (1.0 - smoothstep(3.3, 4.6, abs(p.y))) * (1.0 - smoothstep(7.8, 9.4, aft));
  return max(0.0, textured) * base * bounds * strength * densityGain * smoothstep(.26, .78, humidity) * .56;
}

float pressureDensity(vec3 p, bool detail) {
  // Keep both surfaces fixed on the wing and crossfade optical density. Mixing
  // the dorsal sign itself would flatten/stretch the volume through the wing.
  float density = 0.0;
  if (cloudUpperWeight > 0.0) density += pressureSideDensity(p, detail, 1.0) * cloudUpperWeight;
  if (cloudUpperWeight < 1.0) density += pressureSideDensity(p, detail, -1.0) * (1.0 - cloudUpperWeight);
  return density;
}

// RGB stores density-weighted lighting, A stores optical depth. Combining the
// two fields in optical depth keeps overlap translucent instead of double-additive.
vec4 cloudOpticalDepth(vec3 ray, float surfaceDistance, float forwardLight) {
  vec3 safeRay = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), ray)) * max(abs(ray), vec3(1e-7));
  vec3 a = (vec3(-9.5, -4.8, -8.0) - cameraLocal) / safeRay;
  vec3 b = (vec3(5.8, 4.8, 8.0) - cameraLocal) / safeRay;
  vec3 nearHit = min(a, b), farHit = max(a, b);
  float start = max(0.0, max(max(nearHit.x, nearHit.y), nearHit.z));
  float end = min(surfaceDistance, min(min(farHit.x, farHit.y), farHit.z));
  if (end <= start) return vec4(0.0);
  float ds = (end - start) / 72.0;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
  vec4 result = vec4(0.0);
  for (int i = 0; i < 72; i++) {
    vec3 p = cameraLocal + ray * (start + (float(i) + .15 + jitter * .7) * ds);
    float d = pressureDensity(p, true);
    if (d > .003) {
      float shadow = pressureDensity(p + lightDirection * .8, false) * 1.25;
      vec3 lighting = vec3(.62, .72, .85) + vec3(.94, .91, .85) * exp(-shadow * .9) + forwardLight * .32;
      result += vec4(lighting, 1.0) * d * ds;
    }
  }
  return result;
}
`
