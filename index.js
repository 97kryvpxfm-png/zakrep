import { chat, chat_metadata, eventSource, event_types } from '/script.js';
import { saveMetadataDebounced } from '/scripts/extensions.js';

const MODULE_NAME = 'zakrep';
const METADATA_KEY = 'pinnedMessages';
const PANEL_ID = 'stpm-panel';
const LIST_ID = 'stpm-list';
const HIGHLIGHT_CLASS = 'stpm-highlight';
const MESSAGE_PINNED_CLASS = 'stpm-message-pinned';
const ACTIVE_INDEX_KEY = 'pinnedMessagesActiveIndex';
const LIST_OPEN_KEY = 'pinnedMessagesListOpen';

let renderTimer = null;

function ensurePinsArray() {
    if (!Array.isArray(chat_metadata[METADATA_KEY])) {
        chat_metadata[METADATA_KEY] = [];
    }

    return chat_metadata[METADATA_KEY];
}

function getActiveIndex() {
    const value = Number(chat_metadata[ACTIVE_INDEX_KEY]);
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

function setActiveIndex(index, save = false) {
    chat_metadata[ACTIVE_INDEX_KEY] = Math.max(0, Number(index) || 0);

    if (save) {
        saveMetadataDebounced();
    }
}

function isListOpen() {
    return Boolean(chat_metadata[LIST_OPEN_KEY]);
}

function setListOpen(value, save = false) {
    chat_metadata[LIST_OPEN_KEY] = Boolean(value);

    if (save) {
        saveMetadataDebounced();
    }
}

function normalizePin(pin) {
    if (!pin || typeof pin !== 'object') {
        return null;
    }

    const messageId = Number(pin.messageId);

    return {
        messageId: Number.isInteger(messageId) ? messageId : -1,
        sendDate: pin.sendDate ? String(pin.sendDate) : '',
        name: pin.name ? String(pin.name) : '',
        textSnapshot: pin.textSnapshot ? String(pin.textSnapshot) : '',
    };
}

function getPlainMessageText(message) {
    const sourceText = String(message?.extra?.display_text || message?.mes || '');
    return $('<div>').html(sourceText).text().replace(/\s+/g, ' ').trim();
}

function getMessageSnapshot(message) {
    return getPlainMessageText(message).slice(0, 220);
}

function getMessagePreview(message) {
    const text = getPlainMessageText(message);
    return text ? text.slice(0, 140) : '[Empty message]';
}

function isPinMatch(message, pin) {
    if (!message) {
        return false;
    }

    if (pin.sendDate && message.send_date === pin.sendDate) {
        return true;
    }

    if (pin.name && pin.textSnapshot) {
        return message.name === pin.name && getMessageSnapshot(message) === pin.textSnapshot;
    }

    return false;
}

function resolvePin(pin) {
    const directMessage = chat[pin.messageId];

    if (directMessage && isPinMatch(directMessage, pin)) {
        return { messageId: pin.messageId, message: directMessage };
    }

    const bySendDate = pin.sendDate
        ? chat.findIndex(message => message?.send_date === pin.sendDate)
        : -1;

    if (bySendDate >= 0) {
        return { messageId: bySendDate, message: chat[bySendDate] };
    }

    const bySnapshot = pin.name && pin.textSnapshot
        ? chat.findIndex(message => message?.name === pin.name && getMessageSnapshot(message) === pin.textSnapshot)
        : -1;

    if (bySnapshot >= 0) {
        return { messageId: bySnapshot, message: chat[bySnapshot] };
    }

    return null;
}

function getResolvedPins() {
    const pins = ensurePinsArray().map(normalizePin).filter(Boolean);
    const resolvedPins = [];
    const uniqueKeys = new Set();
    let changed = pins.length !== ensurePinsArray().length;

    for (const pin of pins) {
        const resolved = resolvePin(pin);

        if (!resolved) {
            changed = true;
            continue;
        }

        const normalizedPin = {
            messageId: resolved.messageId,
            sendDate: resolved.message?.send_date ? String(resolved.message.send_date) : pin.sendDate,
            name: resolved.message?.name ? String(resolved.message.name) : pin.name,
            textSnapshot: getMessageSnapshot(resolved.message) || pin.textSnapshot,
        };

        const uniqueKey = normalizedPin.sendDate || `${normalizedPin.name}:${normalizedPin.textSnapshot}`;

        if (!uniqueKey || uniqueKeys.has(uniqueKey)) {
            changed = true;
            continue;
        }

        uniqueKeys.add(uniqueKey);
        resolvedPins.push({
            ...normalizedPin,
            message: resolved.message,
        });

        if (
            normalizedPin.messageId !== pin.messageId
            || normalizedPin.sendDate !== pin.sendDate
            || normalizedPin.name !== pin.name
            || normalizedPin.textSnapshot !== pin.textSnapshot
        ) {
            changed = true;
        }
    }

    if (changed) {
        chat_metadata[METADATA_KEY] = resolvedPins.map(({ message, ...pin }) => pin);
        saveMetadataDebounced();
    }

    return resolvedPins;
}

function isPinnedMessage(messageId) {
    return getResolvedPins().some(pin => pin.messageId === messageId);
}

function getPanelAnchor() {
    return document.querySelector('#top-settings-holder');
}

function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);

    if (panel) {
        return panel;
    }

    const anchor = getPanelAnchor();

    if (!anchor) {
        return null;
    }

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'stpm-panel';
    panel.innerHTML = `
        <div class="stpm-panel-inner">
            <div class="stpm-accent"></div>
            <button type="button" class="stpm-summary" id="${LIST_ID}"></button>
            <div class="stpm-controls">
                <button type="button" class="stpm-list-toggle fa-solid fa-list" title="Show pinned messages"></button>
            </div>
        </div>
        <div class="stpm-dropdown stpm-hidden"></div>
    `;

    anchor.insertAdjacentElement('afterend', panel);
    return panel;
}

