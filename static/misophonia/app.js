import TinySDF from 'https://cdn.skypack.dev/@mapbox/tiny-sdf';
import CacheManager from "./cashman.js"

const tinySdf = new TinySDF({
    fontSize: 24,             // Font size in pixels
    fontFamily: 'sans-serif', // CSS font-family
    fontWeight: 'normal',     // CSS font-weight
    fontStyle: 'normal',      // CSS font-style
    buffer: 3,                // Whitespace buffer around a glyph in pixels
    radius: 8,                // How many pixels around the glyph shape to use for encoding distance
    cutoff: 0.25              // How much of the radius (relative) is used for the inside part of the glyph
});

const DB_NAME = 'shader-assets-db';
const DB_VERSION = 1;
const STORE_NAME = 'asset-cache';

/**
 * @type {CacheManager}
 */
const resourceCache = new CacheManager(DB_NAME, STORE_NAME, DB_VERSION);

//#region hotkey

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
    shaderBuffer.setCustomUniform(uniform, newVal);
    // update the UI
    input.checked = newVal;
    saveControlState(shaderBuffer);
});

//#endregion

//#region setup-global-state

/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('shader-canvas');
/** @type {WebGL2RenderingContext} */
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
if (!gl) alert('WebGL is not supported by your browser.');

// variables
const devMode = document.URL.startsWith('http://localhost') || document.URL.startsWith('http://127.0.0.1');
const MAX_TEXTURE_SLOTS = 8;
const maxLines = 100;
const outputMessages = [];
let currentViewIndex = parseInt(localStorage.getItem('currentViewIndex') || '0');
let currentControlIndex = parseInt(localStorage.getItem('currentControlIndex') || '0');
let isPaused = false;
let lastFrameTime = 0;
let effectiveTime = 0;
let editorOpen = false; // shader editor starts closed

class GlyphSDF {
    /**
     * @param {WebGL2RenderingContext} gl
     * @param {TinySDF} tinySdf       // your TinySDF instance
     * @param {string} char           // single character to draw
     * @param {number} texUnit        // which texture unit to bind it to by default
     */
    constructor(gl, tinySdf, char, texUnit = 1) {
        this.gl = gl;
        this.texUnit = texUnit;

        // 1) Generate the raw SDF data
        const sdf = tinySdf.draw(char);
        this.width = sdf.width;
        this.height = sdf.height;

        // 2) Pack into RGBA so we can use a standard RGBA texture
        const N = this.width * this.height;
        const pixels = new Uint8Array(N * 4);
        for (let i = 0; i < N; i++) {
            pixels[4 * i + 0] = 255;       // R
            pixels[4 * i + 1] = 255;       // G
            pixels[4 * i + 2] = 255;       // B
            pixels[4 * i + 3] = sdf.data[i]; // A holds your alpha/distances
        }

        // 3) Create & configure the GL texture
        this.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(
            gl.TEXTURE_2D, 0,
            gl.RGBA, this.width, this.height, 0,
            gl.RGBA, gl.UNSIGNED_BYTE,
            pixels
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    delete() { gl.deleteTexture(this.tex); }

    /**
     * Call this after you’ve called gl.useProgram(program) and gotten
     * uniform locations for `u_glyph` and `u_glyphSize`.
     * 
     * @param {WebGLUniformLocation} uGlyphLoc
     * @param {WebGLUniformLocation} uSizeLoc
     */
    bind(uGlyphLoc, uSizeLoc) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + this.texUnit);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.uniform1i(uGlyphLoc, this.texUnit);
        gl.uniform2f(uSizeLoc, this.width, this.height);
    }
}

class FontAtlas {
    /**
     * @param {WebGL2RenderingContext} gl
     * @param {TinySDF} tinySdf
     * @param {string[]} chars   // e.g. Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
     * @param {number} cols      // how many columns in the atlas
     * @param {number} texUnit   // which texture unit to bind to
     */
    constructor(gl, tinySdf, chars, cols = 8, texUnit = 1) {
        this.gl = gl;
        this.texUnit = texUnit;

        // 1) render each glyph into its own SDF
        const glyphs = chars.map(ch => tinySdf.draw(ch));
        const cellW = glyphs[0].width;
        const cellH = glyphs[0].height;
        const rows = Math.ceil(chars.length / cols);

        // 2) composite into one big canvas
        const atlasW = cellW * cols;
        const atlasH = cellH * rows;
        const canvas = document.createElement("canvas");
        canvas.width = atlasW;
        canvas.height = atlasH;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(atlasW, atlasH);

        for (let i = 0; i < glyphs.length; i++) {
            const { data, width, height } = glyphs[i];
            const cx = (i % cols) * cellW;
            const cy = Math.floor(i / cols) * cellH;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const dstIdx = 4 * ((cy + y) * atlasW + (cx + x));
                    const a = data[y * width + x];
                    imgData.data[dstIdx + 0] = 255;
                    imgData.data[dstIdx + 1] = 255;
                    imgData.data[dstIdx + 2] = 255;
                    imgData.data[dstIdx + 3] = a;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // 3) upload atlas to GPU
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA,
            atlasW, atlasH, 0,
            gl.RGBA, gl.UNSIGNED_BYTE,
            canvas
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        // 4) store UV coords for each char
        this.uvs = Object.fromEntries(
            chars.map((ch, i) => {
                const col = i % cols, row = Math.floor(i / cols);
                return [ch, {
                    u0: (col * cellW) / atlasW,
                    v0: (row * cellH) / atlasH,
                    u1: ((col + 1) * cellW) / atlasW,
                    v1: ((row + 1) * cellH) / atlasH
                }];
            })
        );

        this.atlasSize = { w: atlasW, h: atlasH };
        this.cellSize = { w: cellW, h: cellH };
    }

    /**
     * @param {WebGLUniformLocation} uSamplerLoc
     * @param {number} unit             // optional override
     */
    bind(uSamplerLoc, unit = this.texUnit) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(uSamplerLoc, unit);
    }
}
// 1) pick your character set:
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
// 2) make your atlas:
const fontAtlas = new FontAtlas(gl, tinySdf, alphabet, /*cols=*/8, /*texUnit=*/1);

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

//#endregion

//#region uniforms

