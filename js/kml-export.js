/**
 * KML / KMZ and Excel / CSV Export Module for Rewari Sweeper Beat Planning System
 * Generates formatted KML XML for Google Earth and Excel/CSV summary spreadsheets.
 */

window.KMLExport = (function () {

    /**
     * Generate KML XML string containing Ward Boundaries, Clean Roads, and Sweeper Beats
     * @param {Object} data Export data containing beats, cleanRoads, and wards
     * @returns {string} KML XML document string
     */
    function generateKMLString(data) {
        const beats = data.beats || [];
        const cleanRoads = data.cleanRoads || null;
        const wards = data.wards || null;

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Rewari Sweeper Beat Plan</name>
    <description>Municipal Council Rewari Sweeper Beats and Cleaned Road Network Plan</description>
    
    <!-- KML Styles -->
    <Style id="wardStyle">
      <LineStyle><color>ff333333</color><width>2.5</width></LineStyle>
      <PolyStyle><color>14f8d338</color><fill>1</fill><outline>1</outline></PolyStyle>
    </Style>
    
    <Style id="cleanRoadStyle">
      <LineStyle><color>ff10b981</color><width>2.5</width></LineStyle>
    </Style>

    <Style id="beatStyleDefault">
      <LineStyle><color>ff8b5cf6</color><width>2.5</width></LineStyle>
      <PolyStyle><color>55a78bfa</color><fill>1</fill><outline>1</outline></PolyStyle>
    </Style>
`;

        // 1. Ward Boundaries Folder
        if (wards && wards.features) {
            xml += `    <Folder>\n      <name>Ward Boundaries</name>\n`;
            wards.features.forEach((feat, idx) => {
                const name = feat.properties.name || feat.properties.ward || `Ward ${idx + 1}`;
                xml += formatFeatureToKML(feat, name, 'wardStyle');
            });
            xml += `    </Folder>\n`;
        }

        // 2. Clean Roads Folder
        if (cleanRoads && cleanRoads.features) {
            xml += `    <Folder>\n      <name>Clean Road Network</name>\n`;
            cleanRoads.features.forEach((feat, idx) => {
                const name = feat.properties.name || `Clean Road ${idx + 1}`;
                const desc = `Length: ${feat.properties.length_km || 0} km | Source: ${feat.properties._source || 'Clean'}`;
                xml += formatFeatureToKML(feat, name, 'cleanRoadStyle', desc);
            });
            xml += `    </Folder>\n`;
        }

        // 3. Sweeper Beats Folders
        if (beats.length > 0) {
            xml += `    <Folder>\n      <name>Sweeper Beats</name>\n`;
            beats.forEach(beat => {
                xml += `      <Folder>\n`;
                xml += `        <name>${escapeXML(beat.name)}</name>\n`;
                const sw = beat.sweepers || 11;
                const target = beat.dailyTargetMeters || Math.round((beat.length_km * 1000) / sw);
                const daroga = beat.darogaName ? `${escapeXML(beat.darogaName)} (${escapeXML(beat.darogaPhone || 'No Phone')})` : 'Unassigned';
                const roster = beat.workers ? `<br/><b>Allotted Sweepers:</b><br/>${escapeXML(beat.workers).replace(/\n/g, '<br/>')}` : '';

                xml += `        <description>Ward/Sector: ${escapeXML(beat.ward || 'Sector')} | Road Length: ${beat.length_km} km | Workforce: ${sw} Sweepers | Daroga: ${daroga}</description>\n`;
                
                if (beat.polygonGeoJSON) {
                    const desc = `
<b>Beat:</b> ${escapeXML(beat.name)}<br/>
<b>Sector/Ward:</b> ${escapeXML(beat.ward || 'Sector')}<br/>
<b>Road Length:</b> ${beat.length_km} km<br/>
<b>Workforce Deployed:</b> ${sw} Sweepers (~${target}m/day target)<br/>
<b>Sanitary Daroga:</b> ${daroga}<br/>
${roster}
<b>Remarks:</b> ${escapeXML(beat.remarks || 'None')}
`;
                    xml += formatFeatureToKML(beat.polygonGeoJSON, beat.name, 'beatStyleDefault', desc);
                }

                xml += `      </Folder>\n`;
            });
            xml += `    </Folder>\n`;
        }

        xml += `  </Document>\n</kml>`;
        return xml;
    }

    /**
     * Convert a GeoJSON Feature into KML Placemark XML
     */
    function formatFeatureToKML(feature, name, styleId, description = '') {
        let xml = `      <Placemark>\n`;
        xml += `        <name>${escapeXML(name)}</name>\n`;
        if (description) {
            xml += `        <description><![CDATA[${description}]]></description>\n`;
        }
        if (styleId) {
            xml += `        <styleUrl>#${styleId}</styleUrl>\n`;
        }

        const geom = feature.geometry;
        if (!geom) return '';

        if (geom.type === 'LineString') {
            xml += `        <LineString>\n          <coordinates>\n            ${formatCoords(geom.coordinates)}\n          </coordinates>\n        </LineString>\n`;
        } else if (geom.type === 'Polygon') {
            xml += `        <Polygon>\n          <outerBoundaryIs>\n            <LinearRing>\n              <coordinates>\n                ${formatCoords(geom.coordinates[0])}\n              </coordinates>\n            </LinearRing>\n          </outerBoundaryIs>\n        </Polygon>\n`;
        } else if (geom.type === 'MultiPolygon') {
            xml += `        <MultiGeometry>\n`;
            geom.coordinates.forEach(polyCoords => {
                xml += `          <Polygon><outerBoundaryIs><LinearRing><coordinates>${formatCoords(polyCoords[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>\n`;
            });
            xml += `        </MultiGeometry>\n`;
        }

        xml += `      </Placemark>\n`;
        return xml;
    }

    function formatCoords(coordsArray) {
        return coordsArray.map(c => `${c[0]},${c[1]},0`).join(' ');
    }

    function escapeXML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Download KML or KMZ file
     */
    async function downloadKMLOrKMZ(data, filename = 'Rewari_Sweeper_Plan.kml', isKMZ = false) {
        const kmlString = generateKMLString(data);

        if (isKMZ && typeof JSZip !== 'undefined') {
            const zip = new JSZip();
            zip.file('doc.kml', kmlString);
            const blob = await zip.generateAsync({ type: 'blob' });
            triggerDownload(blob, filename.replace(/\.kml$/i, '.kmz'));
        } else {
            const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
            triggerDownload(blob, filename.replace(/\.kmz$/i, '.kml'));
        }
    }

    /**
     * Export Beats summary table to Excel / CSV
     */
    function exportToExcelOrCSV(beats, filename = 'Rewari_Sweeper_Beats.csv') {
        const rows = [
            ['Beat Name', 'Sector / Ward', 'Road Length (km)', 'Sweepers Deployed', 'Daily Target (m/sweeper)', 'Daroga / Jamadar', 'Daroga Phone', 'Allotted Sweepers / Workers', 'Remarks', 'Created Date']
        ];

        beats.forEach(b => {
            const sw = b.sweepers || 11;
            const target = b.dailyTargetMeters || Math.round((b.length_km * 1000) / sw);
            rows.push([
                b.name,
                b.ward || 'Cross-Ward Sector',
                b.length_km,
                sw,
                `~${target} m`,
                b.darogaName || 'Unassigned',
                b.darogaPhone || '',
                b.workers || '',
                b.remarks || '',
                b.createdAt ? new Date(b.createdAt).toLocaleDateString() : ''
            ]);
        });

        // Use SheetJS if available
        if (typeof XLSX !== 'undefined') {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, 'Sweeper Beats');
            XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename.replace(/\.csv$/i, '.xlsx'));
        } else {
            // CSV Fallback
            let csvContent = 'data:text/csv;charset=utf-8,';
            rows.forEach(r => {
                csvContent += r.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',') + '\n';
            });
            const encodedUri = encodeURI(csvContent);
            triggerDownload(encodedUri, filename.endsWith('.csv') ? filename : filename + '.csv');
        }
    }

    function triggerDownload(contentOrBlob, filename) {
        const a = document.createElement('a');
        if (contentOrBlob instanceof Blob) {
            a.href = URL.createObjectURL(contentOrBlob);
        } else {
            a.href = contentOrBlob;
        }
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    return {
        generateKMLString,
        downloadKMLOrKMZ,
        exportToExcelOrCSV
    };
})();
