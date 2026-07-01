#pragma once

typedef double (*AudioCallback)(void *);

typedef struct AudioDevice AudioDevice;

int audio_init(AudioDevice *audio, AudioCallback callback, void *userdata);

void audio_shutdown(AudioDevice *audio);

void audio_pause(AudioDevice *audio);

void audio_resume(AudioDevice *audio);

int audio_is_playing(AudioDevice *audio);
AudioDevice *audio_new(void);
void audio_free(AudioDevice *dev);
