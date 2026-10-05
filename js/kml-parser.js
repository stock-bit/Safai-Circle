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
     * Specialized parser to import only Sweeper Beat boundaries from KML/KMZ
     * - Strictly extracts the 30 beat boundary Polygons from the 'Sweeper Beats' folder
     * - Completely excludes 'Ward Boundaries' folder so wards don't overlap beats
     * - Ignores all LineStrings so rainbow lines do not clutter the map
     */
    async function parseSweeperBeatsFile(source, fileName = 'beats.kml') {
        const isKmz = fileName.toLowerCase().endsWith('.kmz') || 
                      (source instanceof File && source.name.toLowerCase().endsWith('.kmz'));

        if (isKmz) {
            if (typeof JSZip === 'undefined') {
                throw new Error('JSZip library is required to unpack .kmz files.');
            }
            const zip = new JSZip();
            const zipContent = await zip.loadAsync(source);
            let kmlFile = zipContent.file('doc.kml') || zipContent.file(/\.kml$/i)[0];
            if (!kmlFile) throw new Error('No valid KML file found inside the KMZ archive.');
            const kmlText = await kmlFile.async('string');
            return parseSweeperBeatsKML(kmlText);
        } else if (typeof source === 'string') {
            return parseSweeperBeatsKML(source);
        } else if (source instanceof File || source instanceof Blob) {
            const text = await source.text();
            return parseSweeperBeatsKML(text);
        } else if (source instanceof ArrayBuffer) {
            const decoder = new TextDecoder('utf-8');
            return parseSweeperBeatsKML(decoder.decode(source));
        } else {
            throw new Error('Unsupported file format');
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

        // Build KML Style Map (maps styleId -> hexColor)
        const styleMap = buildKMLStyleMap(xmlDoc);

        // Use togeojson library if available, otherwise custom XML parser
        if (typeof toGeoJSON !== 'undefined' && typeof toGeoJSON.kml === 'function') {
            const geojson = toGeoJSON.kml(xmlDoc);
            applyKMLStyles(geojson, xmlDoc, styleMap);
            sanitizeGeoJSON(geojson);
            return geojson;
        }

        const geojson = customKMLToGeoJSON(xmlDoc);
        applyKMLStyles(geojson, xmlDoc, styleMap);
        return geojson;
    }

    /**
     * Convert KML AABBGGRR color format to #RRGGBB
     */
    function kmlColorToHex(kmlColor) {
        if (!kmlColor || typeof kmlColor !== 'string') return null;
        const cleaned = kmlColor.trim();
        if (cleaned.length === 8) {
            const r = cleaned.substr(6, 2);
            const g = cleaned.substr(4, 2);
            const b = cleaned.substr(2, 2);
            return `#${r}${g}${b}`;
        } else if (cleaned.length === 6) {
            const r = cleaned.substr(4, 2);
            const g = cleaned.substr(2, 2);
            const b = cleaned.substr(0, 2);
            return `#${r}${g}${b}`;
        }
        return null;
    }

    /**
     * Map all <Style id="..."> elements to hex colors
     */
    function buildKMLStyleMap(xmlDoc) {
        const styleMap = {};
        const styles = xmlDoc.getElementsByTagName('Style');
        for (let i = 0; i < styles.length; i++) {
            const s = styles[i];
            const sId = s.getAttribute('id');
            if (!sId) continue;

            let hex = null;
            const polyStyle = s.getElementsByTagName('PolyStyle')[0];
            if (polyStyle) {
                const colorEl = polyStyle.getElementsByTagName('color')[0];
                if (colorEl && colorEl.textContent) {
                    hex = kmlColorToHex(colorEl.textContent);
                }
            }
            if (!hex) {
                const lineStyle = s.getElementsByTagName('LineStyle')[0];
                if (lineStyle) {
                    const colorEl = lineStyle.getElementsByTagName('color')[0];
                    if (colorEl && colorEl.textContent) {
                        hex = kmlColorToHex(colorEl.textContent);
                    }
                }
            }
            if (hex) {
                styleMap[sId] = hex;
                styleMap['#' + sId] = hex;
            }
        }
        return styleMap;
    }

    /**
     * Apply styleMap colors to parsed features
     */
    function applyKMLStyles(geojson, xmlDoc, styleMap) {
        if (!geojson || !geojson.features) return;
        const placemarks = xmlDoc.getElementsByTagName('Placemark');

        geojson.features.forEach((feat, idx) => {
            feat.properties = feat.properties || {};
            
            // Only apply custom colors to Polygon boundaries, NOT to roads/LineStrings!
            const isPolygon = feat.geometry && (feat.geometry.type === 'Polygon' || feat.geometry.type === 'MultiPolygon');
            if (!isPolygon) return;

            // 1. Check if styleUrl is already set in properties
            let sUrl = feat.properties.styleUrl || feat.properties['styleUrl'];
            // 2. If not, lookup corresponding Placemark in XML
            if (!sUrl && placemarks[idx]) {
                const pmStyleUrl = placemarks[idx].getElementsByTagName('styleUrl')[0];
                if (pmStyleUrl) sUrl = pmStyleUrl.textContent.trim();
            }

            if (sUrl && styleMap[sUrl]) {
                feat.properties.color = styleMap[sUrl];
            } else if (feat.properties.stroke && feat.properties.stroke.startsWith('#')) {
                feat.properties.color = feat.properties.stroke;
            } else if (feat.properties.fill && feat.properties.fill.startsWith('#')) {
                feat.properties.color = feat.properties.fill;
            }
        });
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

    /**
     * Specialized parser for Sweeper Beats KML:
     * - Identifies the 'Sweeper Beats' folder (or any folder matching beat plan)
     * - Strictly extracts the 30 beat boundary POLYGONS and their exact beat names
     * - Excludes all Placemarks inside 'Ward Boundaries' or matching ward names
     * - Completely ignores LineStrings so no rainbow lines clutter the map
     * - Extracts original KML colors for the beat boundaries
     */
    function parseSweeperBeatsKML(kmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(kmlText, 'text/xml');
        
        const parseError = xmlDoc.getElementsByTagName('parsererror')[0];
        if (parseError) {
            throw new Error('XML parsing error: ' + parseError.textContent);
        }

        const styleMap = buildKMLStyleMap(xmlDoc);
        const folders = xmlDoc.getElementsByTagName('Folder');
        
        let beatsFolder = null;
        const wardFolders = [];

        for (let i = 0; i < folders.length; i++) {
            const f = folders[i];
            const nameEl = f.getElementsByTagName('name')[0];
            const fName = nameEl ? nameEl.textContent.trim().toLowerCase() : '';
            
            if (fName.includes('ward') || fName.includes('wardbandi') || fName.includes('ward boundaries')) {
                wardFolders.push(f);
            } else if (!beatsFolder && (fName.includes('sweeper beat') || fName.includes('beats') || fName.includes('free-form'))) {
                beatsFolder = f;
            }
        }

        const features = [];
        const wardNameRegex = /^\s*(ward\b[\s_-]*\d*|\d{1,2})\s*$/i;

        // Helper to check if a node is inside any of the wardFolders
        function isInsideWardFolder(node) {
            let curr = node.parentNode;
            while (curr && curr.nodeType === 1) {
                if (wardFolders.includes(curr)) return true;
                const nEl = curr.getElementsByTagName ? curr.getElementsByTagName('name')[0] : null;
                const nTxt = nEl ? nEl.textContent.trim().toLowerCase() : '';
                if (nTxt.includes('ward boundaries') || nTxt === 'wards') return true;
                curr = curr.parentNode;
            }
            return false;
        }

        // Helper to extract polygon from Placemark
        function extractBeatFromPlacemark(pm, fallbackName = null) {
            // Check if Placemark has a Polygon
            const poly = pm.getElementsByTagName('Polygon')[0];
            if (!poly) return null;

            const nameEl = pm.getElementsByTagName('name')[0];
            let name = fallbackName || (nameEl ? nameEl.textContent.trim() : 'Unnamed Beat');
            
            // Clean up suffixes like [Boundary], [Boundary Perimeter], (12 Sweepers | 10.09 km), etc.
            name = name.replace(/\s*\[Boundary.*?\]/i, '').replace(/\s*\(\d+\s*Sweepers.*?\)/i, '').trim();

            // Ignore if name matches ward
            if (wardNameRegex.test(name)) return null;

            const geom = parsePlacemarkGeometry(pm);
            if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return null;

            // Extract style / color
            let color = null;
            const styleUrlEl = pm.getElementsByTagName('styleUrl')[0];
            const sUrl = styleUrlEl ? styleUrlEl.textContent.trim() : null;
            if (sUrl && styleMap[sUrl]) {
                color = styleMap[sUrl];
            }

            // Description / ExtendedData
            const descEl = pm.getElementsByTagName('description')[0];

            return {
                type: 'Feature',
                id: `beat_${features.length + 1}`,
                geometry: geom,
                properties: {
                    name: name,
                    beatNo: name,
                    color: color,
                    description: descEl ? descEl.textContent.trim() : ''
                }
            };
        }

        if (beatsFolder) {
            // Case A: Structured KML with Sweeper Beats folder
            // Check if it has subfolders for each beat
            const subfolders = [];
            for (let i = 0; i < beatsFolder.childNodes.length; i++) {
                const child = beatsFolder.childNodes[i];
                if (child.nodeType === 1 && child.nodeName === 'Folder') {
                    subfolders.push(child);
                }
            }

            if (subfolders.length > 0) {
                // Each subfolder is a beat!
                subfolders.forEach(sf => {
                    const sfNameEl = sf.getElementsByTagName('name')[0];
                    const sfName = sfNameEl ? sfNameEl.textContent.trim() : null;
                    const placemarks = sf.getElementsByTagName('Placemark');
                    for (let p = 0; p < placemarks.length; p++) {
                        const feat = extractBeatFromPlacemark(placemarks[p], sfName);
                        if (feat) {
                            features.push(feat);
                            break; // 1 polygon per beat subfolder
                        }
                    }
                });
            } else {
                // Direct placemarks in beatsFolder
                const placemarks = beatsFolder.getElementsByTagName('Placemark');
                for (let p = 0; p < placemarks.length; p++) {
                    const feat = extractBeatFromPlacemark(placemarks[p]);
                    if (feat) features.push(feat);
                }
            }
        }

        // Case B: Fallback if no specific Sweeper Beats folder or features empty
        if (features.length === 0) {
            const allPlacemarks = xmlDoc.getElementsByTagName('Placemark');
            for (let i = 0; i < allPlacemarks.length; i++) {
                const pm = allPlacemarks[i];
                if (isInsideWardFolder(pm)) continue; // Strictly skip ward boundaries!
                const feat = extractBeatFromPlacemark(pm);
                if (feat) features.push(feat);
            }
        }

        return {
            type: 'FeatureCollection',
            features: features
        };
    }

    return {
        parseFile,
        parseSweeperBeatsFile,
        parseSweeperBeatsKML,
        parseKMLText,
        parseKMZ
    };
})();