class Uniforms {
    constructor() {
        this.customLocations = {};
        this.sampleTextures = new Array(MAX_TEXTURE_SLOTS).fill(null);
        this.sampleTextureLocations = new Array(MAX_TEXTURE_SLOTS).fill(null);
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            this.sampleTextures[i] = gl.createTexture();
        }
    }

    /**
     * @param {Number} timeMs 
     * @param {{width:Number,height:Number}} res 
     * @param {[Media]} sampleMedia 
     */
    updateBuiltinValues(timeMs, res, sampleMedia) {
        if (this.timeLocation) gl.uniform1f(this.timeLocation, timeMs * 0.001);
        if (this.resolutionLocation) gl.uniform2f(this.resolutionLocation, res.width, res.height);
        this.bindSampledTextures(sampleMedia);
        gl.uniform2f(this.uAtlasSizeLoc, fontAtlas.atlasSize.w, fontAtlas.atlasSize.h);
        gl.uniform2f(this.uCellSizeLoc, fontAtlas.cellSize.w, fontAtlas.cellSize.h);
        fontAtlas.bind(this.uSamplerLoc);
    }

    /**
     * @param {[Media]} sampleMedia array of media
     */
    bindSampledTextures(sampleMedia) {
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            if (!this.sampleTextures[i] || !this.sampleTextureLocations[i])
                continue;
            const textureLocation = this.sampleTextureLocations[i];
            const media = sampleMedia[i];
            const isWebcam = media?.type === Media.WebcamT;
            const isWebcamReady = isWebcam && media.element.readyState >= 2;
            const treatAsEmpty = !media || (isWebcam && !isWebcamReady);
            gl.activeTexture(gl.TEXTURE2 + i);
            if (treatAsEmpty) {
                // No media: use a fallback texture.
                gl.bindTexture(gl.TEXTURE_2D, emptyTexture);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === Media.TabT) {
                // For tab-sampled shaders, bind the target shader's offscreen texture.
                const targetBuffer = shaderBuffers[media.tabIndex];
                gl.bindTexture(gl.TEXTURE_2D, targetBuffer.renderTarget.readTexture);
                gl.uniform1i(textureLocation, 2 + i);
            } else if (media.type === Media.VideoT || media.type === Media.WebcamT) {
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
            } else if (media.type === Media.AudioT) {
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
            } else if (media.type === Media.ImageT) {
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

    /**
     * 
     * @param {Object} customVals mapping of uniforms to values
     */
    updateCustomValues(customVals) {
        let errs = 0;
        for (let name in customVals) {
            const value = customVals[name];
            const loc = this.customLocations[name];
            if (loc === null) {
                console.warn(`uniform ${name} has no corresponding location`);
                errs++;
                continue;
            }
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
                console.warn(value, loc, name);
            }
        }
        return errs;
    }

    /**
     * @param {Number} timeMs
     * @param {{width:Number,height:Number}} resolution
     * @param {[Media]} media
     */
    updateValues(timeMs, resolution, customUniformValues, media) {
        let errs = 0;
        if (customUniformValues) errs = this.updateCustomValues(customUniformValues);
        this.updateBuiltinValues(timeMs, resolution, media);
        return errs;
    }

    /** @param {[String]} names is a list of uniform names **/
    updateCustomLocations(prog, names) {
        this.customLocations = {};
        names?.forEach((s) => {
            const loc = gl.getUniformLocation(prog, s);
            this.customLocations[s] = loc;
        });
    }

    updateBuiltinLocations(prog) {
        if (!prog) return;
        this.timeLocation = gl.getUniformLocation(prog, 'u_time');
        this.resolutionLocation = gl.getUniformLocation(prog, 'u_resolution');
        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            this.sampleTextureLocations[i] =
                gl.getUniformLocation(prog, `u_texture${i}`);
        }

        this.uSamplerLoc = gl.getUniformLocation(prog, "u_fontAtlas");
        this.uAtlasSizeLoc = gl.getUniformLocation(prog, "u_atlasSize");
        this.uCellSizeLoc = gl.getUniformLocation(prog, "u_cellSize");
    }

    updateLocations(prog, customNames) {
        gl.useProgram(prog);
        this.updateBuiltinLocations(prog);
        this.updateCustomLocations(prog, customNames);
        gl.useProgram(null);
    }
}

//#endregion

//#region media

class Media {
    constructor(type, params) {
        this.type = type;
        Object.assign(this, params);
    }

    static ImageT = "Image";
    static VideoT = "Video";
    static TabT = "Tab";
    static AudioT = "Audio";
    static MicrophoneT = "Microphone";
    static WebcamT = "Webcam";
    static URLT = "URL"; // TODO: this one should go-- media types should be concrete, and URLs are inferred to another type

    static Image(src, cb) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        let o = new Media(Media.ImageT, { element: img });
        img.onload = () => {
            clampPreviewSize(img);
            if (cb) cb(o);
        };
        img.src = src;
        return o;
    }

    static Video(src, cb) {
        const video = document.createElement('video');
        video.controls = true;
        video.setAttribute('playsinline', '');
        video.loop = true;
        video.muted = true;
        if (src) video.src = src;
        const o = new Media(Media.VideoT, { element: video });
        video.addEventListener('loadeddata', () => {
            // Match the shader's pause state.
            if (!isPaused) { video.play(); } else { video.pause(); }
            // logMessage(`Slot ${slotIndex} loaded (video).`);
            clampPreviewSize(video);
            if (cb) cb(o);
        });
        return o;
    }

    static Tab(idx) {
        return new Media(Media.TabT, { tabIndex: idx });
    }

    static Audio(src, cb) {
        const audioSource = Media.createAudioSource(src);
        if (!isPaused && typeof audioSource.audio.play === 'function') {
            audioSource.audio.play();
        } else {
            audioSource.audio.pause();
        }
        audioSource.audio.style.maxWidth = "300px";

        const muteBtn = document.createElement('button');
        const el = document.createElement('div');
        const o = new Media(Media.AudioT,
            {
                element: el,
                audio: audioSource.audio,
                analyser: audioSource.analyser,
                dataArray: audioSource.dataArray,
                outputGain: audioSource.outputGain,
                muteBtn: muteBtn
            });

        let muted = true;
        muteBtn.textContent = "Unmute";
        Media.toggleMute(o, muted);
        muteBtn.addEventListener('click', () => {
            muted = !muted;
            Media.toggleMute(o, muted);
            muteBtn.textContent = muted ? "Unmute" : "Mute";
            if (cb) cb(o);
        });
        el.appendChild(audioSource.audio);
        el.appendChild(muteBtn);
        return o;
    }

    static createAudioSource(src) {
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

    static toggleMute(media, mute) {
        if (media.outputGain) media.outputGain.gain.value = mute ? 0 : 1;
    }

    static async Microphone(cb) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            source.connect(analyser);
            const o = new Media(Media.AudioT, { element: null, analyser, dataArray, outputGain: null });
            if (cb) cb(o);
            return o;
        } catch (err) {
            return logError("Error accessing microphone:", err);
        }
    }

    static async Webcam(cb) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const o = Media.Video(null, cb);
            o.type = Media.WebcamT;
            const video = o.element;
            video.srcObject = stream;
            video.autoplay = true;

            return o;
        } catch (err) {
            return logError("Error accessing webcam:", err);
        }
    }

    static async ScreenCapture(cb) {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const o = Media.Video(null, cb);
            const video = o.element;
            video.srcObject = stream;
            video.autoplay = true;

            return o;
        } catch (err) {
            return logError("Error accessing screen capture:", err);
        }
    }

    static FromSource(source, cb = undefined) {
        let { type, url } = Media.inferMediaType(source);
        let o;
        if (type === Media.ImageT) {
            o = Media.Image(url, cb);
        }
        else if (type === Media.VideoT) {
            o = Media.Video(url, cb);
        }
        else if (type === Media.AudioT) {
            o = Media.Audio(url, cb);
        }
        else {
            console.warn('Unknown media type for', source);
            return;
        }
        return o;
    }

    /**
     * @param {any} source
     * @returns {type: String, url: string}
     */
    static inferMediaType(source) {
        let url, blobType;
        if (typeof source === 'string') {
            url = source;
            const ext = source.split('.').pop().toLowerCase();
            blobType = ext.match(/jpe?g|png|gif/) ? Media.ImageT
                : ext.match(/mp4|webm|ogg/) ? Media.VideoT
                    : ext.match(/mp3|wav|ogg/) ? Media.AudioT
                        : null;
        } else {
            // File or Blob
            url = URL.createObjectURL(source);
            blobType = source.type.startsWith('image/') ? Media.ImageT
                : source.type.startsWith('video/') ? Media.VideoT
                    : source.type.startsWith('audio/') ? Media.AudioT
                        : null;
        }
        return { type: blobType, url: url };
    }

    // static fromUrl(url, cb) {
    //     const ext = url.split(".").pop().toLowerCase();
    //     if (ext.match(/jpe?g|png|gif/)) return Media.Image(url, cb);
    //     if (ext.match(/mp4|webm|ogg/)) return Media.Video(url, cb);
    //     if (ext.match(/mp3|wav|ogg/)) return Media.Audio(url, cb);
    //     throw new Error("Unknown URL media type");
    // }
}

