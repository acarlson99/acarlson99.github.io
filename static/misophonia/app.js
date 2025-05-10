// =====================================
// Part 1: IndexedDB Asset Cache
// =====================================
const DB_NAME = 'shader-assets-db';
const DB_VERSION = 1;
const STORE_NAME = 'asset-cache';

class CacheManager {
    constructor(dbName, storeName, dbVersion = 1) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.dbVersion = dbVersion;
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, this.dbVersion);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            req.onsuccess = () => {
                this.db = req.result;
                resolve(this.db);
            };
            req.onerror = () => reject(req.error);
        });
    }

    withStore(mode, callback) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, mode);
            const store = tx.objectStore(this.storeName);
            callback(store);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    get(key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readonly');
            const req = tx.objectStore(this.storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    put(key, value) { return this.withStore('readwrite', store => store.put(value, key)); }

    delete(key) { return this.withStore('readwrite', store => store.delete(key)); }

    clear() { return this.withStore('readwrite', store => store.clear()); }

    keys() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readonly');
            const req = tx.objectStore(this.storeName).getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
}

const resourceCache = new CacheManager(DB_NAME, STORE_NAME, DB_VERSION);

// =====================================
// Part 1.5: Hotkey Helpers
// =====================================

// top‑level, alongside your other globals
const hotkeyBindings = {};

// only once: listen for keydown and dispatch to whichever toggle is bound
window.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    const binding = hotkeyBindings[key];
    if (!binding) return;
    if (editorOpen) return;

    e.preventDefault();
    const { shaderBuffer, uniform, input } = binding;
    // flip the stored value
    const newVal = !shaderBuffer.customUniforms[uniform];
    shaderBuffer.customUniforms[uniform] = newVal;
    // update the UI
    input.checked = newVal;
    saveControlState(shaderBuffer);
});

// =====================================
// Part 2: Global Setup & State
// =====================================
/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('shader-canvas');
/** @type {WebGL2RenderingContext} */
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
if (!gl) alert('WebGL is not supported by your browser.');

const devMode = document.URL.startsWith('http://localhost');
const MAX_TEXTURE_SLOTS = 4;
const maxLines = 100;
const outputMessages = [];
let currentViewIndex = parseInt(localStorage.getItem('currentViewIndex') || '0');
let currentControlIndex = parseInt(localStorage.getItem('currentControlIndex') || '0');
let isPaused = false;
let lastFrameTime = 0;
let effectiveTime = 0;
let editorOpen = false; // shader editor starts closed

// Logging
const LOG = (...args) => { if (devMode) console.log(...args); };
function logMessage(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    outputMessages.push(msg);
    LOG("logMessage:", msg);
    if (outputMessages.length > maxLines) outputMessages.shift();
    const out = document.getElementById('output');
    out.textContent = outputMessages.join('\n');
    document.getElementById('output-container').scrollTop = document.getElementById('output-container').scrollHeight;
}
const logError = (...args) => { logMessage('ERROR:', ...args); LOG('ERROR:', ...args); };

// Helpers
const mix = (a, b, t) => a * (1 - t) + b * t;
const isPowerOf2 = v => (v & (v - 1)) === 0;
function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/**
 * Clamp a canvas element's CSS size while maintaining aspect ratio
 * @param {HTMLElement} canvas - The canvas element
 * @param {number} maxWidth - Max allowed CSS width
 * @param {number} maxHeight - Max allowed CSS height
 */
function clampPreviewSize(canvas, maxWidth = 300, maxHeight = 300) {
    const aspect = canvas.width / canvas.height;

    let displayWidth = maxWidth;
    let displayHeight = displayWidth / aspect;

    if (displayHeight > maxHeight) {
        displayHeight = maxHeight;
        displayWidth = displayHeight * aspect;
    }

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
}

class ShaderBuffer {
    constructor(name, program, controlSchema, shaderIndex) {
        this.name = name;
        this.gl = gl;

        this.width = canvas.width;
        this.height = canvas.height;

        // will hold [fb0, fb1] and [tex0, tex1]
        this.framebuffers = [];
        this.textures = [];
        this.currentFramebufferIndex = 0;

        this.sampleTextures = new Array(MAX_TEXTURE_SLOTS).fill(null);
        this.sampleTextureLocations = new Array(MAX_TEXTURE_SLOTS).fill(null);
        this.sampleMedia = new Array(MAX_TEXTURE_SLOTS).fill(null);
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            this.sampleTextures[i] = gl.createTexture();
        }

        /** @type {ShaderProgram} **/
        if (program) this.setProgram(program);
        console.log(`setting control schema to`, controlSchema);
        this.setControlSchema(controlSchema);

        this.controlContainer = document.createElement('div');
        this.controlContainer.className = 'shader-control-panel';
        document.getElementById('controls-container').appendChild(this.controlContainer);

        this.advancedInputsContainer = document.createElement('div');
        this.advancedInputsContainer.className = 'advanced-inputs-container';
        document.getElementById('advanced-inputs').appendChild(this.advancedInputsContainer);

        this.customUniforms = {};

        this._reallocateFramebuffersAndTextures(canvas.width, canvas.height);

