"""Render original, sample-free audio for Mystic Puzzles. Requires numpy and ffmpeg."""
from pathlib import Path
import subprocess
import tempfile
import wave
import numpy as np

SR = 32000
ROOT = Path(__file__).resolve().parents[1] / 'public' / 'audio'
ROOT.mkdir(parents=True, exist_ok=True)
RNG = np.random.default_rng(713)


def tone(freq, seconds, flavor='bell'):
    t = np.arange(round(seconds * SR), dtype=np.float64) / SR
    if flavor == 'pad':
        carrier = sum(a * np.sin(2 * np.pi * freq * k * t + k * .31) for k, a in [(1, 1), (2, .24), (3, .11), (4, .035)])
        carrier += .16 * np.sin(2 * np.pi * freq * 1.003 * t + 1.2)
        envelope = np.minimum(1, t / 2.5) * np.minimum(1, (seconds - t) / 2.7)
        envelope = np.maximum(envelope, 0) ** 1.5
    else:
        carrier = sum(a * np.sin(2 * np.pi * freq * k * t + k * .31) for k, a in [(1, 1), (2, .32), (3.01, .17), (4.16, .045)])
        envelope = (1 - np.exp(-t * 45)) * np.exp(-t * (1.7 if flavor == 'bell' else 4.8))
    return carrier * envelope


def place(track, signal, start):
    first = int(round(start * SR))
    for offset in range(0, len(signal), len(track)):
        chunk = signal[offset:offset + len(track)]
        indices = (first + offset + np.arange(len(chunk))) % len(track)
        track[indices] += chunk


def finish(name, mono, music=False):
    # Gentle circular delays preserve the loop boundary.
    if music:
        mono = mono + .19 * np.roll(mono, round(.29 * SR)) + .10 * np.roll(mono, round(.57 * SR))
        left = mono + .085 * np.roll(mono, round(.43 * SR))
        right = mono + .085 * np.roll(mono, round(.67 * SR))
        data = np.column_stack((left, right))
    else:
        delayed = np.zeros_like(mono)
        shift = round(.09 * SR)
        delayed[shift:] = mono[:-shift] * .13
        data = (mono + delayed)[:, None]
    peak = np.max(np.abs(data))
    data = data / max(peak, 1) * (.68 if music else .72)
    pcm = (data * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        with wave.open(tmp.name, 'wb') as out:
            out.setnchannels(data.shape[1]); out.setsampwidth(2); out.setframerate(SR); out.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp.name, '-c:a', 'libvorbis', '-q:a', '4', str(ROOT / name)], check=True)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp.name, '-c:a', 'aac', '-b:a', '96k' if music else '64k', '-movflags', '+faststart', str(ROOT / name.replace('.ogg', '.m4a'))], check=True)


# 40-second, five-chord nocturne. Each pad crosses the loop seam without a fade-to-silence.
period = 40
music = np.zeros(period * SR, dtype=np.float64)
chords = [
    [146.83, 220, 293.66, 349.23, 440],
    [116.54, 174.61, 220, 293.66, 349.23],
    [130.81, 196, 261.63, 329.63, 440],
    [130.81, 196, 293.66, 329.63, 392],
    [110, 164.81, 196, 261.63, 329.63],
]
for chord_no, chord in enumerate(chords):
    for note_no, freq in enumerate(chord):
        place(music, tone(freq, 12, 'pad') * (.085 if note_no == 0 else .060), chord_no * 8 - 2)
melody = [(1, 587.33), (4.5, 523.25), (7, 440), (10.5, 523.25), (13.5, 587.33),
          (17, 659.25), (20.5, 523.25), (23, 440), (26, 392), (29.5, 440),
          (33, 523.25), (36.5, 587.33)]
for when, freq in melody:
    place(music, tone(freq, 2.7) * .052, when)
finish('moonlit-forest.ogg', music, music=True)


def effect(name, seconds, notes, noise_level=0):
    signal = np.zeros(round(seconds * SR), dtype=np.float64)
    for when, freq, level, decay in notes:
        sound = tone(freq, min(decay, seconds - when)) * level
        start = round(when * SR)
        signal[start:start + len(sound)] += sound
    if noise_level:
        raw = RNG.normal(0, 1, len(signal))
        smooth = np.convolve(raw, np.ones(80) / 80, mode='same')
        signal += smooth * np.exp(-np.arange(len(signal)) / (SR * .028)) * noise_level
    finish(name, signal)


effect('piece-pick.ogg', .24, [(0, 659.25, .26, .22), (.035, 880, .13, .17)])
effect('piece-place.ogg', .52, [(0, 523.25, .38, .44), (.06, 783.99, .18, .38), (.12, 1046.5, .07, .30)], .12)
effect('picture-complete.ogg', 1.7, [(0, 523.25, .22, .9), (.23, 659.25, .24, .9), (.46, 783.99, .26, 1.0), (.73, 1046.5, .22, .95)])
effect('button.ogg', .15, [(0, 587.33, .25, .14)], .035)
print(*(f'{p.name}: {p.stat().st_size} bytes' for p in sorted(ROOT.glob('*.ogg'))), sep='\n')
