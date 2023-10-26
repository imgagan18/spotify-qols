// @ts-check
/// <reference path="../globals.d.ts" />

(async function discover() {
  // #region Global Values

  let maxTries = 200;
  const maxTriesBumpLimit = 4;
  const retryWaitMS = 300; // 0.3 * 1000
  const namespace = "explore";
  const statusKey = `${namespace}:status`;
  const exploredKey = `${namespace}:explored`;
  const hotkeysNS = `${namespace}:hotkeys`;
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const defaultMod = isMac ? "meta" : "ctrl";
  const readIntervalMS = 100; // 0.1 * 1000
  const trackProgressThresholdMS = 30 * 1000;
  const editTimeoutAfter = 3 * 1000;
  const trackIDRe = /^[a-zA-Z0-9]{18,26}$/; // Has some length leeway
  const modifiers = ["Control", "Shift", "Alt", "Meta"];

  // App data (with defaults)
  let isEnabled = true;
  let exploredTracks = [];
  const allHotkeys = {
    discovery: {
      combo: `${defaultMod}+d`,
      editButton: null,
      displayElement: null,
      action: onBarButtonPress,
      description: "Toggle discovery mode",
      previousCombo: null,
    },
  };

  // #endregion

  // #region Mousetrap Utils

  /* eslint-disable */
  const MAP = {
    8: "backspace",
    9: "tab",
    13: "enter",
    16: "shift",
    17: "ctrl",
    18: "alt",
    20: "capslock",
    27: "esc",
    32: "space",
    33: "pageup",
    34: "pagedown",
    35: "end",
    36: "home",
    37: "left",
    38: "up",
    39: "right",
    40: "down",
    45: "ins",
    46: "del",
    91: "meta",
    93: "meta",
    224: "meta",
  };

  const KEYCODE_MAP = {
    106: "*",
    107: "+",
    109: "-",
    110: ".",
    111: "/",
    186: ";",
    187: "=",
    188: ",",
    189: "-",
    190: ".",
    191: "/",
    192: "`",
    219: "[",
    220: "\\",
    221: "]",
    222: "'",
  };

  /**
   * takes the event and returns the key character
   *
   * @param {KeyboardEvent} e
   * @return {string}
   */
  function characterFromEvent(e) {
    // for keypress events we should return the character as is
    if (e.type === "keypress") {
      let character = String.fromCharCode(e.which);

      // if the shift key is not pressed then it is safe to assume
      // that we want the character to be lowercase.  this means if
      // you accidentally have caps lock on then your key bindings
      // will continue to work
      //
      // the only side effect that might not be desired is if you
      // bind something like 'A' cause you want to trigger an
      // event when capital A is pressed caps lock will no longer
      // trigger the event.  shift+a will though.
      if (!e.shiftKey) {
        character = character.toLowerCase();
      }

      return character;
    }

    // for non keypress events the special maps are needed
    if (MAP[e.which]) {
      return MAP[e.which];
    }

    if (KEYCODE_MAP[e.which]) {
      return KEYCODE_MAP[e.which];
    }

    // if it is not in the special map

    // with keydown and keyup events the character seems to always
    // come in as an uppercase character whether you are pressing shift
    // or not.  we should make sure it is always lowercase for comparisons
    return String.fromCharCode(e.which).toLowerCase();
  }
  /* eslint-enable */

  // #endregion

  // #region Utils

  /**
   * Sleep for the provided number of milliseconds.
   * @returns {Promise<void>}
   * @param {number} ms The number of milliseconds to sleep for.
   * @see https://stackoverflow.com/a/39914235/6828099
   */
  function sleep(ms) {
    // eslint-disable-next-line no-promise-executor-return
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Enum for log levels.
   * @readonly
   * @enum {string}
   */
  const Level = {
    TRACE: "TRACE",
    DEBUG: "DEBUG",
    INFO: "INFO",
    WARNING: "WARNING",
  };

  /**
   * Format and log a message to the console.
   * Also display it as a notifaction in Spotify if its a warning or an error.
   * @param {Level} level The level of the log.
   * @param {string} message The message to log.
   * @returns {void}
   * @todo Add a report button to the UI for warnings and errors.
   */
  function log(level, message) {
    /* eslint-disable no-console */
    console.log(`[${level}] ${message}`);
    if (level === Level.WARNING) {
      Spicetify.showNotification(`track-explorer ${level}: ${message}.`);
    }
    /* eslint-enable no-console */
  }

  /**
   * Doesn't resolve until the required Spicetify methods are loaded.
   * @returns {Promise<void>}
   */
  async function waitUntilReady() {
    let initTries = 1;
    let bumpCount = 0;
    log(Level.TRACE, "Waiting until Spicetify is loaded.");

    for (;;) {
      const spiceDependencies = [
        Spicetify?.React,
        Spicetify?.LocalStorage?.get,
        Spicetify?.LocalStorage?.set,
        Spicetify?.Player?.getProgress,
        Spicetify?.Player?.isPlaying,
        Spicetify?.Player?.next,
        Spicetify?.URI?.fromString,
        Spicetify?.showNotification,
        Spicetify?.Playbar?.Button,
        Spicetify?.SVGIcons?.search,
        Spicetify?.SVGIcons?.check,
        Spicetify?.Platform?.ClipboardAPI?.paste,
        Spicetify?.Mousetrap?.bind,
        Spicetify?.Mousetrap?.unbind,
      ];

      if (spiceDependencies.every((dep) => dep)) {
        log(Level.TRACE, `Took ${initTries} try/tries to load Spicetify`);
        return;
      }

      if (initTries < maxTries) {
        await sleep(retryWaitMS);
        initTries += 1;
      } else if (bumpCount < maxTriesBumpLimit) {
        // The notification may fail, but we want to still at least log
        // this to the console.
        bumpCount += 1;
        log(Level.WARNING, `Spicetify hasn't loaded after ${maxTries} try/tries.`);
        maxTries *= 2;
      } else {
        throw new Error("Spicetify couldn't load.");
      }
    }
  }

  /**
   * Asserts that the provided value is not null or undefined.
   * @param {*} val
   * @returns {*} The same value
   * @throws {Error} If the value is null or undefined.
   */
  function check(val) {
    if (val === null || val === undefined) {
      throw new Error("An internal assertion has failed.");
    }
    return val;
  }

  /**
   * Asserts that the provided track IDs are most probably valid Spotify IDs.
   * @param {*} trackIDs The track IDs to check.
   * @returns {boolean} Whether or not the track IDs are valid.
   */
  function areValidTrackIDs(trackIDs) {
    // ensure that the track IDs are strings
    return (
      Array.isArray(trackIDs) &&
      trackIDs.every((trackID) => typeof trackID === "string" && trackIDRe.test(trackID))
    );
  }

  // #endregion

  await waitUntilReady();

  // #region Local Storage

  /**
   * Save the current enabled status into local storage.
   * This function must be called any time the enabled status is modified.
   * Also syncs the state of the playbar button.
   * @returns {void}
   */
  function syncEnabledData() {
    Spicetify.LocalStorage.set(statusKey, JSON.stringify(isEnabled));
    syncBarButtonState();
  }

  /**
   * Save the current explored tracks into local storage.
   * This function must be called any time the explored tracks are modified.
   * @returns {void}
   */
  function syncExploredData() {
    Spicetify.LocalStorage.set(exploredKey, JSON.stringify(exploredTracks));
  }

  /**
   * Save the current hotkey data into local storage.
   * Unbinds the previous hotkey combo and binds the new one.
   * Also updates the display element.
   * @param {*} name The name of the hotkey.
   */
  function syncHotkeyData(name) {
    const data = allHotkeys[name];

    Spicetify.LocalStorage.set(`${hotkeysNS}:${name}`, JSON.stringify(data.combo));
    data.displayElement.innerHTML = formatKey(data.combo);

    if (data.previousCombo != null) {
      Spicetify.Mousetrap.unbind(data.previousCombo);
    }
    Spicetify.Mousetrap.bind(data.combo, data.action);
    data.previousCombo = data.combo;
  }

  /**
   * Initialize a local storage key.
   * @param {string} keyName The name of the key.
   * @param {*} defaultVal The default value.
   * @param {function} callback The callback which should save the new value.
   * @param {boolean} [fix=true] Whether or not to overwrite the value if it is invalid.
   * @returns {void}
   * @throws {Error} If the value is invalid and fix is false.
   * @throws {Error} If the callback fails to accept the default value.
   */
  function initLocalKey(keyName, defaultVal, callback, fix = true) {
    const string = Spicetify.LocalStorage.get(keyName);
    if (!string) {
      const accepted = callback(defaultVal);
      if (!accepted) {
        throw new Error("Callback failed to accept default value.");
      }
      log(Level.TRACE, `Set default ${keyName}: ${defaultVal}.`);
      return;
    }

    let accepted = false;

    try {
      const parsed = JSON.parse(string);
      accepted = callback(parsed);
    } catch (e) {
      // ignore
    }

    if (!accepted) {
      if (fix) {
        log(Level.WARNING, `Fixed ${keyName} (Previously: ${string}).`);
        callback(defaultVal);
      } else {
        throw new Error(`Invalid ${keyName}.`);
      }
    }
  }

  /**
   * Retrive all saved data from local storage.
   * @returns {void}
   */
  function initializeLocalData() {
    initLocalKey(
      statusKey,
      isEnabled,
      (status) => {
        const valid = typeof status === "boolean";
        if (!valid) {
          return false;
        }

        isEnabled = status;
        syncEnabledData();
        return true;
      },
      true
    );

    initLocalKey(
      exploredKey,
      [],
      (tracks) => {
        const valid = areValidTrackIDs(tracks);
        if (!valid) {
          return false;
        }

        exploredTracks = tracks;
        syncExploredData();
        return true;
      },
      false
    );

    Object.entries(allHotkeys).forEach(([name, data]) => {
      initLocalKey(
        `${hotkeysNS}:${name}`,
        data.combo,
        (combo) => {
          const valid = validateCombo(combo);
          if (!valid) {
            return false;
          }

          data.combo = combo; // eslint-disable-line no-param-reassign
          syncHotkeyData(name);
          return true;
        },
        true
      );
    });
  }

  /**
   * Perform a basic validation of the provided hotkey combo.
   * @param {*} hotkey The hotkey combo to validate. (eg: "ctrl+shift+plus")
   * @returns {boolean}
   */
  function validateCombo(hotkey) {
    if (hotkey === "") {
      return true;
    }

    if (typeof hotkey !== "string") {
      return false;
    }

    const parts = hotkey.split("+");
    return (
      parts.length <= modifiers.length + 1 && parts.every((part) => part != null && part !== "")
    );
  }

  /**
   * Add the provided track ID to the list of explored tracks.
   * Also, saves it to local storage.
   * @param {string} id The ID of the track to mark as explored.
   * @returns {void}
   */
  function markTrackAsExplored(id) {
    log(Level.INFO, `Marking track as explored: ${id}`);
    exploredTracks.push(id);
    syncExploredData();
  }

  // #endregion

  // #region Main Logic

  /**
   * This checks the player state in an interval, and handles states.
   * It adds the tracks to the list of explored tracks when the progress
   * threshold is met.
   * @returns {Promise<void>}
   */
  async function handleStates() {
    let previousPlayerState = null;
    let totalRoughTrackProgress = 0;
    let currentRoughTrackProgress = 0;
    let trackJustSaved = false;

    for (;;) {
      const data = isEnabled ? Spicetify.Player.data : null;

      let state = null;
      let trackURI = null;

      if (data != null && data.track != null) {
        trackURI = Spicetify.URI.fromString(data.track.uri);
      }

      if (trackURI?.type === Spicetify.URI.Type.TRACK) {
        // A track is playing, ensure if the rest of the data is valid.
        if (
          data.timestamp == null ||
          data.position_as_of_timestamp == null ||
          data.is_paused == null
        ) {
          throw new Error("Spotify returned data that doesn't have expected values.");
        } else {
          state = {
            is_playing: !data.is_paused,
            position_at_ts: data.position_as_of_timestamp,
            timestamp: data.timestamp,
            trackURI,
          };
        }
      }
      // If a track wasn't playing or the extension was not enabled, the current state would be
      // null.
      const sameState = previousPlayerState?.timestamp === state?.timestamp;
      log(Level.TRACE, `Same state: ${sameState}.`);
      // if (!sameState) {
      //   console.log(previousPlayerState);
      //   console.log(state);
      // }

      // Can this track potentially be saved?
      let potentialSave = false;

      if (!trackJustSaved && previousPlayerState?.is_playing) {
        if (sameState) {
          // A track is playing, keep computing it's rough progress.
          // This is to ensure that long running songs are still saved.
          currentRoughTrackProgress = Date.now() - check(previousPlayerState.timestamp);
          // This log is extremely verbose, only enable if necessary.
          // log(
          //   Level.TRACE,
          //   `Current rough track progress: ${currentRoughTrackProgress / 1000}s.`,
          // );
          potentialSave = true;
        } else {
          // Some event has transpired. Perhaps the song has been paused, progressed or changed.
          // In all of these cases we want to add to the track's total progress.
          if (state !== null) {
            // This is the actual play time
            const accurateProgress = check(state.timestamp) - check(previousPlayerState.timestamp);
            totalRoughTrackProgress += accurateProgress;
            log(
              Level.TRACE,
              `Added accurate progress: ${accurateProgress / 1000}. Total: ${
                totalRoughTrackProgress / 1000
              }.`
            );
          } else {
            // If we don't have it, use the newest computed rough value.
            log(
              Level.TRACE,
              `Added rough progress: ${currentRoughTrackProgress / 1000}. Total: ${
                totalRoughTrackProgress / 1000
              }.`
            );
            totalRoughTrackProgress += currentRoughTrackProgress;
          }

          currentRoughTrackProgress = 0;
          potentialSave = true;
        }
      }

      if (
        potentialSave &&
        currentRoughTrackProgress + totalRoughTrackProgress >= trackProgressThresholdMS
      ) {
        log(Level.TRACE, "Threshold met, saving track.");
        markTrackAsExplored(check(previousPlayerState.trackURI.id));
        trackJustSaved = true;
      }

      if (!sameState && state?.trackURI.id !== previousPlayerState?.trackURI.id) {
        log(Level.TRACE, "Track changed. Resetting values.");
        totalRoughTrackProgress = 0;
        currentRoughTrackProgress = 0;
        trackJustSaved = false;

        if (exploredTracks.includes(state?.trackURI.id)) {
          log(Level.TRACE, "New track has been explored, changing tracks.");
          Spicetify.Player.next();
        }
      }

      previousPlayerState = state;
      await sleep(readIntervalMS);
    }
  }

  // #endregion

  // #region Playbar Button

  const disabledLabel = "Enable discovery mode";
  const enabledLabel = "Disable discovery mode";
  const barButton = new Spicetify.Playbar.Button(
    enabledLabel,
    "search",
    onBarButtonPress,
    false,
    true,
    false
  );

  /**
   * Toggle the enabled state..
   * @param {Spicetify.Playbar.Button} self
   * @returns {void}
   */
  function onBarButtonPress() {
    isEnabled = !isEnabled;
    syncEnabledData();
  }

  /**
   * Changes the button label and active status based on isEnabled.
   * @returns {void}
   */
  function syncBarButtonState() {
    barButton.active = isEnabled;
    barButton.label = isEnabled ? enabledLabel : disabledLabel;
  }

  // #endregion

  // #region Options Menu - Common

  const settingsContent = document.createElement("div");
  const style = document.createElement("style");
  style.innerHTML = `
  .main-trackCreditsModal-container {
    width: auto !important;
    background-color: var(--spice-player) !important;
  }

  .setting-row::after {
    content: "";
    display: table;
    clear: both;
  }
  .setting-row {
    display: flex;
    padding: 10px 0;
    align-items: center;
    justify-content: space-between;
  }
  .setting-row .col.description {
    float: left;
    padding-right: 18px;
    width: 100%;
  }
  .setting-row .col.action {
    float: right;
    text-align: right;
  }
  .hotkey-row .col.description {
    width: 50%;
  }
  .hotkey-row .col.action {
    width: 50%;
    white-space: nowrap;
  }
  .hotkey-row .col.key {
    width: auto;
    white-space: nowrap;
  }
  .hotkey-row .col.action button {
    margin-left: 10px;
  }
  button.switch {
    align-items: center;
    border: 0px;
    border-radius: 50%;
    background-color: rgba(var(--spice-rgb-shadow), .7);
    color: var(--spice-text);
    cursor: pointer;
    display: flex;
    margin-inline-start: 15px;
    padding: 9px;
  }
  button.switch.disabled,
  button.switch[disabled] {
    color: rgba(var(--spice-rgb-text), .3);
  }
  button.reset {
    font-weight: 700;
    font-size: medium;
    background-color: transparent;
    border-radius: 500px;
    transition-duration: 33ms;
    transition-property: background-color, border-color, color, box-shadow, filter, transform;
    padding-inline: 15px;
    border: 1px solid #727272;
    color: var(--spice-text);
    min-block-size: 32px;
    cursor: pointer;
  }
  button.reset:hover {
    transform: scale(1.04);
    border-color: var(--spice-text);
  }
  kbd {
    color: var(--spice-text);
    font-weight: 700;
    font-size: large;
    background-color: transparent;
    border-radius: 3px;
    border: 1px solid #727272;
    display: inline-block;
    padding: 2px 6px;
  }`;
  settingsContent.appendChild(style);

  /**
   * Creates a setting row with a button.
   * @param {string} text - The text to display on the button.
   * @param {string} description - The description to display in the row.
   * @param {*} callback - The callback to call when the button is pressed.
   * @returns {HTMLDivElement} The created row.
   */
  function createButtonRow(text, description, callback) {
    const container = document.createElement("div");
    container.classList.add("setting-row");

    container.innerHTML = `
    <label class="col description">${description}</label>
    <div class="col action"><button class="reset">${text}</button></div>
    `;

    const button = check(container.querySelector("button.reset"));
    button.onclick = callback;
    return container;
  }

  // #endregion

  // #region Options Menu - Data

  const header = document.createElement("h2");
  header.innerText = "Data";
  settingsContent.appendChild(header);

  /**
   * Copy the current explored tracks to the clipboard.
   * @returns {Promise<void>}
   */
  async function exportItems() {
    const data = JSON.stringify(exploredTracks, null, 2);
    await Spicetify.Platform.ClipboardAPI.copy(data);
    Spicetify.showNotification("Copied explored tracks to clipboard.");
  }

  /**
   * Merge the tracks from the clipboard with the current data.
   * @returns {Promise<void>}
   */
  async function importItems() {
    const newData = await Spicetify.Platform.ClipboardAPI.paste();
    let parsedData = null;
    try {
      parsedData = JSON.parse(newData);
    } catch (e) {
      // ignore
    }

    if (areValidTrackIDs(parsedData)) {
      exploredTracks = [...new Set([...exploredTracks, ...parsedData])];
      syncExploredData();
      Spicetify.showNotification("Merged new tracks with current data.");
    } else {
      Spicetify.showNotification(
        "The clipboard contains invalid JSON, did you export tracks first?"
      );
    }
  }

  /**
   * Clear all explored tracks data.
   * @returns {void}
   */
  function clearItems() {
    exploredTracks = [];
    syncExploredData();
    Spicetify.showNotification("Cleared all tracks.");
  }

  settingsContent.appendChild(
    createButtonRow("Export", "Save explored tracks to clipboard.", exportItems)
  );
  settingsContent.appendChild(
    createButtonRow(
      "Import",
      "Merge the explored tracks from clipboard with the current data.",
      importItems
    )
  );
  settingsContent.appendChild(
    createButtonRow("Clear ", "Clear all explored tracks data.", clearItems)
  );

  // #endregion

  // #region Options Menu - Hotkeys

  /**
   * Create the appropriate HTML for displaying a hotkey combo.
   * @param {string} key The hotkey combo. (eg: "ctrl+shift+plus")
   * @returns {string} The formatted HTML.
   */
  function formatKey(key) {
    if (key === "") {
      return "";
    }

    const parts = key.split("+");
    const hadTrailingPlus = parts[parts.length - 1] === "";
    if (hadTrailingPlus) {
      parts.pop();
    }

    const formatted = parts.map((part) => {
      if (part === "plus") {
        return "+";
      }
      if (part === "meta") {
        return isMac ? "⌘" : "Win";
      }
      return part[0].toUpperCase() + part.slice(1);
    });
    const kbd = formatted.map((part) => `<kbd>${part}</kbd>`);
    return hadTrailingPlus ? `${kbd.join(" + ")} +` : kbd.join(" + ");
  }

  const keyboardDiv = document.createElement("div");
  keyboardDiv.classList.add("hotkeys");
  const keyHeader = document.createElement("h2");
  keyHeader.innerText = "Shortcuts";
  keyboardDiv.appendChild(keyHeader);

  let targetHotkey = null;
  let stopTimeout = null;

  /**
   * Handle keydown and keyup events.
   * Keeps updating the display element based on the current key combination.
   * Saves the key combo as soon as non-modifier is pressed.
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function handleKeyEvent(event) {
    event.preventDefault();
    const targetData = allHotkeys[targetHotkey];

    const { key, ctrlKey, shiftKey, altKey, metaKey } = event;
    const combo = [];
    if (ctrlKey) combo.push("ctrl");
    if (metaKey) combo.push("meta");
    if (shiftKey) combo.push("shift");
    if (altKey) combo.push("alt");

    if (event.type === "keydown" && !modifiers.includes(key)) {
      const parsedKey = characterFromEvent(event);
      const sanitizedKey = parsedKey === "+" ? "plus" : parsedKey;
      combo.push(sanitizedKey);

      targetData.combo = combo.join("+");
      syncHotkeyData(targetHotkey);
      stopCapturingHotkey();
      return;
    }

    const partialShortcut = combo.length === 0 ? "" : `${combo.join("+")}+`;
    targetData.displayElement.innerHTML = formatKey(partialShortcut);
    clearTimeout(stopTimeout);
    stopTimeout = setTimeout(stopCapturingHotkey, editTimeoutAfter);
  }

  /**
   * Start capturing a new hotkey.
   * Set the targetHotkey to the hotkey being edited.
   */
  function startCapturingHotkey() {
    const targetData = allHotkeys[targetHotkey];

    document.addEventListener("keydown", handleKeyEvent);
    document.addEventListener("keyup", handleKeyEvent);
    targetData.editButton.classList.add("editing");
    targetData.editButton.innerText = "Editing...";
    stopTimeout = setTimeout(stopCapturingHotkey, editTimeoutAfter);
  }

  /**
   * Stop capturing a hotkey.
   * Remove event listeners and reset the edit button.
   * @returns {void}
   */
  function stopCapturingHotkey() {
    const targetData = allHotkeys[targetHotkey];

    clearTimeout(stopTimeout);
    document.removeEventListener("keydown", handleKeyEvent);
    document.removeEventListener("keyup", handleKeyEvent);
    targetData.editButton.classList.remove("editing");
    targetData.editButton.innerText = "Edit";
    targetData.displayElement.innerHTML = formatKey(targetData.combo);

    targetHotkey = null;
  }

  /**
   * Create a container for a hotkey.
   * Creates the edit button for it, and a display element.
   * Also updates the hotkey data object.
   * @param {*} description The hotkey description.
   * @param {*} name The target hotkey name.
   * @returns {HTMLElement} A setting row for the hotkey.
   */
  function keyRow(description, name) {
    const rowContainer = document.createElement("div");
    rowContainer.classList.add("setting-row");
    rowContainer.classList.add("hotkey-row");

    rowContainer.innerHTML = `
    <label class="col description">${description}</label>
    <div class="col key" id="${name}-key"></div>
    <div class="col action">
      <div class="button-container">
        <button class="reset hotedit" id="${name}-edit">Edit</button>
        <button class="reset" id="${name}-clear">Clear</button>
      </div>
    </div>`;

    const editButton = check(rowContainer.querySelector(`#${name}-edit`));
    const clearButton = check(rowContainer.querySelector(`#${name}-clear`));
    const keyElement = check(rowContainer.querySelector(`#${name}-key`));

    editButton.addEventListener("click", () => {
      if (targetHotkey != null) {
        stopCapturingHotkey();
      } else {
        targetHotkey = name;
        startCapturingHotkey();
      }
    });

    clearButton.addEventListener("click", () => {
      if (targetHotkey != null) {
        stopCapturingHotkey();
        targetHotkey = null;
      }

      allHotkeys[name].combo = "";
      syncHotkeyData(name);
    });

    const hotkeyData = allHotkeys[name];
    hotkeyData.editButton = editButton;
    hotkeyData.displayElement = keyElement;

    return rowContainer;
  }

  Object.entries(allHotkeys).forEach(([name, data]) => {
    const row = keyRow(data.description, name);
    keyboardDiv.appendChild(row);
  });
  settingsContent.appendChild(keyboardDiv);

  // #endregion

  const menuItem = new Spicetify.Menu.Item(
    "Track Explorer",
    false,
    () => {
      Spicetify.PopupModal.display({
        title: "Track Explorer Settings",
        content: settingsContent,
      });
    },
    "search"
  );

  // #region Debugging
  /* eslint-disable */

  /**
   * Used for debugging.
   * Prints useful information about player state in an interval.
   * @returns {Promise<void>}
   * @todo Improve this, and ;properly handle null values.
   */
  async function printPlayerStates() {
    let previousTimestamp = null;
    const previousPosition = null;

    while (1) {
      const { data } = Spicetify.Player;
      if (previousTimestamp !== null) {
        const date = new Date(data.timestamp);
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();

        const formattedTimestamp = `${minutes}:${seconds}`;
        const position = data.position_as_of_timestamp / 1000;
        const formattedPosition = `${Math.floor(position / 60)}:${Math.floor(position % 60)}`;
        console.log(
          `${data.timestamp}, ${data.position_as_of_timestamp}, ${formattedTimestamp}, ${formattedPosition}, ${data.is_paused}`
        );
      }

      previousTimestamp = data.timestamp;
      await sleep(readIntervalMS);
    }
  }

  /**
   * Used only for testing.
   * @returns {Promise<*>}
   */
  async function demo() {
    exploredTracks = [];
    await syncExploredData();

    const predef = ["65FftemJ1DbbZ45DUfHJXE", "2yWAPCnRMbpbGqVHAZzqgJ", "49AY652l5Ubg7roDGHGVOY"];
    predef.forEach((id) => markTrackAsExplored(id));

    Spicetify.PopupModal.display({
      title: "Track Explorer Settings",
      content: settingsContent,
    });
    // Spicetify.SVGIcons is an object containing svg paths for icons. Create a popupmodal to display all of them,
    // a single path looks like <path d="M0 0h24v24H0z" fill="none"></path>
    const container = document.createElement("div");
    container.innerHTML =
      "<style>.icon-container{display:flex;align-items:center;}.icon{margin-right:10px;}</style>";
    Object.entries(Spicetify.SVGIcons).forEach(([name, path]) => {
      container.innerHTML += `<div class="icon-container"><div class="icon">
      <svg viewBox="0 0 16 16" width="50" height="50" fill="currentColor">${path}</svg>
      </div><div class="icon-name">${name}</div></div>`;
      // container.innerHTML += `${name}<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${path}</svg><br>`;
    });
    // Spicetify.PopupModal.display({
    //   title: "SVG Icons",
    //   content: container,
    // });
  }

  /* eslint-enable */
  // #endregion

  /**
   * Initializes the config, loads the UI, and handles player states.
   * @returns {Promise<void>}
   */
  async function main() {
    await initializeLocalData();
    barButton.register();
    menuItem.register();
    await handleStates();
  }

  await main();
})();
