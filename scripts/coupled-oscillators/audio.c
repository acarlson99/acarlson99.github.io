#include "audio.h"

#include <string.h>
#include <math.h>

static int audio_callback(
    const void *input,
    void *output,
    unsigned long frames,
    const PaStreamCallbackTimeInfo *timeInfo,
    PaStreamCallbackFlags statusFlags,
    void *userData)
{
    (void)input;
    (void)timeInfo;
    (void)statusFlags;

    AudioEngine *a = userData;

    float *out = output;

    if (!a->playing)
    {
        memset(out,0,sizeof(float)*frames);
        return paContinue;
    }

    for(unsigned i=0;i<frames;i++)
    {
        double s = step(a->synth,a->dt);

        s = tanh(s*3.0);

        out[i] = (float)s;
    }

    return paContinue;
}

int audio_start(AudioEngine *a,Synthesizer *synth)
{
    memset(a,0,sizeof(*a));

    a->synth = synth;
    a->dt = 1.0/SAMPLE_RATE;
    a->playing = 1;

    Pa_Initialize();

    Pa_OpenDefaultStream(
        &a->stream,
        0,
        1,
        paFloat32,
        SAMPLE_RATE,
        256,
        audio_callback,
        a);

    return Pa_StartStream(a->stream);
}

void audio_stop(AudioEngine *a)
{
    if(!a->stream)
        return;

    Pa_StopStream(a->stream);
    Pa_CloseStream(a->stream);
    Pa_Terminate();
}

