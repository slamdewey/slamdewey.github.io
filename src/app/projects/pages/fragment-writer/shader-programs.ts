export interface ShaderProgramData {
  name: string;
  url: string;
  vertexShader: string;
  fragmentShader: string;
}

export const SHADER_HEADER: string = `#version 300 es // set GLSL version\nprecision highp float;\n`;

export const DEFAULT_VERTEX_SHADER: string =
  SHADER_HEADER +
  `
in vec2 coordinates;

void main() {
  gl_Position = vec4(coordinates.xy, 0.0, 1.0);
}
`;
// string copied into actual shader code
export const UNIFORM_DEFS: string = `
// This is the data I provide all shaders with:
uniform vec2 screenSize;    // screen size in pixels
uniform vec2 mousePosition; // cursor position in pixels
uniform float totalTime;    // time since start
// this is our shader's output (pixel color):
out vec4 fragColor;
// editing code above this line could result in errors
`;
// used for context highlighting inside monaco editor
export const UNIFORM_NAMES: string[] = ['screenSize', 'mousePosition', 'totalTime'];

export const UV_SHADER: ShaderProgramData = {
  name: 'UV Coordinates',
  url: 'uv',
  vertexShader: DEFAULT_VERTEX_SHADER,
  fragmentShader: `
void main() {
\t// normalized coordinates
\tvec2 uv = gl_FragCoord.xy / screenSize.xy;
\tuv.x *= screenSize.x / screenSize.y;
\t// set output color
\tfragColor = vec4(uv.xy, 0.0, 1.0);
}`,
};
export const SHADER_TOY_UV: ShaderProgramData = {
  name: 'Shadertoy UV',
  url: 'suv',
  vertexShader: DEFAULT_VERTEX_SHADER,
  fragmentShader: `
void main() {
\tvec2 uv = gl_FragCoord.xy / screenSize.xy;
\tuv.x *= screenSize.x / screenSize.y;
\t// try tan() on this next line instead!
\tvec3 color = 0.5 + 0.5 * cos(totalTime + uv.xxy + vec3(0, 2, 4));
\tfragColor = vec4(color.xyz, 1.0);
}`,
};
export const MOUSE_POSITION_EXAMPLE: ShaderProgramData = {
  name: 'MousePosition Example',
  url: 'mouse_example',
  vertexShader: DEFAULT_VERTEX_SHADER,
  fragmentShader: `
vec2 getRelativeCoordinate(vec2 x) {
\tvec2 r = x.xy / screenSize.xy;
\tif (screenSize.x < screenSize.y) {
\t\tr.y *= screenSize.y / screenSize.x;
\t}
\telse {
\t\tr.x *= screenSize.x / screenSize.y;
\t}
\treturn r;
}

float dist(vec2 a, vec2 b) {
\treturn sqrt(pow(a.x - b.x, 2.0) + pow(a.y - b.y, 2.0));
}

void main() {
\tvec2 relativePixelPos = getRelativeCoordinate(gl_FragCoord.xy);
\tvec2 relativeMousePos = getRelativeCoordinate(mousePosition.xy);

\t// in GLSL, the bottom left is (0, 0) and top right is (1, 1)
\t// so 0.05 as a distance represents a radius of 1/20th of the screen size
\tif (dist(relativeMousePos, relativePixelPos) < 0.05) {
\t\tfragColor = vec4(0);
\t}
\telse {
\t\tfragColor = vec4(relativePixelPos.xy, 0.0, 1.0);
\t}
}`,
};
export const BASIC_NEWTONS_FRACTAL_SHADER: ShaderProgramData = {
  name: "Newton's Fractal",
  url: 'newtons_fractal_basic',
  vertexShader: DEFAULT_VERTEX_SHADER,
  fragmentShader: `
const int NUM_ITERATIONS = 20;
const vec4 RED = vec4(1.0, 0.0, 0.0, 1.0);
const vec4 GREEN = vec4(0.0, 1.0, 0.0, 1.0);
const vec4 BLUE = vec4(0.0, 0.0, 1.0, 1.0);
const vec4 BLACK = vec4(0.0, 0.0, 0.0, 1.0);

vec2 complex_mul(vec2 a, vec2 b) {
\treturn vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
vec2 complex_div(vec2 a, vec2 b) {
\tfloat den = pow(b.x, 2.0) + pow(b.y, 2.0);
\treturn vec2((a.x * b.x + a.y * b.y) / den, (a.y * b.x - a.x * b.y) / den);
}
float squared_distance(vec2 a, vec2 b) {
\treturn pow(a.x - b.x, 2.0) + pow(a.y - b.y, 2.0);
}
vec2 complex_pow(vec2 x, vec2 e) {
\tfloat r = sqrt(pow(x.x, 2.0) + pow(x.y, 2.0));
\tfloat theta = atan(x.y, x.x);
\tfloat xc = pow(r, e.x) * exp(-e.y * theta);
\tfloat yc = e.x * theta + e.y * log(r);
\treturn vec2(xc * cos(yc), xc * sin(yc));
}
vec2 f(vec2 x) {
\treturn complex_pow(x, vec2(3.0, 0.0)) - vec2(1.0, 0.0);
}
vec2 fp(vec2 x) {
\treturn complex_mul(vec2(3.0, 0.0), complex_pow(x, vec2(2.0, 0.0)));
}
vec2 newtonsMethod(vec2 x0, vec2 iterationOffset) {
\tvec2 xn = x0;
\tfor (int n = 0; n < NUM_ITERATIONS; n++) {
\t\txn = xn - complex_div(f(xn), fp(xn)) + iterationOffset;
\t}
\treturn xn;
}
void choose_color(vec2 iterated_location) {
\tfloat dist1 = squared_distance(iterated_location, vec2(-0.5, 0.866));
\tfloat dist2 = squared_distance(iterated_location, vec2(-0.5, -0.866));
\tfloat dist3 = squared_distance(iterated_location, vec2(1.0, 0.0));
\t
\tif (dist1 < dist2 && dist1 < dist3) {
\t\tfragColor = RED;
\t}
\telse if (dist2 < dist1 && dist2 < dist3) {
\t\tfragColor = GREEN;
\t}
\telse if (dist3 < dist1 && dist3 < dist2) {
\t\tfragColor = BLUE;
\t}
\telse {
\t\tfragColor = BLACK;
\t}
}

void main() {
\tvec2 relCoordinate = gl_FragCoord.xy / screenSize.xy - vec2(.5, .5);
\trelCoordinate.x *= screenSize.x / screenSize.y;
\tfloat scalar = 3.0;
\tvec2 locationInput = vec2(0.0, 0.0);
\tvec2 iterated_location = newtonsMethod(relCoordinate * scalar, locationInput);
\t
\tchoose_color(iterated_location);
}`,
};
export const ANIMATED_NEWTONS_FRACTAL_SHADER: ShaderProgramData = {
  name: "Animated Newton's Fractal Example",
  url: 'newtons_fractal_animated',
  vertexShader: DEFAULT_VERTEX_SHADER,
  fragmentShader: `
const int NUM_ITERATIONS = 20;
const vec4 RED = vec4(1.0, 0.0, 0.0, 1.0);
const vec4 GREEN = vec4(0.0, 1.0, 0.0, 1.0);
const vec4 BLUE = vec4(0.0, 0.0, 1.0, 1.0);
const vec4 BLACK = vec4(0.0, 0.0, 0.0, 1.0);

vec2 complex_mul(vec2 a, vec2 b) {
\treturn vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
vec2 complex_div(vec2 a, vec2 b) {
\tfloat den = pow(b.x, 2.0) + pow(b.y, 2.0);
\treturn vec2((a.x * b.x + a.y * b.y) / den, (a.y * b.x - a.x * b.y) / den);
}
float squared_distance(vec2 a, vec2 b) {
\treturn pow(a.x - b.x, 2.0) + pow(a.y - b.y, 2.0);
}
vec2 complex_pow(vec2 x, vec2 e) {
\tfloat r = sqrt(pow(x.x, 2.0) + pow(x.y, 2.0));
\tfloat theta = atan(x.y, x.x);
\tfloat xc = pow(r, e.x) * exp(-e.y * theta);
\tfloat yc = e.x * theta + e.y * log(r);
\treturn vec2(xc * cos(yc), xc * sin(yc));
}
vec2 f(vec2 x) {
\treturn complex_pow(x, vec2(3.0, 0.0)) - vec2(1.0, 0.0);
}
vec2 fp(vec2 x) {
\treturn complex_mul(vec2(3.0, 0.0), complex_pow(x, vec2(2.0, 0.0)));
}
vec2 newtonsMethod(vec2 x0, vec2 iterationOffset) {
\tvec2 xn = x0;
\tfor (int n = 0; n < NUM_ITERATIONS; n++) {
\t\txn = xn - complex_div(f(xn), fp(xn)) + iterationOffset;
\t}
\treturn xn;
}
void choose_color(vec2 iterated_location) {
\tfloat dist1 = squared_distance(iterated_location, vec2(-0.5, 0.866));
\tfloat dist2 = squared_distance(iterated_location, vec2(-0.5, -0.866));
\tfloat dist3 = squared_distance(iterated_location, vec2(1.0, 0.0));
\t
\tif (dist1 < dist2 && dist1 < dist3) {
\t\tfragColor = RED;
\t}
\telse if (dist2 < dist1 && dist2 < dist3) {
\t\tfragColor = GREEN;
\t}
\telse if (dist3 < dist1 && dist3 < dist2) {
\t\tfragColor = BLUE;
\t}
\telse {
\t\tfragColor = BLACK;
\t}
}

void main() {
\tvec2 relCoordinate = gl_FragCoord.xy / screenSize.xy - vec2(.5, .5);
\trelCoordinate.x *= screenSize.x / screenSize.y;
\tfloat radiusScalar = 0.35;
\tfloat timeScalar = 0.6;
\tfloat time = totalTime * timeScalar;
\t
\tfloat coordinateScalar = 2.0 * (sin(time) + 1.5);
\tvec2 locationInput = vec2(sin(time) * radiusScalar, cos(time) * radiusScalar);
\tvec2 iterated_location = newtonsMethod(relCoordinate * coordinateScalar, locationInput);
\t
\tchoose_color(iterated_location);
}`,
};
export const MOUSE_POSITION_NEWTONS_FRACTAL_SHADER: ShaderProgramData = {
  name: "MousePosition Example With Newton's Fractal",
  url: 'newtons_fractal_mouse',
  vertexShader: DEFAULT_VERTEX_SHADER,
  fragmentShader: `
const int NUM_ITERATIONS = 10;
const vec4 RED = vec4(1.0, 0.0, 0.0, 1.0);
const vec4 GREEN = vec4(0.0, 1.0, 0.0, 1.0);
const vec4 BLUE = vec4(0.0, 0.0, 1.0, 1.0);
const vec4 BLACK = vec4(0.0, 0.0, 0.0, 1.0);

vec2 complex_mul(vec2 a, vec2 b) {
\treturn vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
vec2 complex_div(vec2 a, vec2 b) {
\tfloat den = pow(b.x, 2.0) + pow(b.y, 2.0);
\treturn vec2((a.x * b.x + a.y * b.y) / den, (a.y * b.x - a.x * b.y) / den);
}
float squared_distance(vec2 a, vec2 b) {
\treturn pow(a.x - b.x, 2.0) + pow(a.y - b.y, 2.0);
}
vec2 complex_pow(vec2 x, vec2 e) {
\tfloat r = sqrt(pow(x.x, 2.0) + pow(x.y, 2.0));
\tfloat theta = atan(x.y, x.x);
\tfloat xc = pow(r, e.x) * exp(-e.y * theta);
\tfloat yc = e.x * theta + e.y * log(r);
\treturn vec2(xc * cos(yc), xc * sin(yc));
}
vec2 f(vec2 x) {
\treturn complex_pow(x, vec2(3.0, 0.0)) - vec2(1.0, 0.0);
}
vec2 fp(vec2 x) {
\treturn complex_mul(vec2(3.0, 0.0), complex_pow(x, vec2(2.0, 0.0)));
}
vec2 newtonsMethod(vec2 x0, vec2 iterationOffset) {
\tvec2 xn = x0;
\tfor (int n = 0; n < NUM_ITERATIONS; n++) {
\t\txn = xn - complex_div(f(xn), fp(xn)) + iterationOffset;
\t}
\treturn xn;
}
void choose_color(vec2 iterated_location) {
\tfloat dist1 = squared_distance(iterated_location, vec2(-0.5, 0.866));
\tfloat dist2 = squared_distance(iterated_location, vec2(-0.5, -0.866));
\tfloat dist3 = squared_distance(iterated_location, vec2(1.0, 0.0));
\t
\tif (dist1 < dist2 && dist1 < dist3) {
\t\tfragColor = RED;
\t}
\telse if (dist2 < dist1 && dist2 < dist3) {
\t\tfragColor = GREEN;
\t}
\telse if (dist3 < dist1 && dist3 < dist2) {
\t\tfragColor = BLUE;
\t}
\telse {
\t\tfragColor = BLACK;
\t}
}

vec2 getRelativeCoordinate(vec2 x) {
\tvec2 r = x.xy / screenSize.xy;
\tif (screenSize.x < screenSize.y) {
\t\tr.y *= screenSize.y / screenSize.x;
\t}
\telse {
\t\tr.x *= screenSize.x / screenSize.y;
\t}
\treturn r;
}

void main() {
\t// get relative coords with the origin moved to the center of the screen
\tvec2 relativePixelPos = getRelativeCoordinate(gl_FragCoord.xy - screenSize.xy / 2.);
\tvec2 relativeMousePos = getRelativeCoordinate(mousePosition.xy - screenSize.xy / 2.);
\t
\tfloat coordinateScalar = 2.0;
\t
\t// get origin-adjusted, screen-relative mouse pos for location input
\tvec2 locationInput = relativeMousePos;
\t// get iterated location
\tvec2 iterated_location = newtonsMethod(relativePixelPos * coordinateScalar, locationInput);
\t// color by distance to nearest sector
\tchoose_color(iterated_location);
}`,
};
export const MANDELBROT_SET_SHADER: ShaderProgramData = {
  name: 'Mandelbrot Set Shader',
  url: 'mandelbrot_zoom',
  vertexShader: DEFAULT_VERTEX_SHADER,
  fragmentShader: `
const int MAX_ITERATIONS = 500;
const int iterationCountDelta = 10;

/*
 * input = float [0, 1]
 * output = rgb color
 * this is a simple hsv to rgb function for 1 dimensional input
 */
vec3 colorWheel(float c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(vec3(c + K.x, c + K.y, c + K.z)) * 6.0 - K.www);
    return 1. * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), 1.);
}
/*
 * the mandelbrot set is the set of all complex numbers which stay bounded
 * (aka they do not fly off to infinity) as you iterate them in the
 * given function:
 * Z[n+1] = Z[n]^2 + c
 * where Z[0] = 0 + 0i
 */
vec4 mandelbrotColorizor(vec2 c, int allottedIterations) {
\t// initial Z = 0 + 0i
\tvec2 z = vec2(0, 0);
\t// iterate mandelbrot
\tfor(int i = 0; i < MAX_ITERATIONS; i++){
\t\t// allow iterations to increase over time
\t\t// (glsl does not let you write for loops with non constant iteration counts)
\t\tif (i > allottedIterations) {
\t\t\tbreak;
\t\t}
\t\t// mandelbrot:
\t\tvec2 zSquared = vec2(pow(z.x, 2.) - pow(z.y, 2.), 2. * z.x * z.y);
\t\tz = zSquared + c;
\t\tfloat l = length(z);
\t\t// check if we left the set
\t\tif(l > 2.) {
\t\t\t// pick color (we are not in the set)
\t\t\treturn vec4(colorWheel(.5 + .5 * sin(l)).xyz, 1.);
\t\t}
\t}
\t// transparent (we are in the set)
\treturn vec4(0.);
}

void main() {
\t// origin = where we are zooming into
\tvec2 origin = vec2(-.821701, .2);
\t// get a relative coordinate for this pixel with an origin in the
\t// center of the screen
\tvec2 cuv = gl_FragCoord.xy / screenSize.xy - vec2(.5, .5);
\t// calc zoom; we are just zooming in forever
\tfloat zoomScalar = min(8., (1. / pow(totalTime, 3.)));
\t// calculate this pixel's input location for mandelbrot
\tvec2 locationInput = origin + cuv * zoomScalar;
\t// increase the amount of iterations as time increases, so we can see it
\tint allottedIterations = int(float(iterationCountDelta) * totalTime);

\t// get color for this coord
\tfragColor = mandelbrotColorizor(locationInput, allottedIterations);
}

// it shows a glimpse of how the mandelbrot set is carved out
// from the infinite set of all numbers.
`,
};

export const DEFAULT_SHADER_PROGRAMS: ShaderProgramData[] = [
  UV_SHADER,
  SHADER_TOY_UV,
  MOUSE_POSITION_EXAMPLE,
  BASIC_NEWTONS_FRACTAL_SHADER,
  ANIMATED_NEWTONS_FRACTAL_SHADER,
  MOUSE_POSITION_NEWTONS_FRACTAL_SHADER,
  MANDELBROT_SET_SHADER,
];
