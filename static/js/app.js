class UploadManager {
    constructor(component) {
        this.component = component;
        this.debounceTimer = null;
    }

    setTab(tab) {
        this.component.uploadState.tab = tab;
        this.component.inputs.url = tab === 'url' ? this.component.inputs.url : '';
        if (tab === 'url') {
            this.resetFile();
        } else {
            this.component.inputs.metaName = '';
            this.component.inputs.metaArtist = '';
            this.component.inputs.metaEvent = '';
            this.component.inputs.metaTags = '';
        }
    }

    resetFile() {
        this.component.inputs.file = null;
        if (this.component.$refs.fileInput) {
            this.component.$refs.fileInput.value = '';
        }
    }

    handleUrlInput(value) {
        const url = (value || '').trim();
        this.component.inputs.url = url;
        this.component.uploadState.tab = 'url';
        this.triggerMetadataResolve(url);
    }

    handlePaste(event) {
        const pasted = event.clipboardData?.getData('text') || '';
        if (pasted) {
            this.handleUrlInput(pasted);
        }
    }

    triggerMetadataResolve(url) {
        clearTimeout(this.debounceTimer);
        if (!url) return;
        this.debounceTimer = setTimeout(() => {
            this.component.fetchUrlMetadata(url);
        }, 350);
    }

    handleFileChange(file) {
        this.component.uploadState.tab = 'file';
        this.component.inputs.file = file || null;
        this.component.parseFileMetadata(file);
    }

    async submit(typeOverride = null) {
        if (!this.component.ensureAuthenticated()) return;

        const type = typeOverride || this.component.uploadState.tab;
        const metadata = {
            name: this.component.inputs.metaName,
            artist: this.component.inputs.metaArtist,
            event: this.component.inputs.metaEvent,
            tags: this.component.inputs.metaTags,
            is_b2b: this.component.inputs.is_b2b
        };

        this.component.uploadState.isSubmitting = true;
        try {
            if (type === 'url') {
                if (!this.component.inputs.url) return;
                const res = await fetch('/api/queue/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'url',
                        value: this.component.inputs.url,
                        metadata
                    })
                });
                if (res.status === 401) return this.component.ensureAuthenticated();
            } else {
                const file = this.component.inputs.file || (this.component.$refs.fileInput?.files || [])[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('type', 'file');
                fd.append('file', file);
                fd.append('metadata', JSON.stringify(metadata));
                const res = await fetch('/api/queue/add', { method: 'POST', body: fd });
                if (res.status === 401) return this.component.ensureAuthenticated();
            }

            this.component.ui.showAddModal = false;
            this.component.showQueueView();
            this.component.resetUploadInputs();
            await this.component.pollQueue();
        } finally {
            this.component.uploadState.isSubmitting = false;
        }
    }
}

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
        purchasedTracks: [],
        favoriteProducers: [],
        rescanCandidates: [],
        youtubeFeed: [],
        folders: [],
        activeFolderId: null,
        draggingSet: null,
        folderHoverId: null,
        trashHover: false,

        auth: {
            user: null,
            form: { email: '', password: '', name: '' },
            mode: 'login',
            error: '',
            dropdownOpen: false
        },
        
        dashboardStats: {
            total_sets: 0,
            total_tracks: 0,
            total_likes: 0,
            discovery_rate: 0,
            top_liked_artists: [],
            top_artists: [],
            top_sets: [],
            recent_sets: [],
            top_producers: [],
            top_djs: []
        },

        profile: { display_name: '', dj_name: '', soundcloud_url: '', avatar_url: '' },

        admin: {
            show: false,
            users: [],
            invite: { username: '', password: '', generated: '' }
        },
        
        // =====================================================================
        // UI STATE
        // =====================================================================
        currentView: 'dashboard',
        queueStatus: { active: null, queue: [], history: [], queue_count: 0 },
        uploadManager: null,
        uploadState: { tab: 'url', lastResolvedUrl: '', isSubmitting: false, isProcessing: false },
        
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
            contextMenu: { show: false, x: 0, y: 0, target: null, type: null },
            uploadTab: 'url'
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
            this.uploadManager = new UploadManager(this);
            this.fetchSets();
            this.fetchLikes();
            this.fetchPurchases();
            this.fetchProducerLikes();
            this.fetchRescan();
            this.fetchDashboard();
            this.fetchProfile();
            this.fetchYoutube();
            this.loadFolders();

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
                this.updateFilteredSets();
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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
                const data = await res.json();

                if (data.ok) {
                    // Nur überschreiben, wenn Felder leer oder wir sicher sind
                    if (!this.inputs.metaName) this.inputs.metaName = data.name || '';
                    if (!this.inputs.metaArtist) this.inputs.metaArtist = data.artist || '';
                    if (!this.inputs.metaEvent) this.inputs.metaEvent = data.event || '';
                    this.uploadState.lastResolvedUrl = url;

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
        parseFileMetadata(file = null) {
            const targetFile = file || (this.$refs.fileInput && this.$refs.fileInput.files[0]);
            if (targetFile) {
                const raw = targetFile.name.replace(/\.[^/.]+$/, "");
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
            return this.uploadManager.submit(type);
        },

        resetUploadInputs() {
            this.inputs.url = '';
            this.inputs.metaName = '';
            this.inputs.metaArtist = '';
            this.inputs.metaEvent = '';
            this.inputs.metaTags = '';
            this.inputs.is_b2b = false;
            this.uploadState.tab = 'url';
            this.uploadState.lastResolvedUrl = '';
            this.uploadManager.resetFile();
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
                this.handleLiveLog(status);

                this.queueStatus = {
                    active: status.active || null,
                    queue: status.queue || [],
                    history: status.history || [],
                    queue_count: typeof status.queue_count === 'number' ? status.queue_count : (status.queue || []).length
                };
                this.uploadState.isProcessing = !!(status?.active || (status?.queue || []).length);
            } catch(e) {}
        },

        processingLabel() {
            if (this.queueStatus?.active) return this.queueStatus.active.label || 'Processing';
            if (this.queueStatus?.queue && this.queueStatus.queue.length) {
                return this.queueStatus.queue[0].label || 'Queued';
            }
            return '';
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
            this.fetchPurchases();
            this.fetchProducerLikes();
        },

        showCollections() {
            this.currentView = 'collections';
            this.fetchLikes();
        },

        showSetView(set) {
            this.loadSet(set);
        },

        // =====================================================================
        // SET MANAGEMENT
        // =====================================================================
        async loadSet(setOrId) {
            const isObject = setOrId && typeof setOrId === 'object';
            const id = isObject ? setOrId.id : setOrId;

            // Ensure we always have the latest sidebar list (e.g. after DB reset)
            if (!this.sets.length) {
                await this.fetchSets();
            }

            if (isObject) {
                this.activeSet = setOrId;

                // Ensure the sidebar list contains the set so the active state can be highlighted
                const existing = this.sets.find(s => s.id === id);
                if (!existing) {
                    this.sets = [setOrId, ...this.sets];
                    this.filteredSets = this.sets;
                }
            } else {
                this.activeSet = this.sets.find(s => s.id === id);

                // If the set is not loaded yet (e.g. opened from dashboard recents), fetch the list first
                if (!this.activeSet) {
                    await this.fetchSets();
                    this.activeSet = this.sets.find(s => s.id === id);
                }
            }

            this.currentView = 'sets';

            const res = await fetch(`/api/sets/${id}/tracks`);
            this.tracks = await res.json();
            
            // Turbo anwerfen
            this.startPreloading();
        },

        // Context Menu
        openSetContextMenu(e, set) {
            this.openContextMenu(e, 'set', set);
        },

        openFolderContextMenu(e, folder) {
            this.openContextMenu(e, 'folder', folder);
        },

        openContextMenu(event, type, target) {
            event.preventDefault();
            event.stopPropagation();
            this.ui.contextMenu.target = target;
            this.ui.contextMenu.type = type;
            this.ui.contextMenu.x = event.clientX;
            this.ui.contextMenu.y = event.clientY;
            this.ui.contextMenu.show = true;

            this.$nextTick(() => this.positionContextMenu());
        },

        positionContextMenu() {
            if (!this.ui.contextMenu.show) return;
            const menu = this.$refs.contextMenu;
            if (!menu) return;

            const rect = menu.getBoundingClientRect();
            const margin = 8;
            let nextX = this.ui.contextMenu.x;
            let nextY = this.ui.contextMenu.y;

            if (nextX + rect.width + margin > window.innerWidth) {
                nextX = Math.max(margin, window.innerWidth - rect.width - margin);
            }
            if (nextY + rect.height + margin > window.innerHeight) {
                nextY = Math.max(margin, window.innerHeight - rect.height - margin);
            }

            this.ui.contextMenu.x = nextX;
            this.ui.contextMenu.y = nextY;
        },

        handleContextMenuOutside(event) {
            if (!this.ui.contextMenu.show) return;
            const menu = this.$refs.contextMenu;
            if (menu && menu.contains(event.target)) return;
            this.closeContextMenu();
        },

        closeContextMenu() {
            this.ui.contextMenu.show = false;
            this.ui.contextMenu.target = null;
            this.ui.contextMenu.type = null;
        },

        // Edit Modal
        openEditSetModal() {
            const set = this.ui.contextMenu.target;
            this.closeContextMenu();
            if (!set) return;
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
            const set = this.ui.contextMenu.target; 
            this.closeContextMenu();
            if (!set) return;
            const n = prompt("Neuer Name für das Set:", set.name);
            
            if(n && n !== set.name) { 
                await fetch(`/api/sets/${set.id}/rename`, { 
                    method: 'POST', body: JSON.stringify({name: n}) 
                }); 
                this.fetchSets(); 
                if(this.activeSet && this.activeSet.id === set.id) this.activeSet.name = n;
            }
        },

        async deleteSet(set, options = {}) {
            const target = set && set.id ? set : this.sets.find(s => s.id === set);
            if (!target) return false;

            const { prompt = false } = options;
            if (prompt && !confirm(`Set "${target.name || target.id}" wirklich löschen?`)) return false;

            await fetch(`/api/sets/${target.id}`, { method: 'DELETE' });
            this.sets = this.sets.filter(s => s.id !== target.id);
            this.filteredSets = this.filteredSets.filter(s => s.id !== target.id);
            this.folders = (this.folders || []).map(folder => ({
                ...folder,
                sets: (folder.sets || []).filter(id => id !== target.id)
            }));
            this.persistFoldersLocally();

            if (this.activeSet && this.activeSet.id === target.id) {
                this.activeSet = null;
                this.tracks = [];
            }

            this.syncFolderAssignments();
            this.showDashboard();
            return true;
        },

        async deleteSetContext() {
            const set = this.ui.contextMenu.target;
            this.closeContextMenu();
            await this.confirmAndDeleteSet(set);
        },

        async rescanSetContext() {
            const set = this.ui.contextMenu.target; 
            this.closeContextMenu(); 
            if (!set) return;
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

        async moveSetToFolderFromMenu(folder) {
            const set = this.ui.contextMenu.target;
            this.closeContextMenu();
            if (!set || !folder) return;
            await this.assignSetToFolder(set, folder);
        },

        promptMoveSetContext() {
            const set = this.ui.contextMenu.target;
            this.closeContextMenu();
            if (!set) return;
            if (!this.folders.length) {
                this.showToast('Keine Ordner', 'Lege zuerst einen Ordner an.', 'info');
                return;
            }

            const name = prompt('Set in welchen Ordner verschieben?', this.folders[0].name);
            const folder = this.folders.find(f => f.name.toLowerCase() === (name || '').toLowerCase());
            if (folder) this.assignSetToFolder(set, folder);
        },

        async confirmAndDeleteSet(set, message) {
            if (!set) return false;
            const confirmMessage = message || `Set "${set.name}" wirklich löschen?`;
            const confirmed = confirm(confirmMessage);
            if (!confirmed) return false;

            await fetch(`/api/sets/${set.id}`, { method: 'DELETE' });
            this.sets = this.sets.filter(s => s.id !== set.id);
            this.filteredSets = this.filteredSets.filter(s => s.id !== set.id);
            this.removeSetFromFolders(set.id);
            if (this.activeSet && this.activeSet.id === set.id) {
                this.activeSet = null;
                this.tracks = [];
            }
            this.showDashboard();
            return true;
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
        async fetchSets() { 
            const res = await fetch('/api/sets'); 
            this.sets = await res.json(); 
            this.syncFolderAssignments(); 
            this.updateFilteredSets();
        },
        async fetchLikes() { const res = await fetch('/api/tracks/likes'); this.likedTracks = await res.json(); },
        async fetchPurchases() { const res = await fetch('/api/tracks/purchases'); this.purchasedTracks = await res.json(); },
        async fetchProducerLikes() { const res = await fetch('/api/producers/likes'); this.favoriteProducers = await res.json(); },
        async fetchRescan() { const res = await fetch('/api/tracks/rescan_candidates'); this.rescanCandidates = await res.json(); },
        deriveYoutubeArtists(query = '') {
            const filter = query ? query.toLowerCase() : null;
            const names = new Set();

            this.likedTracks.forEach(track => {
                [track.artist, track.producer_name].forEach(name => {
                    if (!name) return;
                    const trimmed = name.trim();
                    if (!trimmed) return;
                    if (filter && !trimmed.toLowerCase().includes(filter)) return;
                    names.add(trimmed);
                });
            });

            return Array.from(names);
        },
        async fetchYoutube(artists = [], query = '') {
            const artistList = artists.length ? artists : this.deriveYoutubeArtists(query);

        const response = await fetch(url, config);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `Request failed: ${response.status}`);
        }
        try {
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    getSets() {
        return this.request('/sets');
    }

    getTracks(setId) {
        return this.request(`/sets/${setId}/tracks`);
    }

    getDashboard() {
        return this.request('/dashboard');
    }

    getFolders() {
        return this.request('/folders');
    }

    createFolder(name) {
        return this.request('/folders', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
    }

    assignSetToFolder(folderId, setId) {
        return this.request(`/folders/${folderId}/sets`, {
            method: 'POST',
            body: JSON.stringify({ set_id: setId })
        });
    }

    deleteSet(setId) {
        return this.request(`/sets/${setId}`, { method: 'DELETE' });
    }

    resolveMetadata(url) {
        return this.request('/resolve_metadata', {
            method: 'POST',
            body: JSON.stringify({ url })
        });
    }

    addToQueue(formData) {
        return this.request('/queue/add', {
            method: 'POST',
            body: formData
        });
    }
}

class AudioController {
    constructor(element) {
        this.audio = element;
        this.currentTrack = null;
        this.bindEvents();
    }

    bindEvents() {
        this.audio.addEventListener('ended', () => {
            this.currentTrack = null;
        });
    }

    async play(source) {
        if (!source) return;
        if (this.audio.src !== source) {
            this.audio.src = source;
        }
        this.currentTrack = source;
        await this.audio.play();
    }

    toggle(source) {
        if (this.currentTrack === source && !this.audio.paused) {
            this.audio.pause();
            return false;
        }
        this.play(source);
        return true;
    }
}

class UIManager {
    constructor(options) {
        this.gridEl = options.gridEl;
        this.tracklistEl = options.tracklistEl;
        this.folderListEl = options.folderListEl;
        this.trashZoneEl = options.trashZoneEl;
        this.searchInput = options.searchInput;
        this.statsEls = options.statsEls;
        this.setsListEl = options.setsListEl;
        this.toastStack = options.toastStack;
        this.activeSetTitle = options.activeSetTitle;
        this.emptyTracklist = options.emptyTracklist;
        this.uploadModal = options.uploadModal;
    }

    bindSetGridHandlers({ onSelect, onDragStart, onDragEnd }) {
        if (!this.gridEl) return;
        this.gridEl.addEventListener('click', (event) => {
            const card = event.target.closest('[data-set-id]');
            if (card && onSelect) {
                onSelect(card.dataset.setId);
            }
        });
        this.gridEl.addEventListener('dragstart', (event) => {
            const card = event.target.closest('[data-set-id]');
            if (card && onDragStart) {
                onDragStart(card.dataset.setId, event);
            }
        });
        this.gridEl.addEventListener('dragend', () => {
            if (onDragEnd) onDragEnd();
        });
    }

    bindFolderHandlers({ onFolderSelect, onDrop }) {
        if (!this.folderListEl) return;
        this.folderListEl.addEventListener('click', (event) => {
            const folder = event.target.closest('[data-folder-id]');
            if (folder && onFolderSelect) {
                onFolderSelect(folder.dataset.folderId);
            }
        });
        ['dragenter', 'dragover'].forEach((type) => {
            this.folderListEl.addEventListener(type, (event) => {
                const folder = event.target.closest('[data-folder-id]');
                if (folder) {
                    event.preventDefault();
                    folder.classList.add('is-hovered');
                }
            });
        });
        ['dragleave', 'drop'].forEach((type) => {
            this.folderListEl.addEventListener(type, (event) => {
                const folder = event.target.closest('[data-folder-id]');
                if (folder) folder.classList.remove('is-hovered');
            });
        });
        this.folderListEl.addEventListener('drop', (event) => {
            const folder = event.target.closest('[data-folder-id]');
            if (folder && onDrop) {
                event.preventDefault();
                onDrop(folder.dataset.folderId, event);
            }
        });
    }

    bindTrashHandlers(onDrop) {
        if (!this.trashZoneEl) return;
        ['dragenter', 'dragover'].forEach((type) => {
            this.trashZoneEl.addEventListener(type, (event) => {
                event.preventDefault();
                this.trashZoneEl.classList.add('is-hovered');
            });
        });
        ['dragleave', 'drop'].forEach((type) => {
            this.trashZoneEl.addEventListener(type, () => this.trashZoneEl.classList.remove('is-hovered'));
        });
        this.trashZoneEl.addEventListener('drop', (event) => {
            event.preventDefault();
            if (onDrop) onDrop(event);
        });
    }

    renderFolders(folders, activeFolderId) {
        if (!this.folderListEl) return;
        const frag = document.createDocumentFragment();
        folders.forEach((folder) => {
            const item = document.createElement('div');
            item.className = `folder ${activeFolderId === String(folder.id) ? 'is-hovered' : ''}`;
            item.dataset.folderId = folder.id;
            item.innerHTML = `
                <div class="meta">
                    <div class="name">${folder.name}</div>
                    <div class="count">${(folder.sets?.length || 0)} sets</div>
                </div>
                <span class="pill">${(folder.sets?.length || 0)}x</span>
            `;
            frag.appendChild(item);
        });
        if (!folders.length) {
            const empty = document.createElement('div');
            empty.className = 'hint';
            empty.textContent = 'No folders yet';
            frag.appendChild(empty);
        }
        this.folderListEl.replaceChildren(frag);
    }

    renderSetGrid(sets) {
        if (!this.gridEl) return;
        const frag = document.createDocumentFragment();
        sets.forEach((set) => frag.appendChild(this.createSetCard(set)));
        if (!sets.length) {
            const empty = document.createElement('div');
            empty.className = 'set-card';
            empty.style.display = 'flex';
            empty.style.alignItems = 'center';
            empty.style.justifyContent = 'center';
            empty.textContent = 'No sets yet';
            frag.appendChild(empty);
        }
        this.gridEl.replaceChildren(frag);
    }

    renderSetList(sets) {
        if (!this.setsListEl) return;
        const frag = document.createDocumentFragment();
        sets.forEach((set) => {
            const button = document.createElement('button');
            button.className = 'w-full text-left px-4 py-3 border-b last:border-b-0';
            button.dataset.setId = set.id;
            button.innerHTML = `
                <div class="flex items-center justify-between text-[12px] font-bold gap-2">
                    <div class="flex items-center gap-2 truncate">
                        <span class="truncate">${set.name}</span>
                    </div>
                    <span class="font-mono px-2 py-0.5 pill">${set.track_count || 0}</span>
                </div>
                <div class="text-[10px] muted">${this.formatDate(set.created_at)}</div>
            `;
            frag.appendChild(button);
        });
        if (!sets.length) {
            const empty = document.createElement('div');
            empty.className = 'hint';
            empty.style.padding = '12px 16px';
            empty.textContent = 'No sets yet';
            frag.appendChild(empty);
        }
        this.setsListEl.replaceChildren(frag);
    }

    renderTracks(tracks) {
        if (!this.tracklistEl) return;
        const frag = document.createDocumentFragment();
        tracks.forEach((track, index) => {
            const row = document.createElement('div');
            row.className = 'track';
            row.dataset.trackId = track.id;
            row.innerHTML = `
                <div class="pos">
                    <button class="icon-button" data-action="play-track" data-track-id="${track.id}" style="width:32px; height:32px; border-radius:10px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                    <span>${track.flag === 3 ? '???' : (track.position || index + 1)}</span>
                </div>
                <div class="names">
                    <div class="song">${track.title || 'Unknown Track'}</div>
                    <div class="artist">${track.artist || 'Unknown Artist'}</div>
                </div>
                <div class="names">
                    <div class="artist">Start</div>
                    <div class="song" style="font-size:13px;">${this.formatTime(track.start_time)}</div>
                </div>
                <div class="names">
                    <div class="artist">Confidence</div>
                    <div class="song" style="font-size:13px;">${this.formatConf(track.confidence)}</div>
                </div>
                <div class="controls">
                    <button class="ghost-button" data-action="purchase-track" data-track-id="${track.id}">${track.purchased ? 'Bought' : 'Buy'}</button>
                    <button class="ghost-button" data-action="like-track" data-track-id="${track.id}">${track.liked ? 'Liked' : 'Like'}</button>
                </div>
            `;
            frag.appendChild(row);
        });
        this.tracklistEl.replaceChildren(frag);
        if (this.emptyTracklist) {
            this.emptyTracklist.classList.toggle('is-hidden', tracks.length > 0);
        }
    }

    renderStats(stats = {}) {
        Object.entries(this.statsEls).forEach(([key, el]) => {
            if (!el) return;
            if (key === 'discovery_rate') {
                el.textContent = `${stats[key] ?? 0}%`;
            } else {
                el.textContent = stats[key] ?? 0;
            }
        });
    }

    updateActiveSetTitle(title) {
        if (this.activeSetTitle) {
            this.activeSetTitle.textContent = title || 'Select a set to view tracks';
        }
    }

    toggleUploadModal(visible) {
        if (!this.uploadModal) return;
        this.uploadModal.classList.toggle('is-hidden', !visible);
    }

    showToast(title, subtitle = '') {
        if (!this.toastStack) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<div class="title">${title}</div><div class="subtitle">${subtitle}</div>`;
        this.toastStack.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    createSetCard(set) {
        const card = document.createElement('div');
        card.className = 'set-card';
        card.dataset.setId = set.id;
        card.draggable = true;
        const thumbStyle = set.thumbnail ? `style="background-image:url(${set.thumbnail})"` : '';
        const fallback = (set.artists || set.dj_names || set.name || 'SET').slice(0, 6).toUpperCase();
        card.innerHTML = `
            <div class="set-thumb" ${thumbStyle}>
                ${set.thumbnail ? '' : `<div class="fallback">${fallback}</div>`}
            </div>
            <div class="set-meta">
                <div class="set-pill">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h6l2 3h8v9H4z"/></svg>
                    <span>${set.track_count || 0} tracks</span>
                </div>
                <div class="set-title">${set.name}</div>
                <div class="set-artist">${set.artists || set.dj_names || 'Unknown Artist'}</div>
            </div>
            <div class="set-footer">
                <span>${this.formatDate(set.created_at)}</span>
                <span>${set.event || 'Ready'}</span>
            </div>
        `;
        return card;
    }

    formatDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString();
    }

    formatTime(seconds) {
        if (!seconds && seconds !== 0) return '—';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }

    formatConf(conf) {
        if (conf === undefined || conf === null) return '—';
        return `${Math.round(conf * 100)}%`;
    }
}

class UploadManager {
    constructor(modalEl, api, ui) {
        this.modal = modalEl;
        this.api = api;
        this.ui = ui;
        this.inputs = {
            url: document.getElementById('upload-url'),
            artist: document.getElementById('upload-artist'),
            title: document.getElementById('upload-title'),
            event: document.getElementById('upload-event'),
            tags: document.getElementById('upload-tags'),
            b2b: document.getElementById('upload-b2b')
        };
    }

    bind() {
        document.querySelectorAll('[data-action="open-upload"]').forEach((btn) => btn.addEventListener('click', () => this.ui.toggleUploadModal(true)));
        document.querySelectorAll('[data-action="close-upload"]').forEach((btn) => btn.addEventListener('click', () => this.ui.toggleUploadModal(false)));
        const fetchBtn = document.querySelector('[data-action="fetch-metadata"]');
        if (fetchBtn) fetchBtn.addEventListener('click', () => this.fetchMetadata());
        const submitBtn = document.querySelector('[data-action="submit-upload"]');
        if (submitBtn) submitBtn.addEventListener('click', () => this.submit());
    }

    async fetchMetadata() {
        const url = this.inputs.url?.value?.trim();
        if (!url) return;
        try {
            const data = await this.api.resolveMetadata(url);
            if (data?.name && !this.inputs.title.value) this.inputs.title.value = data.name;
            if (data?.artist && !this.inputs.artist.value) this.inputs.artist.value = data.artist;
            if (data?.event && !this.inputs.event.value) this.inputs.event.value = data.event;
            this.ui.showToast('Metadata fetched', data?.name || '');
        } catch (e) {
            this.ui.showToast('Could not fetch metadata');
        }
    }

    async submit() {
        const url = this.inputs.url?.value?.trim();
        if (!url) {
            this.ui.showToast('Please provide a URL');
            return;
        }
        const metadata = {
            name: this.inputs.title?.value || '',
            artist: this.inputs.artist?.value || '',
            event: this.inputs.event?.value || '',
            tags: this.inputs.tags?.value || '',
            is_b2b: !!this.inputs.b2b?.checked
        };

        const formData = new FormData();
        formData.append('type', 'url');
        formData.append('value', url);
        formData.append('metadata', JSON.stringify(metadata));

        try {
            await this.api.addToQueue(formData);
            this.ui.toggleUploadModal(false);
            this.reset();
            this.ui.showToast('Import started', 'Added to queue');
        } catch (e) {
            this.ui.showToast('Failed to start import');
        }
    }

    reset() {
        Object.values(this.inputs).forEach((input) => {
            if (input?.type === 'checkbox') {
                input.checked = false;
            } else if (input) {
                input.value = '';
            }
        });
    }
}

class App {
    constructor() {
        const statsEls = {};
        document.querySelectorAll('[data-stat]').forEach((el) => {
            statsEls[el.dataset.stat] = el;
        });

        this.api = new API('/api');
        this.ui = new UIManager({
            gridEl: document.querySelector('[data-sets-grid]'),
            tracklistEl: document.getElementById('tracklist'),
            folderListEl: document.getElementById('folder-list'),
            trashZoneEl: document.getElementById('trash-zone'),
            searchInput: document.getElementById('set-search'),
            statsEls,
            setsListEl: document.getElementById('sets-list'),
            toastStack: document.getElementById('toast-stack'),
            activeSetTitle: document.getElementById('active-set-title'),
            emptyTracklist: document.getElementById('empty-tracklist'),
            uploadModal: document.getElementById('upload-modal')
        });
        this.audio = new AudioController(document.getElementById('audio-player'));
        this.uploads = new UploadManager(document.getElementById('upload-modal'), this.api, this.ui);

        this.sets = [];
        this.filteredSets = [];
        this.folders = [];
        this.activeFolderId = null;
        this.activeSetId = null;
        this.tracks = [];
        this.draggingSetId = null;

        this.onResize = debounce(() => this.refreshGrid(), 200);
        this.onSearch = debounce((value) => this.applyFilters(value), 200);
    }

    init() {
        this.bindEvents();
        this.refreshAll();
    }

    bindEvents() {
        this.ui.bindSetGridHandlers({
            onSelect: (id) => this.loadSet(id),
            onDragStart: (id, event) => this.handleDragStart(id, event),
            onDragEnd: () => this.handleDragEnd()
        });
        this.ui.bindFolderHandlers({
            onFolderSelect: (id) => this.selectFolder(id),
            onDrop: (folderId, event) => this.dropOnFolder(folderId, event)
        });
        this.ui.bindTrashHandlers((event) => this.dropOnTrash(event));

        const searchInput = this.ui.searchInput;
        if (searchInput) {
            searchInput.addEventListener('input', (event) => this.onSearch(event.target.value));
        }

        document.addEventListener('click', (event) => {
            const setButton = event.target.closest('#sets-list [data-set-id]');
            if (setButton) this.loadSet(setButton.dataset.setId);

            const trackButton = event.target.closest('[data-action="play-track"]');
            if (trackButton) this.toggleTrackPlayback(trackButton.dataset.trackId);

            const copyBtn = event.target.closest('[data-action="copy-tracklist"]');
            if (copyBtn) this.copyTracklist();

            const createFolderBtn = event.target.closest('[data-action="create-folder"]');
            if (createFolderBtn) this.createFolder();
        });

        window.addEventListener('resize', this.onResize);
        this.uploads.bind();
    }

    async refreshAll() {
        await Promise.all([this.loadSets(), this.loadDashboard(), this.loadFolders()]);
    }

    async loadSets() {
        try {
            const data = await this.api.getSets();
            this.sets = Array.isArray(data) ? data : (data?.sets || []);
            this.applyFilters(this.ui.searchInput?.value || '');
        } catch (e) {
            this.ui.showToast('Could not load sets');
        }
    }

    applyFilters(searchTerm = '') {
        const term = searchTerm.toLowerCase();
        this.filteredSets = this.sets.filter((set) => {
            const matchesSearch = !term || set.name?.toLowerCase().includes(term) || set.artists?.toLowerCase().includes(term);
            const matchesFolder = !this.activeFolderId || set.folder_id == this.activeFolderId || (set.folders && set.folders.includes(this.activeFolderId));
            return matchesSearch && matchesFolder;
        });
        this.refreshGrid();
    }

    refreshGrid() {
        this.ui.renderSetGrid(this.filteredSets);
        this.ui.renderSetList(this.filteredSets);
    }

    async loadSet(setId) {
        if (!setId) return;
        this.activeSetId = setId;
        try {
            const tracks = await this.api.getTracks(setId);
            this.tracks = Array.isArray(tracks) ? tracks : (tracks?.tracks || []);
            const set = this.sets.find((item) => String(item.id) === String(setId));
            this.ui.updateActiveSetTitle(set?.name || 'Set');
            this.ui.renderTracks(this.tracks);
        } catch (e) {
            this.ui.showToast('Could not load set');
        }
    }

    toggleTrackPlayback(trackId) {
        const track = this.tracks.find((t) => String(t.id) === String(trackId));
        if (!track || !track.preview_url) return;
        this.audio.toggle(track.preview_url);
    }

    async loadDashboard() {
        try {
            const data = await this.api.getDashboard();
            const stats = data?.stats || data || {};
            this.ui.renderStats(stats);
        } catch (e) {
            this.ui.showToast('Could not load dashboard');
        }
    }

    async loadFolders() {
        try {
            const data = await this.api.getFolders();
            this.folders = Array.isArray(data) ? data : (data?.folders || []);
            this.ui.renderFolders(this.folders, this.activeFolderId);
        } catch (e) {
            this.ui.renderFolders([], this.activeFolderId);
        }
    }

    selectFolder(folderId) {
        this.activeFolderId = this.activeFolderId === folderId ? null : folderId;
        this.ui.renderFolders(this.folders, this.activeFolderId);
        this.applyFilters(this.ui.searchInput?.value || '');
    }

    handleDragStart(setId, event) {
        this.draggingSetId = setId;
        if (event?.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', setId);
        }
    }

    handleDragEnd() {
        this.draggingSetId = null;
    }

    async dropOnFolder(folderId, event) {
        event.preventDefault();
        const setId = this.draggingSetId || event.dataTransfer?.getData('text/plain');
        if (!setId) return;
        try {
            await this.api.assignSetToFolder(folderId, setId);
            const targetSet = this.sets.find((s) => String(s.id) === String(setId));
            if (targetSet) targetSet.folder_id = folderId;
            this.ui.showToast('Set moved', 'Folder updated');
            this.applyFilters(this.ui.searchInput?.value || '');
            this.loadFolders();
        } catch (e) {
            this.ui.showToast('Could not move set');
        }
    }

    async dropOnTrash(event) {
        event.preventDefault();
        const setId = this.draggingSetId || event.dataTransfer?.getData('text/plain');
        if (!setId) return;
        if (!confirm('Delete this set?')) return;
        try {
            await this.api.deleteSet(setId);
            this.sets = this.sets.filter((s) => String(s.id) !== String(setId));
            this.applyFilters(this.ui.searchInput?.value || '');
            this.ui.showToast('Set deleted');
        } catch (e) {
            this.ui.showToast('Could not delete set');
        }
    }

    async createFolder() {
        const name = prompt('Folder name');
        if (!name) return;
        try {
            const created = await this.api.createFolder(name);
            const folder = created?.folder || created;
            if (folder) this.folders.unshift(folder);
            this.ui.renderFolders(this.folders, this.activeFolderId);
            this.ui.showToast('Folder created', folder?.name || '');
        } catch (e) {
            this.ui.showToast('Could not create folder');
        }
    }

    async copyTracklist() {
        if (!this.tracks.length) return;
        const lines = this.tracks.map((track, index) => `${index + 1}. ${track.artist || 'Unknown'} - ${track.title || 'Unknown'}`);
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            this.ui.showToast('Tracklist copied');
        } catch (e) {
            this.ui.showToast('Clipboard unavailable');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
