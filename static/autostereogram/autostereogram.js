/**
 * Draw an autostereogram onto the given canvas using the provided depth map and pattern image.
 * Based on http://www.techmind.org/stereo/stech.html
 *
 * The canvas size is respected and the depth map is scaled to fit the canvas.
 *
 * @param {HTMLCanvasElement} canvas - The output canvas.
 * @param {HTMLImageElement|HTMLCanvasElement} depthMap - The depth map image.
 * @param {HTMLImageElement|HTMLCanvasElement} patternTexture - The repeating pattern image.
 * @param {Object} options - Optional parameters.
 *    options.oversample {number} - oversampling factor (default 4)
 *    options.xdpi {number} - horizontal DPI (default 75)
 *    options.ydpi {number} - vertical DPI (default 75)
 *    options.normalizeDepthMap {boolean} - whether to use full color magnitude for depth (default false)
 */
function drawAutostereogram(canvas, depthMap, patternTexture, options = {}) {
    // Parameters (default values mimic the Unity script)
    const oversample = options.oversample || 4;
    const xdpi = options.xdpi || 75;
    const ydpi = options.ydpi || 75;
    const normalizeDepthMap = options.normalizeDepthMap || false;

    // Use the canvas's intrinsic size for output.
    const width = canvas.width;
    const height = canvas.height;

    // Create an offscreen canvas to scale the depth map to the output dimensions.
    const depthCanvas = document.createElement("canvas");
    depthCanvas.width = width;
    depthCanvas.height = height;
    const depthCtx = depthCanvas.getContext("2d");
    depthCtx.drawImage(depthMap, 0, 0, width, height);
    const depthData = depthCtx.getImageData(0, 0, width, height).data;

    // Get pattern (sample) image dimensions and pixel data.
    // (If no pattern is provided, we default to using the output size.)
    const patWidth = patternTexture?.width || width;
    const patHeight = patternTexture?.height || height;
    const patCanvas = document.createElement("canvas");
    patCanvas.width = patWidth;
    patCanvas.height = patHeight;
    const patCtx = (patternTexture && patCanvas.getContext("2d")) || null;
    patCtx?.drawImage(patternTexture, 0, 0, patWidth, patHeight);
    const patData = patCtx?.getImageData(0, 0, patWidth, patHeight)?.data;

    // Set up algorithm parameters (mirroring the Unity script)
    const maxwidth = width * oversample;
    const yShift = Math.floor(ydpi / 16);  // integer division as in C#
    const vwidth = width * oversample;
    const obsDist = xdpi * 12;
    const eyeSep = Math.floor(xdpi * 2.5);
    const veyeSep = eyeSep * oversample;
    const maxdepth = xdpi * 12;
    const mindepth = Math.floor(maxdepth * 0.5);
    const maxsep = Math.floor((eyeSep * maxdepth) / (maxdepth + obsDist));
    const vmaxsep = oversample * maxsep;
    const s = Math.floor(vwidth / 2 - vmaxsep / 2); // start from middle to reduce distortion
    const poffset = vmaxsep - (s % vmaxsep);

    // Prepare the output canvas (its size is already defined by its width/height attributes)
    const ctx = canvas.getContext("2d");
    const outImageData = ctx.createImageData(width, height);
    const outData = outImageData.data;

    // Helper to get the depth (normalized [0,1]) at (x,y)
    function getDepthGrayscale(x, y) {
        const index = (y * width + x) * 4;
        const r = depthData[index];
        const g = depthData[index + 1];
        const b = depthData[index + 2];
        if (normalizeDepthMap) {
            // Use color magnitude (normalize by maximum possible magnitude)
            const mag = Math.sqrt(r * r + g * g + b * b) / Math.sqrt(3 * 255 * 255);
            return mag;
        } else {
            // Standard luminance formula
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            return gray / 255;
        }
    }

    // Helper to get a color from the pattern image at (x,y)
    function getPatternPixel(x, y) {
        // Wrap coordinates
        x = ((x % patWidth) + patWidth) % patWidth;
        y = ((y % patHeight) + patHeight) % patHeight;
        const index = (y * patWidth + x) * 4;
        if (patData)
            return { r: patData[index], g: patData[index + 1], b: patData[index + 2] };
        return { r: Math.random() * 255, g: Math.random() * 255, b: Math.random() * 255 };
        const a = Math.random() * 255;
        return { r: a, g: a, b: a };
    }

    // SmoothStep: interpolates between edge0 and edge1 based on t
    // (Unity’s Mathf.SmoothStep uses t*t*(3-2*t))
    function smoothStep(edge0, edge1, t) {
        t = Math.max(0, Math.min(1, t));
        return edge0 + (edge1 - edge0) * (t * t * (3 - 2 * t));
    }

    // We'll re-use arrays for each row:
    const lookL = new Array(vwidth);
    const lookR = new Array(vwidth);
    const colourRow = new Array(vwidth);

    // Process each row (each y)
    for (let y = 0; y < height; y++) {
        // Initialize link arrays for the oversampled row
        for (let x = 0; x < vwidth; x++) {
            lookL[x] = x;
            lookR[x] = x;
        }

        let sep = 0;
        // Left-to-right: assign links based on depth
        for (let x = 0; x < vwidth; x++) {
            // Only recompute depth and separation every oversample pixels.
            if (x % oversample === 0) {
                const depthX = Math.floor(x / oversample);
                const z = getDepthGrayscale(depthX, y);
                // When z==0 we want maxdepth and when z==1 we want mindepth.
                const featureZ = Math.floor(smoothStep(maxdepth, mindepth, z));
                sep = Math.floor((veyeSep * featureZ) / (featureZ + obsDist));
            }
            const left = x - Math.floor(sep / 2);
            const right = left + sep;
            let vis = true;
            if (left >= 0 && right < vwidth) {
                if (lookL[right] !== right) { // already linked
                    if (lookL[right] < left) {
                        lookR[lookL[right]] = lookL[right]; // break old link
                        lookL[right] = right;
                    } else {
                        vis = false;
                    }
                }
                if (lookR[left] !== left) {
                    if (lookR[left] > right) {
                        lookL[lookR[left]] = lookR[left];
                        lookR[left] = left;
                    } else {
                        vis = false;
                    }
                }
                if (vis) {
                    lookL[right] = left;
                    lookR[left] = right;
                }
            }
        }

        let lastlinked = -10;
        // Pass from left (starting at s) to right: fill in colours
        for (let x = s; x < vwidth; x++) {
            if (lookL[x] === x || lookL[x] < s) {
                if (x - 1 === lastlinked) {
                    colourRow[x] = colourRow[x - 1];
                } else {
                    const patX = Math.floor(((x + poffset) % vmaxsep) / oversample);
                    const patY = (y + Math.floor((x - s) / vmaxsep) * yShift) % patHeight;
                    colourRow[x] = getPatternPixel(patX, patY);
                }
            } else {
                colourRow[x] = colourRow[lookL[x]];
                lastlinked = x;
            }
        }
        lastlinked = -10;
        // Pass from right to left: further constrain colours
        for (let x = s - 1; x >= 0; x--) {
            if (lookR[x] === x) {
                if (x + 1 === lastlinked) {
                    colourRow[x] = colourRow[x + 1];
                } else {
                    const patX = Math.floor(((x + poffset) % vmaxsep) / oversample);
                    const patY = (y + (Math.floor((s - x) / vmaxsep) + 1) * yShift) % patHeight;
                    colourRow[x] = getPatternPixel(patX, patY);
                }
            } else {
                colourRow[x] = colourRow[lookR[x]];
                lastlinked = x;
            }
        }

        // Average oversampled pixels to form each output pixel in this row.
        for (let x = 0; x < vwidth; x += oversample) {
            let red = 0, green = 0, blue = 0;
            for (let i = x; i < x + oversample; i++) {
                red += colourRow[i].r;
                green += colourRow[i].g;
                blue += colourRow[i].b;
            }
            red = Math.floor(red / oversample);
            green = Math.floor(green / oversample);
            blue = Math.floor(blue / oversample);
            const outX = Math.floor(x / oversample);
            const outIndex = (y * width + outX) * 4;
            outData[outIndex] = red;
            outData[outIndex + 1] = green;
            outData[outIndex + 2] = blue;
            outData[outIndex + 3] = 255;
        }
    }

    // Finally, draw the autostereogram onto the target canvas.
    ctx.putImageData(outImageData, 0, 0);
}
