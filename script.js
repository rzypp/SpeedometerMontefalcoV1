/* ==========================================================
   PENGATURAN — ubah di sini saja
   ========================================================== */
const CONFIG = {
    // Animasi "Welcome" saat mesin dinyalakan
    showIntro: true,
    ownerName: 'Mr. Montefalco',   // nama yang tampil setelah "Welcome,"
    introDuration: 3400,           // ms

    // Suara peringatan seatbelt (berulang selama seatbelt belum dipakai).
    // Tidak ada file suara di paket ini. Taruh file Anda di folder yang sama dengan index.html
    // dengan nama di bawah ini (atau ganti namanya di sini). Kosongkan ('') jika tidak dipakai.
    seatbeltSound: 'speedometer_sound.mp3',
    seatbeltVolume: 0.8,

    // true  = kedip merah dan suara hanya aktif kalau mesin hidup
    // false = aktif terus selama seatbelt belum dipakai
    warnOnlyWhenEngineOn: true,

    gearCount: 6,            // gear maju tertinggi yang ditampilkan (0 sampai 6)
    zeroGearLabel: 'N',      // tampilan gear 0 (netral/mundur), contoh: 'N' atau 'R'
    rpmScaleMax: 9,          // dipakai untuk membaca RPM asli (x1000)
    redline: 0.8,            // batas zona merah RPM (0 sampai 1)
    lowFuel: 0.2,            // di bawah ini fuel jadi merah
    lowHealth: 0.3,          // di bawah ini health jadi merah
    startupSweep: true,      // kolom RPM menyapu penuh setelah animasi Welcome
    odometerUnit: 'mi',      // 'mi' atau 'km' (input setOdometer tetap dalam mil)

    // Format input setRPM: 'auto' = nilai 0 sampai 1 dibaca apa adanya, nilai di atas 1.5
    // dianggap RPM asli (misal 2500) dan dibagi (rpmScaleMax x 1000). Bisa juga 'normalized' atau 'raw'.
    rpmInput: 'auto',

    // true = selalu tampilkan panel debug. Di FiveM cukup tambahkan ?debug di akhir URL.
    debug: false
};

/* ========================================================== */

const SCALES = {
    0: { factor: 3.6,      unit: 'km/h' },
    1: { factor: 2.236936, unit: 'mph' },
    2: { factor: 1.943844, unit: 'knots' }
};

const RPM_COUNT = 22;
const PIP_COUNT = 8;

// Semua nilai terakhir dari server disimpan di sini, lalu ditampilkan oleh fungsi render.
const data = {
    engine: false,
    seatbelts: false,
    speed: 0,          // m/s
    speedMode: 1,      // 0: KMH, 1: MPH, 2: Knots
    rpm: 0,            // 0 sampai 1
    fuel: 1,
    health: 1,
    gear: 0,
    lights: 0,         // 0: off, 1: on, 2: high beam
    odometer: 0        // mil
};

let ready = false;
let el = {};
let rpmSegs = [];
let fuelSegs = [];
let healthSegs = [];
let gearTabs = [];
let sweepValue = 0;
let introTimer = null;
const errors = [];

const clamp01 = n => Math.min(1, Math.max(0, Number(n) || 0));

// Menerima true/false, 1/0, dan teks "true"/"false"/"1"/"0" supaya tidak salah baca.
function toBool(v) {
    if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        return !(t === '' || t === 'false' || t === '0' || t === 'off' || t === 'null' || t === 'undefined');
    }
    return !!v;
}

function logError(e) {
    const msg = e && e.message ? e.message : String(e);
    errors.push(msg);
    if (errors.length > 5) errors.shift();
    if (window.console) console.error('[speedometer]', e);
}

/* ---------- Suara seatbelt ---------- */

let audio = null;
let audioUrl = '-';
let audioError = '';          // alasan terakhir kalau suara gagal (tampil di panel debug)
let alarmWanted = false;
let audioRetryAt = 0;
let audioAttempts = 0;
let lastPlayTry = 0;