//#region url

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

//#endregion

//#region input

class MediaInput {
    // handles media UI
    constructor(shaderBuffer, shaderIndex, slotIndex) {
        this.shaderBuffer = shaderBuffer;
        this.shaderIndex = shaderIndex;
        this.slotIndex = slotIndex;
        this.cacheKey = `${shaderIndex};${slotIndex}`;
        this.container = document.createElement('div');
        this.container.className = 'advanced-media-input';

        this.buildUI();
        this.updateRequiredHighlight();
    }

    buildUI() {
        const { slotIndex } = this;

        this.slotLabel = document.createElement('span');
        this.slotLabel.className = 'texture-slot-label';
        this.slotLabel.textContent = `Texture ${slotIndex}`;

        this.infoIcon = document.createElement('span');
        this.infoIcon.className = 'texture-slot-description';
        this.infoIcon.innerText = '*';
        this.infoIcon.title = 'help';
        this.infoIcon.hidden = true;

        this.container.append(this.slotLabel, this.infoIcon, document.createElement('br'));

        this.sourceSelect = document.createElement('select');
        this.sourceSelect.innerHTML = `
            <option value="none">None</option>
            <option value="file">File Upload</option>
            <option value="url">URL</option>
            <option value="mic">Microphone</option>
            <option value="webcam">Webcam</option>
            <option value="tab">Tab Sample</option>
            <option value="screencap">Screen Share</option>
        `;
        this.sourceSelect.addEventListener('change', () => this.handleSourceChange());
        this.container.appendChild(this.sourceSelect);

        this.removeBtn = document.createElement('button');
        this.removeBtn.textContent = 'Remove';
        this.removeBtn.addEventListener('click', () => this.removeTexture());
        this.container.appendChild(this.removeBtn);

        this.inputControlsContainer = document.createElement('div');
        this.inputControlsContainer.className = 'media-input-controls';
        this.container.appendChild(this.inputControlsContainer);

        this.previewContainer = document.createElement('div');
        this.previewContainer.id = `media-preview-${slotIndex}`;
        this.previewContainer.className = 'media-preview';
        this.container.appendChild(this.previewContainer);
    }

    updateRequiredHighlight() {
        const inputTexInfo = (this.shaderBuffer?.controlSchema?.inputs || [])[this.slotIndex] || {};
        const isRequired = Boolean(inputTexInfo.required);
        this.container.style.backgroundColor = isRequired && !this.hasMedia() ? 'rgba(255, 0, 0, 0.2)' : '';
    }

    clearPreview() {
        this.previewContainer.innerHTML = '';
    }

    resetMedia() {
        this.setMedia(null);
        this.clearPreview();
        resourceCache.deleteMedia(this.shaderIndex, this.slotIndex);
    }

    handleSourceChange() {
        this.setMedia(null);
        this.clearPreview();
        const val = this.sourceSelect.value;
        if (val === 'file') this.setupFileInput();
        else if (val === 'url') this.setupUrlInput();
        else if (val === 'mic') this.setupMicInput();
        else if (val === 'webcam') this.setupWebcamInput();
        else if (val === 'tab') this.setupTabSampleInput();
        else if (val === 'screencap') this.setupScreenCaptureInput();
        else {
            this.inputControlsContainer.innerHTML = '';
            this.setMedia(null);
        }
        this.updateRequiredHighlight();
    }

    async removeTexture() {
        try {
            await resourceCache.deleteMedia(this.shaderIndex, this.slotIndex);
            logMessage(`Removed cache entry ${resourceCache.mediaKey(this.shaderIndex, this.slotIndex)}`);
        } catch (err) {
            logError(`Error deleting ${resourceCache.mediaKey(this.shaderIndex, this.slotIndex)}:`, err);
        }
        this.setMedia(null);
        this.resetMedia();
        logMessage(`Slot ${this.slotIndex} unassigned.`);
        this.sourceSelect.selectedIndex = 0;
        this.sourceSelect.dispatchEvent(new Event('change'));
    }

