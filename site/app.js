import { config } from './config.js';
import { GitHubClient, validateJournal, validPhotoPath } from './github.js';
import { pointInCity, viewportPaddedBounds } from './geography.js';

const $ = selector => document.querySelector(selector);
const create = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const state = { journal: { version: 1, memories: [] }, client: null, selected: null, picking: false, draft: null, photos: [], saving: false, loaded: false, freshPhotos: new Map() };
const bangkok = [13.745, 100.515];
const [cityBoundary,railNetwork] = await Promise.all(['data/bangkok-boundary.geojson','data/bangkok-rail.geojson'].map(async path => {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Bangkok map data could not be loaded. Please refresh.');
  return response.json();
}));
const [west,south,east,north] = cityBoundary.bbox;
const cityBounds = L.latLngBounds([south,west],[north,east]);
for (const line of railNetwork.features) {
  const item = create('div','rail-legend-item');
  const swatch = create('span'); swatch.style.backgroundColor = line.properties.color; swatch.setAttribute('aria-hidden','true');
  item.append(swatch,create('span',null,line.properties.name)); $('#rail-legend-grid').append(item);
}
const repoUrl = `https://github.com/${config.owner}/${config.repo}`;
$('#repo-link').href = repoUrl;
$('#owner-name').textContent = config.owner;
$('#create-key').href = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({name:'My Bangkok journal',description:'Save memories to bangkok-journal. Select only the bangkok-journal repository.',target_name:config.owner,contents:'write',expires_in:'90'})}`;
const map = L.map('map', { zoomControl: false, scrollWheelZoom: true, minZoom: 9, maxZoom: 19, maxBoundsViscosity:1 }).setView(bangkok, 13);
map.attributionControl.setPrefix(false);
function updatePanBounds() {
  const size = map.getSize();
  const padded = viewportPaddedBounds(map.project(cityBounds.getNorthWest()),map.project(cityBounds.getSouthEast()),size.x,size.y);
  map.setMaxBounds(L.latLngBounds(map.unproject(L.point(padded.northwest.x,padded.northwest.y)),map.unproject(L.point(padded.southeast.x,padded.southeast.y))));
}
map.on('zoomend resize',updatePanBounds);
updatePanBounds();
const vectorLayer = L.maplibreGL({
  style: new URL('map-style.json', document.baseURI).href,
  attributionControl: { customAttribution: '<a href="https://openfreemap.org">OpenFreeMap</a> · &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> / <a href="https://openmaptiles.org">OpenMapTiles</a> · Rail: <a href="https://namtang-api.otp.go.th/opendata">OTP</a> · Boundary: <a href="https://www.geoboundaries.org">geoBoundaries</a>' },
}).addTo(map);
const vectorMap = vectorLayer.getMaplibreMap();
let showRail = true;
function updateRailVisibility() {
  if (!vectorMap.getLayer('rail-lines')) return;
  for (const id of ['national-rail','rail-casing','rail-lines','rail-stations','rail-station-labels']) vectorMap.setLayoutProperty(id,'visibility',showRail ? 'visible' : 'none');
}
vectorMap.on('load',updateRailVisibility);
$('#rail-toggle').onclick = () => {
  showRail = !showRail;
  $('#rail-toggle').setAttribute('aria-pressed',String(showRail));
  updateRailVisibility();
};
const markers = L.layerGroup().addTo(map);
let pickingMarker = null;
let toastTimer;
function notify(message, persistent = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  if (!persistent) toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 7000);
}
function friendlyDate(date) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`)); }
function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function memorySort(a,b) { return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt); }
function photoUrl(photo) {
  if (!validPhotoPath(photo.path)) return '';
  return state.freshPhotos.get(photo.path) || new URL(photo.path, document.baseURI).href;
}
function filteredMemories() {
  const query = $('#search').value.trim().toLowerCase();
  return state.journal.memories.filter(m => (!$('#day-filter').value || m.date === $('#day-filter').value) && (!$('#tag-filter').value || m.tag === $('#tag-filter').value) && (!query || `${m.title} ${m.place} ${m.note}`.toLowerCase().includes(query))).sort(memorySort);
}
function render() {
  const memories = state.journal.memories;
  $('#memory-count').textContent = `${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}`;
  const days = [...new Set(memories.map(m => m.date))].sort();
  $('#day-count').textContent = days.length ? `${days.length} ${days.length === 1 ? 'day' : 'days'} to remember` : 'a story in the making';
  const selectedDay = $('#day-filter').value;
  $('#day-filter').replaceChildren(new Option('All days', ''));
  days.forEach(day => $('#day-filter').add(new Option(friendlyDate(day), day)));
  $('#day-filter').value = days.includes(selectedDay) ? selectedDay : '';
  $('#map-hint').hidden = !!memories.length || state.picking;
  $('#add-button').hidden = !state.client;
  $('#owner-button').textContent = state.client ? '✓ Editing unlocked' : '↗ Owner access';
  const list = $('#memory-list'); list.replaceChildren();
  const visible = filteredMemories();
  if (!memories.length) {
    const empty = create('div', 'empty-state');
    const drawing = create('div','empty-illustration'); drawing.setAttribute('aria-hidden','true'); drawing.append(create('span','ticket'),create('span','ticket front','✳'));
    empty.append(drawing,create('h3',null,'The best souvenirs are stories.'),create('p',null,state.client ? 'Add your first memory, then choose its place on the map. A street, a temple, a table for two.' : 'This atlas is waiting for its first memory. Soon, these streets will hold photographs and stories.'));
    const action = create('button','text-button',state.client ? '＋ Keep your first memory' : 'Owner? Start your story ↗'); action.type = 'button'; action.onclick = state.client ? beginMemory : openOwner; empty.append(action); list.append(empty);
  } else if (!visible.length) list.append(create('p','empty-results','No memories here yet. Try another day or search.'));
  else visible.forEach(memory => {
    const card = create('button',`memory-card${state.selected === memory.id ? ' selected' : ''}`); card.type = 'button'; card.setAttribute('aria-label',`${memory.title}, ${memory.place}, ${friendlyDate(memory.date)}`);
    if (memory.photos.length) { const img = create('img'); img.src = photoUrl(memory.photos[0]); img.alt = memory.photos[0].alt; img.loading = 'lazy'; card.append(img); }
    card.append(create('div','card-meta',`${friendlyDate(memory.date)} / ${memory.tag}`),create('h3',null,memory.title),create('div','card-place',`⌖ ${memory.place}`),create('p','card-note',memory.note));
    card.onclick = () => selectMemory(memory.id); list.append(card);
  });
  renderMarkers(visible);
  if (state.selected && !visible.some(m => m.id === state.selected)) closeDetail();
}
function renderMarkers(memories) {
  markers.clearLayers();
  memories.forEach((memory, index) => {
    const icon = L.divIcon({ className: '', html: `<div class="memory-pin${state.selected === memory.id ? ' selected' : ''}"><span>${index+1}</span></div>`, iconSize:[37,43],iconAnchor:[18,40] });
    const marker = L.marker([memory.lat,memory.lng], { icon, title: memory.title, alt: memory.title }).addTo(markers);
    marker.on('click', () => selectMemory(memory.id));
    const tooltip = create('span',null,memory.title); marker.bindTooltip(tooltip, { direction:'top',offset:[0,-38] });
  });
}
function selectMemory(id, fly = true) {
  const memory = state.journal.memories.find(m => m.id === id); if (!memory) return;
  state.selected = id; render();
  const detail = $('#detail'); detail.replaceChildren(); detail.hidden = false;
  const close = create('button','icon-button detail-close','×'); close.setAttribute('aria-label','Close memory'); close.onclick = closeDetail;
  detail.append(close,create('div','detail-date',`${friendlyDate(memory.date)} · ${memory.tag}`),create('h2',null,memory.title),create('div','detail-place',`⌖ ${memory.place}`));
  const photoButton = photo => {
    const button = create('button','detail-photo'); const img = create('img'); img.src = photoUrl(photo); img.alt = photo.alt; button.append(img); button.setAttribute('aria-label',`Open photograph: ${photo.alt}`);
    button.onclick = () => { $('#full-photo').src = photoUrl(photo); $('#full-photo').alt = photo.alt; $('#photo-dialog').showModal(); }; return button;
  };
  if (memory.photos.length) detail.append(photoButton(memory.photos[0]));
  if (memory.photos.length > 1) { const gallery = create('div','detail-gallery'); memory.photos.slice(1).forEach(p => gallery.append(photoButton(p))); detail.append(gallery); }
  detail.append(create('p','detail-note',memory.note));
  if (state.client) {
    const actions = create('div','detail-bottom'); const edit = create('button','button secondary','Edit memory'); edit.onclick = () => editMemory(memory);
    const remove = create('button','button quiet','Delete'); remove.onclick = () => { $('#delete-error').textContent = ''; $('#delete-dialog').showModal(); };
    actions.append(edit,remove); detail.append(actions);
  }
  if (fly) { const targetZoom = Math.max(map.getZoom(),15); map.flyTo([memory.lat,memory.lng],targetZoom,{ duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .6 }); }
  if (fly && innerWidth <= 650) $('.map-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'center'});
}
function closeDetail() { state.selected = null; $('#detail').hidden = true; renderMarkers(filteredMemories()); document.querySelectorAll('.memory-card.selected').forEach(el => el.classList.remove('selected')); }
function fitMap() {
  closeDetail(); const visible = filteredMemories();
  if (visible.length) map.fitBounds(L.latLngBounds(visible.map(m => [m.lat,m.lng])),{padding:[65,95],maxZoom:16});
  else map.fitBounds(cityBounds,{padding:[30,55]});
}
async function loadJournal() {
  try {
    const response = await fetch(`data/memories.json?t=${Date.now()}`, { cache:'no-store' });
    if (!response.ok) throw new Error('The journal could not be loaded.');
    state.journal = validateJournal(await response.json()); state.loaded = true; render();
    if (state.journal.memories.length) fitMap();
  } catch {
    const error = create('div','load-error','The journal could not be loaded. Please check your connection and try again.');
    const retry = create('button','button secondary','Try again'); retry.onclick = loadJournal; error.append(document.createElement('br'),retry); $('#memory-list').replaceChildren(error);
  }
}
function openOwner() {
  $('#owner-error').textContent = ''; $('#connect-fields').hidden = !!state.client; $('#connect-button').hidden = !!state.client; $('#disconnect-button').hidden = !state.client;
  $('#access-key').required = !state.client; $('#owner-dialog').showModal();
}
$('#owner-form').onsubmit = async event => {
  event.preventDefault(); if (state.client) return;
  const button = $('#connect-button'); button.disabled = true; button.textContent = 'Checking your key…'; $('#owner-error').textContent = '';
  const token = $('#access-key').value.trim(); $('#access-key').value = '';
  const client = new GitHubClient(token);
  try {
    await client.authenticate(); const latest = await client.readLatest(); state.journal = latest.journal; state.loaded = true; state.client = client;
    $('#owner-dialog').close(); render(); notify('Welcome back. Your journal is unlocked in this tab.');
  } catch (error) { client.lock(); $('#owner-error').textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Unlock my journal ↗'; }
};
function lockEditing() {
  if (state.saving) return;
  state.client?.lock(); state.client = null; $('#access-key').value = ''; cancelPicking();
  $('#owner-dialog').close(); $('#editor-dialog').close(); clearDraft(); render();
  if (state.selected) selectMemory(state.selected,false); notify('Editing locked.');
}
$('#disconnect-button').onclick = lockEditing;
$('#owner-button').onclick = openOwner;
$('#add-button').onclick = beginMemory;
function clearDraft() {
  state.photos.forEach(photo => { if (photo.preview) URL.revokeObjectURL(photo.preview); });
  state.photos = []; state.draft = null;
}
function beginMemory() {
  if (!state.client) return openOwner();
  if (!state.loaded) return notify('Load the journal before adding a memory.');
  clearDraft();
  const timestamp = new Date().toISOString();
  state.draft = { id:crypto.randomUUID(), title:'', place:'', note:'', date:localDate(), tag:'Little things', lat:bangkok[0], lng:bangkok[1], photos:[],createdAt:timestamp,updatedAt:timestamp };
  $('#memory-form').reset(); $('#photo-previews').replaceChildren(); $('#memory-date').value = state.draft.date;
  $('#editor-error').textContent = ''; $('#editor-title').innerHTML = 'Keep this <em>moment.</em>';
  startPicking();
}
function startPicking() {
  closeDetail(); state.picking = true; $('#editor-dialog').close(); $('#place-picker').hidden = false; $('#map-hint').hidden = true; $('.map-section').classList.add('picking');
  if (innerWidth <= 650) $('.map-section').scrollIntoView({behavior:'smooth',block:'center'});
}
function cancelPicking() {
  state.picking = false; $('#place-picker').hidden = true; $('.map-section').classList.remove('picking');
  if (pickingMarker) { map.removeLayer(pickingMarker); pickingMarker = null; }
  $('#map-hint').hidden = !!state.journal.memories.length;
}
$('#cancel-pick').onclick = () => { cancelPicking(); if (state.draft?.hasLocation) openEditor(); else clearDraft(); };
map.on('click', event => {
  if (!state.picking || !state.client) return;
  if (!pointInCity(event.latlng.lng,event.latlng.lat,cityBoundary)) return notify('Choose a place inside Bangkok’s city boundary.');
  state.draft.lat = Number(event.latlng.lat.toFixed(6)); state.draft.lng = Number(event.latlng.lng.toFixed(6)); state.draft.hasLocation = true;
  cancelPicking(); openEditor();
});
function openEditor() {
  if (!state.draft || !state.client) return;
  $('#location-summary').textContent = `${state.draft.lat.toFixed(5)}° N, ${state.draft.lng.toFixed(5)}° E`;
  $('#editor-dialog').showModal();
}
function captureDraft() {
  if (!state.draft) return;
  Object.assign(state.draft, {title:$('#memory-title').value.trim(),place:$('#memory-place').value.trim(),note:$('#memory-note').value.trim(),date:$('#memory-date').value,tag:$('#memory-tag').value});
}
$('#change-location').onclick = () => { captureDraft(); startPicking(); };
function editMemory(memory) {
  clearDraft(); state.draft = { ...structuredClone(memory), baseUpdatedAt:memory.updatedAt, hasLocation:true };
  $('#memory-form').reset();
  for (const key of ['title','place','note','date','tag']) $(`#memory-${key}`).value = memory[key];
  state.photos = memory.photos.map(photo => ({ ...photo, existing:true })); renderPhotoPreviews();
  $('#editor-title').innerHTML = 'Revisit this <em>moment.</em>'; $('#editor-error').textContent = ''; openEditor();
}
async function preparePhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Please choose JPEG, PNG, or WebP photographs.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Please choose photographs smaller than 25 MB each.');
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation:'from-image' }); } catch { throw new Error('One photograph could not be opened. Try another image.'); }
  const scale = Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').fillStyle = '#ffffff'; canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height); canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.83)); if (!blob) throw new Error('The photograph could not be resized.');
  const base64 = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('The photograph could not be read.')); reader.readAsDataURL(blob); });
  return { path:`photos/${state.draft.id}/${crypto.randomUUID()}.jpg`,alt:file.name.replace(/\.[^.]+$/,'').slice(0,180),base64,preview:URL.createObjectURL(blob),existing:false };
}
let preparingPhotos = false;
$('#memory-photos').onchange = async event => {
  const files = [...event.target.files]; event.target.value = ''; if (!files.length) return;
  if (state.photos.length + files.length > 8) { $('#editor-error').textContent = 'You can keep up to 8 photographs in one memory.'; return; }
  preparingPhotos = true; $('#save-button').disabled = true; $('#editor-error').textContent = 'Preparing your photographs…';
  try { for (const file of files) state.photos.push(await preparePhoto(file)); renderPhotoPreviews(); $('#editor-error').textContent = ''; }
  catch (error) { $('#editor-error').textContent = error.message; renderPhotoPreviews(); }
  finally { preparingPhotos = false; $('#save-button').disabled = false; }
};
function renderPhotoPreviews() {
  const previews = $('#photo-previews'); previews.replaceChildren();
  state.photos.forEach((photo,index) => { const wrap = create('div','photo-preview'); const img = create('img'); img.src = photo.preview || photoUrl(photo); img.alt = photo.alt;
    const remove = create('button',null,'×'); remove.type = 'button'; remove.setAttribute('aria-label',`Remove photograph ${index+1}`); remove.onclick = () => { if (state.saving) return; if (photo.preview) URL.revokeObjectURL(photo.preview); state.photos.splice(index,1); renderPhotoPreviews(); }; wrap.append(img,remove); previews.append(wrap); });
}
function setSaving(value) {
  state.saving = value;
  $('#memory-form').querySelectorAll('button,input,textarea,select').forEach(el => { el.disabled = value; });
  $('#save-button').textContent = value ? 'Saving to GitHub…' : 'Save memory ↗';
}
$('#memory-form').onsubmit = async event => {
  event.preventDefault(); if (state.saving || preparingPhotos || !state.client || !state.draft) return;
  captureDraft(); if (!state.draft.title || !state.draft.place || !state.draft.note) { $('#editor-error').textContent = 'Please add a title, a place, and a few words.'; return; }
  if (!pointInCity(state.draft.lng,state.draft.lat,cityBoundary)) { $('#editor-error').textContent = 'Please choose a location inside Bangkok.'; return; }
  const draft = state.draft;
  const memory = Object.fromEntries(['id','title','place','note','date','tag','lat','lng','createdAt'].map(key => [key,draft[key]]));
  memory.updatedAt = new Date().toISOString(); memory.photos = state.photos.map(p => ({path:p.path,alt:p.alt}));
  const uploads = state.photos.filter(p => !p.existing);
  const removed = draft.photos.filter(p => !memory.photos.some(keep => keep.path === p.path)).map(p => p.path);
  setSaving(true); $('#editor-error').textContent = '';
  try {
    validateJournal({version:1,memories:[memory]});
    const saved = await state.client.commitOperation({type:'upsert',id:memory.id,memory,baseUpdatedAt:draft.baseUpdatedAt || null},uploads,removed);
    for (const photo of uploads) state.freshPhotos.set(photo.path,`https://raw.githubusercontent.com/${config.owner}/${config.repo}/${saved.sha}/site/${photo.path}`);
    state.journal = saved.journal; $('#search').value = ''; $('#day-filter').value = ''; $('#tag-filter').value = '';
    $('#editor-dialog').close(); clearDraft(); render(); selectMemory(memory.id); notify('Memory committed to GitHub. The public site will update after publishing finishes.');
  } catch (error) { $('#editor-error').textContent = error.message; }
  finally { setSaving(false); }
};
$('#confirm-delete').onclick = async () => {
  const memory = state.journal.memories.find(m => m.id === state.selected); if (!memory || !state.client || state.saving) return;
  state.saving = true; $('#confirm-delete').disabled = true; $('#cancel-delete').disabled = true; $('#delete-error').textContent = '';
  try {
    const saved = await state.client.commitOperation({type:'delete',id:memory.id,title:memory.title,baseUpdatedAt:memory.updatedAt},[],memory.photos.map(p => p.path));
    state.journal = saved.journal; closeDetail(); render(); $('#delete-dialog').close(); notify('Memory removed. The public site will update after publishing finishes.');
  } catch (error) { $('#delete-error').textContent = error.message; }
  finally { state.saving = false; $('#confirm-delete').disabled = false; $('#cancel-delete').disabled = false; }
};
$('#cancel-delete').onclick = () => $('#delete-dialog').close();
$('#zoom-in').onclick = () => map.zoomIn(); $('#zoom-out').onclick = () => map.zoomOut(); $('#fit-map').onclick = fitMap;
['#search','#day-filter','#tag-filter'].forEach(selector => $(selector).addEventListener(selector === '#search' ? 'input' : 'change',render));
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => { if (state.saving || preparingPhotos) return; button.closest('dialog').close(); }; });
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('cancel',event => { if (state.saving || preparingPhotos) event.preventDefault(); });
  dialog.addEventListener('click',event => { if (event.target === dialog && !state.saving && !preparingPhotos) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
});
$('#owner-dialog').addEventListener('close',() => { $('#access-key').value = ''; });
window.addEventListener('beforeunload',event => { if (state.saving || $('#editor-dialog').open || state.picking) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('resize',() => map.invalidateSize());
loadJournal();
