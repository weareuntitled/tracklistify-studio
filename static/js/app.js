document.addEventListener('alpine:init', () => {
    Alpine.data('tracklistify', () => ({
        // =====================================================================
        // DATA STORAGE
        // =====================================================================
        sets: [], 
        filteredSets: [], 
        search: '',
        activeSet: null, 
        tracks: [], 
        likedTracks: [], 
        rescanCandidates: [],
        
        dashboardStats: { 
            total_sets: 0, 
            total_tracks: 0, 
            total_likes: 0, 
            discovery_rate: 0, 
            top_liked_artists: [], 
            top_sets: [], 
            recent_sets: [] 
        },
        
        // =====================================================================
        // UI STATE
        // =====================================================================
        currentView: 'dashboard', 
        queueStatus: { active: null, queue: [], history: [] },
        
        // Inputs für Upload Modal
        inputs: {
            url: '',
            file: null,
            metaName: '',
            metaArtist: '',
            metaEvent: '',
            metaTags: '',
            is_b2b: false,
            isLoadingMeta: false
        },
        
        // Inputs für Edit Modal
        editSetData: { id: null, name: '', artists: '', event: '', is_b2b: false, tags: '' },
        
        ui: {
            showAddModal: false, 
            showRescanModal: false, 
            showEditSetModal: false, 
            showLikes: false,
            playingId: null, 
            loadingId: null,
            hoverTrackId: null,
            contextMenu: { show: false, x: 0, y: 0, targetSet: null }
        },
        
        toasts: [],
        lastLogLine: '', 

        // =====================================================================
        // PLAYER & PRELOADER STATE
        // =====================================================================
        activeTrack: null,
        audio: { 
            currentTime: 0, 
            duration: 0, 
            progressPercent: 0, 
            volume: 0.5, 
            paused: true 
        },
        
        preloadQueue: [],
        activePreloads: 0,
        maxPreloads: 6,

        // =====================================================================
        // INITIALIZATION
        // =====================================================================
        init() {
            this.fetchSets(); 
            this.fetchLikes(); 
            this.fetchRescan(); 
            this.fetchDashboard();

            // Volume wiederherstellen
            const vol = localStorage.getItem('tracklistify_volume');
            if (vol !== null) this.audio.volume = parseFloat(vol);

            // Globaler Poll Loop (Status Updates)
            setInterval(() => {
                this.pollQueue();
                // Wenn Rescan View offen ist, öfter aktualisieren
                if (this.currentView === 'rescan' || this.ui.showRescanModal) {
                    this.fetchRescan();
                }
            }, 1500);

            // Suche Watcher
            this.$watch('search', val => {
                if(!val) this.filteredSets = this.sets;
                else this.filteredSets = this.sets.filter(s => s.name.toLowerCase().includes(val.toLowerCase()));
            });
            
            // Player Init
            this.$nextTick(() => {
                if(this.$refs.player) this.$refs.player.volume = this.audio.volume;
            });
        },

        // =====================================================================
        // METADATA PARSING (Server & Client)
        // =====================================================================
        
        // 1. Server: Holt Infos von YouTube/Mixcloud via yt-dlp
        async fetchUrlMetadata(url) {
            if (!url || !(url.startsWith('http') || url.startsWith('www'))) return;
            this.inputs.isLoadingMeta = true;
            try {
                const res = await fetch('/api/resolve_metadata', {
                    method: 'POST',
                    body: JSON.stringify({ url })
                });
                const data = await res.json();

                if (data.ok) {
                    // Nur überschreiben, wenn Felder leer oder wir sicher sind
                    if (!this.inputs.metaName) this.inputs.metaName = data.name || '';
                    if (!this.inputs.metaArtist) this.inputs.metaArtist = data.artist || '';
                    if (!this.inputs.metaEvent) this.inputs.metaEvent = data.event || '';

                    this.showToast("Infos gefunden", data.name || "Metadaten geladen", "info");
                } else {
                    this.showToast("Keine Metadaten", data.error || "Konnte Infos nicht laden", "info");
                }
            } catch(e) {
                console.error(e);
                this.showToast("Fehler", "Metadaten konnten nicht geladen werden", "error");
            } finally {
                this.inputs.isLoadingMeta = false;
            }
        },

        // 2. Client: Regex Parser für lokale Dateinamen
        parseFileMetadata() {
            if (this.$refs.fileInput && this.$refs.fileInput.files[0]) {
                const raw = this.$refs.fileInput.files[0].name.replace(/\.[^/.]+$/, "");
                let clean = raw.replace(/_/g, ' ').replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
                
                // Muster: Artist - Title @ Event
                const parts = clean.split(/\s+-\s+|\s+@\s+|\s+\|\s+/);
                
                if (parts.length >= 2) {
                    this.inputs.metaArtist = parts[0].trim();
                    this.inputs.metaName = parts[1].trim();
                    if (parts.length >= 3) this.inputs.metaEvent = parts[2].trim();
                } else {
                    this.inputs.metaName = clean;
                }
            }
        },

        // =====================================================================
        // QUEUE & JOBS
        // =====================================================================
        async addToQueue(type) {
            const fd = new FormData();
            fd.append('type', type);
            
            const meta = { 
                name: this.inputs.metaName, 
                artist: this.inputs.metaArtist, 
                event: this.inputs.metaEvent, 
                tags: this.inputs.metaTags, 
                is_b2b: this.inputs.is_b2b 
            };
            fd.append('metadata', JSON.stringify(meta));

            if (type === 'url') {
                if (!this.inputs.url) return;
                fd.append('value', this.inputs.url);
            } else {
                const f = this.$refs.fileInput;
                if (!f.files.length) return;
                fd.append('file', f.files[0]);
                f.value = '';
            }

            // Direkt Modal schließen und zur Queue springen
            this.ui.showAddModal = false;
            this.showQueueView();

            await fetch('/api/queue/add', { method: 'POST', body: fd });

            // UI Reset
            this.inputs.url = '';
            this.inputs.metaName = '';
            this.inputs.metaArtist = '';
            this.inputs.metaEvent = '';
            this.inputs.metaTags = '';

            // Zur Queue wechseln
            this.pollQueue();
        },

        async pollQueue() {
            try {
                const res = await fetch('/api/queue/status');
                const status = await res.json();

                // Job fertig geworden?
                if (this.queueStatus.active && !status.active) {
                    this.fetchSets(); 
                    this.fetchDashboard();
                    this.showToast("Verarbeitung fertig", "Set wurde importiert.", "success");
                }
                
                // Live Log Toasties
                if (status.active && status.active.log) {
                    const currentLog = status.active.log.trim();
                    if (currentLog !== this.lastLogLine) {
                        this.lastLogLine = currentLog;
                        
                        if (currentLog.includes("Found") || currentLog.includes("Identified") || currentLog.includes("=>")) {
                            // Track erkannt
                            let cleanMsg = currentLog.replace(/\[.*?\]/g, '').trim(); 
                            this.showToast("Track erkannt", cleanMsg, "track");
                        } else if (currentLog.includes("Download:")) {
                            this.showToast("Download gestartet", status.active.label, "info");
                        }
                    }
                }
                this.queueStatus = status;
            } catch(e) {}
        },

        async stopQueue() {
            try {
                await fetch('/api/queue/stop', { method: 'POST' });
                this.showToast("Verarbeitung gestoppt", "Aktiver Job wird abgebrochen.", "info");
                this.pollQueue();
            } catch(e) {
                console.error(e);
            }
        },

        // =====================================================================
        // NAVIGATION & VIEWS
        // =====================================================================
        showDashboard() { 
            this.currentView = 'dashboard'; 
            this.activeSet = null; 
            this.fetchDashboard(); 
        },
        
        showQueueView() { 
            this.currentView = 'queue'; 
            this.activeSet = null; 
            this.ui.showLikes = false; 
        },
        
        showRescanView() { 
            this.currentView = 'rescan'; 
            this.activeSet = null; 
            this.fetchRescan(); 
            this.ui.showLikes = false; 
        },
        
        showLikesView() { 
            this.currentView = 'likes'; 
            this.ui.showLikes = false; 
            this.fetchLikes(); 
        },
        
        showSetView(set) { 
            this.loadSet(set.id); 
        },

        // =====================================================================
        // SET MANAGEMENT
        // =====================================================================
        async loadSet(id) {
            this.activeSet = this.sets.find(s => s.id === id);
            this.currentView = 'sets';
            
            const res = await fetch(`/api/sets/${id}/tracks`);
            this.tracks = await res.json();
            
            // Turbo anwerfen
            this.startPreloading();
        },

        // Context Menu
        openSetContextMenu(e, set) {
            e.preventDefault(); 
            e.stopPropagation();
            this.ui.contextMenu.targetSet = set;
            
            let x = e.clientX;
            let y = e.clientY;
            if (y > window.innerHeight - 200) y -= 150; // Overflow prevent
            
            this.ui.contextMenu.x = x;
            this.ui.contextMenu.y = y;
            this.ui.contextMenu.show = true;
        },

        // Edit Modal
        openEditSetModal() {
            const set = this.ui.contextMenu.targetSet;
            this.ui.contextMenu.show = false;
            this.editSetData = { 
                id: set.id, 
                name: set.name, 
                artists: set.artists || '', 
                event: set.event || '', 
                is_b2b: !!set.is_b2b, 
                tags: set.tags || '' 
            };
            this.ui.showEditSetModal = true;
        },

        async saveSetMetadata() {
            await fetch(`/api/sets/${this.editSetData.id}/metadata`, { 
                method: 'POST', 
                body: JSON.stringify(this.editSetData) 
            });
            this.fetchSets();
            
            // Update Active Set wenn wir gerade drin sind
            if (this.activeSet && this.activeSet.id === this.editSetData.id) {
                this.activeSet = { ...this.activeSet, ...this.editSetData };
            }
            this.ui.showEditSetModal = false;
            this.showToast("Änderungen gespeichert.", "", "success");
        },

        async renameSetContext() {
            const set = this.ui.contextMenu.targetSet; 
            this.ui.contextMenu.show = false;
            const n = prompt("Neuer Name für das Set:", set.name);
            
            if(n && n !== set.name) { 
                await fetch(`/api/sets/${set.id}/rename`, { 
                    method: 'POST', body: JSON.stringify({name: n}) 
                }); 
                this.fetchSets(); 
                if(this.activeSet && this.activeSet.id === set.id) this.activeSet.name = n;
            }
        },

        async deleteSetContext() {
            const set = this.ui.contextMenu.targetSet; 
            this.ui.contextMenu.show = false;
            if(confirm(`Set "${set.name}" wirklich löschen?`)) { 
                await fetch(`/api/sets/${set.id}`, { method: 'DELETE' }); 
                this.fetchSets(); 
                this.showDashboard(); 
            }
        },

        async rescanSetContext() {
            const set = this.ui.contextMenu.targetSet; 
            this.ui.contextMenu.show = false; 
            const val = set.audio_file || set.source_url; 
            
            if(!val) return alert("Keine Audio-Datei oder URL hinterlegt.");
            
            const fd = new FormData(); 
            fd.append('type', 'url'); 
            fd.append('value', val); 
            
            // Alte Metadaten behalten
            const meta = { 
                name: set.name, 
                artist: set.artists, 
                event: set.event, 
                tags: set.tags 
            };
            fd.append('metadata', JSON.stringify(meta));
            
            await fetch('/api/queue/add', { method: 'POST', body: fd }); 
            this.pollQueue(); 
            this.showToast("Set zur Warteschlange hinzugefügt.", "", "info");
        },

        // =====================================================================
        // AUDIO PLAYER & PRELOADER
        // =====================================================================
        updateVolume(e) {
            const val = parseFloat(e.target.value);
            this.audio.volume = val;
            if(this.$refs.player) this.$refs.player.volume = val;
            localStorage.setItem('tracklistify_volume', val);
        },
        
        async togglePlay(track) {
            const player = this.$refs.player;
            player.volume = this.audio.volume;

            if (this.ui.playingId === track.id) {
                if (player.paused) { player.play(); this.audio.paused = false; }
                else { player.pause(); this.audio.paused = true; }
                return;
            }

            this.ui.loadingId = track.id;
            this.audio.progressPercent = 0;
            this.activeTrack = track;

            let url = track.streamUrl;
            
            // Fallback: Ad-hoc laden
            if (!url) {
                try {
                    const res = await fetch('/api/resolve_audio', { 
                        method: 'POST', 
                        body: JSON.stringify({ query: `${track.artist} - ${track.title}` }) 
                    });
                    const data = await res.json();
                    if (data.ok) url = data.url;
                } catch(e) { console.error(e); }
            }

            if (url) {
                track.streamUrl = url;
                player.src = url;
                player.play().then(() => {
                    this.ui.playingId = track.id;
                    this.audio.paused = false;
                }).catch(() => this.showToast("Autoplay verhindert", "Browser Policy", "info"));
            } else {
                this.showToast("Stream nicht verfügbar", "Keine Quelle gefunden.", "info");
            }
            this.ui.loadingId = null;
        },
        
        togglePlayPauseGlobal() {
            const player = this.$refs.player;
            if (!this.activeTrack) return;
            if (player.paused) { player.play(); this.audio.paused = false; }
            else { player.pause(); this.audio.paused = true; }
        },
        
        updateProgress(e) {
            const { currentTime, duration } = e.target;
            this.audio.currentTime = currentTime;
            this.audio.duration = duration;
            this.audio.progressPercent = (currentTime / duration) * 100 || 0;
            this.audio.paused = e.target.paused;
        },
        
        seekGlobal(e) {
            const player = this.$refs.player;
            if (!player.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const pct = Math.max(0, Math.min(1, x / rect.width));
            player.currentTime = pct * player.duration;
        },
        
        seek(e, track) {
            // Scrubbing in der Liste
            const player = this.$refs.player;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const pct = Math.max(0, Math.min(1, x / rect.width));
            
            if (this.ui.playingId === track.id) {
                if (player.duration) player.currentTime = pct * player.duration;
            } else {
                this.togglePlay(track).then(() => {
                    if (player.duration) player.currentTime = pct * player.duration;
                });
            }
        },

        // --- Preloading Engine ---
        startPreloading() {
            this.preloadQueue = [];
            this.preloadQueue = this.tracks.filter(t => !t.streamUrl).map(t => t.id);
            this.triggerPreloadWorker();
        },
        
        prioritizePreload(trackId) {
            // Hover Turbo
            const track = this.tracks.find(t => t.id === trackId);
            if (!track || track.streamUrl) return;
            
            const idx = this.preloadQueue.indexOf(trackId);
            if (idx > -1) this.preloadQueue.splice(idx, 1);
            
            this.preloadQueue.unshift(trackId);
            this.triggerPreloadWorker();
        },
        
        triggerPreloadWorker() {
            while (this.activePreloads < this.maxPreloads && this.preloadQueue.length > 0) {
                this.preloadSingleTrack(this.preloadQueue.shift());
            }
        },
        
        async preloadSingleTrack(trackId) {
            this.activePreloads++;
            const track = this.tracks.find(t => t.id === trackId);
            
            if (!track || track.streamUrl) {
                this.activePreloads--;
                this.triggerPreloadWorker();
                return;
            }
            
            try {
                const res = await fetch('/api/resolve_audio', { 
                    method: 'POST', 
                    body: JSON.stringify({ query: `${track.artist} - ${track.title}` }) 
                });
                const data = await res.json();
                if (data.ok) track.streamUrl = data.url;
            } catch(e) {} 
            finally {
                this.activePreloads--;
                this.triggerPreloadWorker();
            }
        },

        // =====================================================================
        // TRACK ACTIONS & API FETCHERS
        // =====================================================================
        async fetchDashboard() { const res = await fetch('/api/dashboard'); this.dashboardStats = await res.json(); },
        async fetchSets() { const res = await fetch('/api/sets'); this.sets = await res.json(); this.filteredSets = this.sets; },
        async fetchLikes() { const res = await fetch('/api/tracks/likes'); this.likedTracks = await res.json(); },
        async fetchRescan() { const res = await fetch('/api/tracks/rescan_candidates'); this.rescanCandidates = await res.json(); },
        
        async toggleLike(track) {
            track.liked = !track.liked;
            // Update Local List
            if (this.currentView === 'likes' && !track.liked) {
                this.likedTracks = this.likedTracks.filter(t => t.id !== track.id);
            }
            
            await fetch(`/api/tracks/${track.id}/like`, { 
                method: 'POST', 
                body: JSON.stringify({liked: track.liked ? 1 : 0}) 
            });
            
            if (this.currentView !== 'likes') this.fetchLikes();
        },
        
        async toggleFlag(track) {
            const newFlag = track.flag === 3 ? 0 : 3;
            track.flag = newFlag;
            
            await fetch(`/api/tracks/${track.id}/flag`, { 
                method: 'POST', 
                body: JSON.stringify({flag: newFlag}) 
            });
            this.fetchRescan();
        },
        
        async runRescan() {
            if(!confirm("Alle markierten Tracks neu verarbeiten?")) return;
            await fetch('/api/tracks/rescan_run', { method: 'POST' });
            this.fetchRescan();
        },
        
        // =====================================================================
        // UTILS & HELPERS
        // =====================================================================
        onAudioEnded() { this.ui.playingId = null; this.audio.progressPercent = 0; this.audio.paused = true; },
        onAudioPaused() { this.audio.paused = true; },
        onAudioPlaying() { this.audio.paused = false; },
        onAudioError() { this.ui.playingId = null; this.ui.loadingId = null; }, // Silent error
        
        showToast(title, subtitle = '', type = 'default') {
            const id = Date.now();
            this.toasts.push({ id, title, subtitle, type });
            setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id) }, 4000);
        },

        formatTime(s) { if (!s) return '00:00'; const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}`; },
        formatDate(s) { if (!s) return ''; return new Date(s).toLocaleDateString('de-DE'); },
        formatConf(c) { if(c === null || c === undefined) return '-'; return Math.round(c * 100) + '%'; },
        
        getConfColor(c) { 
            if (c >= 0.8) return 'bg-green-100 text-green-800'; 
            if (c >= 0.5) return 'bg-yellow-100 text-yellow-800'; 
            return 'bg-red-100 text-red-800'; 
        },
        
        getPhaseColor(phase) { 
            if (phase === 'downloading') return 'bg-blue-500'; 
            if (phase === 'analyzing') return 'bg-orange-500'; 
            if (phase === 'importing') return 'bg-green-500'; 
            return 'bg-gray-500'; 
        },
        
        getPhaseLabel(phase) { 
            if (phase === 'downloading') return 'Download'; 
            if (phase === 'analyzing') return 'Analyse'; 
            if (phase === 'importing') return 'Import'; 
            return 'Verarbeite...'; 
        },
        
        getSearchLink(track, provider) { 
             const q = encodeURIComponent(`${track.artist} ${track.title}`); 
             const map = { 
                 youtube: `https://www.youtube.com/results?search_query=${q}`, 
                 beatport: `https://www.beatport.com/search?q=${q}`, 
                 bandcamp: `https://bandcamp.com/search?q=${q}`, 
                 soundcloud: `https://soundcloud.com/search?q=${q}`, 
                 google: `https://www.google.com/search?q=${q}` 
             }; 
             return map[provider] || '#'; 
        },
        
        copyTracklist() { 
            if(!this.tracks.length) return; 
            const list = this.tracks.map(t => `[${this.formatTime(t.start_time)}] ${t.artist} - ${t.title}`).join('\n'); 
            navigator.clipboard.writeText(list); 
            this.showToast("Kopiert!", "", "success"); 
        }
    }));
});