        // Initialize advanced media inputs for each texture slot
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            let advancedInput = createAdvancedMediaInput(this, shaderIndex, i);
            this.advancedInputsContainer.appendChild(advancedInput);
        }
    }

    setFragmentShader(fragSrc) {
        return this.setProgram(new ShaderProgram(this.program.vsSrc, fragSrc, gl));
    }

    setProgram(p) {
        const prog = p.compile();
        if (!prog) return false;
        this.customUniforms = {}; // TODO: populate custom uniform locations here instead of within renderControls
        this.program = p;
        this.shaderProgram = prog;
        this.updateUniformLocations();
        this.updateCustomUniformValues();
        if (this.controlContainer) renderControlsForShader(this, this.controlSchema);
        return true;
    }

    setControlSchema(controlSchema) {
        this.controlSchema = controlSchema;
        if (this.controlContainer) renderControlsForShader(this, controlSchema);
        return true;
    }

    _reallocateFramebuffersAndTextures(w, h) {
        gl.viewport(0, 0, w, h);
        const fbObjA = ShaderBuffer.createGLFramebuffer(w, h);
        const fbObjB = ShaderBuffer.createGLFramebuffer(w, h);
        this.framebuffers = [fbObjA.framebuffer, fbObjB.framebuffer];
        this.textures = [fbObjA.texture, fbObjB.texture];
    }

    static createGLFramebuffer(w, h) {
        // const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) LOG('Warning: incomplete framebuffer');
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return { framebuffer: fb, texture: tex };
    }

    bindSampledTextures() {
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            if (!this.sampleTextures[i] || !this.sampleTextureLocations[i])
                continue;
            const textureLocation = this.sampleTextureLocations[i];
            const media = this.sampleMedia[i];
            const treatAsEmpty = !!media || ((media?.type == 'webcam' && media.element.readyState >= 2));
            gl.activeTexture(gl.TEXTURE2 + i);
            if (!treatAsEmpty) {
                // No media: use a fallback texture.
                gl.bindTexture(gl.TEXTURE_2D, this.sampleTextures[i]);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "tab") {
                // For tab-sampled shaders, bind the target shader's offscreen texture.
                const targetShader = shaderBuffers[media.tabIndex];
                gl.bindTexture(gl.TEXTURE_2D, targetShader.textures[targetShader?.currentFramebufferIndex ^ 1]);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "video" || media.type === "webcam") {
                gl.bindTexture(gl.TEXTURE_2D, this.sampleTextures[i]);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.element
                );
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "audio") {
                const { analyser, dataArray } = media;
                analyser.getByteFrequencyData(dataArray);
                gl.bindTexture(gl.TEXTURE_2D, this.sampleTextures[i]);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.LUMINANCE, dataArray.length, 1, 0,
                    gl.LUMINANCE, gl.UNSIGNED_BYTE, dataArray
                );
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "image") {
                gl.bindTexture(gl.TEXTURE_2D, this.sampleTextures[i]);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.element
                );
                if (isPowerOf2(media.element.width) && isPowerOf2(media.element.height)) {
                    gl.generateMipmap(gl.TEXTURE_2D);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                } else {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                }
                gl.uniform1i(textureLocation, 2 + i);
            } else {
                LOG(`WARN: uncaught shaderbuffer media.type case: ${media.type}`);
            }
        }
    }

    draw(timeMs) {
        const gl = this.gl;
        const dstIdx = this.currentFramebufferIndex;
        const srcIdx = 1 - dstIdx;

        // 1) bind our FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[dstIdx]);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 2) use our program
        gl.useProgram(this.shaderProgram);

        // 3) built-ins
        if (this.timeLocation) gl.uniform1f(this.timeLocation, timeMs * 0.001);
        if (this.resolutionLocation) gl.uniform2f(this.resolutionLocation, gl.canvas.width, gl.canvas.height);

        this.updateCustomUniformValues();

        // 4) user uniforms were already set via setUniform calls
        this.bindSampledTextures();

        // 5) draw a fullscreen quad
        const posLoc = gl.getAttribLocation(this.shaderProgram, "a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // 6) flip-flop
        this.currentFramebufferIndex = srcIdx;
    }

    updateCustomUniformValues() {
        // TODO: don't update locations every value update, that's silly
        this.updateCustomUniformLocations(Object.keys(this.customUniforms));
        for (let name in this.customUniforms) {
            const value = this.customUniforms[name];
            const loc = this.customUniformLocations[name];
            if (loc === null) continue;
            if (typeof value === 'number') {
                gl.uniform1f(loc, value);
            } else if (typeof value === 'boolean') {
                gl.uniform1i(loc, value ? 1 : 0);
            } else if (typeof value === 'object' && value && 'x' in value && 'y' in value) {
                gl.uniform2f(loc, value.x, value.y);
            } else if (typeof value === 'string') {
                if (value.startsWith('#')) {
                    const rgb = hexToRgb(value);
                    gl.uniform3f(loc, rgb[0], rgb[1], rgb[2]);
                } else {
                    gl.uniform1f(loc, parseFloat(value) || 0);
                }
            } else {
                console.warn(`uniform ${name} receiving unknown type ${typeof value} of unknown value ${value} `);
            }
        }
    }

    /** @param {[String]} names is a list of uniform names **/
    updateCustomUniformLocations(names) {
        this.customUniformLocations = {};
        names.forEach((s) => {
            const loc = this.gl.getUniformLocation(this.program.program, s);
            this.customUniformLocations[s] = loc;
        });
    }

    updateBuiltinUniformLocations() {
        if (!this.shaderProgram) return;
        this.timeLocation = gl.getUniformLocation(this.shaderProgram, 'u_time');
        this.resolutionLocation = gl.getUniformLocation(this.shaderProgram, 'u_resolution');
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            this.sampleTextureLocations[i] =
                gl.getUniformLocation(this.shaderProgram, `u_texture${i}`);
        }
    }

    updateUniformLocations() {
        this.updateBuiltinUniformLocations();
        // TODO: customUniforms is populated in renderControls-- this is codesmell
        this.updateCustomUniformLocations(Object.keys(this.customUniforms));
    }

    getOutputTexture() {
        return this.textures[this.currentFramebufferIndex];
    }
}

// =====================================
// Part 3: WebGL Helpers & Quad Setup
// =====================================
class ShaderProgram {
    constructor(vsSrc, fsSrc, gl_) {
        /** @type {WebGL2RenderingContext} */
        if (gl_) this.gl = gl_;
        else this.gl = gl;
        this.vsSrc = vsSrc;
        this.fsSrc = fsSrc;
        this.program = null;

        if (vsSrc && fsSrc) {
            this.compile();
        }
    }

    static createShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            logError('Shader compile error:', gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    };

    setFragmentShader(fsSrc) {
        return this.compile(undefined, fsSrc);
    }

    // recompile shaders
    compile(vsSrc, fsSrc) {
        if (!vsSrc) vsSrc = this.vsSrc;
        if (!fsSrc) fsSrc = this.fsSrc;
        this.vsSrc = vsSrc;
        this.fsSrc = fsSrc;
        this.vs = ShaderProgram.createShader(this.gl.VERTEX_SHADER, vsSrc);
        this.fs = ShaderProgram.createShader(this.gl.FRAGMENT_SHADER, fsSrc);
        if (!this.vs || !this.fs) return null;
        const prog = this.gl.createProgram();
        this.gl.attachShader(prog, this.vs);
        this.gl.attachShader(prog, this.fs);
        this.gl.linkProgram(prog);
        if (!this.gl.getProgramParameter(prog, this.gl.LINK_STATUS)) {
            logError('Program link error:', this.gl.getProgramInfoLog(prog));
            this.gl.deleteProgram(prog);
            return null;
        }
        this.program = prog;
        return prog;
    };

    getUniformLocation(name) {
        // TODO: cache?
        return this.gl.getUniformLocation(name);
    }

    setUniform(name, val) {
        // TODO: this
    }

    // TODO: add uniform interface functions
    // get uniform location
    // set uniform val
    //  these will be used to set texture uniforms as well
}

//                   goofy trick to preserve type information
let shaderBuffers = [new ShaderBuffer()]; shaderBuffers = [];

function createProgram(vsSrc, fsSrc) {
    return new ShaderProgram(vsSrc, fsSrc, gl).compile();
}

const quadVertexShaderSource = `#version 300 es
  in vec2 a_position;
  out vec2 v_texCoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
  }
`;
const quadFragmentShaderSource = `#version 300 es
  #ifdef GL_ES
  precision mediump float;
  #endif
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  precision mediump float;
  uniform sampler2D u_texture;
  in vec2 v_texCoord;
  out vec4 outColor;

  void main() {
    outColor = texture(u_texture, v_texCoord);
  }
`;
const quadProgram = createProgram(quadVertexShaderSource, quadFragmentShaderSource);
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

// =====================================
// Part 4: Canvas Dimension Updates
// =====================================
function updateCanvasDimensions() {
    const width = parseInt(document.getElementById('canvas-width').value, 10);
    const height = parseInt(document.getElementById('canvas-height').value, 10);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        logError(`Invalid width/height: ${width}/${height}`);
        return;
    }
    // Set the actual pixel size for WebGL rendering
    canvas.width = width;
    canvas.height = height;

    // Clamp the CSS display size
    clampPreviewSize(canvas, 1000, 1000);

    // Recreate framebuffers/textures with new dimensions
    shaderBuffers.forEach(sb => sb._reallocateFramebuffersAndTextures(width, height));
    LOG(`Canvas dimensions set to ${width}x${height}`);
}

