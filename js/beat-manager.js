/**
 * Beat Manager Module for Rewari Sweeper Beat Planning System
 * Manages beat creation, editing, deletion, ward associations, statistics dashboard, and automated 30-beat balancing.
 */

window.BeatManager = (function () {
    let beats = [];
    let beatCounter = 1;

    /**
     * Add a new beat
     * @param {Object} beatData 
     */
    function addBeat(beatData) {
        const id = beatData.id || ('beat_' + (beatCounter++));
        const name = beatData.name || `Beat ${String(beats.length + 1).padStart(2, '0')}`;
        
        const newBeat = {
            id: id,
            name: name,
            ward: beatData.ward || (beatData.wards && beatData.wards.length > 0 ? beatData.wards.join(', ') : 'N/A'),
            length_km: Number(beatData.length_km || 0),
            area_km2: Number(beatData.area_km2 || 0),
            segment_count: Number(beatData.segment_count || 0),
            sweepers: Number(beatData.sweepers || 11),
            dailyTargetMeters: Number(beatData.dailyTargetMeters || 600),
            darogaName: beatData.darogaName || '',
            darogaPhone: beatData.darogaPhone || '',
            workers: beatData.workers || '',
            color: beatData.color || null,
            remarks: beatData.remarks || '',
            polygonGeoJSON: beatData.polygonGeoJSON || null,
            createdAt: beatData.createdAt || new Date().toISOString()
        };

        beats.push(newBeat);
        saveToLocalStorage();
        if (window.SupabaseSync && window.SupabaseSync.saveBeat) {
            window.SupabaseSync.saveBeat(newBeat).catch(e => console.warn('Supabase sync error on addBeat:', e));
        }
        return newBeat;
    }

    /**
     * Save current beats array to localStorage
     */
    function saveToLocalStorage() {
        try {
            localStorage.setItem('rewari_beats_saved_state', JSON.stringify(beats));
        } catch (e) {
            console.warn('Could not save beats to localStorage:', e);
        }
    }

    /**
     * Load beats array from localStorage
     */
    function loadFromLocalStorage() {
        try {
            const data = localStorage.getItem('rewari_beats_saved_state');
            if (data) {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    beats = parsed;
                    beatCounter = beats.length + 1;
                    return true;
                }
            }
        } catch (e) {
            console.warn('Could not load beats from localStorage:', e);
        }
        return false;
    }

    /**
     * Clear saved beats from localStorage
     */
    function clearLocalStorage() {
        try {
            localStorage.removeItem('rewari_beats_saved_state');
        } catch (e) {}
    }

    /**
     * Load Free-Form Non-Overlapping Beats from GeoJSON or parsed KML
     * - Only includes Polygons / MultiPolygons
     * - Filters out ward polygons (e.g. Ward 1..32)
     * - Automatically recalculates clean road length & sweeper counts immediately
     * - Resets old roster/daroga allotment data as a new beat plan generates fresh roster
     * - Limits strictly to 30 beats
     */
    function loadFreeformBeats(geoJSON) {
        clearAllBeats();
        if (!geoJSON || !geoJSON.features) return [];

        const defaultBeatColors = [
            '#e11d48', '#ea580c', '#d97706', '#65a30d', '#16a34a', 
            '#059669', '#0d9488', '#0891b2', '#0284c7', '#2563eb', 
            '#4f46e5', '#7c3aed', '#9333ea', '#c026d3', '#db2777'
        ];

        // 1. Filter out LineStrings / non-polygons and Ward boundaries
        const wardNameRegex = /^\s*(ward\b[\s_-]*\d*|\d{1,2})\s*$/i;
        const polygonFeatures = geoJSON.features.filter(f => {
            if (!f || !f.geometry) return false;
            const geomType = f.geometry.type;
            if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') return false;

            const name = (f.properties && (f.properties.name || f.properties.Name || f.properties.beatNo)) || '';
            // If feature name matches purely a ward number or Ward NN, ignore
            if (wardNameRegex.test(name.trim())) return false;
            return true;
        });

        // 2. Process up to 30 beats
        const maxBeats = Math.min(30, polygonFeatures.length);
        const newBeatsList = [];

        for (let i = 0; i < maxBeats; i++) {
            const f = polygonFeatures[i];
            const props = f.properties || {};
            const beatNum = i + 1;
            const padNum = String(beatNum).padStart(2, '0');

            // Format clean name
            let cleanName = props.name || props.beatNo || `Beat ${padNum}`;
            cleanName = cleanName.replace(/\s*\[Boundary\]/i, '').trim();

            // Calculate exact clipped road length and stats using Turf.js immediately
            let roadLengthKm = 0;
            let roadCount = 0;
            let areaKm2 = 0;
            let wardNames = 'Cross-Ward Sector';

            if (window.MapController && window.MapController.calculateRoadsInPolygon) {
                const stats = window.MapController.calculateRoadsInPolygon(f);
                roadLengthKm = stats.length_km || 0;
                roadCount = stats.segment_count || 0;
                areaKm2 = stats.area_km2 || 0;
                if (stats.wards && stats.wards.length > 0) {
                    wardNames = stats.wards.map(w => `Ward ${w}`).join(', ');
                }
            } else if (typeof turf !== 'undefined') {
                try {
                    areaKm2 = Number((turf.area(f) / 1000000).toFixed(2));
                } catch (e) {}
                roadLengthKm = Number(props.length_km || 0);
                roadCount = Number(props.roadCount || props.segment_count || 0);
            }

            // Fallback to props if calculation had no roads layer loaded yet
            if (roadLengthKm === 0 && props.length_km) {
                roadLengthKm = Number(props.length_km);
            }
            if (roadCount === 0 && (props.roadCount || props.segment_count)) {
                roadCount = Number(props.roadCount || props.segment_count);
            }

            // Compute sweepers required (~900m per sweeper target as requested)
            const TARGET_METERS_PER_SWEEPER = 900;
            const sweepers = Math.max(1, Math.round((roadLengthKm * 1000) / TARGET_METERS_PER_SWEEPER)) || (props.sweepers || 11);
            const dailyTarget = Math.round((roadLengthKm * 1000) / sweepers);

            const beatColor = props.color || defaultBeatColors[i % defaultBeatColors.length];

            const beatObj = {
                id: `beat-${beatNum}`,
                name: cleanName,
                ward: props.ward || props.type || wardNames,
                length_km: Number(roadLengthKm.toFixed(2)),
                area_km2: Number(areaKm2),
                segment_count: roadCount,
                sweepers: sweepers,
                dailyTargetMeters: dailyTarget,
                // Fresh roster reset upon upload as new beat boundaries create fresh roster
                darogaName: '',
                darogaPhone: '',
                workers: '',
                color: beatColor,
                remarks: props.remarks || 'Continuous non-overlapping free-form beat',
                polygonGeoJSON: f
            };

            beats.push(beatObj);
            newBeatsList.push(beatObj);
        }

        saveToLocalStorage();

        // Sync fresh 30 beats directly to Supabase Cloud if available
        if (window.SupabaseSync && window.SupabaseSync.replaceAllBeats) {
            window.SupabaseSync.replaceAllBeats(newBeatsList).catch(e => {
                console.warn('Supabase replace error on loadFreeformBeats:', e);
            });
        }

        return getBeats();
    }

    /**
     * Update an existing beat
     */
    function updateBeat(id, updatedFields) {
        const index = beats.findIndex(b => b.id === id);
        if (index !== -1) {
            beats[index] = { ...beats[index], ...updatedFields };
            if (beats[index].sweepers && beats[index].length_km) {
                beats[index].dailyTargetMeters = Math.round((beats[index].length_km * 1000) / beats[index].sweepers);
            }
            saveToLocalStorage();
            if (window.SupabaseSync && window.SupabaseSync.saveBeat) {
                window.SupabaseSync.saveBeat(beats[index]).catch(e => console.warn('Supabase sync error on updateBeat:', e));
            }
            return beats[index];
        }
        return null;
    }

    /**
     * Delete a beat by ID
     */
    function deleteBeat(id) {
        beats = beats.filter(b => b.id !== id);
        saveToLocalStorage();
        if (window.SupabaseSync && window.SupabaseSync.deleteBeat) {
            window.SupabaseSync.deleteBeat(id).catch(e => console.warn('Supabase delete error on deleteBeat:', e));
        }
    }

    /**
     * Clear all beats
     */
    function clearAllBeats() {
        beats = [];
        beatCounter = 1;
        saveToLocalStorage();
    }

    /**
     * Get all beats list
     */
    function getBeats() {
        return beats;
    }

    /**
     * Set beats list (used when loading project)
     */
    function setBeats(newBeats) {
        beats = newBeats || [];
        beatCounter = beats.length + 1;
    }

    /**
     * Calculate Summary Statistics Dashboard Data
     * @param {Object} cleanRoadsGeoJSON Active Clean Roads FeatureCollection
     */
    function getDashboardStats(cleanRoadsGeoJSON) {
        let totalCleanRoadLengthKm = 0;

        if (cleanRoadsGeoJSON && cleanRoadsGeoJSON.features) {
            cleanRoadsGeoJSON.features.forEach(f => {
                if (typeof turf !== 'undefined') {
                    totalCleanRoadLengthKm += turf.length(f, { units: 'kilometers' });
                } else if (f.properties && f.properties.length_km) {
                    totalCleanRoadLengthKm += f.properties.length_km;
                }
            });
        }

        const totalBeats = beats.length;
        const totalCoveredRoadLengthKm = beats.reduce((sum, b) => sum + (b.length_km || 0), 0);
        const avgRoadLengthPerBeat = totalBeats > 0 ? (totalCoveredRoadLengthKm / totalBeats).toFixed(2) : '0.00';

        // Ward distribution stats
        const wardStats = {};
        beats.forEach(b => {
            const wardKey = b.ward || 'Unassigned';
            if (!wardStats[wardKey]) {
                wardStats[wardKey] = { beatCount: 0, roadLengthKm: 0, areaKm2: 0 };
            }
            wardStats[wardKey].beatCount += 1;
            wardStats[wardKey].roadLengthKm += b.length_km;
            wardStats[wardKey].areaKm2 += b.area_km2;
        });

        return {
            totalCleanRoadLengthKm: Number(totalCleanRoadLengthKm.toFixed(2)),
            totalCoveredRoadLengthKm: Number(totalCoveredRoadLengthKm.toFixed(2)),
            totalBeats: totalBeats,
            avgRoadLengthPerBeat: avgRoadLengthPerBeat,
            wardStats: wardStats
        };
    }

    /**
     * Automated Balanced Cross-Ward Beat Balancing Engine (Target ~30 Beats)
     * CRITICAL REQUIREMENT: Beats MUST NOT be confined within a single ward.
     * Beats are intentionally assigned across pairs of adjacent wards (straddling ward boundaries)
     * so that workers are not subject to the sole jurisdiction or exploitation of a single ward member.
     * @param {Object} cleanRoadsGeoJSON 
     * @param {Object} wardsGeoJSON 
     * @param {number} targetBeatCount 
     */
    function generateBalancedBeats(cleanRoadsGeoJSON, wardsGeoJSON, targetBeatCount = 30) {
        if (!cleanRoadsGeoJSON || !cleanRoadsGeoJSON.features || cleanRoadsGeoJSON.features.length === 0) {
            throw new Error('No Clean Road Network available for beat balancing.');
        }

        if (typeof turf === 'undefined') {
            throw new Error('Turf.js is required for automatic beat balancing.');
        }

        clearAllBeats();

        // 1. Total clean road length
        let totalLengthKm = 0;
        cleanRoadsGeoJSON.features.forEach(f => {
            const len = turf.length(f, { units: 'kilometers' });
            f._computedLenKm = len;
            totalLengthKm += len;
        });

        const targetLengthPerBeat = totalLengthKm / targetBeatCount;

        // 2. Extract Wards and their Centroids
        const wardList = [];
        if (wardsGeoJSON && wardsGeoJSON.features && wardsGeoJSON.features.length > 0) {
            wardsGeoJSON.features.forEach((wf, idx) => {
                const wId = wf.properties.ward || wf.properties.Ward || wf.properties.WARD || wf.properties.name || `${idx + 1}`;
                try {
                    const center = turf.centroid(wf).geometry.coordinates;
                    wardList.push({
                        id: String(wId),
                        feature: wf,
                        center: center
                    });
                } catch (e) {}
            });
        }

        // 3. Find Adjacent Ward Pairs
        // A pair of wards is adjacent if their boundary distance is small or centroids are nearby
        const adjacentPairs = [];
        for (let i = 0; i < wardList.length; i++) {
            for (let j = i + 1; j < wardList.length; j++) {
                const w1 = wardList[i];
                const w2 = wardList[j];
                const dKm = turf.distance(w1.center, w2.center, { units: 'kilometers' });
                // Check if they are neighboring wards (< 3.0 km distance between centers)
                if (dKm < 3.0) {
                    adjacentPairs.push({
                        w1: w1.id,
                        w2: w2.id,
                        center: [(w1.center[0] + w2.center[0]) / 2, (w1.center[1] + w2.center[1]) / 2],
                        feature1: w1.feature,
                        feature2: w2.feature
                    });
                }
            }
        }

        // If not enough adjacent pairs found, create cross-ward pairs using sequential neighbors
        if (adjacentPairs.length < targetBeatCount) {
            for (let i = 0; i < wardList.length; i++) {
                const nextIdx = (i + 1) % wardList.length;
                adjacentPairs.push({
                    w1: wardList[i].id,
                    w2: wardList[nextIdx].id,
                    center: [(wardList[i].center[0] + wardList[nextIdx].center[0]) / 2, (wardList[i].center[1] + wardList[nextIdx].center[1]) / 2],
                    feature1: wardList[i].feature,
                    feature2: wardList[nextIdx].feature
                });
            }
        }

        // Sort adjacent pairs geographically to distribute cleanly across Rewari
        adjacentPairs.sort((a, b) => (a.center[0] - b.center[0]) || (a.center[1] - b.center[1]));

        // Select evenly spaced 30 cross-ward seeds
        const selectedPairs = [];
        const step = adjacentPairs.length / targetBeatCount;
        for (let i = 0; i < targetBeatCount; i++) {
            const pair = adjacentPairs[Math.min(adjacentPairs.length - 1, Math.floor(i * step))];
            selectedPairs.push({
                index: i + 1,
                name: `Beat ${String(i + 1).padStart(2, '0')}`,
                wardLabel: `Wards ${pair.w1} & ${pair.w2}`,
                w1: pair.w1,
                w2: pair.w2,
                center: pair.center,
                roads: [],
                accumulatedLenKm: 0
            });
        }

        // 4. Distribute Roads to Cross-Ward Beats balancing distance and target length
        cleanRoadsGeoJSON.features.forEach(road => {
            const coords = road.geometry.coordinates;
            const midCoord = coords[Math.floor(coords.length / 2)];
            const rLen = road._computedLenKm || turf.length(road, { units: 'kilometers' });

            // Score beats: closest distance + load penalty so lengths stay balanced
            let bestBeat = null;
            let bestScore = Infinity;

            for (let i = 0; i < selectedPairs.length; i++) {
                const b = selectedPairs[i];
                const dKm = turf.distance(midCoord, b.center, { units: 'kilometers' });
                const loadFactor = Math.max(0, (b.accumulatedLenKm - targetLengthPerBeat) / (targetLengthPerBeat || 1));
                const score = dKm * (1 + loadFactor * 1.8);

                if (score < bestScore) {
                    bestScore = score;
                    bestBeat = b;
                }
            }

            if (bestBeat) {
                bestBeat.roads.push(road);
                bestBeat.accumulatedLenKm += rLen;
            }
        });

        // 5. Construct each Beat with its Polygon Geometry
        selectedPairs.forEach(b => {
            if (b.roads.length === 0) return;

            const ptCoords = [];
            b.roads.forEach(r => {
                r.geometry.coordinates.forEach(c => ptCoords.push(c));
            });

            let beatPolygon = null;
            let beatAreaKm2 = 0;

            try {
                if (ptCoords.length >= 3) {
                    const fc = turf.featureCollection(ptCoords.map(c => turf.point(c)));
                    const hull = turf.convex(fc);
                    if (hull) {
                        const buffered = turf.buffer(hull, 0.05, { units: 'kilometers' });
                        beatPolygon = buffered || hull;
                    }
                }
            } catch (e) {}

            if (!beatPolygon && ptCoords.length > 0) {
                const minX = Math.min(...ptCoords.map(c => c[0]));
                const maxX = Math.max(...ptCoords.map(c => c[0]));
                const minY = Math.min(...ptCoords.map(c => c[1]));
                const maxY = Math.max(...ptCoords.map(c => c[1]));
                beatPolygon = turf.bboxPolygon([minX - 0.0005, minY - 0.0005, maxX + 0.0005, maxY + 0.0005]);
            }

            if (beatPolygon) {
                beatAreaKm2 = Number((turf.area(beatPolygon) / 1000000).toFixed(2));
            }

            addBeat({
                name: b.name,
                ward: b.wardLabel, // e.g. "Wards 1 & 2"
                length_km: Number(b.accumulatedLenKm.toFixed(2)),
                area_km2: beatAreaKm2,
                segment_count: b.roads.length,
                remarks: `Cross-ward beat (${b.wardLabel}) - independent municipal jurisdiction`,
                polygonGeoJSON: beatPolygon
            });
        });

        return getBeats();
    }

    /**
     * Push all beats in bulk to Supabase Cloud
     */
    async function syncAllToSupabase() {
        if (window.SupabaseSync && window.SupabaseSync.saveAllBeats) {
            return await window.SupabaseSync.saveAllBeats(beats);
        }
        return false;
    }

    return {
        addBeat,
        updateBeat,
        deleteBeat,
        clearAllBeats,
        getBeats,
        setBeats,
        getDashboardStats,
        generateBalancedBeats,
        loadFreeformBeats,
        saveToLocalStorage,
        loadFromLocalStorage,
        clearLocalStorage,
        syncAllToSupabase
    };
})();
