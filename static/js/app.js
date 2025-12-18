class AudioController {
    constructor(ctx) {
        this.ctx = ctx;
        this.progressEl = null;
        this.dragging = false;
        this.boundMove = (e) => this.handleSeekMove(e);
        this.boundEnd = (e) => this.stopSeek(e);
    }

    get player() {
        return this.ctx?.$refs?.player || null;
    }

    syncVolume() {
        if (this.player) this.player.volume = this.ctx.audio.volume;
    }

    registerProgressEl(el) {
        if (el) this.progressEl = el;
    }

    async playTrack(target) {
        const track = typeof target === 'object' ? target : null;
        const query = typeof target === 'string'
            ? target
            : (track?.streamUrl || track?.audio_file || track?.source_url || `${track?.artist || ''} ${track?.title || ''}`.trim());

        if (!query) {
            this.ctx.showToast('Keine Quelle', 'Track enthält keinen Stream.', 'error');
            return;
        }

        this.ctx.activeTrack = track || this.ctx.activeTrack;
        this.ctx.ui.loadingId = track?.id || null;
        this.ctx.audio.currentTime = 0;
        this.ctx.audio.progressPercent = 0;

        try {
            const url = await this.resolveUrl(query, track);
            await this.startPlayback(url, track);
            const label = track ? `${track.artist || 'Unknown'} - ${track.title || ''}` : 'Stream gestartet';
            this.ctx.showToast('Play', label.trim(), 'info');
        } catch (error) {
            this.ctx.ui.playingId = null;
            this.ctx.showToast('Playback Fehler', error?.message || 'Konnte Stream nicht laden.', 'error');
            throw error;
        } finally {
            this.ctx.ui.loadingId = null;
        }
    }

    async resolveUrl(query, track) {
        if (track?.streamUrl) return track.streamUrl;

        const res = await fetch('/api/resolve_audio', {
            method: 'POST',
            body: JSON.stringify({ query })
        });
        const data = await res.json();

        if (!res.ok || !data.ok || !data.url) {
            const message = data.error || 'Keine Quelle gefunden.';
            throw new Error(message);
        }

        if (track) track.streamUrl = data.url;
        return data.url;
    }

    async startPlayback(url, track) {
        const player = this.player;
        if (!player) return;

        player.src = url;
        this.syncVolume();

        try {
            await player.play();
            this.ctx.ui.playingId = track?.id || this.ctx.ui.playingId;
            this.ctx.audio.paused = false;
        } catch (error) {
            this.ctx.audio.paused = true;
            throw error;
        }
    }

    async toggle(track) {
        const player = this.player;
        if (!player) return;

        if (this.ctx.ui.playingId === track?.id && this.ctx.activeTrack) {
            if (player.paused) { await player.play(); this.ctx.audio.paused = false; }
            else { player.pause(); this.ctx.audio.paused = true; }
            return;
        }

        return this.playTrack(track);
    }

    handleTimeUpdate(event) {
        if (this.dragging) return;
        const { currentTime, duration, paused } = event.target;
        this.ctx.audio.currentTime = currentTime;
        this.ctx.audio.duration = duration;
        this.ctx.audio.progressPercent = duration ? (currentTime / duration) * 100 : 0;
        this.ctx.audio.paused = paused;
    }

    seekFromEvent(event, element = null) {
        const player = this.player;
        const target = element || this.progressEl || event?.currentTarget;
        if (!player || !target || !player.duration) return;

        const rect = target.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const nextTime = pct * player.duration;

        this.ctx.audio.progressPercent = pct * 100;
        this.ctx.audio.currentTime = nextTime;
        player.currentTime = nextTime;
    }

    startSeek(event) {
        this.progressEl = event?.currentTarget || this.progressEl;
        if (!this.player?.duration || !this.progressEl) return;

        this.dragging = true;
        this.seekFromEvent(event, this.progressEl);
        window.addEventListener('pointermove', this.boundMove);
        window.addEventListener('pointerup', this.boundEnd);
    }

    handleSeekMove(event) {
        if (!this.dragging) return;
        this.seekFromEvent(event, this.progressEl);
    }

    stopSeek(event) {
        if (!this.dragging) return;
        this.seekFromEvent(event, this.progressEl);
        this.dragging = false;
        window.removeEventListener('pointermove', this.boundMove);
        window.removeEventListener('pointerup', this.boundEnd);
    }

    handleEnded() {
        this.ctx.audio.paused = true;
        this.ctx.audio.progressPercent = 0;
        const advanced = this.next();
        if (!advanced) this.ctx.ui.playingId = null;
    }

    handleError() {
        this.ctx.ui.playingId = null;
        this.ctx.ui.loadingId = null;
        this.ctx.audio.paused = true;
        this.ctx.showToast('Playback Fehler', 'Audio konnte nicht geladen werden.', 'error');
    }

    next() {
        const queue = Array.isArray(this.ctx.tracks) ? this.ctx.tracks : [];
        if (!queue.length) return false;

        const currentId = this.ctx.ui.playingId || this.ctx.activeTrack?.id;
        const currentIndex = queue.findIndex(t => t.id === currentId);
        if (currentIndex === -1) return false;
        const nextIndex = currentIndex + 1;

        if (nextIndex >= 0 && nextIndex < queue.length) {
            this.playTrack(queue[nextIndex]);
            return true;
        }

        this.ctx.ui.playingId = null;
        this.ctx.audio.progressPercent = 0;
        return false;
    }

    previous() {
        const queue = Array.isArray(this.ctx.tracks) ? this.ctx.tracks : [];
        if (!queue.length) return false;

        const currentId = this.ctx.ui.playingId || this.ctx.activeTrack?.id;
        const currentIndex = queue.findIndex(t => t.id === currentId);
        if (currentIndex === -1) return false;

        if (currentIndex > 0) {
            this.playTrack(queue[currentIndex - 1]);
            return true;
        }

        if (this.player && this.player.currentTime > 2) {
            this.player.currentTime = 0;
            return true;
        }

        return false;
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
        folders: [],
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
            contextMenu: { show: false, x: 0, y: 0, type: null, target: null, folderTarget: null },
            detailPanel: { show: false, type: null, item: null }
        },
        audioController: null,
        
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

            this.audioController = new AudioController(this);

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
                if (this.audioController) {
                    this.audioController.syncVolume();
                    if (this.$refs.footerProgress) this.audioController.registerProgressEl(this.$refs.footerProgress);
                }
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
        openContextMenu(e, payload = {}) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            const { type = null, item = null, folderTarget = null } = payload;

            let x = e ? e.clientX : 0;
            let y = e ? e.clientY : 0;
            if (y > window.innerHeight - 240) y = Math.max(16, y - 200); // Overflow prevent

            this.ui.contextMenu = {
                show: true,
                x,
                y,
                type,
                target: item,
                folderTarget
            };
        },

        openSetContextMenu(e, set) {
            this.openContextMenu(e, { type: 'set', item: set });
        },

        closeContextMenu() {
            this.ui.contextMenu.show = false;
        },

        // Edit Modal
        openEditSetModal() {
            const set = this.ui.contextMenu.target;
            if (!set || this.ui.contextMenu.type !== 'set') return;
            this.closeContextMenu();
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

        async rescanSetContext() {
            const set = this.ui.contextMenu.target; 
            if (!set || this.ui.contextMenu.type !== 'set') return;
            this.closeContextMenu(); 
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

        async renameItem() {
            const { type, target } = this.ui.contextMenu;
            if (!target || !type) return;
            this.closeContextMenu();

            if (type === 'set') {
                const nextName = prompt("Neuer Name für das Set:", target.name);
                if (!nextName || nextName === target.name) return;
                await fetch(`/api/sets/${target.id}/rename`, {
                    method: 'POST',
                    body: JSON.stringify({ name: nextName })
                });
                this.fetchSets();
                if (this.activeSet && this.activeSet.id === target.id) this.activeSet.name = nextName;
                return;
            }

            if (type === 'track') {
                const nextTitle = prompt("Neuer Titel für den Track:", target.title || target.name || '');
                if (!nextTitle || nextTitle === target.title) return;
                await fetch(`/api/tracks/${target.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: nextTitle })
                });
                const track = this.tracks.find(t => t.id === target.id);
                if (track) track.title = nextTitle;
                this.likedTracks = this.likedTracks.map(t => t.id === target.id ? { ...t, title: nextTitle } : t);
            }
        },

        async deleteItem() {
            const { type, target } = this.ui.contextMenu;
            if (!target || !type) return;
            this.closeContextMenu();

            if (type === 'set') {
                if (!confirm(`Set "${target.name}" wirklich löschen?`)) return;
                await fetch(`/api/sets/${target.id}`, { method: 'DELETE' });
                this.sets = this.sets.filter(s => s.id !== target.id);
                this.filteredSets = this.filteredSets.filter(s => s.id !== target.id);
                if (this.activeSet && this.activeSet.id === target.id) {
                    this.activeSet = null;
                    this.tracks = [];
                }
                this.showDashboard();
                return;
            }

            if (type === 'track') {
                if (!confirm(`Track "${target.title || target.name}" löschen?`)) return;
                await fetch(`/api/tracks/${target.id}`, { method: 'DELETE' });
                this.tracks = this.tracks.filter(t => t.id !== target.id);
                this.likedTracks = this.likedTracks.filter(t => t.id !== target.id);
                this.purchasedTracks = this.purchasedTracks.filter(t => t.id !== target.id);

                if (this.activeSet && this.activeSet.track_count !== undefined && this.activeSet.track_count > 0) {
                    this.activeSet.track_count -= 1;
                }
                const idx = this.sets.findIndex(s => this.activeSet && s.id === this.activeSet.id);
                if (idx >= 0 && this.sets[idx].track_count > 0) {
                    this.sets[idx].track_count -= 1;
                    this.filteredSets = [...this.sets];
                }
            }
        },

        moveItemToFolder(folder) {
            const { target, type } = this.ui.contextMenu;
            if (!target || !type) return;
            this.ui.contextMenu.folderTarget = folder;
            this.closeContextMenu();
            target.folder = folder;
            const label = type === 'set' ? target.name : (target.title || target.name || 'Track');
            this.showToast('Verschoben', `${label} -> ${folder.name || folder}`, 'info');
        },

        showDetails(item = null, type = null) {
            const detailItem = item || this.ui.contextMenu.target;
            const detailType = type || this.ui.contextMenu.type;
            if (!detailItem || !detailType) return;
            this.closeContextMenu();
            this.ui.detailPanel = { show: true, type: detailType, item: detailItem };
        },

        closeDetailPanel() {
            this.ui.detailPanel = { show: false, type: null, item: null };
        },

        // =====================================================================
        // AUDIO PLAYER & PRELOADER
        // =====================================================================
        updateVolume(e) {
            const val = parseFloat(e.target.value);
            this.audio.volume = val;
            if(this.$refs.player) this.$refs.player.volume = val;
            if (this.audioController) this.audioController.syncVolume();
            localStorage.setItem('tracklistify_volume', val);
        },
        
        async togglePlay(track) {
            if (!track) return;
            if (this.audioController) return this.audioController.toggle(track);
        },
        
        togglePlayPauseGlobal() {
            if (!this.activeTrack && !this.ui.playingId) return;
            const current = this.tracks.find(t => t.id === this.ui.playingId) || this.activeTrack;
            if (current && this.audioController) return this.audioController.toggle(current);
            if (!this.audioController && this.$refs.player) {
                const player = this.$refs.player;
                if (player.paused) { player.play(); this.audio.paused = false; }
                else { player.pause(); this.audio.paused = true; }
            }
        },
        
        updateProgress(e) {
            if (this.audioController) return this.audioController.handleTimeUpdate(e);
            const { currentTime, duration } = e.target;
            this.audio.currentTime = currentTime;
            this.audio.duration = duration;
            this.audio.progressPercent = (currentTime / duration) * 100 || 0;
            this.audio.paused = e.target.paused;
        },
        
        seekGlobal(e) {
            if (this.audioController) this.audioController.seekFromEvent(e, e.currentTarget);
        },
        
        seek(e, track) {
            if (!track) return;
            const player = this.$refs.player;
            if (this.ui.playingId !== track.id) {
                this.togglePlay(track).then(() => {
                    if (this.audioController) this.audioController.seekFromEvent(e, e.currentTarget);
                });
                return;
            }

            if (this.audioController && player?.duration) this.audioController.seekFromEvent(e, e.currentTarget);
        },

        startProgressDrag(e) { if (this.audioController) this.audioController.startSeek(e); },
        dragProgress(e) { if (this.audioController) this.audioController.handleSeekMove(e); },
        endProgressDrag(e) { if (this.audioController) this.audioController.stopSeek(e); },
        playNextInQueue() { if (this.audioController) this.audioController.next(); },
        playPreviousInQueue() { if (this.audioController) this.audioController.previous(); },

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
        async fetchSets() { const res = await fetch('/api/sets'); this.sets = await res.json(); this.filteredSets = this.sets; this.deriveFoldersFromSets(); },
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

        deriveFoldersFromSets() {
            const folderNames = new Set();
            this.sets.forEach(set => {
                if (set.tags) {
                    set.tags.split(',')
                        .map(t => t.trim())
                        .filter(Boolean)
                        .forEach(name => folderNames.add(name));
                }
            });
            this.folders = Array.from(folderNames).map(name => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name }));
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
        });
        this.folderListEl.addEventListener('drop', (event) => {
            const folder = event.target.closest('[data-folder-id]');
            if (folder && onDrop) {
                event.preventDefault();
                onDrop(folder.dataset.folderId, event);
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
        onAudioEnded() { if (this.audioController) this.audioController.handleEnded(); else { this.ui.playingId = null; this.audio.progressPercent = 0; this.audio.paused = true; } },
        onAudioPaused() { this.audio.paused = true; },
        onAudioPlaying() { this.audio.paused = false; },
        onAudioError() { if (this.audioController) this.audioController.handleError(); else { this.ui.playingId = null; this.ui.loadingId = null; } },
        
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
        
        cleanLogMessage(msg) {
            const parts = msg.split(' - ');
            const level = parts[0]?.toLowerCase();

            if (parts.length >= 3 && ['info', 'debug', 'warning', 'error'].includes(level)) {
                return parts.slice(2).join(' - ').trim();
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