    setupFileInput() {
        this.inputControlsContainer.innerHTML = '';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,video/*,audio/*';
        fileInput.addEventListener('change', async (event) => {
            this.resetMedia();
            const file = event.target.files[0];
            if (!file) return;
            this.loadAndCache(file, true, () => this.updateRequiredHighlight());
        });
        this.inputControlsContainer.appendChild(fileInput);
    }

    setupUrlInput() {
        this.inputControlsContainer.innerHTML = '';
        const form = createUrlForm(async (url) => {
            // TODO: this should create a media object with a specific type
            const descriptor = new Media(Media.URLT, { url });
            await resourceCache.putMedia(this.shaderIndex, this.slotIndex, JSON.stringify(descriptor));
            this.resetMedia();
            this.loadAndCache(url.toLowerCase(), true, () => this.updateRequiredHighlight());
        });
        this.inputControlsContainer.appendChild(form);
    }

    setupMicInput() {
        this.inputControlsContainer.innerHTML = '';
        const micBtn = document.createElement('button');
        micBtn.textContent = 'Enable Microphone';
        micBtn.addEventListener('click', async () => {
            this.resetMedia();
            const o = await Media.Microphone();
            this.setMedia(o);
            this.clearPreview();
            this.previewContainer.innerHTML = 'Microphone Enabled';
            this.updateRequiredHighlight();
        });
        this.inputControlsContainer.appendChild(micBtn);
    }

    setupTabSampleInput() {
        this.inputControlsContainer.innerHTML = '';
        const tabSelect = document.createElement('select');
        const defaultOption = document.createElement('option');
        defaultOption.value = "";
        defaultOption.textContent = "-- Select a Shader Tab --";
        tabSelect.appendChild(defaultOption);

        let opts = [];
        const refreshOptsNames = () => {
            for (let i = 0; i < opts.length; i++) {
                opts[i].textContent = shaderBuffers[i].name;
            }
        }
        shaderBuffers.forEach((shaderBuf, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = shaderBuf.name;
            tabSelect.appendChild(opt);
            opts.push(opt);
        });

        tabSelect.addEventListener('change', () => {
            const idx = parseInt(tabSelect.value);
            if (isNaN(idx)) return;
            const descriptor = new Media(Media.TabT, { tabIndex: idx });
            resourceCache.putMedia(this.shaderIndex, this.slotIndex, JSON.stringify(descriptor));
            this.setMedia(descriptor);
            this.clearPreview();
            const info = document.createElement('div');
            this.previewContainer.appendChild(info);
            refreshOptsNames();
            this.updateRequiredHighlight();
        });
        tabSelect.addEventListener('click', () => {
            refreshOptsNames();
            this.updateRequiredHighlight()
        });

        this.inputControlsContainer.appendChild(tabSelect);
        this.inputControlsContainer.tabSelect = tabSelect;
    }

    setupWebcamInput() {
        this.inputControlsContainer.innerHTML = '';
        const camBtn = document.createElement('button');
        camBtn.textContent = 'Enable Webcam';
        camBtn.addEventListener('click', async () => {
            this.resetMedia();
            let o = await Media.Webcam();
            // TODO: find another way to bind this callback
            o.element.addEventListener('loadeddata', () => {
                const updateLoop = () => {
                    this.updateRequiredHighlight();
                    // TODO: refactor
                    if (this.shaderBuffer.sampleMedia[this.slotIndex]?.type === Media.WebcamT) {
                        requestAnimationFrame(updateLoop);
                    }
                };
                this.clearPreview();
                this.previewContainer.appendChild(o.element);
                this.setMedia(o);
                updateLoop();
            });
            this.setMedia(o);
            this.bindPreview(o.element);
        });
        this.inputControlsContainer.appendChild(camBtn);
    }

    setupScreenCaptureInput() {
        this.inputControlsContainer.innerHTML = '';
        const capBtn = document.createElement('button');
        capBtn.textContent = 'Enable Screen Capture';
        capBtn.addEventListener('click', async () => {
            this.resetMedia();
            let o = await Media.ScreenCapture();
            if (!o) return;
            o.element.addEventListener('loadeddata', () => {
                const updateLoop = () => {
                    this.updateRequiredHighlight();
                    if (this.shaderBuffer.sampleMedia[this.slotIndex]?.type === Media.VideoT) {
                        requestAnimationFrame(updateLoop);
                    }
                };
                this.clearPreview();
                this.previewContainer.appendChild(o.element);
                this.setMedia(o);
                updateLoop();
            });
            this.setMedia(o);
            this.bindPreview(o.element);
        });
        this.inputControlsContainer.appendChild(capBtn);
    }


    setMedia(desc) {
        this.shaderBuffer.setMediaSlot(this.slotIndex, desc);
    }
    hasMedia() { return !!this.shaderBuffer.sampleMedia[this.slotIndex]; }

    setDescription(desc) {
        if (desc) {
            this.infoIcon.hidden = false;
            this.infoIcon.title = desc;
        } else {
            this.infoIcon.hidden = true;
        }
    }

    setInputName(label) {
        this.slotLabel.innerText = label;
    }

    // select `Tab Sample -> i`
    selectTab(i) {
        this.sourceSelect.selectedIndex = 5;
        this.sourceSelect.dispatchEvent(new Event('change'));
        this.inputControlsContainer.tabSelect.selectedIndex = i + 1;
        this.inputControlsContainer.tabSelect.dispatchEvent(new Event('change'));
        this.updateRequiredHighlight();
    }

    selectMediaTab(i) {
        this.sourceSelect.selectedIndex = i;
        this.sourceSelect.dispatchEvent(new Event('change'));
        this.updateRequiredHighlight();
    }

    getElement() {
        return this.container;
    }

    loadAndCache(source, cache = true, cb = undefined) {
        if (cache) resourceCache.putMedia(this.shaderIndex, this.slotIndex, source);

        let o = Media.FromSource(source, cb);
        this.shaderBuffer.setMediaSlot(this.slotIndex, o);
        this.bindPreview(o.element);
    }

    bindPreview(e) {
        this.previewContainer.innerHTML = '';
        this.previewContainer.appendChild(e);
    }
}

//#endregion

//#endregion

//#region shader-buffer

class RenderTarget {
    /**
     * @param {number} width 
     * @param {number} height 
     */
    constructor(width, height) {
        this.width = width;
        this.height = height;

        this.curIndex = 0; // 0 or 1
        this.framebuffers = [null, null];
        this.textures = [null, null];
        this._allocate(width, height);
    }

    _allocate(w, h) {
        for (let i = 0; i < 2; i++) {
            if (this.framebuffers[i]) {
                gl.deleteFramebuffer(this.framebuffers[i]);
                gl.deleteTexture(this.textures[i]);
            }
        }
        this.framebuffers = [];
        this.textures = [];

        for (let i = 0; i < 2; i++) {
            // Create and configure a texture
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

            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                console.warn('RenderTarget: incomplete framebuffer');
            }

            this.textures.push(tex);
            this.framebuffers.push(fb);
        }

        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this.width = w;
        this.height = h;
        this.curIndex = 0;
    }

    reallocate() {
        this._allocate(this.width, this.height);
    }

    resize(w, h) {
        if (w === this.width && h === this.height) return;
        this._allocate(w, h);
    }

    /**
     * @returns {WebGLTexture}
     */
    get writeFramebuffer() {
        return this.framebuffers[this.curIndex];
    }
    /**
     * @returns {WebGLTexture}
     */
    get readTexture() {
        return this.textures[this.curIndex ^ 1];
    }

    swap() {
        this.curIndex ^= 1;
    }
}

