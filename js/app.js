/**
 * Main Application Orchestrator for Rewari Sweeper Beat Planning System
 * Connects map, deduplication engine, beat manager, KML parser, and UI controls.
 */

window.App = (function () {
    let state = {
        ulbRoadsGeoJSON: null,
        existingRoadsGeoJSON: null,
        wardsGeoJSON: null,
        cleanRoadsGeoJSON: null,
        duplicateGroups: [],
        dedupSettings: { ...RoadCleaner.defaultSettings },
        manualOverrides: {},
        clipToBoundary: true,
        cleaningMode: 'zonal',
        selectedDrawnStats: null
    };

    /**
     * Application Entrypoint
     */
    function init() {
        console.log('Initializing Rewari Sweeper Beat Planning System...');

        // 1. Initialize Leaflet Map
        MapController.initMap('map');

        // 2. Setup Event Listeners
        setupEventListeners();

        // 3. Register Drawing Callback
        MapController.setOnAreaDrawnCallback(handleAreaDrawn);

        // 4. Auto-load actual project KML/KMZ files or fallback to mock demo data
        loadProjectDatasetsOnStartup();

        showToast('Rewari Sweeper Beat Planning System Ready.', 'success');
    }

    /**
     * Setup UI Event Listeners
     */
    function setupEventListeners() {
        // Tab Switching
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const targetPanel = e.currentTarget.dataset.target;
                document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.control-panel-tab').forEach(p => p.classList.remove('active'));
                
                e.currentTarget.classList.add('active');
                const panelEl = document.getElementById(targetPanel);
                if (panelEl) panelEl.classList.add('active');
            });
        });

        // File Upload Handlers
        setupFileInput('ulb-file-input', (geojson) => {
            state.ulbRoadsGeoJSON = geojson;
            MapController.renderULBRoads(geojson);
            updateDataLayerBadges();
            showToast(`Loaded ULB Roads: ${geojson.features.length} features`, 'info');
            if (state.wardsGeoJSON && (state.ulbRoadsGeoJSON || state.existingRoadsGeoJSON)) {
                runDeduplicationProcess();
            }
        });

        setupFileInput('ref-file-input', (geojson) => {
            state.existingRoadsGeoJSON = geojson;
            MapController.renderExistingRoads(geojson);
            updateDataLayerBadges();
            showToast(`Loaded Reference Roads: ${geojson.features.length} features`, 'info');
            if (state.wardsGeoJSON && (state.ulbRoadsGeoJSON || state.existingRoadsGeoJSON)) {
                runDeduplicationProcess();
            }
        });

        setupFileInput('ward-file-input', (geojson) => {
            state.wardsGeoJSON = geojson;
            MapController.renderWards(geojson);
            updateDataLayerBadges();
            showToast(`Loaded Ward Boundaries: ${geojson.features.length} features`, 'info');
            if (state.wardsGeoJSON && (state.ulbRoadsGeoJSON || state.existingRoadsGeoJSON)) {
                runDeduplicationProcess();
            }
        });

        // Strategy and Deduplication Settings Controls
        const strategySelect = document.getElementById('setting-clean-strategy');
        const dedupParamsGroup = document.getElementById('group-dedup-params');
        if (strategySelect) {
            strategySelect.addEventListener('change', (e) => {
                state.cleaningMode = e.target.value;
                if (dedupParamsGroup) {
                    dedupParamsGroup.style.display = e.target.value === 'dedup' ? 'block' : 'none';
                }
            });
        }

        const distInput = document.getElementById('setting-distance-tol');
        const overlapInput = document.getElementById('setting-min-overlap');
        const dirInput = document.getElementById('setting-max-dir');
        const sourceSelect = document.getElementById('setting-primary-source');
        const clipCheckbox = document.getElementById('setting-clip-boundary');

        const btnRunDedup = document.getElementById('btn-run-dedup');
        if (btnRunDedup) {
            btnRunDedup.addEventListener('click', () => {
                if (strategySelect) {
                    state.cleaningMode = strategySelect.value;
                }
                state.dedupSettings.distanceTolerance = parseFloat(distInput ? distInput.value : 2.0);
                state.dedupSettings.minOverlapPercent = parseFloat(overlapInput ? overlapInput.value : 0);
                state.dedupSettings.maxDirectionDifference = parseFloat(dirInput ? dirInput.value : 45);
                state.dedupSettings.primarySource = sourceSelect ? sourceSelect.value : 'longer';
                state.clipToBoundary = clipCheckbox ? clipCheckbox.checked : true;

                runDeduplicationProcess();
            });
        }

        // Beat Save Form
        const btnSaveBeat = document.getElementById('btn-save-beat');
        if (btnSaveBeat) {
            btnSaveBeat.addEventListener('click', handleSaveBeat);
        }

        const btnClearDraw = document.getElementById('btn-clear-draw');
        if (btnClearDraw) {
            btnClearDraw.addEventListener('click', () => {
                MapController.clearDrawnItems();
                document.getElementById('drawn-area-card').classList.add('hidden');
            });
        }

        // Auto 30 Free-Form Beats Tool
        const btnAutoBeats = document.getElementById('btn-auto-beats');
        if (btnAutoBeats) {
            btnAutoBeats.addEventListener('click', async () => {
                showToast('Loading 30 continuous non-overlapping beats...', 'info');
                try {
                    const res = await fetch('Rewari_30_Sweeper_Beats_Freeform.geojson');
                    if (res.ok) {
                        const geo = await res.json();
                        BeatManager.loadFreeformBeats(geo);
                        refreshBeatsUI();
                        showToast('Loaded 30 Free-Form Non-Overlapping Beats (~10.5 km/beat)!', 'success');
                        return;
                    }
                } catch (e) {}

                try {
                    BeatManager.generateBalancedBeats(state.cleanRoadsGeoJSON, state.wardsGeoJSON, 30);
                    refreshBeatsUI();
                    showToast('Generated 30 balanced sweeper beats!', 'success');
                } catch (e) {
                    showToast('Failed to generate beats: ' + e.message, 'error');
                }
            });
        }

        // Beat Boundary Editing Controls
        const btnToggleEditBeats = document.getElementById('btn-toggle-edit-beats');
        const btnSaveEditBeats = document.getElementById('btn-save-edit-beats');

        if (btnToggleEditBeats) {
            btnToggleEditBeats.addEventListener('click', () => {
                MapController.toggleBeatsEditMode(true);
                btnToggleEditBeats.style.display = 'none';
                if (btnSaveEditBeats) btnSaveEditBeats.style.display = 'block';
                showToast('✏️ Beat boundary edit mode active! Drag any vertex handle on the map.', 'info');
            });
        }

        if (btnSaveEditBeats) {
            btnSaveEditBeats.addEventListener('click', () => {
                MapController.toggleBeatsEditMode(false);
                btnSaveEditBeats.style.display = 'none';
                if (btnToggleEditBeats) btnToggleEditBeats.style.display = 'block';
                refreshBeatsUI();
                showToast('💾 Beat boundary adjustments saved!', 'success');
            });
        }

        // Export KML
        const btnExportKML = document.getElementById('btn-export-kml');
        if (btnExportKML) {
            btnExportKML.addEventListener('click', () => {
                KMLExport.downloadKMLOrKMZ({
                    beats: BeatManager.getBeats(),
                    cleanRoads: state.cleanRoadsGeoJSON,
                    wards: state.wardsGeoJSON
                }, 'Rewari_Sweeper_Plan.kml', false);
                showToast('Exported KML for Google Earth!', 'success');
            });
        }

        // Export KMZ
        const btnExportKMZ = document.getElementById('btn-export-kmz');
        if (btnExportKMZ) {
            btnExportKMZ.addEventListener('click', () => {
                KMLExport.downloadKMLOrKMZ({
                    beats: BeatManager.getBeats(),
                    cleanRoads: state.cleanRoadsGeoJSON,
                    wards: state.wardsGeoJSON
                }, 'Rewari_Sweeper_Plan.kmz', true);
                showToast('Exported compressed KMZ!', 'success');
            });
        }

        // Export CSV / Excel
        const btnExportExcel = document.getElementById('btn-export-excel');
        if (btnExportExcel) {
            btnExportExcel.addEventListener('click', () => {
                KMLExport.exportToExcelOrCSV(BeatManager.getBeats(), 'Rewari_Sweeper_Beats.csv');
                showToast('Exported Sweeper Beats Spreadsheet!', 'success');
            });
        }

        // Save Project JSON
        const btnSaveProject = document.getElementById('btn-save-project');
        if (btnSaveProject) {
            btnSaveProject.addEventListener('click', () => {
                ProjectManager.saveProjectToFile({
                    dedupSettings: state.dedupSettings,
                    manualOverrides: state.manualOverrides,
                    beats: BeatManager.getBeats(),
                    ulbRoadsGeoJSON: state.ulbRoadsGeoJSON,
                    existingRoadsGeoJSON: state.existingRoadsGeoJSON,
                    wardsGeoJSON: state.wardsGeoJSON,
                    cleanRoadsGeoJSON: state.cleanRoadsGeoJSON
                });
                showToast('Project JSON Saved Successfully!', 'success');
            });
        }

        // Load Project JSON
        const projectFileInput = document.getElementById('project-file-input');
        if (projectFileInput) {
            projectFileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const projectData = await ProjectManager.loadProjectFromFile(file);
                    
                    state.dedupSettings = projectData.settings || state.dedupSettings;
                    state.manualOverrides = projectData.manualOverrides || {};
                    
                    if (projectData.datasets) {
                        state.ulbRoadsGeoJSON = projectData.datasets.ulbRoads;
                        state.existingRoadsGeoJSON = projectData.datasets.existingRoads;
                        state.wardsGeoJSON = projectData.datasets.wards;
                        state.cleanRoadsGeoJSON = projectData.datasets.cleanRoads;

                        if (state.wardsGeoJSON) MapController.renderWards(state.wardsGeoJSON);
                        if (state.ulbRoadsGeoJSON) MapController.renderULBRoads(state.ulbRoadsGeoJSON);
                        if (state.existingRoadsGeoJSON) MapController.renderExistingRoads(state.existingRoadsGeoJSON);
                        if (state.cleanRoadsGeoJSON) MapController.renderCleanRoads(state.cleanRoadsGeoJSON);
                    }

                    if (projectData.beats) {
                        BeatManager.setBeats(projectData.beats);
                        refreshBeatsUI();
                    }

                    updateDataLayerBadges();
                    showToast('Project Loaded Successfully!', 'success');
                } catch (err) {
                    showToast('Failed to load project: ' + err.message, 'error');
                }
            });
        }
    }

    /**
     * File input helper for KML/KMZ
     */
    function setupFileInput(elementId, callback) {
        const input = document.getElementById(elementId);
        if (!input) return;

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                showToast(`Parsing ${file.name}...`, 'info');
                const geojson = await KMLParser.parseFile(file, file.name);
                callback(geojson);
            } catch (err) {
                showToast(`Failed to parse ${file.name}: ${err.message}`, 'error');
            }
        });
    }

    /**
     * Run Spatial Deduplication Process
     */
    function runDeduplicationProcess() {
        if (!state.ulbRoadsGeoJSON && !state.existingRoadsGeoJSON) {
            showToast('Please load at least ULB Roads or Reference Roads dataset first.', 'warning');
            return;
        }

        const isZonal = state.cleaningMode === 'zonal';
        showToast(isZonal ? 'Generating Zonal Road Network (Ref Inside + ULB Outside)...' : 'Running spatial duplicate analysis...', 'info');

        setTimeout(() => {
            try {
                let result;

                if (isZonal) {
                    // Zonal Combination: Reference inside Circular Road + ULB outside Circular Road
                    result = RoadCleaner.processZonalCombination(
                        state.ulbRoadsGeoJSON,
                        state.existingRoadsGeoJSON,
                        state.clipToBoundary ? state.wardsGeoJSON : null
                    );
                } else {
                    // Algorithmic Deduplication
                    let ulbToProcess = state.ulbRoadsGeoJSON || { type: 'FeatureCollection', features: [] };
                    let refToProcess = state.existingRoadsGeoJSON || { type: 'FeatureCollection', features: [] };

                    if (state.clipToBoundary && state.wardsGeoJSON) {
                        ulbToProcess = BoundaryClipper.clipRoadsToBoundary(ulbToProcess, state.wardsGeoJSON);
                        refToProcess = BoundaryClipper.clipRoadsToBoundary(refToProcess, state.wardsGeoJSON);
                    }

                    result = RoadCleaner.processDuplicates(
                        ulbToProcess,
                        refToProcess,
                        state.dedupSettings,
                        state.manualOverrides
                    );

                    if (state.clipToBoundary && state.wardsGeoJSON) {
                        result.cleanRoads = BoundaryClipper.clipRoadsToBoundary(result.cleanRoads, state.wardsGeoJSON);
                        let clippedLengthKm = 0;
                        result.cleanRoads.features.forEach(f => {
                            if (typeof turf !== 'undefined') {
                                clippedLengthKm += turf.length(f, { units: 'kilometers' });
                            }
                        });
                        result.stats.cleanRoadCount = result.cleanRoads.features.length;
                        result.stats.totalCleanLengthKm = Number(clippedLengthKm.toFixed(2));
                    }
                }

                state.cleanRoadsGeoJSON = result.cleanRoads;
                state.duplicateGroups = result.duplicateGroups || [];

                // Render Layers
                MapController.renderCleanRoads(result.cleanRoads);
                MapController.renderDuplicateRoads(state.duplicateGroups);

                // Update UI Stats
                updateDedupUIStats(result.stats);
                updateDuplicateGroupsListUI(result.duplicateGroups);
                refreshBeatsUI();

                showToast(`Clean Road Network generated: ${result.stats.totalCleanLengthKm} km`, 'success');
            } catch (err) {
                console.error(err);
                showToast('Error during deduplication: ' + err.message, 'error');
            }
        }, 100);
    }

    /**
     * Handle drawn area callback from MapController
     */
    function handleAreaDrawn(stats) {
        if (!stats) {
            document.getElementById('drawn-area-card').classList.add('hidden');
            state.selectedDrawnStats = null;
            return;
        }

        state.selectedDrawnStats = stats;

        const card = document.getElementById('drawn-area-card');
        if (card) card.classList.remove('hidden');

        document.getElementById('stat-drawn-length').innerText = `${stats.length_km} km`;
        document.getElementById('stat-drawn-segments').innerText = stats.segment_count;
        document.getElementById('stat-drawn-wards').innerText = stats.wards.length > 0 ? stats.wards.join(', ') : 'Auto-detected';
        document.getElementById('stat-drawn-area').innerText = `${stats.area_km2} km²`;

        // Auto-fill beat form input
        const inputName = document.getElementById('input-beat-name');
        if (inputName) {
            inputName.value = `Beat ${String(BeatManager.getBeats().length + 1).padStart(2, '0')}`;
        }
        const inputWard = document.getElementById('input-beat-ward');
        if (inputWard) {
            inputWard.value = stats.wards.length > 0 ? stats.wards[0] : '';
        }
    }

    /**
     * Save Drawn Beat
     */
    function handleSaveBeat() {
        if (!state.selectedDrawnStats) {
            showToast('Draw an area on the map first before saving a beat.', 'warning');
            return;
        }

        const nameInput = document.getElementById('input-beat-name');
        const wardInput = document.getElementById('input-beat-ward');
        const remarkInput = document.getElementById('input-beat-remarks');

        const name = nameInput ? nameInput.value.trim() : '';
        const ward = wardInput ? wardInput.value.trim() : '';
        const remarks = remarkInput ? remarkInput.value.trim() : '';

        if (!name) {
            showToast('Please enter a Beat Name.', 'warning');
            return;
        }

        BeatManager.addBeat({
            name: name,
            ward: ward,
            length_km: state.selectedDrawnStats.length_km,
            area_km2: state.selectedDrawnStats.area_km2,
            segment_count: state.selectedDrawnStats.segment_count,
            remarks: remarks,
            polygonGeoJSON: state.selectedDrawnStats.polygonGeoJSON
        });

        MapController.clearDrawnItems();
        document.getElementById('drawn-area-card').classList.add('hidden');
        state.selectedDrawnStats = null;

        refreshBeatsUI();
        showToast(`Saved Beat "${name}"!`, 'success');
    }

    /**
     * Refresh Beats UI Table & Map
     */
    function refreshBeatsUI(redrawMap = true) {
        const beats = BeatManager.getBeats();
        if (redrawMap) {
            MapController.renderBeats(beats);
        }

        const tbody = document.getElementById('beats-table-body');
        if (tbody) {
            tbody.innerHTML = '';
            if (beats.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No sweeper beats loaded. Click "Generate 30 Non-Overlapping Beats".</td></tr>`;
            } else {
                beats.forEach((b) => {
                    const sw = b.sweepers || 11;
                    const dailyTarget = b.dailyTargetMeters || Math.round((b.length_km * 1000) / sw);
                    const colorDot = b.color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${b.color};margin-right:6px;vertical-align:middle;"></span>` : '';
                    
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${colorDot}<b>${b.name}</b></td>
                        <td><span class="badge badge-ward">${b.ward || 'Sector'}</span></td>
                        <td><b>${b.length_km} km</b></td>
                        <td><span class="badge" style="background:#1e293b;border:1px solid #38bdf8;color:#38bdf8;font-weight:600;">${sw} Sweepers</span> <span class="small text-muted" style="font-size:0.75rem;">(~${dailyTarget}m)</span></td>
                        <td>
                            <div class="d-flex gap-1">
                                <button class="btn btn-sm btn-outline" onclick="MapController.enableSingleBeatEdit('${b.id}')" title="Drag boundary corners on map">✏️</button>
                                <button class="btn btn-sm btn-outline-danger" onclick="App.deleteBeatItem('${b.id}')" title="Delete Beat">✕</button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }

        // Update Dashboard Cards
        const stats = BeatManager.getDashboardStats(state.cleanRoadsGeoJSON);
        document.getElementById('dash-clean-road-length').innerText = `${stats.totalCleanRoadLengthKm} km`;
        document.getElementById('dash-total-beats').innerText = stats.totalBeats;
        document.getElementById('dash-avg-length-beat').innerText = `${stats.avgRoadLengthPerBeat} km`;
        document.getElementById('dash-covered-road-length').innerText = `${stats.totalCoveredRoadLengthKm} km`;
    }

    /**
     * Delete Beat Handler
     */
    function deleteBeatItem(id) {
        BeatManager.deleteBeat(id);
        refreshBeatsUI();
        showToast('Beat deleted.', 'info');
    }

    /**
     * Update Data Layer Badges
     */
    function updateDataLayerBadges() {
        const elUlb = document.getElementById('badge-ulb-count');
        const elRef = document.getElementById('badge-ref-count');
        const elWard = document.getElementById('badge-ward-count');

        if (elUlb) elUlb.innerText = state.ulbRoadsGeoJSON ? `${state.ulbRoadsGeoJSON.features.length} features` : 'Not loaded';
        if (elRef) elRef.innerText = state.existingRoadsGeoJSON ? `${state.existingRoadsGeoJSON.features.length} features` : 'Not loaded';
        if (elWard) elWard.innerText = state.wardsGeoJSON ? `${state.wardsGeoJSON.features.length} wards` : 'Not loaded';
    }

    /**
     * Update Deduplication UI Stats
     */
    function updateDedupUIStats(stats) {
        document.getElementById('stat-orig-ulb').innerText = stats.originalUlbCount;
        document.getElementById('stat-orig-ref').innerText = stats.originalRefCount;
        document.getElementById('stat-possible-dups').innerText = stats.duplicateCount;
        document.getElementById('stat-clean-roads').innerText = `${stats.cleanRoadCount} (${stats.totalCleanLengthKm} km)`;
    }

    /**
     * Update Duplicate Groups Inspection List
     */
    function updateDuplicateGroupsListUI(groups) {
        const container = document.getElementById('duplicate-groups-list');
        if (!container) return;

        container.innerHTML = '';
        if (!groups || groups.length === 0) {
            container.innerHTML = `<div class="text-center text-muted py-3">No duplicate road pairs detected.</div>`;
            return;
        }

        groups.forEach(g => {
            const card = document.createElement('div');
            card.className = 'duplicate-card mb-2 p-2 border rounded';
            const keptLabel = g.keptSource || 'Longer Geometry';
            card.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div><b>Pair #${g.id}</b> <span class="badge badge-warning">${g.distance_m}m dist | ${g.overlap_percent}% overlap</span></div>
                    <span class="badge badge-success">✓ Kept: ${keptLabel}</span>
                </div>
                <div class="small text-muted mt-1">
                    <div>ULB: ${g.ulbRoad.name} (${g.ulbRoad.length_km} km)</div>
                    <div>Ref: ${g.refRoad.name} (${g.refRoad.length_km} km)</div>
                </div>
                <div class="small text-danger mt-1">
                    ↳ Automatically removed shorter duplicate road.
                </div>
            `;
            container.appendChild(card);
        });
    }

    /**
     * Set Manual Override
     */
    function setManualOverride(ulbUid, refUid, action) {
        const key = `${ulbUid}__${refUid}`;
        state.manualOverrides[key] = action;
        showToast(`Manual override set: ${action.replace('_', ' ').toUpperCase()}`, 'info');
        runDeduplicationProcess();
    }

    /**
     * Auto-load actual project KML/KMZ files if available, otherwise load demo mock data
     */
    async function loadProjectDatasetsOnStartup() {
        let loadedActualFiles = false;

        try {
            showToast('Scanning project folder for KML/KMZ datasets...', 'info');

            // 1. Try loading Ward KMZ
            try {
                const wardRes = await fetch('Final Wardbandi Rewari KMZ.kmz');
                if (wardRes.ok) {
                    const wardBuf = await wardRes.arrayBuffer();
                    const wardsGeoJSON = await KMLParser.parseFile(wardBuf, 'Final Wardbandi Rewari KMZ.kmz');
                    state.wardsGeoJSON = wardsGeoJSON;
                    MapController.renderWards(wardsGeoJSON);
                    loadedActualFiles = true;
                }
            } catch (wErr) {}

            // 2. Try loading ULB Roads KML
            try {
                const ulbRes = await fetch('MC_Rewari_ULB_Roads_Only_No_Beats.kml');
                if (ulbRes.ok) {
                    const ulbText = await ulbRes.text();
                    const ulbGeoJSON = await KMLParser.parseFile(ulbText, 'MC_Rewari_ULB_Roads_Only_No_Beats.kml');
                    state.ulbRoadsGeoJSON = ulbGeoJSON;
                    MapController.renderULBRoads(ulbGeoJSON);
                    loadedActualFiles = true;
                }
            } catch (uErr) {}

            // 3. Try loading Reference Roads KML
            try {
                const refRes = await fetch('Rewari_Haryana_Reference_Roads_Only.kml');
                if (refRes.ok) {
                    const refText = await refRes.text();
                    const refGeoJSON = await KMLParser.parseFile(refText, 'Rewari_Haryana_Reference_Roads_Only.kml');
                    state.existingRoadsGeoJSON = refGeoJSON;
                    MapController.renderExistingRoads(refGeoJSON);
                    loadedActualFiles = true;
                }
            } catch (rErr) {}

            if (loadedActualFiles) {
                updateDataLayerBadges();
                showToast('Loaded Rewari Municipal KML/KMZ Datasets!', 'success');
                runDeduplicationProcess();

                // Auto-load 30 continuous non-overlapping beats
                try {
                    const beatsRes = await fetch('Rewari_30_Sweeper_Beats_Freeform.geojson');
                    if (beatsRes.ok) {
                        const beatsGeoJSON = await beatsRes.json();
                        BeatManager.loadFreeformBeats(beatsGeoJSON);
                        refreshBeatsUI();
                    }
                } catch (bErr) {}

                return;
            }
        } catch (e) {
            console.warn('Auto-fetch project files failed, switching to demo mock data:', e);
        }

        // Fallback to Mock Demo Data
        loadMockDemoData();
    }

    /**
     * Load Realistic Mock Demo Data for Rewari
     */
    function loadMockDemoData() {
        const wards = generateMockWards();
        state.wardsGeoJSON = wards;
        MapController.renderWards(wards);

        const ulbRoads = generateMockRoads('ulb', 35);
        state.ulbRoadsGeoJSON = ulbRoads;
        MapController.renderULBRoads(ulbRoads);

        const refRoads = generateMockRoads('ref', 45, ulbRoads);
        state.existingRoadsGeoJSON = refRoads;
        MapController.renderExistingRoads(refRoads);

        updateDataLayerBadges();
        runDeduplicationProcess();
    }

    function generateMockWards() {
        const centerLat = 28.1968, centerLng = 76.6176;
        const features = [];
        const wardCount = 12; // Sample wards for interactive demonstration

        for (let i = 0; i < wardCount; i++) {
            const angle = (i / wardCount) * 2 * Math.PI;
            const nextAngle = ((i + 1) / wardCount) * 2 * Math.PI;
            const r1 = 0.02, r2 = 0.04;

            const polyCoords = [
                [centerLng + r1 * Math.cos(angle), centerLat + r1 * Math.sin(angle)],
                [centerLng + r2 * Math.cos(angle), centerLat + r2 * Math.sin(angle)],
                [centerLng + r2 * Math.cos(nextAngle), centerLat + r2 * Math.sin(nextAngle)],
                [centerLng + r1 * Math.cos(nextAngle), centerLat + r1 * Math.sin(nextAngle)],
                [centerLng + r1 * Math.cos(angle), centerLat + r1 * Math.sin(angle)]
            ];

            features.push({
                type: 'Feature',
                id: `ward_${i + 1}`,
                geometry: { type: 'Polygon', coordinates: [polyCoords] },
                properties: { name: `Ward ${i + 1}`, ward: `${i + 1}` }
            });
        }

        return { type: 'FeatureCollection', features: features };
    }

    function generateMockRoads(type, count, baseGeoJSON = null) {
        const centerLat = 28.1968, centerLng = 76.6176;
        const features = [];

        for (let i = 0; i < count; i++) {
            let coords;
            let name;

            if (type === 'ref' && baseGeoJSON && i < 15) {
                // Generate duplicate candidate near an existing ULB road
                const baseRoad = baseGeoJSON.features[i % baseGeoJSON.features.length];
                const baseCoords = baseRoad.geometry.coordinates;
                // Offset slightly by ~0.5 metres
                const offset = 0.000005;
                coords = baseCoords.map(c => [c[0] + offset, c[1] + offset]);
                name = `Ref Copy of ${baseRoad.properties.name}`;
            } else {
                const startLng = centerLng + (Math.random() - 0.5) * 0.06;
                const startLat = centerLat + (Math.random() - 0.5) * 0.06;
                const endLng = startLng + (Math.random() - 0.5) * 0.015;
                const endLat = startLat + (Math.random() - 0.5) * 0.015;
                coords = [[startLng, startLat], [endLng, endLat]];
                name = type === 'ulb' ? `MC Road ${i + 1}` : `State Road ${i + 1}`;
            }

            features.push({
                type: 'Feature',
                id: `${type}_road_${i + 1}`,
                geometry: { type: 'LineString', coordinates: coords },
                properties: {
                    name: name,
                    agency: type === 'ulb' ? 'Municipal Council Rewari' : 'PWD / HSAMB',
                    _source: type
                }
            });
        }

        return { type: 'FeatureCollection', features: features };
    }

    /**
     * Toast notification system
     */
    function showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast-item toast-${type}`;
        toast.innerHTML = `<span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    return {
        init,
        setManualOverride,
        deleteBeatItem,
        runDeduplicationProcess
    };
})();

// Launch app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
