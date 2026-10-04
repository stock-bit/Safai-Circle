/**
 * Leaflet Map Controller for Rewari Sweeper Beat Planning System
 * Handles basemaps, GeoJSON layers, styling, interactive drawing, and spatial length queries.
 */

window.MapController = (function () {
    let map = null;
    let layers = {
        wards: null,
        ulbRoads: null,
        existingRoads: null,
        cleanRoads: null,
        duplicateRoads: null,
        beats: null,
        drawItems: null
    };

    let activeCleanRoadsGeoJSON = null;
    let activeWardsGeoJSON = null;
    let onAreaDrawnCallback = null;

    // Rewari Coordinates
    const REWARI_CENTER = [28.1968, 76.6176];
    const DEFAULT_ZOOM = 13;

    // Colors
    const STYLES = {
        ward: { color: '#1e293b', weight: 2.5, fillColor: '#38bdf8', fillOpacity: 0.08 },
        ulbRoads: { color: '#2563eb', weight: 2, opacity: 0.8 },
        existingRoads: { color: '#f97316', weight: 1.5, opacity: 0.7 },
        cleanRoads: { color: '#10b981', weight: 2.5, opacity: 0.9 },
        duplicateRoads: { color: '#ef4444', weight: 2, opacity: 0.8, dashArray: '5, 5' },
        drawnArea: { color: '#8b5cf6', weight: 2.5, fillColor: '#a78bfa', fillOpacity: 0.25 }
    };

    /**
     * Initialize Leaflet Map
     */
    function initMap(elementId = 'map') {
        if (map) return map;

        map = L.map(elementId, {
            center: REWARI_CENTER,
            zoom: DEFAULT_ZOOM,
            zoomControl: false
        });

        // Add Zoom Control to Top Right
        L.control.zoom({ position: 'topright' }).addTo(map);

        // Basemaps with compliant subdomains & fallbacks
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            subdomains: ['a', 'b', 'c'],
            crossOrigin: true,
            attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
        });

        const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 20,
            subdomains: ['a', 'b', 'c', 'd'],
            crossOrigin: true,
            attribution: '© <a href="https://carto.com/" target="_blank">CARTO</a>'
        });

        const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            attribution: '© Google Satellite'
        });

        const googleSatellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            attribution: '© Google Satellite'
        });

        const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{x}/{y}', {
            maxZoom: 19,
            attribution: 'Tiles © Esri'
        });

        const esriStreet = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{x}/{y}', {
            maxZoom: 19,
            attribution: 'Tiles © Esri'
        });

        // Offline / Grid Canvas Basemap Fallback
        const OfflineGridLayer = L.GridLayer.extend({
            createTile: function (coords) {
                const tile = document.createElement('canvas');
                tile.width = 256;
                tile.height = 256;
                const ctx = tile.getContext('2d');

                // Grid canvas background
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, 0, 256, 256);

                // Grid lines
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 1;
                ctx.strokeRect(0, 0, 256, 256);

                // Coordinates label
                ctx.fillStyle = '#475569';
                ctx.font = '10px sans-serif';
                ctx.fillText(`z:${coords.z} x:${coords.x} y:${coords.y}`, 10, 20);

                return tile;
            }
        });
        const offlineGrid = new OfflineGridLayer({ attribution: 'Offline Local Canvas Grid' });

        // Default Basemap: Google Hybrid Satellite (crystal clear imagery + streets/labels)
        googleHybrid.addTo(map);

        const baseMaps = {
            "Google Satellite (Hybrid)": googleHybrid,
            "Google Satellite (Pure)": googleSatellite,
            "Esri Satellite": esriSatellite,
            "CARTO Voyager": cartoVoyager,
            "OpenStreetMap": osm,
            "Esri Streets": esriStreet,
            "Offline Grid": offlineGrid
        };

        // Fallback handler if a tile fails to load
        [googleHybrid, googleSatellite, esriSatellite, osm, cartoVoyager, esriStreet].forEach(layer => {
            layer.on('tileerror', function (error) {
                console.warn('Tile load error for layer, falling back if needed:', error);
            });
        });

        // Create Layer Groups - Only Wards, Clean Roads, and Beats are active by default!
        layers.wards = L.layerGroup().addTo(map);
        layers.cleanRoads = L.layerGroup().addTo(map);
        layers.beats = L.layerGroup().addTo(map);
        layers.ulbRoads = L.layerGroup(); // Raw unclipped layers hidden by default
        layers.existingRoads = L.layerGroup(); // Raw unclipped layers hidden by default
        layers.duplicateRoads = L.layerGroup();
        layers.drawItems = new L.FeatureGroup().addTo(map);

        const overlayMaps = {
            "Ward Boundaries": layers.wards,
            "Clean Roads (Inside Wards)": layers.cleanRoads,
            "Sweeper Beats": layers.beats,
            "Raw MC / ULB Roads": layers.ulbRoads,
            "Raw Reference Roads": layers.existingRoads,
            "Duplicate Roads (Removed)": layers.duplicateRoads,
            "Active Drawing": layers.drawItems
        };

        L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

        // Setup Drawing Control (Leaflet.pm / Geoman or Leaflet.draw fallback)
        setupDrawingTools();

        return map;
    }

    /**
     * Setup Leaflet Drawing tools
     */
    function setupDrawingTools() {
        if (typeof map.pm !== 'undefined') {
            map.pm.addControls({
                position: 'topleft',
                drawCircleMarker: false,
                drawPolyline: false,
                drawMarker: false,
                cutPolygon: false
            });

            map.on('pm:create', e => {
                const layer = e.layer;
                layers.drawItems.clearLayers();
                layers.drawItems.addLayer(layer);
                handleShapeDrawn(layer);
            });

            map.on('pm:remove', e => {
                if (onAreaDrawnCallback) onAreaDrawnCallback(null);
            });
        }
    }

    /**
     * Handle drawn polygon/rectangle/circle calculations
     */
    function handleShapeDrawn(layer) {
        if (!activeCleanRoadsGeoJSON) {
            console.warn('No active Clean Roads dataset loaded for calculation.');
        }

        const geojson = layer.toGeoJSON();

        // Convert circle to polygon if necessary
        let polygonGeoJSON = geojson;
        if (layer instanceof L.Circle && typeof turf !== 'undefined') {
            const center = [layer.getLatLng().lng, layer.getLatLng().lat];
            const radiusKm = layer.getRadius() / 1000;
            polygonGeoJSON = turf.circle(center, radiusKm, { units: 'kilometers' });
        }

        const stats = calculateRoadsInPolygon(polygonGeoJSON);
        stats.drawnLayer = layer;
        stats.polygonGeoJSON = polygonGeoJSON;

        if (onAreaDrawnCallback) {
            onAreaDrawnCallback(stats);
        }
    }

    /**
     * Calculate exact road length clipped inside a polygon using Turf.js
     */
    function calculateRoadsInPolygon(polygonGeoJSON) {
        if (!activeCleanRoadsGeoJSON || !activeCleanRoadsGeoJSON.features) {
            return { length_km: 0, segment_count: 0, area_km2: 0, wards: [] };
        }

        if (typeof turf === 'undefined') {
            return { length_km: 0, segment_count: 0, area_km2: 0, wards: [] };
        }

        let totalLengthKm = 0;
        let segmentCount = 0;
        const wardSet = new Set();

        const polygonAreaKm2 = Number(turf.area(polygonGeoJSON) / 1000000).toFixed(2);

        // Check intersecting Wards
        if (activeWardsGeoJSON && activeWardsGeoJSON.features) {
            activeWardsGeoJSON.features.forEach(w => {
                try {
                    if (turf.booleanIntersects(polygonGeoJSON, w)) {
                        const wNum = w.properties.ward || w.properties.Ward || w.properties.WARD || w.properties.name;
                        if (wNum) wardSet.add(wNum);
                    }
                } catch (e) {}
            });
        }

        // Clip Clean Roads
        activeCleanRoadsGeoJSON.features.forEach(road => {
            try {
                if (!turf.booleanIntersects(road, polygonGeoJSON)) return;

                // Split or intersect road with polygon
                const lineSplit = turf.lineSplit(road, polygonGeoJSON);

                if (lineSplit.features.length === 0) {
                    // Check if whole line is inside
                    const coords = road.geometry.type === 'LineString' ? road.geometry.coordinates : road.geometry.coordinates[0];
                    const midPt = turf.point(coords[Math.floor(coords.length / 2)]);
                    if (turf.booleanPointInPolygon(midPt, polygonGeoJSON)) {
                        const len = turf.length(road, { units: 'kilometers' });
                        totalLengthKm += len;
                        segmentCount++;
                    }
                } else {
                    lineSplit.features.forEach(segment => {
                        const midPt = turf.along(segment, turf.length(segment) / 2, { units: 'kilometers' });
                        if (turf.booleanPointInPolygon(midPt, polygonGeoJSON)) {
                            const len = turf.length(segment, { units: 'kilometers' });
                            totalLengthKm += len;
                            segmentCount++;
                        }
                    });
                }
            } catch (e) {
                // Ignore clipping errors
            }
        });

        return {
            length_km: Number(totalLengthKm.toFixed(2)),
            segment_count: segmentCount,
            area_km2: Number(polygonAreaKm2),
            wards: Array.from(wardSet).sort((a,b) => a - b)
        };
    }

    /**
     * Render Ward Boundaries Layer
     */
    function renderWards(geoJSON) {
        activeWardsGeoJSON = geoJSON;
        layers.wards.clearLayers();
        if (!geoJSON) return;

        const leafletLayer = L.geoJSON(geoJSON, {
            style: STYLES.ward,
            onEachFeature: (feature, layer) => {
                const wardName = feature.properties.name || feature.properties.ward || `Ward ${feature.id || ''}`;
                layer.bindPopup(`<b>${wardName}</b><br>Municipal Ward Boundary`);
                
                // Tooltip showing ward name
                layer.bindTooltip(`${wardName}`, { permanent: false, direction: 'center', className: 'ward-label' });
            }
        });

        layers.wards.addLayer(leafletLayer);
        map.fitBounds(leafletLayer.getBounds(), { padding: [20, 20] });
    }

    /**
     * Render ULB Roads Layer
     */
    function renderULBRoads(geoJSON) {
        layers.ulbRoads.clearLayers();
        if (!geoJSON) return;

        const leafletLayer = L.geoJSON(geoJSON, {
            style: STYLES.ulbRoads,
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`<b>ULB Road: ${p.name || 'Unnamed'}</b><br>Length: ${p.length_km || 0} km<br>Agency: Municipal Council Rewari`);
            }
        });

        layers.ulbRoads.addLayer(leafletLayer);
    }

    /**
     * Render Existing Reference Roads Layer
     */
    function renderExistingRoads(geoJSON) {
        layers.existingRoads.clearLayers();
        if (!geoJSON) return;

        const leafletLayer = L.geoJSON(geoJSON, {
            style: STYLES.existingRoads,
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`<b>Reference Road: ${p.name || 'Unnamed'}</b><br>Length: ${p.length_km || 0} km<br>Agency: ${p.agency || 'Other'}`);
            }
        });

        layers.existingRoads.addLayer(leafletLayer);
    }

    /**
     * Render Clean Roads Layer
     */
    function renderCleanRoads(geoJSON) {
        activeCleanRoadsGeoJSON = geoJSON;
        layers.cleanRoads.clearLayers();
        if (!geoJSON) return;

        const leafletLayer = L.geoJSON(geoJSON, {
            style: STYLES.cleanRoads,
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`<b>Clean Road: ${p.name || 'Unnamed'}</b><br>Length: ${p.length_km || 0} km<br>Source: ${p._source ? p._source.toUpperCase() : 'Clean'}`);
            }
        });

        layers.cleanRoads.addLayer(leafletLayer);

        // Ensure Clean Roads is visible on map
        if (!map.hasLayer(layers.cleanRoads)) {
            layers.cleanRoads.addTo(map);
        }

        // Fit map bounds to Clean Roads inside Rewari Wards
        if (leafletLayer.getLayers().length > 0) {
            map.fitBounds(leafletLayer.getBounds(), { padding: [20, 20] });
        }
    }

    /**
     * Render Duplicate Roads Layer
     */
    function renderDuplicateRoads(duplicateGroups) {
        layers.duplicateRoads.clearLayers();
        if (!duplicateGroups || duplicateGroups.length === 0) return;

        duplicateGroups.forEach(group => {
            const ulbProps = group.ulbRoad;
            const refProps = group.refRoad;

            // Highlight duplicate candidate lines
            const popupContent = `
                <div class="duplicate-popup">
                    <h4>Duplicate Pair #${group.id}</h4>
                    <p><b>ULB Road:</b> ${ulbProps.name} (${ulbProps.length_km} km)</p>
                    <p><b>Ref Road:</b> ${refProps.name} (${refProps.length_km} km)</p>
                    <p><b>Distance:</b> ${group.distance_m} m | <b>Overlap:</b> ${group.overlap_percent}%</p>
                </div>
            `;
        });
    }

    /**
     * Render Sweeper Beats Layer
     */
    let isBeatEditingActive = false;
    let showBeatLabels = false; // Default FALSE: keeps map clean so beats and satellite view are clearly visible!
    let currentBeatsList = [];

    /**
     * Render Sweeper Beats Layer with Geoman Boundary Editing & Allotment Support
     */
    function renderBeats(beatsList) {
        currentBeatsList = beatsList || [];
        layers.beats.clearLayers();
        if (!beatsList || beatsList.length === 0) return;

        const beatColors = [
            '#e11d48', '#ea580c', '#d97706', '#65a30d', '#16a34a', 
            '#059669', '#0d9488', '#0891b2', '#0284c7', '#2563eb', 
            '#4f46e5', '#7c3aed', '#9333ea', '#c026d3', '#db2777'
        ];

        beatsList.forEach((beat, idx) => {
            if (!beat.polygonGeoJSON) return;

            const color = beat.color || beatColors[idx % beatColors.length];
            const leafletLayer = L.geoJSON(beat.polygonGeoJSON, {
                style: {
                    color: color,
                    weight: 2.5,
                    fillColor: color,
                    fillOpacity: 0.30
                },
                onEachFeature: (feature, layer) => {
                    layer.beatRef = beat;

                    // Geoman vertex edit event
                    layer.on('pm:edit', () => {
                        const editedGeoJSON = layer.toGeoJSON();
                        beat.polygonGeoJSON = editedGeoJSON;

                        // Recalculate clean roads inside updated boundary
                        if (typeof turf !== 'undefined' && activeCleanRoadsGeoJSON) {
                            let newLengthKm = 0;
                            let roadCount = 0;
                            activeCleanRoadsGeoJSON.features.forEach(rf => {
                                const mid = rf.geometry.coordinates[Math.floor(rf.geometry.coordinates.length / 2)];
                                if (turf.booleanPointInPolygon(mid, editedGeoJSON)) {
                                    newLengthKm += turf.length(rf, { units: 'kilometers' });
                                    roadCount++;
                                }
                            });
                            beat.length_km = Number(newLengthKm.toFixed(2));
                            beat.segment_count = roadCount;
                            beat.area_km2 = Number((turf.area(editedGeoJSON) / 1000000).toFixed(2));

                            const sw = beat.sweepers || 11;
                            layer.setTooltipContent(`<b>${beat.name}</b><br>${beat.length_km} km (${sw} Sw.)`);
                            if (window.BeatManager && window.BeatManager.saveToLocalStorage) {
                                window.BeatManager.saveToLocalStorage();
                            }
                            if (window.SupabaseSync && window.SupabaseSync.saveBeat) {
                                window.SupabaseSync.saveBeat(beat).then(success => {
                                    if (success && window.App && window.App.showToast) {
                                        window.App.showToast(`☁️ Updated boundary & road length saved to Supabase: ${beat.name} (${beat.length_km} km)`, 'success');
                                    }
                                }).catch(e => console.warn('Supabase sync error on pm:edit:', e));
                            }
                            if (window.App && window.App.refreshBeatsUI) {
                                window.App.refreshBeatsUI(false);
                            }
                        }
                    });

                    const swCount = beat.sweepers || 11;
                    const dailyTarget = Math.round((beat.length_km * 1000) / swCount);
                    const darogaInfo = beat.darogaName ? `<b>Sanitary Daroga:</b> ${beat.darogaName} ${beat.darogaPhone ? '(' + beat.darogaPhone + ')' : ''}` : `<span class="text-muted"><i>Daroga: Not assigned</i></span>`;
                    const workersSnippet = beat.workers ? `<p style="margin:2px 0; font-size:0.75rem; color:#94a3b8;"><b>Allotted:</b> ${beat.workers.length > 60 ? beat.workers.substring(0, 60) + '...' : beat.workers}</p>` : '';

                    layer.bindPopup(`
                        <div class="beat-popup" style="min-width: 240px;">
                            <h4 style="color:${color}; margin:0 0 6px 0; font-size:1.05rem;">${beat.name}</h4>
                            <p style="margin:2px 0;"><b>Corridors/Ward:</b> ${beat.ward || 'Cross-Ward Sector'}</p>
                            <p style="margin:2px 0;"><b>Road Length:</b> <b>${beat.length_km} km</b></p>
                            <p style="margin:2px 0;"><b>Workforce Deployed:</b> <b>${swCount} Sweepers</b> (~${dailyTarget}m/day per worker)</p>
                            <p style="margin:2px 0;">${darogaInfo}</p>
                            ${workersSnippet}
                            <p style="margin:2px 0; font-size:0.75rem;"><b>Streets:</b> ${beat.segment_count || 0} segments | ${beat.area_km2 || 0} km²</p>
                            <div style="margin-top:10px; display:flex; gap:6px;">
                                <button class="btn btn-sm btn-primary" style="flex:1;" onclick="App.openBeatAllotmentModal('${beat.id}')">✏️ Edit Allotment</button>
                                <button class="btn btn-sm btn-warning" style="flex:1;" onclick="MapController.enableSingleBeatEdit('${beat.id}')">🎯 Drag Borders</button>
                            </div>
                        </div>
                    `);

                    // Tooltip display: If showBeatLabels is true, make it permanent; otherwise sticky on hover!
                    layer.bindTooltip(`<b>${beat.name}</b><br>${beat.length_km} km (${swCount} Sw.)`, {
                        permanent: showBeatLabels,
                        sticky: !showBeatLabels,
                        direction: showBeatLabels ? 'center' : 'top',
                        className: 'beat-label'
                    });

                    if (isBeatEditingActive && layer.pm) {
                        layer.pm.enable({ allowSelfIntersection: false, draggable: true });
                    }
                }
            });

            layers.beats.addLayer(leafletLayer);
        });
    }

    /**
     * Toggle visibility of permanent Beat Labels across map
     */
    function toggleBeatLabels(show) {
        if (typeof show === 'boolean') {
            showBeatLabels = show;
        } else {
            showBeatLabels = !showBeatLabels;
        }
        renderBeats(currentBeatsList);
        return showBeatLabels;
    }

    /**
     * Toggle Geoman vertex editing on all beat boundaries
     */
    function toggleBeatsEditMode(enable) {
        isBeatEditingActive = enable;
        layers.beats.eachLayer(groupLayer => {
            const handleLayer = (l) => {
                if (l.pm) {
                    if (enable) {
                        l.pm.enable({ allowSelfIntersection: false, draggable: true });
                    } else {
                        l.pm.disable();
                    }
                }
            };
            if (groupLayer.eachLayer) groupLayer.eachLayer(handleLayer);
            else handleLayer(groupLayer);
        });
    }

    /**
     * Enable editing on a single beat
     */
    function enableSingleBeatEdit(beatId) {
        layers.beats.eachLayer(groupLayer => {
            const checkAndEnable = (l) => {
                if (l.beatRef && l.beatRef.id === beatId && l.pm) {
                    l.pm.enable({ allowSelfIntersection: false, draggable: true });
                    l.closePopup();
                }
            };
            if (groupLayer.eachLayer) groupLayer.eachLayer(checkAndEnable);
            else checkAndEnable(groupLayer);
        });
    }

    /**
     * Clear active drawing items
     */
    function clearDrawnItems() {
        layers.drawItems.clearLayers();
    }

    return {
        initMap,
        renderWards,
        renderULBRoads,
        renderExistingRoads,
        renderCleanRoads,
        renderDuplicateRoads,
        renderBeats,
        toggleBeatLabels,
        isBeatLabelsVisible: () => showBeatLabels,
        toggleBeatsEditMode,
        enableSingleBeatEdit,
        isBeatEditingActive: () => isBeatEditingActive,
        clearDrawnItems,
        setOnAreaDrawnCallback: (cb) => { onAreaDrawnCallback = cb; },
        getActiveCleanRoads: () => activeCleanRoadsGeoJSON,
        getActiveWards: () => activeWardsGeoJSON,
        getMap: () => map
    };
})();