class ShaderBuffer {
    /**
     * @param {String} name
     * @param {ShaderProgram} program
     */
    constructor(name, program, controlSchema, shaderIndex) {
        this.name = name;
        this.gl = gl;

        if (!gl) {
            console.warn('warning-- creating a ShaderBuffer with no active GL context');
            return;
        }

        this.width = canvas.width;
        this.height = canvas.height;

        this.renderTarget = new RenderTarget(this.width, this.height);

        this.uniforms = new Uniforms();

        // TODO: instead of assigning media to sampleMedia slots this should provide a way to easily assign media
        this.sampleMedia = new Array(MAX_TEXTURE_SLOTS).fill(null);
        this.customUniforms = {};
        this.clearCustomUniforms();

        console.log(`setting control schema to`, controlSchema);
        this.setControlSchema(controlSchema);
        if (program) this.setProgram(program);

        this.controlContainer = document.createElement('div');
        this.controlContainer.className = 'shader-control-panel';
        document.getElementById('controls-container').appendChild(this.controlContainer);

        this.advancedInputsContainer = document.createElement('div');
        this.advancedInputsContainer.className = 'advanced-inputs-container';
        document.getElementById('advanced-inputs').appendChild(this.advancedInputsContainer);

        // Initialize advanced media inputs for each texture slot
        this.mediaInputs = [];
        this.shaderIndex = shaderIndex;

        if (this.program) this.updateUniformLocations();
    }

    restart() {
        this.sampleMedia.forEach(media => {
            if (media && media.element) {
                // Reset time to zero for video/audio elements
                media.element.currentTime = 0;
                if (!isPaused && typeof media.element.play === 'function') {
                    media.element.play();
                }
            }
        });
        this.renderTarget.reallocate();
    }

    restoreDefaults() {
        this.setControlSchema(defaultControlSchema);

        const defaultProgram = new ShaderProgram(vertexShaderSource, fragmentShaderSource, gl);
        this.setProgram(defaultProgram);

        this.sampleMedia.fill(null);
        this.mediaInputs.forEach((input) => input?.resetMedia?.());
        renderControlsForShader(this, this.controlSchema);

        const shaderIndex = shaderBuffers.indexOf(this);
        resourceCache.deleteFragmentSrc(shaderIndex);
        resourceCache.deleteControlSchema(shaderIndex);
        resourceCache.deleteControlState(shaderIndex);

        for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
            resourceCache.deleteMedia(shaderIndex, i);
        }

        logMessage(`Shader "${this.name}" reset to default.`);
    }

    setName(s) {
        this.name = s;
        this.shaderTab.textContent = s;
        this.controlTab.textContent = s;
    }

    setFragmentShader(fragSrc) {
        return this.setProgram(new ShaderProgram(this.program.vsSrc, fragSrc, gl));
    }

    /** @param {ShaderProgram} p */
    setProgram(p) {
        const prog = p.compile();
        if (!prog) {
            logError(`Error setting buffer ${this.name}`);
            return false;
        }
        this.clearCustomUniforms();
        this.program = p;
        this.shaderProgram = prog;
        this.updateUniformLocations();
        if (this.controlContainer) renderControlsForShader(this, this.controlSchema);
        return true;
    }

    setMediaSlot(idx, desc) {
        this.sampleMedia[idx] = desc;
    }

    updateUniformLocations() {
        const us = this.controlSchema?.controls?.map((o) => o.uniform);
        this.uniforms.updateLocations(this.program.program, us);
    }

    setCustomUniform(k, v) {
        this.customUniforms[k] = v;
    }

    clearCustomUniforms() {
        this.customUniforms = {};
    }

    // TODO: this logic should move outside of this class
    setControlSchema(controlSchema) {
        this.controlSchema = controlSchema;

        // Clear and rebuild advanced inputs
        this.mediaInputs = [];
        if (this.advancedInputsContainer) this.advancedInputsContainer.innerHTML = '';

        if (controlSchema?.inputs?.length) {
            for (let i = 0; i < controlSchema.inputs.length; i++) {
                const mediaInput = new MediaInput(this, this.shaderIndex, i);
                this.mediaInputs.push(mediaInput);
                if (this.advancedInputsContainer) this.advancedInputsContainer.appendChild(mediaInput.getElement());
            }
        }

        // Clear old controls
        if (this.controlContainer) {
            renderControlsForShader(this, controlSchema);
        }
        return true;
    }

    draw(timeMs) {
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.renderTarget.writeFramebuffer);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program.program);

        let errs = this.uniforms.updateValues(
            timeMs,
            { width: gl.canvas.width, height: gl.canvas.height },
            this.customUniforms,
            this.sampleMedia
        );
        if (errs) console.warn(`errors encountered updating uniforms for buffer ${this.name}`);

        this.program.drawToPosition(quadBuffer);

        this.renderTarget.swap();
    }
}

//#endregion

//#region shader-program

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

    static samplerString = new Array(MAX_TEXTURE_SLOTS).fill(null);

    static fragmentShaderSourcePre = `#version 300 es
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

${new Array(MAX_TEXTURE_SLOTS).fill(null).map((_, i) => `uniform sampler2D u_texture${i};\n#define iChannel${i} u_texture${i}\n`).join('')}

#define iTime u_time
#define iResolution u_resolution

uniform sampler2D u_fontAtlas;
uniform vec2      u_atlasSize;   // px width/height of the entire atlas
uniform vec2      u_cellSize;    // px width/height of one glyph cell

out vec4 fragColor;
`;
    static fragmentShaderSourcePost = `
void main(void) {
    mainImage(fragColor, gl_FragCoord.xy);
}
`;

    static createShader(type, src) {
        const s = gl.createShader(type);
        if (type === gl.FRAGMENT_SHADER) src = ShaderProgram.fragmentShaderSourcePre + src + ShaderProgram.fragmentShaderSourcePost;
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

        if (this.vs) gl.deleteShader(this.vs);
        if (this.fs) gl.deleteShader(this.fs);
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
        if (this.program) gl.deleteProgram(this.program);
        this.program = prog;
        return prog;
    };

    drawToPosition(posBuf) {
        gl.useProgram(this.program);
        const posLoc = gl.getAttribLocation(this.program, "a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}

//#endregion

//#region shader-buffer-and-quad-setup

//                   goofy trick to preserve type information
let shaderBuffers = [new ShaderBuffer()]; shaderBuffers = [];
document.shaderBuffers = () => shaderBuffers;

function createProgram(vsSrc, fsSrc) {
    return new ShaderProgram(vsSrc, fsSrc, gl).compile();
}

const quadVertexShaderSource = `#version 300 es
  in vec2 a_position;
  out vec2 fragCoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    fragCoord = a_position * 0.5 + 0.5;
  }
`;
const quadFragmentShaderSource = `
  uniform sampler2D u_texture;
  in vec2 fragCoord;

  void mainImage( out vec4 fragColor, in vec2 fc ) {
    fragColor = texture(u_texture, fragCoord);
  }
`;
const quadProgram = createProgram(quadVertexShaderSource, quadFragmentShaderSource);
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
const emptyTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, emptyTexture);
gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0])
);

const vertexShaderSource = `#version 300 es
  in vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;
