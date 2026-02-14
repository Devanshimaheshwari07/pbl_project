/**
 * ResQmed Main JS
 * Handles UI interactions, Map, SOS, and Notifications
 */

/* --- Toast Notification System --- */
const Toast = {
    container: null,
    init() {
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        document.body.appendChild(this.container);
    },
    show(message, type = 'info') {
        if (!this.container) this.init();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        this.container.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
};

/* --- Global State --- */
let map = null;
let markers = [];
let cachedPosition = null;

/* --- Rankings Data --- */
// Hardcoded data for key hospitals (simulating "Real Data" source)
const REAL_HOSPITALS = {
    // SMS Hospital Jaipur (approx loc)
    "node/1": {
        name: "SMS Hospital",
        stats: { mortality: 4.8, safety: 4.5, readmission: 4.7, experience: 4.2, timely: 4.0 },
        overall: 4.4
    },
    // Fortis Jaipur
    "node/2": {
        name: "Fortis Escorts",
        stats: { mortality: 4.9, safety: 4.9, readmission: 4.8, experience: 4.8, timely: 4.9 },
        overall: 4.9
    },
    // Narayana
    "node/3": {
        name: "Narayana Multispeciality",
        stats: { mortality: 4.7, safety: 4.8, readmission: 4.6, experience: 4.5, timely: 4.7 },
        overall: 4.6
    }
};

function generateStats(id, name) {
    // Check if we have real data
    // In a real scenario, we'd match by name or location fuzzily if ID doesn't match
    // Here we use a simple check against our hardcoded list
    for (const key in REAL_HOSPITALS) {
        if (name.includes(REAL_HOSPITALS[key].name)) return REAL_HOSPITALS[key];
    }

    // Consistent Simulation based on Name Hash
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Helper to map hash to 3.0 - 5.0 range
    const getRating = (salt) => {
        const val = Math.abs(Math.sin(hash + salt) * 10000) % 2; // 0-2
        return (3.0 + val).toFixed(1); // 3.0 - 5.0
    };

    const stats = {
        mortality: getRating(1),
        safety: getRating(2),
        readmission: getRating(3),
        experience: getRating(4),
        timely: getRating(5)
    };

    const sum = Object.values(stats).reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
    const overall = (sum / 5).toFixed(1);

    return { name, stats, overall };
}

function getStarString(rating) {
    const r = Math.round(rating);
    return "⭐".repeat(r) + "☆".repeat(5 - r); // Simple stars
}

/* --- Map Functions --- */
function initMap(lat, lon) {
    const mapEl = document.getElementById('map');

    // Show the map container (it starts hidden)
    mapEl.style.display = 'block';

    if (map) {
        // Map already initialized, just recenter
        map.setView([lat, lon], 13);
        map.invalidateSize();
        return;
    }

    if (typeof L === 'undefined') return;

    map = L.map('map').setView([lat, lon], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    L.marker([lat, lon]).addTo(map)
        .bindPopup("<b>You are here</b>").openPopup();

    // Fix Leaflet rendering in initially hidden containers
    setTimeout(() => map.invalidateSize(), 200);
}

function updateLeaderboard(facilities) {
    const sidebar = document.getElementById('ranking-sidebar');
    const list = document.getElementById('ranking-list');
    sidebar.classList.remove('hidden');
    list.innerHTML = "";

    // Sort by overall rating
    const sorted = facilities.sort((a, b) => b.data.overall - a.data.overall).slice(0, 10);

    sorted.forEach((f, index) => {
        const item = document.createElement('div');
        item.className = 'hospital-rank-card';
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between;">
                <strong><span class="rank-badge">#${index + 1}</span> ${f.data.name}</strong>
                <span style="color:#f59e0b; font-weight:bold;">★ ${f.data.overall}</span>
            </div>
            <div style="font-size:0.85rem; color:#666; margin-top:4px;">
                Safety: ${f.data.stats.safety} | Patient Exp: ${f.data.stats.experience}
            </div>
        `;
        item.onclick = () => {
            map.setView([f.lat, f.lon], 16);
            f.marker.openPopup();
        };
        list.appendChild(item);
    });
}

function showFacilities(type) {
    // Only Hospitals get rankings
    const isHospital = type === 'hospital';

    const list = document.getElementById('facility-list'); // Keeping this for mobile fallback or summary

    getLocation().then(pos => {
        if (!pos) {
            Toast.show('Location access required', 'error');
            return;
        }

        initMap(pos.latitude, pos.longitude);
        clearAllMarkers();

        let query = `[out:json];node["amenity"="${type}"](around:5000,${pos.latitude},${pos.longitude});out;`;

        // Use bigger radius for simulated "Jaipur" feel if not actually there, but let's stick to user loc
        fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query))
            .then(res => res.json())
            .then(data => {
                const facilities = [];

                if (!data.elements || !data.elements.length) {
                    Toast.show(`No ${type}s found nearby`, 'info');
                    return;
                }

                const icon = new L.Icon({
                    iconUrl: getIconURL(type),
                    iconSize: [32, 32],
                    iconAnchor: [16, 32],
                    popupAnchor: [0, -32]
                });

                data.elements.forEach(f => {
                    const name = f.tags.name || "Unnamed Facility";
                    let popupContent = `<b>${name}</b>`;
                    let facilityData = { name };

                    if (isHospital) {
                        const stats = generateStats(f.id, name);
                        facilityData = stats;
                        popupContent += `
                            <div style="margin-top:8px; font-size:0.9rem;">
                                <strong>Rating: ${stats.overall}</strong> ${getStarString(stats.overall)}
                            </div>
                        `;
                    }

                    const marker = L.marker([f.lat, f.lon], { icon }).addTo(map).bindPopup(popupContent);
                    markers.push(marker);

                    if (isHospital) {
                        facilities.push({ lat: f.lat, lon: f.lon, data: facilityData, marker });
                    }
                });

                if (markers.length > 0) {
                    const group = new L.featureGroup(markers);
                    map.fitBounds(group.getBounds());
                }

                if (isHospital) {
                    updateLeaderboard(facilities);
                    Toast.show(`Ranked ${facilities.length} hospitals nearby`, 'success');
                } else {
                    Toast.show(`Found ${markers.length} ${type}s`, 'success');
                    // Hide sidebar if not hospital
                    const sidebar = document.getElementById('ranking-sidebar');
                    if (sidebar) sidebar.classList.add('hidden');
                }

            }).catch(err => {
                console.error(err);
                Toast.show("Failed to fetch facility data", "error");
            });

    }).catch(() => {
        Toast.show("Geolocation not supported", "error");
    });
}

function searchMedicine() {
    const input = document.getElementById('medicine-input');
    const medicine = input.value.trim();
    if (!medicine) {
        Toast.show("Please enter a medicine name", "warning");
        return;
    }

    fetch('/medicine_search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medicine })
    })
        .then(res => res.json())
        .then(data => {
            const output = document.getElementById('medicine-output');
            output.classList.remove('hidden');
            if (data.error) {
                output.innerHTML = `<p class="text-danger">${data.error}</p>`;
                Toast.show(data.error, 'error');
            } else {
                const items = data.map(d => `<li><strong>${d.pharmacy}</strong>: ${d.medicine}</li>`).join('');
                output.innerHTML = `<ul>${items}</ul>`;
                Toast.show(`Found availability for ${medicine}`, 'success');
            }
        }).catch(err => {
            Toast.show("Server communication error", "error");
        });
}

function bookAmbulance() {
    getLocation().then(pos => {
        if (!pos) {
            Toast.show("Location required for ambulance", "error");
            return;
        }

        fetch('/book_ambulance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: pos.latitude, longitude: pos.longitude })
        })
            .then(res => res.json())
            .then(data => {
                const output = document.getElementById('ambulance-output');
                output.classList.remove('hidden');

                if (data.error) {
                    output.innerHTML = `<p class="text-danger">${data.error}</p>`;
                    Toast.show(data.error, 'error');
                } else {
                    output.innerHTML = `<p class="text-success"><strong>${data.message}</strong><br>ETA: ${data.eta}<br>Assigned: ${data.ambulance}</p>`;
                    Toast.show(`Ambulance Dispatched! ETA: ${data.eta}`, 'success');
                }
            }).catch(() => Toast.show("Booking failed", "error"));

    }).catch(() => Toast.show("Geolocation permission denied", "error"));
}

/* --- Utilities --- */
function getIconURL(type) {
    const icons = {
        hospital: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
        pharmacy: 'https://cdn-icons-png.flaticon.com/512/2913/2913461.png',
        clinic: 'https://cdn-icons-png.flaticon.com/512/4320/4320350.png',
        blood_donation: 'https://cdn-icons-png.flaticon.com/512/3515/3515338.png'
    };
    return icons[type] || icons.hospital;
}

function clearAllMarkers() {
    markers.forEach(m => {
        if (map) map.removeLayer(m);
    });
    markers = [];
}

function submitProfile() {
    const form = document.getElementById('edit-profile-form');
    if (!form) return;

    const formData = new FormData(form);

    fetch('/edit_profile', {
        method: 'POST',
        body: formData
    })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                Toast.show(data.error, 'error');
            } else {
                Toast.show(data.message || 'Profile updated!', 'success');
                document.getElementById('edit-profile-modal').style.display = 'none';
                // Reload to reflect changes
                setTimeout(() => location.reload(), 500);
            }
        })
        .catch(() => Toast.show('Failed to update profile', 'error'));
}

function getLocation(timeout = 15000) {
    // Return cached position if available (avoids repeated prompts/timeouts)
    if (cachedPosition) return Promise.resolve(cachedPosition);

    return new Promise(resolve => {
        if (!navigator.geolocation) return resolve(null);

        // Try high accuracy first, fall back to low accuracy
        const tryGet = (highAccuracy) => {
            const options = { timeout, enableHighAccuracy: highAccuracy, maximumAge: 60000 };
            navigator.geolocation.getCurrentPosition(
                pos => {
                    cachedPosition = pos.coords;
                    resolve(pos.coords);
                },
                err => {
                    console.warn(`Geolocation error (highAccuracy=${highAccuracy}):`, err);
                    if (highAccuracy) {
                        // Retry with low accuracy
                        tryGet(false);
                    } else {
                        resolve(null);
                    }
                },
                options
            );
        };
        tryGet(true);
    });
}

/* --- Initialization --- */
document.addEventListener('DOMContentLoaded', () => {
    Toast.init();

    // Check Profile for SOS
    checkProfileAndToggleSOS();

    // Setup SOS Button
    const sosBtn = document.getElementById('sos-btn');
    if (sosBtn) {
        sosBtn.addEventListener('click', handleSOS);
    }

    // Password Validation
    const signupPwd = document.getElementById('signup-password');
    if (signupPwd) {
        signupPwd.addEventListener('input', (e) => validatePasswordStrength(e.target.value));
    }
});

/* --- SOS Logic --- */
async function checkProfileAndToggleSOS() {
    const btn = document.getElementById('sos-btn');
    const warning = document.getElementById('sos-warning');
    if (!btn) return;

    try {
        const res = await fetch('/api/check_profile');
        const data = await res.json();

        if (data.profile_exists) {
            btn.disabled = false;
            btn.classList.add('sos-active');
            waitingForSOS = false;
            if (warning) warning.textContent = "";
        } else {
            btn.disabled = true;
            btn.classList.remove('sos-active');
            if (warning) warning.textContent = "Complete your medical profile to enable SOS";
        }
    } catch (e) {
        console.error("Profile check failed");
    }
}

async function handleSOS() {
    const btn = document.getElementById('sos-btn');
    btn.disabled = true;

    try {
        // Double check profile
        const checkRes = await fetch('/api/check_profile');
        const checkData = await checkRes.json();

        if (!checkData.profile_exists) {
            Toast.show("Please complete profile first", "error");
            btn.disabled = false;
            return;
        }

        Toast.show("SENDING SOS...", "warning");

        const loc = await getLocation();
        const payload = loc ? { latitude: loc.latitude, longitude: loc.longitude } : {};

        // 1. Send Alert to Contacts (Backend)
        const res = await fetch('/sos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.status === 'sent' || data.status === 'simulated') {
            const out = document.getElementById('sos-output');
            out.classList.remove('hidden');
            out.innerHTML = `<p class="text-success"><strong>SOS SENT!</strong> Location shared.</p>`;
            Toast.show("SOS ALERT SENT!", "success");

            // 2. Automatically Find & Call Nearest Hospital
            if (loc) {
                findAndCallNearestHospital(loc.latitude, loc.longitude);
            } else {
                Toast.show("Location missing. Dialing 102...", "error");
                window.location.href = "tel:102";
            }

        } else {
            Toast.show(data.error || "Failed to send SOS", "error");
        }

    } catch (e) {
        Toast.show("Network Error on SOS", "error");
    } finally {
        setTimeout(() => {
            // Re-enable after cooldown if profile still exists
            checkProfileAndToggleSOS();
            btn.disabled = false;
        }, 8000);
    }
}

function findAndCallNearestHospital(lat, lon) {
    Toast.show("Locating nearest hospital to call...", "info");

    // Query nearest hospital within 3km
    const query = `[out:json];node["amenity"="hospital"](around:3000,${lat},${lon});out;`;

    fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query))
        .then(res => res.json())
        .then(data => {
            let numberToCall = "102"; // Default fallback
            let hospitalName = "Emergency Services";

            if (data.elements && data.elements.length > 0) {
                // Sort by distance (approximately) or just take first found (Overpass doesn't guarantee order but 'around' usually finds closest)
                const hospital = data.elements[0];
                hospitalName = hospital.tags.name || "Nearby Hospital";

                // Try to find phone number
                if (hospital.tags.phone) numberToCall = hospital.tags.phone;
                else if (hospital.tags['contact:phone']) numberToCall = hospital.tags['contact:phone'];
                else if (hospital.tags['emergency:phone']) numberToCall = hospital.tags['emergency:phone'];
            }

            // Show UI and Call
            const out = document.getElementById('sos-output');
            out.innerHTML += `
                <div style="margin-top:10px; padding:10px; background:#fee2e2; border-radius:8px; border:1px solid #ef4444;">
                    <p style="color:#b91c1c; font-weight:bold;">Calling ${hospitalName} (${numberToCall})...</p>
                    <a href="tel:${numberToCall}" class="button danger" style="display:block; text-align:center; text-decoration:none; margin-top:5px;">
                        Click to Dial Now
                    </a>
                </div>
            `;

            Toast.show(`Dialing ${hospitalName}...`, "warning");

            // Attempt Auto-dial
            window.location.href = `tel:${numberToCall}`;

        })
        .catch(err => {
            console.error(err);
            // Fallback
            window.location.href = "tel:102";
        });
}

function validatePasswordStrength(password) {
    const indicator = document.getElementById('password-strength');
    if (!indicator) return;

    const strongRegex = new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])(?=.{8,})");

    if (strongRegex.test(password)) {
        indicator.textContent = "Strong Password";
        indicator.style.color = "var(--success)";
    } else {
        indicator.textContent = "Weak (Need 8+ chars, Upper, Lower, Number, Special)";
        indicator.style.color = "var(--danger)";
    }
}

// Global scope for HTML onclick attributes
window.showFacilities = showFacilities;
window.searchMedicine = searchMedicine;
window.bookAmbulance = bookAmbulance;
window.submitProfile = submitProfile;

/* --- Profile Submission --- */
/* --- AI Recommendation Engine & Smart Triage --- */

// Extended Mock Data for AI
const HOSPITAL_SPECIALTIES = ['General', 'Cardiac', 'Neurology', 'Trauma', 'Maternity', 'Pediatrics'];

function getSimulatedHospitalData(id, name) {
    // Check hardcoded first (Merge with existing stats if needed, or just add new props)
    let base = generateStats(id, name); // Get existing ratings

    // Deterministic simulation for new attributes
    let hash = 0;
    for (let i = 0; i < name.length; i++) { hash = name.charCodeAt(i) + ((hash << 5) - hash); }

    // Specialties (Pick 2-3 based on hash)
    const specs = [];
    const numSpecs = (Math.abs(hash) % 2) + 2;
    for (let i = 0; i < numSpecs; i++) {
        specs.push(HOSPITAL_SPECIALTIES[(Math.abs(hash + i) % HOSPITAL_SPECIALTIES.length)]);
    }
    // Ensure "General" is always there for fallback
    if (!specs.includes('General')) specs.push('General');

    // Bed Availability (0 - 50)
    const beds = Math.abs(hash + 99) % 50;

    return { ...base, specialties: specs, beds: beds };
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function runTriageAI() {
    const type = document.getElementById('triage-type').value;
    const symBreathing = document.getElementById('sym-breathing').checked;
    const symBleeding = document.getElementById('sym-bleeding').checked;
    const symPain = document.getElementById('sym-pain').checked;
    const symUnconscious = document.getElementById('sym-unconscious').checked;

    const resultsDiv = document.getElementById('ai-results');
    const badge = document.getElementById('triage-badge');

    resultsDiv.classList.remove('hidden');
    badge.className = ""; // Reset
    badge.innerHTML = "Analyzing Vitals...";

    // 1. Determine Severity
    let severity = "NON-URGENT";
    if (symBreathing || symBleeding || symPain || symUnconscious) {
        severity = "CRITICAL";
    } else if (['Cardiac', 'Neurology', 'Trauma'].includes(type)) {
        severity = "URGENT";
    }

    // UI Update for Triage Level
    setTimeout(() => {
        badge.innerText = `Severity: ${severity}`;
        if (severity === 'CRITICAL') {
            badge.classList.add('triage-critical', 'pulse-critical');
            Toast.show("CRITICAL CONDITION DETECTED!", "error");
        } else if (severity === 'URGENT') {
            badge.classList.add('triage-urgent');
        } else {
            badge.classList.add('triage-non-urgent');
        }

        // 2. Find Best Hospital
        findBestHospital(severity, type);

    }, 800); // Fake processing delay
}

function findBestHospital(severity, type) {
    getLocation().then(pos => {
        if (!pos) { Toast.show("Location needed for AI matching", "error"); return; }

        // Fetch hospitals again to ensure we have data (or use cached if available)
        const query = `[out:json];node["amenity"="hospital"](around:10000,${pos.latitude},${pos.longitude});out;`;

        fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query))
            .then(res => res.json())
            .then(data => {
                if (!data.elements || !data.elements.length) {
                    document.getElementById('rec-name').innerText = "None nearby";
                    return;
                }

                const scoredHospitals = data.elements.map(h => {
                    const hospitalData = getSimulatedHospitalData(h.id, h.tags.name || "Unknown");
                    const dist = calculateDistance(pos.latitude, pos.longitude, h.lat, h.lon);

                    let score = 0;
                    let reason = [];

                    // --- AI SCORING LOGIC ---

                    // 1. Distance Score (0-40 pts) - Lower dist is better
                    // Critical needs closest.
                    let distWeight = severity === 'CRITICAL' ? 50 : (severity === 'URGENT' ? 30 : 15);
                    let distScore = Math.max(0, (10 - dist) * (distWeight / 10));
                    score += distScore;

                    // 2. Specialty Match (30 pts)
                    if (hospitalData.specialties.some(s => s.toLowerCase().includes(type.toLowerCase())) ||
                        (type === 'Trauma' && hospitalData.specialties.includes('Trauma'))) {
                        score += 30;
                        reason.push("Specializes in your emergency");
                    }

                    // 3. Bed Availability (0-20 pts)
                    // If critical/urgent, beds are vital.
                    if (hospitalData.beds < 1 && severity !== 'NON-URGENT') {
                        score -= 50; // Penalty for no beds
                    } else {
                        score += Math.min(20, hospitalData.beds / 2);
                    }

                    // 4. Quality/Rating (0-20 pts)
                    // Non-urgent prioritizes this.
                    let ratingWeight = severity === 'NON-URGENT' ? 10 : 2;
                    score += (hospitalData.overall * ratingWeight);

                    return { ...hospitalData, dist, score, reason: reason.join(". ") || "Best overall match" };
                });

                // Sort: Highest Score first
                scoredHospitals.sort((a, b) => b.score - a.score);
                const winner = scoredHospitals[0];

                // Display Winner
                const card = document.getElementById('rec-hospital-card');
                card.style.display = 'block';
                setTimeout(() => card.classList.add('show'), 100);

                document.getElementById('rec-name').innerText = winner.name;
                document.getElementById('rec-score').innerText = `${Math.round(winner.score)}/100`;
                document.getElementById('rec-reason').innerText = `${winner.reason} (${winner.dist.toFixed(1)}km away, ${winner.beds} beds)`;

                // Notify Action
                document.getElementById('btn-notify-hospital').onclick = () => {
                    Toast.show(`Notifying ${winner.name} of incoming ${severity} patient...`, "success");
                    setTimeout(() => Toast.show("Hospital Acknowledged ✅", "success"), 2000);
                };

            });
    });
}

