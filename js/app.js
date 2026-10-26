/* ==========================================================================
   Dhule Health Connect — app logic
   Vanilla JS, no build step. Uses Leaflet (map), browser Geolocation API,
   and the OpenStreetMap Overpass API (live nearby pharmacies, since no
   medical-store dataset was supplied).
   ========================================================================== */

const STATE = {
  lang: localStorage.getItem('dhc_lang') || 'en',
  userLoc: null,          // {lat, lng}
  locStatus: 'idle',      // idle | locating | granted | denied
  view: 'dashboard',
  maps: {},                // leaflet map instances per view
  selectedCondition: null,
  medicalResults: null,
};

function t(key){ return (I18N[STATE.lang] && I18N[STATE.lang][key]) || I18N.en[key] || key; }

/* ---------------- Distance helpers ---------------- */
function haversine(lat1, lng1, lat2, lng2){
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function fmtDist(km){ return km < 1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1)} km`; }
function withDistance(list){
  if(!STATE.userLoc) return list.map(x => ({...x, _dist:null}));
  return list.map(x => ({...x, _dist: haversine(STATE.userLoc.lat, STATE.userLoc.lng, x.lat, x.lng)}))
             .sort((a,b) => (a._dist ?? 1e9) - (b._dist ?? 1e9));
}
function directionsUrl(lat,lng,name){
  return `https://www.openstreetmap.org/directions?from=&to=${lat}%2C${lng}#map=16/${lat}/${lng}`;
}
function gmapsDirections(lat,lng){
  const origin = STATE.userLoc ? `${STATE.userLoc.lat},${STATE.userLoc.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${lat},${lng}`;
}

/* ---------------- Geolocation ---------------- */
function requestLocation(cb){
  if(!navigator.geolocation){ STATE.locStatus='denied'; render(); return; }
  STATE.locStatus = 'locating'; render();
  navigator.geolocation.getCurrentPosition(pos => {
    STATE.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    STATE.locStatus = 'granted';
    render();
    if(cb) cb();
  }, err => {
    STATE.locStatus = 'denied';
    render();
    toast(t('locationDenied'));
  }, { enableHighAccuracy:true, timeout:8000 });
}

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg){
  let el = document.getElementById('toast');
  if(!el){ el = document.createElement('div'); el.id='toast'; el.className='toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.display='none', 3200);
}

/* ---------------- Bookings (localStorage demo) ---------------- */
function getBookings(){ try{ return JSON.parse(localStorage.getItem('dhc_bookings')||'[]'); }catch(e){ return []; } }
function saveBooking(b){ const list=getBookings(); list.unshift(b); localStorage.setItem('dhc_bookings', JSON.stringify(list)); }

/* ---------------- Nav config ---------------- */
const NAV = [
  { id:'dashboard', ic:'🏠', key:'nav_dashboard' },
  { id:'appointment', ic:'🩺', key:'nav_appointment' },
  { id:'ambulance', ic:'🚑', key:'nav_ambulance' },
  { id:'medical', ic:'💊', key:'nav_medical' },
  { id:'labs', ic:'🧪', key:'nav_labs' },
  { id:'blood', ic:'🩸', key:'nav_blood' },
  { id:'disease', ic:'📋', key:'nav_disease' },
  { id:'helpline', ic:'☎️', key:'nav_helpline' },
];

/* ---------------- Shell render ---------------- */
function renderShell(){
  document.getElementById('sidebar-nav').innerHTML = NAV.map(n => `
    <button class="nav-item ${STATE.view===n.id?'active':''}" data-nav="${n.id}">
      <span class="ic">${n.ic}</span><span>${t(n.key)}</span>
    </button>`).join('');

  document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    STATE.view = b.dataset.nav;
    document.getElementById('sidebar').classList.remove('open');
    render();
  }));

  document.getElementById('brand-name').textContent = t('appName');
  document.getElementById('brand-tag').textContent = t('tagline');
  document.getElementById('emergency-text').innerHTML = t('emergency_banner').replace('108', '<a href="tel:108">108</a>');
  document.getElementById('sos-btn').innerHTML = `🚨 ${t('urgency_emergency')} · 108`;
  document.getElementById('sos-sub').textContent = t('nearestAmbulance');

  const current = NAV.find(n => n.id===STATE.view);
  document.getElementById('page-title').textContent = current ? t(current.key) : '';
  document.getElementById('loc-btn').innerHTML = STATE.locStatus==='granted'
    ? `📍 ${t('nearMe')} ✓` : (STATE.locStatus==='locating' ? `📍 ${t('findingLocation')}` : `📍 ${t('nearMe')}`);
  document.getElementById('loc-btn').classList.toggle('on', STATE.locStatus==='granted');

  document.querySelectorAll('.lang-switch button').forEach(b => b.classList.toggle('active', b.dataset.lang===STATE.lang));
  if(typeof renderUser==='function') renderUser();
}