function presetCanvasDimensions(w, h) {
    const inW = document.getElementById('canvas-width');
    const inH = document.getElementById('canvas-height');

    return function () {
        inW.value = w;
        inH.value = h;
        updateCanvasDimensions();
    };
}

// =====================================
// Part 5: Audio & Audio-Texture Helpers
// =====================================
function createAudioSource(src) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.loop = true;
    audio.src = src;
    const audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(audio);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const outputGain = audioContext.createGain();
    outputGain.gain.value = 1;
    source.connect(outputGain);
    outputGain.connect(audioContext.destination);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    return { audio, analyser, dataArray, outputGain };
}

function toggleMute(media, mute) {
    if (media.outputGain) media.outputGain.gain.value = mute ? 0 : 1;
}

// =====================================
// Part 6: Default Shader Sources
// =====================================

const vertexShaderSource = `#version 300 es
  in vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;
let fragmentShaderSource = `#version 300 es
  #ifdef GL_ES
  precision mediump float;
  #endif
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform sampler2D u_texture0;
  uniform sampler2D u_texture1;
  uniform sampler2D u_texture2;
  uniform sampler2D u_texture3;
  uniform float u_test;
  uniform float u_test2;

  out vec4 outColor;

  void main(void) {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    uv = uv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    float dist = length(uv);
    float wave = sin(dist * 10.0 * u_test2 - u_time * 3.0 * u_test);
    float intensity = smoothstep(0.3, 0.0, abs(wave));
    vec3 color = mix(vec3(0.2, 0.1, 0.5), vec3(1.0, 0.8, 0.3), intensity);
    outColor = vec4(color, 1.0);
  }
