/**
 * Spatial Deduplication Engine for Rewari Sweeper Beat Planning System
 * Implements Distance, Bearing/Direction, and Overlap Percentage spatial matching with BBox indexing.
 */

window.RoadCleaner = (function () {
    // Default Settings
    const defaultSettings = {
        distanceTolerance: 2.0,      // metres (within 2m of each other)
        minOverlapPercent: 0,        // % (overlap can be 0% - purely distance based duplicate detection)
        maxDirectionDifference: 45,  // degrees
        primarySource: 'longer'      // 'longer' (take whichever is longer), 'ulb', or 'reference'
    };

    /**
     * Calculate bearing (angle in degrees 0-360) between two coordinates [lng, lat]
     */
    function calculateBearing(coord1, coord2) {
        if (typeof turf !== 'undefined' && turf.bearing) {
            let b = turf.bearing(coord1, coord2);
            return (b + 360) % 360;
        }
        const rad = Math.PI / 180;
        const lat1 = coord1[1] * rad;
        const lat2 = coord2[1] * rad;
        const dLng = (coord2[0] - coord1[0]) * rad;

        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        let brng = Math.atan2(y, x) * 180 / Math.PI;
        return (brng + 360) % 360;
    }

    /**
     * Compute angular difference between two bearings (0° to 90°, accounting for bidirectional roads)
     */
    function calculateAngleDifference(bearing1, bearing2) {
        let diff = Math.abs(bearing1 - bearing2) % 180;
        if (diff > 90) {
            diff = 180 - diff;
        }
        return diff;
    }

    /**
     * Compute general bearing for a LineString feature
     */
    function getLineBearing(feature) {
        const coords = feature.geometry.coordinates;
        if (!coords || coords.length < 2) return 0;
        const start = coords[0];
        const end = coords[coords.length - 1];
        return calculateBearing(start, end);
    }

    /**
     * Check bounding box overlap between two features (with buffer)
     */
    function bboxesOverlap(bbox1, bbox2, bufferDeg = 0.0001) {
        return !(bbox1[2] + bufferDeg < bbox2[0] ||
                 bbox1[0] - bufferDeg > bbox2[2] ||
                 bbox1[3] + bufferDeg < bbox1[1] ||
                 bbox1[1] - bufferDeg > bbox2[3]);
    }

    /**
     * Main Spatial Deduplication Function
     * @param {Object} ulbGeoJSON Primary ULB Roads FeatureCollection
     * @param {Object} refGeoJSON Secondary/Reference Existing Roads FeatureCollection
     * @param {Object} options Configuration options
     * @param {Map|Object} manualOverrides User manual overrides map
     * @returns {Object} Result object containing cleanRoads, duplicateGroups, stats
     */
    function processDuplicates(ulbGeoJSON, refGeoJSON, options = {}, manualOverrides = {}) {
        const settings = { ...defaultSettings, ...options };
        
        const ulbFeatures = (ulbGeoJSON && ulbGeoJSON.features) ? ulbGeoJSON.features : [];
        const refFeatures = (refGeoJSON && refGeoJSON.features) ? refGeoJSON.features : [];

        // Attach source flags and compute bboxes & lengths
        ulbFeatures.forEach((f, idx) => {
            f.properties = f.properties || {};
            f.properties._source = 'ulb';
            f.properties._uid = f.properties._uid || `ulb_${f.id || idx}`;
            if (typeof turf !== 'undefined') {
                f._bbox = turf.bbox(f);
                f._length = turf.length(f, { units: 'meters' });
                f._bearing = getLineBearing(f);
            }
        });

        refFeatures.forEach((f, idx) => {
            f.properties = f.properties || {};
            f.properties._source = 'reference';
            f.properties._uid = f.properties._uid || `ref_${f.id || idx}`;
            if (typeof turf !== 'undefined') {
                f._bbox = turf.bbox(f);
                f._length = turf.length(f, { units: 'meters' });
                f._bearing = getLineBearing(f);
            }
        });

        const duplicateGroups = [];
        const excludedRefUids = new Set();
        const excludedUlbUids = new Set();

        let groupIdCounter = 1;

        // Compare ULB features vs Reference features using Bounding Box Spatial Indexing
        for (let i = 0; i < ulbFeatures.length; i++) {
            const ulbFeat = ulbFeatures[i];
            const ulbUid = ulbFeat.properties._uid;

            for (let j = 0; j < refFeatures.length; j++) {
                const refFeat = refFeatures[j];
                const refUid = refFeat.properties._uid;

                // Check manual overrides first
                const overrideKey = `${ulbUid}__${refUid}`;
                if (manualOverrides[overrideKey]) {
                    const action = manualOverrides[overrideKey];
                    if (action === 'keep_ulb') {
                        excludedRefUids.add(refUid);
                    } else if (action === 'keep_ref') {
                        excludedUlbUids.add(ulbUid);
                    }
                    continue;
                }

                // Quick Spatial Bounding Box Filter
                if (ulbFeat._bbox && refFeat._bbox) {
                    if (!bboxesOverlap(ulbFeat._bbox, refFeat._bbox)) {
                        continue;
                    }
                }

                // Check Bearing / Direction Alignment (skip if lines point opposite or perpendicular, unless endpoints match)
                const angleDiff = calculateAngleDifference(ulbFeat._bearing, refFeat._bearing);
                if (angleDiff > settings.maxDirectionDifference && angleDiff < (180 - settings.maxDirectionDifference)) {
                    // If bearings differ greatly, only compare if bounding boxes are tightly overlapping
                    if (!bboxesOverlap(ulbFeat._bbox, refFeat._bbox, 0.00005)) {
                        continue;
                    }
                }

                // Detailed Distance & Overlap Spatial Matching using Turf.js
                const matchResult = evaluateMatch(ulbFeat, refFeat, settings);

                if (matchResult.isDuplicate) {
                    const group = {
                        id: groupIdCounter++,
                        ulbRoad: {
                            uid: ulbUid,
                            name: ulbFeat.properties.name || 'ULB Road',
                            length_km: (ulbFeat._length / 1000).toFixed(2),
                            properties: ulbFeat.properties
                        },
                        refRoad: {
                            uid: refUid,
                            name: refFeat.properties.name || 'Reference Road',
                            length_km: (refFeat._length / 1000).toFixed(2),
                            properties: refFeat.properties
                        },
                        distance_m: matchResult.distance_m.toFixed(2),
                        overlap_percent: matchResult.overlap_percent.toFixed(1),
                        angle_diff_deg: angleDiff.toFixed(1),
                        primarySource: settings.primarySource
                    };

                    duplicateGroups.push(group);

                    // Based on primary source priority, exclude shorter or secondary candidate
                    if (settings.primarySource === 'longer') {
                        const ulbLen = ulbFeat._length || 0;
                        const refLen = refFeat._length || 0;
                        if (ulbLen >= refLen) {
                            excludedRefUids.add(refUid);
                            group.keptSource = 'ULB (Longer)';
                        } else {
                            excludedUlbUids.add(ulbUid);
                            group.keptSource = 'Reference (Longer)';
                        }
                    } else if (settings.primarySource === 'ulb') {
                        excludedRefUids.add(refUid);
                        group.keptSource = 'ULB';
                    } else {
                        excludedUlbUids.add(ulbUid);
                        group.keptSource = 'Reference';
                    }
                }
            }
        }

        // Build Clean Road Network
        const cleanFeatures = [];
        
        ulbFeatures.forEach(f => {
            if (!excludedUlbUids.has(f.properties._uid)) {
                cleanFeatures.push(JSON.parse(JSON.stringify(f)));
            }
        });

        refFeatures.forEach(f => {
            if (!excludedRefUids.has(f.properties._uid)) {
                cleanFeatures.push(JSON.parse(JSON.stringify(f)));
            }
        });

        const cleanRoadsGeoJSON = {
            type: 'FeatureCollection',
            features: cleanFeatures
        };

        // Compute total stats
        let totalCleanLengthKm = 0;
        cleanFeatures.forEach(f => {
            if (typeof turf !== 'undefined') {
                totalCleanLengthKm += turf.length(f, { units: 'kilometers' });
            }
        });

        return {
            cleanRoads: cleanRoadsGeoJSON,
            duplicateGroups: duplicateGroups,
            stats: {
                originalUlbCount: ulbFeatures.length,
                originalRefCount: refFeatures.length,
                duplicateCount: duplicateGroups.length,
                cleanRoadCount: cleanFeatures.length,
                totalCleanLengthKm: Number(totalCleanLengthKm.toFixed(2))
            }
        };
    }

    /**
     * Evaluate geometry closeness and overlap percentage between two line features
     */
    function evaluateMatch(feat1, feat2, settings) {
        if (typeof turf === 'undefined') {
            return { isDuplicate: false, distance_m: 999, overlap_percent: 0 };
        }

        try {
            // Buffer feat1 by distanceTolerance
            const bufferDistanceKm = Math.max(settings.distanceTolerance, 1) / 1000;
            const buffered1 = turf.buffer(feat1, bufferDistanceKm, { units: 'kilometers' });

            if (!buffered1) {
                return { isDuplicate: false, distance_m: 999, overlap_percent: 0 };
            }

            // Clip feat2 with buffered feat1
            let overlapLengthM = 0;
            const feat2LengthM = feat2._length || turf.length(feat2, { units: 'meters' });

            if (feat2LengthM <= 0) {
                return { isDuplicate: false, distance_m: 999, overlap_percent: 0 };
            }

            // Sample points along feat2 to check distance to feat1
            const numSamples = 10;
            let withinDistanceCount = 0;
            let minDistanceM = 99999;

            for (let i = 0; i <= numSamples; i++) {
                try {
                    const pt = turf.along(feat2, (i / numSamples) * (feat2LengthM / 1000), { units: 'kilometers' });
                    if (!pt || !pt.geometry || !pt.geometry.coordinates) continue;

                    const coords = pt.geometry.coordinates;
                    const cleanPt = turf.point([Number(coords[0]), Number(coords[1])]);
                    
                    const distKm = turf.pointToLineDistance(cleanPt, feat1, { units: 'kilometers' });
                    const distM = distKm * 1000;

                    if (distM < minDistanceM) minDistanceM = distM;
                    if (distM <= settings.distanceTolerance * 2.5) { // generous buffer range check
                        withinDistanceCount++;
                    }
                } catch (sampleErr) {
                    // Skip point if calculation fails
                }
            }

            // Calculate overlap percentage based on sample points within buffer
            const overlapPercent = Number(((withinDistanceCount / (numSamples + 1)) * 100).toFixed(1));

            // Check distance from sampled points of feat1 to feat2 as well (bidirectional check)
            const numSamples1 = 5;
            for (let i = 0; i <= numSamples1; i++) {
                try {
                    const pt1 = turf.along(feat1, (i / numSamples1) * ((feat1._length || turf.length(feat1, { units: 'meters' })) / 1000), { units: 'kilometers' });
                    if (!pt1 || !pt1.geometry || !pt1.geometry.coordinates) continue;
                    const coords1 = pt1.geometry.coordinates;
                    const cleanPt1 = turf.point([Number(coords1[0]), Number(coords1[1])]);
                    const distKm1 = turf.pointToLineDistance(cleanPt1, feat2, { units: 'kilometers' });
                    const distM1 = distKm1 * 1000;
                    if (distM1 < minDistanceM) minDistanceM = distM1;
                } catch (e) {}
            }

            // Check start/end points distance directly
            const feat1Coords = feat1.geometry.coordinates;
            const feat2Coords = feat2.geometry.coordinates;
            
            const start1 = turf.point(feat1Coords[0]);
            const start2 = turf.point(feat2Coords[0]);
            const end1 = turf.point(feat1Coords[feat1Coords.length - 1]);
            const end2 = turf.point(feat2Coords[feat2Coords.length - 1]);
            
            const dStartStart = turf.distance(start1, start2, { units: 'kilometers' }) * 1000;
            const dStartEnd = turf.distance(start1, end2, { units: 'kilometers' }) * 1000;
            const dEndEnd = turf.distance(end1, end2, { units: 'kilometers' }) * 1000;
            const dEndStart = turf.distance(end1, start2, { units: 'kilometers' }) * 1000;

            const endpointProximity = (dStartStart <= settings.distanceTolerance && dEndEnd <= settings.distanceTolerance) ||
                                      (dStartEnd <= settings.distanceTolerance && dEndStart <= settings.distanceTolerance);

            // Directly consider duplicate if:
            // 1) Endpoints closely match (<= tolerance), or
            // 2) Minimum distance between lines is within distance tolerance (e.g. <= 2m), regardless of overlap (overlap can be 0%)
            // 3) Or overlap exceeds minOverlapPercent if configured
            const isDuplicate = endpointProximity || 
                                (minDistanceM <= settings.distanceTolerance) ||
                                (withinDistanceCount >= 2 && minDistanceM <= settings.distanceTolerance * 1.5) ||
                                (settings.minOverlapPercent > 0 && overlapPercent >= settings.minOverlapPercent && minDistanceM <= settings.distanceTolerance * 2.0);

            return {
                isDuplicate: isDuplicate,
                distance_m: minDistanceM,
                overlap_percent: overlapPercent
            };
        } catch (err) {
            console.warn('Matching evaluation error:', err);
            return { isDuplicate: false, distance_m: 999, overlap_percent: 0 };
        }
    }

    /**
     * Zonal Road Combination (Inner Circular Road Reference + Outer Wards ULB)
     * High-reliability pragmatic strategy:
     * - Inside Circular Road: Take dense Reference roads
     * - Outside Circular Road: Take MC/ULB roads (filling peripheral wards)
     * - Excludes all roads outside Rewari Municipal Ward Boundary
     * - Zero data gaps, no 2m micro-clipping false deletions!
     */
    function processZonalCombination(ulbGeoJSON, refGeoJSON, wardsGeoJSON, options = {}) {
        const ulbFeatures = (ulbGeoJSON && ulbGeoJSON.features) ? ulbGeoJSON.features : [];
        const refFeatures = (refGeoJSON && refGeoJSON.features) ? refGeoJSON.features : [];

        // 1. Build Circular Road Loop polygon from Reference segments
        const circCoords = [];
        const circSegments = [];
        refFeatures.forEach(f => {
            const name = (f.properties && f.properties.name) || '';
            if (name.toLowerCase().includes('circular road') && f.geometry && f.geometry.type === 'LineString') {
                circSegments.push(f);
                f.geometry.coordinates.forEach(c => circCoords.push(c));
            }
        });

        let cx = 76.61758, cy = 28.19800;
        if (circCoords.length > 0) {
            cx = circCoords.reduce((sum, c) => sum + c[0], 0) / circCoords.length;
            cy = circCoords.reduce((sum, c) => sum + c[1], 0) / circCoords.length;
        }

        function isInsideCircLoop(pt) {
            if (circCoords.length >= 4) {
                const x = pt[0], y = pt[1];
                let inside = false;
                let j = circCoords.length - 1;
                for (let i = 0; i < circCoords.length; i++) {
                    const xi = circCoords[i][0], yi = circCoords[i][1];
                    const xj = circCoords[j][0], yj = circCoords[j][1];
                    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) {
                        inside = !inside;
                    }
                    j = i;
                }
                return inside;
            }
            const dKm = typeof turf !== 'undefined' ? turf.distance([cx, cy], pt, { units: 'kilometers' }) : Math.hypot((pt[0]-cx)*98.0, (pt[1]-cy)*111.0);
            return dKm <= 0.85;
        }

        const cleanFeatures = [];

        // 2. Add Reference roads inside the Circular Road
        refFeatures.forEach(f => {
            if (!f.geometry || f.geometry.type !== 'LineString' || !f.geometry.coordinates || f.geometry.coordinates.length < 2) return;
            const name = (f.properties && f.properties.name) || '';
            if (name.toLowerCase().includes('approximate') && name.toLowerCase().includes('extent')) return;
            if (name.toLowerCase().includes('circular road')) return;

            const mid = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
            if (isInsideCircLoop(mid)) {
                const clone = JSON.parse(JSON.stringify(f));
                clone.properties = clone.properties || {};
                clone.properties._source = 'reference_inner';
                if (typeof turf !== 'undefined') {
                    clone.properties.length_km = Number(turf.length(clone, { units: 'kilometers' }).toFixed(3));
                }
                cleanFeatures.push(clone);
            }
        });

        // 3. Add ULB roads outside the Circular Road
        ulbFeatures.forEach(f => {
            if (!f.geometry || f.geometry.type !== 'LineString' || !f.geometry.coordinates || f.geometry.coordinates.length < 2) return;
            const mid = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
            if (!isInsideCircLoop(mid)) {
                const clone = JSON.parse(JSON.stringify(f));
                clone.properties = clone.properties || {};
                clone.properties._source = 'ulb_outer';
                if (typeof turf !== 'undefined') {
                    clone.properties.length_km = Number(turf.length(clone, { units: 'kilometers' }).toFixed(3));
                }
                cleanFeatures.push(clone);
            }
        });

        // 4. Add Circular Road segments
        circSegments.forEach(f => {
            const clone = JSON.parse(JSON.stringify(f));
            clone.properties = clone.properties || {};
            clone.properties._source = 'circular_ring';
            if (typeof turf !== 'undefined') {
                clone.properties.length_km = Number(turf.length(clone, { units: 'kilometers' }).toFixed(3));
            }
            cleanFeatures.push(clone);
        });

        let cleanFC = {
            type: 'FeatureCollection',
            features: cleanFeatures
        };

        // 5. Clip strictly to Rewari Ward Boundaries
        if (wardsGeoJSON && typeof BoundaryClipper !== 'undefined') {
            cleanFC = BoundaryClipper.clipRoadsToBoundary(cleanFC, wardsGeoJSON);
        }

        let totalCleanLengthKm = 0;
        cleanFC.features.forEach(f => {
            if (typeof turf !== 'undefined') {
                totalCleanLengthKm += turf.length(f, { units: 'kilometers' });
            } else if (f.properties && f.properties.length_km) {
                totalCleanLengthKm += f.properties.length_km;
            }
        });

        return {
            cleanRoads: cleanFC,
            duplicateGroups: [],
            stats: {
                originalUlbCount: ulbFeatures.length,
                originalRefCount: refFeatures.length,
                duplicateCount: 0,
                cleanRoadCount: cleanFC.features.length,
                totalCleanLengthKm: Number(totalCleanLengthKm.toFixed(2)),
                mode: 'Zonal (Circular Road Partition)'
            }
        };
    }

    return {
        processDuplicates,
        processZonalCombination,
        defaultSettings
    };
})();