/* ---------------- Item card renderer ---------------- */
function itemCard({title, badge, badgeClass, meta, dist, phone, lat, lng, extra}){
  return `
    <div class="item">
      <div class="row-top">
        <div class="title">${title}</div>
        ${badge ? `<span class="badge ${badgeClass||''}">${badge}</span>` : ''}
      </div>
      ${meta}
      ${dist!=null ? `<div class="distance">📍 ${fmtDist(dist)} ${t('distanceAway')}</div>` : ''}
      ${extra||''}
      <div class="actions">
        ${phone && phone!=='Not listed' ? `<a class="btn primary small" href="tel:${String(phone).split('/')[0].trim().replace(/\s/g,'')}">📞 ${t('call')}</a>` : ''}
        ${(lat && lng) ? `<a class="btn small" target="_blank" rel="noopener" href="${gmapsDirections(lat,lng)}">🧭 ${t('directions')}</a>` : ''}
      </div>
    </div>`;
}

/* ==========================================================================
   VIEW: Dashboard
   ========================================================================== */
function viewDashboard(){
  const amb = REAL_DATA.ambulances.length, blood = REAL_DATA.bloodBanks.length,
        labs = REAL_DATA.labs.length, help = REAL_DATA.healthContacts.length;
  return `
    <div class="grid cols-4">
      <div class="stat-card tone-alert" data-goto="ambulance"><div class="ic">🚑</div><div class="num">${amb}</div><div class="lbl">${t('nav_ambulance')}</div></div>
      <div class="stat-card tone-teal" data-goto="labs"><div class="ic">🧪</div><div class="num">${labs}</div><div class="lbl">${t('nav_labs')}</div></div>
      <div class="stat-card tone-alert" data-goto="blood"><div class="ic">🩸</div><div class="num">${blood}</div><div class="lbl">${t('nav_blood')}</div></div>
      <div class="stat-card tone-sky" data-goto="helpline"><div class="ic">☎️</div><div class="num">${help}</div><div class="lbl">${t('nav_helpline')}</div></div>
    </div>

    <div class="section-head"><h2>${t('nav_disease')}</h2><span class="count">${t('selectCondition')}</span></div>
    <div class="callout">${STATE.lang==='en' ? 'Not feeling well? Pick a symptom to get the right specialist and nearby help.' : (STATE.lang==='hi' ? 'तबीयत ठीक नहीं? सही विशेषज्ञ और नज़दीकी मदद पाने के लिए एक लक्षण चुनें।' : 'बरं वाटत नाही? योग्य तज्ज्ञ आणि जवळची मदत मिळवण्यासाठी एक लक्षण निवडा.')}</div>
    <div class="condition-grid" style="margin-top:12px;">
      ${DISEASE_GUIDE.slice(0,6).map(d => conditionCardHTML(d)).join('')}
    </div>
    <div style="margin-top:10px;"><button class="btn" data-goto="disease">${t('nav_disease')} → ${t('all')}</button></div>

    <div class="section-head"><h2>${t('nav_appointment')}</h2></div>
    <div class="card">
      <div class="meta" style="font-size:13px; line-height:1.6;">
        ${STATE.lang==='en' ? 'Book a visit at a Dhule hospital by department — the hospital will confirm your slot by phone.' :
          (STATE.lang==='hi' ? 'विभाग के अनुसार धुळे के अस्पताल में विज़िट बुक करें — अस्पताल फोन पर आपकी बुकिंग पक्की करेगा।' :
          'विभागानुसार धुळेतील रुग्णालयात भेट बुक करा — रुग्णालय फोनवर तुमची वेळ निश्चित करेल.')}
      </div>
      <button class="btn primary" style="margin-top:10px;" data-goto="appointment">🩺 ${t('bookNow')}</button>
    </div>`;
}