function createAudio() {
    if (!CONFIG.seatbeltSound) return null;

    try {
        const a = new Audio();
        a.loop = true;
        a.preload = 'auto';
        a.volume = clamp01(CONFIG.seatbeltVolume);

        a.addEventListener('error', () => {
            const code = a.error ? a.error.code : '?';
            audioError = 'gagal memuat file (kode ' + code + ')';
            if (audio === a) audio = null;            // dibuat ulang pada percobaan berikutnya
            audioRetryAt = Date.now() + 3000;         // coba lagi 3 detik kemudian
        });
        a.addEventListener('playing', () => { audioError = ''; });

        // percobaan ulang memakai ?t= supaya hasil 404 yang tersimpan di cache tidak dipakai
        const bust = audioAttempts > 0 ? (CONFIG.seatbeltSound.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now() : '';
        audioAttempts++;
        a.src = CONFIG.seatbeltSound + bust;
        audioUrl = a.src;
        return a;
    } catch (e) {
        logError(e);
        return null;
    }
}

function ensureAudio() {
    if (audio || !CONFIG.seatbeltSound) return audio;
    if (Date.now() < audioRetryAt) return null;
    audio = createAudio();
    return audio;
}

function setAlarm(on) {
    alarmWanted = on;
    if (!CONFIG.seatbeltSound) return;

    if (!on) {
        if (audio && !audio.paused) {
            audio.pause();
            audio.currentTime = 0;
        }
        return;
    }

    const a = ensureAudio();
    if (!a || !a.paused) return;

    const now = Date.now();
    if (now - lastPlayTry < 500) return;              // jangan mencoba terus-menerus
    lastPlayTry = now;

    const p = a.play();
    if (p && p.catch) {
        p.catch(err => {
            audioError = 'play ditolak: ' + (err && err.name ? err.name : err);
        });
    }
}

// Selama suara dibutuhkan tapi belum bunyi (file baru aktif, atau browser menolak autoplay),
// coba lagi setiap detik. Sentuhan atau klik pertama juga langsung mencoba memutar.
setInterval(() => { if (alarmWanted) setAlarm(true); }, 1000);
['pointerdown', 'keydown', 'touchstart'].forEach(type => {
    window.addEventListener(type, () => { if (alarmWanted) setAlarm(true); }, { passive: true });
});

/* ---------- Fungsi render (menampilkan data ke layar) ---------- */

function setLit(list, count, hotFrom) {
    for (let i = 0; i < list.length; i++) {
        const lit = i < count;
        const seg = list[i];
        if (seg._lit !== lit) {
            seg._lit = lit;
            seg.classList.toggle('lit', lit);
        }
        if (hotFrom !== undefined) {
            const hot = i >= hotFrom;
            if (seg._hot !== hot) {
                seg._hot = hot;
                seg.classList.toggle('hot', hot);
            }
        }
    }
}

function renderEngine() {
    if (!ready) return;
    el.hud.classList.toggle('engine-off', !data.engine);
    el.engine.classList.toggle('on', data.engine);
}

function renderSeatbelt() {
    if (!ready) return;

    const warnNow = !data.seatbelts && (!CONFIG.warnOnlyWhenEngineOn || data.engine);

    el.seatbelts.classList.toggle('ok', data.seatbelts);
    el.seatbelts.classList.toggle('bad', warnNow);
    el.seatbelts.classList.toggle('warn', !data.seatbelts && !warnNow);
    el.hud.classList.toggle('no-belt', warnNow);
    setAlarm(warnNow);
}

function renderSpeed() {
    if (!ready) return;
    const sc = SCALES[data.speedMode] || SCALES[1];

    el.speed.textContent = Math.round(data.speed * sc.factor);
    el.speedUnit.textContent = sc.unit;
}

function renderRpm() {
    if (!ready) return;
    // Saat animasi sapuan, tampilkan yang lebih tinggi antara RPM asli dan sapuan,
    // jadi nilai asli tidak pernah tertutup.
    const shown = Math.max(data.rpm, sweepValue);
    setLit(rpmSegs, Math.round(shown * RPM_COUNT), Math.floor(CONFIG.redline * RPM_COUNT));
    el.rpmNum.textContent = (data.rpm * CONFIG.rpmScaleMax).toFixed(1) + 'k';
    el.hud.classList.toggle('redline', data.engine && data.rpm >= CONFIG.redline);
}

function renderMeter(segs, valueEl, colEl, value, lowLimit) {
    const v = clamp01(value);
    const lit = v <= 0 ? 0 : Math.max(1, Math.round(v * PIP_COUNT));
    setLit(segs, lit);
    valueEl.textContent = `${Math.round(v * 100)}%`;
    colEl.classList.toggle('low', v <= lowLimit);
}

function renderFuel() {
    if (ready) renderMeter(fuelSegs, el.fuel, el.fuelCol, data.fuel, CONFIG.lowFuel);
}

function renderHealth() {
    if (ready) renderMeter(healthSegs, el.health, el.healthCol, data.health, CONFIG.lowHealth);
}

function renderGear() {
    if (!ready) return;
    const n = Math.min(CONFIG.gearCount, Math.max(0, Math.floor(Number(data.gear) || 0)));

    gearTabs.forEach((tab, i) => {
        const on = i === n;
        const pass = i > 0 && i < n;
        if (tab._on !== on) { tab._on = on; tab.classList.toggle('on', on); }
        if (tab._pass !== pass) { tab._pass = pass; tab.classList.toggle('pass', pass); }
    });
}

function renderLights() {
    if (!ready) return;
    el.headlights.classList.toggle('on', data.lights === 1);
    el.headlights.classList.toggle('high', data.lights === 2);
}

function renderOdometer() {
    if (!ready) return;
    const km = CONFIG.odometerUnit === 'km';
    const value = km ? data.odometer * 1.609344 : data.odometer;

    el.odometer.textContent = String(Math.floor(value)).padStart(7, '0');
    el.odoUnit.textContent = km ? 'km' : 'mi';
}

function renderAll() {
    renderEngine();
    renderSeatbelt();
    renderSpeed();
    renderRpm();
    renderFuel();
    renderHealth();
    renderGear();
    renderLights();
    renderOdometer();
}

/* ---------- Animasi Welcome dan sapuan RPM ---------- */

function sweepRpm() {
    if (!CONFIG.startupSweep) return;

    const duration = 1200;
    const start = Date.now();

    function step() {
        const t = (Date.now() - start) / duration;
        if (t >= 1) {
            sweepValue = 0;
            renderRpm();
            return;
        }
        sweepValue = t < 0.5 ? t * 2 : (1 - t) * 2;
        renderRpm();
        requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function playIntro() {
    clearTimeout(introTimer);

    if (!CONFIG.showIntro) {
        sweepRpm();
        return;
    }

    el.hud.classList.add('intro-on');
    introTimer = setTimeout(() => {
        el.hud.classList.remove('intro-on');
        sweepRpm();
    }, CONFIG.introDuration);
}

function stopIntro() {
    clearTimeout(introTimer);
    if (el.hud) el.hud.classList.remove('intro-on');
    sweepValue = 0;
}

// Mengecilkan huruf nama otomatis supaya nama yang panjang tetap muat di dalam panel.
function fitOwner() {
    const o = el.owner;
    let size = 60;

    o.textContent = CONFIG.ownerName;
    o.style.fontSize = size + 'px';
    while (o.offsetWidth > 470 && size > 20) {
        size -= 2;
        o.style.fontSize = size + 'px';
    }
}

/* ---------- Fungsi publik (sama seperti template asli) ---------- */

/**
 * @param {boolean} state - true jika mesin hidup.
 */
function setEngine(on) {
    const was = data.engine;
    data.engine = toBool(on);

    if (ready) {
        if (data.engine && !was) playIntro();
        if (!data.engine && was) stopIntro();
    }

    renderEngine();
    renderSeatbelt();
    renderRpm();
}

/**
 * @param {number} speed - Kecepatan dalam meter per detik (m/s).
 */
function setSpeed(speed) {
    data.speed = Number(speed) || 0;
    renderSpeed();
}

/**
 * @param {number} rpm - Nilai RPM dari 0 sampai 1.
 */
function setRPM(rpm) {
    const n = Number(rpm) || 0;
    const raw = CONFIG.rpmInput === 'raw' || (CONFIG.rpmInput === 'auto' && n > 1.5);
    data.rpm = clamp01(raw ? n / (CONFIG.rpmScaleMax * 1000) : n);
    renderRpm();
}

/**
 * @param {number} fuel - Level bensin dari 0 sampai 1.
 */
function setFuel(fuel) {
    data.fuel = fuel;
    renderFuel();
}

/**
 * @param {number} health - Kondisi kendaraan dari 0 sampai 1.
 */
function setHealth(health) {
    data.health = health;
    renderHealth();
}

/**
 * @param {number|string} gear - Gear saat ini (0 sampai 6). 0 dianggap netral/mundur.
 */
function setGear(gear) {
    data.gear = gear;
    renderGear();
}

/**
 * @param {number} state - 0: Off, 1: On, 2: High Beam.
 */
function setHeadlights(level) {
    data.lights = Number(level) || 0;
    renderLights();
}

/**
 * Sein sudah dihapus dari tampilan. Dua fungsi ini sengaja dibiarkan kosong supaya server
 * yang masih memanggilnya tidak menimbulkan error pada pemanggilan fungsi lainnya.
 */
function setLeftIndicator() {}
function setRightIndicator() {}

/**
 * @param {boolean} state - true jika seatbelt dipakai.
 */
function setSeatbelts(on) {
    data.seatbelts = toBool(on);
    renderSeatbelt();
}

/**
 * @param {number} mode - 0: KMH, 1: MPH, 2: Knots.
 */
function setSpeedMode(mode) {
    data.speedMode = SCALES[mode] ? Number(mode) : 1;
    renderSpeed();
}

/**
 * @param {number} distance - Jarak dalam mil.
 */
function setOdometer(distance) {
    data.odometer = Math.max(0, Number(distance) || 0);
    renderOdometer();
}

/**
 * Tambahan: tampilkan atau sembunyikan seluruh HUD (suara ikut berhenti saat disembunyikan).
 * @param {boolean} visible
 */
function setVisible(visible) {
    visible = toBool(visible);
    if (ready) el.hud.classList.toggle('hidden', !visible);
    if (!visible) setAlarm(false);
    else renderSeatbelt();
}

/* ---------- Membuat elemen ---------- */

function makeSegs(container, count, colorOf) {
    const list = [];
    const frag = document.createDocumentFragment();

    for (let i = 0; i < count; i++) {
        const seg = document.createElement('i');
        if (colorOf) seg.style.setProperty('--k', colorOf(i / (count - 1)));
        frag.appendChild(seg);
        list.push(seg);
    }
    container.appendChild(frag);
    return list;
}

// emas -> amber -> merah
function rpmColor(t) {
    return t < 0.55 ? '#ffd25a' : (t < 0.8 ? '#ff9a2e' : '#ff3b3b');
}

function makeGearTabs(container) {
    const list = [];
    for (let i = 0; i <= CONFIG.gearCount; i++) {
        const tab = document.createElement('div');
        tab.className = 'gt';
        tab.textContent = i === 0 ? CONFIG.zeroGearLabel : String(i);
        container.appendChild(tab);
        list.push(tab);
    }
    return list;
}

/* ---------- Pesan dari server (opsional) dan panel debug ---------- */

const API_NAMES = ['setEngine', 'setSpeed', 'setRPM', 'setFuel', 'setHealth', 'setGear',
    'setHeadlights', 'setLeftIndicator', 'setRightIndicator', 'setSeatbelts',
    'setSpeedMode', 'setOdometer', 'setVisible'];

// Setiap fungsi dibungkus supaya satu error tidak mematikan fungsi lainnya.
API_NAMES.forEach(name => {
    const original = window[name];
    window[name] = function () {
        try {
            return original.apply(this, arguments);
        } catch (e) {
            logError(e);
        }
    };
});

// Jika server mengirim lewat postMessage, contoh: { action: 'setSpeed', value: 25 }
window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    const name = d.action || d.type || d.fn || d.name;
    if (!API_NAMES.includes(name) || typeof window[name] !== 'function') return;
    const args = Array.isArray(d.args) ? d.args : [d.value !== undefined ? d.value : (d.state !== undefined ? d.state : d.data)];
    window[name].apply(window, args);
});

function installDebug() {
    const log = {};
    const messages = [];

    const panel = document.createElement('pre');
    panel.style.cssText = 'position:fixed;top:8px;left:8px;margin:0;padding:8px 10px;z-index:9999;' +
        'background:rgba(0,0,0,.78);color:#8ff0a4;font:12px/1.35 Consolas,monospace;border-radius:6px;' +
        'pointer-events:none;max-width:420px;white-space:pre-wrap';
    document.body.appendChild(panel);

    let queued = false;
    const render = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            const rows = API_NAMES.map(n => {
                const e = log[n];
                return e ? `${n.padEnd(18)} ${e.args.map(a => JSON.stringify(a)).join(', ')}  x${e.count}`
                         : `${n.padEnd(18)} (belum dipanggil)`;
            });
            const sound = !CONFIG.seatbeltSound ? 'nonaktif'
                : audioError ? audioError
                : audio ? (audio.paused ? 'siap (belum bunyi)' : 'BUNYI') : 'belum dimuat';
            panel.textContent = 'DEBUG\n' + rows.join('\n') +
                `\n\nsuara seatbelt: ${sound}\nURL: ${audioUrl}` +
                (messages.length ? '\n\nMESSAGE:\n' + messages.join('\n') : '') +
                (errors.length ? '\n\nERROR:\n' + errors.slice(-3).join('\n') : '');
        });
    };

    API_NAMES.forEach(name => {
        const wrapped = window[name];
        window[name] = function () {
            const args = Array.prototype.slice.call(arguments);
            const e = log[name] || (log[name] = { args: args, count: 0 });
            e.args = args;
            e.count++;
            render();
            return wrapped.apply(this, args);
        };
    });

    window.addEventListener('error', ev => { errors.push(ev.message); render(); });
    window.addEventListener('message', ev => {
        let text;
        try { text = JSON.stringify(ev.data); } catch (e) { text = String(ev.data); }
        messages.push(text.slice(0, 110));
        if (messages.length > 4) messages.shift();
        render();
    });
    setInterval(render, 1000);
    render();
}

