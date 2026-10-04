/**
 * KML/KMZ Parser Module for Rewari Sweeper Beat Planning System
 * Handles KML XML parsing and KMZ ZIP archive extraction.
 */

window.KMLParser = (function () {
    /**
     * Parse KML file content (string) or KMZ file (ArrayBuffer/Blob/File)
     * @param {File|Blob|ArrayBuffer|string} source 
     * @param {string} fileName 
     * @returns {Promise<Object>} GeoJSON FeatureCollection
     */
    async function parseFile(source, fileName = 'data.kml') {
        const isKmz = fileName.toLowerCase().endsWith('.kmz') || 
                      (source instanceof File && source.name.toLowerCase().endsWith('.kmz'));

        if (isKmz) {
            return await parseKMZ(source);
        } else if (typeof source === 'string') {
            return parseKMLText(source);
        } else if (source instanceof File || source instanceof Blob) {
            const text = await source.text();
            return parseKMLText(text);
        } else if (source instanceof ArrayBuffer) {
            const decoder = new TextDecoder('utf-8');
            return parseKMLText(decoder.decode(source));
        } else {
            throw new Error('Unsupported file format for KML/KMZ parsing');
        }
    }

    /**
     * Unzip KMZ file and parse contained doc.kml
     */
    async function parseKMZ(kmzData) {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library is required to unpack .kmz files.');
        }

        const zip = new JSZip();
        const zipContent = await zip.loadAsync(kmzData);
        
        // Look for doc.kml or any .kml file
        let kmlFile = zipContent.file('doc.kml');
        if (!kmlFile) {
            const kmlFiles = zipContent.file(/\.kml$/i);
            if (kmlFiles && kmlFiles.length > 0) {
                kmlFile = kmlFiles[0];
            }
        }

        if (!kmlFile) {
            throw new Error('No valid KML file found inside the KMZ archive.');
        }

        const kmlText = await kmlFile.async('string');
        return parseKMLText(kmlText);
    }

    /**
     * Convert KML Text string into GeoJSON FeatureCollection
     */
    function parseKMLText(kmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(kmlText, 'text/xml');
        
        // Check for parse errors
        const parseError = xmlDoc.getElementsByTagName('parsererror')[0];
        if (parseError) {
            throw new Error('XML parsing error: ' + parseError.textContent);
        }

        // Use togeojson library if available, otherwise custom XML parser
        if (typeof toGeoJSON !== 'undefined' && typeof toGeoJSON.kml === 'function') {
            const geojson = toGeoJSON.kml(xmlDoc);
            sanitizeGeoJSON(geojson);
            return geojson;
        }

        return customKMLToGeoJSON(xmlDoc);
    }

    /**
     * Recursively strip altitude and enforce pure 2D [lng, lat] coordinate arrays
     */
    function clean2DCoordinates(coords) {
        if (!Array.isArray(coords)) return coords;
        if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            return [Number(coords[0]), Number(coords[1])];
        }
        return coords.map(c => clean2DCoordinates(c)).filter(c => c && c.length >= 2);
    }

    /**
     * Sanitize and enhance GeoJSON features
     */
    function sanitizeGeoJSON(geojson) {
        if (!geojson || !geojson.features) return;
        
        let idCounter = 1;
        const sanitizedFeatures = [];

        geojson.features.forEach(feature => {
            if (!feature || !feature.geometry) return;
            feature.properties = feature.properties || {};

            // Strip 3D altitude values to enforce pure 2D coordinates
            if (feature.geometry.coordinates) {
                feature.geometry.coordinates = clean2DCoordinates(feature.geometry.coordinates);
            }

            // Assign unique ID if missing
            if (!feature.id && !feature.properties.id) {
                feature.id = 'feat_' + (idCounter++);
            } else if (!feature.id) {
                feature.id = feature.properties.id;
            }

            // Extract key attributes like Name, Agency, Ward, Category
            const props = feature.properties;
            props.name = props.name || props.Name || props.road_name || props.ROAD_NAME || 'Unnamed Feature';
            props.agency = props.agency || props.Agency || props.AGENCY || props.DEPARTMENT || 'Unknown Agency';
            props.ward = props.ward || props.Ward || props.WARD || props.ward_no || props.WARD_NO || null;
            props.category = props.category || props.Category || props.CATEGORY || props.road_type || 'Road';

            // Flatten MultiLineString into separate LineString features if present
            if (feature.geometry.type === 'MultiLineString') {
                const lineCoordsArray = feature.geometry.coordinates;
                lineCoordsArray.forEach((subCoords, subIdx) => {
                    if (subCoords && subCoords.length >= 2) {
                        const singleFeat = {
                            type: 'Feature',
                            id: `${feature.id}_sub_${subIdx}`,
                            geometry: { type: 'LineString', coordinates: subCoords },
                            properties: { ...props }
                        };
                        if (typeof turf !== 'undefined') {
                            singleFeat.properties.length_km = Number(turf.length(singleFeat, { units: 'kilometers' }).toFixed(3));
                            singleFeat.properties.length_m = Math.round(singleFeat.properties.length_km * 1000);
                        }
                        sanitizedFeatures.push(singleFeat);
                    }
                });
            } else if (feature.geometry.type === 'LineString') {
                if (feature.geometry.coordinates && feature.geometry.coordinates.length >= 2) {
                    if (typeof turf !== 'undefined') {
                        props.length_km = Number(turf.length(feature, { units: 'kilometers' }).toFixed(3));
                        props.length_m = Math.round(props.length_km * 1000);
                    }
                    sanitizedFeatures.push(feature);
                }
            } else {
                sanitizedFeatures.push(feature);
            }
        });

        geojson.features = sanitizedFeatures;
    }

    /**
     * Fallback custom XML KML Placemark parser
     */
    function customKMLToGeoJSON(xmlDoc) {
        const placemarks = xmlDoc.getElementsByTagName('Placemark');
        const features = [];

        for (let i = 0; i < placemarks.length; i++) {
            const pm = placemarks[i];
            const nameEl = pm.getElementsByTagName('name')[0];
            const descEl = pm.getElementsByTagName('description')[0];
            
            const props = {
                name: nameEl ? nameEl.textContent.trim() : `Feature ${i + 1}`,
                description: descEl ? descEl.textContent.trim() : ''
            };

            // Parse ExtendedData
            const dataNodes = pm.getElementsByTagName('Data');
            for (let j = 0; j < dataNodes.length; j++) {
                const nameAttr = dataNodes[j].getAttribute('name');
                const valEl = dataNodes[j].getElementsByTagName('value')[0];
                if (nameAttr && valEl) {
                    props[nameAttr] = valEl.textContent.trim();
                }
            }

            const simpleDataNodes = pm.getElementsByTagName('SimpleData');
            for (let j = 0; j < simpleDataNodes.length; j++) {
                const nameAttr = simpleDataNodes[j].getAttribute('name');
                if (nameAttr) {
                    props[nameAttr] = simpleDataNodes[j].textContent.trim();
                }
            }

            // Extract Geometry
            const geom = parsePlacemarkGeometry(pm);
            if (geom) {
                const feature = {
                    type: 'Feature',
                    id: 'feat_' + (i + 1),
                    geometry: geom,
                    properties: props
                };
                features.push(feature);
            }
        }

        const featureCollection = {
            type: 'FeatureCollection',
            features: features
        };

        sanitizeGeoJSON(featureCollection);
        return featureCollection;
    }

    /**
     * Parse geometry inside a KML Placemark node
     */
    function parsePlacemarkGeometry(pmNode) {
        const lineString = pmNode.getElementsByTagName('LineString')[0];
        if (lineString) {
            const coords = parseCoordString(lineString.getElementsByTagName('coordinates')[0]);
            if (coords.length > 0) {
                return { type: 'LineString', coordinates: coords };
            }
        }

        const polygon = pmNode.getElementsByTagName('Polygon')[0];
        if (polygon) {
            const outerBoundary = polygon.getElementsByTagName('outerBoundaryIs')[0];
            if (outerBoundary) {
                const coords = parseCoordString(outerBoundary.getElementsByTagName('coordinates')[0]);
                if (coords.length > 0) {
                    return { type: 'Polygon', coordinates: [coords] };
                }
            }
        }

        const multiGeom = pmNode.getElementsByTagName('MultiGeometry')[0];
        if (multiGeom) {
            const lineStrings = multiGeom.getElementsByTagName('LineString');
            if (lineStrings.length > 0) {
                const multiCoords = [];
                for (let i = 0; i < lineStrings.length; i++) {
                    const coords = parseCoordString(lineStrings[i].getElementsByTagName('coordinates')[0]);
                    if (coords.length > 0) multiCoords.push(coords);
                }
                if (multiCoords.length === 1) {
                    return { type: 'LineString', coordinates: multiCoords[0] };
                } else if (multiCoords.length > 1) {
                    return { type: 'MultiLineString', coordinates: multiCoords };
                }
            }
        }

        return null;
    }

    /**
     * Parse KML coordinates string ("lng,lat,alt lng,lat,alt ...")
     */
    function parseCoordString(coordNode) {
        if (!coordNode || !coordNode.textContent) return [];
        const text = coordNode.textContent.trim();
        const parts = text.split(/\s+/);
        const coords = [];

        parts.forEach(p => {
            const tuple = p.split(',');
            if (tuple.length >= 2) {
                const lng = parseFloat(tuple[0]);
                const lat = parseFloat(tuple[1]);
                if (!isNaN(lng) && !isNaN(lat)) {
                    coords.push([lng, lat]);
                }
            }
        });

        return coords;
    }

    return {
        parseFile,
        parseKMLText,
        parseKMZ
    };
})();
