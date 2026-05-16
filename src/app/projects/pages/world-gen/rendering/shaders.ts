export const MAP_VERTEX_SHADER = `\
#version 300 es
precision mediump float;

in vec2 coordinates;
out vec2 vUv;

void main() {
  // Map from [-1,1] quad to [0,1] UV
  vUv = coordinates * 0.5 + 0.5;
  gl_Position = vec4(coordinates.xy, 0.0, 1.0);
}
`;

export const MAP_FRAGMENT_SHADER = `\
#version 300 es
precision mediump float;

uniform sampler2D uDataTexture;
uniform vec2 screenSize;
uniform vec2 uMapSize;
uniform float uPanOffset;

in vec2 vUv;
out vec4 fragColor;

void main() {
  // Letterbox: maintain map aspect ratio within canvas
  float mapAspect = uMapSize.x / uMapSize.y;
  float canvasAspect = screenSize.x / screenSize.y;

  vec2 uv = vUv;

  if (canvasAspect > mapAspect) {
    // Canvas is wider than map: pillarbox
    float scale = mapAspect / canvasAspect;
    uv.x = (uv.x - 0.5) / scale + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0) {
      fragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  } else {
    // Canvas is taller than map: letterbox
    float scale = canvasAspect / mapAspect;
    uv.y = (uv.y - 0.5) / scale + 0.5;
    if (uv.y < 0.0 || uv.y > 1.0) {
      fragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  // Horizontal pan (wraps seamlessly)
  uv.x = fract(uv.x + uPanOffset);

  // Flip Y for correct orientation (texture origin is bottom-left)
  uv.y = 1.0 - uv.y;

  fragColor = texture(uDataTexture, uv);
}
`;
