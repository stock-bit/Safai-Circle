/**
 * Project Save & Load Persistence Manager for Rewari Sweeper Beat Planning System
 * Handles exporting and restoring complete project state via JSON.
 */

window.ProjectManager = (function () {

    /**
     * Build Project State JSON Object
     */
    function createProjectState(appState) {
        return {
            version: '1.0',
            system: 'Rewari Sweeper Beat Planning System',
            savedAt: new Date().toISOString(),
            settings: appState.dedupSettings || {},
            manualOverrides: appState.manualOverrides || {},
            beats: appState.beats || [],
            datasets: {
                ulbRoads: appState.ulbRoadsGeoJSON || null,
                existingRoads: appState.existingRoadsGeoJSON || null,
                wards: appState.wardsGeoJSON || null,
                cleanRoads: appState.cleanRoadsGeoJSON || null
            }
        };
    }

    /**
     * Download Project JSON file
     */
    function saveProjectToFile(appState, filename = 'Rewari_Sweeper_Project.json') {
        const state = createProjectState(appState);
        const jsonStr = JSON.stringify(state, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    /**
     * Load Project State from File or JSON string
     */
    async function loadProjectFromFile(fileOrJson) {
        let jsonText = '';
        if (fileOrJson instanceof File || fileOrJson instanceof Blob) {
            jsonText = await fileOrJson.text();
        } else if (typeof fileOrJson === 'string') {
            jsonText = fileOrJson;
        } else {
            throw new Error('Invalid project file input.');
        }

        const projectData = JSON.parse(jsonText);
        if (!projectData || !projectData.system) {
            throw new Error('Invalid Rewari Sweeper Project JSON format.');
        }

        return projectData;
    }

    return {
        createProjectState,
        saveProjectToFile,
        loadProjectFromFile
    };
})();
