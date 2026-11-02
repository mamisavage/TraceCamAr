const $ = id => document.getElementById(id);
const video = $('camera'), overlay = $('overlay'), reference = $('reference');
let stream = null, objectURL = null, locked = false, busy = false;
let devices = [], activeDevice = '', facing = 'environment', generation = 0;
let pos = { x: 0, y: 0 }, gesture = null, imageRequest = 0;
const pointers = new Map();
const referenceHint = 'Tek parmakla taşı; iki parmakla büyüt, küçült ve döndür.';
let zoomRange = { min: 1, max: 5, step: 0.1 }, hardwareZoom = false, zoomValue = 1;
let requestedZoom = null, zoomRunning = false;
const settings = { opacity: 50, scale: 100, rotation: 0 };
const formatZoom = value => `${Number(Number(value).toFixed(2))}×`;
function message(text) {
  $('message').textContent = text;
  $('message').classList.toggle('hidden', !text);
}
function render() {
  reference.style.opacity = settings.opacity / 100;
  reference.style.transform = `translate(${pos.x}px, ${pos.y}px) rotate(${settings.rotation}deg) scale(${settings.scale / 100})`;
  $('opacityValue').textContent = `${settings.opacity}%`;
  $('scaleValue').textContent = `${Math.round(settings.scale)}%`;
  $('rotationValue').textContent = `${Math.round(settings.rotation)}°`;
  for (const key of Object.keys(settings)) $(key).value = settings[key];
}
function updateControls() {
  const live = Boolean(stream);
  $('zoom').disabled = !live || busy;
  $('lens').disabled = !live || busy || !devices.length;
  $('flip').disabled = !live || busy;
  $('stop').disabled = !live || busy;
  $('start').disabled = busy;
  $('status').disabled = live || busy;
  $('status').setAttribute('aria-label', live ? 'Kamera açık' : 'Kamerayı aç');
  document.querySelector('.app').classList.toggle('is-live', live);
  $('empty').classList.toggle('hidden', live || Boolean(objectURL));
  $('status').textContent = busy ? 'BAĞLANIYOR…' : live ? 'KAMERA AÇIK' : 'KAMERA KAPALI · AÇ';
  for (const button of $('zoomPresets').children) button.disabled = !live || busy;
}
function renderZoom() {
  $('zoom').value = zoomValue;
  $('zoomValue').textContent = formatZoom(zoomValue);
  video.style.transform = hardwareZoom ? '' : `scale(${zoomValue})`;
  for (const button of $('zoomPresets').children) button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.zoom) - zoomValue) < 0.025));
}
function configureZoom(track) {
  let capability;
  try { capability = track?.getCapabilities?.().zoom; } catch { /* Capability access is optional. */ }
  hardwareZoom = Boolean(capability && Number.isFinite(capability.min) && Number.isFinite(capability.max) && capability.max > capability.min);
  zoomRange = hardwareZoom ? { min: capability.min, max: capability.max, step: capability.step || 0.1 } : { min: 1, max: 5, step: 0.1 };
  zoomValue = hardwareZoom ? track.getSettings().zoom ?? zoomRange.min : 1;
  Object.assign($('zoom'), { min: zoomRange.min, max: zoomRange.max, step: zoomRange.step });
  $('zoomType').textContent = track ? hardwareZoom ? 'KAMERA ZOOMU' : 'DİJİTAL ZOOM' : 'KAMERANI HAZIRLA';
  $('zoomPresets').replaceChildren();
  const presets = [...new Set([zoomRange.min, 1, 2, 3, 5].filter(n => n >= zoomRange.min && n <= zoomRange.max))];
  for (const value of presets) {
    const button = document.createElement('button');
    button.textContent = formatZoom(value);
    button.dataset.zoom = value;
    button.setAttribute('aria-label', `${formatZoom(value)} yakınlaştır`);
    button.addEventListener('click', () => setZoom(value));
    $('zoomPresets').append(button);
  }
  renderZoom();
}
async function setZoom(value) {
  if (!stream || busy) return;
  const snapped = zoomRange.min + Math.round((value - zoomRange.min) / zoomRange.step) * zoomRange.step;
  requestedZoom = Math.min(zoomRange.max, Math.max(zoomRange.min, snapped));
  if (zoomRunning) return;
  zoomRunning = true;
  try {
    while (requestedZoom !== null && stream) {
      const next = requestedZoom, track = stream.getVideoTracks()[0], version = generation;
      requestedZoom = null;
      try {
        if (hardwareZoom) await track.applyConstraints({ advanced: [{ zoom: next }] });
        if (version !== generation) continue;
        zoomValue = hardwareZoom ? track.getSettings().zoom ?? next : next;
        renderZoom();
      } catch {
        if (version !== generation) continue;
        message('Bu zoom seviyesi uygulanamadı. Başka bir seviye deneyebilirsin.');
        renderZoom();
      }
    }
  } finally { zoomRunning = false; }
}
async function refreshDevices() {
  const version = generation;
  const available = await navigator.mediaDevices.enumerateDevices();
  if (version !== generation || !stream) return;
  devices = available.filter(device => device.kind === 'videoinput' && device.deviceId);
  $('lens').replaceChildren();
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Kamera ${index + 1}`;
    $('lens').append(option);
  });
  $('lens').value = activeDevice;
  $('lensNote').textContent = devices.length > 1 ? 'Listeden bir kamera veya lens seç. Yalnızca tarayıcının erişebildiği lensler gösterilir.' : 'Tarayıcı tek kamera sunuyor. Diğer fiziksel lensler ayrı olarak erişilebilir olmayabilir.';
  updateControls();
}
function releaseCamera() {
  generation++;
  requestedZoom = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
}
async function openCamera(deviceId, desiredFacing = facing) {
  if (busy) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    message('Kamera erişimi için uygulamayı HTTPS veya localhost üzerinden açmalısın.');
    return;
  }
  busy = true;
  message('');
  releaseCamera();
  const version = generation;
  updateControls();
  try {
    const constraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: desiredFacing } };
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...constraints, width: { ideal: 1920 }, height: { ideal: 1440 } } });
    if (version !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    video.srcObject = stream;
    await video.play();
    if (version !== generation) return;
    const track = stream.getVideoTracks()[0];
    activeDevice = track.getSettings().deviceId || deviceId || '';
    facing = track.getSettings().facingMode || desiredFacing;
    configureZoom(track);
    track.addEventListener('ended', () => {
      if (version !== generation) return;
      stopCamera();
      message('Kamera bağlantısı kesildi. Yeniden açabilirsin.');
    });
    try { await refreshDevices(); } catch { message('Kamera açıldı ancak lens listesi alınamadı.'); }
    $('bottomHint').textContent = objectURL ? referenceHint : 'Sol alttan bir referans fotoğrafı seç.';
  } catch (error) {
    if (version !== generation) return;
    releaseCamera();
    configureZoom(null);
    const errors = { NotAllowedError: 'Kamera izni verilmedi. Tarayıcı ayarlarından kamera erişimine izin verip tekrar dene.', NotFoundError: 'Kamera bulunamadı. Bir kamera bağlayıp tekrar dene.', NotReadableError: 'Kamera kullanılamıyor. Kamerayı kullanan başka bir uygulama varsa kapat.', OverconstrainedError: 'Seçilen lens kullanılamıyor. Kamerayı yeniden açıp başka bir lens seç.' };
    message(errors[error.name] || 'Kamera açılamadı. Kamera izinlerini ve bağlantını kontrol edip yeniden dene.');
  } finally { busy = false; updateControls(); }
}
function stopCamera() { releaseCamera(); configureZoom(null); updateControls(); }
$('start').addEventListener('click', () => openCamera());
$('stop').addEventListener('click', () => { stopCamera(); setSettings(false); });
$('status').addEventListener('click', () => { if (!stream) openCamera(); });
$('lens').addEventListener('change', event => openCamera(event.target.value));
$('flip').addEventListener('click', () => {
  if (devices.length > 1) {
    const index = devices.findIndex(device => device.deviceId === activeDevice);
    openCamera(devices[(index + 1) % devices.length].deviceId);
  } else openCamera(null, facing === 'user' ? 'environment' : 'user');
});
$('zoom').addEventListener('input', event => setZoom(Number(event.target.value)));
navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (stream) refreshDevices().catch(() => message('Kamera listesi güncellenemedi.')); });
$('pickImage').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { message('Lütfen bir görsel dosyası seç.'); return; }
  const nextURL = URL.createObjectURL(file), probe = new Image(), version = ++imageRequest;
  probe.onload = () => {
    if (version !== imageRequest) { URL.revokeObjectURL(nextURL); return; }
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = nextURL;
    reference.src = objectURL;
    $('thumbnail').src = objectURL;
    $('thumbnail').classList.remove('hidden');
    overlay.classList.remove('hidden');
    $('lock').disabled = false;
    setLocked(false);
    resetReference();
    message('');
    $('bottomHint').textContent = referenceHint;
    updateControls();
  };
  probe.onerror = () => { URL.revokeObjectURL(nextURL); if (version === imageRequest) message('Görsel açılamadı. JPG, PNG veya WebP biçiminde başka bir görsel seç.'); };
  probe.src = nextURL;
  event.target.value = '';
});
for (const key of Object.keys(settings)) $(key).addEventListener('input', event => { clearGesture(); settings[key] = Number(event.target.value); render(); });
function pointerGeometry() {
  const [a, b] = pointers.values();
  if (!a) return null;
  if (!b) return { x: a.x, y: a.y };
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x)
  };
}
function clearGesture() {
  const captured = [...pointers.keys()];
  pointers.clear();
  gesture = null;
  for (const id of captured) {
    if (overlay.hasPointerCapture(id)) overlay.releasePointerCapture(id);
  }
}
overlay.addEventListener('pointerdown', event => {
  if (locked || !objectURL || pointers.size >= 2 || (event.pointerType === 'mouse' && event.button !== 0)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  overlay.setPointerCapture(event.pointerId);
  gesture = pointerGeometry();
});
overlay.addEventListener('pointermove', event => {
  if (locked || !gesture || !pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const next = pointerGeometry();
  if (pointers.size === 2 && gesture.distance > 1 && next.distance > 1) {
    const scale = Math.min(Number($('scale').max), Math.max(Number($('scale').min), settings.scale * next.distance / gesture.distance));
    const ratio = scale / settings.scale;
    const angle = Math.atan2(Math.sin(next.angle - gesture.angle), Math.cos(next.angle - gesture.angle));
    const rect = overlay.getBoundingClientRect();
    // Keep the point between the fingers anchored while scaling and rotating.
    const x = rect.left + rect.width / 2 + pos.x - gesture.x;
    const y = rect.top + rect.height / 2 + pos.y - gesture.y;
    pos = {
      x: next.x + ratio * (x * Math.cos(angle) - y * Math.sin(angle)) - rect.left - rect.width / 2,
      y: next.y + ratio * (x * Math.sin(angle) + y * Math.cos(angle)) - rect.top - rect.height / 2
    };
    settings.scale = scale;
    settings.rotation = ((settings.rotation + angle * 180 / Math.PI + 180) % 360 + 360) % 360 - 180;
  } else {
    pos.x += next.x - gesture.x;
    pos.y += next.y - gesture.y;
  }
  gesture = next;
  render();
});
function endGesture(event) {
  if (!pointers.delete(event.pointerId)) return;
  if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
  gesture = pointerGeometry();
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) overlay.addEventListener(event, endGesture);
window.addEventListener('blur', clearGesture);
window.addEventListener('pagehide', clearGesture);
function setLocked(value) {
  locked = value;
  clearGesture();
  overlay.classList.toggle('movable', !locked);
  $('lock').setAttribute('aria-pressed', String(locked));
  $('lock').setAttribute('aria-label', locked ? 'Referans kilidini aç' : 'Referans konumunu kilitle');
  $('lockLabel').textContent = locked ? 'KİLİDİ AÇ' : 'KONUMU KİLİTLE';
  $('lockHint').classList.toggle('hidden', !locked);
}
$('lock').addEventListener('click', () => setLocked(!locked));
function resetReference() {
  clearGesture();
  pos = { x: 0, y: 0 };
  Object.assign(settings, { opacity: 50, scale: 100, rotation: 0 });
  for (const key of Object.keys(settings)) $(key).value = settings[key];
  render();
}
$('reset').addEventListener('click', resetReference);
function setSettings(open) {
  clearGesture();
  $('controls').classList.toggle('hidden', !open);
  $('settingsToggle').setAttribute('aria-expanded', String(open));
  $('settingsToggle').setAttribute('aria-label', open ? 'Ayarları kapat' : 'Ayarları aç');
  (open ? $('closeSettings') : $('settingsToggle')).focus();
}
$('settingsToggle').addEventListener('click', () => setSettings($('controls').classList.contains('hidden')));
$('closeSettings').addEventListener('click', () => setSettings(false));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('controls').classList.contains('hidden')) setSettings(false); });
$('gridToggle').addEventListener('click', () => $('gridToggle').setAttribute('aria-pressed', String(!$('grid').classList.toggle('hidden'))));
window.addEventListener('pagehide', stopCamera);
render();
configureZoom(null);
updateControls();