/* ---------- Inisialisasi ---------- */

function init() {
    if (ready) return;

    el = {
        hud: document.getElementById('hud'),
        engine: document.getElementById('engine'),
        seatbelts: document.getElementById('seatbelts'),
        headlights: document.getElementById('headlights'),
        speed: document.getElementById('speed'),
        speedUnit: document.getElementById('speedUnit'),
        rpmNum: document.getElementById('rpmNum'),
        odometer: document.getElementById('odometer'),
        odoUnit: document.getElementById('odoUnit'),
        fuel: document.getElementById('fuel'),
        fuelCol: document.getElementById('fuelCol'),
        health: document.getElementById('health'),
        healthCol: document.getElementById('healthCol'),
        owner: document.getElementById('owner')
    };

    rpmSegs = makeSegs(document.getElementById('rpmCol'), RPM_COUNT, rpmColor);
    fuelSegs = makeSegs(document.getElementById('fuelPips'), PIP_COUNT);
    healthSegs = makeSegs(document.getElementById('healthPips'), PIP_COUNT);
    gearTabs = makeGearTabs(document.getElementById('gears'));

    fitOwner();
    ensureAudio();

    ready = true;
    renderAll();      // menampilkan data yang sudah diterima sebelum halaman siap

    if (CONFIG.debug || /[?&]debug\b/.test(location.search)) installDebug();
}

// Script ada di akhir body, jadi elemen sudah tersedia dan bisa langsung dipakai.
if (document.getElementById('hud')) {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}