function conditionCardHTML(d){
  const L = d[STATE.lang] || d.en;
  return `<button class="condition-card" data-condition="${d.id}">
      <div class="u ${d.urgency}">${t('urgency_'+d.urgency)}</div>
      <div class="n">${L.name}</div>
      <div class="s">${t('specialty')}: ${d.specialty}</div>
    </button>`;
}

/* ==========================================================================
   VIEW: Ambulance Finder
   ========================================================================== */
function viewAmbulance(){
  const list = withDistance(REAL_DATA.ambulances);
  return `
    <div class="two-col">
      <div>
        <div class="search-row">
          <input class="search-input" id="amb-search" placeholder="${t('searchPlaceholder')}">
          <button class="btn primary" id="amb-locate">📍 ${t('nearMe')}</button>
        </div>
        <div class="list-card" id="amb-list">${renderAmbList(list)}</div>
      </div>
      <div>
        <div id="map-ambulance" class="map-box"></div>
        <div class="source-note" style="margin-top:8px;">${STATE.lang==='en' ? 'Map positions are approximate (derived from listed localities).' : STATE.lang==='hi' ? 'मानचित्र स्थान अनुमानित हैं (सूचीबद्ध क्षेत्रों से)।' : 'नकाशावरील स्थाने अंदाजे आहेत (नमूद केलेल्या भागांवरून).'}</div>
      </div>
    </div>`;
}
function renderAmbList(list){
  if(!list.length) return `<div class="empty">—</div>`;
  return list.map(a => itemCard({
    title: a.name,
    badge: a.category, badgeClass: a.category.toLowerCase().includes('gov') ? 'gov':'priv',
    meta: `<div class="meta"><b>${t('address')}:</b> ${a.address}<br><b>${t('hours')}:</b> ${a.hours}</div>`,
    dist: a._dist, phone: a.contact, lat:a.lat, lng:a.lng
  })).join('');
}

/* ==========================================================================
   VIEW: Pathology Labs
   ========================================================================== */
function viewLabs(){
  const list = withDistance(REAL_DATA.labs);
  return `
    <div class="two-col">
      <div>
        <div class="search-row"><input class="search-input" id="lab-search" placeholder="${t('searchPlaceholder')}"></div>
        <div class="list-card" id="lab-list">${renderLabList(list)}</div>
      </div>
      <div><div id="map-labs" class="map-box"></div></div>
    </div>`;
}
function renderLabList(list){
  if(!list.length) return `<div class="empty">—</div>`;
  return list.map(l => itemCard({
    title: l.name, badge: l.type, badgeClass:'teal',
    meta: `<div class="meta"><b>${t('address')}:</b> ${l.address} — ${l.pin}<br><b>${t('hours')}:</b> ${l.timing}</div>`,
    dist: l._dist, phone: l.phone, lat:l.lat, lng:l.lng
  })).join('');
}

/* ==========================================================================
   VIEW: Blood Banks
   ========================================================================== */