let fragmentShaderSource = `
  uniform float u_test;
  uniform float u_test2;

  void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    vec2 uv = fragCoord.xy / u_resolution;
    uv = uv - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    float dist = length(uv);
    float wave = sin(dist * 10.0 * u_test2 - u_time * 3.0 * u_test);
    float intensity = smoothstep(0.3, 0.0, abs(wave));
    vec3 color = mix(vec3(0.2, 0.1, 0.5), vec3(1.0, 0.8, 0.3), intensity);
    fragColor = vec4(color, 1.0);
  }
`;

const defaultControlSchema = {
    controls: [
        { type: 'slider', label: 'Speed', uniform: 'u_test', default: 0.5, min: 0, max: 1, step: 0.01 },
        { type: 'slider', label: 'Num Rings', uniform: 'u_test2', default: 1.0, min: 0, max: 6, step: 0.25 }
    ]
};

let MAX_TAB_SLOTS = 8;
function initDefaultShaderBuffers() {
    let buffers = [];
    for (let i = 0; i < MAX_TAB_SLOTS; i++) {
        buffers.push(new ShaderBuffer(`Shader ${i + 1}`, new ShaderProgram(vertexShaderSource, fragmentShaderSource, gl), defaultControlSchema, i));
    }
    shaderBuffers = buffers;
}

//#endregion

//#region canvas-source-helpers

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

    shaderBuffers.forEach(sb => sb.renderTarget.resize(width, height));
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

//#endregion

//#region state management

