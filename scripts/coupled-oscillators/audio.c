#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio/miniaudio.h"

#include <string.h>
#include <stdlib.h>

#include "audio.h"
#include "kuramoto.h"

struct AudioDevice {
	ma_device device;

	AudioCallback callback;

	void *userdata;

	int playing;
};

static void
ma_callback(
    ma_device *device,
    void *output,
    const void *input,
    ma_uint32 frameCount)
{
    (void)input;

    AudioDevice *audio = device->pUserData;

    float *out = output;

    for (ma_uint32 i = 0; i < frameCount; ++i)
    {
        float s = 0.0f;

        if (audio->playing)
            s = audio->callback(audio->userdata);

        *out++ = s;
    }
}

AudioDevice *audio_new(void) {
    AudioDevice *dev = malloc(sizeof(AudioDevice));
    return dev;
}

void audio_free(AudioDevice *dev) {
    free(dev);
}

int
audio_init(
    AudioDevice *audio,
    AudioCallback callback,
    void *userdata)
{
    memset(audio,0,sizeof(*audio));

    audio->callback = callback;
    audio->userdata = userdata;
    audio->playing = 1;

    ma_device_config config =
        ma_device_config_init(ma_device_type_playback);

    config.playback.format = ma_format_f32;

    config.playback.channels = 1;

    config.sampleRate = SAMPLE_RATE;

    config.dataCallback = ma_callback;

    config.pUserData = audio;

    ma_result r =
        ma_device_init(NULL,&config,&audio->device);

    if(r != MA_SUCCESS)
        return 0;

    r = ma_device_start(&audio->device);

    return r == MA_SUCCESS;
}

void
audio_shutdown(AudioDevice *audio)
{
    ma_device_uninit(&audio->device);
}

void
audio_pause(AudioDevice *audio)
{
    audio->playing = 0;
}

void
audio_resume(AudioDevice *audio)
{
    audio->playing = 1;
}

int
audio_is_playing(AudioDevice *audio)
{
    return audio->playing;
}
