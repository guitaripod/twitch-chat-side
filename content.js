(() => {
  const SETTING = 'layout.swap-sidebars';
  const SCREEN_SIDES = [
    { label: /ULTRAGEAR/i, side: 'left' },
    { label: /Odyssey Ark|LG TV/i, side: 'right' },
  ];
  const AUTO_PROFILE_NAME = 'Twitch Chat Side (monitor)';
  const HEADER_SELECTOR = '.right-column .stream-chat-header';
  const COLUMN_SELECTOR = '.right-column';
  const BELOW_CLASS = 'right-column--below';
  const COMMUNITY_SELECTOR = '[data-test-selector="chat-viewer-list"]';
  const COLLAPSE_SELECTOR = '[data-a-target="right-column__toggle-collapse-btn"]';
  const CLONED_ATTRIBUTES = ['data-a-target', 'data-test-selector', 'aria-describedby', 'aria-expanded', 'aria-haspopup', 'aria-pressed'];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_PATH = 'M21.414 7l-4.707-4.707-1.414 1.414L17.586 6H3v2h14.586l-2.293 2.293 1.414 1.414L21.414 7Zm-18.828 10l4.707-4.707 1.414 1.414L6.414 16H21v2H6.414l2.293 2.293-1.414 1.414L2.586 17Z';
  const LABEL_TO_LEFT = 'Move Chat Left';
  const LABEL_TO_RIGHT = 'Move Chat Right';
  const READY_POLL_MS = 250;
  const READY_TIMEOUT_MS = 60000;

  let settings = null;
  let shell = null;
  let button = null;
  let tooltip = null;
  let scheduled = false;
  let screens = null;
  let screensPending = false;
  let autoProfile = null;
  let autoKey = null;
  let observedColumn = null;
  const columnObserver = new MutationObserver(() => schedule());

  /**
   * FFZ's settings manager once FFZ has enabled it, otherwise null.
   */
  function readySettings() {
    const manager = window.ffz?.resolve?.('settings');
    return manager?.enabled ? manager : null;
  }

  /**
   * Whether FFZ currently shows chat on the left.
   */
  function isSwapped() {
    return Boolean(settings.get(SETTING));
  }

  /**
   * The FFZ profile to write to: the one whose value is in effect, else the highest-priority active profile, else this tab's own profile when the user has switched every profile off, so a click always takes effect and FFZ's own menu stays in sync.
   */
  function targetProfile() {
    const ids = [...(settings.uses(SETTING) ?? []), ...(settings.main_context?.order ?? [])];
    for (const id of ids) {
      const profile = settings.profile(id);
      if (profile) return profile;
    }
    return ensureAutoProfile();
  }

  /**
   * Flips FFZ's Swap Sidebars setting, and asks to follow the monitor while the click's user gesture lets the permission prompt show.
   */
  function toggle() {
    targetProfile().set(SETTING, !isSwapped());
    watchScreens();
  }

  /**
   * The side configured for a monitor, or null when no rule names it.
   */
  function sideForScreen(label) {
    return SCREEN_SIDES.find(rule => rule.label.test(label))?.side ?? null;
  }

  /**
   * Whether chat sits beside the player rather than below it.
   */
  function isLandscapeLayout(column) {
    return Boolean(column) && !column.classList.contains(BELOW_CLASS) && !settings.get('layout.use-portrait');
  }

  /**
   * Watches the chat column's classes, which is where Twitch marks chat moving below the player.
   */
  function observeColumn(column) {
    if (column === observedColumn) return;
    columnObserver.disconnect();
    if (column) columnObserver.observe(column, { attributes: true, attributeFilter: ['class'] });
    observedColumn = column;
  }

  /**
   * A per-tab FFZ profile above the saved ones, so the monitor's side never leaks into other windows or FFZ's saved settings.
   */
  function ensureAutoProfile() {
    if (!autoProfile) {
      autoProfile = settings.createProfile({ ephemeral: true, name: AUTO_PROFILE_NAME });
      selectProfiles(autoProfile);
    }
    return autoProfile;
  }

  /**
   * Makes FFZ pick up a new profile, which it only does when a profile is toggled.
   */
  function selectProfiles(profile) {
    profile.toggled = false;
    profile.toggled = true;
  }

  /**
   * Applies the current monitor's side when the monitor or the layout changes, leaving manual flips alone in between.
   */
  function applyScreenSide() {
    const column = document.querySelector(COLUMN_SELECTOR);
    observeColumn(column);
    const label = screens?.currentScreen?.label ?? '';
    const landscape = isLandscapeLayout(column);
    const key = `${label}|${landscape}`;
    if (key === autoKey) return;
    autoKey = key;
    const side = landscape ? sideForScreen(label) : null;
    if (side) ensureAutoProfile().set(SETTING, side === 'left');
    else if (autoProfile?.has(SETTING)) autoProfile.delete(SETTING);
  }

  /**
   * Starts following which monitor the window is on, which needs the window-management permission.
   */
  function watchScreens() {
    if (screens || screensPending || !window.getScreenDetails) return;
    screensPending = true;
    window.getScreenDetails()
      .then(details => {
        screens = details;
        screens.addEventListener('currentscreenchange', applyScreenSide);
        applyScreenSide();
      })
      .catch(() => {})
      .finally(() => {
        screensPending = false;
      });
  }

  /**
   * Follows the monitor once the permission is granted. A request made outside a click can stay pending without any visible prompt, so asking waits for the button.
   */
  function requestScreens() {
    navigator.permissions?.query({ name: 'window-management' })
      .then(status => {
        if (status.state === 'granted') watchScreens();
        status.addEventListener('change', () => {
          if (status.state === 'granted') watchScreens();
        });
      })
      .catch(() => {});
  }

  /**
   * Builds the button from a clone of a native chat icon button so it carries Twitch's current styling.
   */
  function build(native) {
    const wrapper = native.parentElement;
    shell = wrapper.matches(HEADER_SELECTOR) ? document.createElement('div') : wrapper.cloneNode(false);
    shell.classList.add('tcside-shell');
    button = native.cloneNode(true);
    for (const name of CLONED_ATTRIBUTES) button.removeAttribute(name);
    button.classList.add('tcside-button');
    button.type = 'button';
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICON_PATH);
    button.querySelector('svg')?.replaceChildren(path);
    button.addEventListener('click', toggle);
    tooltip = document.createElement('div');
    tooltip.className = 'tcside-tooltip';
    tooltip.setAttribute('aria-hidden', 'true');
    shell.append(button, tooltip);
    render();
  }

  /**
   * Labels the button with the side chat moves to next.
   */
  function render() {
    if (!button) return;
    const label = isSwapped() ? LABEL_TO_RIGHT : LABEL_TO_LEFT;
    button.setAttribute('aria-label', label);
    tooltip.textContent = label;
  }

  /**
   * The header item the button goes right of: the Community button's wrapper, whose left-side tooltip would otherwise cover the button.
   */
  function anchorIn(header) {
    const community = header.querySelector(COMMUNITY_SELECTOR);
    if (!community) return null;
    return community.parentElement === header ? community : community.parentElement;
  }

  /**
   * Whether the button already sits in the header, after the anchor when there is one.
   */
  function isPlaced(header, anchor) {
    if (!shell.isConnected || !header.contains(shell)) return false;
    if (!anchor) return true;
    return anchor.parentElement === shell.parentElement && Boolean(anchor.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  /**
   * Places the button right of the anchor, or at the end of the header's button group when there is none.
   */
  function place(header, anchor) {
    if (anchor) {
      anchor.after(shell);
      return;
    }
    const group = header.lastElementChild;
    (group && !group.matches('button') ? group : header).append(shell);
  }

  /**
   * Keeps the button in the current chat header, and out of pages where swapping does not apply.
   */
  function ensureButton() {
    const header = document.querySelector(HEADER_SELECTOR);
    if (!header || settings.get('context.isWatchParty')) {
      shell?.remove();
      return;
    }
    if (!shell) {
      const native = document.querySelector(COLLAPSE_SELECTOR) ?? header.querySelector(COMMUNITY_SELECTOR);
      if (!native?.parentElement) return;
      build(native);
    }
    const anchor = anchorIn(header);
    if (!isPlaced(header, anchor)) place(header, anchor);
  }

  /**
   * Brings the monitor's side and the button up to date with the page.
   */
  function update() {
    scheduled = false;
    applyScreenSide();
    ensureButton();
  }

  /**
   * Coalesces DOM churn into one update per frame.
   */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }

  /**
   * Hooks into FFZ and the page once FFZ's settings are ready, unless FFZ runs with profiles disabled and no setting can change.
   */
  function start(manager) {
    if (manager.disable_profiles) return;
    settings = manager;
    settings.onChange(SETTING, render);
    settings.onChange('layout.use-portrait', schedule);
    settings.main_context?.on?.('context_changed', schedule);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    requestScreens();
    schedule();
  }

  /**
   * Waits for FFZ to finish loading, giving up after a minute when FFZ is not installed.
   */
  function waitForFfz(startedAt) {
    const manager = readySettings();
    if (manager) start(manager);
    else if (performance.now() - startedAt < READY_TIMEOUT_MS) setTimeout(waitForFfz, READY_POLL_MS, startedAt);
  }

  waitForFfz(performance.now());
})();