async function saveControlState(shaderBuffer) {
    const idx = shaderBuffers.indexOf(shaderBuffer);
    await resourceCache.putControlState(idx, JSON.stringify(shaderBuffer.customUniforms));
}
async function getControlState(shaderBuffer) {
    const idx = shaderBuffers.indexOf(shaderBuffer);
    const str = await resourceCache.getControlState(idx);
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
async function loadControlState(shaderBuffer, uniforms = null) {
    if (uniforms === null) uniforms = await getControlState(shaderBuffer);
    if (uniforms)
        shaderBuffer.customUniforms = uniforms;
}

//#endregion

//#region UI

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

//#region render-controls

// TODO: create `Controller` object
function renderControlsForShader(shaderBuffer, schema) {
    LOG(`Rendering controls for ${shaderBuffer.name}`);
    shaderBuffer.controlContainer.innerHTML = ''; // Clear previous controls
    if (shaderBuffer._autoToggleTimers) {
        shaderBuffer._autoToggleTimers.forEach(id => clearInterval(id));
    }

    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = 'reset shader';
    restoreBtn.className = 'restore-defaults-btn';
    restoreBtn.addEventListener('click', () => {
        shaderBuffer.restoreDefaults();
    });
    shaderBuffer.controlContainer.appendChild(document.createElement('br'));
    shaderBuffer.controlContainer.appendChild(restoreBtn);

    shaderBuffer._autoToggleTimers = [];
    const tabIdx = shaderBuffers.indexOf(shaderBuffer);
    if (schema.name) {
        shaderBuffer.setName(`${schema.name} ${tabIdx + 1}`);
    }
    schema?.controls?.forEach(control => {
        if (!control.uniform) { // sanity check
            logError(`Control ${JSON.stringify(control)} has no uniform`);
        }
        const controlDiv = document.createElement('div');
        controlDiv.className = 'control';
        const label = document.createElement('label');
        label.textContent = control.label;
        controlDiv.appendChild(label);
        let inputElement;
        // Use default value from the schema (or cached value); store in the shader's custom uniforms
        const saved = shaderBuffer.customUniforms[control.uniform];
        const initialValue = (saved !== undefined) ? saved : control.default;
        LOG(`render control ${control.uniform} initial value ${initialValue} saved: ${saved} default: ${control.default}`);
        shaderBuffer.setCustomUniform(control.uniform, initialValue);
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
                    shaderBuffer.setCustomUniform(control.uniform, val);
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
                    shaderBuffer.setCustomUniform(control.uniform, true);
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
                    shaderBuffer.setCustomUniform(control.uniform, e.target.checked);
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
                    shaderBuffer.setCustomUniform(control.uniform, { x, y });
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
                    shaderBuffer.setCustomUniform(control.uniform, e.target.value);
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
                inputElement.value = String(initialValue);
                inputElement.addEventListener('change', e => {
                    shaderBuffer.setCustomUniform(control.uniform, e.target.value);
                    saveControlState(shaderBuffer);
                });
                break;
            case 'text-input':
                inputElement = document.createElement('input');
                inputElement.type = 'text';
                inputElement.value = initialValue;
                inputElement.addEventListener('input', e => {
                    shaderBuffer.setCustomUniform(control.uniform, e.target.value);
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
        // TODO: this should move into the MediaInput render function
        const input = schema.inputs[i];
        const label = input.name;
        const inputController = shaderBuffer.mediaInputs[i];
        if (!inputController) continue;
        // const inputController = shaderBuffer.advancedInputsContainer.children[i];
        inputController.setInputName(label);
        const desc = input.description;
        inputController.setDescription(desc);

        // only support self for now
        if (input.autoAssign == 'self') {
            inputController.selectTab(tabIdx);
        }
        inputController.updateRequiredHighlight();
    }
    shaderBuffer.controlSchema = schema;
}

//#endregion

//#region state

async function applyControlSchema(viewIndex, schema) {
    const ok = shaderBuffers[viewIndex].setControlSchema(schema);
    if (!ok) return ok;

    await resourceCache.putControlSchema(viewIndex, schema);
    await loadControlState(shaderBuffers[viewIndex]);
    return true;
}
async function applyShader(viewIndex, frag, vert) {
    if (!vert) vert = vertexShaderSource; // default
    const ok = shaderBuffers[viewIndex].setProgram(new ShaderProgram(vert, frag, gl));
    if (!ok) return false;

    await resourceCache.putFragmentSrc(viewIndex, frag);
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
        await resourceCache.putFragmentSrc(currentViewIndex, newShaderSource);
        attemptApply();
    };
    reader.readAsText(shaderFile);

    async function attemptApply() {
        if (newShaderSource == null) return;

        // swap in the new control schema if we have it
        if (newSchemaData) {
            // renderControlsForShader(active, newSchemaData);
            applyControlSchema(currentViewIndex, newSchemaData);
        }

        const success = await applyShader(currentViewIndex, newShaderSource, vertexShaderSource);
        if (!success) return;
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

    for (const name of names) {
        const fragKey = `config;${name};fragmentSource`;
        const src = await resourceCache.get(fragKey);
        if (typeof src === 'string') {
            myShaderLibrary[name] = src;
        }
    }

    logMessage(`✅ Cached ${names.length} configs: ${names.join(', ')}`);
}

async function loadConfigDirectory(name) {
    const active = shaderBuffers[currentViewIndex];
    const fragKey = `config;${name};fragmentSource`;
    const schemaKey = `config;${name};controlSchema`;

    const schema = await resourceCache.get(schemaKey);
    if (schema) {
        applyControlSchema(currentViewIndex, schema);
    }

    const fragSrc = await resourceCache.get(fragKey);
    if (typeof fragSrc === 'string') {
        const ok = applyShader(currentViewIndex, fragSrc, null);
        if (!ok) {
            logError(`❌ Failed to load ${name}`);
            return;
        }
    }

    // rename the tab to the config name
    active.setName(`${name} ${currentViewIndex + 1}`);
    updateActiveViewUI();

    logMessage(`✅ Loaded config "${name}" into tab ${currentViewIndex + 1}`);
}

//#endregion

//#endregion

//#region render

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
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.vertexAttribPointer(quadPosLocation, 2, gl.FLOAT, false, 0, 0);
    const quadTextureLocation = gl.getUniformLocation(quadProgram, "u_texture");
    gl.activeTexture(gl.TEXTURE0);
    // Use the currently active shader buffer’s updated offscreen texture.
    const target = shaderBuffers[currentViewIndex].renderTarget.readTexture;
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.uniform1i(quadTextureLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    document.getElementById('current-frame').innerText = `${(effectiveTime / 1000.0).toPrecision(3)}`;

    requestAnimationFrame(render);
}

//#endregion

//#region record

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
    isPaused = false;
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        logMessage("Recording stopped.");
    } else {
        logMessage("No recording active.");
    }
}

//#endregion

//#region dsl

function tokenize(str) {
    return (
        str
            // strip CL-style comments
            .replace(/;.*$/gm, '')
            // pad parens so they're separate tokens
            .replace(/\(/g, ' ( ')
            .replace(/\)/g, ' ) ')
            // grab strings, parens, or atoms
            .match(/"(?:\\.|[^"])*"|[^\s()]+|[()]/g) || []
    )
        .map(tok =>
            // turn JSON-style strings into JS strings
            tok[0] === '"' ? JSON.parse(tok) : tok
        );
}

function parseSexp(tokens) {
    // const t = tokens.slice(); // copy
    const t = tokens;
    function parseStr() { // does not work with current tokenizer
        t.shift(); // "
        let str = '';
        let escaped = false;
        while (t[0] !== '"' || escaped) {
            const tok = t.shift();
            if (tok === '\\') escaped = true;
            else {
                str += tok;
                escaped = false;
            }
        }
        t.shift(); // "
        return str;
    }
    function walk() {
        if (t.length === 0) throw new SyntaxError('Unexpected EOF');
        const tok = t.shift();
        if (tok === '(') {
            const L = [];
            while (t[0] !== ')') {
                if (t.length === 0) throw new SyntaxError('Missing )');
                L.push(walk());
            }
            t.shift(); // pop ')'
            return L;
        }
        if (tok === ')') throw new SyntaxError('Unexpected )');
        // atom: number or symbol
        return isFinite(tok) ? Number(tok) : tok;
    }
    const out = [];
    while (t.length) out.push(walk());
    return out.length === 1 ? out[0] : out;
}

function parseDSL(str) {
    const tokens = tokenize(str);
    const expr = parseSexp(tokens);
    if (tokens.length) console.warn("Extra tokens after first expr", tokens);
    return expr;
}
function evalDSL(tree) {
    // Expect: [ 'shader', shaderName, ...clauses ]
    if (tree[0] !== 'shader') throw new Error("DSL must start with (shader …)");
    const cfg = { name: tree[1], uniforms: {}, textures: [] };
    for (let i = 2; i < tree.length; i++) {
        const clause = tree[i];
        const [kw, ...rest] = clause;
        switch (kw) {
            case 'uniform':
                // [ 'uniform', name, value ]
                const val = rest[1];
                cfg.uniforms[rest[0]] = (val === 'true' || val === 'false') ? (val === 'true') : val;
                break;
            case 'texture':
                // TODO: parse (file|shader arg) to an object which returns a texture handle
                // [ 'texture', slot, ['file'|'shader', arg] ]
                cfg.textures.push({ slot: rest[0], [rest[1][0]]: rest[1][1] });
                break;
            default:
                console.warn("Unknown DSL clause", kw);
        }
    }
    return cfg;
}

/*
(let* ((shad-0 (shader "color-invert" :texture-0 (select-shader-tab 1)))
       (shad-1 (shader "color-invert" :texture-0 shad-0))
       (main-shader (shader "demo-moire"
                            :texture-0 shad-0
                            :texture-1 shad-1)))
  main-shader							; render main moire shader
  )


(shader "demo-moire"
(uniform u_mode 2)
(uniform u_colInv1 false)
(uniform u_colInv0 true)
(texture 0 shader 2)
(texture 1 shader 1)
)
*/

const myShaderLibrary = {};
async function populateMyShaderLibrary() {
    const savedList = await resourceCache.get('configsList');
    if (typeof savedList === 'string') {
        const names = JSON.parse(savedList);
        for (const name of names) {
            const fragKey = `config;${name};fragmentSource`;
            const src = await resourceCache.get(fragKey);
            const controlKey = `config;${name};controlSchema`;
            const controlSchema = await resourceCache.get(controlKey);
            if (typeof src === 'string') {
                myShaderLibrary[name] = { frag: src, control: controlSchema };
            }
        }
    }
}

function applyDsl(txt) {
    let tree, config;
    try {
        tree = parseDSL(txt);
        config = evalDSL(tree);
    } catch (e) {
        console.error(e);
        return logError("DSL parse error:", e.message);
    }

    LOG(`generated config`, config);
    const o = myShaderLibrary[config.name];
    let tabIndex = currentViewIndex;
    if (!o?.frag) logError(`uh oh ${config.name} not found`);
    else applyShader(tabIndex, o.frag, vertexShaderSource);

    if (tabIndex < 0) {
        tabIndex = shaderBuffers.length;
        // create a fresh ShaderBuffer with your default schema
        const sb = new ShaderBuffer(config.name,
            new ShaderProgram(vertexShaderSource, o.frag, gl),
            o.control,
            tabIndex);
        shaderBuffers.push(sb);
        shaderBuffers[tabIndex] = sb;
        createShaderTabs();
        createControlSchemeTabs();
    }
    shaderBuffers[tabIndex].controlSchema = o.control;
    console.log(o);
    console.log(config.uniforms);
    console.log(shaderBuffers[tabIndex].controlSchema);
    // update uniform defaults given args
    Object.keys(config.uniforms).forEach(k => shaderBuffers[tabIndex].setCustomUniform(k, config.uniforms[k]));
    renderControlsForShader(shaderBuffers[tabIndex], shaderBuffers[tabIndex].controlSchema);

    for (let t of config.textures) {
        const inp = shaderBuffers[tabIndex].mediaInputs[t.slot];
        if (t.file) inp.setupUrlInput(), inp.inputControlsContainer.querySelector('input').value = t.file, inp.inputControlsContainer.querySelector('form').dispatchEvent(new Event('submit'));
        if (t.shader !== undefined) inp.selectTab(t.shader);
    }

    currentViewIndex = tabIndex;
    updateActiveViewUI();
    updateActiveControlUI();
}

//#endregion

//#region editor

// Shader Editor State Editor muX
let editorSEX = { close: () => { } };

const dslDefaultText = '\
(shader "demo-moire"\n\
    (uniform u_mode 2)\n\
    (uniform u_colInv1 true)\n\
    (uniform u_colInv0 false)\n\
    (texture 0 (shader 1))\n\
    (texture 1 (shader 1)))\n\
'

let currentDSLText = dslDefaultText;
function setupShaderEditor() {
    const editor = document.getElementById('shader-editor');
    const applyBtn = document.getElementById('apply-shader-edit');
    const cancelBtn = document.getElementById('cancel-shader-edit');

    const closeEditor = () => {
        if (editorSEX.editor) editorSEX.editor.style.display = 'none';
        editorOpen = false;
    };

    const openEditor = (type) => {
        const sb = shaderBuffers[currentViewIndex];
        const textarea = document.getElementById('shader-editor-container');
        console.log(type, sb.program.fsSrc);
        editor.style.display = 'block';
        textarea.value = type === 'glsl' ? (sb.program.fsSrc || '') : currentDSLText;
        if (!editor._cmInstance) {
            editor._cmInstance = CodeMirror.fromTextArea(textarea, {
                mode: type === 'glsl' ? 'x-shader/x-fragment' : 'text/plain',
                lineNumbers: true,
                theme: 'default'
            });
            // Set editor size larger
            editor._cmInstance.setSize('100%', '100%');
        } else {
            editor._cmInstance.setValue(type === 'glsl' ? (sb.program.fsSrc || '') : currentDSLText);
            editor._cmInstance.refresh();
        }
        editorSEX.editor = editor;
        editorSEX.type = type;
        editorOpen = true;
    };

    editorSEX.close = closeEditor;
    editorSEX.openShaderEditor = openEditor.bind(null, 'glsl');
    editorSEX.openDslEditor = openEditor.bind(null, 'dsl');

    document.getElementById('edit-shader-btn').addEventListener('click', () => {
        if (editorOpen) closeEditor();
        else editorSEX.openShaderEditor();
    });
    document.getElementById('edit-dsl-btn').addEventListener('click', () => {
        if (editorOpen) closeEditor();
        else editorSEX.openDslEditor();
    });

    cancelBtn.addEventListener('click', () => {
        closeEditor();
    });

    applyBtn.addEventListener('click', async () => {
        const sb = shaderBuffers[currentViewIndex];
        //           this doesnt work V
        const newSource = editor._cmInstance.getValue();
        editor._cmInstance.refresh();

        if (editorSEX.type === 'glsl') {
            if (!sb.setFragmentShader(newSource)) {
                logMessage('❌ Shader compilation failed. See console for errors.');
                return;
            } else {
                logMessage('✅ Shader compiled successfully.');
            }
        } else {
            applyDsl(newSource);
        }
    });
}

//#endregion

//#region setup

const cachedShaderData = {};
document.addEventListener('DOMContentLoaded', async () => {
    await resourceCache.init().then(() => console.log('resource cache loaded')).catch(err => { console.error('THIS SHOULD NOT HAPPEN! Failed to open cache:', err); });

    // bind buttons
    document.getElementById('update-canvas-dimensions').addEventListener('click', updateCanvasDimensions);
    let presetDimensions = [
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
        shaderBuffers.forEach(sb => sb.restart());
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
            for (let i = 0; i < sb.sampleMedia.length; i++) {
                sb.sampleMedia[i] = null; // TODO: cleanup this
            }
            // clear each slot's preview container:
            const previews = sb.advancedInputsContainer.querySelectorAll('.media-preview');
            previews.forEach(p => p.innerHTML = '');
        });
    });

    await populateMyShaderLibrary();

    // update renderers
    updateCanvasDimensions();
    initDefaultShaderBuffers();
    createShaderTabs();
    createControlSchemeTabs();
    updateActiveViewUI();
    updateActiveControlUI();

    setupShaderEditor();

    // load cached shaders
    await (async () => {
        for (let i = 0; i < MAX_TAB_SLOTS; i++) {
            for (let j = 0; j < MAX_TEXTURE_SLOTS; j++) {
                const cached = await resourceCache.getMedia(i, j);
                if (!cached) continue;

                if (!cachedShaderData[i]) cachedShaderData[i] = { media: {}, urls: {}, objs: {} };

                if (cached instanceof Blob) {
                    cachedShaderData[i].media[j] = cached;
                } else if (typeof cached === 'string') {
                    try {
                        const obj = JSON.parse(cached);
                        cachedShaderData[i].objs[j] = obj;
                    } catch {
                        cachedShaderData[i].urls[j] = cached;
                    }
                }
            }
        }

        for (let idx = 0; idx < shaderBuffers.length; idx++) {
            if (!cachedShaderData[idx]) cachedShaderData[idx] = { media: {}, urls: {}, objs: {} };
            const src = await resourceCache.getFragmentSrc(idx);
            if (typeof src === 'string') {
                cachedShaderData[idx].shader = src;
            }

            const schema = await resourceCache.getControlSchema(idx);
            if (schema) cachedShaderData[idx].schema = schema;
        }

        for (let idx = 0; idx < shaderBuffers.length; idx++) {
            let dat = cachedShaderData[idx];
            if (!dat) continue;

            const sb = shaderBuffers[idx];

            if (dat.schema) sb.setControlSchema(dat.schema);
            if (dat.shader) sb.setFragmentShader(dat.shader);

            for (let i = 0; i < MAX_TEXTURE_SLOTS; i++) {
                const previewContainer = sb.mediaInputs[i]?.previewContainer;
                if (!previewContainer) continue;
                if (dat.media[i]) {
                    shaderBuffers[idx].mediaInputs[i].loadAndCache(dat.media[i], false);
                }
                if (dat.objs[i]) {
                    const o = dat.objs[i];
                    if (o.type === Media.TabT) {
                        sb.mediaInputs[i].selectTab(o.tabIndex);
                    } else if (o.type === Media.URLT) {
                        shaderBuffers[idx].mediaInputs[i].loadAndCache(o.url, false);
                    }
                }
                if (dat.urls[i]) {
                    shaderBuffers[idx].mediaInputs[i].loadAndCache(cached, false);
                }
            }
        }
    })()

    shaderBuffers.forEach(shaderBuffer => {
        renderControlsForShader(shaderBuffer, shaderBuffer.controlSchema);
    });

    for (const sb of shaderBuffers) {
        await loadControlState(sb);
    }

    updateActiveViewUI();

    requestAnimationFrame(render);
});

//#endregion