`;

// =====================================
// Part 7: ShaderBuffer Creation & Management
// =====================================

const defaultControlSchema = {
    controls: [
        { type: 'slider', label: 'Speed', uniform: 'u_test', default: 0.5, min: 0, max: 1, step: 0.01 },
        { type: 'slider', label: 'Num Rings', uniform: 'u_test2', default: 1.0, min: 0, max: 6, step: 0.25 }
    ]
};

let MAX_TAB_SLOTS = 8;
function initDefaultShaderBuffers() {
    // For demonstration, create two shader buffers (tabs)
    let buffers = [];
    for (let i = 0; i < MAX_TAB_SLOTS; i++) {
        buffers.push(new ShaderBuffer(`Shader ${i + 1}`, new ShaderProgram(vertexShaderSource, fragmentShaderSource, gl), defaultControlSchema, i));
    }
    shaderBuffers = buffers;
}

// =====================================
// Part 8: Advanced Media Input & Loader
// =====================================
// Helper to load an image from a source URL.
function loadImageFromSource(src, shaderBuffer, slotIndex, previewContainer, cb) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        logMessage(`Slot ${slotIndex} loaded (image).`);
        clampPreviewSize(img);
        shaderBuffer.sampleMedia[slotIndex] = { type: 'image', element: img };
        if (previewContainer) {
            previewContainer.innerHTML = '';
            previewContainer.appendChild(img);
        }
        if (cb) cb();
    };
    img.src = src;
}

// Helper to load a video from a source URL.
function loadVideoFromSource(src, shaderBuffer, slotIndex, previewContainer, cb) {
    const video = document.createElement('video');
    video.controls = true;
    video.setAttribute('playsinline', '');
    video.loop = true;
    video.muted = true;
    if (src) video.src = src;
    video.addEventListener('loadeddata', () => {
        // Match the shader's pause state.
        if (!isPaused) { video.play(); } else { video.pause(); }
        logMessage(`Slot ${slotIndex} loaded (video).`);
        clampPreviewSize(video);
        if (cb) cb();
    });
    shaderBuffer.sampleMedia[slotIndex] = { type: 'video', element: video };
    previewContainer.innerHTML = '';
    previewContainer.appendChild(video);
    return video;
}

// Helper to load audio from a source URL.
function loadAudioFromSource(src, shaderBuffer, slotIndex, previewContainer, cb) {
    const audioSource = createAudioSource(src);
    if (!isPaused && typeof audioSource.audio.play === 'function') {
        audioSource.audio.play();
    } else {
        audioSource.audio.pause();
    }
    shaderBuffer.sampleMedia[slotIndex] = {
        type: 'audio',
        element: audioSource.audio,
        analyser: audioSource.analyser,
        dataArray: audioSource.dataArray,
        outputGain: audioSource.outputGain
    };
    audioSource.audio.style.maxWidth = "300px";
    previewContainer.innerHTML = '';
    previewContainer.appendChild(audioSource.audio);

    // Add a mute/unmute button.
    const muteBtn = document.createElement('button');
    let muted = true;
    muteBtn.textContent = "Unmute";
    toggleMute(shaderBuffer.sampleMedia[slotIndex], muted);
    muteBtn.addEventListener('click', () => {
        muted = !muted;
        toggleMute(shaderBuffer.sampleMedia[slotIndex], muted);
        muteBtn.textContent = muted ? "Unmute" : "Mute";
        if (cb) cb();
    });
    previewContainer.appendChild(muteBtn);
}

// Helper to create a URL form that triggers on Enter.
function createUrlForm(callback) {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter media URL...';
    form.appendChild(input);
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = input.value.trim();
        if (url) {
            callback(url);
        }
    });
    return form;
}

// Main function to create the advanced media input interface.
function createAdvancedMediaInput(shaderBuffer, shaderIndex, slotIndex) {
    const cacheKey = `${shaderIndex};${slotIndex}`;
    LOG(`${cacheKey} ${shaderIndex}`);

    const container = document.createElement('div');
    container.className = 'advanced-media-input';

    const slotLabel = document.createElement('span');
    slotLabel.className = 'texture-slot-label';
    slotLabel.textContent = `Texture ${slotIndex}`;
    container.appendChild(slotLabel);

    const infoIcon = document.createElement('span');
    infoIcon.className = 'texture-slot-description';
    infoIcon.innerText = '*';
    infoIcon.title = 'help';
    infoIcon.hidden = true; // default to invisible
    container.appendChild(infoIcon);
    container.appendChild(document.createElement('br'));

    // Highlight required fields when unset
    function updateRequiredHighlight() {
        const inputTexInfo = (shaderBuffer?.controlSchema?.inputs || [])[slotIndex] || {};
        const isRequired = Boolean(inputTexInfo.required);

        if (isRequired && !shaderBuffer.sampleMedia[slotIndex]) {
            container.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
        } else {
            container.style.backgroundColor = '';
        }
    }

    const sourceSelect = document.createElement('select');
    sourceSelect.innerHTML = `
    <option value="none">None</option>
    <option value="file">File Upload</option>
    <option value="url">URL</option>
    <option value="mic">Microphone</option>
    <option value="webcam">Webcam</option>
    <option value="tab">Tab Sample</option>
    `;
    container.appendChild(sourceSelect);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
        try {
            await resourceCache.delete(cacheKey);
            logMessage(`Removed cache entry ${cacheKey}`);
        } catch (err) {
            logError(`Error deleting ${cacheKey}:`, err);
        }
        shaderBuffer.sampleMedia[slotIndex] = null;
        resetMedia();
        logMessage(`Slot ${slotIndex} unassigned.`);
        updateRequiredHighlight();
        sourceSelect.selectedIndex = 0;
        sourceSelect.dispatchEvent(new Event('change'));
    });
    container.appendChild(removeBtn);

    const inputControlsContainer = document.createElement('div');
    inputControlsContainer.className = 'media-input-controls';
    container.appendChild(inputControlsContainer);

    const previewContainer = document.createElement('div');
    previewContainer.id = `media-preview-${slotIndex}`;
    previewContainer.className = 'media-preview';
    container.appendChild(previewContainer);

    function clearPreview() { previewContainer.innerHTML = ''; }
    function resetMedia() { shaderBuffer.sampleMedia[slotIndex] = null; clearPreview(); resourceCache.delete(cacheKey); }

    function setupFileInput() {
        inputControlsContainer.innerHTML = '';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,video/*,audio/*';
        fileInput.addEventListener('change', async (event) => {
            resetMedia();
            const file = event.target.files[0];
            if (!file) return;
            await loadAndCacheMedia(file, shaderBuffer, slotIndex, previewContainer, true, updateRequiredHighlight);
        });
        inputControlsContainer.appendChild(fileInput);
    }

    function setupUrlInput() {
        inputControlsContainer.innerHTML = '';
        const form = createUrlForm(async (url) => {
            // TODO: this causes precached URL input to break
            const descriptor = { type: "url", url };
            await resourceCache.put(cacheKey, JSON.stringify(descriptor));

            resetMedia();
            const lowerUrl = url.toLowerCase();
            await loadAndCacheMedia(lowerUrl, shaderBuffer, slotIndex, previewContainer, true, updateRequiredHighlight);
        });
        inputControlsContainer.appendChild(form);
    }

    function setupMicInput() {
        inputControlsContainer.innerHTML = '';
        const micBtn = document.createElement('button');
        micBtn.textContent = 'Enable Microphone';
        micBtn.addEventListener('click', () => {
            resetMedia();
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    const audioContext = new AudioContext();
                    const source = audioContext.createMediaStreamSource(stream);
                    const analyser = audioContext.createAnalyser();
                    analyser.fftSize = 256;
                    source.connect(analyser);
                    const dataArray = new Uint8Array(analyser.frequencyBinCount);
                    shaderBuffer.sampleMedia[slotIndex] = { type: "audio", element: null, analyser, dataArray };
                    clearPreview();
                    previewContainer.innerHTML = 'Microphone Enabled';
                })
                .catch(err => { logError("Error accessing microphone:", err); });
            updateRequiredHighlight();
        });
        inputControlsContainer.appendChild(micBtn);
    }

    function setupTabSampleInput() {
        inputControlsContainer.innerHTML = '';
        const tabSelect = document.createElement('select');
        // Add a default placeholder option.
        const defaultOption = document.createElement('option');
        defaultOption.value = "";
        defaultOption.textContent = "-- Select a Shader Tab --";
        tabSelect.appendChild(defaultOption);

        // List available shader buffers.
        shaderBuffers.forEach((shaderBuf, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;  // use the tab index as the value.
            opt.textContent = shaderBuf.name; // TODO: refactor this read to update when shaderBuf.name changes
            tabSelect.appendChild(opt);
        });
        tabSelect.addEventListener('change', () => {
            const idx = parseInt(tabSelect.value);
            if (isNaN(idx)) return;
            const descriptor = { type: "tab", tabIndex: idx };
            resourceCache.put(cacheKey, JSON.stringify(descriptor));

            // Store a reference to the target tab.
            shaderBuffer.sampleMedia[slotIndex] = descriptor;
            LOG(`sampling shaderBuffer ${shaderBuffer.sampleMedia[slotIndex].tabIndex}`)
            clearPreview();
            // Update preview area with simple text info.
            const info = document.createElement('div');
            // info.textContent = `Sampling from tab: ${shaderBuffers[shaderIndex].name}`;
            previewContainer.appendChild(info);
            updateRequiredHighlight();
        });
        inputControlsContainer.appendChild(tabSelect);
        inputControlsContainer.tabSelect = tabSelect;
    }

    function setupWebcamInput() {
        inputControlsContainer.innerHTML = '';
        const camBtn = document.createElement('button');
        camBtn.textContent = 'Enable Webcam';
        camBtn.addEventListener('click', () => {
            resetMedia();
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(stream => {
                    const video = loadVideoFromSource(null, shaderBuffer, slotIndex, previewContainer);
                    shaderBuffer.sampleMedia[slotIndex] = null; // not ready yet
                    video.srcObject = stream;
                    video.autoplay = true;
                    video.setAttribute('playsinline', '');
                    video.addEventListener('loadeddata', () => {
                        function updateLoop() {
                            updateRequiredHighlight();
                            if (shaderBuffer.sampleMedia[slotIndex]?.type === 'webcam') {
                                requestAnimationFrame(updateLoop);
                            }
                        }
                        clearPreview();
                        previewContainer.appendChild(video);
                        shaderBuffer.sampleMedia[slotIndex] = { type: 'webcam', element: video }; // ready now
                        updateLoop();
                    });
                })
                .catch(err => {
                    logError("Error accessing webcam:", err);
                });
        });
        inputControlsContainer.appendChild(camBtn);
    }

    sourceSelect.addEventListener('change', () => {
        shaderBuffer.sampleMedia[slotIndex] = null;
        clearPreview();
        const val = sourceSelect.value;
        if (val === 'file') setupFileInput();
        else if (val === 'url') setupUrlInput();
        else if (val === 'mic') setupMicInput();
        else if (val === 'webcam') setupWebcamInput();
        else if (val === 'tab') setupTabSampleInput();
        else inputControlsContainer.innerHTML = '';
        updateRequiredHighlight();
    });
    container.refreshHl = () => { updateRequiredHighlight(); };
    container.setDescription = (desc) => {
        if (desc) {
            infoIcon.hidden = false;
            infoIcon.title = desc;
        } else {
            infoIcon.hidden = true;
        }
    };
    container.setInputName = (label) => { slotLabel.innerText = label; };
    container.removeTexture = () => { removeBtn.dispatchEvent(new Event('click')); };
    container.selectTab = (i) => {
        const tabIdx = 5; // index 
        sourceSelect.selectedIndex = tabIdx;
        sourceSelect.dispatchEvent(new Event('change'));
        inputControlsContainer.tabSelect.selectedIndex = i + 1;
        inputControlsContainer.tabSelect.dispatchEvent(new Event('change'));
        updateRequiredHighlight();
    }
    container.selectMediaTab = (i) => {
        sourceSelect.selectedIndex = i;
        sourceSelect.dispatchEvent(new Event('change'));
        updateRequiredHighlight();
        updateRequiredHighlight();
    }

    // Initial highlight
    updateRequiredHighlight();

    return container;
}

/**
 * Load one media asset into a shader slot, optionally caching it.
 *
 * @param {File|Blob|string} source
 *    - If string: treated as a URL (won’t be cached).  
 *    - If File/Blob: creates an ObjectURL.  
 * @param {object} shaderBuffer
 * @param {number} slotIndex
 * @param {HTMLElement} previewContainer
 * @param {boolean} [cache=true]
 */
async function loadAndCacheMedia(
    source,
    shaderBuffer,
    slotIndex,
    previewContainer,
    cache = true,
    cb = undefined
) {
    // 1) compute which shader we’re in
    const shaderIndex = shaderBuffers.indexOf(shaderBuffer);
    const cacheKey = `${shaderIndex};${slotIndex}`;
    LOG(`loadandcache ${cacheKey} ${shaderIndex}`);

    // 2) figure out URL and type
    let url, blobType;
    if (typeof source === 'string') {
        url = source;
        cache = false; // remote URLs don’t get cached
        const ext = source.split('.').pop().toLowerCase();
        blobType = ext.match(/jpe?g|png|gif/) ? 'image'
            : ext.match(/mp4|webm|ogg/) ? 'video'
                : ext.match(/mp3|wav|ogg/) ? 'audio'
                    : null;
    } else {
        // File or Blob
        url = URL.createObjectURL(source);
        blobType = source.type.startsWith('image/') ? 'image'
            : source.type.startsWith('video/') ? 'video'
                : source.type.startsWith('audio/') ? 'audio'
                    : null;

        if (cache) {
            // write into IndexedDB under our new key:
            await resourceCache.put(cacheKey, source);
        }
    }

    // 3) dispatch to the right loader
    if (blobType === 'image') {
        loadImageFromSource(url, shaderBuffer, slotIndex, previewContainer, cb);
    }
    else if (blobType === 'video') {
        loadVideoFromSource(url, shaderBuffer, slotIndex, previewContainer, cb);
    }
    else if (blobType === 'audio') {
        loadAudioFromSource(url, shaderBuffer, slotIndex, previewContainer, cb);
    }
    else {
        console.warn('Unknown media type for', source);
    }
}

async function saveControlState(shaderBuffer) {
    const idx = shaderBuffers.indexOf(shaderBuffer);
    const key = `controls;${idx}`;
    await resourceCache.put(key, JSON.stringify(shaderBuffer.customUniforms));
}
async function getControlState(shaderBuffer) {
    const idx = shaderBuffers.indexOf(shaderBuffer);
    const key = `controls;${idx}`;
    const str = await resourceCache.get(key);
    if (typeof str === 'string') {
        try {
            return JSON.parse(str);
        } catch {
            logError(`Invalid value for control state\nkey:${key}\nval: ${str}`);
            return null;
        }
    }
    return null;
}
async function loadControlState(shaderBuffer) {
    const uniforms = await getControlState(shaderBuffer);
    if (uniforms)
        shaderBuffer.customUniforms = uniforms;
}

// =====================================
// Part 9: UI: Shader & Control Tabs + Texture Refresh
// =====================================
function updateActiveViewUI() {
    // nothing to show/hide in the DOM here (canvas is always visible),
    // but we still want to log it:
    logMessage("Viewing shader: " + shaderBuffers[currentViewIndex].name);
    // the render() function already uses currentViewIndex when blitting:
    const buttons = document.getElementById('shader-tabs').children;
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('tab-active', i === currentViewIndex);
        shaderBuffers[i].shaderTab = buttons[i];
    }
}

// Shows only the control panels for the control‑shader
function updateActiveControlUI() {
    const ctrlShader = shaderBuffers[currentControlIndex];
    logMessage("Controlling shader: " + ctrlShader.name);
    document.querySelectorAll('.advanced-inputs-container').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.shader-control-panel').forEach(c => c.style.display = 'none');
    ctrlShader.advancedInputsContainer.style.display = 'block';
    ctrlShader.controlContainer.style.display = 'block';

    const buttons = document.getElementById('control-scheme-tabs').children
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('tab-active', i === currentControlIndex);
        shaderBuffers[i].controlTab = buttons[i];
    }

    updateAllShaderBuffers();
}

function createShaderTabs() {
    const tabContainer = document.getElementById('shader-tabs');
    tabContainer.innerHTML = '';
    shaderBuffers.forEach((shaderBuf, index) => {
        const tabButton = document.createElement('button');
        tabButton.textContent = shaderBuf.name;
        tabButton.addEventListener('click', () => {
            editorSEX.close();
            currentViewIndex = index;
            localStorage.setItem('currentViewIndex', currentViewIndex);
            updateActiveViewUI();
        });
        tabContainer.appendChild(tabButton);
    });
}

function createControlSchemeTabs() {
    const tabContainer = document.getElementById('control-scheme-tabs');
    tabContainer.innerHTML = '';
    shaderBuffers.forEach((shaderBuf, index) => {
        const btn = document.createElement('button');
        btn.textContent = shaderBuf.name;
        btn.addEventListener('click', () => {
            editorSEX.close();
            currentControlIndex = index;
            localStorage.setItem('currentControlIndex', currentControlIndex);
            updateActiveControlUI();
        });
        tabContainer.appendChild(btn);
    });
}

// =====================================
// Part 10: Control Panel Rendering
// =====================================
function renderControlsForShader(shaderBuffer, schema) {
    LOG(`Rendering controls for ${shaderBuffer.name}`);
    shaderBuffer.controlContainer.innerHTML = ''; // Clear previous controls
    if (shaderBuffer._autoToggleTimers) {
        shaderBuffer._autoToggleTimers.forEach(id => clearInterval(id));
    }
    shaderBuffer._autoToggleTimers = [];
    const tabIdx = shaderBuffers.indexOf(shaderBuffer);
    if (schema.name) {
        shaderBuffer.name = `${schema.name} ${tabIdx + 1}`;
        shaderBuffer.controlTab.innerText = shaderBuffer.name;
        shaderBuffer.shaderTab.innerText = shaderBuffer.name;
    }
    schema?.controls?.forEach(control => {
        const controlDiv = document.createElement('div');
        controlDiv.className = 'control';
        const label = document.createElement('label');
        label.textContent = control.label;
        controlDiv.appendChild(label);
        let inputElement;
        // Use default value from the schema (or cached value); store in the shader's custom uniforms
        const saved = shaderBuffer.customUniforms[control.uniform];
        const initialValue = (saved !== undefined) ? saved : control.default;
        LOG(shaderBuffer.customUniforms, `render control ${shaderBuffer.name} ${initialValue} ${saved} ${control.uniform} ${control.default}`);
        shaderBuffer.customUniforms[control.uniform] = initialValue;
        switch (control.type) {
            case 'knob':
            case 'slider':
                // Create the slider input
                inputElement = document.createElement('input');
                inputElement.type = 'range';
                inputElement.min = control.min;
                inputElement.max = control.max;
                inputElement.step = control.step;
                inputElement.value = initialValue;
                inputElement.setAttribute('data-uniform', control.uniform);

                // Create an info bubble for displaying the current value
                const infoBubble = document.createElement('div');
                infoBubble.className = 'slider-info-bubble';
                infoBubble.style.display = 'none';
                controlDiv.style.position = 'relative';
                controlDiv.appendChild(infoBubble);

                // Function to update bubble content and position
                function updateSliderBubble(e) {
                    const rect = inputElement.getBoundingClientRect();
                    const pct = (parseFloat(inputElement.value) - control.min) / (control.max - control.min);
                    const bubbleX = pct * rect.width;
                    infoBubble.innerText = parseFloat(inputElement.value).toFixed(control.fixedPrecision || 2);
                    infoBubble.style.left = `${bubbleX}px`;
                    infoBubble.style.top = `-1.5em`;
                }

                // Update uniform and bubble on input
                inputElement.addEventListener('input', e => {
                    const val = parseFloat(e.target.value);
                    shaderBuffer.customUniforms[control.uniform] = val;
                    updateSliderBubble(e);
                    saveControlState(shaderBuffer);
                });

                // Show bubble on interaction
                inputElement.addEventListener('mousedown', e => {
                    infoBubble.style.display = 'block';
                    updateSliderBubble(e);
                });
                document.addEventListener('mouseup', () => {
                    infoBubble.style.display = 'none';
                });
                break;
            case 'button':
                inputElement = document.createElement('button');
                inputElement.textContent = control.label;
                inputElement.addEventListener('click', () => {
                    shaderBuffer.customUniforms[control.uniform] = true;
                    LOG(`Button action for ${control.uniform} triggered.`);
                    saveControlState(shaderBuffer);
                });
                break;
            case 'toggle':
                inputElement = document.createElement('input');
                inputElement.type = 'checkbox';
                inputElement.checked = !!initialValue;
                inputElement.setAttribute('data-uniform', control.uniform);
                inputElement.addEventListener('change', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.checked;
                    saveControlState(shaderBuffer);
                });

                // when user clicks, update uniform & state as before
                inputElement.addEventListener('change', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.checked;
                    saveControlState(shaderBuffer);
                });

                // if schema defines a hotkey, register it
                if (control.hotkey) {
                    const key = control.hotkey.toLowerCase();
                    hotkeyBindings[key] = {
                        shaderBuffer,
                        uniform: control.uniform,
                        input: inputElement
                    };
                }
                break;
            case 'xy-plane':
                inputElement = document.createElement('div');
                inputElement.className = 'xy-plane';
                const grid = document.createElement('div');
                grid.className = 'xy-grid';
                inputElement.appendChild(grid);
                // Compute normalized position for the indicator
                const normX = (initialValue.x - control.min.x) / (control.max.x - control.min.x);
                const normY = (initialValue.y - control.min.y) / (control.max.y - control.min.y);
                const indicator = document.createElement('div');
                indicator.className = 'xy-indicator';
                indicator.style.left = (normX * 200) + 'px';
                indicator.style.top = ((1 - normY) * 200) + 'px';
                inputElement.appendChild(indicator);
                const minLabel = document.createElement('div');
                minLabel.className = 'xy-label xy-label-min';
                minLabel.innerText = `Min: ${control.min.x}, ${control.min.y}`;
                inputElement.appendChild(minLabel);
                const maxLabel = document.createElement('div');
                maxLabel.className = 'xy-label xy-label-max';
                maxLabel.innerText = `Max: ${control.max.x}, ${control.max.y}`;
                inputElement.appendChild(maxLabel);
                const xyInfo = document.createElement('div');
                xyInfo.className = 'xy-info-bubble';
                xyInfo.style.display = 'none';
                inputElement.appendChild(xyInfo);
                function updateXY(e) {
                    const rect = inputElement.getBoundingClientRect();
                    const rawX = e.clientX - rect.left;
                    const rawY = e.clientY - rect.top;
                    const clampedX = Math.min(Math.max(rawX, 0), rect.width);
                    const clampedY = Math.min(Math.max(rawY, 0), rect.height);
                    indicator.style.left = clampedX + 'px';
                    indicator.style.top = clampedY + 'px';
                    let x = mix(control.min.x, control.max.x, clampedX / rect.width);
                    let y = mix(control.min.y, control.max.y, 1 - (clampedY / rect.height));
                    LOG("x,y=", x, y);
                    shaderBuffer.customUniforms[control.uniform] = { x, y };
                    xyInfo.innerText = `(${x.toFixed(2)}, ${y.toFixed(2)})`;
                    xyInfo.style.left = (clampedX + 50) + 'px';
                    xyInfo.style.top = (clampedY - 25) + 'px';
                }
                inputElement.addEventListener('mousedown', e => {
                    xyInfo.style.display = 'block';
                    updateXY(e);
                    function onMouseMove(e) { updateXY(e); }
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', function onMouseUp() {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        xyInfo.style.display = 'none';
                        saveControlState(shaderBuffer);
                    });
                });
                break;
            case 'color-picker':
                inputElement = document.createElement('input');
                inputElement.type = 'color';
                inputElement.value = initialValue;
                inputElement.addEventListener('input', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.value;
                    saveControlState(shaderBuffer);
                });
                break;
            case 'dropdown':
                inputElement = document.createElement('select');
                control.options.forEach(option => {
                    const opt = document.createElement('option');
                    opt.value = option;
                    opt.textContent = option;
                    if (option === initialValue) opt.selected = true;
                    inputElement.appendChild(opt);
                });
                inputElement.addEventListener('change', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.value;
                    saveControlState(shaderBuffer);
                });
                break;
            case 'text-input':
                inputElement = document.createElement('input');
                inputElement.type = 'text';
                inputElement.value = initialValue;
                inputElement.addEventListener('input', e => {
                    shaderBuffer.customUniforms[control.uniform] = e.target.value;
                    saveControlState(shaderBuffer);
                });
                break;
            default:
                console.warn(`Unknown control type: ${control.type}`);
        }
        if (inputElement) {
            controlDiv.appendChild(inputElement);
        }
        shaderBuffer.controlContainer.appendChild(controlDiv);
    });
    // name texture slots
    for (let i = 0; i < schema.inputs?.length; i++) {
        const input = schema.inputs[i];
        const label = input.name;
        const inputController = shaderBuffer.advancedInputsContainer.children[i];
        inputController.setInputName(label);
        const desc = input.description;
        inputController.setDescription(desc);

        // only support self for now
        if (input.autoAssign == 'self') {
            inputController.selectTab(tabIdx);
        }
        inputController.refreshHl();
    }
    shaderBuffer.controlSchema = schema;
}

// =====================================
// Part 11: Directory Upload (JSON & Shader Files)
// =====================================
async function applyControlSchema(viewIndex, schema) {
    const ok = shaderBuffers[viewIndex].setControlSchema(schema);
    if (!ok) return ok;

    const key = `${viewIndex};controlSchema`;
    await resourceCache.put(key, schema);
    return true;
}
async function applyShader(viewIndex, frag, vert) {
    if (!vert) vert = vertexShaderSource; // default
    const ok = shaderBuffers[viewIndex].setProgram(new ShaderProgram(vert, frag, gl));
    if (!ok) return false;

    const key = `${currentViewIndex};fragmentSource`;
    await resourceCache.put(key, frag);
    return true;
}

function handleFolderUpload(event) {
    const files = event.target.files;
    let schemaFile = null, shaderFile = null;
    for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.json')) schemaFile = file;
        else if (name.match(/\.(glsl|frag|txt)$/)) shaderFile = file;
    }
    if (!shaderFile) {
        logMessage("No GLSL shader file found in the directory.");
        return;
    }

    let newSchemaData = null, newShaderSource = null;

    // 1a) Read JSON schema
    if (schemaFile) {
        const reader = new FileReader();
        reader.onload = async e => {
            try {
                newSchemaData = JSON.parse(e.target.result);
            } catch (err) {
                logMessage("Error parsing JSON schema:", err);
            }
            attemptApply();
        };
        reader.readAsText(schemaFile);
    }

    // 1b) Read fragment shader source
    const reader = new FileReader();
    reader.onload = async e => {
        newShaderSource = e.target.result;
        // cache the raw text
        // await resourceCache.put('fragmentSource', newShaderSource);
        const key = `${currentViewIndex};fragmentSource`;
        await resourceCache.put(key, newShaderSource);
        attemptApply();
    };
    reader.readAsText(shaderFile);

    async function attemptApply() {
        if (newShaderSource == null) return;
        const success = await applyShader(currentViewIndex, newShaderSource, vertexShaderSource);
        if (!success) return;

        // swap in the new control schema if we have it
        if (newSchemaData) {
            // renderControlsForShader(active, newSchemaData);
            applyControlSchema(currentViewIndex, newSchemaData);
        }
        logMessage("Shader & schema updated and cached!");
    }
}

// update the <select> with an array of folder names
function populateConfigsMenu(names) {
    const sel = document.getElementById('configs-menu');
    sel.innerHTML = '<option value="">— select —</option>';
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
}

// invoked when you drop a directory of sub-directories
async function handleConfigsUpload(event) {
    const files = Array.from(event.target.files);
    // group by top-level folder name (webkitRelativePath)
    LOG(`processing ${files} dir`);
    const dirs = files.reduce((acc, f) => {
        const path = f.webkitRelativePath.split('/');
        LOG(`acc ${acc} f ${f} path ${path}`);
        const top = path[1];
        (acc[top] ||= []).push(f);
        return acc;
    }, {});

    const names = Object.keys(dirs);
    for (const name of names) {
        LOG(`processing ${name}`);
        let shaderFile, schemaFile;
        for (const f of dirs[name]) {
            const low = f.name.toLowerCase();
            if (low.endsWith('.json')) schemaFile = f;
            else if (/\.(glsl|frag|txt)$/.test(low)) shaderFile = f;
        }

        // read & cache schema.json
        if (schemaFile) {
            const txt = await schemaFile.text();
            try {
                await resourceCache.put(`config;${name};controlSchema`, JSON.parse(txt));
            } catch (e) {
                logError('bad JSON in', schemaFile.name, e);
            }
        }

        // read & cache fragment shader
        if (shaderFile) {
            const src = await shaderFile.text();
            await resourceCache.put(`config;${name};fragmentSource`, src);
        }
    }

    // save the list of names and repopulate the menu
    await resourceCache.put('configsList', JSON.stringify(names));
    populateConfigsMenu(names);
    logMessage(`✅ Cached ${names.length} configs: ${names.join(', ')}`);
}

async function loadConfigDirectory(name) {
    const active = shaderBuffers[currentViewIndex];
    const fragKey = `config;${name};fragmentSource`;
    const schemaKey = `config;${name};controlSchema`;

    const fragSrc = await resourceCache.get(fragKey);
    if (typeof fragSrc === 'string') {
        const ok = applyShader(currentViewIndex, fragSrc, null);
        if (!ok) {
            logError(`❌ Failed to load ${name}`);
            return;
        }
    }

    const schema = await resourceCache.get(schemaKey);
    if (schema) {
        applyControlSchema(currentViewIndex, schema);
    }

    // rename the tab to the config name
    active.name = name;
    active.shaderTab.textContent = name;
    active.controlTab.textContent = name;
    updateActiveViewUI();

    logMessage(`✅ Loaded config "${name}" into tab ${currentViewIndex + 1}`);
}

// =====================================
// Part 12: Main Render Loop
// =====================================
// TODO: only update shaders either in use or sampled by other shaders
function updateAllShaderBuffers() {
    shaderBuffers.forEach(sb => sb.draw(effectiveTime));
}

function render(time) {
    if (lastFrameTime === 0) lastFrameTime = time;
    const delta = time - lastFrameTime;
    lastFrameTime = time;
    if (!isPaused) effectiveTime += delta;

    // --- Update All Shader Buffers ---
    // This function call makes sure that every shader’s offscreen texture is updated,
    // even if its corresponding tab is not active.
    updateAllShaderBuffers();

    // --- Final Pass: Blit the active shader's offscreen texture to the canvas ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(quadProgram);
    const quadPosLocation = gl.getAttribLocation(quadProgram, "a_position");
    gl.enableVertexAttribArray(quadPosLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(quadPosLocation, 2, gl.FLOAT, false, 0, 0);
    const quadTextureLocation = gl.getUniformLocation(quadProgram, "u_texture");
    gl.activeTexture(gl.TEXTURE0);
    // Use the currently active shader buffer’s updated offscreen texture.
    const target = shaderBuffers[currentViewIndex].getOutputTexture();
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.uniform1i(quadTextureLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}

// =====================================
// Part 13: Main Controls & Recording
// =====================================
const canvasStream = canvas.captureStream(60);
let mediaRecorder;
let recordedChunks = [];
function startRecording() {
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(canvasStream, {
        mimeType: 'video/webm',
        videoBitsPerSecond: 50_000_000
    });
    mediaRecorder.ondataavailable = event => { if (event.data.size > 0) recordedChunks.push(event.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'recording.webm';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    };
    mediaRecorder.start();
    logMessage("Recording started.");
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        logMessage("Recording stopped.");
    } else {
        logMessage("No recording active.");
    }
}

// Shader Editor State Editor muX
let editorSEX = {};
function setupShaderEditor() {
    const editBtn = document.getElementById('edit-shader-btn');
    const editShower = document.getElementById('shader-editor-hideshow');
    const editor = document.getElementById('shader-editor');
    const applyBtn = document.getElementById('apply-shader-edit');
    const cancelBtn = document.getElementById('cancel-shader-edit');

    const closeEditor = () => {
        editor.style.display = 'none';
        editorOpen = false;
    };

    const openEditor = () => {
        const textarea = document.getElementById('shader-editor-container');
        const sb = shaderBuffers[currentViewIndex];
        textarea.value = sb.fragmentSrc || '';
        editor.style.display = 'block';

        if (!editor._cmInstance) {
            editor._cmInstance = CodeMirror.fromTextArea(textarea, {
                mode: 'x-shader/x-fragment',
                lineNumbers: true,
                theme: 'default'
            });
            // Set editor size larger
            editor._cmInstance.setSize('100%', '100%');
        } else {
            editor._cmInstance.setValue(sb.fragmentSrc || '');
            editor._cmInstance.refresh();
        }
        editorOpen = true;
    };

    editorSEX.close = closeEditor;
    editorSEX.open = openEditor;

    editBtn.addEventListener('click', () => {
        if (editorOpen) closeEditor();
        else openEditor();
    });

    cancelBtn.addEventListener('click', () => {
        closeEditor();
    });

    applyBtn.addEventListener('click', async () => {
        const sb = shaderBuffers[currentViewIndex];
        //           this doesnt work V
        const newSource = editor._cmInstance.getValue() || sb.fragmentSrc;
        editor._cmInstance.refresh();

        const prog = createProgram(vertexShaderSource, newSource);
        if (!prog) {
            logMessage('❌ Shader compilation failed. See console for errors.');
            return;
        }

        // Assign the new program
        sb.shaderProgram = prog;
        sb.fragmentSrc = newSource;
        sb.updateUniformLocations();

        await resourceCache.put(`${currentViewIndex};fragmentSource`, newSource);
        logMessage('✅ Shader updated.');
    });
}

// =====================================
// Part 14: Event Listener Setup
// =====================================
// load/render/update things when page loaded
document.addEventListener('DOMContentLoaded', async () => {
    await resourceCache.init().then(() => console.log('resource cache loaded')).catch(err => { console.error('THIS SHOULD NOT HAPPEN! Failed to open cache:', err); });

    // bind buttons
    document.getElementById('update-canvas-dimensions').addEventListener('click', updateCanvasDimensions);
    presetDimensions = [
        { name: "480p", w: 640, h: 480 },
        { name: "720p", w: 1280, h: 720 },
        { name: "1080p", w: 1920, h: 1080 },
        { name: "1080p 1:1", w: 1080, h: 1080 },
        { name: "2K", w: 2048, h: 1080 },
        { name: "4K", w: 3840, h: 2160 },
        { name: "8K", w: 7680, h: 4320 },
    ];
    presetDimensions.forEach((d) => {
        const button = document.getElementById('preset-dimensions-' + d.name);
        button.addEventListener('click', presetCanvasDimensions(d.w, d.h));
    });

    document.getElementById('folder-upload').addEventListener('change', handleFolderUpload);
    document
        .getElementById('configs-upload')
        .addEventListener('change', handleConfigsUpload);

    document
        .getElementById('load-config')
        .addEventListener('click', () => {
            const name = document.getElementById('configs-menu').value;
            LOG(`load config ${name}`);
            if (name) loadConfigDirectory(name);
        });

    // on startup, populate menu from any previously saved list
    const savedList = await resourceCache.get('configsList');
    if (typeof savedList === 'string') {
        populateConfigsMenu(JSON.parse(savedList));
    }

    document.getElementById('play-pause').addEventListener('click', function () {
        isPaused = !isPaused;
        this.textContent = isPaused ? 'Play' : 'Pause';

        // For the active shader, pause/resume attached media
        const currentShader = shaderBuffers[currentViewIndex];
        currentShader.sampleMedia.forEach(media => {
            if (media && media.element) {
                if (isPaused && typeof media.element.pause === 'function') {
                    media.element.pause();
                } else if (!isPaused && typeof media.element.play === 'function') {
                    media.element.play();
                }
            }
        });
    });
    document.getElementById('restart').addEventListener('click', function () {
        effectiveTime = 0;

        // For the active shader, reset attached media
        const currentShader = shaderBuffers[currentViewIndex];
        currentShader.sampleMedia.forEach(media => {
            if (media && media.element) {
                // Reset time to zero for video/audio elements
                media.element.currentTime = 0;
                if (!isPaused && typeof media.element.play === 'function') {
                    media.element.play();
                }
            }
        });
    });
    document.getElementById('start-record').addEventListener('click', startRecording);
    document.getElementById('stop-record').addEventListener('click', stopRecording);
    document.getElementById('save-image').addEventListener('click', () => {
        isPaused = true;
        requestAnimationFrame(() => {
            gl.finish();
            const dataURL = canvas.toDataURL("image/png");
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = 'shader_snapshot.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            isPaused = false;
        });
    });

    const fsBtn = document.getElementById('fullscreen-btn');

    fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            canvas.requestFullscreen()
                .then(() => {
                })
                .catch(err => {
                    console.error(`Error attempting to enable full-screen mode: ${err.message}`);
                });
        } else {
            // exit fullscreen
            document.exitFullscreen()
                .then(() => {
                });
        }
    });

    const clearBtn = document.getElementById('clear-cache-btn');
    clearBtn.addEventListener('click', async () => {
        // 1) Nuke the whole store
        try {
            await resourceCache.clear();
            logMessage('✅ IndexedDB cache cleared.');
        } catch (err) {
            logError('❌ Failed to clear cache:', err);
        }

        // 2) Reset all in‑memory media & previews
        shaderBuffers.forEach((sb, sIdx) => {
            sb.sampleMedia = sb.sampleMedia.map(() => null);
            // clear each slot's preview container:
            const previews = sb.advancedInputsContainer.querySelectorAll('.media-preview');
            previews.forEach(p => p.innerHTML = '');
        });
    });

    // update renderers
    updateCanvasDimensions();
    initDefaultShaderBuffers();
    createShaderTabs();
    createControlSchemeTabs();
    updateActiveViewUI();
    updateActiveControlUI();

    setupShaderEditor();

    // load cached media
    const allKeys = await resourceCache.keys();
    for (const key of allKeys) {
        if (key.match('fragmentSource') || key.match('controlSchema')) continue;

        const [sIdx, slotIdx] = key.split(';').map(Number);
        const sb = shaderBuffers[sIdx];
        if (!sb) continue;

        const cached = await resourceCache.get(key);
        const previewContainer = sb
            .advancedInputsContainer
            .children[slotIdx]
            .querySelector('.media-preview');

        // 1) Blob = file upload → use loadAndCacheMedia
        if (cached instanceof Blob) {
            await loadAndCacheMedia(cached, sb, slotIdx, previewContainer, false);

            // 2) String = either JSON descriptor or URL
        } else if (typeof cached === 'string') {
            try {
                const obj = JSON.parse(cached);

                if (obj.type === 'tab') {
                    // restore tab sampling
                    sb.advancedInputsContainer.children[slotIdx].selectTab(obj.tabIndex);

                } else if (obj.type === 'url') {
                    // restore URL input
                    await loadAndCacheMedia(obj.url, sb, slotIdx, previewContainer, false);
                }

            } catch {
                // fallback: treat as a raw URL string
                await loadAndCacheMedia(cached, sb, slotIdx, previewContainer, false);
            }
        }
    }

    // load cached shaders
    for (let idx = 0; idx < shaderBuffers.length; idx++) {
        const sb = shaderBuffers[idx];
        // 1) Shader source
        const sourceKey = `${idx};fragmentSource`;
        const src = await resourceCache.get(sourceKey);
        if (typeof src === 'string') {
            if (!sb.setFragmentShader(src)) {
                logError(`Unable to set fragment shader for buffer ${idx}`);
            }
        }

        // 2) Control schema
        const schemaKey = `${idx};controlSchema`;
        const schema = await resourceCache.get(schemaKey);
        if (schema) sb.setControlSchema(schema);
    }

    shaderBuffers.forEach(shaderBuffer => {
        renderControlsForShader(shaderBuffer, shaderBuffer.controlSchema);
    });

    for (const sb of shaderBuffers) {
        await loadControlState(sb);
    }

    updateActiveViewUI();

    requestAnimationFrame(render);
});