function viewBlood(){
  const list = withDistance(REAL_DATA.bloodBanks);
  return `
    <div class="two-col">
      <div>
        <div class="search-row"><input class="search-input" id="blood-search" placeholder="${t('searchPlaceholder')}"></div>
        <div class="list-card" id="blood-list">${renderBloodList(list)}</div>
      </div>
      <div><div id="map-blood" class="map-box"></div></div>
    </div>`;
}
function renderBloodList(list){
  if(!list.length) return `<div class="empty">—</div>`;
  return list.map(b => itemCard({
    title: b.name, badge: b.type, badgeClass: b.type.toLowerCase().includes('gov')?'gov':'priv',
    meta: `<div class="meta"><b>${t('address')}:</b> ${b.address}<br><b>${t('hours')}/${t('type')}:</b> ${b.service||'—'} ${b.rating && b.rating!=='Not listed' ? ' · ★ '+b.rating : ''}</div>`,
    dist: b._dist, phone: b.mobile && b.mobile!=='Not listed' ? b.mobile : b.phone, lat:b.lat, lng:b.lng
  })).join('');
}

/* ==========================================================================
   VIEW: Medical Finder (live via OpenStreetMap Overpass — no dataset supplied)
   ========================================================================== */
function viewMedical(){
  return `
    <div class="callout">
      ${STATE.lang==='en' ? 'No medical-store list was supplied for this build, so this finder looks up pharmacies live from OpenStreetMap near your location. Upload your own list any time to replace this.' :
        STATE.lang==='hi' ? 'इस बिल्ड के लिए मेडिकल स्टोर सूची नहीं दी गई थी, इसलिए यह फीचर आपकी लोकेशन के पास OpenStreetMap से लाइव मेडिकल स्टोर खोजता है। आप अपनी सूची कभी भी अपलोड कर सकते हैं।' :
        'या बिल्डसाठी मेडिकल दुकानांची यादी दिली नव्हती, त्यामुळे हे फीचर तुमच्या लोकेशनजवळ OpenStreetMap वरून थेट मेडिकल दुकाने शोधते. तुम्ही तुमची यादी कधीही अपलोड करू शकता.'}
    </div>
    <div class="search-row" style="margin-top:14px;">
      <button class="btn primary" id="med-locate">📍 ${t('nearMe')}</button>
      <span class="source-note" id="med-status"></span>
    </div>
    <div class="two-col" style="margin-top:12px;">
      <div class="list-card" id="med-list">${medicalListHTML()}</div>
      <div><div id="map-medical" class="map-box"></div></div>
    </div>`;
}
function medicalListHTML(){
  if(!STATE.userLoc) return `<div class="empty">${t('nearMe')} → ${t('liveFromOSM')}</div>`;
  if(STATE.medicalResults === null) return `<div class="empty">${t('findingLocation')}</div>`;
  if(STATE.medicalResults.length === 0) return `<div class="empty">No pharmacies found nearby via OpenStreetMap.</div>`;
  return STATE.medicalResults.map(m => itemCard({
    title: m.name, badge: 'Pharmacy', badgeClass:'teal',
    meta: `<div class="meta"><b>${t('address')}:</b> ${m.address || '—'}</div>`,
    dist: m._dist, phone: m.phone, lat:m.lat, lng:m.lng
  })).join('');
}
async function fetchNearbyPharmacies(){
  if(!STATE.userLoc) return;
  STATE.medicalResults = null;
  document.getElementById('med-status') && (document.getElementById('med-status').textContent = t('liveFromOSM'));
  renderView();
  const {lat,lng} = STATE.userLoc;
  const query = `[out:json][timeout:15];(node["amenity"="pharmacy"](around:4000,${lat},${lng});node["healthcare"="pharmacy"](around:4000,${lat},${lng}););out body 30;`;
  try{
    const res = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body: query });
    const data = await res.json();
    const items = (data.elements||[]).map((el,i) => ({
      id:'osm-'+el.id, name: el.tags?.name || 'Pharmacy / Medical Store',
      address: [el.tags?.['addr:street'], el.tags?.['addr:city']].filter(Boolean).join(', '),
      phone: el.tags?.phone || el.tags?.['contact:phone'] || null,
      lat: el.lat, lng: el.lon
    }));
    STATE.medicalResults = withDistance(items).slice(0,20);
  }catch(e){
    STATE.medicalResults = [];
    toast('Could not reach OpenStreetMap (check internet connection).');
  }
  renderView();
  drawMedicalMap();
}

