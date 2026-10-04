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

        // 4. Setup Supabase Cloud Realtime Subscription and Status Monitoring
        if (window.SupabaseSync) {
            window.SupabaseSync.onStatusChange((connected) => {
                const badge = document.getElementById('cloud-sync-badge');
                if (badge) {
                    if (connected) {
                        badge.style.background = 'rgba(16, 185, 129, 0.2)';
                        badge.style.borderColor = '#10b981';
                        badge.style.color = '#34d399';
                        badge.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981;"></span> ☁️ Supabase Live';
                    } else {
                        badge.style.background = 'rgba(239, 68, 68, 0.2)';
                        badge.style.borderColor = '#ef4444';
                        badge.style.color = '#f87171';
                        badge.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;"></span> ⚠️ Cloud Offline';
                    }
                }
            });

            window.SupabaseSync.subscribeToChanges((payload) => {
                console.log('⚡ Realtime change received from Supabase:', payload);
                if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
                    const row = payload.new;
                    if (row && row.id) {
                        const beats = BeatManager.getBeats();
                        const idx = beats.findIndex(b => b.id === row.id);
                        const updatedBeat = {
                            id: row.id,
                            name: row.name,
                            ward: row.ward,
                            length_km: Number(row.length_km) || 0,
                            area_km2: Number(row.area_km2) || 0,
                            segment_count: row.segment_count || 0,
                            sweepers: row.sweepers || 11,
                            dailyTargetMeters: row.daily_target_meters || Math.round(((Number(row.length_km) || 0) * 1000) / (row.sweepers || 11)),
                            darogaName: row.daroga_name || '',
                            darogaPhone: row.daroga_phone || '',
                            workers: row.workers || '',
                            remarks: row.remarks || '',
                            color: row.color || null,
                            polygonGeoJSON: row.polygon_geojson
                        };
                        if (idx !== -1) {
                            beats[idx] = updatedBeat;
                        } else {
                            beats.push(updatedBeat);
                        }
                        BeatManager.saveToLocalStorage();
                        refreshBeatsUI(false);
                        showToast(`⚡ Realtime update: ${row.name || 'Beat'} synced from cloud`, 'info');
                    }
                } else if (payload.eventType === 'DELETE') {
                    const oldRow = payload.old;
                    if (oldRow && oldRow.id) {
                        const beats = BeatManager.getBeats().filter(b => b.id !== oldRow.id);
                        BeatManager.setBeats(beats);
                        BeatManager.saveToLocalStorage();
                        refreshBeatsUI(false);
                    }
                }
            });
        }

        // 5. Auto-load actual project KML/KMZ files or fallback to mock demo data
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
        const mapBtnToggleEdit = document.getElementById('map-btn-toggle-edit');

        const syncEditControlsState = (isEditing) => {
            if (btnToggleEditBeats) btnToggleEditBeats.style.display = isEditing ? 'none' : 'block';
            if (btnSaveEditBeats) btnSaveEditBeats.style.display = isEditing ? 'block' : 'none';
            if (mapBtnToggleEdit) {
                mapBtnToggleEdit.classList.toggle('active', isEditing);
                mapBtnToggleEdit.innerText = isEditing ? '💾 Done Editing' : '✏️ Edit Borders';
            }
        };

        if (btnToggleEditBeats) {
            btnToggleEditBeats.addEventListener('click', () => {
                MapController.toggleBeatsEditMode(true);
                syncEditControlsState(true);
                showToast('✏️ Beat boundary edit mode active! Drag any vertex handle on the map.', 'info');
            });
        }

        if (btnSaveEditBeats) {
            btnSaveEditBeats.addEventListener('click', () => {
                MapController.toggleBeatsEditMode(false);
                syncEditControlsState(false);
                refreshBeatsUI();
                showToast('💾 Beat boundary adjustments saved!', 'success');
            });
        }

        if (mapBtnToggleEdit) {
            mapBtnToggleEdit.addEventListener('click', () => {
                const nextState = !MapController.isBeatEditingActive();
                MapController.toggleBeatsEditMode(nextState);
                syncEditControlsState(nextState);
                if (nextState) {
                    showToast('✏️ Beat boundary edit mode active! Drag any vertex handle on the map.', 'info');
                } else {
                    refreshBeatsUI();
                    showToast('💾 Beat boundary adjustments saved!', 'success');
                }
            });
        }

        // Beat Map Labels Toggle Controls
        const updateLabelButtonState = (visible) => {
            const text = visible ? '🏷️ Hide Labels' : '🏷️ Show Labels';
            const btnPanel = document.getElementById('btn-toggle-beat-labels');
            const btnMap = document.getElementById('map-btn-toggle-labels');
            if (btnPanel) btnPanel.innerText = text;
            if (btnMap) {
                btnMap.innerText = text;
                btnMap.classList.toggle('active', visible);
            }
        };

        const toggleLabelsHandler = () => {
            const currentlyVisible = MapController.isBeatLabelsVisible();
            const newVisible = !currentlyVisible;
            MapController.toggleBeatLabels(newVisible);
            updateLabelButtonState(newVisible);
            showToast(newVisible ? '🏷️ Map labels visible' : '👁️ Clean map view: labels hidden (hover beats for details)', 'info');
        };

        const btnToggleLabels = document.getElementById('btn-toggle-beat-labels');
        if (btnToggleLabels) btnToggleLabels.addEventListener('click', toggleLabelsHandler);

        const mapBtnToggleLabels = document.getElementById('map-btn-toggle-labels');
        if (mapBtnToggleLabels) mapBtnToggleLabels.addEventListener('click', toggleLabelsHandler);

        // Reset to Default Beats
        const btnResetDefaultBeats = document.getElementById('btn-reset-default-beats');
        if (btnResetDefaultBeats) {
            btnResetDefaultBeats.addEventListener('click', async () => {
                if (confirm('Reset all sweeper beats back to default 30 continuous boundaries? This will clear your custom edits.')) {
                    BeatManager.clearLocalStorage();
                    try {
                        const beatsRes = await fetch('Rewari_30_Sweeper_Beats_Freeform.geojson');
                        if (beatsRes.ok) {
                            const beatsGeoJSON = await beatsRes.json();
                            BeatManager.loadFreeformBeats(beatsGeoJSON);
                            refreshBeatsUI();
                            showToast('Reset to default 30 sweeper beats!', 'success');
                        } else {
                            showToast('Could not load default beats geojson', 'error');
                        }
                    } catch (e) {
                        showToast('Error resetting beats: ' + e.message, 'error');
                    }
                }
            });
        }

        // Save Beats directly to KML & Project Files
        const btnSaveKmlDisk = document.getElementById('btn-save-kml-disk');
        if (btnSaveKmlDisk) {
            btnSaveKmlDisk.addEventListener('click', async () => {
                const beats = BeatManager.getBeats();
                if (beats.length === 0) {
                    showToast('No beats loaded to save', 'warning');
                    return;
                }

                // Ensure local storage is updated
                BeatManager.saveToLocalStorage();

                // Generate updated KML string
                const kmlContent = KMLExport.generateKMLString({
                    beats: beats,
                    cleanRoads: state.cleanRoadsGeoJSON,
                    wards: state.wardsGeoJSON
                });

                // Generate updated GeoJSON
                const geojsonFeatures = beats.map(b => {
                    const f = b.polygonGeoJSON ? JSON.parse(JSON.stringify(b.polygonGeoJSON)) : {
                        type: 'Feature',
                        geometry: null
                    };
                    f.properties = f.properties || {};
                    f.properties.id = b.id;
                    f.properties.name = b.name;
                    f.properties.ward = b.ward;
                    f.properties.length_km = b.length_km;
                    f.properties.sweepers = b.sweepers || 11;
                    f.properties.dailyTargetMeters = b.dailyTargetMeters || Math.round((b.length_km * 1000) / (b.sweepers || 11));
                    f.properties.darogaName = b.darogaName || '';
                    f.properties.darogaPhone = b.darogaPhone || '';
                    f.properties.workers = b.workers || '';
                    f.properties.remarks = b.remarks || '';
                    f.properties.color = b.color;
                    return f;
                });
                const geojsonContent = JSON.stringify({ type: 'FeatureCollection', features: geojsonFeatures }, null, 2);

                // Try to save directly to local server if running
                let savedToServer = false;
                try {
                    const res = await fetch('/api/save-beats', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            kml: kmlContent,
                            geojson: geojsonContent,
                            beats: beats
                        })
                    });
                    if (res.ok) {
                        savedToServer = true;
                        showToast('💾 Updated Rewari_30_Sweeper_Beats_Freeform.kml directly on disk!', 'success');
                    }
                } catch (e) {}

                if (!savedToServer) {
                    // Download KML file directly to disk
                    KMLExport.downloadKMLOrKMZ({
                        beats: beats,
                        cleanRoads: state.cleanRoadsGeoJSON,
                        wards: state.wardsGeoJSON
                    }, 'Rewari_30_Sweeper_Beats_Freeform.kml', false);

                    // Also download GeoJSON
                    const blob = new Blob([geojsonContent], { type: 'application/geo+json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'Rewari_30_Sweeper_Beats_Freeform.geojson';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    showToast('💾 Downloaded updated KML & GeoJSON files! Replace in folder to update.', 'success');
                }
            });
        }

        // Beat Allotment Modal Controls
        const modalAllotment = document.getElementById('modal-beat-allotment');
        const closeModal = () => {
            if (modalAllotment) modalAllotment.classList.add('hidden');
        };
        const btnCloseModal = document.getElementById('btn-close-beat-modal');
        if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
        const btnCancelModal = document.getElementById('btn-cancel-beat-modal');
        if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);
        if (modalAllotment) {
            modalAllotment.addEventListener('click', (e) => {
                if (e.target === modalAllotment) closeModal();
            });
        }

        const inputSweepers = document.getElementById('edit-beat-sweepers');
        if (inputSweepers) {
            inputSweepers.addEventListener('input', () => {
                const beatId = document.getElementById('edit-beat-id').value;
                const beat = BeatManager.getBeats().find(b => b.id === beatId);
                const count = parseInt(inputSweepers.value, 10) || 1;
                if (beat) {
                    const target = Math.round((beat.length_km * 1000) / count);
                    const targetDisp = document.getElementById('edit-beat-target-display');
                    if (targetDisp) targetDisp.innerText = `~${target} m/day`;
                }
            });
        }

        const btnSaveAllotment = document.getElementById('btn-save-beat-allotment');
        if (btnSaveAllotment) {
            btnSaveAllotment.addEventListener('click', () => {
                const beatId = document.getElementById('edit-beat-id').value;
                if (!beatId) return;

                const name = document.getElementById('edit-beat-name').value.trim();
                const ward = document.getElementById('edit-beat-ward').value.trim();
                const sweepers = parseInt(document.getElementById('edit-beat-sweepers').value, 10) || 11;
                const darogaName = document.getElementById('edit-beat-daroga').value.trim();
                const darogaPhone = document.getElementById('edit-beat-phone').value.trim();
                const workers = document.getElementById('edit-beat-workers').value.trim();
                const remarks = document.getElementById('edit-beat-remarks').value.trim();

                BeatManager.updateBeat(beatId, {
                    name: name || undefined,
                    ward: ward || undefined,
                    sweepers: sweepers,
                    darogaName: darogaName,
                    darogaPhone: darogaPhone,
                    workers: workers,
                    remarks: remarks
                });

                closeModal();
                refreshBeatsUI();
                showToast(`☁️ Saved allotment & worker record for ${name || 'Beat'} to Supabase Cloud!`, 'success');
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

        // Smooth scroll to Master Allotment Roster Table below map
        const scrollToRoster = () => {
            const sec = document.getElementById('section-master-roster');
            if (sec) sec.scrollIntoView({ behavior: 'smooth' });
        };

        const btnScrollToRoster = document.getElementById('btn-scroll-to-roster');
        if (btnScrollToRoster) btnScrollToRoster.addEventListener('click', scrollToRoster);

        const mapBtnViewRoster = document.getElementById('map-btn-view-roster');
        if (mapBtnViewRoster) mapBtnViewRoster.addEventListener('click', scrollToRoster);

        const btnJumpRoster = document.getElementById('btn-jump-roster');
        if (btnJumpRoster) btnJumpRoster.addEventListener('click', scrollToRoster);

        const btnMasterScrollTop = document.getElementById('btn-master-scroll-top');
        if (btnMasterScrollTop) {
            btnMasterScrollTop.addEventListener('click', () => {
                const mapEl = document.getElementById('map');
                if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth' });
            });
        }

        // Master Roster Search Filter
        const masterSearch = document.getElementById('master-roster-search');
        if (masterSearch) {
            masterSearch.addEventListener('input', (e) => {
                const q = e.target.value.toLowerCase().trim();
                const rows = document.querySelectorAll('#master-roster-tbody tr');
                rows.forEach(r => {
                    const text = r.innerText.toLowerCase();
                    r.style.display = text.includes(q) ? '' : 'none';
                });
            });
        }

        // GitHub Pages Export Modal Controls
        const btnHeaderGhExport = document.getElementById('btn-header-gh-export');
        if (btnHeaderGhExport) btnHeaderGhExport.addEventListener('click', exportForGitHubPages);

        const btnMasterGhExport = document.getElementById('btn-master-gh-export');
        if (btnMasterGhExport) btnMasterGhExport.addEventListener('click', exportForGitHubPages);

        const ghModal = document.getElementById('modal-gh-export');
        const closeGhModal = () => { if (ghModal) ghModal.classList.add('hidden'); };
        const btnCloseGhModal = document.getElementById('btn-close-gh-modal');
        if (btnCloseGhModal) btnCloseGhModal.addEventListener('click', closeGhModal);
        const btnDoneGhModal = document.getElementById('btn-done-gh-modal');
        if (btnDoneGhModal) btnDoneGhModal.addEventListener('click', closeGhModal);

        const btnDownloadGhZip = document.getElementById('btn-download-gh-zip');
        if (btnDownloadGhZip) btnDownloadGhZip.addEventListener('click', exportForGitHubPages);

        const btnCopyGhData = document.getElementById('btn-copy-gh-data');
        if (btnCopyGhData) {
            btnCopyGhData.addEventListener('click', async () => {
                if (window._latestDataJsContent) {
                    try {
                        await navigator.clipboard.writeText(window._latestDataJsContent);
                        showToast('📋 Copied rewari-data.js code to clipboard!', 'success');
                    } catch (e) {
                        showToast('Could not access clipboard, file is in downloaded zip', 'info');
                    }
                }
            });
        }

        const btnDownloadStandaloneKml = document.getElementById('btn-download-standalone-kml');
        if (btnDownloadStandaloneKml) {
            btnDownloadStandaloneKml.addEventListener('click', () => {
                KMLExport.downloadKMLOrKMZ({
                    beats: BeatManager.getBeats(),
                    cleanRoads: state.cleanRoadsGeoJSON,
                    wards: state.wardsGeoJSON
                }, 'Rewari_30_Sweeper_Beats_Freeform.kml', false);
            });
        }

        const btnMasterSaveKml = document.getElementById('btn-master-save-kml');
        if (btnMasterSaveKml) {
            btnMasterSaveKml.addEventListener('click', () => {
                KMLExport.downloadKMLOrKMZ({
                    beats: BeatManager.getBeats(),
                    cleanRoads: state.cleanRoadsGeoJSON,
                    wards: state.wardsGeoJSON
                }, 'Rewari_30_Sweeper_Beats_Freeform.kml', false);
                showToast('🌍 Downloaded updated KML for Google Earth!', 'success');
            });
        }

        // Supabase Cloud Manual Sync Button
        const btnSyncSupabase = document.getElementById('btn-sync-supabase');
        if (btnSyncSupabase) {
            btnSyncSupabase.addEventListener('click', async () => {
                if (!window.SupabaseSync) {
                    showToast('Supabase client not loaded', 'error');
                    return;
                }
                showToast('Syncing with Supabase Cloud...', 'info');
                try {
                    const cloudBeats = await window.SupabaseSync.fetchBeats();
                    if (cloudBeats && cloudBeats.length > 0) {
                        BeatManager.setBeats(cloudBeats);
                        BeatManager.saveToLocalStorage();
                        refreshBeatsUI();
                        showToast(`☁️ Synced ${cloudBeats.length} beats from Supabase Cloud!`, 'success');
                    } else {
                        const beats = BeatManager.getBeats();
                        if (beats && beats.length > 0) {
                            await window.SupabaseSync.saveAllBeats(beats);
                            showToast(`☁️ Pushed ${beats.length} beats to Supabase Cloud!`, 'success');
                        }
                    }
                } catch (e) {
                    showToast('Supabase sync error: ' + e.message, 'error');
                }
            });
        }

        // Import Plan (GeoJSON / KML / JSON)
        const inputImportBeats = document.getElementById('input-import-beats');
        if (inputImportBeats) {
            inputImportBeats.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    handleImportPlan(e.target.files[0]);
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
     * Scroll up to map and focus on a specific beat
     */
    function focusBeatOnMap(beatId) {
        const mapContainer = document.getElementById('main-map-container') || document.querySelector('.map-container');
        if (mapContainer) {
            mapContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
        const map = MapController.getMap();
        if (!map) return;

        let targetLayer = null;
        map.eachLayer(l => {
            if (l.beatRef && l.beatRef.id === beatId) {
                targetLayer = l;
            }
        });

        if (targetLayer) {
            if (targetLayer.getBounds) {
                map.fitBounds(targetLayer.getBounds(), { padding: [50, 50], maxZoom: 16 });
            }
            setTimeout(() => {
                targetLayer.openPopup();
            }, 400);
        }
    }

    /**
     * Export all required files for GitHub Pages in 1 Click
     */
    async function exportForGitHubPages() {
        const beats = BeatManager.getBeats();
        if (beats.length === 0) {
            showToast('No beats loaded to export', 'warning');
            return;
        }

        // 1. Generate KML string
        const kmlString = KMLExport.generateKMLString({
            beats: beats,
            cleanRoads: state.cleanRoadsGeoJSON,
            wards: state.wardsGeoJSON
        });

        // 2. Generate GeoJSON string
        const geojsonFeatures = beats.map(b => {
            const f = b.polygonGeoJSON ? JSON.parse(JSON.stringify(b.polygonGeoJSON)) : {
                type: 'Feature',
                geometry: null
            };
            f.properties = f.properties || {};
            f.properties.id = b.id;
            f.properties.name = b.name;
            f.properties.ward = b.ward;
            f.properties.length_km = b.length_km;
            f.properties.sweepers = b.sweepers || 11;
            f.properties.dailyTargetMeters = b.dailyTargetMeters || Math.round((b.length_km * 1000) / (b.sweepers || 11));
            f.properties.darogaName = b.darogaName || '';
            f.properties.darogaPhone = b.darogaPhone || '';
            f.properties.workers = b.workers || '';
            f.properties.remarks = b.remarks || '';
            f.properties.color = b.color;
            return f;
        });
        const geojsonString = JSON.stringify({ type: 'FeatureCollection', features: geojsonFeatures }, null, 2);

        // 3. Generate updated js/rewari-data.js content
        const wardsJsonStr = state.wardsGeoJSON ? JSON.stringify(state.wardsGeoJSON) : (window.REWARI_WARDS ? JSON.stringify(window.REWARI_WARDS) : '{}');
        const roadsJsonStr = state.cleanRoadsGeoJSON ? JSON.stringify(state.cleanRoadsGeoJSON) : (window.REWARI_CLEAN_ROADS ? JSON.stringify(window.REWARI_CLEAN_ROADS) : '{}');
        
        const dataJsContent = `/**
 * Embedded Datasets for Offline & GitHub Pages Execution in Rewari Sweeper Beat Planning System
 */
window.REWARI_DEFAULT_BEATS = ${geojsonString};

window.REWARI_WARDS = ${wardsJsonStr};

window.REWARI_CLEAN_ROADS = ${roadsJsonStr};
`;

        // Store generated dataJsContent in window for 1-click clipboard copy
        window._latestDataJsContent = dataJsContent;
        window._latestKmlString = kmlString;
        window._latestGeoJsonString = geojsonString;

        // Use JSZip if available to create pre-packaged ZIP
        if (typeof JSZip !== 'undefined') {
            try {
                const zip = new JSZip();
                zip.file('Rewari_30_Sweeper_Beats_Freeform.kml', kmlString);
                zip.file('Rewari_30_Sweeper_Beats_Freeform.geojson', geojsonString);
                zip.folder('js').file('rewari-data.js', dataJsContent);
                zip.file('README_GITHUB_PAGES_UPDATE.txt', `Rewari Sweeper Beat Planning - GitHub Pages Update Package
=============================================================
Instructions to update your GitHub Pages deployment:

1. Unzip the contents of this package into your repository folder on your computer.
   - It will replace Rewari_30_Sweeper_Beats_Freeform.kml, Rewari_30_Sweeper_Beats_Freeform.geojson, and js/rewari-data.js.
2. Commit and push to GitHub:
   git add .
   git commit -m "Update sweeper beat boundaries and sanitary daroga roster"
   git push
3. Done! GitHub Pages will automatically redeploy with all your updated beat boundaries and Daroga allocations visible to everyone worldwide.
`);

                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(zipBlob);
                a.download = 'Rewari_GitHub_Pages_Update.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                showToast('📦 Downloaded Rewari_GitHub_Pages_Update.zip! Extract and git push to update GitHub Pages.', 'success');
            } catch (zErr) {
                console.warn('JSZip failed:', zErr);
            }
        }

        // Show the GitHub modal with instructions & copy button
        const ghModal = document.getElementById('modal-gh-export');
        if (ghModal) ghModal.classList.remove('hidden');
    }

    /**
     * Import customized GeoJSON, KML, or Project JSON
     */
    async function handleImportPlan(file) {
        if (!file) return;
        showToast(`Importing ${file.name}...`, 'info');
        try {
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'geojson' || ext === 'json') {
                const text = await file.text();
                const json = JSON.parse(text);
                if (json.type === 'FeatureCollection' && json.features) {
                    BeatManager.loadFreeformBeats(json);
                } else if (json.beats) {
                    BeatManager.setBeats(json.beats);
                    BeatManager.saveToLocalStorage();
                } else {
                    showToast('Invalid GeoJSON/JSON structure', 'error');
                    return;
                }
            } else if (ext === 'kml') {
                const text = await file.text();
                const geojson = await KMLParser.parseFile(text, file.name);
                BeatManager.loadFreeformBeats(geojson);
            }
            refreshBeatsUI();
            showToast(`Successfully imported plan from ${file.name}!`, 'success');
        } catch (e) {
            showToast('Failed to import file: ' + e.message, 'error');
        }
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
                tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No sweeper beats loaded. Click "Generate 30 Non-Overlapping Beats".</td></tr>`;
            } else {
                beats.forEach((b) => {
                    const sw = b.sweepers || 11;
                    const dailyTarget = b.dailyTargetMeters || Math.round((b.length_km * 1000) / sw);
                    const colorDot = b.color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${b.color};margin-right:6px;vertical-align:middle;"></span>` : '';
                    
                    const darogaCell = b.darogaName 
                        ? `<div style="font-weight:600;font-size:0.82rem;color:var(--text-main);">${b.darogaName}</div>${b.darogaPhone ? `<div class="small text-muted" style="font-size:0.75rem;">📞 ${b.darogaPhone}</div>` : ''}`
                        : `<span class="text-muted" style="font-style:italic;font-size:0.78rem;">Not assigned</span>`;

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${colorDot}<b>${b.name}</b></td>
                        <td><span class="badge badge-ward">${b.ward || 'Sector'}</span></td>
                        <td><b>${b.length_km} km</b></td>
                        <td><span class="badge" style="background:#1e293b;border:1px solid #38bdf8;color:#38bdf8;font-weight:600;">${sw} Sweepers</span> <span class="small text-muted" style="font-size:0.75rem;">(~${dailyTarget}m)</span></td>
                        <td>${darogaCell}</td>
                        <td>
                            <div class="d-flex gap-1">
                                <button class="btn btn-sm btn-outline-primary" onclick="App.openBeatAllotmentModal('${b.id}')" title="Edit Beat Name, Sweepers, Daroga & Worker Record">📋 Edit</button>
                                <button class="btn btn-sm btn-outline" onclick="MapController.enableSingleBeatEdit('${b.id}')" title="Drag boundary corners on map">🎯</button>
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

        // Populate Master Roster Table below map
        const masterTbody = document.getElementById('master-roster-tbody');
        if (masterTbody) {
            masterTbody.innerHTML = '';
            if (beats.length === 0) {
                masterTbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No sweeper beats loaded. Click "Generate 30 Non-Overlapping Beats".</td></tr>`;
            } else {
                let assignedDarogasCount = 0;
                let totalWorkforce = 0;

                beats.forEach((b) => {
                    const sw = b.sweepers || 11;
                    totalWorkforce += sw;
                    if (b.darogaName) assignedDarogasCount++;

                    const dailyTarget = b.dailyTargetMeters || Math.round((b.length_km * 1000) / sw);
                    const colorDot = b.color ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${b.color};margin-right:8px;vertical-align:middle;box-shadow:0 0 6px ${b.color};"></span>` : '';
                    
                    const darogaCell = b.darogaName 
                        ? `<div style="font-weight:700;font-size:0.88rem;color:#f8fafc;">${b.darogaName}</div>`
                        : `<span class="badge" style="background:rgba(239, 68, 68, 0.15); color:#fca5a5; font-weight:500;">Unassigned</span>`;

                    const phoneCell = b.darogaPhone 
                        ? `<a href="tel:${b.darogaPhone}" style="color:#38bdf8;text-decoration:none;font-weight:600;"><span style="font-size:0.8rem;">📞</span> ${b.darogaPhone}</a>`
                        : `<span class="text-muted" style="font-size:0.75rem;">—</span>`;

                    const workersPreview = b.workers 
                        ? `<div style="font-size:0.78rem;color:#94a3b8;max-width:280px;white-space:pre-wrap;max-height:48px;overflow-y:auto;">${b.workers}</div>`
                        : `<span class="text-muted" style="font-size:0.75rem;font-style:italic;">No workers allotted</span>`;

                    const mtr = document.createElement('tr');
                    mtr.dataset.beatId = b.id;
                    mtr.innerHTML = `
                        <td>${colorDot}<b>${b.name}</b></td>
                        <td><span class="badge badge-ward">${b.ward || 'Sector'}</span></td>
                        <td><b style="color:#10b981;">${b.length_km} km</b></td>
                        <td><span class="badge" style="background:#1e293b;border:1px solid #38bdf8;color:#38bdf8;font-weight:700;">${sw} Sweepers</span></td>
                        <td><b style="color:#f59e0b;">~${dailyTarget} m/day</b></td>
                        <td>${darogaCell}</td>
                        <td>${phoneCell}</td>
                        <td>${workersPreview}</td>
                        <td style="text-align:center;">
                            <div class="d-flex gap-1 justify-center">
                                <button class="btn btn-sm btn-primary" onclick="App.openBeatAllotmentModal('${b.id}')" title="Edit Beat Name, Sweepers, Daroga & Worker Record">✏️ Edit Allotment</button>
                                <button class="btn btn-sm btn-outline" onclick="App.focusBeatOnMap('${b.id}')" title="Zoom to beat on map">🎯 Map</button>
                            </div>
                        </td>
                    `;
                    masterTbody.appendChild(mtr);
                });

                // Update Master Stats Pills
                const elWf = document.getElementById('roster-stat-workforce');
                const elDar = document.getElementById('roster-stat-darogas');
                const elLen = document.getElementById('roster-stat-road-length');
                if (elWf) elWf.innerText = `${totalWorkforce} Sweepers`;
                if (elDar) elDar.innerText = `${assignedDarogasCount} / ${beats.length} Assigned`;
                if (elLen) elLen.innerText = `${stats.totalCleanRoadLengthKm} km`;
            }
        }
    }

    /**
     * Open Beat Allotment & Supervision Record Modal
     */
    function openBeatAllotmentModal(beatId) {
        const beats = BeatManager.getBeats();
        const beat = beats.find(b => b.id === beatId);
        if (!beat) {
            showToast('Beat not found', 'error');
            return;
        }

        const modal = document.getElementById('modal-beat-allotment');
        if (!modal) return;

        document.getElementById('edit-beat-id').value = beat.id;
        document.getElementById('edit-beat-name').value = beat.name || '';
        document.getElementById('edit-beat-ward').value = beat.ward || '';
        document.getElementById('edit-beat-sweepers').value = beat.sweepers || 11;
        document.getElementById('edit-beat-daroga').value = beat.darogaName || '';
        document.getElementById('edit-beat-phone').value = beat.darogaPhone || '';
        document.getElementById('edit-beat-workers').value = beat.workers || '';
        document.getElementById('edit-beat-remarks').value = beat.remarks || '';

        const sw = beat.sweepers || 11;
        const target = Math.round((beat.length_km * 1000) / sw);
        const lenDisp = document.getElementById('edit-beat-length-display');
        const targetDisp = document.getElementById('edit-beat-target-display');
        if (lenDisp) lenDisp.innerText = `${beat.length_km} km`;
        if (targetDisp) targetDisp.innerText = `~${target} m/day`;

        const title = document.getElementById('modal-beat-title');
        if (title) title.innerText = `Allotment Record: ${beat.name}`;

        modal.classList.remove('hidden');
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
        // 0. Instant offline & file:// loading from embedded datasets
        if (window.REWARI_DEFAULT_BEATS || window.REWARI_WARDS || window.REWARI_CLEAN_ROADS) {
            console.log('Loading Rewari datasets directly from embedded project store...');
            if (window.REWARI_WARDS) {
                state.wardsGeoJSON = window.REWARI_WARDS;
                MapController.renderWards(window.REWARI_WARDS);
            }
            if (window.REWARI_CLEAN_ROADS) {
                state.cleanRoadsGeoJSON = window.REWARI_CLEAN_ROADS;
                MapController.renderCleanRoads(window.REWARI_CLEAN_ROADS);
            }

            let beatsLoaded = false;
            // 1. Check Supabase Cloud live database first
            if (window.SupabaseSync) {
                try {
                    const cloudBeats = await window.SupabaseSync.fetchBeats();
                    if (cloudBeats && cloudBeats.length > 0) {
                        BeatManager.setBeats(cloudBeats);
                        BeatManager.saveToLocalStorage();
                        refreshBeatsUI();
                        beatsLoaded = true;
                        showToast(`☁️ Loaded ${cloudBeats.length} live beats from Supabase Cloud!`, 'success');
                    }
                } catch (sbErr) {
                    console.warn('Supabase fetch failed on startup:', sbErr);
                }
            }

            if (!beatsLoaded && BeatManager.loadFromLocalStorage && BeatManager.loadFromLocalStorage()) {
                refreshBeatsUI();
                beatsLoaded = true;
                showToast('Loaded your customized beat boundaries & allotments!', 'info');
            }

            if (!beatsLoaded && window.REWARI_DEFAULT_BEATS) {
                BeatManager.loadFreeformBeats(window.REWARI_DEFAULT_BEATS);
                refreshBeatsUI();
                showToast('Loaded 30 Continuous Sweeper Beats for Rewari!', 'success');
            }

            updateDataLayerBadges();
            return;
        }

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

                // Auto-load 30 continuous non-overlapping beats (checks Supabase Cloud first)
                let beatsLoaded = false;
                if (window.SupabaseSync) {
                    try {
                        const cloudBeats = await window.SupabaseSync.fetchBeats();
                        if (cloudBeats && cloudBeats.length > 0) {
                            BeatManager.setBeats(cloudBeats);
                            BeatManager.saveToLocalStorage();
                            refreshBeatsUI();
                            beatsLoaded = true;
                            showToast(`☁️ Loaded ${cloudBeats.length} live beats from Supabase Cloud!`, 'success');
                        }
                    } catch (sbErr) {
                        console.warn('Supabase fetch failed on startup:', sbErr);
                    }
                }

                if (!beatsLoaded && BeatManager.loadFromLocalStorage && BeatManager.loadFromLocalStorage()) {
                    refreshBeatsUI();
                    beatsLoaded = true;
                    showToast('Loaded your customized beat boundaries & allotments from storage!', 'info');
                }

                if (!beatsLoaded) {
                    try {
                        const beatsRes = await fetch('Rewari_30_Sweeper_Beats_Freeform.geojson');
                        if (beatsRes.ok) {
                            const beatsGeoJSON = await beatsRes.json();
                            BeatManager.loadFreeformBeats(beatsGeoJSON);
                            refreshBeatsUI();
                        }
                    } catch (bErr) {}
                }

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

        if (BeatManager.loadFromLocalStorage && BeatManager.loadFromLocalStorage()) {
            refreshBeatsUI();
        }
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
        runDeduplicationProcess,
        openBeatAllotmentModal,
        refreshBeatsUI,
        focusBeatOnMap,
        exportForGitHubPages
    };
})();

// Launch app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
