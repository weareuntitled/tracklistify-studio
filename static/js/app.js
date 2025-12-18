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
        cardHoverId: null,

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
            contextMenu: { show: false, x: 0, y: 0, target: null, type: null },
            trackViewOnly: false,
            draggingProgress: false
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
            if (!this.ensureAuthenticated()) return;

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

            const res = await fetch('/api/queue/add', { method: 'POST', body: fd });
            if (res.status === 401) return this.ensureAuthenticated();

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
                this.handleLiveLog(status);

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
            this.ui.trackViewOnly = false;
        },
        
        showQueueView() { 
            this.currentView = 'queue'; 
            this.activeSet = null; 
            this.ui.showLikes = false; 
            this.ui.trackViewOnly = false;
        },
        
        showRescanView() {
            this.currentView = 'rescan';
            this.activeSet = null;
            this.fetchRescan();
            this.ui.showLikes = false;
            this.ui.trackViewOnly = false;
        },

        showLikesView() {
            this.currentView = 'likes';
            this.ui.showLikes = false;
            this.fetchLikes();
            this.fetchPurchases();
            this.fetchProducerLikes();
            this.ui.trackViewOnly = false;
        },

        showCollections() {
            this.currentView = 'collections';
            this.fetchLikes();
            this.ui.trackViewOnly = false;
        },

        showSetView(set) {
            this.loadSet(set);
        },
        focusOnSet(setOrId) {
            this.ui.trackViewOnly = true;
            this.loadSet(setOrId);
        },
        resetTrackView() {
            this.ui.trackViewOnly = false;
            this.currentView = 'sets';
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
            this.ui.trackViewOnly = true;

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

        handleContextAction(action) {
            const { type, target } = this.ui.contextMenu;
            if (!target || !type) return;
            this.closeContextMenu();

            if (type === 'set') {
                if (action === 'edit') return this.openEditSetModal(target);
                if (action === 'rename') return this.promptRenameSet(target);
                if (action === 'move') return this.promptMoveSet(target);
                if (action === 'rescan') return this.rescanSetContext(target);
                if (action === 'delete') return this.confirmAndDeleteSet(target);
            }

            if (type === 'folder') {
                if (action === 'rename') return this.renameFolderContext(target);
                if (action === 'delete') return this.deleteFolderContext(target);
            }
        },

        // Edit Modal
        openEditSetModal(target = null) {
            const set = target || this.ui.contextMenu.target;
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

        async promptRenameSet(set = this.ui.contextMenu.target) {
            if (!set) return;
            const n = prompt("Neuer Name für das Set:", set.name);
            if(!n || n === set.name) return;

            await fetch(`/api/sets/${set.id}/rename`, { 
                method: 'POST', body: JSON.stringify({name: n}) 
            }); 
            this.fetchSets(); 
            if(this.activeSet && this.activeSet.id === set.id) this.activeSet.name = n;
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
                this.ui.trackViewOnly = false;
            }

            this.syncFolderAssignments();
            this.showDashboard();
            return true;
        },

        async deleteSetContext(set = this.ui.contextMenu.target) {
            this.closeContextMenu();
            await this.confirmAndDeleteSet(set);
        },

        async rescanSetContext(set = this.ui.contextMenu.target) {
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

        promptMoveSet(set = this.ui.contextMenu.target) {
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
            const nextTime = pct * player.duration;
            player.currentTime = nextTime;
            this.audio.currentTime = nextTime;
            this.audio.duration = player.duration;
            this.audio.progressPercent = pct * 100;
        },
        
        seek(e, track) {
            // Scrubbing in der Liste
            const player = this.$refs.player;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const pct = Math.max(0, Math.min(1, x / rect.width));
            
            if (this.ui.playingId === track.id) {
                if (player.duration) {
                    const nextTime = pct * player.duration;
                    player.currentTime = nextTime;
                    this.audio.currentTime = nextTime;
                    this.audio.duration = player.duration;
                    this.audio.progressPercent = pct * 100;
                }
            } else {
                this.togglePlay(track).then(() => {
                    if (player.duration) {
                        const nextTime = pct * player.duration;
                        player.currentTime = nextTime;
                        this.audio.currentTime = nextTime;
                        this.audio.duration = player.duration;
                        this.audio.progressPercent = pct * 100;
                    }
                });
            }
        },

        startProgressDrag(e) {
            this.ui.draggingProgress = true;
            this.seekGlobal(e);
        },

        dragProgress(e) {
            if (!this.ui.draggingProgress) return;
            this.seekGlobal(e);
        },

        endProgressDrag(e) {
            if (!this.ui.draggingProgress) return;
            this.seekGlobal(e);
            this.ui.draggingProgress = false;
        },

        playNextInQueue() {
            const queue = Array.isArray(this.tracks) ? this.tracks : [];
            if (!queue.length) return;
            const currentId = this.ui.playingId || this.activeTrack?.id;
            const currentIndex = queue.findIndex(t => t.id === currentId);
            const nextIndex = currentIndex >= 0 && currentIndex < queue.length - 1 ? currentIndex + 1 : 0;
            const nextTrack = queue[nextIndex];
            if (nextTrack) this.togglePlay(nextTrack);
        },

        playPreviousInQueue() {
            const queue = Array.isArray(this.tracks) ? this.tracks : [];
            if (!queue.length) return;
            const currentId = this.ui.playingId || this.activeTrack?.id;
            const currentIndex = queue.findIndex(t => t.id === currentId);
            let prevIndex = currentIndex > 0 ? currentIndex - 1 : queue.length - 1;
            if (currentIndex === -1) prevIndex = queue.length - 1;
            const prevTrack = queue[prevIndex];
            if (prevTrack) this.togglePlay(prevTrack);
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

            if (!artistList.length) {
                this.youtubeFeed = [];
                return;
            }

            const params = new URLSearchParams();
            params.set('artists', artistList.join(','));
            if (query) params.set('q', query);

            try {
                const res = await fetch(`/api/youtube/feeds?${params.toString()}`);
                const data = await res.json();
                if (res.ok && data.ok) {
                    this.youtubeFeed = data.items || [];
                } else {
                    this.youtubeFeed = [];
                    if (data.error) this.showToast('YouTube Feed', data.error, 'warning');
                }
            } catch (e) {
                this.youtubeFeed = [];
            }
        },
        async refreshEngagementFeeds(query = '') {
            await Promise.all([
                this.fetchDashboard(),
                this.fetchYoutube([], query)
            ]);
        },
        async fetchProfile() {
            try {
                const res = await fetch('/api/auth/profile');
                if (res.ok) {
                    const data = await res.json();
                    if (data.ok) this.auth.user = data.user;
                } else if (res.status === 401) {
                    this.auth.user = null;
                }
            } catch(e) {}
        },
        async submitAuth() {
            const url = this.auth.mode === 'login' ? '/api/auth/login' : '/api/auth/register';
            this.auth.error = '';
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.auth.form)
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                this.auth.user = data.user;
                this.auth.form = { email: '', password: '', name: '' };
                this.auth.dropdownOpen = false;
                const name = data.user.name || data.user.dj_name || data.user.email;
                this.showToast('Angemeldet', name, 'info');
            } else {
                this.auth.error = data.error || 'Fehler';
            }
        },
        async logout() {
            await fetch('/api/auth/logout', { method: 'POST' });
            this.auth.user = null;
            this.auth.dropdownOpen = false;
        },

        ensureAuthenticated() {
            if (this.auth.user) return true;
            const next = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login?next=${next}`;
            return false;
        },

        async saveProfile() {
            if (!this.ensureAuthenticated()) return;

            const fd = new FormData();
            fd.append('display_name', this.profile.display_name || '');
            fd.append('dj_name', this.profile.dj_name || '');
            fd.append('soundcloud_url', this.profile.soundcloud_url || '');
            if (this.$refs.avatarInput && this.$refs.avatarInput.files[0]) {
                fd.append('avatar', this.$refs.avatarInput.files[0]);
            }

            const res = await fetch('/api/auth/profile', { method: 'POST', body: fd });
            const data = await res.json();
            if (res.ok && data.ok) {
                this.profile.avatar_url = data.avatar_url || this.profile.avatar_url;
                this.ui.showProfileModal = false;
            }
        },

        async openAdmin() {
            if (!this.ensureAuthenticated()) return;
            await this.loadAdminUsers();
            this.admin.show = true;
        },

        async loadAdminUsers() {
            const res = await fetch('/api/users');
            const data = await res.json();
            if (res.ok && data.ok) {
                this.admin.users = data.users || [];
            }
        },

        async inviteUser() {
            if (!this.ensureAuthenticated()) return;
            const payload = { username: this.admin.invite.username, password: this.admin.invite.password };
            const res = await fetch('/api/users/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await res.json();
            if (res.ok && data.ok) {
                this.admin.invite.generated = data.password;
                this.admin.invite.username = '';
                this.admin.invite.password = '';
                await this.loadAdminUsers();
            }
        },

        async deleteUser(userId) {
            if (!this.ensureAuthenticated()) return;
            await fetch(`/api/users/${userId}`, { method: 'DELETE' });
            await this.loadAdminUsers();
        },

        async toggleLike(track) {
            if (!this.ensureAuthenticated()) return;

            track.liked = !track.liked;
            // Update Local List
            if (!track.liked) {
                this.likedTracks = this.likedTracks.filter(t => t.id !== track.id);
            } else if (!this.likedTracks.find(t => t.id === track.id)) {
                this.likedTracks.push({ ...track, set_name: track.set_name || (this.activeSet ? this.activeSet.name : track.set_name) });
            }

            await fetch(`/api/tracks/${track.id}/like`, {
                method: 'POST',
                body: JSON.stringify({liked: track.liked ? 1 : 0})
            });

            if (this.currentView === 'collections') this.fetchLikes();
        },

        async togglePurchase(track) {
            track.purchased = !track.purchased;

            if (!track.purchased) {
                this.purchasedTracks = this.purchasedTracks.filter(t => t.id !== track.id);
            }

            await fetch(`/api/tracks/${track.id}/purchase`, {
                method: 'POST',
                body: JSON.stringify({purchased: track.purchased ? 1 : 0})
            });

            this.fetchPurchases();
        },

        // =====================================================================
        // FOLDER MANAGEMENT
        // =====================================================================
        defaultFolderName() {
            return `Ordner ${ (this.folders?.length || 0) + 1 }`;
        },

        resetFolderForm() {
            this.folderForm.name = this.defaultFolderName();
        },

        updateFilteredSets() {
            const searchTerm = (this.search || '').toLowerCase();
            let scopedSets = Array.isArray(this.sets) ? [...this.sets] : [];

            if (this.activeFolderId) {
                const activeFolder = (this.folders || []).find(folder => folder.id === this.activeFolderId);
                if (!activeFolder) {
                    this.activeFolderId = null;
                } else {
                    const allowedIds = new Set((activeFolder.sets || []).map(item => typeof item === 'object' ? item.id : item));
                    scopedSets = scopedSets.filter(set => allowedIds.has(set.id));
                }
            }

            if (searchTerm) {
                scopedSets = scopedSets.filter(set => set.name.toLowerCase().includes(searchTerm));
            }

            this.filteredSets = scopedSets;
        },

        toggleFolderForm() {
            this.folderForm.open = !this.folderForm.open;
            if (this.folderForm.open) this.resetFolderForm();
        },

        selectFolder(folder) {
            this.activeFolderId = this.activeFolderId === folder.id ? null : folder.id;
            this.updateFilteredSets();
        },

        async loadFolders() {
            try {
                const res = await fetch('/api/folders');
                if (res.ok) {
                    const data = await res.json();
                    const payload = Array.isArray(data) ? data : (data.folders || []);
                    this.updateFoldersFromServer(payload);
                    return;
                }
            } catch (e) {}

            const cached = localStorage.getItem('tracklistify_folders');
            this.ensureFolderStructure(cached ? JSON.parse(cached) : []);
            this.syncFolderAssignments();
            this.resetFolderForm();
        },

        ensureFolderStructure(folders = this.folders) {
            const normalized = (folders || []).map(folder => {
                const fallbackId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const rawId = folder.id ?? fallbackId;
                const normalizedId = (typeof rawId === 'string' && rawId.startsWith('local-')) 
                    ? rawId 
                    : (!Number.isNaN(Number(rawId)) ? Number(rawId) : rawId);
                const sets = Array.from(new Set((folder.sets || []).map(item => typeof item === 'object' ? item.id : item))).filter(Boolean);
                return {
                    ...folder,
                    id: normalizedId,
                    name: folder.name || 'Ordner',
                    sets
                };
            });
            this.folders = normalized;
            return normalized;
        },

        persistFoldersLocally() {
            try {
                localStorage.setItem('tracklistify_folders', JSON.stringify(this.folders));
            } catch (e) {}
        },

        removeSetFromFolders(setId) {
            if (!this.folders || !setId) return;
            this.folders.forEach(folder => {
                folder.sets = (folder.sets || []).filter(id => id !== setId);
            });
            this.persistFoldersLocally();
        },

        async assignSetToFolder(set, folder) {
            if (!set || !folder) return;

            (this.folders || []).forEach(f => {
                f.sets = (f.sets || []).filter(id => id !== set.id);
            });

            folder.sets = folder.sets || [];
            if (!folder.sets.includes(set.id)) folder.sets.push(set.id);
            set.folder_id = folder.id;

            try {
                await fetch(`/api/folders/${folder.id}/sets`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ set_id: set.id }) 
                });
            } catch (e) {}

            this.persistFoldersLocally();
        },

        syncFolderAssignments() {
            if (!this.sets || !this.sets.length) return;

            this.ensureFolderStructure();
            const setMap = new Map(this.sets.map(s => [s.id, s]));
            this.sets.forEach(set => set.folder_id = null);

            (this.folders || []).forEach(folder => {
                folder.sets = Array.from(new Set((folder.sets || []).map(item => typeof item === 'object' ? item.id : item).filter(id => setMap.has(id))));
                folder.sets.forEach(setId => {
                    const target = setMap.get(setId);
                    if (target) target.folder_id = folder.id;
                });
            });

            this.persistFoldersLocally();
            this.updateFilteredSets();
        },

        async createFolder() {
            const name = (this.folderForm.name || '').trim() || this.defaultFolderName();
            const optimisticId = `local-${Date.now()}`;
            const optimisticFolder = { id: optimisticId, name, sets: [] };
            this.folders = [optimisticFolder, ...this.folders];
            this.ensureFolderStructure();
            this.persistFoldersLocally();
            this.activeFolderId = optimisticId;
            this.updateFilteredSets();
            let created = null;

            try {
                const res = await fetch('/api/folders', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ name }) 
                });
                if (res.ok) {
                    const data = await res.json();
                    created = data.folder || data;
                    created.sets = created.sets || [];
                    this.folders = this.folders.map(folder => folder.id === optimisticId ? created : folder);
                    this.activeFolderId = created.id;
                    this.ensureFolderStructure();
                    this.syncFolderAssignments();
                }
            } catch (e) {}

            if (created) this.ensureFolderStructure([created, ...this.folders]);
            this.syncFolderAssignments();
            this.persistFoldersLocally();
        },

        updateFoldersFromServer(folders) {
            this.ensureFolderStructure(folders);
            this.syncFolderAssignments();
            this.persistFoldersLocally();
        },

        applyFolderAssignment(folderId, setId) {
            const targetId = !Number.isNaN(Number(folderId)) ? Number(folderId) : folderId;
            this.folders = (this.folders || []).map(folder => {
                const normalizedSets = new Set((folder.sets || []).map(item => typeof item === 'object' ? item.id : item));
                normalizedSets.delete(setId);
                if (folder.id === targetId) normalizedSets.add(setId);
                return { ...folder, sets: Array.from(normalizedSets) };
            });

            const targetSet = this.sets.find(s => s.id === setId);
            if (targetSet) targetSet.folder_id = targetId;
            if (this.activeSet && this.activeSet.id === setId) this.activeSet.folder_id = targetId;
        },

        onDragSet(set, event) {
            this.draggingSet = set;
            this.folderHoverId = null;
            if (event && event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', set.id);
                event.dataTransfer.setData('application/json', JSON.stringify({ setId: set.id }));
            }
        },

        onDragEnd() {
            this.draggingSet = null;
            this.folderHoverId = null;
            this.trashHover = false;
            this.cardHoverId = null;
        },

        setCardClasses(set) {
            return {
                'is-dragging': this.draggingSet && this.draggingSet.id === set.id,
                'is-drop-target': this.cardHoverId === set.id
            };
        },

        onCardDragEnter(set) {
            this.cardHoverId = set?.id || null;
        },

        onCardDragLeave(set) {
            if (this.cardHoverId === (set?.id || null)) this.cardHoverId = null;
        },

        onCardDragOver(event) {
            if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        },

        onCardDrop(set, event) {
            event.preventDefault();
            this.cardHoverId = null;
            const target = set || this.resolveDraggedSet(event);
            if (target) this.focusOnSet(target);
            this.onDragEnd();
        },

        resolveDraggedSet(event) {
            if (this.draggingSet) return this.draggingSet;
            const dataTransfer = event?.dataTransfer;
            if (!dataTransfer) return null;

            const json = dataTransfer.getData('application/json');
            if (json) {
                try {
                    const payload = JSON.parse(json);
                    const payloadId = payload.setId ?? payload.set_id ?? payload.id;
                    const numericId = !Number.isNaN(Number(payloadId)) ? Number(payloadId) : payloadId;
                    if (payloadId) {
                        return this.sets.find(s => s.id === numericId) || { id: numericId };
                    }
                } catch (e) {}
            }

            const text = dataTransfer.getData('text/plain');
            const idFromText = parseInt(text, 10);
            if (idFromText) return this.sets.find(s => s.id === idFromText) || { id: idFromText };
            return null;
        },

        onFolderDragEnter(folder, event) {
            event.preventDefault();
            this.draggingSet = this.draggingSet || this.resolveDraggedSet(event);
            this.folderHoverId = folder.id;
        },

        onFolderDragLeave(folder) {
            if (this.folderHoverId === folder.id) this.folderHoverId = null;
        },

        onFolderDragOver(event) {
            event.preventDefault();
            if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        },

        async onDropToFolder(folder, event) {
            event.preventDefault();
            const dragged = this.resolveDraggedSet(event);
            const resolvedSet = dragged ? (this.sets.find(s => s.id === dragged.id) || dragged) : null;
            this.draggingSet = null;
            this.folderHoverId = null;
            this.cardHoverId = null;
            if (!resolvedSet) return;
            await this.assignSetToFolder(resolvedSet, folder);
        },

        async renameFolderContext(folder = this.ui.contextMenu.target) {
            this.closeContextMenu();
            if (!folder) return;
            const next = prompt('Ordner umbenennen', folder.name) || folder.name;
            if (next === folder.name) return;
            folder.name = next;

            try {
                const res = await fetch(`/api/folders/${folder.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: next })
                });
                if (res && res.ok) {
                    const data = await res.json();
                    if (data.folders) this.updateFoldersFromServer(data.folders);
                }
            } catch (e) {}
            this.persistFoldersLocally();
        },

        onTrashDragEnter(event) {
            event.preventDefault();
            this.draggingSet = this.draggingSet || this.resolveDraggedSet(event);
            this.trashHover = true;
        },

        onTrashDragLeave() {
            this.trashHover = false;
        },

        async onDropToTrash(event) {
            event.preventDefault();
            const set = this.resolveDraggedSet(event);
            this.draggingSet = null;
            this.folderHoverId = null;
            this.trashHover = false;
            this.cardHoverId = null;
            if (!set) return;
            await this.deleteSet(set, { prompt: true });
        },

        async deleteFolderContext(folder = this.ui.contextMenu.target) {
            this.closeContextMenu();
            if (!folder) return;

            if (!confirm(`Ordner "${folder.name}" löschen?`)) return;

            this.folders = (this.folders || []).filter(f => f.id !== folder.id);
            this.sets.forEach(set => {
                if (set.folder_id === folder.id) set.folder_id = null;
            });

            try {
                await fetch(`/api/folders/${folder.id}`, { method: 'DELETE' });
            } catch (e) {}

            this.persistFoldersLocally();
        },

        isProducerFavorite(producerId) {
            if (!producerId) return false;
            return this.favoriteProducers.some(p => p.id === producerId);
        },

        async toggleProducerFavorite(item) {
            const producerId = item?.producer_id || item?.id;
            if (!producerId) return;

            const currentFavorite = this.isProducerFavorite(producerId);
            const nextStatus = !currentFavorite;

            await fetch(`/api/producers/${producerId}/like`, {
                method: 'POST',
                body: JSON.stringify({ liked: nextStatus ? 1 : 0 })
            });

            await this.fetchProducerLikes();
        },
        
        async toggleFlag(track) {
            if (!this.ensureAuthenticated()) return;

            const newFlag = track.flag === 3 ? 0 : 3;
            track.flag = newFlag;
            
            await fetch(`/api/tracks/${track.id}/flag`, {
                method: 'POST',
                body: JSON.stringify({flag: newFlag})
            }).then(res => { if (res.status === 401) this.ensureAuthenticated(); });
            this.fetchRescan();
        },

        async runRescan() {
            if (!this.ensureAuthenticated()) return;

            if(!confirm("Alle markierten Tracks neu verarbeiten?")) return;
            await fetch('/api/tracks/rescan_run', { method: 'POST' }).then(res => { if (res.status === 401) this.ensureAuthenticated(); });
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

        statHighlights() {
            return [
                { key: 'sets', label: 'SETS', value: this.dashboardStats.total_sets || 0 },
                { key: 'tracks', label: 'TRACKS', value: this.dashboardStats.total_tracks || 0 },
                { key: 'likes', label: 'LIKES', value: this.dashboardStats.total_likes || 0 },
                { key: 'discovery', label: 'DISCOVERY', value: (this.dashboardStats.discovery_rate || 0) + '%' }
            ];
        },

        hasSetThumbnail(set) {
            return Boolean(set?.thumbnail || set?.thumbnail_url);
        },

        setCardBackground(set) {
            const thumb = set?.thumbnail || set?.thumbnail_url;
            if (!thumb) return '';
            return `background-image: linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55)), url('${thumb}')`;
        },

        setFolderLabel(set) {
            if (!set?.folder_id) return 'NO FOLDER';
            const match = (this.folders || []).find(f => f.id === set.folder_id);
            return match ? match.name : 'NO FOLDER';
        },

        setProgress(set) {
            const candidates = [set?.progress, set?.analysis_progress, set?.completion, set?.percent_complete];
            const explicit = candidates.find(v => v !== undefined && v !== null);
            if (explicit !== undefined) {
                const numeric = Number(explicit);
                if (!Number.isNaN(numeric)) return Math.max(4, Math.min(100, numeric));
            }

            const count = Number(set?.track_count || 0);
            if (count > 0) {
                return Math.min(100, 30 + Math.min(count, 24) * 3);
            }
            return 12;
        },
        
        cleanLogMessage(msg) {
            const parts = msg.split(' - ');
            const level = parts[0]?.toLowerCase();

            if (parts.length >= 3 && ['info', 'debug', 'warning', 'error'].includes(level)) {
                return parts.slice(2).join(' - ').trim();
            }

            return msg;
        },

        handleLiveLog(status) {
            if (!status.active) {
                this.lastLogLine = '';
                return;
            }

            if (!status.active.log) return;

            const currentLog = status.active.log.trim();
            if (currentLog === this.lastLogLine) return;
            this.lastLogLine = currentLog;

            const cleanMsg = this.cleanLogMessage(currentLog.replace(/\[.*?\]/g, '').trim());
            const lower = cleanMsg.toLowerCase();

            if (lower.includes('soundcloud profile') || lower.includes('dj profile')) {
                this.showToast('DJ verknüpft', cleanMsg, 'dj');
                return;
            }

            if (lower.includes('beatport profile') || lower.includes('producer')) {
                this.showToast('Producer gefunden', cleanMsg, 'producer');
                return;
            }

            if (lower.includes('artist profile') || lower.includes('artist page') || lower.includes('profil')) {
                this.showToast('Artist-Profil', cleanMsg, 'artist');
                return;
            }

            if (lower.includes('download:')) {
                this.showToast('Download gestartet', status.active.label, 'info');
                return;
            }

            if (lower.includes('identifying segment')) {
                const match = cleanMsg.match(/(\d+(?:\.\d+)?)s/);
                const seconds = match ? parseFloat(match[1]) : null;
                const prettyTime = seconds !== null ? this.formatTime(seconds) : null;
                const subtitle = prettyTime ? `Analysiere Segment bei ${prettyTime}` : 'Analysiere Segment...';
                this.showToast('Analyse läuft', subtitle, 'info');
                return;
            }

            if (
                lower.includes('identified') ||
                lower.includes('track match') ||
                (lower.includes('found') && lower.includes('track')) ||
                cleanMsg.includes('=>')
            ) {
                this.showToast('Track erkannt', cleanMsg, 'track');
            }
        },
        
        getSearchLink(track, provider) {
             const q = encodeURIComponent(`${track.artist} ${track.title}`);
             const map = {
                 youtube: `https://www.youtube.com/results?search_query=${q}`,
                 beatport: track.beatport_url || `https://www.beatport.com/search?q=${q}`,
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
