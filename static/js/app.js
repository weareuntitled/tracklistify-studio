const debounce = (fn, delay = 200) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
};

class API {
    constructor(base = '/api') {
        this.base = base;
    }

    async request(path, options = {}) {
        const url = `${this.base}${path}`;
        const config = { headers: {}, ...options };
        if (config.body && !(config.body instanceof FormData)) {
            config.headers['Content-Type'] = 'application/json';
        }

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
