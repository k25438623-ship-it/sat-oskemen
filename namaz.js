(function () {
  const OSKEMEN = { lat: 49.9488, lng: 82.6285, label: 'Оскемен' };
  const KAABA = { lat: 21.4225, lng: 39.8262 };
  const CACHE_KEY = 'sat_namaz_oskemen_v1';

  let geo = { ...OSKEMEN };
  let qiblaDeg = calcQibla(geo.lat, geo.lng);
  let smoothHeading = null;
  let sensorActive = false;

  function toRad(d) { return (d * Math.PI) / 180; }
  function toDeg(r) { return (r * 180) / Math.PI; }

  function calcQibla(lat, lng) {
    const p1 = toRad(lat);
    const p2 = toRad(KAABA.lat);
    const dl = toRad(KAABA.lng - lng);
    const y = Math.sin(dl);
    const x = Math.cos(p1) * Math.tan(p2) - Math.sin(p1) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function dirRu(deg) {
    const d = ((deg % 360) + 360) % 360;
    if (d >= 337.5 || d < 22.5) return 'С';
    if (d < 67.5) return 'СВ';
    if (d < 112.5) return 'В';
    if (d < 157.5) return 'ЮВ';
    if (d < 202.5) return 'Ю';
    if (d < 247.5) return 'ЮЗ';
    if (d < 292.5) return 'З';
    return 'СЗ';
  }

  function fmtTime(val) {
    const m = String(val || '').match(/(\d{1,2}:\d{2})/);
    if (!m) return '--:--';
    const [h, min] = m[1].split(':');
    return `${String(Number(h)).padStart(2, '0')}:${String(Number(min)).padStart(2, '0')}`;
  }

  function reserveTimes(dateObj, lat, lng) {
    const tz = -dateObj.getTimezoneOffset() / 60;
    const start = new Date(dateObj.getFullYear(), 0, 0);
    const doy = Math.floor((dateObj - start) / 86400000);
    const g = ((2 * Math.PI) / 365) * (doy - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const noon = 720 - 4 * lng - eq + tz * 60;
    const latR = toRad(lat);

    function ha(ang) {
      const c = (Math.cos(toRad(90 + ang)) - Math.sin(latR) * Math.sin(decl)) / (Math.cos(latR) * Math.cos(decl));
      if (c < -1 || c > 1) return null;
      return toDeg(Math.acos(c)) * 4;
    }

    const fOff = ha(18);
    const iOff = ha(17);
    const mOff = ha(0.833);
    const asrT = 1 + Math.tan(Math.abs(latR - decl));
    const asrC = (Math.sin(Math.atan(1 / asrT)) - Math.sin(latR) * Math.sin(decl)) / (Math.cos(latR) * Math.cos(decl));
    const aOff = (asrC >= -1 && asrC <= 1) ? toDeg(Math.acos(asrC)) * 4 : 180;

    function minToStr(v) {
      const tot = ((Math.round(v) % 1440) + 1440) % 1440;
      return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
    }

    return {
      Fajr: minToStr(noon - (fOff || 330)),
      Dhuhr: minToStr(noon + 5),
      Asr: minToStr(noon + aOff),
      Maghrib: minToStr(noon + (mOff || 240) + 2),
      Isha: minToStr(noon + (iOff || 315))
    };
  }

  function paintTimes(times, note) {
    const ids = { ptFajr: times.Fajr, ptDhuhr: times.Dhuhr, ptAsr: times.Asr, ptMaghrib: times.Maghrib, ptIsha: times.Isha };
    Object.entries(ids).forEach(([id, v]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmtTime(v);
    });
    const st = document.getElementById('namazSourceStatus');
    if (st && note) st.textContent = note;
    const prev = document.getElementById('profileNamazPreview');
    if (prev) {
      prev.textContent = `${geo.label} • Фаджр ${fmtTime(times.Fajr)} • Магриб ${fmtTime(times.Maghrib)} • Кибла ${Math.round(qiblaDeg)}°`;
    }
  }

  function paintCompass() {
    qiblaDeg = calcQibla(geo.lat, geo.lng);
    const deg = Math.round(qiblaDeg);
    const dir = dirRu(qiblaDeg);

    const locEl = document.getElementById('namazLocationLabel');
    if (locEl) locEl.textContent = `${geo.label} • Расписание на сегодня`;

    const titleEl = document.getElementById('qiblaBearingTitle');
    if (titleEl) titleEl.textContent = `Кибла: ${deg}° (${dir})`;

    const layer = document.getElementById('qiblaNeedleLayer');
    const courseEl = document.getElementById('qiblaLiveCourse');
    if (smoothHeading !== null) {
      const rot = (qiblaDeg - smoothHeading + 360) % 360;
      if (layer) layer.style.transform = `rotate(${rot.toFixed(1)}deg)`;
      if (courseEl) courseEl.textContent = `Курс телефона: ${Math.round(smoothHeading)}° (${dirRu(smoothHeading)})`;
    } else {
      if (layer) layer.style.transform = `rotate(${deg}deg)`;
      if (courseEl) courseEl.textContent = `Азимут на Каабу: ${deg}° (${dir})`;
    }
  }

  function readCache(dayKey) {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (raw && raw.key === dayKey && raw.times) return raw.times;
    } catch (e) {}
    return null;
  }

  function writeCache(dayKey, times) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key: dayKey, times })); } catch (e) {}
  }

  window.syncOskemenPrayerTimes = async function (force = false) {
    const now = new Date();
    const dayKey = `${geo.label}_${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    paintCompass();

    const cached = !force ? readCache(dayKey) : null;
    if (cached) {
      paintTimes(cached, `${geo.label} • Актуальное расписание на сегодня`);
      return;
    }

    const fb = reserveTimes(now, geo.lat, geo.lng);
    paintTimes(fb, `${geo.label} • Загружаем расписание...`);

    try {
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const url = `https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${geo.lat}&longitude=${geo.lng}&method=15&timezonestring=Asia/Almaty`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP');
      const json = await res.json();
      const t = json?.data?.timings;
      if (t && t.Fajr && t.Dhuhr && t.Asr && t.Maghrib && t.Isha) {
        const clean = {
          Fajr: fmtTime(t.Fajr),
          Dhuhr: fmtTime(t.Dhuhr),
          Asr: fmtTime(t.Asr),
          Maghrib: fmtTime(t.Maghrib),
          Isha: fmtTime(t.Isha)
        };
        writeCache(dayKey, clean);
        paintTimes(clean, `${geo.label} • Расписание на ${dd}.${mm}.${yyyy}`);
        return;
      }
    } catch (e) {}

    paintTimes(fb, `${geo.label} • Резервное расчётное время`);
  };

  function onSensor(ev) {
    let h = null;
    if (typeof ev.webkitCompassHeading === 'number' && !Number.isNaN(ev.webkitCompassHeading)) {
      h = ((ev.webkitCompassHeading % 360) + 360) % 360;
    } else if (typeof ev.alpha === 'number' && !Number.isNaN(ev.alpha)) {
      h = ((360 - ev.alpha) % 360 + 360) % 360;
    }
    if (h === null) return;
    if (smoothHeading === null) {
      smoothHeading = h;
    } else {
      const diff = ((h - smoothHeading + 540) % 360) - 180;
      smoothHeading = ((smoothHeading + diff * 0.28) % 360 + 360) % 360;
    }
    paintCompass();
  }

  window.activateLiveCompass = async function () {
    const st = document.getElementById('qiblaSensorStatus');
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          if (st) st.textContent = 'Датчик не разрешён — стрелка показывает азимут';
          return;
        }
      }
      if (!sensorActive) {
        window.addEventListener('deviceorientationabsolute', onSensor, true);
        window.addEventListener('deviceorientation', onSensor, true);
        sensorActive = true;
      }
      if (st) st.textContent = 'Живой компас включён — поверните телефон';
    } catch (e) {
      if (st) st.textContent = 'Датчик ориентации недоступен на этом устройстве';
    }
  };

  window.useDeviceGeoForQibla = function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Ваши координаты' };
      paintCompass();
      window.syncOskemenPrayerTimes(true);
    }, () => {
      geo = { ...OSKEMEN };
      paintCompass();
      window.syncOskemenPrayerTimes(true);
    }, { timeout: 6000 });
  };

  window.openNamazQiblaModal = function () {
    window.syncOskemenPrayerTimes(false);
    if (!sensorActive) window.activateLiveCompass().catch(() => {});
    const modal = document.getElementById('namazQiblaModal');
    if (modal) modal.classList.add('open');
  };

  window.syncOskemenPrayerTimes(false);
})();
