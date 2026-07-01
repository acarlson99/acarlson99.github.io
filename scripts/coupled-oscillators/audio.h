#pragma once

#include <portaudio.h>

#include "kuramoto.h"

typedef struct {
    PaStream *stream;

    Synthesizer *synth;

    double dt;

    volatile int playing;
} AudioEngine;

int audio_start(AudioEngine *a, Synthesizer *synth);
void audio_stop(AudioEngine *a);
