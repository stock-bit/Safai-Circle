/**
 * Supabase Cloud Sync Client for Rewari Sweeper Beat Planning System
 * Connects the web application directly to Supabase cloud database.
 * Enables real-time multi-device sync, boundary persistence, and live Daroga roster updates.
 */

window.SupabaseSync = (function () {
    const SUPABASE_URL = 'https://oghpygmixldownphpykn.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_ffWe-d8_aYEpYau6SLNEPA_omOxJBrZ';

    let client = null;
    let isConnected = false;
    let onSyncStatusListeners = [];

    function initClient() {
        if (client) return client;
        try {
            if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
                client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                    auth: { persistSession: false }
                });
                isConnected = true;
                notifyStatus(true);
                console.log('✓ Connected to Supabase Cloud Database');
            } else {
                console.warn('Supabase SDK not loaded yet. Using offline storage fallback.');
            }
        } catch (e) {
            console.error('Failed to initialize Supabase client:', e);
            isConnected = false;
            notifyStatus(false);
        }
        return client;
    }

    function notifyStatus(status) {
        onSyncStatusListeners.forEach(fn => fn(status));
    }

    /**
     * Fetch all beats from Supabase Cloud Table
     */
    async function fetchBeats() {
        const sb = initClient();
        if (!sb) return null;

        try {
            const { data, error } = await sb
                .from('sweeper_beats')
                .select('*')
                .order('beat_no', { ascending: true });

            if (error) {
                console.warn('Supabase fetch error:', error);
                return null;
            }

            if (data && data.length > 0) {
                // Map DB schema to app internal beat structure
                return data.map(row => ({
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
                }));
            }
        } catch (e) {
            console.warn('Supabase network error during fetch:', e);
        }
        return null;
    }

    /**
     * Upsert a single beat into Supabase
     */
    async function saveBeat(beat) {
        const sb = initClient();
        if (!sb || !beat) return false;

        try {
            const record = {
                id: String(beat.id),
                name: beat.name,
                ward: beat.ward || 'Sector',
                length_km: Number(beat.length_km) || 0,
                area_km2: Number(beat.area_km2) || 0,
                segment_count: Number(beat.segment_count) || 0,
                sweepers: Number(beat.sweepers) || 11,
                daily_target_meters: Number(beat.dailyTargetMeters) || Math.round(((Number(beat.length_km) || 0) * 1000) / (Number(beat.sweepers) || 11)),
                daroga_name: beat.darogaName || '',
                daroga_phone: beat.darogaPhone || '',
                workers: beat.workers || '',
                remarks: beat.remarks || '',
                color: beat.color || null,
                polygon_geojson: beat.polygonGeoJSON || null,
                updated_at: new Date().toISOString()
            };

            const { error } = await sb
                .from('sweeper_beats')
                .upsert([record], { onConflict: 'id' });

            if (error) {
                console.warn('Supabase save error:', error);
                return false;
            }
            return true;
        } catch (e) {
            console.warn('Network error saving to Supabase:', e);
            return false;
        }
    }

    /**
     * Upsert all beats in bulk into Supabase
     */
    async function saveAllBeats(beats) {
        const sb = initClient();
        if (!sb || !beats || beats.length === 0) return false;

        try {
            const records = beats.map((b, idx) => ({
                id: String(b.id),
                beat_no: idx + 1,
                name: b.name,
                ward: b.ward || 'Sector',
                length_km: Number(b.length_km) || 0,
                area_km2: Number(b.area_km2) || 0,
                segment_count: Number(b.segment_count) || 0,
                sweepers: Number(b.sweepers) || 11,
                daily_target_meters: Number(b.dailyTargetMeters) || Math.round(((Number(b.length_km) || 0) * 1000) / (Number(b.sweepers) || 11)),
                daroga_name: b.darogaName || '',
                daroga_phone: b.darogaPhone || '',
                workers: b.workers || '',
                remarks: b.remarks || '',
                color: b.color || null,
                polygon_geojson: b.polygonGeoJSON || null,
                updated_at: new Date().toISOString()
            }));

            const { error } = await sb
                .from('sweeper_beats')
                .upsert(records, { onConflict: 'id' });

            if (error) {
                console.warn('Supabase bulk save error:', error);
                return false;
            }
            return true;
        } catch (e) {
            console.warn('Network error bulk saving to Supabase:', e);
            return false;
        }
    }

    /**
     * Delete a single beat from Supabase
     */
    async function deleteBeat(beatId) {
        const sb = initClient();
        if (!sb || !beatId) return false;

        try {
            const { error } = await sb
                .from('sweeper_beats')
                .delete()
                .eq('id', String(beatId));

            if (error) {
                console.warn('Supabase delete error:', error);
                return false;
            }
            return true;
        } catch (e) {
            console.warn('Network error deleting from Supabase:', e);
            return false;
        }
    }

    /**
     * Real-time subscription: listen for updates from other clients
     */
    function subscribeToChanges(onUpdateCallback) {
        const sb = initClient();
        if (!sb) return null;

        try {
            return sb
                .channel('realtime_sweeper_beats')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'sweeper_beats' }, payload => {
                    console.log('⚡ Realtime Supabase Update received:', payload);
                    if (onUpdateCallback) onUpdateCallback(payload);
                })
                .subscribe();
        } catch (e) {
            console.warn('Realtime subscription not available:', e);
            return null;
        }
    }

    /**
     * Replace all beats cleanly in Supabase: removes stale rows and saves new beats
     */
    async function replaceAllBeats(beats) {
        const sb = initClient();
        if (!sb || !beats || beats.length === 0) return false;

        try {
            // Delete existing rows
            await sb
                .from('sweeper_beats')
                .delete()
                .neq('id', '_none_placeholder_');

            // Insert new rows with integer beat_no
            const records = beats.map((b, idx) => ({
                id: String(b.id || `beat-${idx + 1}`),
                beat_no: idx + 1,
                name: b.name,
                ward: b.ward || 'Sector',
                length_km: Number(b.length_km) || 0,
                area_km2: Number(b.area_km2) || 0,
                segment_count: Number(b.segment_count) || 0,
                sweepers: Number(b.sweepers) || 11,
                daily_target_meters: Number(b.dailyTargetMeters) || Math.round(((Number(b.length_km) || 0) * 1000) / (Number(b.sweepers) || 11)),
                daroga_name: b.darogaName || '',
                daroga_phone: b.darogaPhone || '',
                workers: b.workers || '',
                remarks: b.remarks || '',
                color: b.color || null,
                polygon_geojson: b.polygonGeoJSON || null,
                updated_at: new Date().toISOString()
            }));

            const { error } = await sb
                .from('sweeper_beats')
                .insert(records);

            if (error) {
                console.warn('Supabase replace error:', error);
                return false;
            }
            return true;
        } catch (e) {
            console.warn('Network error during replaceAllBeats:', e);
            return false;
        }
    }

    return {
        initClient,
        fetchBeats,
        saveBeat,
        saveAllBeats,
        replaceAllBeats,
        deleteBeat,
        subscribeToChanges,
        isConfigured: () => true,
        isConnected: () => isConnected,
        onStatusChange: (fn) => onSyncStatusListeners.push(fn)
    };
})();

