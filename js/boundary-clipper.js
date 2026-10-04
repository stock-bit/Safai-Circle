/**
 * Boundary Clipping Engine for Rewari Sweeper Beat Planning System
 * Clips road networks to the outer boundary of Rewari Municipal Wards.
 */

window.BoundaryClipper = (function () {

    /**
     * Compute Outer Municipal Boundary by unioning all ward polygons
     * @param {Object} wardsGeoJSON FeatureCollection of Ward Polygons
     * @returns {Object|null} Polygon/MultiPolygon GeoJSON feature
     */
    function computeOuterBoundary(wardsGeoJSON) {
        if (!wardsGeoJSON || !wardsGeoJSON.features || wardsGeoJSON.features.length === 0) {
            return null;
        }

        if (typeof turf === 'undefined') {
            console.warn('Turf.js is required for boundary unioning.');
            return null;
        }

        try {
            const polygonFeatures = wardsGeoJSON.features.filter(f => 
                f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
            );

            if (polygonFeatures.length === 0) return null;

            let unionBoundary = polygonFeatures[0];
            for (let i = 1; i < polygonFeatures.length; i++) {
                try {
                    const u = turf.union(turf.featureCollection([unionBoundary, polygonFeatures[i]]));
                    if (u) unionBoundary = u;
                } catch (e) {
                    console.warn(`Union failed at feature ${i}:`, e);
                }
            }

            return unionBoundary;
        } catch (err) {
            console.error('Failed to compute outer boundary:', err);
            return null;
        }
    }

    /**
     * Accurate ray-casting point in polygon algorithm (WGS84 lon, lat)
     */
    function pointInPolygonCoords(pt, ring) {
        const x = pt[0], y = pt[1];
        let inside = false;
        let j = ring.length - 1;
        for (let i = 0; i < ring.length; i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) {
                inside = !inside;
            }
            j = i;
        }
        return inside;
    }

    /**
     * Check if a 2D coordinate [lon, lat] is inside any of the ward polygon rings with BBox pre-check
     */
    function isCoordInWardRings(coord, wardRings) {
        const x = coord[0], y = coord[1];
        for (let i = 0; i < wardRings.length; i++) {
            const wr = wardRings[i];
            const b = wr.bbox;
            if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) {
                if (pointInPolygonCoords(coord, wr.ring)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Clip road GeoJSON against Rewari Municipal Ward Boundaries
     * Ensures all roads outside wards boundary are cleaned/excluded.
     * @param {Object} roadsGeoJSON Clean Roads FeatureCollection
     * @param {Object} wardsGeoJSON FeatureCollection of Ward Polygons
     * @returns {Object} Clipped FeatureCollection strictly inside Rewari boundary
     */
    function clipRoadsToBoundary(roadsGeoJSON, wardsGeoJSON) {
        if (!roadsGeoJSON || !roadsGeoJSON.features || !wardsGeoJSON) {
            return roadsGeoJSON;
        }

        // Extract outer rings of all ward polygons with pre-calculated bounding boxes
        const wardRings = [];
        const wardFeatures = wardsGeoJSON.type === 'FeatureCollection' ? wardsGeoJSON.features : [wardsGeoJSON];
        
        wardFeatures.forEach(wf => {
            if (!wf || !wf.geometry) return;
            const rings = [];
            if (wf.geometry.type === 'Polygon' && wf.geometry.coordinates && wf.geometry.coordinates[0]) {
                rings.push(wf.geometry.coordinates[0]);
            } else if (wf.geometry.type === 'MultiPolygon' && wf.geometry.coordinates) {
                wf.geometry.coordinates.forEach(polyCoords => {
                    if (polyCoords && polyCoords[0]) rings.push(polyCoords[0]);
                });
            }

            rings.forEach(ring => {
                let minX = 999, minY = 999, maxX = -999, maxY = -999;
                for (let i = 0; i < ring.length; i++) {
                    const p = ring[i];
                    if (p[0] < minX) minX = p[0];
                    if (p[0] > maxX) maxX = p[0];
                    if (p[1] < minY) minY = p[1];
                    if (p[1] > maxY) maxY = p[1];
                }
                wardRings.push({ ring, bbox: [minX, minY, maxX, maxY] });
            });
        });

        if (wardRings.length === 0) return roadsGeoJSON;

        const clippedFeatures = [];

        roadsGeoJSON.features.forEach((road, idx) => {
            if (!road || !road.geometry || road.geometry.type !== 'LineString') {
                return;
            }

            const coords = road.geometry.coordinates;
            if (!coords || coords.length < 2) return;

            const insideFlags = coords.map(c => isCoordInWardRings(c, wardRings));
            const allInside = insideFlags.every(Boolean);
            const allOutside = insideFlags.every(v => !v);

            // Completely outside municipal boundary - EXCLUDED!
            if (allOutside) {
                return;
            }

            // Completely inside boundary - RETAIN!
            if (allInside) {
                const cleanedFeat = JSON.parse(JSON.stringify(road));
                if (typeof turf !== 'undefined') {
                    cleanedFeat.properties.length_km = Number(turf.length(cleanedFeat, { units: 'kilometers' }).toFixed(3));
                }
                clippedFeatures.push(cleanedFeat);
                return;
            }

            // Crossing boundary: slice and retain only segment(s) strictly inside Rewari boundary
            const validSegments = [];
            let currentLine = [];
            for (let i = 0; i < coords.length - 1; i++) {
                const p1 = coords[i];
                const p2 = coords[i + 1];
                const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
                if (isCoordInWardRings(mid, wardRings)) {
                    if (currentLine.length === 0) currentLine.push(p1);
                    currentLine.push(p2);
                } else {
                    if (currentLine.length >= 2) {
                        validSegments.push(currentLine);
                    }
                    currentLine = [];
                }
            }
            if (currentLine.length >= 2) {
                validSegments.push(currentLine);
            }

            validSegments.forEach((segCoords, segIdx) => {
                const subFeat = JSON.parse(JSON.stringify(road));
                subFeat.id = `${road.id || 'road_' + idx}_seg${segIdx + 1}`;
                subFeat.geometry.coordinates = segCoords;
                if (typeof turf !== 'undefined') {
                    subFeat.properties.length_km = Number(turf.length(subFeat, { units: 'kilometers' }).toFixed(3));
                }
                clippedFeatures.push(subFeat);
            });
        });

        return {
            type: 'FeatureCollection',
            features: clippedFeatures
        };
    }

    return {
        computeOuterBoundary,
        clipRoadsToBoundary
    };
})();
