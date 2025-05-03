// =====================================
// Part 1: IndexedDB Asset Cache
// =====================================
const DB_NAME = 'shader-assets-db';
const DB_VERSION = 1;
const STORE_NAME = 'asset-cache';

async function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore(mode, callback) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        callback(store);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function setItem(key, value) {
    await withStore('readwrite', store => store.put(value, key));
}

async function getItem(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function delItem(key) {
    await withStore('readwrite', store => store.delete(key));
}

async function clearAll() {
    await withStore('readwrite', store => store.clear());
}

async function keys() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}


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
const maxLines = 100;
const outputMessages = [];
let currentViewIndex = 0;
let currentControlIndex = 0;
let isPaused = false;
let lastFrameTime = 0;
let effectiveTime = 0;
let shaderBuffers = [];
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

// =====================================
// Part 3: WebGL Helpers & Quad Setup
// =====================================
function createShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        logError('Shader compile error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
    }
    return s;
}

function createProgram(vsSrc, fsSrc) {
    const vs = createShader(gl.VERTEX_SHADER, vsSrc);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        logError('Program link error:', gl.getProgramInfoLog(prog));
        gl.deleteProgram(prog);
        return null;
    }
    return prog;
}

function createFramebuffer(w, h) {
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

const quadVertexShaderSource = `#version 300 es
  in vec2 a_position;
  out vec2 v_texCoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
  }
`;
const quadFragmentShaderSource = `#version 300 es
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
    gl.viewport(0, 0, width, height);
    shaderBuffers.forEach(sb => {
        const fbObjA = createFramebuffer(width, height);
        const fbObjB = createFramebuffer(width, height);

        sb.framebuffers = [fbObjA.framebuffer, fbObjB.framebuffer];
        sb.textures = [fbObjA.texture, fbObjB.texture];
    });
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

const MAX_TEXTURE_SLOTS = 4;
const defaultControlSchema = {
    controls: [
        { type: 'slider', label: 'Speed', uniform: 'u_test', default: 0.5, min: 0, max: 1, step: 0.01 },
        { type: 'slider', label: 'Num Rings', uniform: 'u_test2', default: 1.0, min: 0, max: 6, step: 0.25 }
    ]
};

function createShaderBuffer(name, vertexSrc, fragmentSrc, shaderIndex = -69) {
    const program = createProgram(vertexSrc, fragmentSrc);
    if (!program) {
        console.error("Failed to initialize shader program for", name);
        return null;
    }
    const fbObjA = createFramebuffer(canvas.width, canvas.height);
    const fbObjB = createFramebuffer(canvas.width, canvas.height);

    let sampleTextures = new Array(MAX_TEXTURE_SLOTS).fill(null);
    let sampleTextureLocations = new Array(MAX_TEXTURE_SLOTS).fill(null);
    let sampleMedia = new Array(MAX_TEXTURE_SLOTS).fill(null);
    for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
        sampleTextures[i] = gl.createTexture();
    }

    // Create persistent containers for controls and advanced media inputs
    let controlContainer = document.createElement('div');
    controlContainer.className = 'shader-control-panel';
    document.getElementById('controls-container').appendChild(controlContainer);

    let advancedInputsContainer = document.createElement('div');
    advancedInputsContainer.className = 'advanced-inputs-container';
    document.getElementById('advanced-inputs').appendChild(advancedInputsContainer);

    // Each shader now gets its own customUniforms state
    const customUniforms = {};

    const shadBuf = {
        name,
        shaderProgram: program,
        timeLocation: null,
        resolutionLocation: null,
        framebuffers: [fbObjA.framebuffer, fbObjB.framebuffer],
        textures: [fbObjA.texture, fbObjB.texture],
        currentFramebufferIndex: 0, // flip-flop this each frame
        sampleTextures,
        sampleTextureLocations,
        sampleMedia,
        controlSchema: defaultControlSchema, // default control schema
        controlContainer,
        advancedInputsContainer,
        customUniforms,
        vertexSrc,
        fragmentSrc
    };
    updateBuiltinUniformLocations(shadBuf);

    // Initialize advanced media inputs for each texture slot
    for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
        let advancedInput = createAdvancedMediaInput(shadBuf, shaderIndex, i);
        advancedInputsContainer.appendChild(advancedInput);
    }

    return shadBuf;
}

let MAX_TAB_SLOTS = 8;
function initDefaultShaderBuffers() {
    // For demonstration, create two shader buffers (tabs)
    let buffers = [];
    for (let i = 0; i < MAX_TAB_SLOTS; i++) {
        buffers.push(createShaderBuffer(`Shader ${i + 1}`, vertexShaderSource, fragmentShaderSource, i));
    }
    shaderBuffers = buffers;
    // let shader1 = createShaderBuffer("Shader 1", vertexShaderSource, fragmentShaderSource, 0);
    // let shader2 = createShaderBuffer("Shader 2", vertexShaderSource, fragmentShaderSource, 1);
    // let shader3 = createShaderBuffer("Shader 3", vertexShaderSource, fragmentShaderSource, 2);
    // let shader4 = createShaderBuffer("Shader 4", vertexShaderSource, fragmentShaderSource, 3);
    // shaderBuffers = [shader1, shader2, shader3, shader4];
}

// =====================================
// Part 8: Advanced Media Input & Loader
// =====================================
// Helper to load an image from a source URL.
function loadImageFromSource(src, shaderBuffer, slotIndex, previewContainer) {
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
    };
    img.src = src;
}

// Helper to load a video from a source URL.
function loadVideoFromSource(src, shaderBuffer, slotIndex, previewContainer) {
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
    });
    shaderBuffer.sampleMedia[slotIndex] = { type: 'video', element: video };
    previewContainer.innerHTML = '';
    previewContainer.appendChild(video);
    return video;
}

// Helper to load audio from a source URL.
function loadAudioFromSource(src, shaderBuffer, slotIndex, previewContainer) {
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
            await delItem(cacheKey);
            logMessage(`Removed cache entry ${cacheKey}`);
        } catch (err) {
            logError(`Error deleting ${cacheKey}:`, err);
        }
        shaderBuffer.sampleMedia[slotIndex] = null;
        resetMedia();
        logMessage(`Slot ${slotIndex} unassigned.`);
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
    function resetMedia() { shaderBuffer.sampleMedia[slotIndex] = null; clearPreview(); delItem(cacheKey); }

    function setupFileInput() {
        inputControlsContainer.innerHTML = '';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,video/*,audio/*';
        fileInput.addEventListener('change', async (event) => {
            resetMedia();
            const file = event.target.files[0];
            if (!file) return;
            await loadAndCacheMedia(file, shaderBuffer, slotIndex, previewContainer);
        });
        inputControlsContainer.appendChild(fileInput);
    }

    function setupUrlInput() {
        inputControlsContainer.innerHTML = '';
        const form = createUrlForm(async (url) => {
            // TODO: this causes precached URL input to break
            const descriptor = { type: "url", url };
            await setItem(cacheKey, JSON.stringify(descriptor));

            resetMedia();
            const lowerUrl = url.toLowerCase();
            await loadAndCacheMedia(lowerUrl, shaderBuffer, slotIndex, previewContainer);
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
            opt.textContent = shaderBuf.name;
            tabSelect.appendChild(opt);
        });
        tabSelect.addEventListener('change', () => {
            const idx = parseInt(tabSelect.value);
            if (isNaN(idx)) return;
            const descriptor = { type: "tab", tabIndex: idx };
            setItem(cacheKey, JSON.stringify(descriptor));

            // Store a reference to the target tab.
            shaderBuffer.sampleMedia[slotIndex] = descriptor;
            LOG(`sampling shaderBuffer ${shaderBuffer.sampleMedia[slotIndex].tabIndex}`)
            clearPreview();
            // Update preview area with simple text info.
            const info = document.createElement('div');
            // info.textContent = `Sampling from tab: ${shaderBuffers[shaderIndex].name}`;
            previewContainer.appendChild(info);
        });
        inputControlsContainer.appendChild(tabSelect);
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
    });

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
    cache = true
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
            await setItem(cacheKey, source);
        }
    }

    // 3) dispatch to the right loader
    if (blobType === 'image') {
        loadImageFromSource(url, shaderBuffer, slotIndex, previewContainer);
    }
    else if (blobType === 'video') {
        loadVideoFromSource(url, shaderBuffer, slotIndex, previewContainer);
    }
    else if (blobType === 'audio') {
        loadAudioFromSource(url, shaderBuffer, slotIndex, previewContainer);
    }
    else {
        console.warn('Unknown media type for', source);
    }
}

async function saveControlState(shaderBuffer) {
    const idx = shaderBuffers.indexOf(shaderBuffer);
    const key = `controls;${idx}`;
    await setItem(key, JSON.stringify(shaderBuffer.customUniforms));
}
async function loadControlState(shaderBuffer) {
    const idx = shaderBuffers.indexOf(shaderBuffer);
    const key = `controls;${idx}`;
    const str = await getItem(key);
    if (typeof str === 'string') {
        try {
            shaderBuffer.customUniforms = JSON.parse(str);
        } catch { }
    }
}

// =====================================
// Part 9: UI: Shader & Control Tabs + Texture Refresh
// =====================================
function updateActiveViewUI() {
    // nothing to show/hide in the DOM here (canvas is always visible),
    // but we still want to log it:
    logMessage("Viewing shader: " + shaderBuffers[currentViewIndex].name);
    // the render() function already uses currentViewIndex when blitting:
    const buttons = document.getElementById('shader-tabs').children
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
    if (schema.name) {
        const i = shaderBuffers.indexOf(shaderBuffer);
        shaderBuffer.name = `${schema.name} ${i + 1}`;
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
}

// =====================================
// Part 11: Directory Upload (JSON & Shader Files)
// =====================================
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
                // cache it under a fixed key (you could include view‑index, etc.)
                const key = `${currentViewIndex};controlSchema`;
                await setItem(key, newSchemaData);
            } catch (err) {
                logMessage("Error parsing JSON schema:", err);
            }
            attemptApply();
        };
        reader.readAsText(schemaFile);
    } else {
        attemptApply();
    }

    // 1b) Read fragment shader source
    const reader = new FileReader();
    reader.onload = async e => {
        newShaderSource = e.target.result;
        // cache the raw text
        // await setItem('fragmentSource', newShaderSource);
        const key = `${currentViewIndex};fragmentSource`;
        await setItem(key, newShaderSource);
        attemptApply();
    };
    reader.readAsText(shaderFile);

    function attemptApply() {
        if (newShaderSource == null) return;
        const active = shaderBuffers[currentViewIndex];

        // compile & swap in the new program
        const prog = createProgram(vertexShaderSource, newShaderSource);
        if (!prog) {
            logError("Failed to compile uploaded shader");
            return;
        }
        active.shaderProgram = prog;
        active.fragmentSrc = newShaderSource;
        active.vertexSrc = vertexShaderSource;
        updateBuiltinUniformLocations(active);

        // swap in the new control schema if we have it
        if (newSchemaData) {
            active.controlSchema = newSchemaData;
            renderControlsForShader(active, newSchemaData);
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
                await setItem(`config;${name};controlSchema`, JSON.parse(txt));
            } catch (e) {
                logError('bad JSON in', schemaFile.name, e);
            }
        }

        // read & cache fragment shader
        if (shaderFile) {
            const src = await shaderFile.text();
            await setItem(`config;${name};fragmentSource`, src);
        }
    }

    // save the list of names and repopulate the menu
    await setItem('configsList', JSON.stringify(names));
    populateConfigsMenu(names);
    logMessage(`✅ Cached ${names.length} configs: ${names.join(', ')}`);
}

async function loadConfigDirectory(name) {
    const active = shaderBuffers[currentViewIndex];
    const fragKey = `config;${name};fragmentSource`;
    const schemaKey = `config;${name};controlSchema`;

    const fragSrc = await getItem(fragKey);
    if (typeof fragSrc === 'string') {
        const prog = createProgram(vertexShaderSource, fragSrc);
        if (!prog) {
            logError(`Failed to compile shader from config "${name}"`);
        } else {
            active.shaderProgram = prog;
            active.fragmentSrc = fragSrc;
            active.vertexSrc = vertexShaderSource;
            const key = `${currentViewIndex};fragmentSource`;
            await setItem(key, fragSrc);
            updateBuiltinUniformLocations(active);
        }
    }

    const schema = await getItem(schemaKey);
    if (schema) {
        active.controlSchema = schema;
        const key = `${currentViewIndex};controlSchema`;
        await setItem(key, schema);
        renderControlsForShader(active, schema);
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
function updateCustomUniformLocations(shaderBuffer) {
    for (let name in shaderBuffer.customUniforms) {
        const value = shaderBuffer.customUniforms[name];
        const loc = gl.getUniformLocation(shaderBuffer.shaderProgram, name);
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
        }
    }
}

function updateBuiltinUniformLocations(shaderBuf) {
    const prog = shaderBuf.shaderProgram;
    shaderBuf.timeLocation = gl.getUniformLocation(prog, 'u_time');
    shaderBuf.resolutionLocation = gl.getUniformLocation(prog, 'u_resolution');
    for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
        shaderBuf.sampleTextureLocations[i] =
            gl.getUniformLocation(prog, `u_texture${i}`);
    }
}

// TODO: only update shaders either in use or sampled by other shaders
function updateAllShaderBuffers() {
    // Loop through each shader buffer and update its offscreen texture.
    // In reverse order so that sampled textures are (probably) updated before main shader
    for (let idx = shaderBuffers.length - 1; idx > -1; idx--) {
        const shaderBuffer = shaderBuffers[idx];

        const srcTexIndex = 1 - shaderBuffer.currentFramebufferIndex; // The one NOT being written into
        const dstFboIndex = shaderBuffer.currentFramebufferIndex;      // The one we WILL write into

        // Bind the offscreen framebuffer of the shader buffer.
        gl.bindFramebuffer(gl.FRAMEBUFFER, shaderBuffer.framebuffers[dstFboIndex]); gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Use the shader's program and update its uniforms.
        gl.useProgram(shaderBuffer.shaderProgram);
        if (shaderBuffer.timeLocation)
            gl.uniform1f(shaderBuffer.timeLocation, effectiveTime * 0.001);
        if (shaderBuffer.resolutionLocation)
            gl.uniform2f(shaderBuffer.resolutionLocation, canvas.width, canvas.height);
        updateCustomUniformLocations(shaderBuffer);

        // Bind the sample media textures.
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            if (!shaderBuffer.sampleTextures[i] || !shaderBuffer.sampleTextureLocations[i])
                continue;
            const textureLocation = shaderBuffer.sampleTextureLocations[i];
            const media = shaderBuffer.sampleMedia[i];
            const treatAsEmpty = !!media || ((media?.type == 'webcam' && media.element.readyState >= 2));
            gl.activeTexture(gl.TEXTURE2 + i);
            if (!treatAsEmpty) {
                // No media: use a fallback texture.
                gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "tab") {
                // For tab-sampled shaders, bind the target shader's offscreen texture.
                const targetShader = shaderBuffers[media.tabIndex];
                gl.bindTexture(gl.TEXTURE_2D, targetShader.textures[targetShader.currentFramebufferIndex ^ 1]);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "video" || media.type === "webcam") {
                gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
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
                gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.LUMINANCE, dataArray.length, 1, 0,
                    gl.LUMINANCE, gl.UNSIGNED_BYTE, dataArray
                );
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === "image") {
                gl.bindTexture(gl.TEXTURE_2D, shaderBuffer.sampleTextures[i]);
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

        // Draw the full-screen quad to update the offscreen texture.
        const posLoc = gl.getAttribLocation(shaderBuffer.shaderProgram, "a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        shaderBuffer.currentFramebufferIndex ^= 1;
    }
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
    const sh = shaderBuffers[currentViewIndex];
    gl.bindTexture(gl.TEXTURE_2D, sh.textures[sh.currentFramebufferIndex]);
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
        updateBuiltinUniformLocations(sb);

        await setItem(`${currentViewIndex};fragmentSource`, newSource);
        logMessage('✅ Shader updated.');
    });
}

// =====================================
// Part 14: Event Listener Setup
// =====================================
// load/render/update things when page loaded
document.addEventListener('DOMContentLoaded', async () => {
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
    const savedList = await getItem('configsList');
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
            await clearAll();
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


    for (const sb of shaderBuffers) {
        await loadControlState(sb);
    }

    shaderBuffers.forEach(shaderBuffer => {
        renderControlsForShader(shaderBuffer, shaderBuffer.controlSchema);
    });

    const allKeys = await keys();
    for (const key of allKeys) {
        if (key.match('fragmentSource') || key.match('controlSchema')) continue;

        const [sIdx, slotIdx] = key.split(';').map(Number);
        const sb = shaderBuffers[sIdx];
        if (!sb) continue;

        const cached = await getItem(key);
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
                    sb.sampleMedia[slotIdx] = obj;
                    previewContainer.textContent = `Sampling from tab: ${shaderBuffers[obj.tabIndex].name}`;

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

    for (let idx = 0; idx < shaderBuffers.length; idx++) {
        const sb = shaderBuffers[idx];
        // 1) Shader source
        const sourceKey = `${idx};fragmentSource`;
        const src = await getItem(sourceKey);
        if (typeof src === 'string') {
            const prog = createProgram(vertexShaderSource, src);
            if (prog) {
                sb.shaderProgram = prog;
                sb.fragmentSrc = src; // for debugging mostly
                sb.vertexSrc = vertexShaderSource; // for debugging mostly
                updateBuiltinUniformLocations(sb);
            }
        }

        // 2) Control schema
        const schemaKey = `${idx};controlSchema`;
        const schema = await getItem(schemaKey);
        if (schema) sb.controlSchema = schema;

        // 3) Rebuild that shader’s controls panel
        renderControlsForShader(sb, sb.controlSchema);
    }

    requestAnimationFrame(render);
});
