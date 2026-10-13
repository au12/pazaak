// Sound effects and the cantina band.
//
// Effects are decoded once into Web Audio buffers so they can overlap and
// fire instantly. Music is a plain <audio> element working through the
// playlist. Browsers only allow sound after the first tap or key press, so
// everything waits for that.

const EFFECTS = {
  draw: 'sounds/mgs_drawmain.wav',
  play: 'sounds/mgs_playside.wav',
  turn: 'sounds/mgs_startturn.wav',
  warn: 'sounds/mgs_warnbust.wav',
  winSet: 'sounds/mgs_winset.wav',
  loseSet: 'sounds/mgs_loseset.wav',
  winMatch: 'sounds/mgs_winmatch.wav',
  loseMatch: 'sounds/mgs_losematch.wav',
  click: 'sounds/click.wav',
};

const TRACKS = [
  { src: 'music/01_kotor1_cantina_a.mp3', title: 'Cantina, first set' },
  { src: 'music/02_kotor1_cantina_b.mp3', title: 'Cantina, second set' },
  { src: 'music/03_kotor2_iziz_cantina.mp3', title: 'Iziz cantina' },
];

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`pazaak.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`pazaak.${key}`, JSON.stringify(value));
    } catch {}
  },
};

class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.sfxVolume = store.get('sfx', 0.8);
    this.musicVolume = store.get('music', 0.35);
    this.musicOn = store.get('musicOn', true);
    this.unlocked = false;
    this.order = TRACKS.map((_, i) => i).sort(() => Math.random() - 0.5);
    this.trackAt = 0;
    this.listeners = new Set();
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.addEventListener('ended', () => this.next());
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      this.start();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  async start() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.sfxVolume;
      this.gain.connect(this.ctx.destination);
      await Promise.all(
        Object.entries(EFFECTS).map(async ([name, url]) => {
          try {
            const res = await fetch(url);
            this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
          } catch {}
        }),
      );
    } catch {}
    if (this.musicOn) this.playMusic();
  }

  /** Plays an effect by name. `rate` nudges the pitch, `vol` scales it. */
  play(name, { rate = 1, vol = 1, delay = 0 } = {}) {
    if (!this.ctx || !this.buffers[name] || this.sfxVolume <= 0) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.gain);
    src.start(this.ctx.currentTime + delay / 1000);
  }

  setSfx(v) {
    this.sfxVolume = v;
    store.set('sfx', v);
    if (this.gain) this.gain.gain.value = v;
  }

  // ───── music ─────

  get track() {
    return TRACKS[this.order[this.trackAt % this.order.length]];
  }

  playMusic() {
    if (!this.unlocked) return;
    if (!this.audio.src || !this.audio.src.endsWith(this.track.src)) this.audio.src = this.track.src;
    this.audio.volume = this.musicVolume;
    this.audio.play().catch(() => {});
    this.emit();
  }

  next() {
    this.trackAt += 1;
    this.audio.src = this.track.src;
    if (this.musicOn) this.playMusic();
  }

  setMusicOn(on) {
    this.musicOn = on;
    store.set('musicOn', on);
    if (on) this.playMusic();
    else this.audio.pause();
    this.emit();
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    store.set('music', v);
    this.audio.volume = v;
    if (v > 0 && !this.musicOn) this.setMusicOn(true);
    if (v === 0 && this.musicOn) this.setMusicOn(false);
  }

  onChange(fn) {
    this.listeners.add(fn);
  }
  emit() {
    for (const fn of this.listeners) fn();
  }
}

export const sound = new Sound();
export { store };