function getMessageElement(messageId) {
    return document.querySelector(`#chat .mes[mesid="${messageId}"]`);
}

function scrollToMessage(messageId) {
    const messageElement = getMessageElement(messageId);

    if (!messageElement) {
        return;
    }

    messageElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
    });

    messageElement.classList.remove(HIGHLIGHT_CLASS);
    void messageElement.offsetWidth;
    messageElement.classList.add(HIGHLIGHT_CLASS);

    setTimeout(() => {
        messageElement.classList.remove(HIGHLIGHT_CLASS);
    }, 1800);
}

function createPinButton(messageId) {
    const button = document.createElement('div');
    button.className = 'mes_button stpm-toggle fa-solid fa-thumbtack';
    button.dataset.messageId = String(messageId);
    return button;
}

function renderMessageButtons(resolvedPins) {
    const pinnedIds = new Set(resolvedPins.map(pin => pin.messageId));

    document.querySelectorAll('#chat .mes[mesid]').forEach(messageElement => {
        const messageId = Number(messageElement.getAttribute('mesid'));
        const extraButtons = messageElement.querySelector('.extraMesButtons');

        if (!extraButtons || !Number.isInteger(messageId)) {
            return;
        }

        let pinButton = extraButtons.querySelector('.stpm-toggle');

        if (!pinButton) {
            pinButton = createPinButton(messageId);
            const copyButton = extraButtons.querySelector('.mes_copy');

            if (copyButton) {
                copyButton.insertAdjacentElement('beforebegin', pinButton);
            } else {
                extraButtons.append(pinButton);
            }
        }

        pinButton.dataset.messageId = String(messageId);

        const isPinned = pinnedIds.has(messageId);
        pinButton.classList.toggle('stpm-active', isPinned);
        pinButton.title = isPinned ? 'Unpin message' : 'Pin message';
        messageElement.classList.toggle(MESSAGE_PINNED_CLASS, isPinned);
    });
}

function renderDropdown(panel, resolvedPins, activeIndex) {
    const dropdown = panel.querySelector('.stpm-dropdown');

    if (!dropdown) {
        return;
    }

    dropdown.innerHTML = '';
    dropdown.classList.toggle('stpm-hidden', !isListOpen() || !resolvedPins.length);

    if (dropdown.classList.contains('stpm-hidden')) {
        return;
    }

    for (const [index, pin] of resolvedPins.entries()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'stpm-dropdown-item';
        item.dataset.messageId = String(pin.messageId);
        item.dataset.pinIndex = String(index);
        item.title = `Jump to pinned message #${pin.messageId}`;

        if (index === activeIndex) {
            item.classList.add('stpm-dropdown-item-active');
        }

        item.innerHTML = `
            <span class="stpm-dropdown-name">${pin.message?.name || pin.name || 'Message'}</span>
            <span class="stpm-dropdown-text">${getMessagePreview(pin.message)}</span>
            <span class="stpm-dropdown-meta">#${pin.messageId}</span>
        `;

        dropdown.append(item);
    }
}

function renderPanelList(panel, resolvedPins) {
    const summary = panel.querySelector(`#${LIST_ID}`);
    const listButton = panel.querySelector('.stpm-list-toggle');

    if (!summary || !listButton) {
        return;
    }

    if (!resolvedPins.length) {
        panel.classList.add('stpm-hidden');
        return;
    }

    panel.classList.remove('stpm-hidden');
    const normalizedIndex = Math.min(getActiveIndex(), resolvedPins.length - 1);
    const activePin = resolvedPins[normalizedIndex];

    setActiveIndex(normalizedIndex);

    summary.dataset.messageId = String(activePin.messageId);
    summary.title = `Jump to pinned message #${activePin.messageId}`;
    summary.innerHTML = `
        <span class="stpm-title">Pinned Message</span>
        <span class="stpm-item-name">${activePin.message?.name || activePin.name || 'Message'}</span>
        <span class="stpm-item-text">${getMessagePreview(activePin.message)}</span>
        <span class="stpm-counter">${normalizedIndex + 1}/${resolvedPins.length}</span>
    `;

    listButton.classList.toggle('stpm-list-toggle-active', isListOpen());
    renderDropdown(panel, resolvedPins, normalizedIndex);
}

