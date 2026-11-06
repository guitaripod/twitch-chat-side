const HOST_NAME = 'com.guitaripod.twitch_chat_side';
const TWITCH_TABS = 'https://www.twitch.tv/*';

let port = null;
let hostWindows = null;
const sentScreens = new Map();

/**
 * Starts the native host, which reports the monitor each Twitch window is on, unless it is already running.
 */
function connectHost() {
  if (port) return;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener(message => {
    hostWindows = message.windows ?? [];
    pushScreens();
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    port = null;
    hostWindows = null;
    pushScreens();
  });
}

/**
 * The monitor a browser window is on, found by matching its active tab's title against the window captions the host reports. Null while unknown or ambiguous.
 */
function screenForWindow(windowId, activeTitles) {
  const title = activeTitles.get(windowId);
  if (!title || !hostWindows) return null;
  const matches = hostWindows.filter(window => window.caption.startsWith(`${title} - `));
  return matches.length === 1 ? matches[0].screen : null;
}

/**
 * The active tab title of every browser window.
 */
async function activeTitlesByWindow() {
  const active = await chrome.tabs.query({ active: true });
  return new Map(active.map(tab => [tab.windowId, tab.title]));
}

/**
 * Tells each Twitch tab its window's monitor when that changes, keeping the last known one while it cannot be determined, and clears it when the host stops.
 */
async function pushScreens() {
  const tabs = await chrome.tabs.query({ url: TWITCH_TABS });
  const activeTitles = await activeTitlesByWindow();
  for (const tab of tabs) {
    const screen = hostWindows ? screenForWindow(tab.windowId, activeTitles) : null;
    if (hostWindows && !screen) continue;
    if (sentScreens.get(tab.id) === screen) continue;
    sentScreens.set(tab.id, screen);
    chrome.tabs.sendMessage(tab.id, { tcsideScreen: screen }).catch(() => sentScreens.delete(tab.id));
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.tcsideHello || !sender.tab) return false;
  sentScreens.delete(sender.tab.id);
  connectHost();
  activeTitlesByWindow().then(activeTitles => {
    const screen = screenForWindow(sender.tab.windowId, activeTitles);
    if (screen) sentScreens.set(sender.tab.id, screen);
    sendResponse({ tcsideScreen: screen });
  });
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => sentScreens.delete(tabId));