/* ==========================================================================
   VIEW: Doctor Appointment Booking
   ========================================================================== */
function viewAppointment(){
  const bookings = getBookings();
  return `
    <div class="two-col">
      <div>
        <div class="card">
          <div class="section-head" style="margin-top:0;"><h2>${t('bookNow')}</h2></div>
          <div class="field" style="margin-bottom:12px;">
            <label>${t('specialty')}</label>
            <select id="apt-specialty">
              <option value="">${t('all')}</option>
              ${[...new Set(HOSPITALS.flatMap(h=>h.specialties))].sort().map(s=>`<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin-bottom:14px;">
            <label>${t('hospital')}</label>
            <select id="apt-hospital">${HOSPITALS.map(h=>`<option value="${h.id}">${h.name}</option>`).join('')}</select>
          </div>
          <div class="form-grid">
            <div class="field"><label>${t('patientName')}</label><input id="apt-name" placeholder="${t('patientName')}"></div>
            <div class="field"><label>${t('patientPhone')}</label><input id="apt-phone" placeholder="10-digit mobile" inputmode="tel"></div>
            <div class="field"><label>${t('selectDate')}</label><input id="apt-date" type="date"></div>
            <div class="field"><label>${t('selectTime')}</label><input id="apt-time" type="time"></div>
          </div>
          <button class="btn primary block" id="apt-submit" style="margin-top:14px;">✅ ${t('confirmBooking')}</button>
          <div class="disclaimer">${STATE.lang==='en' ? 'This sends a booking request only — the hospital will call to confirm the exact slot. This app is not connected to any hospital\'s live booking system.' :
            STATE.lang==='hi' ? 'यह केवल बुकिंग अनुरोध भेजता है — सही समय की पुष्टि के लिए अस्पताल कॉल करेगा। यह ऐप किसी अस्पताल के लाइव बुकिंग सिस्टम से जुड़ा नहीं है।' :
            'हे फक्त बुकिंग विनंती पाठवते — योग्य वेळेची पुष्टी करण्यासाठी रुग्णालय कॉल करेल. हे अ‍ॅप कोणत्याही रुग्णालयाच्या लाइव्ह बुकिंग प्रणालीशी जोडलेले नाही.'}</div>
        </div>

        <div class="section-head"><h2>${t('myBookings')}</h2></div>
        <div class="list-card">
          ${bookings.length ? bookings.map(b => `
            <div class="item">
              <div class="row-top"><div class="title">${b.hospitalName}</div><span class="badge">${b.ref}</span></div>
              <div class="meta"><b>${t('specialty')}:</b> ${b.specialty||t('all')} · <b>${t('patientName')}:</b> ${b.patientName}<br>
              <b>${t('selectDate')}:</b> ${b.date||'—'} ${b.time||''}</div>
            </div>`).join('') : `<div class="empty">${t('noBookings')}</div>`}
        </div>
      </div>

      <div>
        <div class="section-head" style="margin-top:0;"><h2>${t('hospital')}</h2></div>
        <div class="list-card">
          ${HOSPITALS.map(h => itemCard({
            title:h.name, badge:h.type, badgeClass:h.type.toLowerCase().includes('gov')?'gov':'priv',
            meta:`<div class="meta"><b>${t('address')}:</b> ${h.address}<br><b>${t('specialty')}:</b> ${h.specialties.join(', ')}</div>`,
            dist:null, phone:h.phone, lat:h.lat, lng:h.lng
          })).join('')}
        </div>
      </div>
    </div>`;
}

/* ==========================================================================
   VIEW: Disease Guide
   ========================================================================== */
function viewDisease(){
  const sel = STATE.selectedCondition ? DISEASE_GUIDE.find(d=>d.id===STATE.selectedCondition) : null;
  return `
    <div class="search-row"><input class="search-input" id="cond-search" placeholder="${t('selectCondition')}"></div>
    <div class="condition-grid" id="cond-grid" style="margin-top:12px;">
      ${DISEASE_GUIDE.map(d => conditionCardHTML(d)).join('')}
    </div>
    ${sel ? renderConditionDetail(sel) : ''}`;
}
function renderConditionDetail(d){
  const L = d[STATE.lang] || d.en;
  const matchedHospitals = HOSPITALS.filter(h => h.specialties.some(s => d.specialty.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(d.specialty.split(' ')[0].toLowerCase())));
  const hospitalsToShow = withDistance(matchedHospitals.length ? matchedHospitals : HOSPITALS).slice(0,4);
  const labsToShow = withDistance(REAL_DATA.labs).slice(0,3);
  const ambToShow = withDistance(REAL_DATA.ambulances).slice(0,3);
  return `
    <div class="card" style="margin-top:18px;">
      <div class="section-head" style="margin-top:0;">
        <h2>${L.name}</h2>
        <span class="badge ${d.urgency==='emergency'?'emergency':''}">${t('urgency_'+d.urgency)}</span>
      </div>
      <div class="callout ${d.urgency==='emergency'?'alert':''}">${L.note}</div>

      <div class="section-head"><h2>${t('recommendedFor')}: ${d.specialty}</h2></div>
      <div class="list-card">${hospitalsToShow.map(h => itemCard({
        title:h.name, badge:h.type, badgeClass:h.type.toLowerCase().includes('gov')?'gov':'priv',
        meta:`<div class="meta"><b>${t('address')}:</b> ${h.address}</div>`, dist:h._dist, phone:h.phone, lat:h.lat, lng:h.lng
      })).join('')}</div>
      <div style="margin-top:8px;"><button class="btn small" data-goto="appointment">🩺 ${t('bookNow')}</button></div>

      ${d.id==='blood-donation' ? `
      <div class="section-head"><h2>${t('nearestBlood')}</h2></div>
      <div class="list-card">${withDistance(REAL_DATA.bloodBanks).slice(0,3).map(b => itemCard({
        title:b.name, badge:b.type, meta:`<div class="meta"><b>${t('address')}:</b> ${b.address}</div>`, dist:b._dist,
        phone:b.mobile!=='Not listed'?b.mobile:b.phone, lat:b.lat, lng:b.lng
      })).join('')}</div>` : `
      <div class="section-head"><h2>${t('nearestLabs')}</h2></div>
      <div class="list-card">${labsToShow.map(l => itemCard({
        title:l.name, badge:l.type, meta:`<div class="meta"><b>${t('address')}:</b> ${l.address}</div>`, dist:l._dist, phone:l.phone, lat:l.lat, lng:l.lng
      })).join('')}</div>`}

      ${d.urgency==='emergency' ? `
      <div class="section-head"><h2>${t('nearestAmbulance')}</h2></div>
      <div class="list-card">${ambToShow.map(a => itemCard({
        title:a.name, badge:a.category, meta:`<div class="meta"><b>${t('address')}:</b> ${a.address}</div>`, dist:a._dist, phone:a.contact, lat:a.lat, lng:a.lng
      })).join('')}</div>` : ''}
    </div>`;
}

/* ==========================================================================
   VIEW: Helpline Directory
   ========================================================================== */
function viewHelpline(){
  return `
    <div class="section-head" style="margin-top:0;"><h2>${t('nav_helpline')}</h2></div>
    <div class="helpline-list">
      ${REAL_DATA.healthContacts.map(c => `
        <div class="helpline-row">
          <div class="s">${c.service}</div>
          <a class="num" href="tel:${String(c.number).split(' ')[0]}">${c.number}</a>
        </div>`).join('')}
    </div>
    <div class="section-head"><h2>${t('nav_disease')}</h2></div>
    <div class="condition-grid">${DISEASE_GUIDE.map(d => conditionCardHTML(d)).join('')}</div>`;
}

/* ==========================================================================
   Router / render
   ========================================================================== */
const VIEWS = {
  dashboard: viewDashboard, appointment: viewAppointment, ambulance: viewAmbulance,
  medical: viewMedical, labs: viewLabs, blood: viewBlood, disease: viewDisease, helpline: viewHelpline
};

function renderView(){
  document.getElementById('view-root').innerHTML = VIEWS[STATE.view]();
  attachViewHandlers();
  drawMapsForView();
}

function render(){
  renderShell();
  renderView();
}

/* ---------------- Per-view event handlers ---------------- */
function attachViewHandlers(){
  document.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => {
    STATE.view = el.dataset.goto; render();
  }));
  document.querySelectorAll('[data-condition]').forEach(el => el.addEventListener('click', () => {
    STATE.selectedCondition = el.dataset.condition;
    if(STATE.view !== 'disease' && STATE.view !== 'helpline'){ STATE.view = 'disease'; render(); return; }
    renderView();
    document.querySelector('.card')?.scrollIntoView({behavior:'smooth', block:'start'});
  }));

  if(STATE.view === 'ambulance'){
    const search = document.getElementById('amb-search');
    search?.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      const filtered = withDistance(REAL_DATA.ambulances).filter(a => a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q) || a.address.toLowerCase().includes(q));
      document.getElementById('amb-list').innerHTML = renderAmbList(filtered);
    });
    document.getElementById('amb-locate')?.addEventListener('click', () => requestLocation());
  }
  if(STATE.view === 'labs'){
    const search = document.getElementById('lab-search');
    search?.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      const filtered = withDistance(REAL_DATA.labs).filter(l => l.name.toLowerCase().includes(q) || l.address.toLowerCase().includes(q));
      document.getElementById('lab-list').innerHTML = renderLabList(filtered);
    });
  }
  if(STATE.view === 'blood'){
    const search = document.getElementById('blood-search');
    search?.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      const filtered = withDistance(REAL_DATA.bloodBanks).filter(b => b.name.toLowerCase().includes(q) || b.address.toLowerCase().includes(q));
      document.getElementById('blood-list').innerHTML = renderBloodList(filtered);
    });
  }
  if(STATE.view === 'medical'){
    document.getElementById('med-locate')?.addEventListener('click', () => requestLocation(fetchNearbyPharmacies));
    if(STATE.userLoc && STATE.medicalResults === null) fetchNearbyPharmacies();
  }
  if(STATE.view === 'appointment'){
    document.getElementById('apt-submit')?.addEventListener('click', () => {
      const hospitalId = document.getElementById('apt-hospital').value;
      const hospital = HOSPITALS.find(h=>h.id===hospitalId);
      const name = document.getElementById('apt-name').value.trim();
      const phone = document.getElementById('apt-phone').value.trim();
      const date = document.getElementById('apt-date').value;
      const time = document.getElementById('apt-time').value;
      const specialty = document.getElementById('apt-specialty').value;
      if(!name || !phone){ toast(STATE.lang==='en'?'Please enter name and phone.':(STATE.lang==='hi'?'कृपया नाम और फ़ोन नंबर भरें।':'कृपया नाव आणि फोन नंबर भरा.')); return; }
      const ref = 'DHC-' + Math.random().toString(36).slice(2,8).toUpperCase();
      saveBooking({ ref, hospitalName: hospital.name, hospitalId, specialty, patientName:name, patientPhone:phone, date, time, createdAt: Date.now() });
      toast(`${t('bookingSuccess')}: ${ref}`);
      renderView();
    });
  }
  if(STATE.view === 'disease'){
    const search = document.getElementById('cond-search');
    search?.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      const filtered = DISEASE_GUIDE.filter(d => (d[STATE.lang]||d.en).name.toLowerCase().includes(q) || d.specialty.toLowerCase().includes(q));
      document.getElementById('cond-grid').innerHTML = filtered.map(d => conditionCardHTML(d)).join('');
      document.querySelectorAll('[data-condition]').forEach(el => el.addEventListener('click', () => {
        STATE.selectedCondition = el.dataset.condition; renderView();
      }));
    });
  }
}

/* ---------------- Maps ---------------- */
function baseMap(id, points, focus){
  const el = document.getElementById(id);
  if(!el || typeof L === 'undefined') return null;
  const center = focus || (STATE.userLoc || {lat:20.9042,lng:74.7749});
  const map = L.map(id, { zoomControl:true }).setView([center.lat, center.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  if(STATE.userLoc){
    L.circleMarker([STATE.userLoc.lat, STATE.userLoc.lng], {radius:8, color:'#e14b2a', fillColor:'#e14b2a', fillOpacity:.9})
      .addTo(map).bindPopup(STATE.lang==='en'?'You are here':(STATE.lang==='hi'?'आप यहाँ हैं':'तुम्ही इथे आहात'));
  }
  points.forEach(p => {
    if(p.lat==null||p.lng==null) return;
    L.marker([p.lat, p.lng]).addTo(map).bindPopup(`<b>${p.name}</b>${p.phone?`<br>${p.phone}`:''}`);
  });
  return map;
}
function destroyMap(id){ if(STATE.maps[id]){ STATE.maps[id].remove(); delete STATE.maps[id]; } }

function drawMapsForView(){
  Object.keys(STATE.maps).forEach(destroyMap);
  if(STATE.view === 'ambulance' && document.getElementById('map-ambulance')){
    STATE.maps['map-ambulance'] = baseMap('map-ambulance', REAL_DATA.ambulances);
  }
  if(STATE.view === 'labs' && document.getElementById('map-labs')){
    STATE.maps['map-labs'] = baseMap('map-labs', REAL_DATA.labs);
  }
  if(STATE.view === 'blood' && document.getElementById('map-blood')){
    STATE.maps['map-blood'] = baseMap('map-blood', REAL_DATA.bloodBanks);
  }
  if(STATE.view === 'medical' && document.getElementById('map-medical')){
    STATE.maps['map-medical'] = baseMap('map-medical', STATE.medicalResults || []);
  }
}
function drawMedicalMap(){
  if(STATE.view !== 'medical') return;
  destroyMap('map-medical');
  if(document.getElementById('map-medical')) STATE.maps['map-medical'] = baseMap('map-medical', STATE.medicalResults || []);
}

/* ---------------- Login session (user chip + logout) ---------------- */
Object.assign(I18N.en, {logout:'Logout', hello:'Hello'});
Object.assign(I18N.hi, {logout:'लॉगआउट', hello:'नमस्ते'});
Object.assign(I18N.mr, {logout:'लॉगआउट', hello:'नमस्कार'});
function renderUser(){
  const s = AUTH.session(); if(!s) return;
  const name = s.guest ? (STATE.lang==='hi'?'अतिथि':STATE.lang==='mr'?'पाहुणा':'Guest') : s.name;
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-avatar').textContent = (name.trim()[0] || 'U').toUpperCase();
  document.getElementById('logout-btn').textContent = t('logout');
}

/* ---------------- Global controls ---------------- */
function initGlobalControls(){
  document.getElementById('logout-btn').addEventListener('click', () => AUTH.logout());
  document.getElementById('hamburger').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('loc-btn').addEventListener('click', () => requestLocation(() => {
    if(STATE.view === 'medical') fetchNearbyPharmacies();
  }));
  document.querySelectorAll('.lang-switch button').forEach(b => b.addEventListener('click', () => {
    STATE.lang = b.dataset.lang; localStorage.setItem('dhc_lang', STATE.lang); render();
  }));
}

document.addEventListener('DOMContentLoaded', () => {
  initGlobalControls();
  render();
});