function render() {
    const panel = ensurePanel();
    const resolvedPins = getResolvedPins();

    renderMessageButtons(resolvedPins);

    if (!panel) {
        return;
    }

    renderPanelList(panel, resolvedPins);
}

function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 30);
}

function savePins(pins) {
    chat_metadata[METADATA_KEY] = pins;

    if (!pins.length) {
        setActiveIndex(0);
    } else if (getActiveIndex() >= pins.length) {
        setActiveIndex(pins.length - 1);
    }

    saveMetadataDebounced();
    scheduleRender();
}

function pinMessage(messageId) {
    const message = chat[messageId];

    if (!message) {
        return;
    }

    const pins = getResolvedPins().map(({ message: _message, ...pin }) => pin);
    const alreadyPinned = pins.some(pin => resolvePin(pin)?.messageId === messageId);

    if (alreadyPinned) {
        return;
    }

    pins.push({
        messageId,
        sendDate: message.send_date ? String(message.send_date) : '',
        name: message.name ? String(message.name) : '',
        textSnapshot: getMessageSnapshot(message),
    });

    setActiveIndex(pins.length - 1);
    savePins(pins);
}

function unpinMessage(messageId) {
    const pins = getResolvedPins()
        .filter(pin => pin.messageId !== messageId)
        .map(({ message, ...pin }) => pin);

    savePins(pins);
}

function togglePin(messageId) {
    if (isPinnedMessage(messageId)) {
        unpinMessage(messageId);
    } else {
        pinMessage(messageId);
    }
}

function onTogglePinClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const messageId = Number(event.currentTarget.dataset.messageId || event.currentTarget.closest('.mes')?.getAttribute('mesid'));

    if (!Number.isInteger(messageId)) {
        return;
    }

    togglePin(messageId);
}

function onJumpClick(event) {
    event.preventDefault();

    const messageId = Number(event.currentTarget.dataset.messageId);
    const resolvedPins = getResolvedPins();

    if (!Number.isInteger(messageId)) {
        return;
    }

    scrollToMessage(messageId);
    setListOpen(false);

    if (resolvedPins.length > 1) {
        const currentIndex = Math.min(getActiveIndex(), resolvedPins.length - 1);
        const nextIndex = (currentIndex + 1) % resolvedPins.length;
        setActiveIndex(nextIndex, true);
    } else {
        setActiveIndex(0, true);
    }

    scheduleRender();
}

function onListToggleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    setListOpen(!isListOpen(), true);
    scheduleRender();
}

function onDropdownItemClick(event) {
    event.preventDefault();

    const messageId = Number(event.currentTarget.dataset.messageId);
    const pinIndex = Number(event.currentTarget.dataset.pinIndex);

    if (!Number.isInteger(messageId) || !Number.isInteger(pinIndex)) {
        return;
    }

    setActiveIndex(pinIndex, true);
    setListOpen(false, true);
    scrollToMessage(messageId);

    const resolvedPins = getResolvedPins();

    if (resolvedPins.length > 1) {
        const nextIndex = (pinIndex + 1) % resolvedPins.length;
        setActiveIndex(nextIndex, true);
    }

    scheduleRender();
}

function handleChatScroll() {
    const chatElement = document.getElementById('chat');
    const resolvedPins = getResolvedPins();

    if (!chatElement || !resolvedPins.length) {
        return;
    }

    const distanceFromBottom = chatElement.scrollHeight - chatElement.scrollTop - chatElement.clientHeight;

    if (distanceFromBottom < 80) {
        const lastIndex = resolvedPins.length - 1;

        if (getActiveIndex() !== lastIndex || isListOpen()) {
            setActiveIndex(lastIndex);
            setListOpen(false);
            scheduleRender();
        }
    }
}

function initEvents() {
    $(document).on('click', '.stpm-toggle', onTogglePinClick);
    $(document).on('click', '.stpm-summary', onJumpClick);
    $(document).on('click', '.stpm-list-toggle', onListToggleClick);
    $(document).on('click', '.stpm-dropdown-item', onDropdownItemClick);
    $(document).on('click', function (event) {
        if (!$(event.target).closest(`#${PANEL_ID}`).length && isListOpen()) {
            setListOpen(false);
            scheduleRender();
        }
    });

    const rerenderEvents = [
        event_types.APP_READY,
        event_types.CHAT_CHANGED,
        event_types.MESSAGE_UPDATED,
        event_types.MESSAGE_EDITED,
        event_types.MESSAGE_DELETED,
        event_types.MESSAGE_SWIPED,
        event_types.MESSAGE_SWIPE_DELETED,
        event_types.USER_MESSAGE_RENDERED,
        event_types.CHARACTER_MESSAGE_RENDERED,
        event_types.MORE_MESSAGES_LOADED,
    ];

    for (const eventType of rerenderEvents) {
        eventSource.on(eventType, scheduleRender);
    }

    $(document).on('scroll', '#chat', handleChatScroll);
}

initEvents();
scheduleRender();

console.debug(`[${MODULE_NAME}] Loaded`);
