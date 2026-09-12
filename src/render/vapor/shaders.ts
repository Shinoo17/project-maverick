import { pressureCloudShader } from './cloudShader'

export const vaporVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const vaporFragment = /* glsl */ `
precision highp sampler3D;
uniform sampler2D sceneColor, sceneDepth;
uniform sampler3D noiseTex;
uniform mat4 inverseProjection, cameraWorld, worldToAircraft;
uniform vec3 cameraLocal, airflowDirection, wingtipLeft, wingtipRight;
uniform float strength, densityGain, noiseGain, turbulence, flowPhase;
uniform float trailLength, trailRadius, pixelAngle;
uniform bool solidBackground;
varying vec2 vUv;

float noise3(vec3 p) { return texture(noiseTex, p / 32.0).r; }

${pressureCloudShader}

// March only each thin oriented core. Uniform sampling across a large aircraft
// box skips narrow vortices at oblique views and turns them into dotted beads.
vec2 intersectTrail(vec3 ro, vec3 rd, float extent) {
  vec3 safeDirection = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), rd)) * max(abs(rd), vec3(1e-7));
  vec3 a = (vec3(-extent, -extent, 0.0) - ro) / safeDirection;
  vec3 b = (vec3(extent, extent, trailLength) - ro) / safeDirection;
  vec3 nearHit = min(a, b), farHit = max(a, b);
  return vec2(max(max(nearHit.x, nearHit.y), nearHit.z), min(min(farHit.x, farHit.y), farHit.z));
}

float opticalDepth(vec3 ray, vec3 origin, float surfaceDistance, float side) {
  // Fixed origins and a common air-relative direction; no waves on centerlines.
  // Pick a stable basis even at 90-degree incidence in a post-stall maneuver.
  vec3 reference = abs(airflowDirection.y) > .95 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 lateral = normalize(cross(airflowDirection, reference));
  vec3 vertical = cross(lateral, airflowDirection);
  vec3 offset = cameraLocal - origin;
  vec3 ro = vec3(dot(offset, lateral), dot(offset, vertical), dot(offset, airflowDirection));
  vec3 rd = vec3(dot(ray, lateral), dot(ray, vertical), dot(ray, airflowDirection));
  float footprintBound = (length(offset) + trailLength) * pixelAngle;
  float extent = trailRadius * 3.2 + footprintBound;
  vec2 hit = intersectTrail(ro, rd, extent);
  float start = max(0.0, hit.x), end = min(surfaceDistance, hit.y);
  if (end <= start) return 0.0;
  float ds = (end - start) / 24.0;
  float optical = 0.0;
  for (int i = 0; i < 24; i++) {
    float t = start + (float(i) + .5) * ds;
    vec3 p = ro + rd * t;
    float age = clamp(p.z / trailLength, 0.0, 1.0);
    float radius = trailRadius * (.68 + .32 * age);
    float pixelWidth = max(.0001, t * pixelAngle * .5);
    float filteredRadius = sqrt(radius * radius + pixelWidth * pixelWidth);
    float radial = dot(p.xy, p.xy) / (filteredRadius * filteredRadius);
    if (radial > 9.0) continue;
    // Density moves down a straight filament. Fine eddies stay in the soft
    // sheath; the young core remains connected all the way to the wingtip.
    vec3 q = vec3(p.xy / max(.04, radius), (p.z - flowPhase) * .75);
    q.xy += side * 13.1;
    float broad = noise3(q * vec3(.28, .28, .6));
    float fine = noise3(q * vec3(1.7, 1.7, 1.1) + 8.3);
    float textureGain = mix(1.0, .72 + broad * .40 + fine * .16, min(noiseGain, 1.0));
    float core = exp(-radial * 2.0);
    float sheath = exp(-radial * .65) * .075 * (1.0 + turbulence * (fine - .5));
    float tail = 1.0 - smoothstep(.55, 1.0, age);
    float breakup = mix(1.0, smoothstep(.18, .66, broad), smoothstep(.45, 1.0, age));
    float birth = smoothstep(0.0, .10, p.z);
    float antialias = radius * radius / (filteredRadius * filteredRadius);
    optical += (core + sheath) * textureGain * tail * breakup * birth * antialias * ds;
  }
  return optical * strength * densityGain * 8.5;
}

void main() {
  vec4 base = texture2D(sceneColor, vUv);
  float depth = texture2D(sceneDepth, vUv).r;
  vec4 viewFar = inverseProjection * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 worldRay = normalize((cameraWorld * vec4(viewFar.xyz / viewFar.w, 0.0)).xyz);
  vec3 ray = normalize((worldToAircraft * vec4(worldRay, 0.0)).xyz);
  vec4 viewSurface = inverseProjection * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  float surfaceDistance = length(viewSurface.xyz / viewSurface.w);
  float optical = opticalDepth(ray, wingtipLeft, surfaceDistance, -1.0)
                + opticalDepth(ray, wingtipRight, surfaceDistance, 1.0);
  // Neutral white daylight scattering. Optical depth composes overlapping
  // volumes without additive glow or a flat, opaque ribbon.
  float forwardLight = pow(max(0.0, dot(worldRay, normalize(vec3(100.0, 600.0, 300.0)))), 6.0);
  vec3 vaporLight = vec3(2.35, 2.40, 2.45) + forwardLight * .35;
  vec4 pressure = cloudOpticalDepth(ray, surfaceDistance, forwardLight);
  float totalOptical = optical + pressure.a;
  float transmission = exp(-min(totalOptical, 12.0));
  vec3 combinedLight = (vaporLight * optical + pressure.rgb) / max(.00001, totalOptical);
  gl_FragColor = vec4(base.rgb * transmission + combinedLight * (1.0 - transmission), base.a);
  #include <tonemapping_fragment>
  #ifdef TONE_MAPPING
    if (solidBackground && depth >= .9999999) {
      gl_FragColor.rgb += (base.rgb - toneMapping(base.rgb)) * transmission;
    }
  #endif
  #include <colorspace_fragment>
}
`
