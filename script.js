const $ = (id) => document.getElementById(id);
const video = $('camera'), overlay = $('overlay'), reference = $('reference');
let stream = null, objectURL = null, locked = false;
let pos = { x: 0, y: 0 }, drag = null;
const settings = { opacity: 50, scale: 100, rotation: 0 };

function render() {
  reference.style.opacity = settings.opacity / 100;
  reference.style.transform = `translate(${pos.x}px, ${pos.y}px) rotate(${settings.rotation}deg) scale(${settings.scale / 100})`;
  $('opacityValue').textContent = `${settings.opacity}%`;
  $('scaleValue').textContent = `${settings.scale}%`;
  $('rotationValue').textContent = `${settings.rotation}°`;
}

$('start').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Kamera için iPhone Safari ve HTTPS bağlantısı gerekiyor.');
    return;
  }
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    video.srcObject = stream;
    await video.play();
    $('status').textContent = 'Kamera açık';
    $('empty').classList.add('hidden');
  } catch (error) {
    $('status').textContent = 'Kamera açılamadı';
    alert(`Kamera açılamadı: ${error.message}. Safari kamera iznini ve HTTPS bağlantısını kontrol et.`);
  }
});

$('file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Lütfen bir fotoğraf seç.'); return; }
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = URL.createObjectURL(file);
  reference.src = objectURL;
  overlay.style.display = 'flex';
  overlay.classList.toggle('movable', !locked);
  $('empty').classList.add('hidden');
  pos = { x: 0, y: 0 };
  render();
});

for (const key of ['opacity','scale','rotation']) {
  $(key).addEventListener('input', (event) => {
    settings[key] = Number(event.target.value);
    render();
  });
}

overlay.addEventListener('pointerdown', (event) => {
  if (locked || !reference.src || drag) return;
  drag = { id: event.pointerId, x: event.clientX - pos.x, y: event.clientY - pos.y };
  overlay.setPointerCapture(event.pointerId);
});
overlay.addEventListener('pointermove', (event) => {
  if (!drag || drag.id !== event.pointerId || locked) return;
  pos.x = event.clientX - drag.x;
  pos.y = event.clientY - drag.y;
  render();
});
function endDrag(event) { if (drag?.id === event.pointerId) drag = null; }
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);

$('lock').addEventListener('click', () => {
  locked = !locked;
  overlay.classList.toggle('movable', !locked);
  $('lock').textContent = locked ? '🔒 Kilidi aç' : '🔓 Konumu kilitle';
});
$('reset').addEventListener('click', () => {
  pos = { x: 0, y: 0 };
  Object.assign(settings, { opacity: 50, scale: 100, rotation: 0 });
  for (const key of Object.keys(settings)) $(key).value = settings[key];
  render();
});
$('hide').addEventListener('click', () => {
  $('controls').classList.add('hidden');
  $('show').classList.remove('hidden');
});
$('show').addEventListener('click', () => {
  $('show').classList.add('hidden');
  $('controls').classList.remove('hidden');
});
window.addEventListener('pagehide', () => {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (objectURL) URL.revokeObjectURL(objectURL);
});
render();
