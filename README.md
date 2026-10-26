# Dhule Health Connect

## ⚠️ About `hp_pro.zip`
The `hp_pro.zip` you uploaded was **empty** (0 files inside it) — there was no existing project to add features to. So this is a **complete, fresh build** of everything you described: a dashboard plus the new features (doctor appointment booking, ambulance finder, medical finder, local-language assistance, disease-based recommendations, live map/location tracking, and a patient helpline/disease-guidance menu), using your four Dhule datasets.

If you do have the original project saved somewhere else, re-upload it and I can merge these new features into it directly instead.

## 🔐 Login system (new)
- **`login.html`** — a full sign-in / create-account / forgot-password page with a hero panel, show/hide password, live password-strength meter, form validation, "Remember me", guest access, and EN / हिं / मरा language switching.
- **Login guard** — `index.html` redirects to `login.html` if nobody is signed in. The app header now shows your name/avatar and a **Logout** button.
- **Demo account:** `demo@dhule.in` / `Demo@123` (or click "Continue as guest").
- **How it works:** accounts are stored in the browser's localStorage with SHA-256-hashed passwords (`js/auth.js`). This is a front-end demo — **not real security**. To go live, replace the "Storage layer" functions in `js/auth.js` with calls to a real backend API.
- **Start here:** open **`login.html`** (or `index.html`, which sends you there automatically).

## What's included
- **Dashboard** — quick stats, emergency shortcuts, top symptoms, appointment CTA.
- **Doctor Appointment Booking** — pick a specialty + Dhule hospital, book a visit (stored on your device); the hospital confirms by phone since this isn't wired to a real hospital system.
- **Ambulance Finder** — your 14 ambulance services, sorted by distance from your live location, with call/directions buttons and a map.
- **Medical Finder** — *no medical-store dataset was supplied*, so this looks up pharmacies **live from OpenStreetMap** near your location. Swap in your own list any time (see "Adding your medical-store data" below).
- **Pathology Labs** — all 25 labs, searchable, mapped, distance-sorted.
- **Blood Banks** — all 7 banks, searchable, mapped, distance-sorted.
- **Disease Guide** — 20 common symptoms/conditions → recommended specialist, urgency, plain-language advice, and the nearest matching hospitals/labs/ambulances/blood banks. This is general guidance only, not a diagnosis.
- **Helpline Directory** — the official Dhule health helpline numbers (104/108/District Health Office, etc.), tap-to-call.
- **Local-language assistance** — full English / Hindi / Marathi toggle (top right) covering navigation, disease guide, and key content.
- **Live location & map** — "Use my location" (top bar) turns on GPS; every list then sorts by real distance and "Directions" opens Google Maps from your position.

## How to run it
No build step needed.
1. Unzip the folder.
2. Double-click `index.html` to open it in any browser (Chrome/Edge/Firefox), **or** serve it locally for the smoothest experience (some browsers restrict geolocation on `file://`):
   ```
   cd hp_pro
   python3 -m http.server 8000
   ```
   then open `http://localhost:8000`.
3. An internet connection is needed for the map tiles (OpenStreetMap), the Leaflet map library (loaded from a CDN), and the live Medical Finder search — everything else works offline.

## Data notes
- Ambulance, blood bank, pathology lab, and helpline data come directly from your uploaded spreadsheets.
- Map coordinates for those listings are **estimated** from the locality named in each address (your data had no lat/long) — good enough for "nearby" sorting and directions, but treat pin placement as approximate.
- Hospital names/specialties used for appointment booking and the disease guide are drawn from the hospital-type entries in your ambulance dataset; specific doctors aren't listed anywhere since none were provided — please confirm availability by phone.

## Adding your own medical-store (pharmacy) list
Open `js/data.js` and add a new array, e.g.:
```js
const MEDICAL_STORES = [
  { id:'med-1', name:'Store name', address:'...', phone:'...', lat:20.90, lng:74.77 }
];
```
Ask me and I can wire it into the Medical Finder view in place of the live OpenStreetMap lookup.

## File structure
```
hp_pro/
├── login.html        # NEW: sign in / register / reset page
├── index.html        # app shell (login-protected)
├── css/style.css      # design system
├── css/login.css      # NEW: login page styles
├── js/data.js         # your datasets + hospitals, disease guide, translations
├── js/auth.js         # NEW: accounts, sessions, logout
├── js/login.js        # NEW: login page logic + translations
└── js/app.js           # routing, maps, geolocation, booking, search
```
