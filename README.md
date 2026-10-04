# Rewari Sweeper Beat Planning & Road-Length Mapping System

A local HTML/JS GIS map application developed for **Municipal Council Rewari, Haryana** to clean municipal road networks, eliminate duplicate/overlapping road representations across multi-agency datasets, strictly clip roads to Rewari ward boundaries, and interactively calculate and balance sweeper beats across adjacent wards.

---

## 🚀 Quick Start (Local Use)

No backend or database installation is required.

### Option 1: One-Click Local Launcher (Recommended)
Double-click **`start_server.bat`**.
This starts a lightweight local Python HTTP server and opens `http://localhost:8000` automatically in your browser. All 3 project files (`Final Wardbandi Rewari KMZ.kmz`, `MC_Rewari_ULB_Roads_Only_No_Beats.kml`, and `Rewari_Haryana_Reference_Roads_Only.kml`) will load and deduplicate automatically on startup!

### Option 2: Direct Double-Click
Double-click `index.html` in your web browser (Chrome, Edge, Firefox). If browser file security blocks auto-fetching on `file://`, simply select the three files using the file pickers in the **Source Data** tab.

---

## ⚙️ Key Technical Implementations

### 1. Spatial Deduplication & Road Cleaning Engine
- **Direct Duplicate Elimination**: Directly removes physical duplicates within **2.0 m tolerance** (overlap can be **0%**, as genuine separate parallel roads do not exist 2m apart).
- **Longer Priority**: When duplicates are detected between MC/ULB and Haryana Reference roads, the system automatically retains whichever geometry is longer.
- **Strict Boundary Clipping**: Eliminates all exterior roads lying outside Rewari's 32 ward boundaries (~2,193 raw reference roads outside municipal limits are automatically filtered out).

### 2. Verified Road Metrics
- **Raw Reference Roads**: 4,577 features (~1,406 km across Haryana)
- **Raw ULB Roads**: 2,661 features (~307 km)
- **Raw Combined in Wards**: ~598.7 km (without deduplication)
- **Clean Deduplicated Road Network Inside Wards**: **~412.7 km** (strictly within Rewari Municipal Wards)

### 3. Cross-Ward Sweeper Beat Balancing (30 Beats)
- 🛡️ **Anti-Exploitation Policy**: To prevent workers from falling under the sole jurisdiction or exploitation of a single ward member, **beats are intentionally assigned across adjacent ward pairs (spanning 2 wards)**.
- Each beat is balanced at ~13-14 km and clearly labeled with its two spanned wards (e.g., `Beat 01 (Wards 1 & 2)`).
- Full interactive drawing tools (Polygon, Rectangle, Circle) allow manual beat adjustments and real-time road length calculation.

### 4. Layer Control
- Only **Ward Boundaries** and **Clean Road Network** (bright emerald green) are shown by default.
- Raw unclipped ULB and Reference roads can be enabled in the top-right layer control for reference/inspection.

### 5. Exports & Project Persistence
- **Google Earth KML / KMZ Export**: Export beats and cleaned road network directly for Google Earth.
- **Excel / CSV Export**: Download structured beat rosters with road lengths and spanned wards.
- **Project JSON**: Save and restore full planning progress at any time.

---

## 📁 Directory Structure

```text
safai circle/
├── start_server.bat      # One-click local web server launcher
├── index.html            # Main User Interface & GIS dashboard
├── css/
│   └── style.css         # Modern dark-theme GIS stylesheet
├── js/
│   ├── app.js            # Main application orchestrator & dataset loader
│   ├── map.js            # Leaflet map controller & Geoman drawing integration
│   ├── kml-parser.js     # KML & KMZ (ZIP) parser
│   ├── road-cleaner.js   # Spatial deduplication engine (Turf.js + BBox index)
│   ├── boundary-clipper.js # Municipal ward boundary clipper
│   ├── beat-manager.js   # Sweeper beat CRUD & cross-ward 30-beat balancer
│   ├── kml-export.js     # Google Earth KML/KMZ & CSV/Excel export
│   └── project-manager.js # Full project JSON save/load state manager
├── data/
│   └── README.txt        # Dataset instructions
├── Final Wardbandi Rewari KMZ.kmz
├── MC_Rewari_ULB_Roads_Only_No_Beats.kml
├── Rewari_Haryana_Reference_Roads_Only.kml
└── README.md
```
# Safai-Circle
